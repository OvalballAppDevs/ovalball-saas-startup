-- Bug found live-testing the overlapping-Mini-Rugby-Group scenario
-- (flagged in the Season Handover report as "not independently
-- tested"): internal.enforce_shared_team_fixture_capacity() only ever
-- compared an EXISTING fixture's literal owning_team_id against the
-- membership of whichever group the NEW fixture's OWN owning_team_id
-- belonged to. Two different groups sharing a common member team (say
-- Group A = {U6, U7}, Group B = {U7, U8}) were correctly caught ONLY
-- when the shared team (U7) was itself the literal owning_team_id of
-- one of the two fixtures -- if Group A's fixture was booked via U6
-- (a real, valid, non-shared member) and Group B's via U8, the trigger
-- saw no overlap at all and allowed both, even though U7 -- genuinely
-- committed to playing in Group A's combined fixture that day -- is
-- also nominally part of Group B and would be double-booked.
--
-- Fixed by expanding BOTH sides symmetrically to their real involved
-- team sets before comparing, reusing the exact same Mini-Rugby Group
-- expansion this feature's own effective-team resolver already
-- performs (internal.expand_scheduling_group /
-- get_effective_fixture_team_ids) rather than a second, narrower
-- ad-hoc membership check.
create or replace function internal.enforce_shared_team_fixture_capacity()
returns trigger
language plpgsql
as $$
declare
  v_new_team_ids uuid[];
  v_conflict_count integer;
  v_conflicting_team_name text;
begin
  if new.status = 'Cancelled' then
    return new;
  end if;

  select array_agg(distinct t) into v_new_team_ids
  from (
    select new.owning_team_id as t
    union
    select sgm.team_id
    from public.scheduling_group_members sgm
    join public.scheduling_groups sg on sg.id = sgm.group_id
    where sg.active
      and (sg.id = new.owning_scheduling_group_id or exists (
        select 1 from public.scheduling_group_members sgm2 where sgm2.group_id = sg.id and sgm2.team_id = new.owning_team_id
      ))
  ) x;

  select count(*), max(t2.display_name) into v_conflict_count, v_conflicting_team_name
  from public.fixtures f
  join public.teams t2 on t2.id = f.owning_team_id
  where f.id <> new.id
    and f.kickoff_date = new.kickoff_date
    and f.status <> 'Cancelled'
    and (
      f.owning_team_id = any(v_new_team_ids)
      or exists (
        select 1 from public.scheduling_group_members sgm
        where sgm.group_id = f.owning_scheduling_group_id and sgm.team_id = any(v_new_team_ids)
      )
    );

  if v_conflict_count > 0 then
    raise exception '% already has a fixture commitment on %. A Mini-Rugby Group may hold only one match per day across all of its component teams.', coalesce(v_conflicting_team_name, 'This team'), new.kickoff_date
      using errcode = '23514';
  end if;

  return new;
end;
$$;
