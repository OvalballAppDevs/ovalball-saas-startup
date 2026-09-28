-- TEAM PROFILE STAFF COUNT -- fixing an undercount found auditing `team_people_counts`
-- (Team Profiles Section 1, staff/role audit).
--
-- `team_people_counts` (20270565000000) counted staff from `public.team_permissions`, a VIEW over
-- `role_assignments` that exists for a DIFFERENT purpose (who may be addressed by team messaging) and
-- deliberately narrows to three role keys: `WHERE role_key = ANY(ARRAY['TEAM_ADMINISTRATION',
-- 'TEAM_MANAGER', 'COACH'])`. The real team-scoped role vocabulary in `role_definitions` also contains
-- `VOLUNTEER` (`scope = 'CLUB_OR_TEAM'`), which that view silently drops -- a team whose only staff hold
-- the Volunteer role reports zero staff even though real, active, canonical staff exist. This is the
-- exact "fabricated zero" class the surrounding module's own comment already warns about, just reached
-- through a narrower view instead of a missing authority check.
--
-- THE FIX GOES TO THE SOURCE TABLE, not a second view. `role_assignments` is the one canonical staff
-- ledger; `team_permissions`'s own `DISTINCT ON (membership_id, team_id)` already proves the right
-- shape -- one row per PERSON per team, not one per role row -- so this keeps that same shape (`count
-- (distinct membership_id)`) without inheriting the view's narrower role filter. A person holding both
-- Coach and Team Manager on the same team still counts once, exactly as before; a Volunteer now counts
-- at all. The `team.team.view` gate, and the null-not-zero behaviour for a viewer who lacks it, are
-- unchanged.
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
    (select count(distinct ra.membership_id)::integer from public.role_assignments ra where ra.team_id = p_team_id and ra.state = 'ACTIVE');
end;
$$;

grant execute on function public.team_people_counts(uuid) to authenticated;
