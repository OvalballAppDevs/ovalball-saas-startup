-- TEAM PROFILE PEOPLE COUNTS -- an aggregate the row-level policies cannot answer correctly (Team
-- Profiles + Club Admin Home, safeguarding pass).
--
-- FOUND BY TESTING AGAINST THE LIVE CAPABILITY ENGINE, NOT BY INSPECTION. The Team Profile's own
-- comment in `packages/contracts/src/team/profile.ts` says asking `team.team.view` before running the
-- squad/staff counts is what stops "we don't know" from silently becoming "zero". That is true only if
-- a viewer who holds `team.team.view` also gets a COMPLETE read of `player_team_memberships` under RLS
-- -- and it does not: `player_team_memberships_select` requires `team.roster.view`, `is_own_linked_player`
-- or `is_active_player_guardian`, a strictly narrower set. A guardian whose own child plays on the team
-- can hold `team.team.view = true` for it without `team.roster.view` (confirmed against a real UAT
-- persona/team pair here); the client's `.count()` then returns the count of rows RLS lets through for
-- THEM specifically -- their own child alone -- not the team's real size. That is not a fabricated zero,
-- it is a fabricated ONE: a plausible, wrong number, which is worse than an honest "not available" state
-- because nothing about it looks unavailable.
--
-- THE FIX IS AN AGGREGATE THAT ANSWERS THE SAME QUESTION THE CAPABILITY ALREADY DECIDES. `team.team.view`
-- means "may see the club's teams and their details" -- a safe count is exactly a detail, never an
-- identity. This function re-checks the SAME capability server-side against the caller's own session
-- (never a client-supplied boolean) and, only where it holds, counts every active player and every
-- team-permission row directly -- a SECURITY DEFINER read is not filtered by the roster-scoped RLS that
-- exists to protect the FULL identifying rows a Squad tab would show, because this never returns rows,
-- only a count. Unknown authority returns null on both fields, never zero, so the client's existing
-- "not available in this view" state (never "no players") still applies unchanged.
create or replace function public.team_people_counts(p_team_id uuid)
returns table(players integer, staff integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_club uuid;
begin
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null or not internal.has_capability('team.team.view', 'team', v_club, p_team_id) then
    return query select null::integer, null::integer;
    return;
  end if;

  return query
  select
    (select count(*)::integer from public.player_team_memberships m where m.team_id = p_team_id and m.status = 'active'),
    (select count(*)::integer from public.team_permissions p where p.team_id = p_team_id);
end;
$$;

grant execute on function public.team_people_counts(uuid) to authenticated;
