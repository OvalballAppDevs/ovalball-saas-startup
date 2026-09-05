-- Real bug reported live by the user: booking an ordinary, non-Mini-Rugby
-- fixture (Burnley U12 vs Broughton Park, 2026-09-02) that genuinely
-- conflicts with an existing same-day commitment (U12 already has two
-- real fixtures booked that day -- a genuine pre-existing data issue,
-- correctly caught) showed: "A team (or a Mini-Rugby Group's component
-- team) may hold only one match per day." U12 is not, and has never
-- been, a member of any scheduling group -- the message unconditionally
-- mentioned "Mini-Rugby Group" regardless of whether one was actually
-- involved in the conflict, confusing the user into thinking their plain
-- team had somehow become a "shared calendar".
--
-- Fixed: the message now only mentions a Mini-Rugby Group when either
-- the fixture being saved or the conflicting fixture it clashes with
-- actually has one on either side. An ordinary team-vs-team clash (like
-- this one) now reads simply "U12 already has a fixture commitment on
-- 2026-09-02 -- a team may hold only one match per day."
create or replace function internal.enforce_shared_team_fixture_capacity()
returns trigger
language plpgsql
as $$
declare
  v_new_ids uuid[];
  v_conflict_count integer;
  v_conflicting_team_name text;
  v_group_involved boolean;
begin
  if new.status = 'Cancelled' then
    return new;
  end if;

  v_new_ids := internal.fixture_side_effective_team_ids(new.owning_team_id, new.owning_scheduling_group_id)
    || case when new.opponent_team_id is null then array[]::uuid[]
       else internal.fixture_side_effective_team_ids(new.opponent_team_id, new.opponent_scheduling_group_id) end;

  select count(*), max(t2.display_name),
    bool_or(f.owning_scheduling_group_id is not null or f.opponent_scheduling_group_id is not null)
  into v_conflict_count, v_conflicting_team_name, v_group_involved
  from public.fixtures f
  join public.teams t2 on t2.id = f.owning_team_id
  where f.id <> new.id
    and f.kickoff_date = new.kickoff_date
    and f.status <> 'Cancelled'
    and (
      internal.fixture_side_effective_team_ids(f.owning_team_id, f.owning_scheduling_group_id)
      || case when f.opponent_team_id is null then array[]::uuid[]
         else internal.fixture_side_effective_team_ids(f.opponent_team_id, f.opponent_scheduling_group_id) end
    ) && v_new_ids;

  if v_conflict_count > 0 then
    v_group_involved := coalesce(v_group_involved, false) or new.owning_scheduling_group_id is not null or new.opponent_scheduling_group_id is not null;
    if v_group_involved then
      raise exception '% already has a fixture commitment on %. A team (or a Mini-Rugby Group''s component team) may hold only one match per day.', coalesce(v_conflicting_team_name, 'A team involved in this fixture'), new.kickoff_date
        using errcode = '23514';
    else
      raise exception '% already has a fixture commitment on % -- a team may hold only one match per day.', coalesce(v_conflicting_team_name, 'A team involved in this fixture'), new.kickoff_date
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function internal.enforce_shared_team_fixture_capacity is
  'Section 8 (group-vs-group) + live bug report: same-day capacity considering both sides of both the new and every existing same-day fixture, covering team-v-team, group-v-team, team-v-group, and group-v-group uniformly via internal.fixture_side_effective_team_ids. The rejection message only mentions "Mini-Rugby Group" when a group is genuinely involved on either fixture -- an ordinary team-vs-team clash reads as a plain double-booking, never implying a shared calendar that does not exist.';
