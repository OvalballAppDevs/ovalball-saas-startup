-- Section 16/30 of the Mini-Rugby brief: the capacity trigger's own
-- exception text still said "shared mini-rugby team" / "shared group"
-- (found live while testing the same-day conflict rule against the real
-- Burnley U7/U8 Falcons group) and named no specific team, forcing a Club
-- Admin to guess which of a group's several component teams actually
-- collided. Pure wording + one added lookup -- the conflict-detection
-- logic itself (the loop, the EXISTS checks, the errcode) is byte-for-
-- byte unchanged from the live definition.

create or replace function internal.enforce_shared_team_fixture_capacity()
returns trigger
language plpgsql
as $$
declare
  v_group_id uuid;
  v_conflict_count integer;
  v_team_name text;
begin
  if new.status = 'Cancelled' then
    return new;
  end if;

  for v_group_id in
    select sg.id from public.scheduling_groups sg
    where sg.active
      and (sg.id = new.owning_scheduling_group_id
           or exists (select 1 from public.scheduling_group_members sgm where sgm.group_id = sg.id and sgm.team_id = new.owning_team_id))
  loop
    select count(*) into v_conflict_count
    from public.fixtures f
    where f.id <> new.id
      and f.kickoff_date = new.kickoff_date
      and f.status <> 'Cancelled'
      and (
        f.owning_scheduling_group_id = v_group_id
        or exists (select 1 from public.scheduling_group_members sgm where sgm.group_id = v_group_id and sgm.team_id = f.owning_team_id)
      );

    if v_conflict_count > 0 then
      select display_name into v_team_name from public.teams where id = new.owning_team_id;
      raise exception '% already has a fixture commitment on %. A Mini-Rugby Group may hold only one match per day across all of its component teams.', coalesce(v_team_name, 'This team'), new.kickoff_date
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;
