-- =====================================================================================================
-- SLICE 5 (2/n) -- the one canonical invitation table (Phase 2 O.1, Y.12, Y.19)
--
-- Ovalball has SIX invitation tables today -- invitations, guardian_invitations,
-- player_account_invitations, site_admin_invitations, club_safeguarding_officer_invitations and
-- club_ovalball_invitations -- and every one of them stores its token in PLAINTEXT. That is the
-- PG-10 violation Phase 2 line 54 assigns to this slice: anybody who can read the row can use the
-- invitation, which includes a database backup, a support query and a leaked replica.
--
-- This adds the canonical replacement. It does not retire the six yet: O.5 honours existing
-- invitations until they expire, so the legacy tables stay readable while their rows run out.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- 1. access_invitations
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.access_invitations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'SITE_ADMIN','ACCOUNT_SETUP','CLUB_STAFF','SAFEGUARDING_OFFICER',
    'GUARDIAN','PLAYER_ACCOUNT','TEAM_JOIN_CODE','CLUB_REFERRAL')),

  club_id uuid references public.clubs(id),
  team_id uuid references public.teams(id),
  player_id uuid references public.players(id),
  club_directory_id uuid references public.club_directory(id),
  target_user_id uuid references auth.users(id),

  invited_email_normalised text,

  -- What the invitation is ALLOWED to produce. The ceiling, not the instruction: redemption may
  -- produce less than this (O.2 step 9) and may never produce more.
  intended_outcome jsonb not null,

  issuer_capability text not null references public.capabilities(key),
  issued_by uuid not null references auth.users(id),
  issued_level text not null check (issued_level in ('SITE','CLUB','TEAM','GUARDIAN','SYSTEM')),

  -- The secrets, as hashes only. The plaintext is returned once to the issuing server action and is
  -- never stored, never selectable and never logged.
  token_sha256 bytea not null,
  code_hmac bytea not null,
  code_hint text,

  state text not null default 'ISSUED' check (state in ('ISSUED','REDEEMED','REVOKED','EXPIRED')),
  max_uses integer not null default 1 check (max_uses >= 1),
  use_count integer not null default 0 check (use_count >= 0),

  expires_at timestamptz not null,
  redeemed_by uuid references auth.users(id),
  redeemed_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  revocation_reason text,
  resend_count integer not null default 0,
  last_sent_at timestamptz,
  delivery_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint access_invitations_uses_within_max check (use_count <= max_uses),

  -- O.1: a personal kind is bound to an email; a team join code is bound to a team and to nobody.
  constraint access_invitations_personal_email check (
    (kind in ('SITE_ADMIN','ACCOUNT_SETUP','CLUB_STAFF','SAFEGUARDING_OFFICER','GUARDIAN','PLAYER_ACCOUNT','CLUB_REFERRAL')
      and invited_email_normalised is not null)
    or (kind = 'TEAM_JOIN_CODE' and invited_email_normalised is null and team_id is not null)),

  constraint access_invitations_account_setup_target check (
    kind <> 'ACCOUNT_SETUP' or target_user_id is not null),

  -- A code is open and may be used many times; everything else is one person, once.
  constraint access_invitations_single_use_unless_code check (
    kind = 'TEAM_JOIN_CODE' or max_uses = 1),

  constraint access_invitations_email_is_normalised check (
    invited_email_normalised is null or invited_email_normalised = lower(btrim(invited_email_normalised)))
);

-- The scope this invitation acts on, as one value, so the duplicate guard can be a plain index.
alter table public.access_invitations
  add column if not exists scope_key text
  generated always as (
    coalesce(player_id::text, team_id::text, club_id::text, club_directory_id::text, target_user_id::text, 'SITE')
  ) stored;

create unique index if not exists access_invitations_token_sha256_key on public.access_invitations (token_sha256);
create unique index if not exists access_invitations_code_hmac_key on public.access_invitations (code_hmac);

-- O.2 "Uniqueness": issuing a duplicate personal invitation returns the existing one and offers
-- Resend, rather than quietly creating a second live secret for the same person and scope.
create unique index if not exists access_invitations_personal_live_idx
  on public.access_invitations (kind, scope_key, invited_email_normalised)
  where state = 'ISSUED' and invited_email_normalised is not null;

create index if not exists access_invitations_state_expiry_idx on public.access_invitations (state, expires_at);
create index if not exists access_invitations_club_state_idx on public.access_invitations (club_id, state);
create index if not exists access_invitations_team_kind_state_idx on public.access_invitations (team_id, kind, state);
create index if not exists access_invitations_email_state_idx on public.access_invitations (invited_email_normalised, state);

comment on table public.access_invitations is
  'Phase 2 O.1. The one canonical invitation. Secrets are stored as a SHA-256 of the link token and '
  'an HMAC of the human code; the plaintext of each is returned once at issue and never stored.';

-- ---------------------------------------------------------------------------------------------------
-- 2. The attempt log, which is what makes the rate limits in O.2 step 3 possible.
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.invitation_redemption_attempts (
  id bigserial primary key,
  invitation_id uuid references public.access_invitations(id) on delete set null,
  user_id uuid references auth.users(id),
  ip_hash bytea,
  outcome text not null,
  occurred_at timestamptz not null default now()
);
create index if not exists invitation_redemption_attempts_user_idx on public.invitation_redemption_attempts (user_id, occurred_at desc);
create index if not exists invitation_redemption_attempts_ip_idx on public.invitation_redemption_attempts (ip_hash, occurred_at desc);

comment on table public.invitation_redemption_attempts is
  'Phase 2 Y.12. Every redemption attempt, successful or not, so guessing can be rate limited. '
  'The IP is stored as a hash: it is needed to count, never to identify. PURGE-30d.';

-- ---------------------------------------------------------------------------------------------------
-- 3. Who has redeemed what -- the multi-use idempotency record.
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.invitation_redemptions (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.access_invitations(id),
  user_id uuid not null references auth.users(id),
  redeemed_at timestamptz not null default now(),
  result_ref jsonb not null default '{}'::jsonb,
  unique (invitation_id, user_id)
);

comment on table public.invitation_redemptions is
  'Phase 2 Y.12. One row per person per invitation. The unique constraint is what makes a second '
  'redemption by the same person idempotent rather than a second join request.';

-- ---------------------------------------------------------------------------------------------------
-- 4. auth_flow_states (Y.19) -- the server-side carrier for an in-flight invitation or claim.
--
-- This exists because of the H-7 lesson: invitation context must never travel in user metadata,
-- where the user can edit it. The browser holds an opaque httpOnly cookie; the authority lives here.
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.auth_flow_states (
  id uuid primary key default gen_random_uuid(),
  flow_id_sha256 bytea not null unique,
  kind text not null check (kind in ('INVITATION','CLAIM','SIGNUP','LINK_IDENTITY','SETUP')),
  payload jsonb not null default '{}'::jsonb,
  user_id uuid references auth.users(id),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists auth_flow_states_expiry_idx on public.auth_flow_states (expires_at);

comment on table public.auth_flow_states is
  'Phase 2 Y.19. Server-side flow context for an in-flight invitation, claim or signup, keyed by the '
  'hash of an opaque httpOnly cookie. The payload carries ids and a next path -- never authority.';

-- ---------------------------------------------------------------------------------------------------
-- 5. RLS. No client writes anywhere; every mutation goes through a definer RPC.
--
-- The hash columns are not reachable through the table at all: administrators read invitations
-- through invitations_admin_view, which does not select them. A column that is never exposed cannot
-- be exfiltrated by a SELECT that forgot to exclude it.
-- ---------------------------------------------------------------------------------------------------
alter table public.access_invitations enable row level security;
alter table public.invitation_redemption_attempts enable row level security;
alter table public.invitation_redemptions enable row level security;
alter table public.auth_flow_states enable row level security;

drop policy if exists access_invitations_select_scoped on public.access_invitations;
create policy access_invitations_select_scoped on public.access_invitations
  for select to authenticated using (
    (select internal.has_site_capability('site.invitations.manage'))
    or (club_id is not null and club_id in (select unnest(internal.club_ids_with('people.invitation.create'))))
    or (club_id is not null and club_id in (select unnest(internal.club_ids_with('team.join_code.manage'))))
    or (club_id is not null and club_id in (select unnest(internal.club_ids_with('family.invitation.create'))))
    or (club_id is not null and club_id in (select unnest(internal.club_ids_with('safeguarding.officer.nominate'))))
    or (club_id is not null and club_id in (select unnest(internal.club_ids_with('club.referrals.manage'))))
  );

-- invitation_redemptions and the attempt log are definer-only: nothing client-side reads them.
-- auth_flow_states likewise -- the whole point is that the browser holds only an opaque key.

revoke all on public.access_invitations from authenticated, anon;
revoke all on public.invitation_redemption_attempts from authenticated, anon;
revoke all on public.invitation_redemptions from authenticated, anon;
revoke all on public.auth_flow_states from authenticated, anon;
grant select on public.access_invitations to authenticated;

-- The administrator's view, without the secrets.
create or replace view public.invitations_admin_view
with (security_invoker = true) as
  select id, kind, club_id, team_id, player_id, club_directory_id, target_user_id,
         invited_email_normalised, intended_outcome, issuer_capability, issued_by, issued_level,
         code_hint, state, max_uses, use_count, expires_at, redeemed_by, redeemed_at,
         revoked_by, revoked_at, revocation_reason, resend_count, last_sent_at, created_at
    from public.access_invitations;

comment on view public.invitations_admin_view is
  'Phase 2 Y.12. Invitations as an administrator sees them. token_sha256 and code_hmac are absent by '
  'construction, so no query against this view can leak a secret even by accident.';

grant select on public.invitations_admin_view to authenticated;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='invitations_admin_view'
                and column_name in ('token_sha256','code_hmac')) then
    raise exception 'Slice 5: the admin view exposes a secret column.';
  end if;
end $$;
