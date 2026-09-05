-- SECURITY FIX: the capability engine's role-bundle functions
-- (has_club_role_capability / has_team_role_capability) never checked
-- whether the CLUB ITSELF is active -- only whether the caller's
-- club_memberships row is active. The pre-existing legacy authorization
-- functions this session's capability engine was meant to be equivalent
-- to (internal.is_club_admin, internal.can_manage_club_fixtures,
-- internal.can_manage_team) all gate on internal.is_club_active(club_id)
-- as well. club deactivation and membership suspension are two
-- independently-settable states in this schema (confirmed live: two real
-- seed rows have an active, non-suspended CLUB_ADMIN membership at a
-- deactivated club) -- nothing enforces they move together.
--
-- Found during a cross-role permission/data audit requested this pass:
-- temporarily deactivating a real club (Rossendale RUFC) with its real,
-- untouched Club Admin membership showed internal.is_club_admin() and
-- internal.can_manage_club_fixtures() correctly returning false, while
-- internal.has_capability('club.edit_profile', 'club', ...) and
-- has_capability('fixture.create', 'club', ...) incorrectly returned
-- true. Every capability already migrated onto the engine this session
-- (Season Rollover, and this pass's own Schedule Training / fixture.create
-- migration) inherited this gap. Fixed at the source -- both role-bundle
-- functions -- so every current and future capability consumer is
-- covered, not patched capability-by-capability.
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
    ) then p_capability_key in (
      'club.edit_profile', 'club.logo.manage', 'club.venues.manage', 'club.pitches.manage',
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'club.season_rollover.manage',
      'people.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'FIXTURE_SECRETARY'
    ) then p_capability_key in (
      'club.pitches.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('club.view', 'team.view', 'people.view', 'calendar.view', 'fixture.view')
    else false
  end;
$$;

create or replace function internal.has_team_role_capability(p_team_id uuid, p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not internal.is_club_active(p_club_id) then false
    when internal.is_club_admin(p_club_id) then p_capability_key in (
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'team.roster.manage',
      'team.view', 'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.view', 'calendar.view', 'messages.fixture_send'
    )
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
        and tp.permission in ('team_admin', 'coach', 'manager')
    ) then p_capability_key in (
      -- Deliberately NOT club.teams.manage / club.team_lifecycle.manage /
      -- club.roster.manage / team.roster.manage -- preserves the standing
      -- "no new Team Admin write capability granted" decision. A
      -- team_admin/coach/manager receives only their existing real
      -- authority (their own team's fixtures, and read access).
      'team.view', 'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.view', 'calendar.view', 'messages.fixture_send'
    )
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('team.view', 'fixture.view', 'calendar.view')
    else false
  end;
$$;
