-- A PLAN ALWAYS KNOWS WHO IS PLAYING (Tournament Planning format-parity programme, phases 2-3, 16-18).
--
-- Reproduced before this migration (scratchpad repro-stale.sql): a Round Robin competition planned with
-- three sides, then a fourth added, still seated three. Generate succeeded with three games and none for
-- the new side; nothing said so. The plan COPIED its membership once (start_tournament_plan) and nothing
-- kept the copy honest: set_tournament_plan_tables checked "every side placed" only when tables were
-- saved, and neither generator compared what it paired with who is actually in the competition.
--
-- This migration makes four things one authority each:
--
--   1. WHO COMPETES. A side competes when it has been added, has accepted, or is recorded off-platform.
--      An invitation still awaiting a reply, or one that was declined, is not a side in the draw. Before
--      this the plan, the tri-fixture size check and the draw counted every row whatever its status.
--
--   2. WHETHER THE PLAN STILL MATCHES THEM. Seating for a table-based competition reconciles itself
--      whenever membership changes and the competition has no results: a new side joins the table with
--      the fewest sides, a departed side leaves. A knockout DRAW is not rewritten behind the organiser's
--      back -- adding or removing a side can move other sides' places -- so it reports the change and
--      offers one explicit action (update_tournament_draw_membership). Generated games are never
--      silently regenerated: when they no longer match, the plan says so.
--
--   3. WHAT A PLAN NEEDS before it can be generated and before it can be published, and why not:
--      internal.tournament_plan_readiness. Generate, Publish and every screen read the same answer.
--
--   4. WHAT CAN CHANGE once results exist: a competition with results keeps its teams. Adding or removing
--      one would either orphan a side's results or create a side with games nobody can play.
--
-- And it closes what the audit found on the way:
--   * set_tournament_plan_tables rebuilt every table on every Continue press, which set every existing
--     game's table_id to NULL (ON DELETE SET NULL) -- results included -- and so dropped them from the
--     standings and the draft view. An unchanged arrangement is now a no-op, and a changed one is refused
--     once results exist.
--   * removing a side cascaded away its games, results included. The membership guard refuses that once
--     the competition has results; before results, the plan reports the fixtures out of date.
--   * a removed side's bracket slot was deleted outright, leaving a hole the generator sized the bracket
--     from. The slot now survives as an empty place the draw reports.
--   * the knockout scheduler ignored the playing hours, could start a round before the one feeding it had
--     finished, and left duration_minutes NULL.
--   * games, tables, seats, days, bracket slots and pairings of a DRAFT plan were readable by anyone who
--     could see the tournament, directly over the API. A draft is now the organiser's until published.
--   * Swiss and Hybrid competitions silently generated a full round robin. They are refused by the round
--     robin generator until their own generators exist.

-- ---- 1. who competes ------------------------------------------------------------------------------

create or replace function internal.tournament_side_competes(p_status text)
returns boolean
language sql
immutable
set search_path to ''
as $function$
  select p_status in ('added', 'accepted', 'external_recorded');
$function$;

comment on function internal.tournament_side_competes(text) is
  'A participant row is a side in the competition when it was added, accepted, or is recorded off-platform. '
  'pending (an invitation awaiting reply) and declined are not.';

create or replace function internal.tournament_plan_sides(p_plan_id uuid)
returns uuid[]
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(array_agg(tp.id order by cd.name, tp.id), '{}'::uuid[])
  from public.tournament_plans p
  join public.tournament_participants tp
    on tp.tournament_id = p.tournament_id and tp.age_group = p.age_group
  join public.club_directory cd on cd.id = tp.club_directory_id
  where p.id = p_plan_id
    and internal.tournament_side_competes(tp.status);
$function$;

-- ---- 2. the competition's result history, by competition rather than by plan ------------------------

create or replace function internal.tournament_competition_has_results(p_tournament_id uuid, p_age_group text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.tournament_games g
    where g.tournament_id = p_tournament_id and g.age_group = p_age_group and g.plan_id is not null
      and (g.result_status <> 'none'
           or exists (select 1 from public.tournament_game_result_submissions s where s.game_id = g.id))
  );
$function$;

create or replace function internal.refuse_if_competition_has_results(p_tournament_id uuid, p_age_group text, p_change text)
returns void
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  if internal.tournament_competition_has_results(p_tournament_id, p_age_group) then
    raise exception
      'The % competition already has results, so a team can no longer be % it. Results already recorded would lose their opponent or a side would join with games nobody can play.',
      p_age_group, p_change
      using errcode = '22023', hint = 'TOURNAMENT_COMPETITION_HAS_RESULTS';
  end if;
end;
$function$;

-- ---- 3. membership guard and reconciliation ----------------------------------------------------------

create or replace function internal.guard_tournament_competition_membership()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_was boolean; v_is boolean;
begin
  if tg_op = 'INSERT' then
    if internal.tournament_side_competes(new.status) then
      perform internal.refuse_if_competition_has_results(new.tournament_id, new.age_group, 'added to');
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    -- A cascade from the tournament itself (its deletion) is not a membership change.
    if internal.tournament_side_competes(old.status)
       and exists (select 1 from public.tournaments t where t.id = old.tournament_id) then
      perform internal.refuse_if_competition_has_results(old.tournament_id, old.age_group, 'removed from');
    end if;
    return old;
  end if;

  v_was := internal.tournament_side_competes(old.status);
  v_is := internal.tournament_side_competes(new.status);
  if v_was and (not v_is or new.age_group is distinct from old.age_group) then
    perform internal.refuse_if_competition_has_results(old.tournament_id, old.age_group, 'removed from');
  end if;
  if v_is and (not v_was or new.age_group is distinct from old.age_group) then
    perform internal.refuse_if_competition_has_results(new.tournament_id, new.age_group, 'added to');
  end if;
  return new;
end;
$function$;

drop trigger if exists tournament_participants_guard_membership on public.tournament_participants;
create trigger tournament_participants_guard_membership
  before insert or update of status, age_group or delete on public.tournament_participants
  for each row execute function internal.guard_tournament_competition_membership();

-- Seating for a table-based competition follows its membership. A knockout draw does not -- see header.
create or replace function internal.reconcile_tournament_competition_seating(p_tournament_id uuid, p_age_group text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_plan uuid; v_table uuid; r record; v_changed boolean := false;
begin
  if not exists (select 1 from public.tournaments t where t.id = p_tournament_id) then return; end if;
  select id into v_plan from public.tournament_plans
  where tournament_id = p_tournament_id and age_group = p_age_group and publication_state <> 'SUPERSEDED';
  if v_plan is null then return; end if;
  if internal.tournament_plan_format(v_plan) = 'knockout' then return; end if;
  if internal.tournament_competition_has_results(p_tournament_id, p_age_group) then return; end if;

  -- A side that no longer competes leaves its table (a deleted row has already gone by cascade).
  delete from public.tournament_plan_table_sides s
  using public.tournament_participants tp
  where s.plan_id = v_plan and tp.id = s.participant_id and not internal.tournament_side_competes(tp.status);
  if found then v_changed := true; end if;

  -- A side that competes and sits nowhere joins the table with the fewest sides (the last such table,
  -- so a new side is added at the end of the arrangement rather than reshuffling the first table).
  for r in
    select tp.id from public.tournament_participants tp
    where tp.tournament_id = p_tournament_id and tp.age_group = p_age_group
      and internal.tournament_side_competes(tp.status)
      and not exists (select 1 from public.tournament_plan_table_sides s where s.plan_id = v_plan and s.participant_id = tp.id)
    order by tp.created_at, tp.id
  loop
    select t.id into v_table
    from public.tournament_plan_tables t
    left join public.tournament_plan_table_sides s on s.table_id = t.id
    where t.plan_id = v_plan
    group by t.id, t.sort_order
    order by count(s.participant_id), t.sort_order desc
    limit 1;
    if v_table is null then
      insert into public.tournament_plan_tables (plan_id, name, sort_order) values (v_plan, 'Table A', 1)
      returning id into v_table;
    end if;
    insert into public.tournament_plan_table_sides (table_id, plan_id, participant_id, position)
    values (v_table, v_plan, r.id,
            coalesce((select max(s.position) from public.tournament_plan_table_sides s where s.table_id = v_table), 0) + 1);
    v_changed := true;
  end loop;

  if v_changed then
    update public.tournament_plans set updated_at = now() where id = v_plan;
  end if;
end;
$function$;

create or replace function internal.reconcile_tournament_plans_after_membership()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform internal.reconcile_tournament_competition_seating(old.tournament_id, old.age_group);
  end if;
  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and (new.age_group is distinct from old.age_group or new.status is distinct from old.status)) then
    perform internal.reconcile_tournament_competition_seating(new.tournament_id, new.age_group);
  end if;
  return null;
end;
$function$;

drop trigger if exists tournament_participants_reconcile_plans on public.tournament_participants;
create trigger tournament_participants_reconcile_plans
  after insert or update of status, age_group or delete on public.tournament_participants
  for each row execute function internal.reconcile_tournament_plans_after_membership();

-- A removed side's place in the draw survives as an empty place the draw can report, rather than a hole.
alter table public.tournament_bracket_slots drop constraint if exists tournament_bracket_slots_participant_id_fkey;
alter table public.tournament_bracket_slots
  add constraint tournament_bracket_slots_participant_id_fkey
  foreign key (participant_id) references public.tournament_participants(id) on delete set null;

-- A table holds sides that compete.
create or replace function internal.validate_tournament_plan_table_side()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_plan_tournament uuid; v_plan_grade text; v_side_tournament uuid; v_side_grade text; v_table_plan uuid; v_status text;
begin
  select p.tournament_id, p.age_group into v_plan_tournament, v_plan_grade
  from public.tournament_plans p where p.id = new.plan_id;
  select t.plan_id into v_table_plan from public.tournament_plan_tables t where t.id = new.table_id;
  select tp.tournament_id, tp.age_group, tp.status into v_side_tournament, v_side_grade, v_status
  from public.tournament_participants tp where tp.id = new.participant_id;

  if v_plan_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if v_table_plan is distinct from new.plan_id then
    raise exception 'That table belongs to a different plan.' using errcode = '22023';
  end if;
  if v_side_tournament is distinct from v_plan_tournament then
    raise exception 'That side is not in this tournament.' using errcode = '22023';
  end if;
  if v_side_grade is distinct from v_plan_grade then
    raise exception 'That side plays %, not % -- a competition''s tables hold its own sides.', v_side_grade, v_plan_grade
      using errcode = '22023';
  end if;
  if not internal.tournament_side_competes(v_status) then
    raise exception 'That team has not taken its place in this competition yet, so it cannot sit at a table.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

-- ---- 4. one model of where a game can go -------------------------------------------------------------
-- Every place a game could be played: each reserved pitch on each selected day, inside both the plan's
-- playing hours and the reservation's own window, stepped by one game plus its changeover. Both
-- schedulers and the readiness calculation read this one function.

create or replace function internal.tournament_plan_slots(p_plan_id uuid)
returns table (slot_day date, pitch_id uuid, slot_start time, slot_end time, ordinal bigint)
language sql
stable security definer
set search_path to ''
as $function$
  with plan as (
    select p.tournament_id, p.game_duration_minutes as dur,
           greatest(1, coalesce(p.game_duration_minutes, 0) + coalesce(p.changeover_minutes, 0)) as step,
           p.day_start_time, p.day_end_time
    from public.tournament_plans p where p.id = p_plan_id
  ),
  w as (
    select d.day_date, tp.pitch_id,
           greatest(plan.day_start_time, tp.start_time) as opens,
           least(plan.day_end_time, tp.end_time) as closes,
           plan.dur, plan.step
    from plan
    join public.tournament_plan_days d on d.plan_id = p_plan_id
    join public.tournament_pitches tp on tp.tournament_id = plan.tournament_id and tp.reserved_on = d.day_date
  )
  select w.day_date, w.pitch_id, s.t, s.t + make_interval(mins => w.dur),
         row_number() over (order by w.day_date, s.t, w.pitch_id)
  from w
  cross join lateral (
    select w.opens + make_interval(mins => w.step * g.i) as t
    from generate_series(0, floor((extract(epoch from (w.closes - w.opens)) / 60 - w.dur) / w.step)::int) as g(i)
  ) s
  where w.closes > w.opens
    and w.dur is not null
    and s.t + make_interval(mins => w.dur) <= w.closes
    and s.t >= w.opens;
$function$;

-- ---- 5. the round robin scheduler: never moves a game that has a result ------------------------------

create or replace function internal.schedule_tournament_plan_games(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan public.tournament_plans;
  v_slot_count int; v_needed int; v_available int; v_blind_day text;
  v_g record; v_s record; v_placed boolean;
begin
  select * into v_plan from public.tournament_plans where id = p_plan_id;

  create temp table if not exists plan_slots (
    slot_day date, pitch_id uuid, slot_start time, slot_end time, ordinal bigint
  ) on commit drop;
  delete from plan_slots where true;
  insert into plan_slots select * from internal.tournament_plan_slots(p_plan_id);
  select count(*) into v_slot_count from plan_slots;

  -- A DAY THE ORGANISER CHOSE, AND RESERVED A PITCH FOR, MUST NOT VANISH IN SILENCE.
  select string_agg(to_char(d.day_date, 'FMDay FMDD Mon'), ', ' order by d.day_date)
  into v_blind_day
  from public.tournament_plan_days d
  where d.plan_id = p_plan_id
    and exists (select 1 from public.tournament_pitches tp
                 where tp.tournament_id = v_plan.tournament_id and tp.reserved_on = d.day_date)
    and not exists (select 1 from plan_slots s where s.slot_day = d.day_date);
  if v_blind_day is not null then
    raise exception
      'Pitches are reserved on % but no game can be played then: the playing hours are %-% and the reservations fall outside them. Widen the playing hours, or change the reservation.',
      v_blind_day, to_char(v_plan.day_start_time, 'HH24:MI'), to_char(v_plan.day_end_time, 'HH24:MI')
      using errcode = '22023';
  end if;

  -- THE GAMES THIS PASS MAY MOVE: those with no result and nothing submitted. A played game keeps its
  -- place and counts as occupancy, so rescheduling can never rewrite history.
  update public.tournament_games g
  set start_time = null, pitch_id = null,
      game_date = (select min(day_date) from public.tournament_plan_days where plan_id = p_plan_id)
  where g.plan_id = p_plan_id and g.result_status = 'none'
    and not exists (select 1 from public.tournament_game_result_submissions s where s.game_id = g.id);

  -- NO PITCHES RESERVED IS NOT A FAILURE AT THIS STAGE: the pairings are real; the readiness
  -- calculation reports the games without a kick-off and offers the route to give them one.
  if v_slot_count = 0 then return; end if;

  -- WHAT A PLAN ACTUALLY NEEDS IS KICK-OFF TIMES, not pitches (a pitch is not exclusive).
  select count(distinct (slot_day, slot_start)) into v_available from plan_slots;
  select coalesce(max(round_number), 1) into v_needed from public.tournament_games where plan_id = p_plan_id;
  if v_needed > v_available then
    raise exception
      '% rounds need % kick-off times, but the selected days and reserved pitches provide %. Widen the playing hours, shorten the games, or add another day.',
      v_needed, v_needed, v_available
      using errcode = '22023';
  end if;

  for v_g in
    select g.id, g.side_a_id, g.side_b_id
    from public.tournament_games g
    where g.plan_id = p_plan_id and g.start_time is null
    order by g.round_number nulls last, g.sort_order, g.id
  loop
    v_placed := false;
    for v_s in
      select s.*,
             (select count(*) from public.tournament_games o
               where o.tournament_id = v_plan.tournament_id and o.game_date = s.slot_day
                 and o.pitch_id = s.pitch_id and o.start_time is not null
                 and o.start_time < s.slot_end
                 and s.slot_start < o.start_time + make_interval(mins => coalesce(o.duration_minutes, v_plan.game_duration_minutes))
             ) as load
      from plan_slots s
      order by s.slot_day, s.slot_start, load, s.ordinal
    loop
      -- THE ONLY THING THAT CANNOT HAPPEN IS A SIDE IN TWO PLACES AT ONCE (a pitch is not exclusive).
      if not exists (
        select 1 from public.tournament_games o
        where o.tournament_id = v_plan.tournament_id and o.id <> v_g.id
          and o.game_date = v_s.slot_day and o.start_time is not null
          and (o.side_a_id in (v_g.side_a_id, v_g.side_b_id) or o.side_b_id in (v_g.side_a_id, v_g.side_b_id))
          and o.start_time < v_s.slot_end
          and v_s.slot_start < o.start_time + make_interval(mins => coalesce(o.duration_minutes, v_plan.game_duration_minutes))
      ) then
        update public.tournament_games
        set game_date = v_s.slot_day, start_time = v_s.slot_start, pitch_id = v_s.pitch_id,
            duration_minutes = v_plan.game_duration_minutes
        where id = v_g.id;
        v_placed := true;
        exit;
      end if;
    end loop;

    if not v_placed then
      raise exception
        'The games cannot be arranged without a side playing twice at once. Widen the playing hours, shorten the games, or add another day.'
        using errcode = '22023';
    end if;
  end loop;
end;
$function$;

-- ---- 6. the knockout scheduler: inside the playing hours, and a round never before its feeders end -----

create or replace function internal.bracket_slots_available(p_plan_id uuid)
returns table (slot_day date, slot_start time, pitch_id uuid, ordinal integer)
language sql
stable security definer
set search_path to ''
as $function$
  select s.slot_day, s.slot_start, s.pitch_id, s.ordinal::int
  from internal.tournament_plan_slots(p_plan_id) s;
$function$;

create or replace function internal.schedule_bracket_pairings(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record; s record; v_n integer := 0; v_day date;
  v_dur integer; v_change integer;
  v_round integer := 0; v_round_floor timestamp; v_next_floor timestamp; v_end timestamp;
begin
  select coalesce(game_duration_minutes, 20), coalesce(changeover_minutes, 0) into v_dur, v_change
  from public.tournament_plans where id = p_plan_id;

  -- Pairings whose game already has a result keep their place; they are the fixed points of the day.
  update public.tournament_bracket_pairings bp
  set game_date = null, start_time = null, pitch_id = null, updated_at = now()
  where bp.plan_id = p_plan_id
    and not exists (select 1 from public.tournament_games g
                     where g.id = bp.game_id
                       and (g.result_status <> 'none'
                            or exists (select 1 from public.tournament_game_result_submissions x where x.game_id = g.id)));

  for r in
    select * from public.tournament_bracket_pairings
    where plan_id = p_plan_id
    order by round_number, is_third_place, game_position
  loop
    -- A NEW ROUND STARTS ONLY WHEN THE ROUND BEFORE IT HAS FINISHED (20270655: rounds do not overlap).
    -- The floor is the latest end of the previous round plus the changeover.
    if r.round_number <> v_round then
      v_round := r.round_number;
      v_round_floor := v_next_floor;
    end if;

    if r.start_time is not null then
      -- a fixed (played) pairing: it still pushes the next round's floor
      v_end := r.game_date + r.start_time + make_interval(mins => v_dur + v_change);
      v_next_floor := greatest(coalesce(v_next_floor, v_end), v_end);
      continue;
    end if;

    select day_date into v_day from public.tournament_plan_round_days
    where plan_id = p_plan_id and round_number = r.round_number;

    select a.* into s
    from internal.tournament_plan_slots(p_plan_id) a
    where (v_day is null or a.slot_day = v_day)
      and (v_round_floor is null or (a.slot_day + a.slot_start) >= v_round_floor)
    order by a.slot_day, a.slot_start,
             (select count(*) from public.tournament_bracket_pairings o
               where o.plan_id = p_plan_id and o.game_date = a.slot_day and o.start_time = a.slot_start
                 and o.pitch_id = a.pitch_id),
             a.ordinal
    limit 1;

    if s.slot_day is null then
      update public.tournament_bracket_pairings
      set game_date = null, start_time = null, pitch_id = null, updated_at = now()
      where id = r.id;
    else
      update public.tournament_bracket_pairings
      set game_date = s.slot_day, start_time = s.slot_start, pitch_id = s.pitch_id, updated_at = now()
      where id = r.id;
      v_end := s.slot_day + s.slot_start + make_interval(mins => v_dur + v_change);
      v_next_floor := greatest(coalesce(v_next_floor, v_end), v_end);
      v_n := v_n + 1;
    end if;
  end loop;

  update public.tournament_games g
  set game_date = coalesce(bp.game_date, g.game_date),
      start_time = bp.start_time, pitch_id = bp.pitch_id,
      duration_minutes = v_dur, updated_at = now()
  from public.tournament_bracket_pairings bp
  where bp.game_id = g.id and bp.plan_id = p_plan_id
    and g.result_status = 'none'
    and not exists (select 1 from public.tournament_game_result_submissions x where x.game_id = g.id);

  return v_n;
end;
$function$;

-- ---- 7. a game created for the bracket carries its length --------------------------------------------

create or replace function internal.create_bracket_game(p_plan_id uuid, p_round integer, p_game_position integer)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare v_a uuid; v_b uuid; v_t uuid; v_grade text; v_dur integer; v_id uuid; bp record;
begin
  select p.tournament_id, p.age_group, p.game_duration_minutes into v_t, v_grade, v_dur
  from public.tournament_plans p where p.id = p_plan_id;
  select participant_id into v_a from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = p_game_position * 2 - 1 and not is_third_place;
  select participant_id into v_b from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = p_game_position * 2 and not is_third_place;
  if v_a is null or v_b is null then return null; end if;

  select * into bp from public.tournament_bracket_pairings
  where plan_id = p_plan_id and round_number = p_round and game_position = p_game_position and not is_third_place;

  insert into public.tournament_games
    (tournament_id, plan_id, age_group, side_a_id, side_b_id, game_date, start_time, pitch_id, duration_minutes, status,
     round_number, bracket_position, sort_order, created_by, updated_by)
  values
    (v_t, p_plan_id, v_grade, v_a, v_b,
     coalesce(bp.game_date, (select min(d.day_date) from public.tournament_plan_days d where d.plan_id = p_plan_id)),
     bp.start_time, bp.pitch_id, v_dur,
     'SCHEDULED', p_round, p_game_position, p_round * 1000 + p_game_position, auth.uid(), auth.uid())
  returning id into v_id;

  update public.tournament_bracket_pairings set game_id = v_id, updated_at = now()
  where plan_id = p_plan_id and round_number = p_round and game_position = p_game_position and not is_third_place;
  return v_id;
end;
$function$;

-- ---- 8. is the plan still the plan for these sides? --------------------------------------------------

create or replace function internal.tournament_plan_consistency(p_plan_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_format text; v_competing uuid[]; v_placed uuid[]; v_new int; v_gone int; v_games int;
  v_pairs_differ boolean := false; v_empty_places int := 0;
begin
  v_format := internal.tournament_plan_format(p_plan_id);
  v_competing := internal.tournament_plan_sides(p_plan_id);
  select count(*) into v_games from public.tournament_games where plan_id = p_plan_id;

  if v_format = 'knockout' then
    select coalesce(array_agg(s.participant_id), '{}') into v_placed
    from public.tournament_bracket_slots s
    where s.plan_id = p_plan_id and s.round_number = 1 and not s.is_third_place and s.participant_id is not null;
    select count(*) into v_empty_places
    from public.tournament_bracket_slots s
    where s.plan_id = p_plan_id and s.round_number = 1 and not s.is_third_place
      and s.participant_id is null and not s.is_bye;
  else
    select coalesce(array_agg(s.participant_id), '{}') into v_placed
    from public.tournament_plan_table_sides s where s.plan_id = p_plan_id;
  end if;

  select count(*) into v_new from unnest(v_competing) c where not (c = any (v_placed));
  select count(*) into v_gone from unnest(v_placed) p where not (p = any (v_competing));
  v_gone := v_gone + v_empty_places;

  -- WHETHER THE GENERATED GAMES ARE STILL THE GAMES THIS ARRANGEMENT MAKES.
  if v_games > 0 then
    if v_format = 'knockout' then
      select exists (
        select 1 from public.tournament_games g
        where g.plan_id = p_plan_id and g.round_number = 1
          and not exists (
            select 1 from public.tournament_bracket_slots a
            join public.tournament_bracket_slots b
              on b.plan_id = a.plan_id and b.round_number = 1 and not b.is_third_place
             and b.position = a.position + 1
            where a.plan_id = p_plan_id and a.round_number = 1 and not a.is_third_place and a.position % 2 = 1
              and least(a.participant_id, b.participant_id) = least(g.side_a_id, g.side_b_id)
              and greatest(a.participant_id, b.participant_id) = greatest(g.side_a_id, g.side_b_id)))
      into v_pairs_differ;
    else
      select exists (
        (select p.table_id, least(p.side_a_id, p.side_b_id), greatest(p.side_a_id, p.side_b_id)
         from internal.tournament_round_robin_pairs(p_plan_id) p
         except
         select g.table_id, least(g.side_a_id, g.side_b_id), greatest(g.side_a_id, g.side_b_id)
         from public.tournament_games g where g.plan_id = p_plan_id)
        union all
        (select g.table_id, least(g.side_a_id, g.side_b_id), greatest(g.side_a_id, g.side_b_id)
         from public.tournament_games g where g.plan_id = p_plan_id
         except
         select p.table_id, least(p.side_a_id, p.side_b_id), greatest(p.side_a_id, p.side_b_id)
         from internal.tournament_round_robin_pairs(p_plan_id) p))
      into v_pairs_differ;
    end if;
  end if;

  return jsonb_build_object(
    'competing', cardinality(v_competing),
    'placed', cardinality(v_placed),
    'newSides', v_new,
    'departedSides', v_gone,
    'games', v_games,
    'fixturesOutOfDate', v_games > 0 and (v_pairs_differ or v_new > 0 or v_gone > 0)
  );
end;
$function$;

-- ---- 9. readiness: one answer to "what do I need to do next?" ----------------------------------------

create or replace function internal.tournament_plan_readiness(p_plan_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_plan public.tournament_plans; v_t public.tournaments; v_format text; v_c jsonb;
  v_blockers jsonb := '[]'; v_warnings jsonb := '[]';
  v_days int; v_pitches int; v_times int; v_rounds int; v_small text; v_limit int; v_competing int;
  v_games int; v_untimed int; v_unpitched int; v_misfit int; v_places_untimed int; v_results boolean;
  v_pending int; v_stage text; v_settled int; v_total_places int; v_draw int;
  v_fixtures_out boolean;
begin
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.id is null then return null; end if;
  select * into v_t from public.tournaments where id = v_plan.tournament_id;
  v_format := internal.tournament_plan_format(p_plan_id);
  v_c := internal.tournament_plan_consistency(p_plan_id);
  v_competing := (v_c ->> 'competing')::int;
  v_games := (v_c ->> 'games')::int;
  v_fixtures_out := (v_c ->> 'fixturesOutOfDate')::boolean;
  v_results := internal.tournament_competition_has_results(v_plan.tournament_id, v_plan.age_group);

  select count(*) into v_days from public.tournament_plan_days where plan_id = p_plan_id;
  select count(*) into v_pitches from public.tournament_pitches tp
  where tp.tournament_id = v_plan.tournament_id
    and tp.reserved_on in (select day_date from public.tournament_plan_days where plan_id = p_plan_id);
  select count(distinct (s.slot_day, s.slot_start)) into v_times from internal.tournament_plan_slots(p_plan_id) s;
  select count(*) into v_pending from public.tournament_participants tp
  where tp.tournament_id = v_plan.tournament_id and tp.age_group = v_plan.age_group and tp.status = 'pending';

  -- STAGE, derived from canonical state rather than kept as a second flag.
  select count(*) filter (where g.result_status in ('final', 'external_recorded')), count(*)
  into v_settled, v_total_places
  from public.tournament_games g where g.plan_id = p_plan_id;
  if v_format = 'knockout' then
    select count(*) into v_total_places from public.tournament_bracket_pairings where plan_id = p_plan_id;
  end if;
  v_stage := case
    when v_games = 0 then 'CONFIGURING'
    when v_plan.publication_state <> 'PUBLISHED' then 'DRAFT_GENERATED'
    when v_settled > 0 and v_settled >= v_total_places then 'COMPLETED'
    when v_results then 'IN_PROGRESS'
    else 'PUBLISHED' end;

  -- ---- what generation needs ---------------------------------------------------------------------
  if v_format in ('swiss', 'hybrid') and not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'internal' and p.proname = 'tournament_' || v_format || '_supported') then
    v_blockers := v_blockers || jsonb_build_object('code', 'FORMAT_NOT_AVAILABLE', 'stage', 'generate', 'action', 'none',
      'message', format('%s planning is not available yet, so fixtures cannot be generated for this competition.',
                        case v_format when 'swiss' then 'Swiss' else 'Hybrid' end));
  end if;
  -- A VENUE IS NOT WHAT PUBLICATION NEEDS -- kick-off times are, and those come from pitches reserved
  -- at the host's own grounds. Ovalball allows a tournament without a venue, so it is said, not enforced.
  if v_t.venue_id is null then
    v_warnings := v_warnings || jsonb_build_object('code', 'NO_VENUE', 'action', 'venue',
      'message', 'The tournament has no venue recorded. Choose where it is played so teams know where to go.');
  end if;
  if v_days = 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'NO_DAYS', 'stage', 'generate', 'action', 'days',
      'message', 'Choose at least one day before generating fixtures.');
  end if;
  if v_competing < 2 then
    v_blockers := v_blockers || jsonb_build_object('code', 'TOO_FEW_TEAMS', 'stage', 'generate', 'action', 'teams',
      'message', format('A competition needs at least two teams. This one has %s.', v_competing));
  end if;
  v_limit := internal.tournament_format_side_limit(v_format);
  if v_limit is not null and v_competing <> v_limit then
    v_blockers := v_blockers || jsonb_build_object('code', 'FIELD_SIZE', 'stage', 'generate', 'action', 'teams',
      'message', format('A Tri-Fixture is exactly %s teams, each playing the other two. This competition has %s.', v_limit, v_competing));
  end if;
  if v_pending > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'AWAITING_REPLY', 'action', 'teams',
      'message', format('%s invited %s not replied yet. %s join the plan if %s accept.',
                        v_pending, case when v_pending = 1 then 'team has' else 'teams have' end,
                        case when v_pending = 1 then 'It will' else 'They will' end,
                        case when v_pending = 1 then 'it' else 'they' end));
  end if;

  if v_format = 'knockout' then
    select count(*) into v_draw from public.tournament_bracket_slots
    where plan_id = p_plan_id and round_number = 1 and not is_third_place;
    if v_draw = 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'NO_DRAW', 'stage', 'generate', 'action', 'draw',
        'message', 'Make the draw before generating the games.');
    elsif (v_c ->> 'newSides')::int > 0 or (v_c ->> 'departedSides')::int > 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'DRAW_MEMBERSHIP', 'stage', 'generate', 'action', 'draw_update',
        'message', concat_ws(' ',
          case when (v_c ->> 'newSides')::int = 1 then '1 new team is not in the draw yet.'
               when (v_c ->> 'newSides')::int > 1 then (v_c ->> 'newSides') || ' new teams are not in the draw yet.' end,
          case when (v_c ->> 'departedSides')::int = 1 then '1 place in the draw belongs to a team that has left.'
               when (v_c ->> 'departedSides')::int > 1 then (v_c ->> 'departedSides') || ' places in the draw belong to teams that have left.' end,
          'Update the draw to include exactly the teams in this competition.'));
    end if;
  else
    select string_agg(t.name, ', ' order by t.sort_order) into v_small
    from public.tournament_plan_tables t
    where t.plan_id = p_plan_id
      and (select count(*) from public.tournament_plan_table_sides s where s.table_id = t.id) < 2;
    if v_small is not null and v_competing >= 2 then
      v_blockers := v_blockers || jsonb_build_object('code', 'SMALL_TABLE', 'stage', 'generate', 'action', 'tables',
        'message', format('%s needs at least 2 teams to make a game.', v_small));
    end if;
    -- How many kick-off times the arrangement needs: a table of n plays n-1 rounds (n when odd).
    select coalesce(max(case when n % 2 = 0 then n - 1 else n end), 0) into v_rounds
    from (select count(*)::int as n from public.tournament_plan_table_sides s where s.plan_id = p_plan_id group by s.table_id) x
    where n >= 2;
    if v_pitches > 0 and v_rounds > v_times then
      v_blockers := v_blockers || jsonb_build_object('code', 'CAPACITY', 'stage', 'generate', 'action', 'schedule_settings',
        'message', format('%s rounds need %s kick-off times, but the selected days and reserved pitches provide %s. Widen the playing hours, shorten the games, or add another day.',
                          v_rounds, v_rounds, v_times));
    end if;
  end if;

  if v_pitches = 0 and v_days > 0 then
    v_warnings := v_warnings || jsonb_build_object('code', 'NO_PITCHES', 'action', 'pitches',
      'message', 'No pitches are reserved on the playing days, so games can be paired but not given kick-off times. Reserve pitches to schedule them.');
  end if;
  -- A DAY THE ORGANISER CHOSE, AND RESERVED A PITCH FOR, ON WHICH NO GAME FITS -- the scheduler's own
  -- refusal, said before Generate rather than by it.
  select string_agg(to_char(d.day_date, 'FMDay FMDD Mon'), ', ' order by d.day_date) into v_small
  from public.tournament_plan_days d
  where d.plan_id = p_plan_id
    and exists (select 1 from public.tournament_pitches tp where tp.tournament_id = v_plan.tournament_id and tp.reserved_on = d.day_date)
    and not exists (select 1 from internal.tournament_plan_slots(p_plan_id) x where x.slot_day = d.day_date);
  if v_small is not null then
    v_blockers := v_blockers || jsonb_build_object('code', 'NO_PLAYING_WINDOW', 'stage', 'generate', 'action', 'schedule_settings',
      'message', format('Pitches are reserved on %s but no game can be played then: the playing hours are %s-%s and the reservations fall outside them. Widen the playing hours, or change the reservation.',
                        v_small, to_char(v_plan.day_start_time, 'HH24:MI'), to_char(v_plan.day_end_time, 'HH24:MI')));
  end if;

  -- ---- what publication needs --------------------------------------------------------------------
  if v_games = 0 then
    v_blockers := v_blockers || jsonb_build_object('code', 'NO_GAMES', 'stage', 'publish', 'action', 'generate',
      'message', 'Generate the fixtures first.');
  else
    if v_fixtures_out then
      v_blockers := v_blockers || jsonb_build_object('code', 'FIXTURES_OUT_OF_DATE', 'stage', 'publish',
        'action', case when v_results then 'none' when v_format = 'knockout' and ((v_c ->> 'newSides')::int > 0 or (v_c ->> 'departedSides')::int > 0) then 'draw_update' else 'regenerate' end,
        'message', concat_ws(' ',
          case when (v_c ->> 'newSides')::int = 1 then '1 team has joined since the fixtures were generated.'
               when (v_c ->> 'newSides')::int > 1 then (v_c ->> 'newSides') || ' teams have joined since the fixtures were generated.' end,
          case when (v_c ->> 'departedSides')::int >= 1 then 'A team has left since the fixtures were generated.' end,
          case when (v_c ->> 'newSides')::int = 0 and (v_c ->> 'departedSides')::int = 0
               then 'The tables or the draw have changed since the fixtures were generated.' end,
          'Regenerate the fixtures so every team plays the right games.'));
    end if;

    select count(*) filter (where g.start_time is null),
           count(*) filter (where g.start_time is not null and g.pitch_id is null),
           count(*) filter (where g.start_time is not null and g.result_status = 'none'
                              and (not exists (select 1 from public.tournament_plan_days d where d.plan_id = p_plan_id and d.day_date = g.game_date)
                                   or g.start_time < v_plan.day_start_time
                                   or g.start_time + make_interval(mins => coalesce(g.duration_minutes, v_plan.game_duration_minutes)) > v_plan.day_end_time))
    into v_untimed, v_unpitched, v_misfit
    from public.tournament_games g where g.plan_id = p_plan_id;

    if v_format = 'knockout' then
      select count(*) into v_places_untimed from public.tournament_bracket_pairings bp
      where bp.plan_id = p_plan_id and bp.start_time is null and bp.game_id is null;
    else
      v_places_untimed := 0;
    end if;

    if v_untimed + v_places_untimed > 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'UNSCHEDULED', 'stage', 'publish',
        'action', case when v_pitches = 0 then 'pitches' else 'schedule' end,
        'count', v_untimed + v_places_untimed,
        'message', format('%s of %s %s no kick-off time yet. %s',
          v_untimed + v_places_untimed, v_games + v_places_untimed,
          case when v_untimed + v_places_untimed = 1 then 'game has' else 'games have' end,
          case when v_pitches = 0 then 'Reserve pitches for the playing days, then schedule the games.'
               else 'Schedule the games into the reserved pitches, or set their times by hand.' end));
    end if;
    if v_misfit > 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'SCHEDULE_OUT_OF_DATE', 'stage', 'publish', 'action', 'schedule',
        'count', v_misfit,
        'message', format('%s %s outside the playing days or hours set for this competition. Schedule the games again.',
                          v_misfit, case when v_misfit = 1 then 'game falls' else 'games fall' end));
    end if;
    if v_unpitched > 0 then
      v_warnings := v_warnings || jsonb_build_object('code', 'NO_PITCH', 'action', 'schedule', 'count', v_unpitched,
        'message', format('%s %s a kick-off time but no pitch.', v_unpitched, case when v_unpitched = 1 then 'game has' else 'games have' end));
    end if;
  end if;

  return jsonb_build_object(
    'stage', v_stage,
    'format', v_format,
    'publicationState', v_plan.publication_state,
    'hasResults', v_results,
    'consistency', v_c,
    'gameCount', v_games,
    'readyToGenerate', not v_results and not exists (
      select 1 from jsonb_array_elements(v_blockers) b where b ->> 'stage' = 'generate'),
    'readyToPublish', v_plan.publication_state = 'DRAFT' and jsonb_array_length(v_blockers) = 0,
    'canRegenerate', v_games > 0 and not v_results,
    'canSchedule', v_games > 0 and v_pitches > 0,
    'blockers', v_blockers,
    'warnings', v_warnings
  );
end;
$function$;

-- The organiser's read of it.
create or replace function public.get_tournament_plan_readiness(p_plan_id uuid)
returns jsonb
language plpgsql
stable security definer
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
  return internal.tournament_plan_readiness(p_plan_id);
end;
$function$;
revoke all on function public.get_tournament_plan_readiness(uuid) from public, anon;
grant execute on function public.get_tournament_plan_readiness(uuid) to authenticated;

-- Raise the first blocker for a stage, exactly as the screens show it.
create or replace function internal.refuse_unless_plan_ready(p_plan_id uuid, p_stage text)
returns void
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v_r jsonb; v_b jsonb;
begin
  v_r := internal.tournament_plan_readiness(p_plan_id);
  select b into v_b from jsonb_array_elements(v_r -> 'blockers') b
  where (p_stage = 'generate' and b ->> 'stage' = 'generate')
     or (p_stage = 'publish')
  limit 1;
  if v_b is not null then
    raise exception '%', v_b ->> 'message' using errcode = '22023', hint = 'TOURNAMENT_PLAN_' || (v_b ->> 'code');
  end if;
end;
$function$;

-- ---- 10. a plan starts with the sides that compete ---------------------------------------------------

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

  select id into v_plan from public.tournament_plans
  where tournament_id = p_tournament_id and age_group = p_age_group and publication_state <> 'SUPERSEDED';
  if v_plan is not null then
    -- An existing plan is returned as it is -- and brought up to date with the competition's sides,
    -- which is the same reconciliation every membership change already runs.
    perform internal.reconcile_tournament_competition_seating(p_tournament_id, p_age_group);
    return v_plan;
  end if;

  select * into v_d from internal.tournament_plan_defaults(p_tournament_id, p_age_group);

  insert into public.tournament_plans (
    tournament_id, age_group, game_duration_minutes, changeover_minutes, day_start_time, day_end_time,
    created_by, updated_by)
  values (p_tournament_id, p_age_group, v_d.game_duration_minutes, v_d.changeover_minutes,
          v_d.day_start_time, v_d.day_end_time, auth.uid(), auth.uid())
  returning id into v_plan;

  select t.event_date, coalesce(t.ends_on, t.event_date) into v_from, v_to
  from public.tournaments t where t.id = p_tournament_id;
  v_day := v_from;
  while v_day <= v_to loop
    insert into public.tournament_plan_days (plan_id, day_date) values (v_plan, v_day);
    v_day := v_day + 1;
  end loop;

  insert into public.tournament_plan_tables (plan_id, name, sort_order) values (v_plan, 'Table A', 1)
  returning id into v_table;
  for v_p in select tp.id from public.tournament_participants tp
             where tp.tournament_id = p_tournament_id and tp.age_group = p_age_group
               and internal.tournament_side_competes(tp.status)
             order by tp.created_at, tp.id
  loop
    v_i := v_i + 1;
    insert into public.tournament_plan_table_sides (table_id, plan_id, participant_id, position)
    values (v_table, v_plan, v_p.id, v_i);
  end loop;

  return v_plan;
end;
$function$;

-- ---- 11. tables: an unchanged arrangement is not a change -------------------------------------------

create or replace function public.set_tournament_plan_tables(p_plan_id uuid, p_tables jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tournament uuid; v_grade text; v_t jsonb; v_table uuid; v_sort int := 0; v_side text; v_pos int;
  v_seen uuid[] := '{}'; v_id uuid; v_total int; v_available int; v_current jsonb; v_wanted jsonb;
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

  -- AN UNCHANGED ARRANGEMENT IS NOT A CHANGE. Planning saves on every Continue; rebuilding identical
  -- tables used to set every generated game's table_id to NULL, results included.
  select coalesce(jsonb_agg(jsonb_build_object('name', t.name,
           'sides', coalesce((select jsonb_agg(s.participant_id::text order by s.position)
                              from public.tournament_plan_table_sides s where s.table_id = t.id), '[]'::jsonb))
           order by t.sort_order), '[]'::jsonb)
  into v_current
  from public.tournament_plan_tables t where t.plan_id = p_plan_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'name', coalesce(nullif(btrim(x.v->>'name'), ''), 'Table ' || chr(64 + x.n::int)),
           'sides', coalesce(x.v->'sides', '[]'::jsonb)) order by x.n), '[]'::jsonb)
  into v_wanted
  from jsonb_array_elements(p_tables) with ordinality x(v, n);
  if v_current = v_wanted then
    return;
  end if;

  perform internal.refuse_if_competition_has_results(v_tournament, v_grade, 'moved within');

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
      insert into public.tournament_plan_table_sides (table_id, plan_id, participant_id, position)
      values (v_table, p_plan_id, v_id, v_pos);
    end loop;
  end loop;

  -- EVERY SIDE IN THE COMPETITION IS PLACED -- every side that competes.
  v_available := cardinality(internal.tournament_plan_sides(p_plan_id));
  select count(*) into v_total from public.tournament_plan_table_sides where plan_id = p_plan_id;
  if v_total <> v_available then
    raise exception 'All % sides in this competition must be placed; % were.', v_available, v_total
      using errcode = '22023';
  end if;

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
end;
$function$;

-- ---- 12. generating asks the same readiness the screens show -----------------------------------------

create or replace function public.generate_tournament_plan_fixtures(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan public.tournament_plans;
  v_first_day date;
  v_n int;
  v_format text;
begin
  perform internal.require_live_session();
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.id is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_plan.tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  if v_plan.publication_state = 'SUPERSEDED' then
    raise exception 'That plan has been replaced.' using errcode = '22023';
  end if;
  v_format := internal.tournament_plan_format(p_plan_id);
  if v_format = 'knockout' then
    raise exception 'A knockout is generated from its draw.' using errcode = '22023';
  end if;

  -- RESULT HISTORY IS NOT A DRAFT, and clearing it is not a planning operation.
  declare v_history record;
  begin
    select * into v_history from internal.tournament_plan_result_history(p_plan_id);
    if v_history.games_with_results > 0 then
      raise exception
        '% game(s) in this plan already have a result (% confirmed, % submission(s) recorded). Regenerating would delete them and everything both sides said about them. Change the days, tables or settings instead, or clear the results deliberately first.',
        v_history.games_with_results, v_history.confirmed, v_history.submissions
        using errcode = '22023', hint = 'TOURNAMENT_PLAN_HAS_RESULTS';
    end if;
  end;

  -- THE SAME ANSWER PLANNING SHOWS. Seating is brought up to date first, so an outdated client cannot
  -- generate against a stale arrangement; then anything that would make the games wrong refuses.
  perform internal.reconcile_tournament_competition_seating(v_plan.tournament_id, v_plan.age_group);
  perform internal.refuse_unless_plan_ready(p_plan_id, 'generate');

  select min(day_date) into v_first_day from public.tournament_plan_days where plan_id = p_plan_id;

  delete from public.tournament_games where plan_id = p_plan_id;

  insert into public.tournament_games (
    tournament_id, plan_id, table_id, age_group, side_a_id, side_b_id,
    game_date, duration_minutes, status, sort_order, round_number, created_by, updated_by)
  select v_plan.tournament_id, p_plan_id, p.table_id, v_plan.age_group, p.side_a_id, p.side_b_id,
         v_first_day, v_plan.game_duration_minutes, 'SCHEDULED',
         row_number() over (order by p.table_sort, p.round_number, p.pair_in_round),
         p.round_number, auth.uid(), auth.uid()
  from internal.tournament_round_robin_pairs(p_plan_id) p;

  get diagnostics v_n = row_count;

  perform internal.schedule_tournament_plan_games(p_plan_id);

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
  return v_n;
end;
$function$;

create or replace function public.generate_tournament_knockout_fixtures(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid; v_rounds integer; v_size integer; v_round integer; v_pos integer; v_n integer := 0;
begin
  perform internal.require_live_session();
  select tournament_id into v_tournament from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  perform internal.refuse_if_bracket_has_results(p_plan_id);
  perform internal.refuse_unless_plan_ready(p_plan_id, 'generate');

  select count(*) into v_size from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = 1 and not is_third_place;
  v_rounds := internal.bracket_rounds(v_size);

  delete from public.tournament_games where plan_id = p_plan_id;
  delete from public.tournament_bracket_pairings where plan_id = p_plan_id;

  for v_round in 1 .. v_rounds loop
    for v_pos in 1 .. (v_size / power(2, v_round)::int) loop
      if v_round > 1 or not exists (
        select 1 from public.tournament_bracket_slots s
        where s.plan_id = p_plan_id and s.round_number = v_round and not s.is_third_place
          and s.position in (v_pos * 2 - 1, v_pos * 2) and s.is_bye
      ) then
        insert into public.tournament_bracket_pairings (plan_id, round_number, game_position)
        values (p_plan_id, v_round, v_pos);
      end if;
    end loop;
  end loop;

  if (select third_place_playoff from public.tournament_plans where id = p_plan_id) and v_rounds >= 2 then
    insert into public.tournament_bracket_pairings (plan_id, round_number, game_position, is_third_place)
    values (p_plan_id, v_rounds, 2, true);
  end if;

  perform internal.schedule_bracket_pairings(p_plan_id);

  for v_round in 1 .. v_rounds loop
    for v_pos in 1 .. (v_size / power(2, v_round)::int) loop
      if internal.create_bracket_game(p_plan_id, v_round, v_pos) is not null then
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;

  perform internal.ensure_third_place_game(p_plan_id);

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
  return v_n;
end;
$function$;

-- ---- 13. completing the schedule without re-pairing anybody ------------------------------------------

create or replace function public.schedule_tournament_plan(p_plan_id uuid)
returns jsonb
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
  if not exists (select 1 from public.tournament_games where plan_id = p_plan_id)
     and not exists (select 1 from public.tournament_bracket_pairings where plan_id = p_plan_id) then
    raise exception 'Generate the fixtures first.' using errcode = '22023';
  end if;
  if not exists (select 1 from internal.tournament_plan_slots(p_plan_id)) then
    raise exception 'No pitches are reserved inside the playing hours on the playing days, so there is nowhere to put the games. Reserve pitches first.'
      using errcode = '22023', hint = 'TOURNAMENT_PLAN_NO_PITCHES';
  end if;

  if internal.tournament_plan_format(p_plan_id) = 'knockout' then
    perform internal.schedule_bracket_pairings(p_plan_id);
  else
    perform internal.schedule_tournament_plan_games(p_plan_id);
  end if;

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
  return internal.tournament_plan_readiness(p_plan_id);
end;
$function$;
revoke all on function public.schedule_tournament_plan(uuid) from public, anon;
grant execute on function public.schedule_tournament_plan(uuid) to authenticated;

-- ---- 14. one action to bring a knockout draw up to date ----------------------------------------------

create or replace function public.update_tournament_draw_membership(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid; v_size integer; v_order integer[]; v_current uuid[]; v_competing uuid[]; v_new uuid[];
begin
  perform internal.require_live_session();
  select tournament_id into v_tournament from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  perform internal.refuse_if_bracket_has_results(p_plan_id);

  -- THE DRAW AS IT STANDS, in seed order: the side holding seed k sits where the seed order puts k.
  select count(*) into v_size from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = 1 and not is_third_place;
  if v_size = 0 then
    raise exception 'Make the draw first.' using errcode = '22023';
  end if;
  v_order := internal.bracket_seed_order(v_size);
  v_competing := internal.tournament_plan_sides(p_plan_id);

  select coalesce(array_agg(s.participant_id order by k.seed), '{}') into v_current
  from unnest(v_order) with ordinality k(seed, slot)
  join public.tournament_bracket_slots s
    on s.plan_id = p_plan_id and s.round_number = 1 and not s.is_third_place and s.position = k.slot
  where s.participant_id is not null and s.participant_id = any (v_competing);

  -- Everybody already drawn keeps their order; a team that has joined takes the next seed.
  select coalesce(array_agg(c order by tp.created_at, tp.id), '{}') into v_new
  from unnest(v_competing) c join public.tournament_participants tp on tp.id = c
  where not (c = any (v_current));

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
  return internal.write_tournament_draw(p_plan_id, v_current || v_new);
end;
$function$;
revoke all on function public.update_tournament_draw_membership(uuid) from public, anon;
grant execute on function public.update_tournament_draw_membership(uuid) to authenticated;

-- ---- 15. publishing asks the same readiness ----------------------------------------------------------

create or replace function public.publish_tournament_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_tournament_id uuid;
  v_age_group text;
begin
  perform internal.require_live_session();
  select tournament_id, age_group into v_tournament_id, v_age_group
  from public.tournament_plans where id = p_plan_id;

  if v_tournament_id is null then
    raise exception 'Tournament plan not found.' using errcode = 'P0002';
  end if;
  if not internal.can_manage_tournament(v_tournament_id) then
    raise exception 'You do not have permission to publish this tournament plan.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tournaments where id = v_tournament_id and cancelled_at is not null) then
    raise exception 'This tournament has been cancelled.' using errcode = '22023';
  end if;

  if not exists (select 1 from public.tournament_games where plan_id = p_plan_id) then
    raise exception 'This plan has no games yet. Generate fixtures before publishing.' using errcode = '22023';
  end if;
  if (select publication_state from public.tournament_plans where id = p_plan_id) <> 'DRAFT' then
    raise exception 'That plan is not in draft, or no longer exists.' using errcode = '22023';
  end if;

  -- WHAT IS NEEDED BEFORE PEOPLE ARE TOLD: every game a kick-off, every team placed, nothing out of date.
  perform internal.refuse_unless_plan_ready(p_plan_id, 'publish');

  update public.tournament_plans
  set publication_state = 'PUBLISHED', published_by = auth.uid(), published_at = now(),
      updated_by = auth.uid(), updated_at = now()
  where id = p_plan_id and publication_state = 'DRAFT';

  if not found then
    raise exception 'That plan is not in draft, or no longer exists.' using errcode = '22023';
  end if;

  perform internal.notify_tournament_participants(
    v_tournament_id, v_age_group, auth.uid(),
    'tournament_schedule_published',
    'Tournament schedule published',
    format('The %s schedule for %s has been published.', v_age_group, (select name from public.tournaments where id = v_tournament_id)),
    jsonb_build_object('tournament_id', v_tournament_id, 'tournament_plan_id', p_plan_id)
  );
end;
$function$;

-- ---- 16. a draft is the organiser's until it is published --------------------------------------------

create or replace function internal.tournament_plan_readable(p_plan_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.tournament_plans p
    where p.id = p_plan_id
      and internal.tournament_visible_row(p.tournament_id)
      and (p.publication_state = 'PUBLISHED' or internal.can_manage_tournament(p.tournament_id))
  );
$function$;

drop policy if exists tournament_games_select on public.tournament_games;
create policy tournament_games_select on public.tournament_games for select to authenticated
  using (case when plan_id is null then internal.tournament_visible_row(tournament_id)
              else internal.tournament_plan_readable(plan_id) end);

drop policy if exists tournament_plan_days_select_scoped on public.tournament_plan_days;
create policy tournament_plan_days_select_scoped on public.tournament_plan_days for select
  using (internal.tournament_plan_readable(plan_id));

drop policy if exists tournament_plan_round_days_select on public.tournament_plan_round_days;
create policy tournament_plan_round_days_select on public.tournament_plan_round_days for select to authenticated
  using (internal.tournament_plan_readable(plan_id));

drop policy if exists tournament_plan_tables_select_scoped on public.tournament_plan_tables;
create policy tournament_plan_tables_select_scoped on public.tournament_plan_tables for select
  using (internal.tournament_plan_readable(plan_id));

drop policy if exists tournament_plan_table_sides_select_scoped on public.tournament_plan_table_sides;
create policy tournament_plan_table_sides_select_scoped on public.tournament_plan_table_sides for select
  using (internal.tournament_plan_readable(plan_id));

drop policy if exists tournament_bracket_slots_select on public.tournament_bracket_slots;
create policy tournament_bracket_slots_select on public.tournament_bracket_slots for select to authenticated
  using (internal.tournament_plan_readable(plan_id));

drop policy if exists tournament_bracket_pairings_select on public.tournament_bracket_pairings;
create policy tournament_bracket_pairings_select on public.tournament_bracket_pairings for select to authenticated
  using (internal.tournament_plan_readable(plan_id));

-- ---- 17. the planning reads carry the plan's own format and its readiness ------------------------

CREATE OR REPLACE FUNCTION public.get_tournament_plan(p_tournament_id uuid, p_age_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.tournaments;
  v_plan public.tournament_plans;
  v_defaults record;
begin
  perform internal.require_live_session();
  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then return null; end if;
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  select * into v_plan from public.tournament_plans
  where tournament_id = p_tournament_id and age_group = p_age_group and publication_state <> 'SUPERSEDED';

  select * into v_defaults from internal.tournament_plan_defaults(p_tournament_id, p_age_group);

  return jsonb_build_object(
    'tournamentId', v_t.id,
    'tournamentName', v_t.name,
    'ageGroup', p_age_group,
    'format', coalesce(v_plan.format, v_t.format),
    'swissRounds', v_t.swiss_rounds,
    'venueName', (select v.name from public.venues v where v.id = v_t.venue_id),
    -- THE TOURNAMENT'S OWN RANGE, which planning selects from and never changes.
    'tournamentStartsOn', v_t.event_date,
    'tournamentEndsOn', coalesce(v_t.ends_on, v_t.event_date),
    -- Every competition this tournament runs, so the Planning header can offer the age-group context.
    'ageGroups', coalesce((select jsonb_agg(g.age_group order by g.age_group)
                           from public.tournament_age_groups g where g.tournament_id = p_tournament_id), '[]'::jsonb),

    -- THE SIDES THIS COMPETITION HAS. Planning operates on these ids and never on a club's name; a
    -- club Ovalball does not have is a side here exactly like any other.
    -- WHICH SCORING RULES CAN ACTUALLY BE APPLIED, and why not where they cannot. Planning draws
    -- its controls from this rather than deciding on the device.
    'scoringRules', case when v_plan.id is not null then internal.tournament_scoring_rules(v_plan.id) end,
    'losingBonusMargin', v_plan.losing_bonus_margin,
    'tieBreakers', to_jsonb(v_plan.tie_breakers),
    'sides', coalesce((
      -- ONE DEFINITION OF A PARTICIPATING SIDE, shared with the participant Centre and with
      -- Results. `onOvalball` asks whether anybody could actually answer for this side, which is
      -- the question every surface downstream needs and the one the old inline test got wrong.
      select jsonb_agg(internal.tournament_side_summary(tp.id, v_t.host_club_id)
        || jsonb_build_object('status', tp.status, 'competes', internal.tournament_side_competes(tp.status))
      order by (tp.club_id is not null and tp.club_id = v_t.host_club_id) desc, cd.name, tp.id)
      from public.tournament_participants tp
      join public.club_directory cd on cd.id = tp.club_directory_id
      left join public.teams tm on tm.id = tp.team_id
      where tp.tournament_id = p_tournament_id and tp.age_group = p_age_group
    ), '[]'::jsonb),

    -- WHAT THE DEFAULTS WOULD BE, and where they come from, so Settings can say so rather than
    -- presenting a number nobody chose.
    'defaults', jsonb_build_object(
      'gameDurationMinutes', v_defaults.game_duration_minutes,
      'changeoverMinutes', v_defaults.changeover_minutes,
      'dayStartTime', v_defaults.day_start_time,
      'dayEndTime', v_defaults.day_end_time,
      'durationSource', v_defaults.duration_source),

    'pitchesReserved', (select count(*) from public.tournament_pitches where tournament_id = p_tournament_id),

    'plan', case when v_plan.id is null then null else jsonb_build_object(
      'id', v_plan.id,
      'publicationState', v_plan.publication_state,
      'version', v_plan.version,
      'publishedAt', v_plan.published_at,
      'gameDurationMinutes', v_plan.game_duration_minutes,
      'changeoverMinutes', v_plan.changeover_minutes,
      'dayStartTime', v_plan.day_start_time,
      'dayEndTime', v_plan.day_end_time,
      'pointsWin', v_plan.points_win,
      'pointsDraw', v_plan.points_draw,
      'pointsLoss', v_plan.points_loss,
      'pointsTryBonus', v_plan.points_try_bonus,
      'pointsLosingBonus', v_plan.points_losing_bonus,
      'days', coalesce((select jsonb_agg(d.day_date order by d.day_date)
                        from public.tournament_plan_days d where d.plan_id = v_plan.id), '[]'::jsonb),
      'tables', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'name', t.name, 'sortOrder', t.sort_order,
          'sides', coalesce((select jsonb_agg(s.participant_id order by s.position)
                             from public.tournament_plan_table_sides s where s.table_id = t.id), '[]'::jsonb)
        ) order by t.sort_order)
        from public.tournament_plan_tables t where t.plan_id = v_plan.id), '[]'::jsonb),
      'gameCount', (select count(*) from public.tournament_games where plan_id = v_plan.id),

      -- THE KNOCKOUT SETTINGS THE PLAN ALREADY HOLDS. Planning's Settings step is a set of controls
      -- over these columns, so it has to be able to read them: a step that opens at its defaults every
      -- time does not merely display the wrong thing, it writes the wrong thing back the moment the
      -- organiser presses Generate, quietly discarding the extra time, the tie resolution, the
      -- play-off and the round days somebody chose earlier.
      'drawMethod', v_plan.draw_method,
      'tieResolution', v_plan.tie_resolution,
      'extraTimeMinutes', v_plan.extra_time_minutes,
      'thirdPlacePlayoff', v_plan.third_place_playoff,
      'roundDays', coalesce((select jsonb_agg(jsonb_build_object('round', r.round_number, 'day', r.day_date)
                                              order by r.round_number)
                             from public.tournament_plan_round_days r where r.plan_id = v_plan.id), '[]'::jsonb),

      -- WHETHER THIS COMPETITION KEEPS A TABLE, resolved by the one authority rather than inferred from
      -- the format by each surface in turn. A Tri-Fixture is three sides sharing a morning until the
      -- organiser says it is a competition; a Round Robin has always kept one.
      'standingsEnabled', internal.tournament_plan_has_standings(v_plan.id),
      -- What the organiser has actually chosen, as opposed to what the format does by default. NULL is
      -- "not asked yet", which is a different thing from "no" and is why the control can show it.
      'standingsChoice', v_plan.standings_enabled,
      -- How many sides this format allows, where it constrains its field at all. The Teams step says so
      -- before the organiser builds something that will be refused.
      'fieldSize', internal.tournament_format_side_limit(coalesce(v_plan.format, v_t.format)),
      -- WHAT THE PLAN NEEDS NEXT, and why: the same answer Generate and Publish enforce.
      'readiness', internal.tournament_plan_readiness(v_plan.id)
    ) end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_tournament_plan_draft(p_tournament_id uuid, p_age_group text, p_preview boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.tournaments;
  v_plan public.tournament_plans;
  v_tables jsonb;
begin
  perform internal.require_live_session();

  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then return null; end if;
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  select * into v_plan from public.tournament_plans
  where tournament_id = p_tournament_id and age_group = p_age_group and publication_state <> 'SUPERSEDED';

  if v_plan.id is null then
    return jsonb_build_object(
      'tournamentId', v_t.id, 'tournamentName', v_t.name, 'ageGroup', p_age_group,
      'format', coalesce(v_plan.format, v_t.format),
      'preview', p_preview, 'plan', null, 'tables', '[]'::jsonb);
  end if;

  -- ONE TABLE AT A TIME: who is in it, then its rounds, then the games in each round. The ordering is
  -- the competition's own -- table order, round number, then the pair's place in the round -- so two
  -- organisers reading the same draft read it in the same order.
  select coalesce(jsonb_agg(x.table_json order by x.sort_order, x.table_name), '[]'::jsonb)
  into v_tables
  from (
    select
      t.sort_order,
      t.name as table_name,
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        -- THE TABLE'S MEMBERSHIP, so a round's pairings can be read against who is in the table.
        'sides', coalesce((
          select jsonb_agg(jsonb_build_object(
            'participantId', tp.id,
            'clubName', cd.name,
            'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),
            'label', coalesce(tm.display_name,
                              case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label else tp.age_group end),
            'isHost', (tp.club_id is not null and tp.club_id = v_t.host_club_id)
          ) order by s.position)
          from public.tournament_plan_table_sides s
          join public.tournament_participants tp on tp.id = s.participant_id
          join public.club_directory cd on cd.id = tp.club_directory_id
          left join public.teams tm on tm.id = tp.team_id
          where s.table_id = t.id), '[]'::jsonb),
        'rounds', coalesce((
          select jsonb_agg(r.round_json order by r.round_number)
          from (
            select
              g.round_number,
              jsonb_build_object(
                'round', g.round_number,
                'games', jsonb_agg(g.game_json order by g.sort_order)
              ) as round_json
            from (
              -- THE REAL ROWS, or the pairs a generation would make. Same columns either way.
              select
                coalesce(gm.round_number, 1) as round_number,
                gm.sort_order,
                jsonb_build_object(
                  'id', gm.id,
                  'round', gm.round_number,
                  'date', gm.game_date,
                  -- NULL IS THE ANSWER WHEN NOTHING HAS BEEN DECIDED, and the screen says so in words.
                  'startTime', gm.start_time,
                  'durationMinutes', gm.duration_minutes,
                  'pitchName', (select cp.display_name from public.club_pitches cp where cp.id = gm.pitch_id),
                  'sideA', jsonb_build_object(
                    'participantId', a.id, 'clubName', cda.name,
                    'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = a.club_id), cda.logo_storage_path),
                    'label', coalesce(ta.display_name,
                                      case when a.squad_label is not null then a.age_group || ' ' || a.squad_label else a.age_group end)),
                  'sideB', jsonb_build_object(
                    'participantId', b.id, 'clubName', cdb.name,
                    'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = b.club_id), cdb.logo_storage_path),
                    'label', coalesce(tb.display_name,
                                      case when b.squad_label is not null then b.age_group || ' ' || b.squad_label else b.age_group end))
                ) as game_json,
                gm.table_id
              from (
                select g2.id, g2.round_number, g2.sort_order, g2.game_date, g2.start_time,
                       g2.duration_minutes, g2.pitch_id, g2.side_a_id, g2.side_b_id, g2.table_id
                from public.tournament_games g2
                where not p_preview and g2.plan_id = v_plan.id
                union all
                select null::uuid, p.round_number,
                       (p.table_sort * 10000 + p.round_number * 100 + p.pair_in_round)::int,
                       null::date, null::time, null::int, null::uuid,
                       p.side_a_id, p.side_b_id, p.table_id
                from internal.tournament_round_robin_pairs(v_plan.id) p
                where p_preview
              ) gm
              join public.tournament_participants a on a.id = gm.side_a_id
              join public.tournament_participants b on b.id = gm.side_b_id
              join public.club_directory cda on cda.id = a.club_directory_id
              join public.club_directory cdb on cdb.id = b.club_directory_id
              left join public.teams ta on ta.id = a.team_id
              left join public.teams tb on tb.id = b.team_id
            ) g
            where g.table_id = t.id
            group by g.round_number
          ) r), '[]'::jsonb)
      ) as table_json
    from public.tournament_plan_tables t
    where t.plan_id = v_plan.id
  ) x;

  return jsonb_build_object(
    'tournamentId', v_t.id,
    'tournamentName', v_t.name,
    'ageGroup', p_age_group,
    'venueName', (select v.name from public.venues v where v.id = v_t.venue_id),
    -- WHICH SHAPE OF COMPETITION THIS DRAFT IS. The draft screen is one screen, and a knockout's games
    -- carry no table, so without this it reads a knockout as an empty round robin and tells the
    -- organiser to go and set up tables that a knockout does not have.
    'format', coalesce(v_plan.format, v_t.format),
    'preview', p_preview,
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'publicationState', v_plan.publication_state,
      'version', v_plan.version,
      'publishedAt', v_plan.published_at,
      'gameDurationMinutes', v_plan.game_duration_minutes,
      'days', coalesce((select jsonb_agg(d.day_date order by d.day_date)
                        from public.tournament_plan_days d where d.plan_id = v_plan.id), '[]'::jsonb),
      -- WHAT ACTUALLY EXISTS, counted at the source rather than summed on the phone.
      'gameCount', (select count(*) from public.tournament_games where plan_id = v_plan.id),
      'scheduledCount', (select count(*) from public.tournament_games
                         where plan_id = v_plan.id and start_time is not null),
      'pitchedCount', (select count(*) from public.tournament_games
                       where plan_id = v_plan.id and pitch_id is not null),
      'readiness', internal.tournament_plan_readiness(v_plan.id)
    ),
    'tables', coalesce(v_tables, '[]'::jsonb)
  );
end;
$function$;

revoke all on function internal.tournament_plan_readiness(uuid) from public, anon, authenticated;
revoke all on function internal.tournament_plan_consistency(uuid) from public, anon, authenticated;
revoke all on function internal.tournament_plan_slots(uuid) from public, anon, authenticated;

-- The policies above ask this as the reader, exactly as they ask tournament_visible_row.
grant execute on function internal.tournament_plan_readable(uuid) to authenticated, service_role;
