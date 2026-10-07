-- A TOURNAMENT PLAN IS EDITED, NOT REBUILT.
--
-- The organiser's job: "I have teams, dates and pitches. Build me a workable tournament, let me control
-- where and when every game happens, publish it, and let me safely change it afterwards." The canonical
-- planner already generated and published; what it could not do was hold a pitch to what it can take,
-- keep the games an organiser placed, change several games at once, or take a plan away again. This
-- evolves that one planner -- tournament_plans, tournament_games, tournament_bracket_pairings,
-- tournament_pitches and club_pitches stay the only sources -- rather than adding a second.
--
--   1. A PITCH TAKES AS MANY GAMES AS THE ORGANISER HAS MARKED IT OUT FOR (owner's rule, 2026-10-03).
--      Several games may share a kick-off on different pitches. When a pitch is reserved for a tournament
--      the organiser says how it is marked out for the day -- 1, 2, 3 or 4 playing areas
--      (tournament_pitches.playing_areas; the club's own Grounds & Pitches layout is only the default) --
--      and Ovalball allows that many games at once, as long as each game's RFU pitch size fits one area: a
--      full-size pitch fits three U10 pitches (60m x 35m) but two U12 (60m x 43m, "half a full-size
--      pitch"). The next game waits for the changeover. Across every competition of the tournament,
--      because U10 and U12 on Pitch 1 is one pitch. A team is in one game at a time; a knockout round
--      follows the round before.
--   2. ONE ENGINE, internal.tournament_schedule_conflicts, says every clash in words. The schedulers place
--      only where it would find none, a move is refused by it, and readiness will not publish past it.
--   3. A GAME AN ORGANISER PLACED STAYS PLACED (placed_by_hand) when the games are scheduled again, unless
--      the organiser asks for every game to be placed afresh.
--   4. MANY MOVES ARE ONE SAVE (save_tournament_plan_schedule), validated as one arrangement, and each team
--      in a moved published game is told once; nobody else is told anything.
--   5. A PLAN CAN BE DELETED (delete_tournament_plan) while nothing has a result -- sporting history is
--      never deleted as a planning step.
--   6. A PUBLISHED PLAN'S TABLES do not change underneath its games: the change is confirmed, then the
--      games are regenerated and the teams told.
--   7. The older hand-made schedule writers no longer rewrite planned games or results, and a reservation
--      is not released from under the games played in it.
--   8. A draft's games stay the organiser's on the Tournament Centre read.

alter table public.tournament_games add column if not exists placed_by_hand boolean not null default false;
alter table public.tournament_bracket_pairings add column if not exists placed_by_hand boolean not null default false;
comment on column public.tournament_games.placed_by_hand is
  'True when an organiser chose this game''s day, kick-off and pitch. Automatic scheduling keeps it there unless asked to place every game again.';
comment on column public.tournament_bracket_pairings.placed_by_hand is
  'True when an organiser chose this knockout place''s day, kick-off and pitch.';

-- HOW A PITCH IS MARKED OUT FOR THE TOURNAMENT -- the organiser's, for this reservation. Null is the club's
-- own layout (club_pitches.lane_count), which stays the club's and is never changed from here.
alter table public.tournament_pitches add column if not exists playing_areas integer;
alter table public.tournament_pitches drop constraint if exists tournament_pitches_playing_areas_check;
alter table public.tournament_pitches add constraint tournament_pitches_playing_areas_check
  check (playing_areas is null or playing_areas between 1 and 4);
comment on column public.tournament_pitches.playing_areas is
  'How many games the organiser has marked this pitch out for during this reservation (1-4). Null means the club''s own layout.';

-- THE RFU'S OWN MAXIMUM PITCH SIZES, as structured numbers, where Ovalball already holds them with their
-- source (Regulation 15's Rules of Play appendices, recorded in `source`). Only those rows are filled:
-- a grade whose size Ovalball has not sourced is never given one here.
alter table public.fixture_scheduling_rules add column if not exists max_pitch_length_m numeric;
alter table public.fixture_scheduling_rules add column if not exists max_pitch_width_m numeric;
comment on column public.fixture_scheduling_rules.max_pitch_length_m is
  'The RFU maximum field-of-play length for the grade, in metres, where `source` states it. Null where Ovalball holds no sourced size.';
comment on column public.fixture_scheduling_rules.max_pitch_width_m is
  'The RFU maximum field-of-play width for the grade, in metres, where `source` states it. Null where Ovalball holds no sourced size.';
update public.fixture_scheduling_rules set max_pitch_length_m = 45, max_pitch_width_m = 22
where rugby_code = 'union' and age_group = 'U8' and source like '%max pitch 45m x 22m%';
update public.fixture_scheduling_rules set max_pitch_length_m = 60, max_pitch_width_m = 35
where rugby_code = 'union' and age_group = 'U10' and source like '%max pitch 60m x 35m%';
update public.fixture_scheduling_rules set max_pitch_length_m = 60, max_pitch_width_m = 43
where rugby_code = 'union' and age_group = 'U12' and source like '%max pitch 60m x 43m%';

-- =====================================================================================================
-- 1. SMALL SHARED PIECES
-- =====================================================================================================

-- A clock time plus minutes, held at the end of the day rather than wrapping past midnight.
create or replace function internal.time_after(p_time time, p_minutes integer)
returns time
language sql
immutable
set search_path to ''
as $function$
  select case
           when p_time is null or p_minutes is null then null
           when p_time + make_interval(mins => greatest(p_minutes, 0)) < p_time then time '23:59:59'
           else p_time + make_interval(mins => greatest(p_minutes, 0))
         end;
$function$;

-- "two games", not "2 games", where a sentence reads better in words.
create or replace function internal.count_word(p_n bigint)
returns text
language sql
immutable
set search_path to ''
as $function$
  select case p_n when 1 then 'one' when 2 then 'two' when 3 then 'three' when 4 then 'four'
                  when 5 then 'five' when 6 then 'six' else p_n::text end;
$function$;

-- THE QUARTER-UNIT ARITHMETIC IS RETIRED FOR TOURNAMENTS (it could not say that three U10 games fit a
-- full-size pitch). Fixture pitch allocation keeps its own model in packages/contracts.
drop function if exists internal.pitch_capacity_units(uuid);
drop function if exists internal.tournament_footprint_units(uuid, text);

-- HOW MUCH GROUND A PITCH HAS, in square metres of field of play: the full-size reference 100m x 70m
-- (the same reference footprint.ts measures a custom pitch against), three quarters and half of it, or a
-- custom pitch's own recorded length and width.
create or replace function internal.pitch_area_m2(p_pitch_id uuid)
returns numeric
language sql
stable
security definer
set search_path to ''
as $function$
  select case p.physical_size_category
           when 'full' then 7000::numeric
           when 'three_quarter' then 5250::numeric
           when 'half' then 3500::numeric
           else coalesce(p.custom_length_m * p.custom_width_m, 7000::numeric)
         end
  from public.club_pitches p where p.id = p_pitch_id;
$function$;

-- HOW MUCH GROUND ONE GAME OF A GRADE NEEDS: its RFU maximum field of play where Ovalball holds it with its
-- source (U8 45m x 22m, U10 60m x 35m, U12 60m x 43m), otherwise its category's share of a full-size pitch
-- -- full the whole of it, reduced half, mini a quarter. A grade with no rule at all needs the whole pitch:
-- an automatic decision never assumes a game is small enough to share.
create or replace function internal.tournament_game_area_m2(p_tournament_id uuid, p_age_group text)
returns numeric
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((
    select coalesce(r.max_pitch_length_m * r.max_pitch_width_m,
                    case r.min_pitch_size_category when 'full' then 7000::numeric when 'reduced' then 3500::numeric
                                                   when 'mini' then 1750::numeric end)
    from public.fixture_scheduling_rules r
    where r.age_group = p_age_group
      and r.rugby_code = coalesce((select t.rugby_code from public.tournaments t where t.id = p_tournament_id), 'union')
    order by r.effective_season desc nulls last
    limit 1), 7000::numeric);
$function$;

-- HOW A PITCH IS MARKED OUT AT A MOMENT OF A TOURNAMENT: the organiser's playing areas for the reservation
-- covering that moment, otherwise the club's own layout.
create or replace function internal.tournament_pitch_areas_at(p_tournament_id uuid, p_pitch_id uuid, p_date date, p_at time)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select tp.playing_areas from public.tournament_pitches tp
     where tp.tournament_id = p_tournament_id and tp.pitch_id = p_pitch_id and tp.reserved_on = p_date
       and tp.start_time <= p_at and p_at < tp.end_time and tp.playing_areas is not null
     order by tp.start_time desc limit 1),
    (select p.lane_count from public.club_pitches p where p.id = p_pitch_id),
    1);
$function$;

-- A GAME THAT IS HISTORY: it has a result, a decided winner, or something somebody submitted about it
-- since its results were last cleared. Such a game keeps its day, time and pitch and is never deleted
-- by a planning operation. (Clearing results deliberately -- clear_tournament_plan_results -- leaves its
-- own audit row; that row is the record of the clearing, not a result.)
create or replace function internal.tournament_game_is_history(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.tournament_games g
    where g.id = p_game_id
      and (g.result_status <> 'none'
           or g.winner_participant_id is not null
           or exists (select 1 from public.tournament_game_result_submissions s
                      where s.game_id = g.id
                        and (g.result_resolved_at is null or s.created_at > g.result_resolved_at))));
$function$;

-- WHETHER A PITCH IS RESERVED FOR A TOURNAMENT ACROSS A WHOLE GAME. Reservations that meet are one window:
-- 09:00-11:00 and 11:00-13:00 cover a game played across 11:00.
create or replace function internal.tournament_pitch_covers(p_tournament_id uuid, p_pitch_id uuid, p_date date, p_from time, p_until time)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare r record; v_reach time := p_from;
begin
  if p_pitch_id is null or p_date is null or p_from is null or p_until is null or p_until <= p_from then
    return false;
  end if;
  for r in
    select tp.start_time, tp.end_time from public.tournament_pitches tp
    where tp.tournament_id = p_tournament_id and tp.pitch_id = p_pitch_id and tp.reserved_on = p_date
    order by tp.start_time
  loop
    if r.start_time <= v_reach and r.end_time > v_reach then
      v_reach := r.end_time;
    end if;
    if v_reach >= p_until then return true; end if;
  end loop;
  return v_reach >= p_until;
end;
$function$;

-- =====================================================================================================
-- 2. ONE COLLISION ENGINE
-- =====================================================================================================

-- EVERYTHING THAT OCCUPIES A PITCH IN A TOURNAMENT: every live game (draft or published, any competition,
-- and the older hand-made games) and every knockout place booked before its sides are known. A game
-- occupies its area from kick-off until the final whistle plus its competition's changeover.
-- stage_round orders a competition's stages where order is the sport's own: a knockout's rounds, a
-- Swiss's rounds, and a hybrid's group stage (0) before its knockout rounds. A round robin's rounds are
-- not ordered across tables, so its games carry none.
drop function if exists internal.tournament_schedule_units(uuid);
create or replace function internal.tournament_schedule_units(p_tournament_id uuid)
returns table (
  unit_id uuid, kind text, game_id uuid, place_id uuid, plan_id uuid, age_group text,
  game_date date, start_time time, end_time time, occupied_until time,
  pitch_id uuid, side_ids uuid[], game_area numeric, is_history boolean,
  stage_round integer, is_third boolean)
language sql
stable
security definer
set search_path to ''
as $function$
  with plans as (
    select p.id, p.age_group, p.game_duration_minutes as dur, coalesce(p.changeover_minutes, 0) as ch,
           internal.tournament_plan_format(p.id) as fmt
    from public.tournament_plans p
    where p.tournament_id = p_tournament_id and p.publication_state <> 'SUPERSEDED'
  ), raw as (
    select g.id as unit_id, 'game'::text as kind, g.id as game_id, null::uuid as place_id, g.plan_id, g.age_group,
           g.game_date, g.start_time,
           coalesce(g.duration_minutes, pl.dur, 20) as dur, coalesce(pl.ch, 0) as ch,
           g.pitch_id, array[g.side_a_id, g.side_b_id] as side_ids,
           internal.tournament_game_is_history(g.id) as is_history,
           case when pl.fmt = 'swiss' then g.round_number
                when pl.fmt in ('knockout', 'hybrid') and g.bracket_position is not null then g.round_number
                when pl.fmt = 'hybrid' then 0 end as stage_round,
           coalesce(g.is_third_place, false) as is_third
    from public.tournament_games g
    left join plans pl on pl.id = g.plan_id
    where g.tournament_id = p_tournament_id and g.status <> 'CANCELLED' and g.start_time is not null
      and (g.plan_id is null or pl.id is not null)
    union all
    select bp.id, 'place', null, bp.id, bp.plan_id, pl.age_group, bp.game_date, bp.start_time,
           pl.dur, pl.ch, bp.pitch_id, '{}'::uuid[], false,
           case when pl.fmt in ('knockout', 'hybrid', 'swiss') then bp.round_number end,
           coalesce(bp.is_third_place, false)
    from public.tournament_bracket_pairings bp
    join plans pl on pl.id = bp.plan_id
    where bp.game_id is null and bp.start_time is not null and bp.game_date is not null
  ), grades as (
    select distinct r.age_group, internal.tournament_game_area_m2(p_tournament_id, r.age_group) as area from raw r
  )
  select r.unit_id, r.kind, r.game_id, r.place_id, r.plan_id, r.age_group, r.game_date, r.start_time,
         internal.time_after(r.start_time, r.dur),
         internal.time_after(r.start_time, r.dur + r.ch),
         r.pitch_id, r.side_ids, gr.area, r.is_history, r.stage_round, r.is_third
  from raw r join grades gr on gr.age_group = r.age_group;
$function$;

-- A ROUND IN WORDS, for a sentence about the order of play: the subject form names one game ("The
-- Final", "A Semi Final", "A Round 2 game"), the whole-round form names its round ("the Semi Finals",
-- "Round 1", "the group stage").
create or replace function internal.schedule_round_label(p_plan_id uuid, p_round integer, p_is_third boolean, p_whole_round boolean)
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  with f as (
    select internal.tournament_plan_format(p_plan_id) as fmt,
           internal.bracket_rounds((select count(*)::int from public.tournament_bracket_slots s
                                    where s.plan_id = p_plan_id and s.round_number = 1 and not s.is_third_place)) as rounds
  )
  select case
    when p_round = 0 then 'the group stage'
    when f.fmt = 'swiss' then case when p_whole_round then 'Round ' || p_round else 'A Round ' || p_round || ' game' end
    when coalesce(p_is_third, false) and not p_whole_round then 'The Third-Place Play-Off'
    when p_whole_round then 'the ' || internal.bracket_round_name(p_round, f.rounds)
    when f.rounds - p_round = 0 then 'The Final'
    when f.rounds - p_round in (1, 2) then 'A ' || internal.bracket_game_name(p_round, f.rounds)
    else 'A ' || internal.bracket_round_name(p_round, f.rounds) || ' game'
  end
  from f;
$function$;

-- EVERY CLASH IN A TOURNAMENT, IN WORDS. Across every competition, because U10 and U12 sharing Pitch 1 is
-- one pitch. A clash made only of games that are already history is not reported: nothing can fix it.
--   PITCH_CLASH       more games on a pitch at once than it is marked out for
--   PITCH_TOO_SMALL   a game needs more ground than the pitch, or than one of the areas it is marked into
--   PITCH_TURNAROUND  the next game starts inside the previous one's changeover
--   SIDE_CLASH        one team in two games at once
--   ROUND_ORDER       a knockout or Swiss round starting before the round it follows has finished
--   PITCH_NOT_RESERVED a game on a pitch the tournament has not reserved for that time
-- Several games at one kick-off on different pitches -- the shape of every festival -- is none of these.
create or replace function internal.tournament_schedule_conflicts(p_tournament_id uuid)
returns table (code text, unit_ids uuid[], pitch_id uuid, game_date date, at_time time, message text)
language sql
stable
security definer
set search_path to ''
as $function$
  with u as (
    select * from internal.tournament_schedule_units(p_tournament_id)
  ), pc as (
    select p.id, p.display_name as name, internal.pitch_area_m2(p.id) as area
    from public.club_pitches p
    where p.id in (select distinct u.pitch_id from u where u.pitch_id is not null)
  ), kickoffs as (
    -- EVERY MOMENT A PITCH GETS BUSIER is a kick-off on it, so those are the only moments to look at --
    -- once each, however many games share one.
    select distinct x.pitch_id, x.game_date, x.start_time as at_time from u x where x.pitch_id is not null
  ), probe as (
    -- WHAT IS ON A PITCH AT EACH KICK-OFF: what is playing then, and what is still turning round.
    -- HOW IT IS MARKED OUT AT THAT MOMENT is the organiser's, for the reservation covering it.
    select k.pitch_id, k.game_date, k.at_time,
           internal.tournament_pitch_areas_at(p_tournament_id, k.pitch_id, k.game_date, k.at_time) as areas,
           count(*) filter (where k.at_time < b.end_time) as playing,
           count(*) as occupying,
           array_agg(b.unit_id) as ids,
           bool_and(b.is_history) as all_history,
           (array_agg(b.age_group order by b.game_area desc, b.start_time) filter (where k.at_time < b.end_time))[1] as biggest_grade,
           max(b.game_area) filter (where k.at_time < b.end_time) as biggest_area,
           max(b.end_time) filter (where b.end_time <= k.at_time) as finished_at,
           max((extract(epoch from (b.occupied_until - b.end_time)) / 60)::int) filter (where b.end_time <= k.at_time) as turnaround
    from kickoffs k
    join u b on b.pitch_id = k.pitch_id and b.game_date = k.game_date
            and b.start_time <= k.at_time and k.at_time < b.occupied_until
    group by k.pitch_id, k.game_date, k.at_time
  ), pitch_rows as (
    -- EACH GAME MUST FIT ONE OF THE AREAS (its RFU pitch within the pitch's ground shared by the areas),
    -- and no more games may play at once than there are areas.
    select case
             when pr.biggest_area > pc.area / greatest(pr.areas, 1) + 0.001 then 'PITCH_TOO_SMALL'
             when pr.playing > pr.areas then 'PITCH_CLASH'
             when pr.occupying > pr.areas then 'PITCH_TURNAROUND'
           end as code,
           pr.*, pc.name
    from probe pr join pc on pc.id = pr.pitch_id
    where not pr.all_history
  ), side_rows as (
    select a.unit_id as a_id, b.unit_id as b_id, a.game_date, a.start_time as a_start, b.start_time as b_start,
           (select x from unnest(a.side_ids) x where x = any (b.side_ids) limit 1) as side_id
    from u a
    join u b on a.kind = 'game' and b.kind = 'game' and a.unit_id < b.unit_id
            and a.game_date = b.game_date and a.side_ids && b.side_ids
            and a.start_time < b.end_time and b.start_time < a.end_time
    where not (a.is_history and b.is_history)
  ), round_rows as (
    -- A ROUND STARTS ONCE THE ROUND BEFORE IT HAS FINISHED: a Final's sides come out of its Semi Finals.
    select b.unit_id, b.plan_id, b.game_date, b.start_time, b.stage_round, b.is_third,
           (array_agg(a.unit_id order by a.game_date desc, a.end_time desc))[1] as blocking_id,
           (array_agg(a.stage_round order by a.game_date desc, a.end_time desc))[1] as blocking_round,
           max(a.game_date + a.end_time) as earlier_end,
           bool_and(a.is_history) and b.is_history as all_history
    from u b
    join u a on a.plan_id = b.plan_id and a.stage_round < b.stage_round
            and (b.game_date + b.start_time) < (a.game_date + a.end_time)
    where b.stage_round is not null
    group by b.unit_id, b.plan_id, b.game_date, b.start_time, b.stage_round, b.is_third, b.is_history
  )
  select r.code, r.ids, r.pitch_id, r.game_date, r.at_time,
         case r.code
           when 'PITCH_TOO_SMALL' then
             case when r.areas <= 1
                  then format('%s is too small for a %s game. Move it to a bigger pitch.', r.name, r.biggest_grade)
                  else format('%s is marked out for %s games at %s, and a %s game needs more room than one of those areas. Mark it out for fewer games, or move this one.',
                              r.name, internal.count_word(r.areas), to_char(r.at_time, 'HH24:MI'), r.biggest_grade)
             end
           when 'PITCH_CLASH' then
             case when r.areas <= 1
                  then format('%s has %s games at %s, but it takes one game at a time.', r.name, internal.count_word(r.playing), to_char(r.at_time, 'HH24:MI'))
                  else format('%s has %s games at %s, but it is marked out for %s.', r.name, internal.count_word(r.playing), to_char(r.at_time, 'HH24:MI'), internal.count_word(r.areas))
             end
           else
             format('%s needs %s minutes between games: a game finishes at %s and the next kicks off at %s.',
                    r.name, coalesce(r.turnaround, 0), to_char(r.finished_at, 'HH24:MI'), to_char(r.at_time, 'HH24:MI'))
         end
  from pitch_rows r
  where r.code is not null
  union all
  select 'SIDE_CLASH', array[s.a_id, s.b_id], null::uuid, s.game_date, greatest(s.a_start, s.b_start),
         case when s.a_start = s.b_start
              then format('%s %s is scheduled in two games at %s.',
                          internal.tournament_side_summary(s.side_id, null) ->> 'clubName',
                          internal.tournament_side_summary(s.side_id, null) ->> 'label', to_char(s.a_start, 'HH24:MI'))
              else format('%s %s is scheduled in two games at once, at %s and %s.',
                          internal.tournament_side_summary(s.side_id, null) ->> 'clubName',
                          internal.tournament_side_summary(s.side_id, null) ->> 'label',
                          to_char(least(s.a_start, s.b_start), 'HH24:MI'), to_char(greatest(s.a_start, s.b_start), 'HH24:MI'))
         end
  from side_rows s
  union all
  select 'ROUND_ORDER', array[r.unit_id, r.blocking_id], null::uuid, r.game_date, r.start_time,
         format('%s cannot kick off at %s: the last game of %s ends at %s. A round starts once the round before it has finished.',
                internal.schedule_round_label(r.plan_id, r.stage_round, r.is_third, false),
                to_char(r.start_time, 'HH24:MI'),
                internal.schedule_round_label(r.plan_id, r.blocking_round, false, true),
                to_char(r.earlier_end, 'HH24:MI'))
  from round_rows r
  where not r.all_history
  union all
  select 'PITCH_NOT_RESERVED', array[x.unit_id], x.pitch_id, x.game_date, x.start_time,
         format('%s is not reserved for this tournament from %s to %s on %s.',
                coalesce(p.display_name, 'That pitch'), to_char(x.start_time, 'HH24:MI'), to_char(x.end_time, 'HH24:MI'),
                to_char(x.game_date, 'FMDy FMDD Mon'))
  from u x
  left join public.club_pitches p on p.id = x.pitch_id
  where x.pitch_id is not null and not x.is_history
    and not internal.tournament_pitch_covers(p_tournament_id, x.pitch_id, x.game_date, x.start_time, x.end_time);
$function$;
revoke all on function internal.tournament_schedule_conflicts(uuid) from public, anon, authenticated;

-- Which clash to name first when one change makes several: a team in two places, then a round out of
-- order, then a pitch too small, too full or not turned round, then a pitch not reserved.
create or replace function internal.schedule_conflict_rank(p_code text)
returns integer
language sql
immutable
set search_path to ''
as $function$
  select case p_code when 'SIDE_CLASH' then 1 when 'ROUND_ORDER' then 2 when 'PITCH_TOO_SMALL' then 3
                     when 'PITCH_CLASH' then 4 when 'PITCH_TURNAROUND' then 5 else 6 end;
$function$;

-- The units a scheduler works against, held in this transaction so each placement is checked against
-- every placement before it.
create or replace function internal.load_schedule_units(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  create temp table if not exists sched_units (
    unit_id uuid primary key, plan_id uuid, game_date date, pitch_id uuid,
    s time, e time, oe time, game_area numeric, side_ids uuid[]
  ) on commit drop;
  delete from pg_temp.sched_units;
  insert into pg_temp.sched_units
  select x.unit_id, x.plan_id, x.game_date, x.pitch_id, x.start_time, x.end_time, x.occupied_until, x.game_area, x.side_ids
  from internal.tournament_schedule_units(p_tournament_id) x
  where x.pitch_id is not null;
end;
$function$;

-- WHETHER ONE MORE GAME FITS ON A PITCH from p_start until p_occupied_until, given everything already
-- placed (internal.load_schedule_units): at the kick-off and at every later kick-off it overlaps -- where
-- the most is happening at once -- the pitch must have an area free, marked out as it is at that moment,
-- and the game must fit one of its areas.
drop function if exists internal.sched_has_room(uuid, date, time, time, integer);
create or replace function internal.sched_has_room(p_tournament_id uuid, p_pitch_id uuid, p_date date, p_start time, p_occupied_until time, p_game_area numeric)
returns boolean
language plpgsql
stable
set search_path to ''
as $function$
declare v_area numeric;
begin
  v_area := internal.pitch_area_m2(p_pitch_id);
  if v_area is null then return false; end if;
  return not exists (
    select 1
    from (select p_start as t
          union
          select x.s from pg_temp.sched_units x
          where x.pitch_id = p_pitch_id and x.game_date = p_date and x.s > p_start and x.s < p_occupied_until) probes
    cross join lateral (select internal.tournament_pitch_areas_at(p_tournament_id, p_pitch_id, p_date, probes.t) as areas) a
    where p_game_area > v_area / greatest(a.areas, 1) + 0.001
       or 1 + (select count(*) from pg_temp.sched_units o
               where o.pitch_id = p_pitch_id and o.game_date = p_date and o.s <= probes.t and probes.t < o.oe) > a.areas);
end;
$function$;

-- WHAT A PLAN'S GAMES WERE BEFORE A CHANGE, so the teams can be told what moved and nothing else.
create or replace function internal.snapshot_tournament_plan_schedule(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  create temp table if not exists sched_before (
    game_id uuid primary key, plan_id uuid, game_date date, start_time time, pitch_id uuid, duration_minutes int
  ) on commit drop;
  delete from pg_temp.sched_before where plan_id = p_plan_id;
  insert into pg_temp.sched_before (game_id, plan_id, game_date, start_time, pitch_id, duration_minutes)
  select g.id, g.plan_id, g.game_date, g.start_time, g.pitch_id, g.duration_minutes
  from public.tournament_games g where g.plan_id = p_plan_id;
end;
$function$;

-- A TOURNAMENT NOTICE NEED NOT GO TO THE PERSON WHO MADE THE CHANGE: the organiser who moved a game
-- knows it moved. The audience is otherwise unchanged -- staff who record that side's results.
drop function if exists internal.notify_tournament_side(uuid, text, text, text, jsonb);
create or replace function internal.notify_tournament_side(p_participant_id uuid, p_type text, p_title text, p_body text, p_data jsonb, p_exclude_user uuid default null)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_club_id uuid;
  v_team_id uuid;
begin
  select club_id, team_id into v_club_id, v_team_id
  from public.tournament_participants where id = p_participant_id;
  if v_club_id is null then return; end if;

  insert into public.notifications (user_id, type, title, body, data)
  select distinct cm.user_id, p_type, p_title, p_body, p_data
  from public.club_memberships cm
  where cm.club_id = v_club_id and cm.status = 'active'
    and cm.user_id is distinct from p_exclude_user
    and (coalesce((internal.capability_decision(cm.user_id, 'fixture.result.record', 'club',
                                               v_club_id, null, null, false, false)).allowed, false)
         or (v_team_id is not null
             and coalesce((internal.capability_decision(cm.user_id, 'fixture.result.record', 'team',
                                                        v_club_id, v_team_id, null, false, false)).allowed, false)))
    and internal.is_account_active(cm.user_id);
end;
$function$;
revoke all on function internal.notify_tournament_side(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;

-- EACH TEAM IN A PUBLISHED GAME THAT MOVED IS TOLD ONCE: one notice naming its game, or one naming all
-- of its moved games. Nobody whose games stayed put is told anything, and a draft tells nobody.
create or replace function internal.announce_moved_tournament_games(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_plan public.tournament_plans; v_t public.tournaments; v_side record; g public.tournament_games;
  v_a jsonb; v_b jsonb; v_moves text; v_told int := 0;
begin
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.publication_state = 'PUBLISHED' then
    select * into v_t from public.tournaments where id = v_plan.tournament_id;
    for v_side in
      select x.side_id, array_agg(x.game_id order by x.game_date, x.start_time nulls last, x.game_id) as game_ids, count(*) as n
      from (
        select unnest(array[gm.side_a_id, gm.side_b_id]) as side_id, gm.id as game_id, gm.game_date, gm.start_time
        from public.tournament_games gm
        join pg_temp.sched_before b on b.game_id = gm.id
        where gm.plan_id = p_plan_id
          and (gm.game_date, gm.start_time, gm.pitch_id, gm.duration_minutes)
              is distinct from (b.game_date, b.start_time, b.pitch_id, b.duration_minutes)
      ) x
      where x.side_id is not null
      group by x.side_id
    loop
      if v_side.n = 1 then
        select * into g from public.tournament_games where id = v_side.game_ids[1];
        v_a := internal.tournament_side_summary(g.side_a_id, null);
        v_b := internal.tournament_side_summary(g.side_b_id, null);
        perform internal.notify_tournament_side(v_side.side_id, 'tournament_schedule_changed', 'Tournament game moved',
          case when g.start_time is null then
            format('%s v %s at %s no longer has a kick-off time. You will be told when it has one.',
                   v_a ->> 'clubName', v_b ->> 'clubName', v_t.name)
          else
            format('%s v %s at %s now kicks off at %s on %s, %s.', v_a ->> 'clubName', v_b ->> 'clubName', v_t.name,
                   to_char(g.start_time, 'HH24:MI'),
                   coalesce((select p.display_name from public.club_pitches p where p.id = g.pitch_id), 'its pitch'),
                   to_char(g.game_date, 'FMDy FMDD Mon'))
          end,
          jsonb_build_object('tournament_id', v_t.id, 'tournament_plan_id', p_plan_id, 'tournament_game_id', g.id),
          auth.uid());
      else
        select string_agg(case when gm.start_time is null then 'one now without a kick-off time'
                               else format('%s on %s', to_char(gm.start_time, 'HH24:MI'),
                                           coalesce((select p.display_name from public.club_pitches p where p.id = gm.pitch_id), 'its pitch')) end,
                          ', ' order by gm.game_date, gm.start_time nulls last)
        into v_moves
        from public.tournament_games gm where gm.id = any (v_side.game_ids);
        perform internal.notify_tournament_side(v_side.side_id, 'tournament_schedule_changed', 'Tournament games moved',
          format('%s of your games at %s have moved: %s. Check your kick-off times and pitches.',
                 initcap(internal.count_word(v_side.n)), v_t.name, v_moves),
          jsonb_build_object('tournament_id', v_t.id, 'tournament_plan_id', p_plan_id),
          auth.uid());
      end if;
      v_told := v_told + 1;
    end loop;
  end if;
  delete from pg_temp.sched_before where plan_id = p_plan_id;
  return v_told;
end;
$function$;

-- =====================================================================================================
-- 3. THE SCHEDULERS PLACE ONLY WHERE THERE IS ROOM, AND LEAVE WHAT AN ORGANISER PLACED
-- =====================================================================================================

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
  v_area numeric; v_dur int; v_ch int; v_end time; v_occ time;
begin
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  v_dur := v_plan.game_duration_minutes;
  v_ch := coalesce(v_plan.changeover_minutes, 0);
  v_area := internal.tournament_game_area_m2(v_plan.tournament_id, v_plan.age_group);

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

  -- THE GAMES THIS PASS MAY MOVE: none that is history, and none an organiser placed by hand. Those keep
  -- their places and are the fixed points everything else is fitted around.
  update public.tournament_games g
  set start_time = null, pitch_id = null,
      game_date = (select min(day_date) from public.tournament_plan_days where plan_id = p_plan_id)
  where g.plan_id = p_plan_id and g.bracket_position is null and not g.placed_by_hand
    and not internal.tournament_game_is_history(g.id);

  -- A HYBRID'S KNOCKOUT GAMES FOLLOW THE GROUP STAGE, so an unplayed one gives up its time while the
  -- group stage is placed; the knockout scheduler then puts it back after the last group game.
  if internal.tournament_plan_format(p_plan_id) = 'hybrid' then
    update public.tournament_games g
    set start_time = null, pitch_id = null
    where g.plan_id = p_plan_id and g.bracket_position is not null and not g.placed_by_hand
      and not internal.tournament_game_is_history(g.id);
    -- ...and so do its knockout places not yet paired, or their old times would hold pitches the group
    -- stage needs.
    update public.tournament_bracket_pairings bp
    set game_date = null, start_time = null, pitch_id = null, updated_at = now()
    where bp.plan_id = p_plan_id and bp.game_id is null and not bp.placed_by_hand;
  end if;

  -- NO PITCHES RESERVED IS NOT A FAILURE AT THIS STAGE: the pairings are real; readiness reports the
  -- games without a kick-off and offers the route to give them one.
  if v_slot_count = 0 then return; end if;

  select count(distinct (slot_day, slot_start)) into v_available from plan_slots;
  select coalesce(max(round_number), 1) into v_needed from public.tournament_games
  where plan_id = p_plan_id and bracket_position is null;
  if v_needed > v_available then
    raise exception
      '% rounds need % kick-off times, but the selected days and reserved pitches provide %. Widen the playing hours, shorten the games, or add another day.',
      v_needed, v_needed, v_available
      using errcode = '22023';
  end if;

  perform internal.load_schedule_units(v_plan.tournament_id);

  for v_g in
    select g.id, g.side_a_id, g.side_b_id
    from public.tournament_games g
    where g.plan_id = p_plan_id and g.bracket_position is null and g.start_time is null
    order by g.round_number nulls last, g.sort_order, g.id
  loop
    v_placed := false;
    for v_s in
      select s.*,
             (select count(*) from pg_temp.sched_units o
               where o.pitch_id = s.pitch_id and o.game_date = s.slot_day
                 and o.s < s.slot_end and s.slot_start < o.e) as load
      from plan_slots s
      order by s.slot_day, s.slot_start, load, s.ordinal
    loop
      v_end := internal.time_after(v_s.slot_start, v_dur);
      v_occ := internal.time_after(v_s.slot_start, v_dur + v_ch);
      -- A SIDE IN ONE PLACE AT A TIME, and A PITCH NEVER FULLER THAN IT IS.
      if not exists (
           select 1 from pg_temp.sched_units o
           where o.game_date = v_s.slot_day and o.side_ids && array[v_g.side_a_id, v_g.side_b_id]
             and o.s < v_end and v_s.slot_start < o.e)
         and internal.sched_has_room(v_plan.tournament_id, v_s.pitch_id, v_s.slot_day, v_s.slot_start, v_occ, v_area)
      then
        update public.tournament_games
        set game_date = v_s.slot_day, start_time = v_s.slot_start, pitch_id = v_s.pitch_id,
            duration_minutes = v_dur
        where id = v_g.id;
        insert into pg_temp.sched_units (unit_id, plan_id, game_date, pitch_id, s, e, oe, game_area, side_ids)
        values (v_g.id, p_plan_id, v_s.slot_day, v_s.pitch_id, v_s.slot_start, v_end, v_occ, v_area, array[v_g.side_a_id, v_g.side_b_id])
        on conflict (unit_id) do update set game_date = excluded.game_date, pitch_id = excluded.pitch_id,
          s = excluded.s, e = excluded.e, oe = excluded.oe;
        v_placed := true;
        exit;
      end if;
    end loop;
    -- A GAME WITH NOWHERE TO GO STAYS UNSCHEDULED rather than failing the whole plan: the pairing is
    -- real, readiness counts it among the games with no kick-off, and the plan shows it as unallocated
    -- for the organiser to place by hand or after reserving more pitch.
  end loop;
end;
$function$;

create or replace function internal.schedule_bracket_pairings(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record; s record; v_n integer := 0; v_day date; v_dur integer; v_change integer; v_area numeric;
  v_tournament uuid; v_found boolean; v_sides uuid[];
  v_round integer := 0; v_round_floor timestamp; v_next_floor timestamp; v_end timestamp;
begin
  select coalesce(game_duration_minutes, 20), coalesce(changeover_minutes, 0), tournament_id,
         internal.tournament_game_area_m2(tournament_id, age_group)
  into v_dur, v_change, v_tournament, v_area
  from public.tournament_plans where id = p_plan_id;

  -- A place whose game is history keeps its place, and so does a place (or game) an organiser set by hand:
  -- they are the fixed points of the day.
  update public.tournament_bracket_pairings bp
  set game_date = null, start_time = null, pitch_id = null, updated_at = now()
  where bp.plan_id = p_plan_id and not bp.placed_by_hand
    and not exists (select 1 from public.tournament_games g
                     where g.id = bp.game_id and (g.placed_by_hand or internal.tournament_game_is_history(g.id)));
  -- ...and the games of the places just cleared stop occupying their old pitches while they are re-placed.
  update public.tournament_games g
  set start_time = null, pitch_id = null, updated_at = now()
  from public.tournament_bracket_pairings bp
  where bp.game_id = g.id and bp.plan_id = p_plan_id and bp.start_time is null
    and not g.placed_by_hand and not internal.tournament_game_is_history(g.id);

  perform internal.load_schedule_units(v_tournament);

  -- A HYBRID'S KNOCKOUT STAGE STARTS WHEN ITS GROUP STAGE HAS FINISHED.
  select max(g.game_date + g.start_time + make_interval(mins => coalesce(g.duration_minutes, v_dur) + v_change))
  into v_next_floor
  from public.tournament_games g
  where g.plan_id = p_plan_id and g.bracket_position is null and g.start_time is not null
    and internal.tournament_plan_format(p_plan_id) = 'hybrid';

  for r in
    select * from public.tournament_bracket_pairings
    where plan_id = p_plan_id
    order by round_number, is_third_place, game_position
  loop
    -- A NEW ROUND STARTS ONLY WHEN THE ROUND BEFORE IT HAS FINISHED (20270655: rounds do not overlap).
    if r.round_number <> v_round then
      v_round := r.round_number;
      v_round_floor := v_next_floor;
    end if;

    if r.start_time is not null then
      v_end := r.game_date + r.start_time + make_interval(mins => v_dur + v_change);
      v_next_floor := greatest(coalesce(v_next_floor, v_end), v_end);
      continue;
    end if;

    select day_date into v_day from public.tournament_plan_round_days
    where plan_id = p_plan_id and round_number = r.round_number;
    v_sides := case when r.game_id is null then '{}'::uuid[]
                    else (select array[g.side_a_id, g.side_b_id] from public.tournament_games g where g.id = r.game_id) end;

    v_found := false;
    for s in
      select a.*,
             (select count(*) from pg_temp.sched_units o
               where o.pitch_id = a.pitch_id and o.game_date = a.slot_day and o.s < a.slot_end and a.slot_start < o.e) as load
      from internal.tournament_plan_slots(p_plan_id) a
      where (v_day is null or a.slot_day = v_day)
        and (v_round_floor is null or (a.slot_day + a.slot_start) >= v_round_floor)
      order by a.slot_day, a.slot_start, load, a.ordinal
    loop
      if (cardinality(v_sides) = 0 or not exists (
            select 1 from pg_temp.sched_units o
            where o.game_date = s.slot_day and o.side_ids && v_sides
              and o.s < internal.time_after(s.slot_start, v_dur) and s.slot_start < o.e))
         and internal.sched_has_room(v_tournament, s.pitch_id, s.slot_day, s.slot_start, internal.time_after(s.slot_start, v_dur + v_change), v_area)
      then
        update public.tournament_bracket_pairings
        set game_date = s.slot_day, start_time = s.slot_start, pitch_id = s.pitch_id, updated_at = now()
        where id = r.id;
        insert into pg_temp.sched_units (unit_id, plan_id, game_date, pitch_id, s, e, oe, game_area, side_ids)
        values (coalesce(r.game_id, r.id), p_plan_id, s.slot_day, s.pitch_id, s.slot_start,
                internal.time_after(s.slot_start, v_dur), internal.time_after(s.slot_start, v_dur + v_change), v_area, v_sides)
        on conflict (unit_id) do update set game_date = excluded.game_date, pitch_id = excluded.pitch_id,
          s = excluded.s, e = excluded.e, oe = excluded.oe;
        v_end := s.slot_day + s.slot_start + make_interval(mins => v_dur + v_change);
        v_next_floor := greatest(coalesce(v_next_floor, v_end), v_end);
        v_n := v_n + 1;
        v_found := true;
        exit;
      end if;
    end loop;

    if not v_found then
      update public.tournament_bracket_pairings
      set game_date = null, start_time = null, pitch_id = null, updated_at = now()
      where id = r.id;
    end if;
  end loop;

  update public.tournament_games g
  set game_date = coalesce(bp.game_date, g.game_date),
      start_time = bp.start_time, pitch_id = bp.pitch_id,
      duration_minutes = v_dur, updated_at = now()
  from public.tournament_bracket_pairings bp
  where bp.game_id = g.id and bp.plan_id = p_plan_id
    and not g.placed_by_hand
    and not internal.tournament_game_is_history(g.id);

  return v_n;
end;
$function$;

-- SCHEDULE GAMES: Ovalball places every game it may, and by default leaves the games an organiser
-- placed by hand where they are. Asked to, it places those again too -- said in the confirmation first.
drop function if exists public.schedule_tournament_plan(uuid);
create or replace function public.schedule_tournament_plan(p_plan_id uuid, p_keep_hand_placed boolean default true)
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

  if not coalesce(p_keep_hand_placed, true) then
    update public.tournament_games g set placed_by_hand = false
    where g.plan_id = p_plan_id and g.placed_by_hand and not internal.tournament_game_is_history(g.id);
    update public.tournament_bracket_pairings set placed_by_hand = false where plan_id = p_plan_id and placed_by_hand;
  end if;

  perform internal.snapshot_tournament_plan_schedule(p_plan_id);
  -- A knockout and a Swiss are scheduled through their places; a hybrid's group stage first, then its
  -- knockout places after it.
  if internal.tournament_plan_format(p_plan_id) in ('knockout', 'swiss') then
    perform internal.schedule_bracket_pairings(p_plan_id);
  elsif internal.tournament_plan_format(p_plan_id) = 'hybrid' then
    perform internal.schedule_tournament_plan_games(p_plan_id);
    perform internal.schedule_bracket_pairings(p_plan_id);
  else
    perform internal.schedule_tournament_plan_games(p_plan_id);
  end if;

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
  -- ONLY THE TEAMS WHOSE GAMES MOVED ARE TOLD, once each -- not every team for every pass.
  perform internal.announce_moved_tournament_games(p_plan_id);
  return internal.tournament_plan_readiness(p_plan_id);
end;
$function$;
revoke all on function public.schedule_tournament_plan(uuid, boolean) from public, anon;
grant execute on function public.schedule_tournament_plan(uuid, boolean) to authenticated;

-- =====================================================================================================
-- 4. A PLAN IS EDITED, NOT REBUILT
-- =====================================================================================================

-- ONE WRITE FOR THE SCHEDULE: any number of games (or knockout places not yet paired) moved at once --
-- day, kick-off, pitch, and a game's own length -- and validated as ONE arrangement, so swapping two games
-- is a single save rather than an impossible pair of clashing ones. All or nothing.
create or replace function public.save_tournament_plan_schedule(p_plan_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan public.tournament_plans; v_t public.tournaments; c jsonb;
  g public.tournament_games; bp public.tournament_bracket_pairings;
  v_id uuid; v_date date; v_start time; v_pitch uuid; v_dur int; v_end time; v_max int;
  v_pitch_name text; v_changed uuid[] := '{}'; v_conflict record;
begin
  perform internal.require_live_session();
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.id is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_plan.tournament_id) then
    raise exception 'You do not have permission to change this tournament''s schedule.' using errcode = '42501';
  end if;
  select * into v_t from public.tournaments where id = v_plan.tournament_id;
  if v_t.cancelled_at is not null then
    raise exception 'This tournament has been cancelled.' using errcode = '22023';
  end if;
  if v_plan.publication_state = 'SUPERSEDED' then
    raise exception 'That plan has been replaced.' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'Nothing to save.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 300 then
    raise exception 'Save at most 300 changes at once.' using errcode = '22023';
  end if;

  select r.half_minutes * 2 into v_max from public.fixture_scheduling_rules r
  where r.rugby_code = v_t.rugby_code and r.age_group = v_plan.age_group
  order by r.effective_season desc nulls last limit 1;

  -- WHAT EACH GAME WAS, so the teams can be told what changed and nothing else.
  perform internal.snapshot_tournament_plan_schedule(p_plan_id);

  for c in select * from jsonb_array_elements(p_changes) loop
    v_date := nullif(c ->> 'date', '')::date;
    v_start := nullif(c ->> 'startTime', '')::time;
    v_pitch := nullif(c ->> 'pitchId', '')::uuid;
    g := null; bp := null;

    if nullif(c ->> 'gameId', '') is not null then
      select * into g from public.tournament_games
      where id = (c ->> 'gameId')::uuid and plan_id = p_plan_id for update;
      if g.id is null then raise exception 'One of those games is not part of this plan.' using errcode = '22023'; end if;
      if internal.tournament_game_is_history(g.id) then
        raise exception 'This game already has a result, so its time and pitch are history and cannot be moved.'
          using errcode = '22023', hint = 'TOURNAMENT_GAME_HAS_RESULT';
      end if;
      if g.status = 'CANCELLED' then
        raise exception 'That game was cancelled.' using errcode = '22023';
      end if;
      v_dur := coalesce(nullif(c ->> 'durationMinutes', '')::int, g.duration_minutes, v_plan.game_duration_minutes);
      v_id := g.id;
    elsif nullif(c ->> 'placeId', '') is not null then
      select * into bp from public.tournament_bracket_pairings
      where id = (c ->> 'placeId')::uuid and plan_id = p_plan_id for update;
      if bp.id is null then raise exception 'One of those places is not part of this plan.' using errcode = '22023'; end if;
      if bp.game_id is not null then
        raise exception 'That knockout place already has its game. Move the game.' using errcode = '22023';
      end if;
      -- A place not yet played has the competition's own game length.
      v_dur := v_plan.game_duration_minutes;
      v_id := bp.id;
    else
      raise exception 'Each change must name a game or a knockout place.' using errcode = '22023';
    end if;

    if v_date is null or v_start is null or v_pitch is null then
      raise exception 'A game needs a day, a kick-off time and a pitch.' using errcode = '22023';
    end if;
    if v_dur is null or v_dur < 1 or v_dur > 240 then
      raise exception 'A game lasts between 1 and 240 minutes.' using errcode = '22023';
    end if;
    if v_max is not null and v_dur > v_max then
      raise exception 'A % game may be at most % minutes under the age-grade regulations.', v_plan.age_group, v_max
        using errcode = '22023', hint = 'TOURNAMENT_GAME_TOO_LONG';
    end if;
    if not exists (select 1 from public.tournament_plan_days d where d.plan_id = p_plan_id and d.day_date = v_date) then
      raise exception 'That day is not one of this competition''s playing days.' using errcode = '22023';
    end if;
    if v_start + make_interval(mins => v_dur) < v_start then
      raise exception 'A game cannot run past midnight.' using errcode = '22023';
    end if;
    v_end := v_start + make_interval(mins => v_dur);
    -- INSIDE THE COMPETITION'S OWN PLAYING HOURS.
    if v_start < v_plan.day_start_time or v_end > v_plan.day_end_time then
      raise exception 'That is outside this competition''s playing hours (%-%). Choose a time inside them, or change the playing hours.',
        to_char(v_plan.day_start_time, 'HH24:MI'), to_char(v_plan.day_end_time, 'HH24:MI')
        using errcode = '22023', hint = 'TOURNAMENT_OUTSIDE_PLAYING_HOURS';
    end if;
    select display_name into v_pitch_name from public.club_pitches where id = v_pitch;
    if not internal.tournament_pitch_covers(v_plan.tournament_id, v_pitch, v_date, v_start, v_end) then
      raise exception '% is not reserved for this tournament from % to % on that day. Reserve it first, or choose another pitch or time.',
        coalesce(v_pitch_name, 'That pitch'), to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI')
        using errcode = '22023', hint = 'TOURNAMENT_PITCH_NOT_RESERVED';
    end if;

    if g.id is not null then
      update public.tournament_games
      set game_date = v_date, start_time = v_start, pitch_id = v_pitch, duration_minutes = v_dur,
          placed_by_hand = true, updated_by = auth.uid(), updated_at = now()
      where id = g.id;
      update public.tournament_bracket_pairings
      set game_date = v_date, start_time = v_start, pitch_id = v_pitch, placed_by_hand = true, updated_at = now()
      where game_id = g.id;
    else
      update public.tournament_bracket_pairings
      set game_date = v_date, start_time = v_start, pitch_id = v_pitch, placed_by_hand = true, updated_at = now()
      where id = bp.id;
    end if;
    v_changed := v_changed || v_id;
  end loop;

  -- ONE ARRANGEMENT, VALIDATED AS A WHOLE, against every competition of the tournament.
  -- THE MOST USEFUL REFUSAL FIRST: a team in two places is not cured by another pitch.
  select * into v_conflict from internal.tournament_schedule_conflicts(v_plan.tournament_id) x
  where x.unit_ids && v_changed
  order by internal.schedule_conflict_rank(x.code), x.game_date, x.at_time
  limit 1;
  if v_conflict.code is not null then
    raise exception '%', v_conflict.message
      using errcode = '22023',
            hint = case v_conflict.code when 'SIDE_CLASH' then 'TOURNAMENT_SIDE_CLASH'
                                        when 'PITCH_NOT_RESERVED' then 'TOURNAMENT_PITCH_NOT_RESERVED'
                                        else 'TOURNAMENT_' || v_conflict.code end;
  end if;

  -- EACH TEAM IN A PUBLISHED GAME THAT MOVED IS TOLD ONCE -- not the whole tournament, and not for a draft.
  perform internal.announce_moved_tournament_games(p_plan_id);

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
  return jsonb_build_object('changed', cardinality(v_changed), 'readiness', internal.tournament_plan_readiness(p_plan_id));
end;
$function$;
revoke all on function public.save_tournament_plan_schedule(uuid, jsonb) from public, anon;
grant execute on function public.save_tournament_plan_schedule(uuid, jsonb) to authenticated;
comment on function public.save_tournament_plan_schedule(uuid, jsonb) is
  'Move any number of a plan''s games or knockout places (day, kick-off, pitch, length) as one validated arrangement; each team in a moved published game is told once.';

-- The one-game move keeps its address and its refusals, and is now the same write.
create or replace function public.set_tournament_game_schedule(p_game_id uuid, p_game_date date, p_start_time time, p_pitch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.tournament_games;
begin
  perform internal.require_live_session();
  select * into g from public.tournament_games where id = p_game_id;
  if g.id is null then raise exception 'That game does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(g.tournament_id) then
    raise exception 'You do not have permission to change this tournament''s schedule.' using errcode = '42501';
  end if;
  if g.plan_id is null then
    raise exception 'That game is not part of a generated plan.' using errcode = '22023';
  end if;
  return public.save_tournament_plan_schedule(g.plan_id, jsonb_build_array(jsonb_build_object(
    'gameId', p_game_id, 'date', p_game_date, 'startTime', p_start_time, 'pitchId', p_pitch_id))) -> 'readiness';
end;
$function$;
revoke all on function public.set_tournament_game_schedule(uuid, date, time, uuid) from public, anon;
grant execute on function public.set_tournament_game_schedule(uuid, date, time, uuid) to authenticated;

-- DELETE PLAN: the competition goes back to "not planned". Its games, their times and pitches, its tables
-- and its settings go; its teams stay entered and the tournament's pitches stay reserved. Refused while
-- any game holds a result -- sporting history is not deleted as a planning step. Teams who saw a published
-- schedule are told it has been withdrawn.
create or replace function public.delete_tournament_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_plan public.tournament_plans; v_name text; v_history int; v_games int;
begin
  perform internal.require_live_session();
  select * into v_plan from public.tournament_plans where id = p_plan_id for update;
  if v_plan.id is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_plan.tournament_id) then
    raise exception 'You do not have permission to delete this tournament''s plans.' using errcode = '42501';
  end if;

  select count(*) into v_history from public.tournament_games g
  where g.plan_id = p_plan_id and internal.tournament_game_is_history(g.id);
  if v_history > 0 then
    raise exception '% in this plan % a result. Deleting the plan would delete %, so it stays. Clear the results deliberately first if the competition really is being planned again.',
      case when v_history = 1 then 'One game' else initcap(internal.count_word(v_history)) || ' games' end,
      case when v_history = 1 then 'has' else 'have' end,
      case when v_history = 1 then 'it' else 'them' end
      using errcode = '22023', hint = 'TOURNAMENT_PLAN_HAS_RESULTS';
  end if;

  select count(*) into v_games from public.tournament_games where plan_id = p_plan_id;
  select name into v_name from public.tournaments where id = v_plan.tournament_id;
  if v_plan.publication_state = 'PUBLISHED' then
    perform internal.notify_tournament_participants(
      v_plan.tournament_id, v_plan.age_group, auth.uid(), 'tournament_schedule_changed',
      'Tournament schedule withdrawn',
      format('The %s schedule for %s has been withdrawn. You will be told when a new one is published.', v_plan.age_group, v_name),
      jsonb_build_object('tournament_id', v_plan.tournament_id));
  end if;

  update public.tournament_plans set supersedes_plan_id = null where supersedes_plan_id = p_plan_id;
  delete from public.tournament_plans where id = p_plan_id;

  return jsonb_build_object('ageGroup', v_plan.age_group, 'deletedGames', v_games,
                            'wasPublished', v_plan.publication_state = 'PUBLISHED');
end;
$function$;
revoke all on function public.delete_tournament_plan(uuid) from public, anon;
grant execute on function public.delete_tournament_plan(uuid) to authenticated;
comment on function public.delete_tournament_plan(uuid) is
  'Return a competition to unplanned: its games, tables and settings go; its teams and the tournament''s reserved pitches stay. Refused while any game has a result.';

-- What regenerating would cost, now counting the games an organiser placed by hand on their own.
create or replace function public.tournament_plan_regeneration_cost(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid; v_state text; v_history record;
begin
  perform internal.require_live_session();
  select tournament_id, publication_state into v_tournament, v_state
  from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  select * into v_history from internal.tournament_plan_result_history(p_plan_id);
  return jsonb_build_object(
    'publicationState', v_state,
    'gameCount', (select count(*) from public.tournament_games where plan_id = p_plan_id),
    'placedCount', (select count(*) from public.tournament_games
                    where plan_id = p_plan_id and (start_time is not null or pitch_id is not null)),
    -- THE GAMES AN ORGANISER PLACED BY HAND, which regenerating loses and is worth naming.
    'handPlacedCount', (select count(*) from public.tournament_games where plan_id = p_plan_id and placed_by_hand),
    'recordedResultCount', v_history.games_with_results,
    'confirmedResultCount', v_history.confirmed,
    'resultSubmissionCount', v_history.submissions,
    'blocked', (v_history.games_with_results > 0),
    'blockedReason', case when v_history.games_with_results > 0 then 'TOURNAMENT_PLAN_HAS_RESULTS' end
  );
end;
$function$;

-- =====================================================================================================
-- 5. THE OLD SIDE DOORS
-- =====================================================================================================

-- A HAND-MADE GAME (the website's older manual schedule) cannot rewrite a planned game, cannot rewrite a
-- game with a result, and is held to the same clashes as everything else on the tournament's pitches.
create or replace function public.save_tournament_game(p_tournament_id uuid, p_side_a_id uuid, p_side_b_id uuid, p_age_group text, p_game_date date, p_game_id uuid DEFAULT NULL::uuid, p_start_time time without time zone DEFAULT NULL::time without time zone, p_duration_minutes integer DEFAULT NULL::integer, p_pitch_id uuid DEFAULT NULL::uuid, p_status text DEFAULT 'SCHEDULED'::text, p_side_a_score integer DEFAULT NULL::integer, p_side_b_score integer DEFAULT NULL::integer)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_conflict record;
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.cancelled_at is not null) then
    raise exception 'This tournament has been cancelled.' using errcode = '42501';
  end if;
  if p_status not in ('SCHEDULED', 'CANCELLED', 'PLAYED') then
    raise exception 'That is not a valid game status.' using errcode = '22023';
  end if;

  if p_game_id is not null then
    -- A PLANNED GAME CHANGES THROUGH ITS PLAN, and its result through the result workflow.
    if exists (select 1 from public.tournament_games g where g.id = p_game_id and g.plan_id is not null) then
      raise exception 'That game belongs to a tournament plan. Change its time and pitch in the plan, and its result through the game''s result.'
        using errcode = '22023', hint = 'TOURNAMENT_GAME_IN_PLAN';
    end if;
    if internal.tournament_game_is_history(p_game_id) then
      raise exception 'That game already has a result, so it can no longer be rewritten.'
        using errcode = '22023', hint = 'TOURNAMENT_GAME_HAS_RESULT';
    end if;
  end if;

  -- Every other rule -- same tournament, same competition, not itself, a day the tournament runs -- is
  -- enforced by `internal.validate_tournament_game_sides`, so a bulk writer gets them too.
  if p_game_id is null then
    insert into public.tournament_games (
      tournament_id, side_a_id, side_b_id, age_group, game_date, start_time, duration_minutes,
      pitch_id, status, sort_order, side_a_score, side_b_score, created_by, updated_by
    ) values (
      p_tournament_id, p_side_a_id, p_side_b_id, p_age_group, p_game_date, p_start_time, p_duration_minutes,
      p_pitch_id, p_status,
      coalesce((select max(sort_order) + 1 from public.tournament_games where tournament_id = p_tournament_id and age_group = p_age_group), 0),
      p_side_a_score, p_side_b_score, auth.uid(), auth.uid()
    ) returning id into v_id;
  else
    update public.tournament_games set
      side_a_id = p_side_a_id, side_b_id = p_side_b_id, age_group = p_age_group,
      game_date = p_game_date, start_time = p_start_time, duration_minutes = p_duration_minutes,
      pitch_id = p_pitch_id, status = p_status,
      side_a_score = p_side_a_score, side_b_score = p_side_b_score,
      updated_by = auth.uid(), updated_at = now()
    where id = p_game_id and tournament_id = p_tournament_id
    returning id into v_id;
    if v_id is null then
      raise exception 'That game does not exist in this tournament.' using errcode = 'P0002';
    end if;
  end if;

  -- THE SAME CLASHES AS EVERY OTHER GAME ON THESE PITCHES.
  select * into v_conflict from internal.tournament_schedule_conflicts(p_tournament_id) x
  where v_id = any (x.unit_ids) and x.code <> 'PITCH_NOT_RESERVED'
  order by internal.schedule_conflict_rank(x.code), x.game_date, x.at_time limit 1;
  if v_conflict.code is not null then
    raise exception '%', v_conflict.message using errcode = '22023',
      hint = case v_conflict.code when 'SIDE_CLASH' then 'TOURNAMENT_SIDE_CLASH' else 'TOURNAMENT_' || v_conflict.code end;
  end if;
  return v_id;
end;
$function$;

create or replace function public.delete_tournament_game(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.tournament_games;
begin
  perform internal.require_live_session();
  select * into g from public.tournament_games where id = p_game_id;
  if g.id is null then
    raise exception 'That game does not exist.' using errcode = 'P0002';
  end if;
  if not internal.can_manage_tournament(g.tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  -- A PLANNED GAME IS PART OF ITS PLAN: one game cannot be pulled out of a round robin.
  if g.plan_id is not null then
    raise exception 'That game belongs to the % plan. Move it in the plan, or delete the plan.', g.age_group
      using errcode = '22023', hint = 'TOURNAMENT_GAME_IN_PLAN';
  end if;
  -- AND A RESULT IS THE TOURNAMENT'S RECORD.
  if internal.tournament_game_is_history(g.id) then
    raise exception 'That game has a result, so it is part of the tournament''s record and cannot be deleted.'
      using errcode = '22023', hint = 'TOURNAMENT_GAME_HAS_RESULT';
  end if;
  delete from public.tournament_games where id = p_game_id;
end;
$function$;

-- A RESERVATION GAMES ARE PLAYED IN IS NOT RELEASED OR SHORTENED UNDER THEM.
create or replace function internal.refuse_stranded_tournament_games(p_tournament_id uuid, p_pitch_id uuid, p_day date)
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_n int; v_name text;
begin
  select count(*) into v_n
  from internal.tournament_schedule_units(p_tournament_id) x
  where x.pitch_id = p_pitch_id and x.game_date = p_day and not x.is_history
    and not internal.tournament_pitch_covers(p_tournament_id, x.pitch_id, x.game_date, x.start_time, x.end_time);
  if v_n > 0 then
    select display_name into v_name from public.club_pitches where id = p_pitch_id;
    raise exception '% has % on % that this reservation covers. Move % to another pitch first, or keep the reservation.',
      coalesce(v_name, 'That pitch'),
      case when v_n = 1 then 'a game' else internal.count_word(v_n) || ' games' end,
      to_char(p_day, 'FMDy FMDD Mon'),
      case when v_n = 1 then 'it' else 'them' end
      using errcode = '22023', hint = 'TOURNAMENT_PITCH_IN_USE';
  end if;
end;
$function$;

create or replace function public.release_tournament_pitch(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_r public.tournament_pitches;
begin
  select * into v_r from public.tournament_pitches tp where tp.id = p_reservation_id;
  if v_r.id is null then return; end if;
  if not internal.can_manage_tournament(v_r.tournament_id) then
    raise exception 'You do not have permission to release this tournament''s pitches.' using errcode = '42501';
  end if;
  delete from public.tournament_pitches where id = p_reservation_id;
  perform internal.refuse_stranded_tournament_games(v_r.tournament_id, v_r.pitch_id, v_r.reserved_on);
end;
$function$;

-- THE CLASHES ON ONE PITCH ON ONE DAY, so a change to how it is reserved or marked out can be refused when
-- it would make a clash that was not there before -- and never blamed for one that already was.
create or replace function internal.pitch_day_clashes(p_tournament_id uuid, p_pitch_id uuid, p_day date)
returns text[]
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(array_agg(c.message order by c.at_time, c.code), '{}'::text[])
  from internal.tournament_schedule_conflicts(p_tournament_id) c
  where c.pitch_id = p_pitch_id and c.game_date = p_day
    and c.code in ('PITCH_CLASH', 'PITCH_TOO_SMALL', 'PITCH_TURNAROUND');
$function$;

create or replace function internal.refuse_new_pitch_clashes(p_tournament_id uuid, p_pitch_id uuid, p_day date, p_before text[])
returns void
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_new text;
begin
  select m into v_new
  from unnest(internal.pitch_day_clashes(p_tournament_id, p_pitch_id, p_day)) m
  where not (m = any (coalesce(p_before, '{}'::text[])))
  limit 1;
  if v_new is not null then
    raise exception '%', v_new using errcode = '22023', hint = 'TOURNAMENT_PITCH_IN_USE';
  end if;
end;
$function$;

-- RESERVING A PITCH SAYS HOW IT IS MARKED OUT FOR THE DAY (owner's rule, 2026-10-03): 1, 2, 3 or 4 playing
-- areas, or null for the club's own layout. Shortening a reservation is a release of its end, and neither
-- may leave a game stranded or make a clash.
drop function if exists public.reserve_tournament_pitch(uuid, uuid, date, time without time zone, time without time zone);
create or replace function public.reserve_tournament_pitch(p_tournament_id uuid, p_pitch_id uuid, p_reserved_on date, p_start_time time without time zone, p_end_time time without time zone, p_playing_areas integer default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_before text[];
begin
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to reserve pitches for this tournament.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.cancelled_at is not null) then
    raise exception 'This tournament has been cancelled.' using errcode = '42501';
  end if;
  if p_playing_areas is not null and (p_playing_areas < 1 or p_playing_areas > 4) then
    raise exception 'A pitch is marked out for 1, 2, 3 or 4 games at once.' using errcode = '22023';
  end if;
  v_before := internal.pitch_day_clashes(p_tournament_id, p_pitch_id, p_reserved_on);
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, playing_areas, created_by)
  values (p_tournament_id, p_pitch_id, p_reserved_on, p_start_time, p_end_time, p_playing_areas, auth.uid())
  on conflict (tournament_id, pitch_id, reserved_on, start_time)
    do update set end_time = excluded.end_time,
                  playing_areas = coalesce(excluded.playing_areas, public.tournament_pitches.playing_areas)
  returning id into v_id;
  perform internal.refuse_stranded_tournament_games(p_tournament_id, p_pitch_id, p_reserved_on);
  perform internal.refuse_new_pitch_clashes(p_tournament_id, p_pitch_id, p_reserved_on, v_before);
  return v_id;
end;
$function$;
revoke all on function public.reserve_tournament_pitch(uuid, uuid, date, time without time zone, time without time zone, integer) from public, anon;
grant execute on function public.reserve_tournament_pitch(uuid, uuid, date, time without time zone, time without time zone, integer) to authenticated;

-- HOW A RESERVED PITCH IS MARKED OUT, changed on its own: more areas take more games at once (as long as
-- each game still fits one of them); fewer are refused while the games already on it would not fit.
-- Null goes back to the club's own layout.
create or replace function public.set_tournament_pitch_areas(p_reservation_id uuid, p_playing_areas integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_r public.tournament_pitches; v_before text[];
begin
  perform internal.require_live_session();
  select * into v_r from public.tournament_pitches where id = p_reservation_id;
  if v_r.id is null then raise exception 'That reservation does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_r.tournament_id) then
    raise exception 'You do not have permission to change this tournament''s pitches.' using errcode = '42501';
  end if;
  if p_playing_areas is not null and (p_playing_areas < 1 or p_playing_areas > 4) then
    raise exception 'A pitch is marked out for 1, 2, 3 or 4 games at once.' using errcode = '22023';
  end if;
  v_before := internal.pitch_day_clashes(v_r.tournament_id, v_r.pitch_id, v_r.reserved_on);
  update public.tournament_pitches set playing_areas = p_playing_areas where id = p_reservation_id;
  perform internal.refuse_new_pitch_clashes(v_r.tournament_id, v_r.pitch_id, v_r.reserved_on, v_before);
end;
$function$;
revoke all on function public.set_tournament_pitch_areas(uuid, integer) from public, anon;
grant execute on function public.set_tournament_pitch_areas(uuid, integer) to authenticated;
comment on function public.set_tournament_pitch_areas(uuid, integer) is
  'How the organiser has marked a reserved pitch out for the tournament (1-4 games at once, or null for the club''s layout); refused when it would make a clash.';

-- =====================================================================================================
-- 6. A PUBLISHED PLAN'S TABLES DO NOT CHANGE UNDERNEATH ITS GAMES
-- =====================================================================================================

-- Changing a draft's tables leaves its games out of date, and readiness says so and holds publication
-- until they are regenerated. A PUBLISHED plan's games are on everybody's phone: changing its tables is
-- refused until the organiser has been told it replaces those games, and then it does, at once, and the
-- teams are told. With results recorded it is refused outright, as before.
drop function if exists public.set_tournament_plan_tables(uuid, jsonb);
create or replace function public.set_tournament_plan_tables(p_plan_id uuid, p_tables jsonb, p_replace_games boolean default false)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tournament uuid; v_grade text; v_state text; v_games int; v_t jsonb; v_table uuid; v_sort int := 0; v_side text; v_pos int;
  v_seen uuid[] := '{}'; v_id uuid; v_total int; v_available int; v_current jsonb; v_wanted jsonb;
begin
  perform internal.require_live_session();
  select tournament_id, age_group, publication_state into v_tournament, v_grade, v_state
  from public.tournament_plans where id = p_plan_id;
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

  -- THE PUBLISHED GAMES WERE BUILT FROM THESE TABLES. They are not left standing on the old ones.
  select count(*) into v_games from public.tournament_games where plan_id = p_plan_id;
  if v_state = 'PUBLISHED' and v_games > 0 and not coalesce(p_replace_games, false) then
    raise exception 'The published % schedule was built from these tables. Changing them replaces its % with new games, and every team is told.',
      v_grade, case when v_games = 1 then 'game' else v_games || ' games' end
      using errcode = '22023', hint = 'TOURNAMENT_TABLES_REPLACE_GAMES';
  end if;

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

  -- ...AND REPLACED, as the organiser confirmed: the games are generated again from the new tables, and
  -- the generator tells every team the schedule has been regenerated.
  if v_state = 'PUBLISHED' and v_games > 0 then
    perform public.generate_tournament_plan_fixtures(p_plan_id);
  end if;
end;
$function$;
revoke all on function public.set_tournament_plan_tables(uuid, jsonb, boolean) from public, anon;
grant execute on function public.set_tournament_plan_tables(uuid, jsonb, boolean) to authenticated;


-- =====================================================================================================
-- 7. PUBLICATION WAITS FOR A SCHEDULE WITH NO CLASH AND NO GAME WITHOUT A PITCH
-- =====================================================================================================

CREATE OR REPLACE FUNCTION internal.tournament_plan_readiness(p_plan_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.tournament_plans; v_t public.tournaments; v_format text; v_c jsonb;
  v_blockers jsonb := '[]'; v_warnings jsonb := '[]';
  v_days int; v_pitches int; v_times int; v_rounds int; v_small text; v_limit int; v_competing int;
  v_games int; v_untimed int; v_unpitched int; v_misfit int; v_places_untimed int; v_results boolean;
  v_pending int; v_stage text; v_settled int; v_total_places int; v_draw int;
  v_fixtures_out boolean; v_q int; v_short text; v_sr int;
  v_mine uuid[]; v_clashes int := 0; v_clash_message text; v_unreserved int := 0; v_unreserved_message text;
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
  elsif v_format = 'swiss' then
    -- every round's reserved places, paired or not
    select count(*) into v_total_places from public.tournament_bracket_pairings where plan_id = p_plan_id;
  elsif v_format = 'hybrid' then
    -- the group games, then every knockout place, whether or not its sides are known yet
    select (select count(*) from public.tournament_games where plan_id = p_plan_id and bracket_position is null)
         + (select count(*) from public.tournament_bracket_pairings where plan_id = p_plan_id)
    into v_total_places;
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

    -- A HYBRID NEEDS TO KNOW WHO GOES THROUGH, and every table has to be bigger than that.
    if v_format = 'hybrid' and v_competing >= 2 then
      select count(*) * coalesce(v_plan.qualifiers_per_table, 0) into v_q
      from public.tournament_plan_tables t where t.plan_id = p_plan_id;
      if v_plan.qualifiers_per_table is null then
        v_blockers := v_blockers || jsonb_build_object('code', 'HYBRID_QUALIFIERS', 'stage', 'generate', 'action', 'qualifiers',
          'message', 'Choose how many teams from each table go through to the knockout stage.');
      else
        select string_agg(t.name, ', ' order by t.sort_order), count(*) into v_short, v_draw
        from public.tournament_plan_tables t
        where t.plan_id = p_plan_id
          and (select count(*) from public.tournament_plan_table_sides s where s.table_id = t.id) <= v_plan.qualifiers_per_table;
        if v_short is not null then
          v_blockers := v_blockers || jsonb_build_object('code', 'HYBRID_QUALIFIERS', 'stage', 'generate', 'action', 'qualifiers',
            'message', format('%s from each table %s through, so every table needs at least %s teams. %s %s not.',
              v_plan.qualifiers_per_table, case when v_plan.qualifiers_per_table = 1 then 'goes' else 'go' end,
              v_plan.qualifiers_per_table + 1, v_short, case when v_draw = 1 then 'does' else 'do' end));
        elsif v_q < 2 then
          v_blockers := v_blockers || jsonb_build_object('code', 'HYBRID_QUALIFIERS', 'stage', 'generate', 'action', 'qualifiers',
            'message', 'A knockout stage needs at least two teams. With one table, choose at least two to go through.');
        end if;
      end if;
    end if;
    -- How many kick-off times the arrangement needs: a table of n plays n-1 rounds (n when odd).
    select coalesce(max(case when n % 2 = 0 then n - 1 else n end), 0) into v_rounds
    from (select count(*)::int as n from public.tournament_plan_table_sides s where s.plan_id = p_plan_id group by s.table_id) x
    where n >= 2;
    -- A SWISS IS ONE TABLE, PLAYED IN A CHOSEN NUMBER OF ROUNDS, and no pair may meet twice.
    if v_format = 'swiss' and v_competing >= 2 then
      v_sr := internal.tournament_plan_swiss_rounds(p_plan_id);
      if (select count(*) from public.tournament_plan_tables t where t.plan_id = p_plan_id) > 1 then
        v_blockers := v_blockers || jsonb_build_object('code', 'SWISS_ONE_TABLE', 'stage', 'generate', 'action', 'tables',
          'message', 'A Swiss competition ranks every team in one table. Put all the teams in one table.');
      end if;
      if v_sr is null then
        v_blockers := v_blockers || jsonb_build_object('code', 'SWISS_ROUNDS', 'stage', 'generate', 'action', 'rounds',
          'message', 'Choose how many rounds this Swiss competition plays.');
      elsif v_sr > internal.swiss_round_limit(v_competing) then
        v_blockers := v_blockers || jsonb_build_object('code', 'SWISS_ROUNDS', 'stage', 'generate', 'action', 'rounds',
          'message', format('%s teams can play at most %s Swiss rounds without two teams meeting twice. Choose fewer rounds, or add teams.',
                            v_competing, internal.swiss_round_limit(v_competing)));
      end if;
      -- each round needs its own kick-off time
      v_rounds := coalesce(v_sr, 0);
    end if;
    -- and a hybrid's knockout stage needs a kick-off time for each of its rounds after that
    if v_format = 'hybrid' and coalesce(v_q, 0) >= 2 then
      v_rounds := v_rounds + internal.bracket_rounds(internal.bracket_size(v_q));
    end if;
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

    if v_format in ('knockout', 'hybrid', 'swiss') then
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
    -- A KICK-OFF WITHOUT A PITCH IS NOT A SCHEDULE: nobody can find the game. Publication waits for it.
    if v_unpitched > 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'NO_PITCH', 'stage', 'publish', 'action', 'edit_schedule', 'count', v_unpitched,
        'message', format('%s %s a kick-off time but no pitch. Give %s a pitch.', v_unpitched,
                          case when v_unpitched = 1 then 'game has' else 'games have' end,
                          case when v_unpitched = 1 then 'it' else 'each one' end));
    end if;

    -- NO CLASH IS PUBLISHED: one pitch fuller than it is, one team in two places, a round before the round
    -- it follows, or a game on a pitch the tournament has not reserved -- across every competition of the
    -- tournament, because U10 and U12 on Pitch 1 at 09:30 is one clash. The same engine refuses a move.
    select array_agg(z.id) into v_mine from (
      select g.id from public.tournament_games g where g.plan_id = p_plan_id
      union all
      select bp.id from public.tournament_bracket_pairings bp where bp.plan_id = p_plan_id and bp.game_id is null) z;
    select count(*) filter (where x.code <> 'PITCH_NOT_RESERVED'),
           (array_agg(x.message order by x.game_date, x.at_time, x.code) filter (where x.code <> 'PITCH_NOT_RESERVED'))[1],
           count(*) filter (where x.code = 'PITCH_NOT_RESERVED'),
           (array_agg(x.message order by x.game_date, x.at_time) filter (where x.code = 'PITCH_NOT_RESERVED'))[1]
    into v_clashes, v_clash_message, v_unreserved, v_unreserved_message
    from internal.tournament_schedule_conflicts(v_plan.tournament_id) x
    where x.unit_ids && coalesce(v_mine, '{}'::uuid[]);
    if v_clashes > 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'CLASH', 'stage', 'publish', 'action', 'edit_schedule', 'count', v_clashes,
        'message', case when v_clashes = 1 then v_clash_message
                        else format('%s %s clashes to change in all.', v_clash_message, initcap(internal.count_word(v_clashes))) end);
    end if;
    if v_unreserved > 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'PITCH_NOT_RESERVED', 'stage', 'publish', 'action', 'edit_schedule', 'count', v_unreserved,
        'message', case when v_unreserved = 1 then v_unreserved_message
                        else format('%s %s games in all are on pitches not reserved for them.', v_unreserved_message, initcap(internal.count_word(v_unreserved))) end);
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
    'conflictCount', v_clashes + v_unreserved,
    'blockers', v_blockers,
    'warnings', v_warnings
  );
end;
$function$;

-- A draft plan's games are the organiser's until it is published (they were on every host-team viewer's read).
CREATE OR REPLACE FUNCTION public.get_tournament_centre(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v jsonb;
  v_can_manage boolean;
begin
  if not internal.tournament_visible_row(p_tournament_id) then
    return null;
  end if;
  v_can_manage := internal.can_manage_tournament(p_tournament_id);

  select jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'rugbyCode', t.rugby_code,
    'startsOn', t.event_date,
    'endsOn', t.ends_on,
    'status', t.status,
    'cancelledAt', t.cancelled_at,
    'cancellationReason', t.cancellation_reason,
    'notes', t.notes,
    'venueNotes', t.venue_notes,
    'seasonName', (select s.name from public.seasons s where s.id = t.season_id),
    'hostName', (select cd.name from public.club_directory cd where cd.id = t.host_directory_id),
    'hostClubId', t.host_club_id,
    'venue', (
      select jsonb_build_object('id', ve.id, 'name', ve.name, 'address', ve.address, 'postcode', ve.postcode)
      from public.venues ve where ve.id = t.venue_id
    ),
    'canManageTournament', v_can_manage,

    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participantId', tp.id,
        'clubName', icd.name,
        'teamTypeLabel', ictt.label,
        'status', tp.status
      ) order by icd.name)
      from public.tournament_participants tp
      join public.club_directory icd on icd.id = tp.club_directory_id
      join public.canonical_team_types ictt on ictt.id = tp.canonical_team_type_id
      where tp.tournament_id = t.id
        and tp.status = 'pending'
        and ((tp.team_id is not null and internal.can('calendar.event.manage', 'team', tp.club_id, tp.team_id, null))
             or (tp.club_id is not null and internal.can('tournament.tournament.manage', 'club', tp.club_id, null, null)))
    ), '[]'::jsonb),

    'entries', coalesce((
      select jsonb_agg(entry order by entry->>'teamName')
      from (
        select jsonb_build_object(
          'id', e.id,
          'teamId', e.team_id,
          'clubId', e.club_id,
          'teamName', tm.display_name,
          'ageGroup', tm.age_group,
          'clubName', cd.name,
          'clubLogoPath', c.logo_storage_path,
          'directoryLogoPath', cd.logo_storage_path,
          'canManageEntry', internal.can_manage_tournament_entry(e.id),
          -- WHOSE TEAM THIS IS, from the viewer's point of view. Presentation
          -- only: it chooses the tab that opens, and hides nothing.
          'isMine', (
            internal.can('calendar.event.manage', 'team', e.club_id, e.team_id, null)
            or exists (
              select 1 from public.player_team_memberships ptm
              where ptm.team_id = e.team_id
                and ptm.status = 'active'
                and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
            )
          ),
          'opponents', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', o.id,
              'participantId', tp.id,
              'clubName', ocd.name,
              'clubLogoPath', (select oc.logo_storage_path from public.clubs oc where oc.id = tp.club_id),
              'directoryLogoPath', ocd.logo_storage_path,
              'teamTypeLabel', ctt.label,
              'status', tp.status
            ) order by o.sort_order, ocd.name)
            from public.tournament_entry_opponents o
            join public.tournament_participants tp on tp.id = o.participant_id
            join public.club_directory ocd on ocd.id = tp.club_directory_id
            join public.canonical_team_types ctt on ctt.id = tp.canonical_team_type_id
            where o.entry_id = e.id
          ), '[]'::jsonb),
          'games', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', g.id,
              'opponentId', other.id,
              'opponentClubName', gcd.name,
              'gameDate', g.game_date,
              'startTime', g.start_time,
              'durationMinutes', g.duration_minutes,
              'pitchId', g.pitch_id,
              'pitchName', gp.display_name,
              'status', g.status,
              'ourScore', case when g.side_a_id = mine.id then g.side_a_score else g.side_b_score end,
              'opponentScore', case when g.side_a_id = mine.id then g.side_b_score else g.side_a_score end
            ) order by g.game_date, g.start_time nulls last, g.sort_order)
            from public.tournament_participants mine
            join public.tournament_games g on (g.side_a_id = mine.id or g.side_b_id = mine.id)
            join public.tournament_participants other
              on other.id = case when g.side_a_id = mine.id then g.side_b_id else g.side_a_id end
            join public.club_directory gcd on gcd.id = other.club_directory_id
            left join public.club_pitches gp on gp.id = g.pitch_id
            where mine.tournament_id = t.id and mine.team_id = e.team_id
              -- A DRAFT PLAN'S GAMES ARE THE ORGANISER'S until it is published.
              and (g.plan_id is null or internal.tournament_plan_readable(g.plan_id))
          ), '[]'::jsonb)
        ) as entry
        from public.tournament_team_entries e
        join public.teams tm on tm.id = e.team_id
        join public.clubs c on c.id = e.club_id
        join public.club_directory cd on cd.id = c.directory_id
        where e.tournament_id = t.id
      ) entries
    ), '[]'::jsonb),
    'pitches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tp.id,
        'pitchId', tp.pitch_id,
        'pitchName', cp.display_name,
        'reservedOn', tp.reserved_on,
        'startTime', tp.start_time,
        'endTime', tp.end_time
      ) order by tp.reserved_on, tp.start_time, cp.display_name)
      from public.tournament_pitches tp
      join public.club_pitches cp on cp.id = tp.pitch_id
      where tp.tournament_id = t.id
    ), '[]'::jsonb)
  ) into v
  from public.tournaments t
  where t.id = p_tournament_id;

  return v;
end $function$;

-- =====================================================================================================
-- 8. READING THE PLAN
-- =====================================================================================================

-- A SIDE AS A PLAN DRAWS IT: the same club, crest and team label the draft read has always used.
create or replace function internal.tournament_plan_side_json(p_participant_id uuid, p_host_club_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'participantId', tp.id,
    'clubName', cd.name,
    'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),
    'label', coalesce(tm.display_name,
                      case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label else tp.age_group end),
    'isHost', (tp.club_id is not null and tp.club_id = p_host_club_id))
  from public.tournament_participants tp
  join public.club_directory cd on cd.id = tp.club_directory_id
  left join public.teams tm on tm.id = tp.team_id
  where tp.id = p_participant_id;
$function$;

-- THE PLAN AS A SCHEDULE: every game and every knockout place of one competition, with its day, kick-off,
-- pitch and length; the pitches the tournament has reserved and how much each takes; what the tournament's
-- other competitions already have on those pitches; and every clash, in words. View Plan reads this, and
-- Edit Plan checks a staged change against the same facts the server will check it against.
create or replace function public.get_tournament_plan_schedule(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_plan public.tournament_plans; v_t public.tournaments; v_mine uuid[];
begin
  perform internal.require_live_session();
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.id is null then return null; end if;
  if not internal.can_manage_tournament(v_plan.tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  select * into v_t from public.tournaments where id = v_plan.tournament_id;

  select array_agg(z.id) into v_mine from (
    select g.id from public.tournament_games g where g.plan_id = p_plan_id
    union all
    select bp.id from public.tournament_bracket_pairings bp where bp.plan_id = p_plan_id and bp.game_id is null) z;

  return jsonb_build_object(
    'planId', v_plan.id,
    'tournamentId', v_t.id,
    'tournamentName', v_t.name,
    'ageGroup', v_plan.age_group,
    'format', coalesce(v_plan.format, v_t.format),
    'publicationState', v_plan.publication_state,
    'publishedAt', v_plan.published_at,
    'gameDurationMinutes', v_plan.game_duration_minutes,
    'changeoverMinutes', coalesce(v_plan.changeover_minutes, 0),
    'dayStartTime', to_char(v_plan.day_start_time, 'HH24:MI'),
    'dayEndTime', to_char(v_plan.day_end_time, 'HH24:MI'),
    'maxDurationMinutes', (select r.half_minutes * 2 from public.fixture_scheduling_rules r
                           where r.rugby_code = v_t.rugby_code and r.age_group = v_plan.age_group
                           order by r.effective_season desc nulls last limit 1),
    -- How much ground one of this competition's games needs, in square metres (its RFU pitch, where sourced).
    'gameAreaM2', internal.tournament_game_area_m2(v_t.id, v_plan.age_group),
    'days', coalesce((select jsonb_agg(d.day_date order by d.day_date)
                      from public.tournament_plan_days d where d.plan_id = p_plan_id), '[]'::jsonb),
    -- EVERY PITCH THE TOURNAMENT HAS, its ground, the club's own layout, and when it is reserved -- each
    -- reservation with how the organiser has marked the pitch out for it.
    'pitches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'pitchId', p.id, 'name', p.display_name,
               'areas', coalesce(p.lane_count, 1), 'areaM2', internal.pitch_area_m2(p.id),
               'layout', p.layout,
               'reservations', (select jsonb_agg(jsonb_build_object('id', tp.id, 'date', tp.reserved_on,
                                                                     'startTime', to_char(tp.start_time, 'HH24:MI'),
                                                                     'endTime', to_char(tp.end_time, 'HH24:MI'),
                                                                     'playingAreas', coalesce(tp.playing_areas, p.lane_count, 1),
                                                                     'markedByOrganiser', tp.playing_areas is not null)
                                                  order by tp.reserved_on, tp.start_time)
                                from public.tournament_pitches tp
                                where tp.tournament_id = v_t.id and tp.pitch_id = p.id))
             order by p.sort_order, p.display_name)
      from public.club_pitches p
      where p.id in (select tp.pitch_id from public.tournament_pitches tp where tp.tournament_id = v_t.id)
         or p.id in (select g.pitch_id from public.tournament_games g where g.plan_id = p_plan_id)), '[]'::jsonb),
    'games', coalesce((
      select jsonb_agg(x.j order by x.d nulls last, x.s nulls last, x.pitch_name nulls last, x.ord)
      from (
        select g.game_date as d, g.start_time as s, cp.display_name as pitch_name, g.sort_order as ord,
               jsonb_build_object(
                 'id', g.id, 'kind', 'game', 'gameId', g.id, 'placeId', bp.id,
                 'round', g.round_number, 'tableId', g.table_id, 'tableName', tt.name,
                 'stageRound', case when internal.tournament_plan_format(p_plan_id) = 'swiss' then g.round_number
                                    when g.bracket_position is not null then g.round_number
                                    when internal.tournament_plan_format(p_plan_id) = 'hybrid' then 0 end,
                 'isThirdPlace', coalesce(g.is_third_place, false),
                 'roundLabel', case when g.bracket_position is not null or internal.tournament_plan_format(p_plan_id) = 'swiss'
                                    then internal.tournament_game_round_label(p_plan_id, g.round_number, g.is_third_place) end,
                 -- The words a round-order clash uses, so the editor says exactly what the server will.
                 'roundSubject', case when g.bracket_position is not null or internal.tournament_plan_format(p_plan_id) = 'swiss'
                                      then internal.schedule_round_label(p_plan_id, g.round_number, g.is_third_place, false) end,
                 'roundWhole', case when g.bracket_position is not null or internal.tournament_plan_format(p_plan_id) = 'swiss'
                                    then internal.schedule_round_label(p_plan_id, g.round_number, false, true)
                                    when internal.tournament_plan_format(p_plan_id) = 'hybrid' then 'the group stage' end,
                 'sideA', internal.tournament_plan_side_json(g.side_a_id, v_t.host_club_id),
                 'sideB', internal.tournament_plan_side_json(g.side_b_id, v_t.host_club_id),
                 'date', g.game_date,
                 'startTime', to_char(g.start_time, 'HH24:MI'),
                 'durationMinutes', coalesce(g.duration_minutes, v_plan.game_duration_minutes),
                 'pitchId', g.pitch_id, 'pitchName', cp.display_name,
                 'placedByHand', g.placed_by_hand,
                 'isHistory', internal.tournament_game_is_history(g.id),
                 'status', g.status, 'resultStatus', g.result_status,
                 'sideAScore', g.side_a_score, 'sideBScore', g.side_b_score) as j
        from public.tournament_games g
        left join public.tournament_plan_tables tt on tt.id = g.table_id
        left join public.club_pitches cp on cp.id = g.pitch_id
        left join public.tournament_bracket_pairings bp on bp.game_id = g.id
        where g.plan_id = p_plan_id
        union all
        -- A KNOCKOUT PLACE NOT YET PAIRED still has a time and a pitch, and is moved like a game.
        select bp.game_date, bp.start_time, cp.display_name, 100000 + bp.round_number * 100 + bp.game_position,
               jsonb_build_object(
                 'id', bp.id, 'kind', 'place', 'gameId', null, 'placeId', bp.id,
                 'round', bp.round_number, 'gamePosition', bp.game_position, 'tableId', null, 'tableName', null,
                 'stageRound', bp.round_number,
                 'isThirdPlace', coalesce(bp.is_third_place, false),
                 'roundLabel', internal.tournament_game_round_label(p_plan_id, bp.round_number, bp.is_third_place),
                 'roundSubject', internal.schedule_round_label(p_plan_id, bp.round_number, bp.is_third_place, false),
                 'roundWhole', internal.schedule_round_label(p_plan_id, bp.round_number, false, true),
                 'sideA', null, 'sideB', null,
                 'date', bp.game_date,
                 'startTime', to_char(bp.start_time, 'HH24:MI'),
                 'durationMinutes', v_plan.game_duration_minutes,
                 'pitchId', bp.pitch_id, 'pitchName', cp.display_name,
                 'placedByHand', bp.placed_by_hand,
                 'isHistory', false, 'status', 'SCHEDULED', 'resultStatus', 'none',
                 'sideAScore', null, 'sideBScore', null)
        from public.tournament_bracket_pairings bp
        left join public.club_pitches cp on cp.id = bp.pitch_id
        where bp.plan_id = p_plan_id and bp.game_id is null) x), '[]'::jsonb),
    -- WHAT THE TOURNAMENT'S OTHER COMPETITIONS HAVE ON THESE PITCHES, so a move is checked against them.
    'others', coalesce((
      select jsonb_agg(jsonb_build_object(
               'unitId', u.unit_id, 'ageGroup', u.age_group, 'date', u.game_date,
               'startTime', to_char(u.start_time, 'HH24:MI'), 'endTime', to_char(u.end_time, 'HH24:MI'),
               'occupiedUntil', to_char(u.occupied_until, 'HH24:MI'),
               'pitchId', u.pitch_id, 'gameAreaM2', u.game_area,
               'sideIds', to_jsonb(u.side_ids), 'isHistory', u.is_history)
             order by u.game_date, u.start_time)
      from internal.tournament_schedule_units(v_t.id) u
      where u.plan_id is distinct from p_plan_id), '[]'::jsonb),
    'conflicts', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'unitIds', to_jsonb(c.unit_ids), 'pitchId', c.pitch_id,
                                          'date', c.game_date, 'at', to_char(c.at_time, 'HH24:MI'), 'message', c.message)
                       order by c.game_date, c.at_time, c.code)
      from internal.tournament_schedule_conflicts(v_t.id) c
      where c.unit_ids && coalesce(v_mine, '{}'::uuid[])), '[]'::jsonb),
    'readiness', internal.tournament_plan_readiness(p_plan_id)
  );
end;
$function$;
revoke all on function public.get_tournament_plan_schedule(uuid) from public, anon;
grant execute on function public.get_tournament_plan_schedule(uuid) to authenticated;
comment on function public.get_tournament_plan_schedule(uuid) is
  'One competition''s plan as a schedule -- games, knockout places, reserved pitches, other competitions'' occupancy and clashes -- for its organiser.';

-- WHERE EACH COMPETITION'S PLANNING HAS GOT TO, for the Planning tab. Reading it creates nothing.
create or replace function public.get_tournament_plan_summaries(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare v_t public.tournaments;
begin
  perform internal.require_live_session();
  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then return null; end if;
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  return coalesce((
    with units as (
      select u.unit_id, u.plan_id from internal.tournament_schedule_units(p_tournament_id) u
    ), clashes as (
      select c.unit_ids from internal.tournament_schedule_conflicts(p_tournament_id) c
    )
    select jsonb_agg(jsonb_build_object(
             'ageGroup', ag.age_group,
             'planId', p.id,
             'publicationState', p.publication_state,
             'format', coalesce(p.format, v_t.format),
             'publishedAt', p.published_at,
             'updatedAt', p.updated_at,
             'gameCount', (select count(*) from public.tournament_games g where g.plan_id = p.id),
             'placeCount', (select count(*) from public.tournament_bracket_pairings bp where bp.plan_id = p.id and bp.game_id is null),
             'scheduledCount', (select count(*) from public.tournament_games g
                                where g.plan_id = p.id and g.start_time is not null and g.pitch_id is not null),
             'resultCount', (select count(*) from public.tournament_games g
                             where g.plan_id = p.id and internal.tournament_game_is_history(g.id)),
             'conflictCount', (select count(*) from clashes c
                               where exists (select 1 from units u where u.plan_id = p.id and u.unit_id = any (c.unit_ids))),
             'firstDay', (select min(d.day_date) from public.tournament_plan_days d where d.plan_id = p.id),
             'lastDay', (select max(d.day_date) from public.tournament_plan_days d where d.plan_id = p.id))
           order by ag.age_group)
    from public.tournament_age_groups ag
    left join public.tournament_plans p
      on p.tournament_id = ag.tournament_id and p.age_group = ag.age_group and p.publication_state <> 'SUPERSEDED'
    where ag.tournament_id = p_tournament_id), '[]'::jsonb);
end;
$function$;
revoke all on function public.get_tournament_plan_summaries(uuid) from public, anon;
grant execute on function public.get_tournament_plan_summaries(uuid) to authenticated;
comment on function public.get_tournament_plan_summaries(uuid) is
  'Each competition''s plan state for the Planning tab -- none, draft or published, its games and its clashes -- without creating anything.';
