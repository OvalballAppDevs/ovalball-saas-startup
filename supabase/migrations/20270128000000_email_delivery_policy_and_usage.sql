-- EMAIL DELIVERY POLICY -- the on/off switch, at the correct canonical
-- level, and USAGE aggregates from the existing delivery ledger.
--
-- WHY THIS LIVES ON email_events, NOT email_template_settings
--
-- 20270125000000 removed email_template_settings.enabled because nothing
-- ever wired it up: no RPC wrote it, no send path read it, no Site Admin
-- control showed it. That failure was a column at the wrong LEVEL as much
-- as an unwired one -- a template describes COPY, and whether an email
-- sends at all is a fact about the EVENT, not about which wording happens
-- to be active.
--
-- public.email_events ALREADY has an `active boolean not null default true`
-- column, created alongside the table itself and never wired to anything
-- either -- the exact same dead-column failure, one level up. Rather than
-- add a THIRD place to ask "is this email on", this migration wires up the
-- column that was already sitting at the right level, following the same
-- `active` + `set_x_active()` pattern this codebase already uses for
-- venues, pitches and scheduling groups (set_venue_active,
-- set_club_pitch_active, set_scheduling_group_active).
--
-- WHY set_email_event_active() BELOW ORIGINALLY REFUSED EVERY EVENT BUT
-- OPTIONAL_OPERATIONAL -- AND WHY THAT WAS WRONG
--
-- This migration originally reasoned that MANDATORY_OPERATIONAL and
-- TRANSACTIONAL_IDENTITY mail should never be switchable, from those
-- classifications' own stated purpose (an ordinary recipient cannot opt
-- out of them). 20270129000000 corrects this: classification governs
-- whether a RECIPIENT's own preference can suppress a message, which is a
-- different question from whether Ovalball's own Full Site Admin may
-- switch the whole transactional CHANNEL off. The function body actually
-- executing in this database is 20270129000000's, not this file's
-- original one -- see that migration's own header for the corrected
-- reasoning.

begin;

-- ---------------------------------------------------------------------
-- email_events: concurrency-safe, attributable state.
-- ---------------------------------------------------------------------
alter table public.email_events
  add column if not exists lock_version int not null default 0,
  add column if not exists updated_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------
-- Append-only audit log. Mirrors email_template_versions' own
-- never-delete-only-append shape for the same reason: an audit trail a
-- person can edit is not one.
-- ---------------------------------------------------------------------
create table if not exists public.email_delivery_policy_audit (
  id uuid primary key default gen_random_uuid(),
  event_key text not null references public.email_events(event_key) on update cascade,
  previous_active boolean not null,
  new_active boolean not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);
create index if not exists email_delivery_policy_audit_event_idx on public.email_delivery_policy_audit (event_key, changed_at desc);

alter table public.email_delivery_policy_audit enable row level security;
create policy email_delivery_policy_audit_select on public.email_delivery_policy_audit
  for select to authenticated
  using (internal.is_site_admin());

-- ---------------------------------------------------------------------
-- email_deliveries: an OCCURRENCE-level key, separate from the
-- per-recipient idempotency_key, so "how many times was this email
-- TRIGGERED" (send occurrences) can be answered precisely rather than
-- approximated by parsing idempotency_key strings. A fixture cancelled
-- once, mailed to 18 people, is 1 occurrence and 18 recipient deliveries
-- -- see lib/email/send.ts's own comment on why the two numbers differ.
--
-- recipient_email becomes nullable for exactly one new case: a
-- policy-suppressed row records that AN EVENT OCCURRED AND ITS EMAIL
-- CHANNEL WAS DISABLED, deliberately BEFORE recipient resolution runs --
-- so a disabled event never looks up who it would have mailed, and no
-- recipient PII is read merely to record a suppression. Every other
-- status still always carries a real recipient_email; nothing about an
-- actual attempt becomes optional.
-- ---------------------------------------------------------------------
alter table public.email_deliveries
  add column if not exists occurrence_key text,
  alter column recipient_email drop not null;

-- Backfill: an existing row's occurrence is its idempotency_key with any
-- trailing ":<recipient_email>" suffix removed -- exactly the suffix
-- lib/email/send.ts appends when an occurrence has more than one
-- recipient. A single-recipient occurrence's idempotency_key already IS
-- its occurrence_key.
update public.email_deliveries
set occurrence_key = case
  when recipient_email is not null and idempotency_key like '%:' || recipient_email
    then left(idempotency_key, length(idempotency_key) - length(recipient_email) - 1)
  else idempotency_key
end
where occurrence_key is null;

alter table public.email_deliveries alter column occurrence_key set not null;
create index if not exists email_deliveries_occurrence_idx on public.email_deliveries (event_key, occurrence_key);

-- ---------------------------------------------------------------------
-- claim_email_delivery: now also stores the occurrence key. Signature
-- change (new required parameter) is safe -- this function has exactly
-- one caller, lib/email/send.ts#sendEmailEvent, updated in the same
-- change.
-- ---------------------------------------------------------------------
drop function if exists public.claim_email_delivery(text, text, text, uuid, text, uuid, text);

create function public.claim_email_delivery(
  p_event_key text,
  p_idempotency_key text,
  p_occurrence_key text,
  p_recipient_kind text,
  p_recipient_ref uuid default null,
  p_recipient_email text default null,
  p_club_id uuid default null,
  p_subject text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Email delivery may only be claimed by an authenticated session.' using errcode = '42501';
  end if;

  insert into public.email_deliveries (
    event_key, idempotency_key, occurrence_key, recipient_kind, recipient_ref,
    recipient_email, club_id, subject
  )
  values (
    p_event_key, p_idempotency_key, p_occurrence_key, p_recipient_kind, p_recipient_ref,
    p_recipient_email, p_club_id, p_subject
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.claim_email_delivery(text, text, text, text, uuid, text, uuid, text) from public, anon;
grant execute on function public.claim_email_delivery(text, text, text, text, uuid, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- claim_test_email_send: same occurrence_key treatment. A test send's
-- idempotency_key (site_admin_test:<uuid>) is already unique per send, so
-- occurrence_key equals it -- a test send is always exactly one occurrence
-- and one recipient delivery, by construction.
-- ---------------------------------------------------------------------
create or replace function public.claim_test_email_send(
  p_event_key text,
  p_recipient_email text,
  p_subject text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_id uuid;
  v_recent integer;
  v_key text;
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may send a test email.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.email_events where event_key = p_event_key) then
    raise exception 'That is not an email Ovalball sends.';
  end if;

  select count(*) into v_recent
  from public.email_deliveries
  where initiated_by = auth.uid()
    and recipient_kind = 'site_admin_test'
    and queued_at > now() - interval '10 minutes';
  if v_recent >= 6 then
    raise exception 'Too many test emails sent recently. Please wait a few minutes and try again.' using errcode = '42501';
  end if;

  v_key := 'site_admin_test:' || gen_random_uuid()::text;

  insert into public.email_deliveries (
    event_key, idempotency_key, occurrence_key, recipient_kind, recipient_email, subject, initiated_by
  )
  values (
    p_event_key, v_key, v_key, 'site_admin_test', p_recipient_email, p_subject, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- email_event_active: the READ side of the switch. Callable by any
-- authenticated session -- sending mail happens under whichever ordinary
-- user session triggered the domain event (a coach cancelling a fixture),
-- never a Site Admin one, so this cannot require Site Admin authority.
-- Whether an email is switched on is operational metadata, not a secret.
-- ---------------------------------------------------------------------
create or replace function public.email_event_active(p_event_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select active from public.email_events where event_key = p_event_key), false);
$$;

revoke execute on function public.email_event_active(text) from public, anon;
grant execute on function public.email_event_active(text) to authenticated;

-- ---------------------------------------------------------------------
-- claim_disabled_email_suppression: records that an occurrence happened
-- and its channel was off -- ONE row per occurrence, before recipient
-- resolution, so no recipient PII is ever read for a send that will not
-- happen. Idempotent on occurrence_key exactly like a real send is
-- idempotent on idempotency_key: a domain action retried (or a duplicate
-- trigger) records the suppression once.
-- ---------------------------------------------------------------------
create or replace function public.claim_disabled_email_suppression(
  p_event_key text,
  p_occurrence_key text,
  p_recipient_kind text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'A suppression may only be claimed by an authenticated session.' using errcode = '42501';
  end if;

  insert into public.email_deliveries (
    event_key, idempotency_key, occurrence_key, recipient_kind, recipient_email, subject, status, suppression_reason
  )
  values (
    p_event_key, p_occurrence_key, p_occurrence_key, p_recipient_kind, null, '(email channel disabled)', 'suppressed',
    'This email is currently switched off in Email Configuration.'
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.claim_disabled_email_suppression(text, text, text) from public, anon;
grant execute on function public.claim_disabled_email_suppression(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- set_email_event_active: the WRITE side. Full Site Admin only, refuses
-- for any classification but OPTIONAL_OPERATIONAL, optimistic-locked
-- exactly like the template registry's own save/publish functions, and
-- writes the audit row in the same transaction as the state change so the
-- two can never disagree.
-- ---------------------------------------------------------------------
create or replace function public.set_email_event_active(
  p_event_key text,
  p_active boolean,
  p_expected_lock int
)
returns void
language plpgsql
volatile
security definer
set search_path = public, internal
as $$
declare
  v_event public.email_events;
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin may change whether an email is switched on.' using errcode = '42501';
  end if;

  select * into v_event from public.email_events where event_key = p_event_key for update;
  if not found then
    raise exception 'That is not an email Ovalball sends.';
  end if;

  if v_event.classification <> 'OPTIONAL_OPERATIONAL' then
    raise exception 'Only an optional operational email can be switched off. "%" is % mail and always sends.', p_event_key, v_event.classification;
  end if;

  if v_event.lock_version <> p_expected_lock then
    raise exception 'This email''s status has been changed by someone else since you opened it. Reload to see the current state.';
  end if;

  if v_event.active = p_active then
    return; -- Already in the requested state; nothing to change or audit.
  end if;

  insert into public.email_delivery_policy_audit (event_key, previous_active, new_active, changed_by)
  values (p_event_key, v_event.active, p_active, auth.uid());

  update public.email_events
  set active = p_active, lock_version = lock_version + 1, updated_by = auth.uid(), updated_at = now()
  where event_key = p_event_key;
end;
$$;

revoke execute on function public.set_email_event_active(text, boolean, int) from public, anon;
grant execute on function public.set_email_event_active(text, boolean, int) to authenticated;

-- ---------------------------------------------------------------------
-- email_usage_summary: ONE set-based aggregate query for the whole
-- inventory page, grouped by event_key, bounded by an optional window --
-- never a query per email type, never rows shipped to the browser to be
-- counted in React. Every registered event appears even with zero sends
-- (LEFT JOIN from email_events), so the inventory shows the complete
-- transactional-email estate, not just what has ever fired.
-- ---------------------------------------------------------------------
create or replace function public.email_usage_summary(
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns table (
  event_key text,
  send_occurrences bigint,
  recipient_deliveries bigint,
  provider_accepted bigint,
  failed bigint,
  suppressed bigint,
  test_sends bigint,
  last_sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, internal
as $$
begin
  -- Viewing usage follows the same authority as Email Configuration itself
  -- (any Site Admin, narrow or full, may read) -- not the narrower
  -- Full-Site-Admin-only bar the write side (set_email_event_active) needs.
  if not internal.is_site_admin() then
    raise exception 'Site Admin access is required to view email usage.' using errcode = '42501';
  end if;

  return query
  select
    e.event_key,
    coalesce(count(distinct d.occurrence_key) filter (where d.recipient_kind <> 'site_admin_test'), 0) as send_occurrences,
    coalesce(count(*) filter (where d.recipient_kind <> 'site_admin_test' and d.recipient_email is not null), 0) as recipient_deliveries,
    coalesce(count(*) filter (where d.recipient_kind <> 'site_admin_test' and d.status = 'sent'), 0) as provider_accepted,
    coalesce(count(*) filter (where d.recipient_kind <> 'site_admin_test' and d.status = 'failed'), 0) as failed,
    coalesce(count(*) filter (where d.recipient_kind <> 'site_admin_test' and d.status = 'suppressed'), 0) as suppressed,
    coalesce(count(*) filter (where d.recipient_kind = 'site_admin_test'), 0) as test_sends,
    max(d.queued_at) filter (where d.recipient_kind <> 'site_admin_test' and d.status = 'sent') as last_sent_at
  from public.email_events e
  left join public.email_deliveries d
    on d.event_key = e.event_key
    and (p_since is null or d.queued_at >= p_since)
    and (p_until is null or d.queued_at < p_until)
  group by e.event_key;
end;
$$;

revoke execute on function public.email_usage_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.email_usage_summary(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- email_recent_deliveries: a BOUNDED history for one event's detail page
-- (default 20 rows -- never an unbounded dump). The recipient address is
-- masked to first-character-plus-domain for every row except the viewing
-- Site Admin's own test sends, where showing the address they just typed
-- in for themselves adds friction without protecting anyone. A
-- policy-suppressed row (no recipient was ever resolved) shows no
-- destination at all, because there genuinely isn't one.
-- ---------------------------------------------------------------------
create or replace function public.email_recent_deliveries(
  p_event_key text,
  p_limit int default 20
)
returns table (
  id uuid,
  queued_at timestamptz,
  status text,
  recipient_kind text,
  is_test boolean,
  destination text,
  provider text,
  provider_reference text,
  error_code text
)
language plpgsql
stable
security definer
set search_path = public, internal
as $$
begin
  if not internal.is_site_admin() then
    raise exception 'Site Admin access is required to view email delivery history.' using errcode = '42501';
  end if;

  return query
  select
    d.id,
    d.queued_at,
    d.status,
    d.recipient_kind,
    d.recipient_kind = 'site_admin_test' as is_test,
    case
      when d.recipient_email is null then null
      when d.recipient_kind = 'site_admin_test' then d.recipient_email
      else left(d.recipient_email, 1) || '***@' || split_part(d.recipient_email, '@', 2)
    end as destination,
    d.provider,
    d.provider_reference,
    d.error_code
  from public.email_deliveries d
  where d.event_key = p_event_key
  order by d.queued_at desc
  limit least(coalesce(p_limit, 20), 100);
end;
$$;

revoke execute on function public.email_recent_deliveries(text, int) from public, anon;
grant execute on function public.email_recent_deliveries(text, int) to authenticated;

commit;
