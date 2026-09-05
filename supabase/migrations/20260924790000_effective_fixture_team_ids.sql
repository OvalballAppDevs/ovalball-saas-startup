-- Canonical "effective involved team_ids" resolver (Section 5/6/25 of the
-- Mini-Rugby brief) -- the DB-side counterpart to
-- lib/mini-rugby/effective-teams.ts's effectiveTeamIdsForFixtureSide(),
-- for callers that need this resolved server-side (future trigger
-- extensions, RPCs, Season Handover safety checks) rather than loading
-- membership rows into the application first. Both implementations read
-- the exact same scheduling_group_members table and apply the exact same
-- rule -- no group_id -> [owning_team_id] fallback only.

create or replace function internal.expand_scheduling_group(p_group_id uuid)
returns uuid[]
language sql
stable
as $$
  select coalesce(array_agg(team_id), array[]::uuid[]) from public.scheduling_group_members where group_id = p_group_id;
$$;

comment on function internal.expand_scheduling_group is
  'Section 27: returns the EXACT component team_ids of a Mini-Rugby Group -- a squad-specific group (e.g. U6 B + U7 C) returns exactly those two, never every team sharing an age. Empty array if the group has no rows (never used as a silent "everyone" wildcard by any caller).';

-- get_effective_fixture_team_ids: resolves ONE fixture row's OWNING side
-- (owning_team_id / owning_scheduling_group_id) to its real effective
-- team_ids. SECURITY INVOKER (the default) -- a caller can only resolve a
-- fixture they can already SELECT under existing fixtures RLS; this
-- function grants no new visibility, it only interprets a row already
-- visible to the caller.
create or replace function public.get_effective_fixture_team_ids(p_fixture_id uuid)
returns uuid[]
language plpgsql
stable
as $$
declare
  v_owning_team_id uuid;
  v_group_id uuid;
  v_members uuid[];
begin
  select owning_team_id, owning_scheduling_group_id into v_owning_team_id, v_group_id
  from public.fixtures where id = p_fixture_id;

  if v_owning_team_id is null then
    return array[]::uuid[];
  end if;

  if v_group_id is null then
    return array[v_owning_team_id];
  end if;

  v_members := internal.expand_scheduling_group(v_group_id);
  return case when array_length(v_members, 1) > 0 then v_members else array[v_owning_team_id] end;
end;
$$;

comment on function public.get_effective_fixture_team_ids is
  'Section 25/72: given a fixture_id, returns the real operational team_ids its OWNING side commits for that date -- a Mini-Rugby Group fixture returns every component team_id, an ordinary fixture returns its one team. This is the one canonical entry point Side Project 1 (Player/Guardian/attendance) and any future feature should call rather than re-deriving group membership.';

grant execute on function public.get_effective_fixture_team_ids(uuid) to authenticated;
