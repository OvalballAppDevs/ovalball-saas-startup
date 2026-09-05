-- Real gap found live during the closure verification pass, using a
-- genuinely team-only identity (no club-wide role at all) for the
-- first time -- every earlier test of the source-team dispensation
-- stage happened to use a Club Admin, whose access came from the
-- CLUB-scope side of the has_capability() OR check, silently masking
-- that the TEAM-scope side was never wired at all.
--
-- has_team_role_capability() granted manage_fixture_callups/approve_
-- fixture_callups/place_graduating_players to team_admin/coach/manager
-- (and to a club admin evaluated at team scope) but never manage_
-- player_dispensations/approve_player_dispensations -- meaning a real
-- team's own coach could never request a dispensation directly, nor
-- approve the source-team stage of one, even for their own team.
-- decide_player_dispensation()'s own check already ORs team-scope
-- with club-scope, so this was invisible whenever a Club Admin (who
-- succeeds via the club-scope side regardless) was the one testing it.
create or replace function internal.has_team_role_capability(p_team_id uuid, p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when not internal.is_club_active(p_club_id) then false
    when internal.is_club_admin(p_club_id) then p_capability_key in (
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'team.roster.manage',
      'team.view', 'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.view', 'calendar.view', 'messages.fixture_send',
      'manage_fixture_callups', 'approve_fixture_callups', 'place_graduating_players',
      'manage_player_dispensations', 'approve_player_dispensations'
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
      -- authority (their own team's fixtures, and read access) plus the
      -- call-up/placement/dispensation capabilities that internal.
      -- can_manage_team() already granted this tier before the capability
      -- model existed.
      'team.view', 'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.view', 'calendar.view', 'messages.fixture_send',
      'manage_fixture_callups', 'approve_fixture_callups', 'place_graduating_players',
      'manage_player_dispensations', 'approve_player_dispensations'
    )
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('team.view', 'fixture.view', 'calendar.view')
    else false
  end;
$$;
