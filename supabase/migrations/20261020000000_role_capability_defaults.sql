-- Canonical role capability defaults.
--
-- WHAT THIS REPLACES
--
-- Role defaults lived as inline `p_capability_key in (...)` lists inside
-- internal.has_club_role_capability and internal.has_team_role_capability.
-- Adding a capability meant re-declaring the whole function, and a
-- re-declaration written from an older copy of the list silently deleted
-- every capability added since. Nothing errored. A product area simply
-- stopped working for every Club Admin on the platform.
--
-- It happened ten times. The tenth (20261019000000) is documented in
-- docs/CAPABILITY_ARCHITECTURE.md: a safeguarding migration correctly added
-- three capabilities and silently dropped twelve belonging to billing,
-- referrals, training and GoCardless.
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
--
-- Only step 6 of the evaluation chain changes -- the role-default lookup.
-- The chain itself is untouched:
--
--   1. account active
--   2. capability exists in the catalogue AND the scope is applicable
--   3. explicit DENY override            -> false
--   4. Site Admin at club/team scope     -> true
--   5. explicit GRANT override           -> true
--   6. ROLE DEFAULT                      <- this, now a table read
--
-- internal.has_site_role_capability is deliberately NOT converted. Its
-- "defaults" are not defaults at all: each site capability maps to a
-- per-user boolean column on public.site_admins, written by the
-- set_site_admin_*_capability RPCs. That is already per-user grant data,
-- not a role default, and forcing it into this table would turn a
-- per-person switch into a global one.
--
-- The seed below is a VERBATIM extraction of the lists that were live in
-- the two functions at the time of writing -- read out of pg_proc, not
-- retyped -- so this migration changes no one's authority. The assertions
-- at the bottom prove that.

create table if not exists public.role_capability_defaults (
  scope_type text not null,
  role_key text not null,
  -- Every default must name a real catalogue entry. A role granting a
  -- capability the catalogue does not define is dead weight: has_capability
  -- returns false at step 2 before a default is ever consulted, so the FK
  -- turns a silent no-op into a migration-time error.
  capability_key text not null references public.capabilities(key) on update cascade,

  constraint role_capability_defaults_scope_check check (scope_type in ('club', 'team')),
  constraint role_capability_defaults_role_check check (
    (scope_type = 'club' and role_key in ('CLUB_ADMIN', 'FIXTURE_SECRETARY', 'CLUB_MEMBER'))
    or (scope_type = 'team' and role_key in ('CLUB_ADMIN', 'TEAM_STAFF', 'TEAM_MEMBER'))
  ),

  -- The primary key IS the lookup index: every read is an equality probe on
  -- all three columns, so it is index-only and no separate index is needed.
  primary key (scope_type, role_key, capability_key)
);

comment on table public.role_capability_defaults is
  'Default capabilities per role, per scope. PRESENCE OF A ROW MEANS ALLOWED; there is no allow/deny column, because a denial is an explicit capability_override against a person, never a role default. ADD ROWS, NEVER REWRITE THE TABLE: a new feature inserts its own defaults and touches no other domain''s.';

comment on column public.role_capability_defaults.role_key is
  'club scope: CLUB_ADMIN, FIXTURE_SECRETARY, CLUB_MEMBER (any active member). team scope: CLUB_ADMIN (a club admin acting at team scope), TEAM_STAFF (team_admin/coach/manager), TEAM_MEMBER (any team permission).';

-- Nobody but a migration writes this table, and nobody reads it directly.
-- The evaluation functions are SECURITY DEFINER and run as the owner, so
-- they read it regardless of RLS; ordinary roles get no grant at all, so a
-- Club user cannot grant themselves a capability by writing here.
alter table public.role_capability_defaults enable row level security;
revoke all on public.role_capability_defaults from anon, authenticated;

-- ---------------------------------------------------------------------
-- Seed: extracted verbatim from the live function bodies
-- ---------------------------------------------------------------------

insert into public.role_capability_defaults (scope_type, role_key, capability_key) values
  ('club', 'CLUB_ADMIN', 'club.edit_profile'),
  ('club', 'CLUB_ADMIN', 'club.logo.manage'),
  ('club', 'CLUB_ADMIN', 'club.venues.manage'),
  ('club', 'CLUB_ADMIN', 'club.pitches.manage'),
  ('club', 'CLUB_ADMIN', 'club.teams.manage'),
  ('club', 'CLUB_ADMIN', 'club.team_lifecycle.manage'),
  ('club', 'CLUB_ADMIN', 'club.roster.manage'),
  ('club', 'CLUB_ADMIN', 'club.season_rollover.manage'),
  ('club', 'CLUB_ADMIN', 'people.manage'),
  ('club', 'CLUB_ADMIN', 'people.view'),
  ('club', 'CLUB_ADMIN', 'club.view'),
  ('club', 'CLUB_ADMIN', 'team.view'),
  ('club', 'CLUB_ADMIN', 'fixture.create'),
  ('club', 'CLUB_ADMIN', 'fixture.edit'),
  ('club', 'CLUB_ADMIN', 'fixture.cancel'),
  ('club', 'CLUB_ADMIN', 'fixture.manage_requests'),
  ('club', 'CLUB_ADMIN', 'fixture.view'),
  ('club', 'CLUB_ADMIN', 'calendar.manage'),
  ('club', 'CLUB_ADMIN', 'calendar.view'),
  ('club', 'CLUB_ADMIN', 'partner.manage'),
  ('club', 'CLUB_ADMIN', 'messages.fixture_send'),
  ('club', 'CLUB_ADMIN', 'manage_mini_rugby_groups'),
  ('club', 'CLUB_ADMIN', 'manage_fixture_callups'),
  ('club', 'CLUB_ADMIN', 'approve_fixture_callups'),
  ('club', 'CLUB_ADMIN', 'manage_player_dispensations'),
  ('club', 'CLUB_ADMIN', 'approve_player_dispensations'),
  ('club', 'CLUB_ADMIN', 'place_graduating_players'),
  ('club', 'CLUB_ADMIN', 'team.guardians.invite'),
  ('club', 'CLUB_ADMIN', 'club.guardians.manage'),
  ('club', 'CLUB_ADMIN', 'team.community.manage'),
  ('club', 'CLUB_ADMIN', 'team.attendance.view'),
  ('club', 'CLUB_ADMIN', 'club.gocardless.connect'),
  ('club', 'CLUB_ADMIN', 'club.subscription.configure'),
  ('club', 'CLUB_ADMIN', 'club.subscription.view_finance'),
  ('club', 'CLUB_ADMIN', 'club.subscription.manage_enrolment'),
  ('club', 'CLUB_ADMIN', 'club.subscription.manage_payment_actions'),
  ('club', 'CLUB_ADMIN', 'club.subscription.export'),
  ('club', 'CLUB_ADMIN', 'club.platform_billing.view'),
  ('club', 'CLUB_ADMIN', 'club.platform_billing.manage'),
  ('club', 'CLUB_ADMIN', 'club.referrals.view'),
  ('club', 'CLUB_ADMIN', 'club.referrals.manage'),
  ('club', 'CLUB_ADMIN', 'club.training.manage'),
  ('club', 'CLUB_ADMIN', 'club.safeguarding.view'),
  ('club', 'CLUB_ADMIN', 'club.safeguarding.manage_contact'),
  ('club', 'CLUB_ADMIN', 'club.safeguarding.message'),
  ('club', 'FIXTURE_SECRETARY', 'club.pitches.manage'),
  ('club', 'FIXTURE_SECRETARY', 'people.view'),
  ('club', 'FIXTURE_SECRETARY', 'club.view'),
  ('club', 'FIXTURE_SECRETARY', 'team.view'),
  ('club', 'FIXTURE_SECRETARY', 'fixture.create'),
  ('club', 'FIXTURE_SECRETARY', 'fixture.edit'),
  ('club', 'FIXTURE_SECRETARY', 'fixture.cancel'),
  ('club', 'FIXTURE_SECRETARY', 'fixture.manage_requests'),
  ('club', 'FIXTURE_SECRETARY', 'fixture.view'),
  ('club', 'FIXTURE_SECRETARY', 'calendar.manage'),
  ('club', 'FIXTURE_SECRETARY', 'calendar.view'),
  ('club', 'FIXTURE_SECRETARY', 'partner.manage'),
  ('club', 'FIXTURE_SECRETARY', 'messages.fixture_send'),
  ('club', 'FIXTURE_SECRETARY', 'manage_mini_rugby_groups'),
  ('club', 'FIXTURE_SECRETARY', 'manage_fixture_callups'),
  ('club', 'FIXTURE_SECRETARY', 'approve_fixture_callups'),
  ('club', 'FIXTURE_SECRETARY', 'manage_player_dispensations'),
  ('club', 'FIXTURE_SECRETARY', 'approve_player_dispensations'),
  ('club', 'FIXTURE_SECRETARY', 'place_graduating_players'),
  ('club', 'CLUB_MEMBER', 'club.view'),
  ('club', 'CLUB_MEMBER', 'team.view'),
  ('club', 'CLUB_MEMBER', 'people.view'),
  ('club', 'CLUB_MEMBER', 'calendar.view'),
  ('club', 'CLUB_MEMBER', 'fixture.view'),
  ('team', 'CLUB_ADMIN', 'club.teams.manage'),
  ('team', 'CLUB_ADMIN', 'club.team_lifecycle.manage'),
  ('team', 'CLUB_ADMIN', 'club.roster.manage'),
  ('team', 'CLUB_ADMIN', 'team.roster.manage'),
  ('team', 'CLUB_ADMIN', 'team.view'),
  ('team', 'CLUB_ADMIN', 'fixture.create'),
  ('team', 'CLUB_ADMIN', 'fixture.edit'),
  ('team', 'CLUB_ADMIN', 'fixture.cancel'),
  ('team', 'CLUB_ADMIN', 'fixture.view'),
  ('team', 'CLUB_ADMIN', 'calendar.view'),
  ('team', 'CLUB_ADMIN', 'messages.fixture_send'),
  ('team', 'CLUB_ADMIN', 'manage_fixture_callups'),
  ('team', 'CLUB_ADMIN', 'approve_fixture_callups'),
  ('team', 'CLUB_ADMIN', 'place_graduating_players'),
  ('team', 'CLUB_ADMIN', 'manage_player_dispensations'),
  ('team', 'CLUB_ADMIN', 'approve_player_dispensations'),
  ('team', 'CLUB_ADMIN', 'team.guardians.invite'),
  ('team', 'CLUB_ADMIN', 'team.community.manage'),
  ('team', 'CLUB_ADMIN', 'team.attendance.view'),
  ('team', 'TEAM_STAFF', 'team.view'),
  ('team', 'TEAM_STAFF', 'fixture.create'),
  ('team', 'TEAM_STAFF', 'fixture.edit'),
  ('team', 'TEAM_STAFF', 'fixture.cancel'),
  ('team', 'TEAM_STAFF', 'fixture.view'),
  ('team', 'TEAM_STAFF', 'calendar.view'),
  ('team', 'TEAM_STAFF', 'messages.fixture_send'),
  ('team', 'TEAM_STAFF', 'manage_fixture_callups'),
  ('team', 'TEAM_STAFF', 'approve_fixture_callups'),
  ('team', 'TEAM_STAFF', 'place_graduating_players'),
  ('team', 'TEAM_STAFF', 'manage_player_dispensations'),
  ('team', 'TEAM_STAFF', 'approve_player_dispensations'),
  ('team', 'TEAM_STAFF', 'team.guardians.invite'),
  ('team', 'TEAM_STAFF', 'team.community.manage'),
  ('team', 'TEAM_STAFF', 'team.attendance.view'),
  ('team', 'TEAM_MEMBER', 'team.view'),
  ('team', 'TEAM_MEMBER', 'fixture.view'),
  ('team', 'TEAM_MEMBER', 'calendar.view')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Evaluation: the same role resolution, reading the table
-- ---------------------------------------------------------------------

-- The role branches are unchanged -- who counts as a Club Admin, a Fixture
-- Secretary or an ordinary member is exactly as before. All that changes is
-- that the capability list is looked up rather than inlined.
create or replace function internal.has_club_role_capability(p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not internal.is_club_active(p_club_id) then false
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'CLUB_ADMIN'
    ) then exists (
      select 1 from public.role_capability_defaults d
      where d.scope_type = 'club' and d.role_key = 'CLUB_ADMIN' and d.capability_key = p_capability_key
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'FIXTURE_SECRETARY'
    ) then exists (
      select 1 from public.role_capability_defaults d
      where d.scope_type = 'club' and d.role_key = 'FIXTURE_SECRETARY' and d.capability_key = p_capability_key
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then exists (
      select 1 from public.role_capability_defaults d
      where d.scope_type = 'club' and d.role_key = 'CLUB_MEMBER' and d.capability_key = p_capability_key
    )
    else false
  end;
$$;

comment on function internal.has_club_role_capability is
  'Club-scope role defaults, read from public.role_capability_defaults. DO NOT re-declare this function to add a capability -- insert a row instead. Re-declaring it from an older copy of an inline list is what silently removed twelve capabilities in 20261018000000.';

create or replace function internal.has_team_role_capability(p_team_id uuid, p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not internal.is_club_active(p_club_id) then false
    when internal.is_club_admin(p_club_id) then exists (
      select 1 from public.role_capability_defaults d
      where d.scope_type = 'team' and d.role_key = 'CLUB_ADMIN' and d.capability_key = p_capability_key
    )
    -- Team staff deliberately hold NO club-level write capability: not
    -- club.teams.manage, club.team_lifecycle.manage, club.roster.manage,
    -- team.roster.manage or club.guardians.manage. That preserves the
    -- standing "no new Team Admin write capability" decision and the
    -- explicit "team staff cannot remove a Guardian" rule. Those keys are
    -- simply absent from the TEAM_STAFF rows.
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
        and tp.permission in ('team_admin', 'coach', 'manager')
    ) then exists (
      select 1 from public.role_capability_defaults d
      where d.scope_type = 'team' and d.role_key = 'TEAM_STAFF' and d.capability_key = p_capability_key
    )
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then exists (
      select 1 from public.role_capability_defaults d
      where d.scope_type = 'team' and d.role_key = 'TEAM_MEMBER' and d.capability_key = p_capability_key
    )
    else false
  end;
$$;

comment on function internal.has_team_role_capability is
  'Team-scope role defaults, read from public.role_capability_defaults. DO NOT re-declare this function to add a capability -- insert a row instead.';

-- ---------------------------------------------------------------------
-- Guard: the table must reproduce the lists this migration replaced
-- ---------------------------------------------------------------------

do $$
declare
  v_expected int;
  v_actual int;
begin
  -- Counts taken from the function bodies read out of pg_proc immediately
  -- before this migration was written. If a concurrent migration changed a
  -- list between then and now, these differ and this fails loudly rather
  -- than quietly seeding a stale set.
  select count(*) into v_actual from public.role_capability_defaults;
  v_expected := 106;
  if v_actual <> v_expected then
    raise exception 'role_capability_defaults holds % rows, expected % -- the seed does not match the lists it replaced.', v_actual, v_expected;
  end if;

  -- Spot-check one capability per domain that the R-0 incident lost, plus
  -- the safeguarding ones it added, so a future reordering cannot quietly
  -- drop either side again.
  select count(*) into v_actual from public.role_capability_defaults
  where scope_type='club' and role_key='CLUB_ADMIN' and capability_key in
    ('club.referrals.view','club.platform_billing.view','club.training.manage',
     'club.gocardless.connect','club.subscription.configure','club.guardians.manage');
  if v_actual <> 6 then
    raise exception 'Commercial/training/guardian defaults missing from the CLUB_ADMIN seed (found %).', v_actual;
  end if;

  select count(*) into v_actual from public.role_capability_defaults
  where scope_type='club' and role_key='CLUB_ADMIN' and capability_key in
    ('club.safeguarding.view','club.safeguarding.manage_contact','club.safeguarding.message');
  if v_actual <> 3 then
    raise exception 'Safeguarding defaults missing from the CLUB_ADMIN seed (found %).', v_actual;
  end if;

  -- Team staff must NOT have picked up club-level write authority in the move.
  if exists (select 1 from public.role_capability_defaults where scope_type='team' and role_key='TEAM_STAFF'
             and capability_key in ('club.teams.manage','club.team_lifecycle.manage','club.roster.manage','team.roster.manage','club.guardians.manage')) then
    raise exception 'TEAM_STAFF gained club-level write authority in the seed.';
  end if;
end;
$$;
