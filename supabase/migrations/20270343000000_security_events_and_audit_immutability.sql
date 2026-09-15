-- Security events and audit immutability.
--
-- Identity/Auth Slice 1 (Phase 2 design, Y.14, Y.15, AE, AO B1-B4). Two
-- append-only stores:
--
--   * public.security_events -- typed security facts (who did what to whose
--     account), written only by internal.emit_security_event and the identity
--     triggers that call it;
--   * public.audit_log       -- row changes, now attributed server-side and
--     redacted before they are stored.
--
-- After this migration:
--
--   * no application role (anon, authenticated, service_role) holds INSERT,
--     UPDATE, DELETE or TRUNCATE on either store, and postgres itself cannot
--     update, delete or truncate them unless an operator session outside the
--     API roles sets ovalball.maintenance = 'on' (the future retention job);
--   * the actor on every new row is derived from the request's JWT, never
--     from a value the writer supplies, so no path can attribute a change to
--     someone else;
--   * secret-shaped metadata keys are refused, and configured personal and
--     secret columns are masked, hashed or dropped from audit images;
--   * creating an identity, completing its details, changing its email, and
--     suspending, disabling or restoring an account each emit their event in
--     the same transaction as the change;
--   * security-relevant tables that had no audit trigger now have one.
--
-- Viewing: a person sees their own subject-visible events; a Full Site Admin
-- sees all events (the Slice 1 stand-in for site.security_events.view until
-- site capability grants exist). audit_log keeps its existing read policy.
-- Nothing here grants a write, and no existing row is rewritten.

-- ---------------------------------------------------------------------
-- 1. The event catalogue
-- ---------------------------------------------------------------------

create table public.security_event_types (
  event_type text primary key check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  category text not null check (category in (
    'IDENTITY', 'INVITATION', 'MEMBERSHIP', 'FAMILY', 'CLAIM', 'SITE_ADMIN',
    'IMPERSONATION', 'SENSITIVE_ACCESS', 'OPERATIONS'
  )),
  severity text not null check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  club_visible boolean not null default false,
  subject_visible boolean not null default false,
  requires_reason boolean not null default false
);

comment on table public.security_event_types is
  'Catalogue of security event types (Phase 2 AE.2). Changed only by migration.';
comment on column public.security_event_types.requires_reason is
  'An administrative actor must give a reason. Recorded now; enforced by the slice that introduces reason capture for the action.';

insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason) values
  -- Identity and account
  ('user.created',                      'IDENTITY', 'INFO',     false, true,  true),
  ('user.setup_completed',              'IDENTITY', 'INFO',     false, true,  false),
  ('account.suspended',                 'IDENTITY', 'WARNING',  false, true,  true),
  ('account.restored',                  'IDENTITY', 'WARNING',  false, true,  true),
  ('account.disabled',                  'IDENTITY', 'CRITICAL', false, true,  true),
  ('account.details_corrected',         'IDENTITY', 'WARNING',  false, true,  true),
  ('password.reset_requested',          'IDENTITY', 'INFO',     false, true,  false),
  ('password.reset_completed',          'IDENTITY', 'WARNING',  false, true,  false),
  ('password.changed',                  'IDENTITY', 'WARNING',  false, true,  false),
  ('password.forced_reset',             'IDENTITY', 'WARNING',  false, true,  true),
  ('mfa.enrolled',                      'IDENTITY', 'INFO',     false, true,  false),
  ('mfa.factor_added',                  'IDENTITY', 'WARNING',  false, true,  false),
  ('mfa.factor_removed',                'IDENTITY', 'WARNING',  false, true,  false),
  ('mfa.challenge_failed_threshold',    'IDENTITY', 'CRITICAL', false, true,  false),
  ('mfa.recovery_code_used',            'IDENTITY', 'WARNING',  false, true,  false),
  ('mfa.recovery_codes_regenerated',    'IDENTITY', 'WARNING',  false, true,  false),
  ('mfa.recovery_requested',            'IDENTITY', 'WARNING',  false, true,  true),
  ('mfa.recovery_approved',             'IDENTITY', 'CRITICAL', false, true,  true),
  ('mfa.recovery_completed',            'IDENTITY', 'CRITICAL', false, true,  true),
  ('mfa.recovery_cancelled',            'IDENTITY', 'INFO',     false, true,  true),
  ('session.revoked',                   'IDENTITY', 'INFO',     false, true,  true),
  ('session.revoked_all',               'IDENTITY', 'WARNING',  false, true,  true),
  ('email.change_requested',            'IDENTITY', 'INFO',     false, true,  true),
  ('email.changed',                     'IDENTITY', 'WARNING',  false, true,  true),
  ('identity.linked',                   'IDENTITY', 'WARNING',  false, true,  false),
  ('identity.unlinked',                 'IDENTITY', 'WARNING',  false, true,  false),
  ('sign_in.succeeded',                 'IDENTITY', 'INFO',     false, true,  false),
  ('sign_in.failed',                    'IDENTITY', 'WARNING',  false, true,  false),
  -- Invitations
  ('invitation.issued',                 'INVITATION', 'INFO',    true,  false, false),
  ('invitation.resent',                 'INVITATION', 'INFO',    true,  false, false),
  ('invitation.revoked',                'INVITATION', 'INFO',    true,  false, true),
  ('invitation.redeemed',               'INVITATION', 'INFO',    true,  false, false),
  ('invitation.attempts_throttled',     'INVITATION', 'WARNING', false, false, false),
  ('invitation.issuer_authority_lost',  'INVITATION', 'WARNING', true,  false, false),
  -- Membership, roles and permissions
  ('membership.requested',              'MEMBERSHIP', 'INFO',    true, false, false),
  ('membership.approved',               'MEMBERSHIP', 'INFO',    true, false, true),
  ('membership.declined',               'MEMBERSHIP', 'INFO',    true, false, true),
  ('membership.granted',                'MEMBERSHIP', 'INFO',    true, false, true),
  ('membership.suspended',              'MEMBERSHIP', 'WARNING', true, false, true),
  ('membership.restored',               'MEMBERSHIP', 'INFO',    true, false, true),
  ('membership.revoked',                'MEMBERSHIP', 'WARNING', true, false, true),
  ('membership.expired',                'MEMBERSHIP', 'INFO',    true, false, false),
  ('role.granted',                      'MEMBERSHIP', 'WARNING', true, false, true),
  ('role.suspended',                    'MEMBERSHIP', 'WARNING', true, false, true),
  ('role.restored',                     'MEMBERSHIP', 'WARNING', true, false, true),
  ('role.revoked',                      'MEMBERSHIP', 'WARNING', true, false, true),
  ('override.granted',                  'MEMBERSHIP', 'WARNING', true, false, true),
  ('override.revoked',                  'MEMBERSHIP', 'WARNING', true, false, true),
  ('player_team.added',                 'MEMBERSHIP', 'INFO',    true, false, true),
  ('player_team.ended',                 'MEMBERSHIP', 'INFO',    true, false, true),
  ('player_team.moved',                 'MEMBERSHIP', 'INFO',    true, false, true),
  -- Family
  ('guardian.link_requested',           'FAMILY', 'INFO',    true, false, false),
  ('guardian.link_approved',            'FAMILY', 'WARNING', true, false, true),
  ('guardian.link_declined',            'FAMILY', 'INFO',    true, false, true),
  ('guardian.linked',                   'FAMILY', 'WARNING', true, false, true),
  ('guardian.suspended',                'FAMILY', 'WARNING', true, false, true),
  ('guardian.unlinked',                 'FAMILY', 'WARNING', true, false, true),
  -- Club claims
  ('claim.submitted',                   'CLAIM', 'INFO',    true, false, false),
  ('claim.information_requested',       'CLAIM', 'INFO',    true, false, true),
  ('claim.approved',                    'CLAIM', 'WARNING', true, false, true),
  ('claim.rejected',                    'CLAIM', 'INFO',    true, false, true),
  ('claim.superseded',                  'CLAIM', 'INFO',    true, false, false),
  ('claim.withdrawn',                   'CLAIM', 'INFO',    true, false, false),
  -- Site Admin
  ('site_admin.grant_requested',        'SITE_ADMIN', 'WARNING',  false, false, true),
  ('site_admin.granted',                'SITE_ADMIN', 'CRITICAL', false, false, true),
  ('site_admin.grant_rejected',         'SITE_ADMIN', 'WARNING',  false, false, true),
  ('site_admin.revoked',                'SITE_ADMIN', 'CRITICAL', false, false, true),
  ('site_admin.profile_changed',        'SITE_ADMIN', 'WARNING',  false, false, true),
  ('site_admin.capability_added',       'SITE_ADMIN', 'CRITICAL', false, false, true),
  ('site_admin.capability_removed',     'SITE_ADMIN', 'WARNING',  false, false, true),
  -- Impersonation
  ('impersonation.started',             'IMPERSONATION', 'CRITICAL', false, false, true),
  ('impersonation.ended',               'IMPERSONATION', 'INFO',     false, false, false),
  ('impersonation.blocked_action',      'IMPERSONATION', 'WARNING',  false, false, false),
  -- Sensitive access
  ('pii.viewed',                        'SENSITIVE_ACCESS', 'WARNING',  false, false, true),
  ('pii.searched',                      'SENSITIVE_ACCESS', 'WARNING',  false, false, false),
  ('safeguarding.thread_reviewed',      'SENSITIVE_ACCESS', 'CRITICAL', false, false, true),
  ('safeguarding.welfare_viewed',       'SENSITIVE_ACCESS', 'WARNING',  false, false, false),
  ('audit.sensitive_viewed',            'SENSITIVE_ACCESS', 'WARNING',  false, false, true),
  ('audit.purged',                      'SENSITIVE_ACCESS', 'WARNING',  false, false, true),
  ('export.generated',                  'SENSITIVE_ACCESS', 'WARNING',  true,  false, true),
  -- Destructive and operations
  ('club.deactivated',                  'OPERATIONS', 'WARNING',  true,  false, true),
  ('club.deleted',                      'OPERATIONS', 'CRITICAL', true,  false, true),
  ('fixture.deleted',                   'OPERATIONS', 'WARNING',  true,  false, true),
  ('payment.refunded',                  'OPERATIONS', 'WARNING',  true,  false, true),
  ('enforcement.policy_changed',        'OPERATIONS', 'CRITICAL', false, false, true);

-- ---------------------------------------------------------------------
-- 2. The event store
-- ---------------------------------------------------------------------

create table public.security_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  event_type text not null references public.security_event_types (event_type),
  -- Attribution columns are set by internal.security_event_facts(); a
  -- supplied value is discarded. None references auth.users: history outlives
  -- the identity it describes.
  actor_user_id uuid,
  effective_person_id uuid,
  impersonation_session_id uuid,
  subject_user_id uuid,
  club_id uuid,
  team_id uuid,
  player_id uuid,
  outcome text not null default 'SUCCESS' check (outcome in ('SUCCESS', 'DENIED', 'FAILED')),
  aal text,
  reason text check (reason is null or char_length(reason) <= 2000),
  request_id text check (request_id is null or char_length(request_id) <= 128),
  ip_hash bytea,
  user_agent_hash bytea,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

comment on table public.security_events is
  'Append-only security facts (Phase 2 Y.14). Written only through internal.emit_security_event; no role may update or delete. Retention PURGE-24 months (AN-13; purge not yet scheduled).';

create index security_events_subject_idx on public.security_events (subject_user_id, occurred_at desc);
create index security_events_actor_idx on public.security_events (actor_user_id, occurred_at desc);
create index security_events_club_idx on public.security_events (club_id, occurred_at desc);
create index security_events_type_idx on public.security_events (event_type, occurred_at desc);

-- True when any object key, at any depth, is secret-shaped (Y.14 CHECK).
create or replace function internal.jsonb_has_secret_key(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with recursive walk(k, v) as (
    select null::text, p_value
    union all
    select c.k, c.v
    from walk w
    cross join lateral (
      select e.key, e.value
      from pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) e
      union all
      select null::text, a.value
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) a
    ) c(k, v)
  )
  select exists (
    select 1 from walk where k ~* '(password|token|secret|code|otp|factor_secret)'
  );
$$;

revoke all on function internal.jsonb_has_secret_key(jsonb) from public, anon, authenticated, service_role;

-- Every insert, whoever performs it: the time and the actor are the server's,
-- and metadata may not carry a secret-shaped key.
create or replace function internal.security_event_facts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if internal.jsonb_has_secret_key(new.metadata) then
    raise exception 'Security event metadata may not contain secret-shaped keys (password, token, secret, code, otp).'
      using errcode = '22023';
  end if;
  if pg_catalog.octet_length(new.metadata::text) > 16384 then
    raise exception 'Security event metadata is too large.' using errcode = '22023';
  end if;

  new.occurred_at := pg_catalog.now();
  new.actor_user_id := auth.uid();
  -- No impersonation exists yet: the effective person is the actor. The
  -- impersonation slice derives both from its session here, not from callers.
  new.effective_person_id := auth.uid();
  new.impersonation_session_id := null;
  new.aal := nullif(auth.jwt() ->> 'aal', '');
  new.request_id := nullif(left(current_setting('ovalball.request_id', true), 128), '');
  return new;
end;
$$;

revoke all on function internal.security_event_facts() from public, anon, authenticated, service_role;

create trigger a_security_event_facts
  before insert on public.security_events
  for each row execute function internal.security_event_facts();

-- The one write authority. There is deliberately no actor parameter.
create or replace function internal.emit_security_event(
  p_event_type text,
  p_subject_user_id uuid default null,
  p_outcome text default 'SUCCESS',
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_club_id uuid default null,
  p_team_id uuid default null,
  p_player_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not exists (select 1 from public.security_event_types t where t.event_type = p_event_type) then
    raise exception 'Unknown security event type: %', p_event_type using errcode = '22023';
  end if;
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Security event metadata must be a JSON object.' using errcode = '22023';
  end if;

  insert into public.security_events (event_type, subject_user_id, outcome, reason, metadata, club_id, team_id, player_id)
  values (p_event_type, p_subject_user_id, coalesce(p_outcome, 'SUCCESS'), nullif(btrim(p_reason), ''), p_metadata, p_club_id, p_team_id, p_player_id)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function internal.emit_security_event(text, uuid, text, text, jsonb, uuid, uuid, uuid) from public, anon, authenticated, service_role;

comment on function internal.emit_security_event(text, uuid, text, text, jsonb, uuid, uuid, uuid) is
  'The only writer of public.security_events. Actor, effective person, AAL and time are derived server-side by the table trigger. Not executable by any API role; called by trusted database functions in the same transaction as the change they record.';

-- ---------------------------------------------------------------------
-- 3. History is append-only
-- ---------------------------------------------------------------------

create or replace function internal.refuse_history_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text := coalesce(nullif(current_setting('role', true), ''), 'none');
begin
  -- The maintenance setting is honoured only for an operator session: never
  -- inside a request made through the API, even from a definer function.
  if current_setting('ovalball.maintenance', true) = 'on'
     and v_role not in ('anon', 'authenticated', 'service_role')
     and session_user::text not in ('authenticator', 'anon', 'authenticated', 'service_role')
     and coalesce(current_setting('request.jwt.claims', true), '') = ''
  then
    if tg_level = 'STATEMENT' then
      return null;
    elsif tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception '% is append-only: its history cannot be changed (%).', tg_table_name, lower(tg_op)
    using errcode = '42501';
end;
$$;

revoke all on function internal.refuse_history_rewrite() from public, anon, authenticated, service_role;

create trigger security_events_append_only
  before update or delete on public.security_events
  for each row execute function internal.refuse_history_rewrite();
create trigger security_events_no_truncate
  before truncate on public.security_events
  for each statement execute function internal.refuse_history_rewrite();

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function internal.refuse_history_rewrite();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function internal.refuse_history_rewrite();

-- ---------------------------------------------------------------------
-- 4. audit_log: server-side attribution and redaction
-- ---------------------------------------------------------------------

alter table public.audit_log
  add column actor_user_id uuid,
  add column effective_person_id uuid,
  add column impersonation_session_id uuid,
  add column request_id text,
  add column redacted boolean not null default false;

comment on column public.audit_log.actor_user_id is
  'The authenticated identity whose request made the change, from the JWT. Set by trigger; a supplied value is discarded. changed_by is kept for compatibility and may name the person a trusted function acted for.';
comment on table public.audit_log is
  'Append-only row-change history (Phase 2 Y.15), redacted per audit_redaction_rules before storage. Retention PURGE-72 months (AN-13; purge not yet scheduled).';

create table public.audit_redaction_rules (
  table_name text not null,
  column_name text not null,
  mode text not null check (mode in ('DROP', 'HASH', 'MASK')),
  primary key (table_name, column_name)
);

comment on table public.audit_redaction_rules is
  'Columns stripped from audit images before they are stored. DROP removes the key, HASH stores sha256 of the value, MASK keeps the key with a placeholder. A column whose name is secret-shaped (token, _hmac, _sha256, password, secret) is hashed even without a rule. Changed only by migration.';

insert into public.audit_redaction_rules (table_name, column_name, mode) values
  ('profiles', 'date_of_birth', 'MASK'),
  ('profiles', 'address_line_1', 'MASK'),
  ('profiles', 'address_line_2', 'MASK'),
  ('profiles', 'address_line_3', 'MASK'),
  ('profiles', 'postcode', 'MASK'),
  ('profiles', 'phone_number', 'MASK'),
  ('players', 'date_of_birth', 'MASK'),
  ('guardian_link_requests', 'submitted_date_of_birth', 'MASK'),
  ('player_duplicate_reviews', 'submitted_date_of_birth', 'MASK'),
  ('invitations', 'token', 'HASH'),
  ('guardian_invitations', 'token', 'HASH'),
  ('player_account_invitations', 'token', 'HASH'),
  ('site_admin_invitations', 'token', 'HASH'),
  ('club_safeguarding_officer_invitations', 'token', 'HASH'),
  ('email_deliveries', 'error_message', 'DROP'),
  ('fixture_messages', 'body', 'DROP');

create or replace function internal.redact_audit_image(p_table text, p_image jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rules jsonb;
  v_out jsonb := p_image;
  v_key text;
  v_mode text;
begin
  if p_image is null or pg_catalog.jsonb_typeof(p_image) <> 'object' then
    return p_image;
  end if;

  select pg_catalog.jsonb_object_agg(r.column_name, r.mode) into v_rules
  from public.audit_redaction_rules r
  where r.table_name = p_table;

  for v_key in select pg_catalog.jsonb_object_keys(p_image) loop
    v_mode := v_rules ->> v_key;
    if v_mode is null and v_key ~* '(token|_hmac$|_sha256$|password|secret)' and v_key !~* '_at$' then
      v_mode := 'HASH';
    end if;
    continue when v_mode is null;

    if v_mode = 'DROP' then
      v_out := v_out - v_key;
    elsif pg_catalog.jsonb_typeof(p_image -> v_key) = 'null' then
      continue;
    elsif v_mode = 'MASK' then
      v_out := pg_catalog.jsonb_set(v_out, array[v_key], '"[redacted]"'::jsonb);
    else
      v_out := pg_catalog.jsonb_set(
        v_out, array[v_key],
        pg_catalog.to_jsonb('sha256:' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_image ->> v_key, 'UTF8')), 'hex'))
      );
    end if;
  end loop;
  return v_out;
end;
$$;

revoke all on function internal.redact_audit_image(text, jsonb) from public, anon, authenticated, service_role;

-- Applied to every audit row however it is written: internal.audit_row_change
-- and the trusted functions that insert their own entries alike.
create or replace function internal.audit_log_facts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := internal.redact_audit_image(new.table_name, new.before);
  v_after jsonb := internal.redact_audit_image(new.table_name, new.after);
begin
  new.redacted := (v_before is distinct from new.before) or (v_after is distinct from new.after);
  new.before := v_before;
  new.after := v_after;
  new.actor_user_id := auth.uid();
  new.effective_person_id := auth.uid();
  new.impersonation_session_id := null;
  new.request_id := nullif(left(current_setting('ovalball.request_id', true), 128), '');
  return new;
end;
$$;

revoke all on function internal.audit_log_facts() from public, anon, authenticated, service_role;

create trigger a_audit_log_facts
  before insert on public.audit_log
  for each row execute function internal.audit_log_facts();

-- ---------------------------------------------------------------------
-- 5. Audit coverage for security-relevant tables that had none (Y.15)
--
-- Of the tables Y.15 names, these exist today and were unaudited. The rest
-- (role_assignments, bundle_capabilities, site_capability_grants,
-- access_invitations, impersonation_sessions) arrive with their own slices,
-- carrying the trigger from creation (Y conventions).
-- ---------------------------------------------------------------------

create trigger audit_capabilities after insert or update or delete on public.capabilities
  for each row execute function internal.audit_row_change();
create trigger audit_tournaments after insert or update or delete on public.tournaments
  for each row execute function internal.audit_row_change();
create trigger audit_club_events after insert or update or delete on public.club_events
  for each row execute function internal.audit_row_change();
create trigger audit_competition_matches after insert or update or delete on public.competition_matches
  for each row execute function internal.audit_row_change();
create trigger audit_gocardless_payments after insert or update or delete on public.gocardless_payments
  for each row execute function internal.audit_row_change();
create trigger audit_payment_refunds after insert or update or delete on public.payment_refunds
  for each row execute function internal.audit_row_change();
create trigger audit_membership_obligations after insert or update or delete on public.membership_obligations
  for each row execute function internal.audit_row_change();
create trigger audit_club_message_blocks after insert or update or delete on public.club_message_blocks
  for each row execute function internal.audit_row_change();
create trigger audit_user_message_blocks after insert or update or delete on public.user_message_blocks
  for each row execute function internal.audit_row_change();
create trigger audit_site_admin_diagnostic_sessions after insert or update or delete on public.site_admin_diagnostic_sessions
  for each row execute function internal.audit_row_change();
-- The catalogue and the redaction rules change only by migration, and a
-- change to either is itself security-relevant.
create trigger audit_security_event_types after insert or update or delete on public.security_event_types
  for each row execute function internal.audit_row_change();
create trigger audit_audit_redaction_rules after insert or update or delete on public.audit_redaction_rules
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 6. Identity events, in the same transaction as the change (AO B4)
-- ---------------------------------------------------------------------

create or replace function internal.create_profile_for_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source text := case
    when coalesce(new.raw_app_meta_data ->> 'provider', 'email') in ('google', 'apple', 'facebook') then 'SOCIAL'
    when new.invited_at is not null then 'INVITATION'
    else 'SELF_SIGNUP'
  end;
begin
  insert into public.profiles (id, first_name, surname, email, account_state, setup_state, created_source)
  values (new.id, '', '', new.email, 'ACTIVE', 'PENDING_DETAILS', v_source)
  on conflict (id) do nothing;

  perform internal.emit_security_event(
    'user.created', new.id, 'SUCCESS', null,
    pg_catalog.jsonb_build_object('created_source', v_source)
  );
  return null;
end;
$$;

revoke all on function internal.create_profile_for_identity() from public, anon, authenticated, service_role;

create or replace function internal.sync_profile_email_from_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p set email = new.email
  where p.id = new.id and p.email is distinct from new.email;

  -- The addresses themselves are personal data and are not recorded.
  if old.email is distinct from new.email then
    perform internal.emit_security_event('email.changed', new.id);
  end if;
  return null;
end;
$$;

revoke all on function internal.sync_profile_email_from_identity() from public, anon, authenticated, service_role;

-- Account-state and setup transitions, whichever path makes them:
-- set_account_status, profile completion, or a trusted backend writer.
create or replace function internal.emit_profile_state_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event text;
begin
  if new.account_state is distinct from old.account_state then
    v_event := case
      when new.account_state = 'SUSPENDED' then 'account.suspended'
      when new.account_state = 'DISABLED' then 'account.disabled'
      when new.account_state = 'ACTIVE' and old.account_state in ('SUSPENDED', 'DISABLED') then 'account.restored'
    end;
    if v_event is not null then
      perform internal.emit_security_event(
        v_event, new.id, 'SUCCESS', new.state_reason,
        pg_catalog.jsonb_build_object('from_state', old.account_state, 'to_state', new.account_state)
      );
    end if;
  end if;

  if old.setup_state = 'PENDING_DETAILS' and new.setup_state = 'COMPLETE' then
    perform internal.emit_security_event(
      'user.setup_completed', new.id, 'SUCCESS', null,
      pg_catalog.jsonb_build_object('created_source', new.created_source)
    );
  end if;
  return null;
end;
$$;

revoke all on function internal.emit_profile_state_events() from public, anon, authenticated, service_role;

create trigger emit_profile_state_events
  after update on public.profiles
  for each row
  when (old.account_state is distinct from new.account_state or old.setup_state is distinct from new.setup_state)
  execute function internal.emit_profile_state_events();

-- ---------------------------------------------------------------------
-- 7. Row access and grants
-- ---------------------------------------------------------------------

alter table public.security_event_types enable row level security;
alter table public.security_events enable row level security;
alter table public.audit_redaction_rules enable row level security;

-- The catalogue names event types and their visibility; it holds no personal
-- or secret data.
create policy security_event_types_select on public.security_event_types
  for select to authenticated
  using (true);

create policy security_events_select_own on public.security_events
  for select to authenticated
  using (
    subject_user_id = (select auth.uid())
    and (select internal.is_account_active(auth.uid()))
    and exists (
      select 1 from public.security_event_types t
      where t.event_type = security_events.event_type and t.subject_visible
    )
  );

-- Slice 1 stand-in for site.security_events.view: Full Site Admins only, read
-- only. Club-visible events for people.access.explain holders arrive with the
-- capability (no club-visible event is emitted yet).
create policy security_events_select_full_site_admin on public.security_events
  for select to authenticated
  using ((select internal.is_full_site_admin()));

revoke all on public.security_event_types from public, anon, authenticated, service_role;
revoke all on public.security_events from public, anon, authenticated, service_role;
revoke all on public.audit_redaction_rules from public, anon, authenticated, service_role;
revoke all on sequence public.security_events_id_seq from public, anon, authenticated, service_role;

grant select on public.security_event_types to authenticated, service_role;
grant select on public.security_events to authenticated, service_role;
grant select on public.audit_redaction_rules to service_role;

-- audit_log: read as before; no application role may write it directly.
revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated, service_role;
