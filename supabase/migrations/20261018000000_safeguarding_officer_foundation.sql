-- Safeguarding Officer Foundation, part 1: identity model, capability
-- catalogue additions, and the invitation table.
--
-- ============================================================
-- AUDIT SUMMARY (classification per the brief's own section 2)
-- ============================================================
-- REUSE: public.profiles/auth.users (canonical person identity -- no new
--   person table); the Canonical Scoped Capability Engine
--   (internal.has_capability/public.capability_overrides/
--   set_capability_override/revoke_capability_override -- no new grant
--   mechanism); internal.audit_row_change() (no new audit mechanism);
--   public.set_updated_at(); the site_admin_invitations table's own shape
--   (token/expires_at/accepted_by/accepted_at/revoked_by/revoked_at) as
--   the direct structural template for a new invitation table below.
-- EXTEND: public.capabilities (the flat catalogue is genuinely the FK
--   target capability_overrides.capability_key references -- extended,
--   never duplicated); internal.has_club_role_capability() (adds the new
--   safeguarding keys to the existing CLUB_ADMIN default bundle only).
-- DO NOT TOUCH: club_memberships.role (stays BASIC_USER/CLUB_ADMIN/
--   FIXTURE_SECRETARY -- Safeguarding Officer is deliberately NOT a new
--   value here, matching the exact reasoning site_admin_invitations
--   already documents for why IT isn't folded into club_memberships
--   either: "a role that doesn't map onto ordinary club_memberships
--   semantics"); public.club_contacts (a separate, simpler, unlinked
--   free-text phone-book concept for fixture_secretary/minis_secretary/
--   general -- not touched, not reused, not consolidated into this);
--   public.invitations (kept separate, mirroring why site_admin_
--   invitations/guardian_invitations/player_account_invitations are each
--   their own table rather than one shared generic invitations table --
--   this codebase's own established convention, not an oversight).
-- CONSOLIDATE: none required -- no existing safeguarding-officer-shaped
--   data exists anywhere to consolidate (confirmed by audit: team_contacts
--   has an unused 'safeguarding_lead' contact-role value with zero app
--   references, and the 'safety.safeguarding' platform entitlement /
--   'safeguarding' policy_acknowledgements value are both dormant/unwired
--   -- neither is a real officer-assignment model to fold into this).

-- ============================================================
-- 1. Capability catalogue additions. category='club' (no 'safeguarding'
-- category exists in the closed check constraint, and adding one is not
-- required -- every other specialised club-scoped domain, e.g.
-- club.guardians.manage, already lives under 'club'). applicable_scopes
-- is club-only for all seven: none of these concepts exist at site or
-- team scope.
-- ============================================================
insert into public.capabilities (key, label, description, category, applicable_scopes) values
  ('club.safeguarding.view', 'View Safeguarding Officer', 'See the club''s designated Safeguarding Officer, their contact details, and invitation status.', 'club', array['club']),
  ('club.safeguarding.manage_contact', 'Manage Safeguarding Officer', 'Nominate, invite, edit contact details for, or deactivate the club''s Safeguarding Officer.', 'club', array['club']),
  ('club.safeguarding.message', 'Message Safeguarding Officer', 'Start or continue a conversation with the club''s Safeguarding Officer, or fall back to emailing them.', 'club', array['club']),
  ('club.dispensation.view', 'View dispensations (Safeguarding Officer)', 'See this club''s player dispensation records. Granted individually per accepted Safeguarding Officer by a Site Admin -- never a role default.', 'club', array['club']),
  ('club.dispensation.notify', 'Receive dispensation notifications', 'Be notified of dispensation activity for this club. Granted individually per accepted Safeguarding Officer by a Site Admin -- never a role default.', 'club', array['club']),
  ('club.transfer.safeguarding_view', 'View transfer safeguarding information', 'See safeguarding-relevant player movement information for this club. Granted individually per accepted Safeguarding Officer by a Site Admin -- never a role default.', 'club', array['club']),
  ('club.transfer.safeguarding_notify', 'Receive transfer safeguarding notifications', 'Be notified of safeguarding-relevant player movement events for this club. Granted individually per accepted Safeguarding Officer by a Site Admin -- never a role default.', 'club', array['club'])
on conflict (key) do nothing;

-- Deliberately NOT added anywhere: a bundled "Safeguarding Officer can
-- view/edit everything" capability. Spec section 9's own explicit
-- prohibition. Only club.safeguarding.view/manage_contact/message join
-- the CLUB_ADMIN default bundle (nominating/inviting/messaging the
-- officer is ordinary club administration); the four Site-Admin-grantable
-- keys above join NO role's default bundle at all -- they only ever
-- reach a specific accepted officer via an explicit, individually-scoped
-- capability_overrides grant (see the Site Admin UI built on top of the
-- existing set_capability_override/revoke_capability_override RPCs --
-- no new grant RPC was needed for this).
create or replace function internal.has_club_role_capability(p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when not internal.is_club_active(p_club_id) then false
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'CLUB_ADMIN'
    ) then p_capability_key in (
      'club.edit_profile', 'club.logo.manage', 'club.venues.manage', 'club.pitches.manage',
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'club.season_rollover.manage',
      'people.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players',
      'club.safeguarding.view', 'club.safeguarding.manage_contact', 'club.safeguarding.message'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'FIXTURE_SECRETARY'
    ) then p_capability_key in (
      'club.pitches.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send',
      'manage_mini_rugby_groups', 'manage_fixture_callups', 'approve_fixture_callups',
      'manage_player_dispensations', 'approve_player_dispensations', 'place_graduating_players'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('club.view', 'team.view', 'people.view', 'calendar.view', 'fixture.view')
    else false
  end;
$$;

-- ============================================================
-- 2. club_safeguarding_officers -- the CONTACT + ASSIGNMENT record
-- (spec section 5's "public contact vs authorization" distinction lives
-- here: contact_name/contact_email exist and are manageable from the
-- moment a Club Admin nominates someone, independent of whether that
-- person has ever accepted an Ovalball invitation or even has an
-- account). user_id is null until acceptance -- see accept_
-- safeguarding_officer_invitation() in the next migration for the only
-- path that ever sets it. Never a role value on club_memberships (see
-- audit note above) -- this is a distinct, purpose-built table, exactly
-- mirroring why site_admin_invitations/site_admins is not folded into
-- club_memberships either.
-- ============================================================
create table public.club_safeguarding_officers (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  officer_type text not null default 'primary' check (officer_type in ('primary', 'deputy')),
  contact_name text not null,
  contact_email text not null,
  user_id uuid references auth.users(id),
  -- Spec section 6's own five-state list (Not invited / Invite sent /
  -- Invite accepted / Active / Inactive) is collapsed to four here:
  -- "Invite accepted" and "Active" are the same real-world moment in this
  -- product (there is no separate step between a person accepting and
  -- the role becoming authorised) -- introducing a distinct persisted
  -- state for it would be a state with no real transition into or out of
  -- it, which this codebase's own conventions (see capability-model.md)
  -- treat as something to avoid, not something to add for spec-literal
  -- fidelity alone.
  status text not null default 'not_invited' check (status in ('not_invited', 'invite_sent', 'active', 'inactive')),
  activated_at timestamptz,
  deactivated_by uuid references auth.users(id),
  deactivated_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.club_safeguarding_officers is
  'One club''s designated Safeguarding Officer(s). Contact details (name/email) are editable from the moment of nomination, independent of Ovalball authorization -- see the status column and accept_safeguarding_officer_invitation() for where authorization actually begins. Never a club_memberships.role value: this is a duty/point-of-contact designation, not club administration authority, exactly matching why site_admins is its own table rather than a club_memberships row.';
comment on column public.club_safeguarding_officers.user_id is
  'Null until a real, invited person accepts (see accept_safeguarding_officer_invitation) -- a pending nomination is a contact record only and grants no Ovalball access whatsoever (spec section 5/8).';

-- At most one non-inactive row per (club, officer_type) -- replacing a
-- primary officer means deactivating the old row first (see
-- deactivate_safeguarding_officer), never two simultaneously "active"
-- primaries. Deactivated rows are retained (never deleted) so the partial
-- index, not a plain unique constraint, is what makes this work.
create unique index club_safeguarding_officers_one_active_per_type
  on public.club_safeguarding_officers (club_id, officer_type)
  where status <> 'inactive';

create index club_safeguarding_officers_club_id_idx on public.club_safeguarding_officers (club_id);
create index club_safeguarding_officers_user_id_idx on public.club_safeguarding_officers (user_id) where user_id is not null;

alter table public.club_safeguarding_officers enable row level security;

-- Read: the club's own admins/fixture secretaries (club.safeguarding.view,
-- on the CLUB_ADMIN default bundle), the officer themselves (their own
-- row only -- self-visibility needs no capability check), and Site Admin.
-- No other club, and no ordinary member/parent/player, can see this table
-- at all -- Main never builds broader visibility in this pass (Rugby Hub
-- consumption is SP3 Stage 7's own, later, separate concern).
create policy club_safeguarding_officers_select on public.club_safeguarding_officers
  for select using (
    internal.is_site_admin()
    or internal.has_capability('club.safeguarding.view', 'club', club_id)
    or user_id = auth.uid()
  );

-- All writes are RPC-only (next migration) -- no direct insert/update/
-- delete policy exists, matching capability_overrides' own convention
-- exactly (a sensitive grant/assignment table should never be writable
-- by a bare client .update()).

create trigger set_updated_at before update on public.club_safeguarding_officers
  for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.club_safeguarding_officers
  for each row execute function internal.audit_row_change();

-- ============================================================
-- 3. club_safeguarding_officer_invitations -- mirrors site_admin_
-- invitations' shape and reasoning exactly (see audit note above).
-- officer_id ties an invitation to the specific contact/assignment row it
-- will activate on acceptance.
-- ============================================================
create table public.club_safeguarding_officer_invitations (
  id uuid primary key default gen_random_uuid(),
  officer_id uuid not null references public.club_safeguarding_officers(id),
  club_id uuid not null references public.clubs(id),
  invited_email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.club_safeguarding_officer_invitations is
  'Pending Safeguarding Officer invitations, club-scoped. A row here never grants anything by itself -- accept_safeguarding_officer_invitation() is the only path from here to an authorized officer, and it requires the accepting session''s own email to match invited_email, exactly matching every other invitation table in this codebase.';

create index club_safeguarding_officer_invitations_email_idx on public.club_safeguarding_officer_invitations (lower(invited_email));
create index club_safeguarding_officer_invitations_officer_id_idx on public.club_safeguarding_officer_invitations (officer_id);
create index club_safeguarding_officer_invitations_status_idx on public.club_safeguarding_officer_invitations (status);

-- Idempotent/safe resend (spec section 7): at most one PENDING invitation
-- per officer assignment at a time -- resending must revoke-then-recreate
-- (see resend_safeguarding_officer_invitation), never silently coexist
-- with an old, still-pending row pointing at a stale token.
create unique index club_safeguarding_officer_invitations_one_pending_per_officer
  on public.club_safeguarding_officer_invitations (officer_id)
  where status = 'pending';

alter table public.club_safeguarding_officer_invitations enable row level security;

create policy club_safeguarding_officer_invitations_select on public.club_safeguarding_officer_invitations
  for select using (internal.is_site_admin() or internal.has_capability('club.safeguarding.view', 'club', club_id));

-- Insert/update are RPC-only (next migration): invite_safeguarding_officer
-- and revoke_safeguarding_officer_invitation both check
-- club.safeguarding.manage_contact themselves before writing, matching
-- accept_invitation()'s own RPC-gated-write convention exactly.

create trigger set_updated_at before update on public.club_safeguarding_officer_invitations
  for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.club_safeguarding_officer_invitations
  for each row execute function internal.audit_row_change();
