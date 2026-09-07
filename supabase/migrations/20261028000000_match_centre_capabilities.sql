-- Match Centre read-side capability wrappers.
--
-- Side Project 3 Stage 8 built a Match Centre UX against a typed provider
-- contract (docs/SIDE_PROJECT_3_STAGE_8_MATCH_CENTRE_INTEGRATION.md, audited
-- not copied) that needs to know, for one fixture and the current viewer,
-- three things a page must resolve BEFORE deciding what controls to render:
-- can I respond to attendance (and for which player, and why not if not),
-- can I see this fixture's conversation, can I manage this fixture.
--
-- Every one of these is already a real, tested, canonical decision inside
-- this database -- internal.resolve_attendance_response_source (attendance,
-- shared with training attendance since 20261011070000_training_attendance.
-- sql), internal.can_access_fixture_conversation (messaging), internal.
-- can_manage_fixture_side (the exact predicate fixtures' own UPDATE RLS
-- policy uses). This migration adds ZERO new authorization logic -- both
-- functions below are thin, read-only wrappers that call the existing
-- canonical functions and shape their result for a page to render, exactly
-- the way public.has_capability wraps internal.has_capability.
--
-- resolve_attendance_response_source RAISES on denial (correct for a write
-- path, where "no" must halt the transaction) rather than returning a
-- reason a UI can display. get_my_attendance_authority below is the
-- non-throwing read-side twin: same rule, but denial becomes a returned
-- row instead of an aborted transaction.

create or replace function public.get_my_attendance_authority(p_player_id uuid)
returns table(can_respond boolean, response_source text, denial_reason text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_source text;
begin
  begin
    v_source := internal.resolve_attendance_response_source(p_player_id);
  exception
    when others then
      return query select false, null::text, sqlerrm;
      return;
  end;
  return query select true, v_source, null::text;
end;
$function$;

comment on function public.get_my_attendance_authority is
  'Read-side (non-throwing) twin of internal.resolve_attendance_response_source, for a page deciding what to render before any write is attempted. Never re-derives the guardian/self/age/consent rule itself -- catches the exact exception the canonical resolver already raises and returns its message as denial_reason. A Match Centre / attendance UI must call this to decide whether to show an enabled response control, never assume it can respond and let a failed write be the first signal.';

grant execute on function public.get_my_attendance_authority(uuid) to authenticated;

create or replace function public.get_match_centre_capabilities(p_fixture_id uuid)
returns table(can_view_participants boolean, can_message boolean, can_manage_fixture boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    -- STAFF-LEVEL visibility only -- deliberately narrower than "can I see
    -- my own linked player's attendance" (that is never gated by this flag
    -- at all; see get_my_attendance_authority and the Match Centre
    -- resolver's separate, always-attempted "mine" path). This flag gates
    -- the FULL roster/aggregate-counts section, and must match player_
    -- fixture_attendance's own row-level RLS for the "everyone" case
    -- exactly (site admin or team.attendance.view) -- a guardian or self
    -- relationship is intentionally NOT included here: Main's own RLS on
    -- player_fixture_attendance and player_team_memberships already scopes
    -- a guardian's read to their own linked player's row only, and this
    -- flag existing to say otherwise would tell a page to render a "whole
    -- roster" section that silently comes back partial for that viewer --
    -- exactly the bug this comment exists to prevent from recurring.
    (
      internal.is_site_admin()
      or internal.has_capability('team.attendance.view', 'team', (select club_id from public.teams where id = f.owning_team_id), f.owning_team_id)
      or internal.has_capability('team.attendance.view', 'club', (select club_id from public.teams where id = f.owning_team_id), null)
      or (f.opponent_team_id is not null and (
        internal.has_capability('team.attendance.view', 'team', (select club_id from public.teams where id = f.opponent_team_id), f.opponent_team_id)
        or internal.has_capability('team.attendance.view', 'club', (select club_id from public.teams where id = f.opponent_team_id), null)
      ))
    ),
    internal.can_access_fixture_conversation(f.id, null),
    internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
      or (f.opponent_team_id is not null and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id))
  from public.fixtures f
  where f.id = p_fixture_id;
$function$;

comment on function public.get_match_centre_capabilities is
  'Bundles the three fixture-scoped capability checks a Match Centre page needs into one round trip. can_view_participants mirrors player_fixture_attendance''s own RLS (never widens it -- this only decides whether to render the section, the query itself is still RLS-checked). can_message reuses internal.can_access_fixture_conversation verbatim -- staff-only today (club/team management), not guardian/player-facing, matching fixture_messages'' real current authorization. can_manage_fixture reuses the exact predicate fixtures'' own UPDATE policy uses.';

grant execute on function public.get_match_centre_capabilities(uuid) to authenticated;
