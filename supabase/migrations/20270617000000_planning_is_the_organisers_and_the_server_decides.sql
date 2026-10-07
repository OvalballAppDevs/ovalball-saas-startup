-- =====================================================================================================
-- PLANNING IS THE ORGANISER'S, AND THE SERVER DECIDES THAT.
--
-- Every write below checks `internal.can_manage_tournament` on the tournament the plan belongs to.
-- There is no insert, update or delete policy on any planning table, so these functions are the only
-- way planning state can change: a hidden button, a route guard or a client flag is not a boundary.
--
-- DEFAULTS COME FROM CANONICAL SOURCES OR THEY ARE NOT DEFAULTS. Nothing here invents a number:
--
--   game duration   `fixture_scheduling_rules.half_minutes` x 2 for the competition's grade and code --
--                   RFU Regulation 15. A festival game may be SHORTER; it may never be longer, which
--                   is player welfare rather than preference, so a trigger refuses it.
--   changeover      `club_scheduling_policy.turnaround_minutes`, the canonical time between games on
--                   one pitch, falling back to the platform default.
--   playable hours  `club_scheduling_policy.weekend_youth_earliest/latest` for an age grade, and the
--                   senior pair for an adult competition.
-- =====================================================================================================

-- ---- a festival game is never longer than the regulation permits -----------------------------------

create or replace function internal.validate_tournament_plan_duration()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_code text; v_max int;
begin
  select t.rugby_code into v_code from public.tournaments t where t.id = new.tournament_id;
  select r.half_minutes * 2 into v_max
  from public.fixture_scheduling_rules r
  where r.rugby_code = v_code and r.age_group = new.age_group
  order by r.effective_season desc nulls last
  limit 1;

  -- NO RULE RECORDED IS NOT A LICENCE. It means Ovalball has no regulation length for that grade and
  -- code, and the organiser's own figure stands -- rather than this silently inventing a ceiling.
  if v_max is not null and new.game_duration_minutes > v_max then
    raise exception 'A % game may be at most % minutes under the age-grade regulations; % was asked for.',
      new.age_group, v_max, new.game_duration_minutes using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists tournament_plans_validate_duration on public.tournament_plans;
create trigger tournament_plans_validate_duration
  before insert or update of game_duration_minutes, age_group on public.tournament_plans
  for each row execute function internal.validate_tournament_plan_duration();

-- ---- the canonical defaults for a new plan ---------------------------------------------------------

create or replace function internal.tournament_plan_defaults(p_tournament_id uuid, p_age_group text)
returns table (game_duration_minutes integer, changeover_minutes integer, day_start_time time, day_end_time time, duration_source text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_code text; v_club uuid; v_half int; v_turn int; v_from time; v_to time; v_youth boolean;
begin
  select t.rugby_code, t.host_club_id into v_code, v_club from public.tournaments t where t.id = p_tournament_id;

  select r.half_minutes into v_half
  from public.fixture_scheduling_rules r
  where r.rugby_code = v_code and r.age_group = p_age_group
  order by r.effective_season desc nulls last limit 1;

  -- An age grade is a youth competition; SENIOR and the colts grades take the adult window.
  v_youth := p_age_group ~ '^U[0-9]+$';

  select coalesce(c.turnaround_minutes, 15),
         case when v_youth then coalesce(c.weekend_youth_earliest, '09:00'::time) else coalesce(c.weekend_senior_earliest, '13:00'::time) end,
         case when v_youth then coalesce(c.weekend_youth_latest, '13:00'::time) else coalesce(c.weekend_senior_latest, '17:30'::time) end
    into v_turn, v_from, v_to
  from public.club_scheduling_policy c where c.club_id = v_club;

  if v_turn is null then
    v_turn := 15;
    v_from := case when v_youth then '09:00'::time else '13:00'::time end;
    v_to   := case when v_youth then '13:00'::time else '17:30'::time end;
  end if;

  return query select
    -- The regulation full length where one is recorded; otherwise a plain, visible 20 minutes that the
    -- organiser is shown and can change, rather than a number nobody chose.
    coalesce(v_half * 2, 20),
    v_turn,
    v_from,
    v_to,
    case when v_half is not null then 'RFU Regulation 15 (' || p_age_group || ')' else 'Ovalball default' end;
end;
$function$;

-- ---- start a plan ----------------------------------------------------------------------------------

create or replace function public.start_tournament_plan(p_tournament_id uuid, p_age_group text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan uuid; v_d record; v_table uuid; v_from date; v_to date; v_day date; v_i int := 0; v_p record;
begin
  perform internal.require_live_session();
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tournament_age_groups g
                 where g.tournament_id = p_tournament_id and g.age_group = p_age_group) then
    raise exception 'This tournament does not run %.', p_age_group using errcode = '22023';
  end if;

  -- ALREADY PLANNING IS NOT AN ERROR. Opening Planning twice returns the plan that exists rather than
  -- starting a second one, which is also why "Start Planning" can never silently discard work.
  select id into v_plan from public.tournament_plans
  where tournament_id = p_tournament_id and age_group = p_age_group and publication_state <> 'SUPERSEDED';
  if v_plan is not null then
    return v_plan;
  end if;

  select * into v_d from internal.tournament_plan_defaults(p_tournament_id, p_age_group);

  insert into public.tournament_plans (
    tournament_id, age_group, game_duration_minutes, changeover_minutes, day_start_time, day_end_time,
    created_by, updated_by)
  values (p_tournament_id, p_age_group, v_d.game_duration_minutes, v_d.changeover_minutes,
          v_d.day_start_time, v_d.day_end_time, auth.uid(), auth.uid())
  returning id into v_plan;

  -- EVERY DAY THE TOURNAMENT RUNS, to begin with. The organiser removes the ones this competition does
  -- not use; starting from none would make a single-day festival need a decision it does not have.
  select t.event_date, coalesce(t.ends_on, t.event_date) into v_from, v_to
  from public.tournaments t where t.id = p_tournament_id;
  v_day := v_from;
  while v_day <= v_to loop
    insert into public.tournament_plan_days (plan_id, day_date) values (v_plan, v_day);
    v_day := v_day + 1;
  end loop;

  -- ONE TABLE HOLDING EVERY SIDE. The commonest festival is one round robin, so that is what opening
  -- Planning produces; splitting into pools is then a change the organiser makes, not a setup step.
  insert into public.tournament_plan_tables (plan_id, name, sort_order) values (v_plan, 'Table A', 1)
  returning id into v_table;
  for v_p in select tp.id from public.tournament_participants tp
             where tp.tournament_id = p_tournament_id and tp.age_group = p_age_group
             order by tp.created_at, tp.id
  loop
    v_i := v_i + 1;
    insert into public.tournament_plan_table_sides (table_id, plan_id, participant_id, position)
    values (v_table, v_plan, v_p.id, v_i);
  end loop;

  return v_plan;
end;
$function$;

-- ---- which days this competition uses --------------------------------------------------------------

create or replace function public.set_tournament_plan_days(p_plan_id uuid, p_days date[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid; v_day date;
begin
  perform internal.require_live_session();
  select tournament_id into v_tournament from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  if p_days is null or array_length(p_days, 1) is null then
    raise exception 'A competition needs at least one day to play on.' using errcode = '22023';
  end if;

  delete from public.tournament_plan_days where plan_id = p_plan_id;
  foreach v_day in array p_days loop
    -- The trigger refuses a day outside the tournament's own range, so this cannot widen a tournament.
    insert into public.tournament_plan_days (plan_id, day_date) values (p_plan_id, v_day)
    on conflict do nothing;
  end loop;

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
end;
$function$;

-- ---- the tables, replaced as one arrangement -------------------------------------------------------

create or replace function public.set_tournament_plan_tables(p_plan_id uuid, p_tables jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tournament uuid; v_grade text; v_t jsonb; v_table uuid; v_sort int := 0; v_side text; v_pos int;
  v_seen uuid[] := '{}'; v_id uuid; v_total int; v_available int;
begin
  perform internal.require_live_session();
  select tournament_id, age_group into v_tournament, v_grade from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  if p_tables is null or jsonb_array_length(p_tables) = 0 then
    raise exception 'A competition needs at least one table.' using errcode = '22023';
  end if;

  -- REPLACED AS ONE ARRANGEMENT, not edited in place. A half-applied allocation is a state in which a
  -- side is at two tables or none, and there is no reason for it to be reachable.
  delete from public.tournament_plan_tables where plan_id = p_plan_id;

  for v_t in select * from jsonb_array_elements(p_tables)
  loop
    v_sort := v_sort + 1;
    insert into public.tournament_plan_tables (plan_id, name, sort_order)
    values (p_plan_id, coalesce(nullif(btrim(v_t->>'name'), ''), 'Table ' || chr(64 + v_sort)), v_sort)
    returning id into v_table;

    v_pos := 0;
    for v_side in select jsonb_array_elements_text(coalesce(v_t->'sides', '[]'::jsonb))
    loop
      v_pos := v_pos + 1;
      v_id := v_side::uuid;
      if v_id = any(v_seen) then
        raise exception 'A side can only sit at one table.' using errcode = '22023';
      end if;
      v_seen := v_seen || v_id;
      -- The row trigger refuses a side from another tournament or another competition.
      insert into public.tournament_plan_table_sides (table_id, plan_id, participant_id, position)
      values (v_table, p_plan_id, v_id, v_pos);
    end loop;
  end loop;

  -- EVERY SIDE IN THE COMPETITION IS PLACED. A side left out of every table would be entered in the
  -- festival and absent from its schedule, which is the one outcome nobody could explain to them.
  select count(*) into v_available from public.tournament_participants
  where tournament_id = v_tournament and age_group = v_grade;
  select count(*) into v_total from public.tournament_plan_table_sides where plan_id = p_plan_id;
  if v_total <> v_available then
    raise exception 'All % sides in this competition must be placed; % were.', v_available, v_total
      using errcode = '22023';
  end if;

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
end;
$function$;

-- ---- the settings ----------------------------------------------------------------------------------

create or replace function public.set_tournament_plan_settings(
  p_plan_id uuid,
  p_game_duration_minutes integer default null,
  p_changeover_minutes integer default null,
  p_day_start_time time default null,
  p_day_end_time time default null,
  p_points_win integer default null,
  p_points_draw integer default null,
  p_points_loss integer default null,
  p_points_try_bonus integer default null,
  p_points_losing_bonus integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid;
begin
  perform internal.require_live_session();
  select tournament_id into v_tournament from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  update public.tournament_plans set
    game_duration_minutes = coalesce(p_game_duration_minutes, game_duration_minutes),
    changeover_minutes    = coalesce(p_changeover_minutes, changeover_minutes),
    day_start_time        = coalesce(p_day_start_time, day_start_time),
    day_end_time          = coalesce(p_day_end_time, day_end_time),
    points_win            = coalesce(p_points_win, points_win),
    points_draw           = coalesce(p_points_draw, points_draw),
    points_loss           = coalesce(p_points_loss, points_loss),
    points_try_bonus      = coalesce(p_points_try_bonus, points_try_bonus),
    points_losing_bonus   = coalesce(p_points_losing_bonus, points_losing_bonus),
    updated_by = auth.uid(), updated_at = now()
  where id = p_plan_id;
end;
$function$;

revoke all on function public.start_tournament_plan(uuid, text) from public, anon;
revoke all on function public.set_tournament_plan_days(uuid, date[]) from public, anon;
revoke all on function public.set_tournament_plan_tables(uuid, jsonb) from public, anon;
revoke all on function public.set_tournament_plan_settings(uuid, integer, integer, time, time, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.start_tournament_plan(uuid, text) to authenticated, service_role;
grant execute on function public.set_tournament_plan_days(uuid, date[]) to authenticated, service_role;
grant execute on function public.set_tournament_plan_tables(uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_tournament_plan_settings(uuid, integer, integer, time, time, integer, integer, integer, integer, integer) to authenticated, service_role;
