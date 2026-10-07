-- =====================================================================================================
-- A PLAYING DAY DOES NOT RUN PAST MIDNIGHT.
--
-- The scheduler built its candidate slots by taking the first kick-off and adding one game-length plus
-- changeover, two hundred times:
--
--     greatest(day_start_time, pitch start) + make_interval(mins => (duration + changeover) * i)
--     ... from generate_series(0, 200) as g(i)
--
-- `time + interval` in Postgres WRAPS at midnight. Two hundred steps of 55 minutes is over seven days,
-- so most of those rows came back round as 00:00, 00:05, 00:10 -- times that then passed the
-- "finishes before the end of the day" test, because 00:40 really is before 13:00. The slots were then
-- ordered by that wrapped time, so the earliest slot in the list was midnight, and a festival whose
-- first kick-off was half past nine generated twelve games starting at ten past twelve in the morning.
--
-- The filter could not catch it: by the time a wrapped value is compared it looks like a perfectly
-- ordinary early morning. THE FIX IS TO NEVER PRODUCE THE WRAPPED ROW -- the number of steps is
-- computed from the length of the playing window, so the series stops at the last slot that genuinely
-- fits inside the day.
--
-- Only `internal.schedule_tournament_plan_games` changes. Pairing is untouched: who plays whom was
-- always right, and it is only where and when they played that was nonsense.
--
-- WHAT DELIBERATELY DOES NOT CHANGE: a pitch is not exclusive. Several games may run on one ground at
-- the same time, because a festival pitch is split into playing areas -- so the scheduler constrains
-- SIDES, never grounds.
-- =====================================================================================================

create or replace function internal.schedule_tournament_plan_games(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan public.tournament_plans;
  v_step int;
  v_slot_count int;
  v_game_count int;
  v_needed int;
  v_available int;
  v_g record;
  v_s record;
  v_placed boolean;
  v_blind_day text;
begin
  select * into v_plan from public.tournament_plans where id = p_plan_id;

  -- ONE GAME PLUS ITS CHANGEOVER: the distance from one kick-off on a pitch to the next. Guarded
  -- against zero, because a step of nothing would be an infinite number of slots at one minute.
  v_step := greatest(1, coalesce(v_plan.game_duration_minutes, 0) + coalesce(v_plan.changeover_minutes, 0));

  create temp table if not exists plan_slots (
    slot_day date, pitch_id uuid, slot_start time, slot_end time, ordinal bigint
  ) on commit drop;
  -- `where true`, DELIBERATELY. Ovalball refuses an unqualified DELETE for a browser-originated
  -- session, which is a guard worth having and one that fires here even though the target is a
  -- throwaway temp table.
  delete from plan_slots where true;

  -- EVERY PLACE A GAME COULD GO: each reserved pitch on each selected day, stepped by the game length
  -- plus the changeover, inside both the plan's hours and the reservation's own.
  --
  -- THE NUMBER OF STEPS COMES FROM THE WINDOW, not from a round number. `w` is the usable window on
  -- that pitch that day; the series runs from the first kick-off to the last one that still leaves a
  -- whole game before the window closes, and therefore cannot reach the end of the day at all.
  insert into plan_slots (slot_day, pitch_id, slot_start, slot_end, ordinal)
  select w.day_date, w.pitch_id, s.t,
         s.t + make_interval(mins => v_plan.game_duration_minutes),
         row_number() over (order by s.t, w.day_date, w.pitch_id)
  from (
    select d.day_date, tp.pitch_id,
           greatest(v_plan.day_start_time, tp.start_time) as opens,
           least(v_plan.day_end_time, tp.end_time) as closes
    from public.tournament_plan_days d
    join public.tournament_pitches tp
      on tp.tournament_id = v_plan.tournament_id and tp.reserved_on = d.day_date
    where d.plan_id = p_plan_id
  ) w
  cross join lateral (
    select w.opens + make_interval(mins => v_step * g.i) as t
    from generate_series(
      0,
      -- How many whole games fit: the window, less one game, divided by the step. Negative when the
      -- window cannot hold a single game, and `generate_series(0, -1)` is correctly empty.
      floor(
        (extract(epoch from (w.closes - w.opens)) / 60 - v_plan.game_duration_minutes) / v_step
      )::int
    ) as g(i)
  ) s
  where w.closes > w.opens
    and s.t + make_interval(mins => v_plan.game_duration_minutes) <= w.closes;

  select count(*) into v_slot_count from plan_slots;
  select count(*) into v_game_count from public.tournament_games where plan_id = p_plan_id;

  -- A DAY THE ORGANISER CHOSE, AND RESERVED A PITCH FOR, MUST NOT VANISH IN SILENCE.
  --
  -- The playing hours are one window for the whole competition, and a reservation is a window on one
  -- pitch on one day; a game can only go where the two overlap. A club running a Friday evening
  -- session inside a plan whose hours are 09:00-13:00 has no overlap at all on the Friday -- and
  -- before this, that day simply produced no slots and every game quietly landed on the Sunday. The
  -- organiser had selected Friday, reserved a Friday pitch, and was shown a plan that used neither.
  --
  -- It refuses rather than guessing which of the two the organiser meant.
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

  -- NO PITCHES RESERVED IS NOT A FAILURE AT THIS STAGE. The pairings are real and the organiser has
  -- simply not told Ovalball which pitches the day uses yet; the draft keeps its first day and waits
  -- for the scheduling pass rather than inventing a ground.
  if v_slot_count = 0 then
    update public.tournament_games g
    set game_date = (select min(day_date) from public.tournament_plan_days where plan_id = p_plan_id),
        start_time = null, pitch_id = null
    where g.plan_id = p_plan_id;
    return;
  end if;

  -- WHAT A PLAN ACTUALLY NEEDS IS KICK-OFF TIMES, not pitches.
  --
  -- Because a pitch is shared rather than exclusive, two games can run at one moment on one ground, so
  -- counting pitch-slots would refuse arrangements that a festival runs every weekend. The real
  -- constraint is the ROUND: every side plays once in a round, so a competition of n rounds needs n
  -- distinct kick-off times, and no number of pitches creates one.
  select count(distinct (slot_day, slot_start)) into v_available from plan_slots;
  select coalesce(max(round_number), 1) into v_needed
  from public.tournament_games where plan_id = p_plan_id;

  if v_needed > v_available then
    raise exception
      '% rounds need % kick-off times, but the selected days and reserved pitches provide %. Widen the playing hours, shorten the games, or add another day.',
      v_needed, v_needed, v_available
      using errcode = '22023';
  end if;

  -- A GREEDY PASS IN PLAYING ORDER. Each game takes the earliest slot at which neither of its sides is
  -- already on a pitch -- which is what stops a side being drawn twice at the same minute, and is only
  -- possible because the pairing function hands them over in round order.
  for v_g in
    select g.id, g.side_a_id, g.side_b_id
    from public.tournament_games g
    where g.plan_id = p_plan_id
    order by g.round_number nulls last, g.sort_order, g.id
  loop
    v_placed := false;
    -- EARLIEST FIRST, THEN THE EMPTIEST GROUND. Sharing a pitch is allowed and sometimes necessary,
    -- but it is not the preference: without this the slot order is a uuid order, so four games pile
    -- onto one pitch at half past nine while the next one stands empty. `load` counts what is already
    -- on that ground at that moment, so a free pitch is always taken before a busy one.
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
      -- THE ONLY THING THAT CANNOT HAPPEN IS A SIDE IN TWO PLACES AT ONCE.
      --
      -- A PITCH IS NOT EXCLUSIVE, and that is a product rule rather than an oversight: a festival pitch
      -- is routinely split into playing areas and several games run on it at the same time. The
      -- scheduler therefore does not reject a slot because the ground already has a game on it -- how
      -- a pitch is divided is Pitch Allocation's job, and the canonical engine already treats games at
      -- ONE tournament as siblings that may share a ground.
      --
      -- A CLASH IS AN OVERLAP, NOT AN IDENTICAL KICK-OFF. The side check used to compare start times
      -- for equality, so a forty-minute game kicking off at 10:00 did not conflict with the same side
      -- being drawn again at 10:25, and both were shown to the organiser as real.
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
      -- ANOTHER PITCH WOULD NOT HELP, so it is not offered. The blocker is a SIDE with nowhere left to
      -- play -- usually because it is already in a game elsewhere at this tournament -- and only more
      -- kick-off times, or shorter games, can make room.
      raise exception
        'The games cannot be arranged without a side playing twice at once. Widen the playing hours, shorten the games, or add another day.'
        using errcode = '22023';
    end if;
  end loop;
end;
$function$;

-- ---- and no existing draft keeps a midnight kick-off -------------------------------------------------
--
-- A plan generated before this fix is holding times that were never meant. They are the organiser's
-- OWN DRAFT, so they are not deleted: the games are put back to "not yet scheduled", which is the
-- honest state and the one the Generated Draft Plan already knows how to show. The organiser presses
-- Generate again and gets real times.
--
-- CONDITIONAL ON ROWS EXISTING, not asserting that they do: an empty database is a valid database.

do $$
declare v_fixed int;
begin
  with broken as (
    select g.id
    from public.tournament_games g
    join public.tournament_plans p on p.id = g.plan_id
    where g.start_time is not null
      and g.start_time < p.day_start_time
  )
  update public.tournament_games g
  set start_time = null, pitch_id = null
  from broken b
  where g.id = b.id;
  get diagnostics v_fixed = row_count;
  if v_fixed > 0 then
    raise notice 'cleared % generated game times that fell before their plan''s first kick-off.', v_fixed;
  end if;
end $$;
