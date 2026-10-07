-- AN ORGANISER CAN MOVE ONE GAME, AND PEOPLE HEAR WHEN A PUBLISHED SCHEDULE CHANGES
-- (Tournament Planning parity programme, phases 10 and 15).
--
-- Complete Scheduling's automatic pass (schedule_tournament_plan, 20270720) places every game it can.
-- What it cannot do is honour a one-off decision -- "the Preston game is on Pitch 2 at 11:30 because
-- their coach arrives late" -- and before this the only per-game write, save_tournament_game, overwrote
-- the sides and the SCORES as well, bypassing the result workflow. set_tournament_game_schedule moves
-- one game's day, kick-off and pitch, and nothing else, with the refusals said in words:
--   * a game with a result or a submission is history and does not move;
--   * the day must be one of this competition's playing days;
--   * the pitch must be reserved for the tournament on that day, covering the whole game;
--   * neither side may be in two places at once.
--
-- PEOPLE HEAR ABOUT A PUBLISHED SCHEDULE CHANGING, and only then. A draft is the organiser's own; a
-- published schedule is something teams have planned their morning around. tournament_schedule_changed
-- (the existing "Schedule changes" event of the tournaments topic) is sent to both sides' result officers
-- when one published game moves, and to every participating side when a published plan is regenerated or
-- rescheduled as a whole.
--
-- AND KNOCKOUT PROGRESSION STOPS SPEAKING FROM A DRAFT. fill_bracket_slot told sides "You're through"
-- whether or not the draw had been published -- in a private draft that is news nobody should have yet.

insert into public.notification_types (type_key, topic_key, mandatory_override, event_key)
values ('tournament_schedule_changed', 'tournaments', null, 'schedule_changes')
on conflict (type_key) do update set topic_key = excluded.topic_key, event_key = excluded.event_key;

create or replace function internal.tournament_plan_is_published(p_plan_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce((select publication_state = 'PUBLISHED' from public.tournament_plans where id = p_plan_id), false);
$function$;

create or replace function public.set_tournament_game_schedule(p_game_id uuid, p_game_date date, p_start_time time, p_pitch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  g public.tournament_games; v_plan public.tournament_plans; v_dur int; v_end time; v_pitch_name text;
  v_a jsonb; v_b jsonb; v_t text;
begin
  perform internal.require_live_session();
  select * into g from public.tournament_games where id = p_game_id for update;
  if g.id is null then raise exception 'That game does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(g.tournament_id) then
    raise exception 'You do not have permission to change this tournament''s schedule.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tournaments where id = g.tournament_id and cancelled_at is not null) then
    raise exception 'This tournament has been cancelled.' using errcode = '22023';
  end if;
  if g.plan_id is null then
    raise exception 'That game is not part of a generated plan.' using errcode = '22023';
  end if;
  select * into v_plan from public.tournament_plans where id = g.plan_id;

  if g.result_status <> 'none' or exists (select 1 from public.tournament_game_result_submissions s where s.game_id = g.id) then
    raise exception 'This game already has a result, so its time and pitch are history and cannot be moved.'
      using errcode = '22023', hint = 'TOURNAMENT_GAME_HAS_RESULT';
  end if;
  if p_game_date is null or p_start_time is null or p_pitch_id is null then
    raise exception 'A game needs a day, a kick-off time and a pitch.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tournament_plan_days d where d.plan_id = g.plan_id and d.day_date = p_game_date) then
    raise exception 'That day is not one of this competition''s playing days.' using errcode = '22023';
  end if;

  v_dur := coalesce(g.duration_minutes, v_plan.game_duration_minutes, 20);
  if p_start_time + make_interval(mins => v_dur) < p_start_time then
    raise exception 'A game cannot run past midnight.' using errcode = '22023';
  end if;
  v_end := p_start_time + make_interval(mins => v_dur);
  -- INSIDE THE COMPETITION'S OWN PLAYING HOURS, the same window readiness checks every game against:
  -- a move the plan would immediately report as out of hours is refused here instead.
  if p_start_time < v_plan.day_start_time or v_end > v_plan.day_end_time then
    raise exception 'That is outside this competition''s playing hours (%-%). Choose a time inside them, or change the playing hours.',
      to_char(v_plan.day_start_time, 'HH24:MI'), to_char(v_plan.day_end_time, 'HH24:MI')
      using errcode = '22023', hint = 'TOURNAMENT_OUTSIDE_PLAYING_HOURS';
  end if;
  select display_name into v_pitch_name from public.club_pitches where id = p_pitch_id;
  if not exists (
    select 1 from public.tournament_pitches tp
    where tp.tournament_id = g.tournament_id and tp.pitch_id = p_pitch_id and tp.reserved_on = p_game_date
      and tp.start_time <= p_start_time and tp.end_time >= v_end
  ) then
    raise exception '% is not reserved for this tournament from % to % on that day. Reserve it first, or choose another pitch or time.',
      coalesce(v_pitch_name, 'That pitch'), to_char(p_start_time, 'HH24:MI'), to_char(v_end, 'HH24:MI')
      using errcode = '22023', hint = 'TOURNAMENT_PITCH_NOT_RESERVED';
  end if;

  -- THE ONLY THING THAT CANNOT HAPPEN IS A SIDE IN TWO PLACES AT ONCE (a pitch is not exclusive).
  if exists (
    select 1 from public.tournament_games o
    where o.tournament_id = g.tournament_id and o.id <> g.id
      and o.game_date = p_game_date and o.start_time is not null
      and (o.side_a_id in (g.side_a_id, g.side_b_id) or o.side_b_id in (g.side_a_id, g.side_b_id))
      and o.start_time < v_end
      and p_start_time < o.start_time + make_interval(mins => coalesce(o.duration_minutes, v_dur))
  ) then
    raise exception 'One of these teams is already playing then. Choose a time when both are free.'
      using errcode = '22023', hint = 'TOURNAMENT_SIDE_CLASH';
  end if;

  if g.game_date is not distinct from p_game_date and g.start_time is not distinct from p_start_time
     and g.pitch_id is not distinct from p_pitch_id then
    return internal.tournament_plan_readiness(g.plan_id);
  end if;

  update public.tournament_games
  set game_date = p_game_date, start_time = p_start_time, pitch_id = p_pitch_id, duration_minutes = v_dur,
      updated_by = auth.uid(), updated_at = now()
  where id = g.id;
  update public.tournament_bracket_pairings
  set game_date = p_game_date, start_time = p_start_time, pitch_id = p_pitch_id, updated_at = now()
  where game_id = g.id;

  if v_plan.publication_state = 'PUBLISHED' then
    v_a := internal.tournament_side_summary(g.side_a_id, null);
    v_b := internal.tournament_side_summary(g.side_b_id, null);
    select name into v_t from public.tournaments where id = g.tournament_id;
    perform internal.notify_tournament_side(s.id, 'tournament_schedule_changed', 'Tournament game moved',
      format('%s v %s at %s now kicks off at %s on %s, %s.', v_a ->> 'clubName', v_b ->> 'clubName', v_t,
             to_char(p_start_time, 'HH24:MI'), coalesce(v_pitch_name, 'its pitch'), to_char(p_game_date, 'FMDy FMDD Mon')),
      jsonb_build_object('tournament_id', g.tournament_id, 'tournament_plan_id', g.plan_id, 'tournament_game_id', g.id))
    from (select g.side_a_id as id union select g.side_b_id) s;
  end if;

  return internal.tournament_plan_readiness(g.plan_id);
end;
$function$;
revoke all on function public.set_tournament_game_schedule(uuid, date, time, uuid) from public, anon;
grant execute on function public.set_tournament_game_schedule(uuid, date, time, uuid) to authenticated;

-- Every participating side hears when a PUBLISHED plan's schedule is replaced or re-placed as a whole.
create or replace function internal.announce_published_schedule_change(p_plan_id uuid, p_what text)
returns void
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare v_t uuid; v_grade text; v_name text;
begin
  select p.tournament_id, p.age_group, t.name into v_t, v_grade, v_name
  from public.tournament_plans p join public.tournaments t on t.id = p.tournament_id
  where p.id = p_plan_id and p.publication_state = 'PUBLISHED';
  if v_t is null then return; end if;
  perform internal.notify_tournament_participants(
    v_t, v_grade, auth.uid(), 'tournament_schedule_changed', 'Tournament schedule changed',
    format('The %s schedule for %s has %s. Check your kick-off times and pitches.', v_grade, v_name, p_what),
    jsonb_build_object('tournament_id', v_t, 'tournament_plan_id', p_plan_id));
end;
$function$;

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
  perform internal.announce_published_schedule_change(p_plan_id, 'been regenerated');
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
  perform internal.announce_published_schedule_change(p_plan_id, 'been regenerated');
  return v_n;
end;
$function$;

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
  perform internal.announce_published_schedule_change(p_plan_id, 'been rescheduled');
  return internal.tournament_plan_readiness(p_plan_id);
end;
$function$;

-- ---- progression notices only from a published draw ----

CREATE OR REPLACE FUNCTION internal.fill_bracket_slot(p_plan_id uuid, p_round integer, p_position integer, p_participant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_current uuid; v_game uuid; v_partner uuid; v_pair_pos integer;
  v_tournament_id uuid; v_round_label text; v_opponent jsonb; v_mine jsonb;
begin
  select participant_id into v_current from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = p_position and not is_third_place;
  if v_current is not distinct from p_participant then return; end if;

  v_game := internal.tournament_slot_game(p_plan_id, p_round, p_position);
  if v_game is not null and internal.tournament_game_has_activity(v_game) then
    raise exception
      'The % game this result feeds has already been played. Changing who goes through would delete it. Clear that game''s result first if it genuinely needs to change.',
      case when p_round = 1 then 'opening-round' else 'next-round' end
      using errcode = '22023', hint = 'TOURNAMENT_BRACKET_DOWNSTREAM_ACTIVITY';
  end if;

  update public.tournament_bracket_slots
  set participant_id = p_participant, updated_at = now()
  where plan_id = p_plan_id and round_number = p_round and position = p_position and not is_third_place;

  if v_game is not null then
    delete from public.tournament_games where id = v_game;
  end if;

  v_pair_pos := case when p_position % 2 = 1 then p_position + 1 else p_position - 1 end;
  select participant_id into v_partner from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = v_pair_pos and not is_third_place;

  -- A DRAFT DRAW IS NOBODY'S NEWS YET (20270721): progression is told only once the draw is published.
  select tournament_id into v_tournament_id from public.tournament_plans where id = p_plan_id;
  v_round_label := internal.tournament_game_round_label(p_plan_id, p_round, false);
  if p_participant is not null then v_mine := internal.tournament_side_summary(p_participant, null); end if;
  if p_participant is not null and p_round > 1 and internal.tournament_plan_is_published(p_plan_id) then
    if v_partner is not null then
      v_opponent := internal.tournament_side_summary(v_partner, null);
    end if;

    perform internal.notify_tournament_side(
      p_participant,
      'tournament_side_advanced',
      format('You''re through to the %s', coalesce(v_round_label, 'next round')),
      case when v_opponent is not null
        then format('Your %s opponent is %s.', coalesce(v_round_label, 'next round'), v_opponent->>'clubName')
        else 'The schedule will update once your opponent is known.'
      end,
      jsonb_build_object('tournament_id', v_tournament_id, 'tournament_plan_id', p_plan_id)
    );
  end if;

  if p_participant is not null and v_partner is not null then
    perform internal.create_bracket_game(p_plan_id, p_round, ((p_position + 1) / 2));

    if p_round > 1 and internal.tournament_plan_is_published(p_plan_id) then
      perform internal.notify_tournament_side(
        v_partner,
        'tournament_opponent_known',
        format('Your %s opponent is known', coalesce(v_round_label, 'next round')),
        format('You will play %s.', coalesce(v_mine->>'clubName', 'your opponent')),
        jsonb_build_object('tournament_id', v_tournament_id, 'tournament_plan_id', p_plan_id)
      );
    end if;
  end if;
end;
$function$;

-- ---- a draft game has no result ----

create or replace function internal.tournament_game_result_eligible(p_game_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.tournament_games g
    where g.id = p_game_id
      and g.status <> 'CANCELLED'
      and g.start_time is not null
      and (g.game_date + g.start_time) <= (now() at time zone 'Europe/London')
      -- and its plan is published: a draft game has no result (20270721)
      and (g.plan_id is null or internal.tournament_plan_is_published(g.plan_id))
  );
$function$;

CREATE OR REPLACE FUNCTION public.submit_tournament_game_result(p_game_id uuid, p_side_a_score integer, p_side_b_score integer, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g public.tournament_games;
  v_side uuid;
  v_other uuid;
  v_enabled boolean;
begin
  perform internal.require_live_session();

  if p_side_a_score is null or p_side_b_score is null or p_side_a_score < 0 or p_side_b_score < 0 then
    raise exception 'A score must be zero or a positive whole number.' using errcode = '22023';
  end if;

  select * into g from public.tournament_games where id = p_game_id for update;
  if g.id is null then raise exception 'That game does not exist.' using errcode = 'P0002'; end if;
  -- A DRAFT GAME HAS NO RESULT (20270721): until its plan is published nobody outside the organising
  -- club can see the game, so nobody records a score for it -- not a side, not the organiser.
  if g.plan_id is not null and not internal.tournament_plan_is_published(g.plan_id) then
    raise exception 'This game''s schedule has not been published yet, so its result cannot be recorded.'
      using errcode = '22023', hint = 'TOURNAMENT_PLAN_NOT_PUBLISHED';
  end if;

  -- THE ORGANISER DECIDES WHETHER TEAMS SUBMIT AT ALL. When they do not, the host records every result
  -- themselves through the resolution path -- a deliberate setting, not a missing feature.
  select coalesce(t.results_submission_enabled, true) into v_enabled
  from public.tournaments t where t.id = g.tournament_id;
  if not v_enabled then
    raise exception 'The organiser has turned off result submission for this tournament.' using errcode = '42501';
  end if;

  v_side := internal.tournament_game_side_for_caller(p_game_id);
  if v_side is null then
    raise exception 'Only somebody who can record results for one of the two sides may submit this result.'
      using errcode = '42501';
  end if;

  if not internal.tournament_game_result_eligible(p_game_id) then
    if g.status = 'CANCELLED' then
      raise exception 'This game was cancelled, so it has no result.' using errcode = '22023';
    end if;
    raise exception 'This game has not kicked off yet.' using errcode = '22023';
  end if;

  v_other := case when v_side = g.side_a_id then g.side_b_id else g.side_a_id end;

  -- ---- NOBODY CAN ANSWER ----------------------------------------------------------------------------
  --
  -- The opposition is a directory entry, not an Ovalball club. There is no confirmation to wait for, so
  -- waiting would be a pretence. Recorded, countable, and labelled as one side's record.
  if not internal.tournament_side_answerable(v_other) then
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'external_recorded', p_side_a_score, p_side_b_score, auth.uid(), v_side,
            nullif(trim(p_note), ''));

    update public.tournament_games
    set side_a_score = p_side_a_score, side_b_score = p_side_b_score,
        result_status = 'external_recorded', status = 'PLAYED',
        result_submitted_by = auth.uid(), result_submitted_by_participant_id = v_side,
        result_submitted_at = now(),
        result_confirmed_by = null, result_confirmed_at = null,
        updated_by = auth.uid(), updated_at = now()
    where id = p_game_id;

    -- The organiser is told, because it is their competition's table that just moved and nobody
    -- confirmed it. The other side is not told: there is nobody there.
    perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_confirmed',
      'Result recorded', 'A result has been recorded against a side that is not on Ovalball, so there '
      'was no confirmation to wait for. It counts towards the table.');
    return jsonb_build_object('status', 'external_recorded');
  end if;

  -- ---- nothing recorded yet -------------------------------------------------------------------------
  if g.result_status = 'none' then
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'initial', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));

    update public.tournament_games
    set side_a_score = p_side_a_score, side_b_score = p_side_b_score,
        result_status = 'awaiting_confirmation',
        result_submitted_by = auth.uid(), result_submitted_by_participant_id = v_side,
        result_submitted_at = now(), updated_by = auth.uid(), updated_at = now()
    where id = p_game_id;

    perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_awaiting_confirmation',
      'Result awaiting your confirmation',
      'A result has been submitted for your tournament game. Confirm it, or say what you think the score was.');
    return jsonb_build_object('status', 'awaiting_confirmation');
  end if;

  -- ---- somebody has already submitted ---------------------------------------------------------------
  if g.result_status = 'awaiting_confirmation' then
    if v_side = g.result_submitted_by_participant_id then
      -- THE SAME SIDE CORRECTING ITSELF. A new proposal, not an agreement: one club agreeing with
      -- itself is not two clubs agreeing.
      insert into public.tournament_game_result_submissions
        (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
      values (p_game_id, 'initial', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
      update public.tournament_games
      set side_a_score = p_side_a_score, side_b_score = p_side_b_score,
          result_submitted_by = auth.uid(), result_submitted_at = now(),
          updated_by = auth.uid(), updated_at = now()
      where id = p_game_id;
      return jsonb_build_object('status', 'awaiting_confirmation');
    end if;

    if p_side_a_score = g.side_a_score and p_side_b_score = g.side_b_score then
      insert into public.tournament_game_result_submissions
        (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
      values (p_game_id, 'confirmation', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
      update public.tournament_games
      set result_status = 'final', result_confirmed_by = auth.uid(), result_confirmed_at = now(),
          status = 'PLAYED', updated_by = auth.uid(), updated_at = now()
      where id = p_game_id;
      perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_confirmed',
        'Result confirmed', 'Both sides agree the score, so it now counts towards the table.');
      return jsonb_build_object('status', 'final');
    end if;

    -- A CONTEST. The original submission is untouched; this is a second row saying something else.
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'dispute', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
    update public.tournament_games
    set result_status = 'disputed', updated_by = auth.uid(), updated_at = now()
    where id = p_game_id;
    perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_contested',
      'Result contested', 'The two sides have given different scores. The organiser will settle it.');
    return jsonb_build_object('status', 'disputed');
  end if;

  -- ---- already in dispute ---------------------------------------------------------------------------
  if g.result_status = 'disputed' then
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'dispute', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
    return jsonb_build_object('status', 'disputed');
  end if;

  -- ---- already settled ------------------------------------------------------------------------------
  if g.result_status in ('final', 'amendment_pending', 'external_recorded') then
    if p_side_a_score = g.side_a_score and p_side_b_score = g.side_b_score
       and g.result_status in ('final', 'external_recorded') then
      return jsonb_build_object('status', g.result_status);
    end if;
    -- A CORRECTION AFTER AGREEMENT IS A PROPOSAL. The recorded score stays canonical and the table
    -- stays as it is until the organiser settles it.
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'amendment_proposal', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
    update public.tournament_games
    set result_status = 'amendment_pending', updated_by = auth.uid(), updated_at = now()
    where id = p_game_id;
    perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_contested',
      'A change to a recorded result', 'A side has proposed a different score for a game that was already recorded.');
    return jsonb_build_object('status', 'amendment_pending');
  end if;

  raise exception 'This result cannot be submitted in its current state (%).', g.result_status using errcode = '22023';
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_tournament_game_result(p_game_id uuid, p_side_a_score integer, p_side_b_score integer, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g public.tournament_games;
begin
  perform internal.require_live_session();
  if p_side_a_score is null or p_side_b_score is null or p_side_a_score < 0 or p_side_b_score < 0 then
    raise exception 'A score must be zero or a positive whole number.' using errcode = '22023';
  end if;

  select * into g from public.tournament_games where id = p_game_id for update;
  if g.id is null then raise exception 'That game does not exist.' using errcode = 'P0002'; end if;
  -- A DRAFT GAME HAS NO RESULT (20270721): until its plan is published nobody outside the organising
  -- club can see the game, so nobody records a score for it -- not a side, not the organiser.
  if g.plan_id is not null and not internal.tournament_plan_is_published(g.plan_id) then
    raise exception 'This game''s schedule has not been published yet, so its result cannot be recorded.'
      using errcode = '22023', hint = 'TOURNAMENT_PLAN_NOT_PUBLISHED';
  end if;

  if not internal.can_resolve_tournament_result(p_game_id) then
    raise exception 'Only the tournament organiser can settle a result.' using errcode = '42501';
  end if;
  if g.status = 'CANCELLED' then
    raise exception 'This game was cancelled, so it has no result.' using errcode = '22023';
  end if;
  -- BEING THE HOST DOES NOT MOVE THE KICK-OFF. The same question a fresh submission answers: has
  -- THIS game's own scheduled kick-off been reached. A bracket dependency resolving early (both
  -- semi-finalists known well before a three o'clock kick-off) does not change when the Final's
  -- result may be written.
  if not internal.tournament_game_result_eligible(p_game_id) then
    if g.start_time is null then
      raise exception 'A kick-off time must be scheduled before a result can be recorded.' using errcode = '22023';
    end if;
    raise exception 'This game has not kicked off yet.' using errcode = '22023';
  end if;

  -- ATTRIBUTABLE, AND ADDITIVE. The resolution is a row of its own; nothing already said is altered.
  insert into public.tournament_game_result_submissions
    (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
  values (p_game_id, 'host_resolution', p_side_a_score, p_side_b_score, auth.uid(), null, nullif(trim(p_reason), ''));

  update public.tournament_games
  set side_a_score = p_side_a_score, side_b_score = p_side_b_score,
      result_status = 'final', status = 'PLAYED',
      result_confirmed_by = auth.uid(), result_confirmed_at = now(),
      result_resolved_by = auth.uid(), result_resolved_at = now(),
      result_resolution_reason = nullif(trim(p_reason), ''),
      updated_by = auth.uid(), updated_at = now()
  where id = p_game_id;

  perform internal.notify_tournament_result(p_game_id, null, 'tournament_result_resolved',
    'The organiser settled a result', 'The organiser has set the final score for a tournament game.');
  return jsonb_build_object('status', 'final');
end;
$function$;

CREATE OR REPLACE FUNCTION public.declare_tournament_game_winner(p_game_id uuid, p_participant_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare g public.tournament_games; v_method text;
begin
  perform internal.require_live_session();
  select * into g from public.tournament_games where id = p_game_id for update;
  if g.id is null then raise exception 'That game does not exist.' using errcode = 'P0002'; end if;
  -- A DRAFT GAME HAS NO RESULT (20270721): until its plan is published nobody outside the organising
  -- club can see the game, so nobody records a score for it -- not a side, not the organiser.
  if g.plan_id is not null and not internal.tournament_plan_is_published(g.plan_id) then
    raise exception 'This game''s schedule has not been published yet, so its result cannot be recorded.'
      using errcode = '22023', hint = 'TOURNAMENT_PLAN_NOT_PUBLISHED';
  end if;
  if not internal.can_resolve_tournament_result(p_game_id) then
    raise exception 'Only the tournament organiser can decide who went through.' using errcode = '42501';
  end if;
  if p_participant_id is distinct from g.side_a_id and p_participant_id is distinct from g.side_b_id then
    raise exception 'The winner must be one of the two sides.' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say how the winner was decided -- it is recorded against the tournament.'
      using errcode = '22023';
  end if;

  select tie_resolution into v_method from public.tournament_plans where id = g.plan_id;
  if coalesce(v_method, 'none') = 'none' then
    raise exception 'This competition does not settle level games, so a winner cannot be recorded.'
      using errcode = '22023';
  end if;

  -- ONLY A LEVEL GAME NEEDS DECIDING. A decisive score already says who won, and overriding it would
  -- be changing the result rather than resolving a tie -- which is what correcting the score is for.
  if internal.tournament_score_winner(p_game_id) is not null then
    raise exception 'This game already has a winner from its score.' using errcode = '22023';
  end if;

  update public.tournament_games
  set winner_participant_id = p_participant_id,
      winner_decided_by = auth.uid(), winner_decided_at = now(),
      winner_decision_reason = trim(p_reason),
      updated_by = auth.uid(), updated_at = now()
  where id = p_game_id;
end;
$function$;

-- ---- a third-place play-off names where its places come from, whenever it is switched on ----

CREATE OR REPLACE FUNCTION internal.ensure_third_place_game(p_plan_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_on boolean; v_size integer; v_rounds integer; v_semi integer;
  v_a uuid; v_b uuid; v_t uuid; v_grade text; v_existing uuid; v_id uuid; bp record;
begin
  select p.third_place_playoff, p.tournament_id, p.age_group into v_on, v_t, v_grade
  from public.tournament_plans p where p.id = p_plan_id;
  select count(*) into v_size from public.tournament_bracket_slots where plan_id = p_plan_id and round_number = 1;
  v_rounds := internal.bracket_rounds(v_size);
  if v_rounds < 2 then return null; end if;
  v_semi := v_rounds - 1;

  select id into v_existing from public.tournament_games where plan_id = p_plan_id and is_third_place limit 1;

  if not coalesce(v_on, false) then
    if v_existing is not null and not internal.tournament_game_has_activity(v_existing) then
      delete from public.tournament_games where id = v_existing;
    end if;
    delete from public.tournament_bracket_pairings
    where plan_id = p_plan_id and is_third_place and game_id is null;
    if not exists (select 1 from public.tournament_games where plan_id = p_plan_id and is_third_place) then
      delete from public.tournament_bracket_slots where plan_id = p_plan_id and is_third_place;
    end if;
    return null;
  end if;

  -- THE TWO PLACES SAY WHERE THEY COME FROM (20270721). They used to exist only if the play-off was
  -- switched on BEFORE the draw was made; turning it on in Settings afterwards -- Planning's own order --
  -- left a play-off reading "To be decided" until the semi-finals were played.
  if not exists (select 1 from public.tournament_bracket_slots where plan_id = p_plan_id and is_third_place) then
    insert into public.tournament_bracket_slots
      (plan_id, round_number, position, is_third_place, source_round, source_game_position, source_kind)
    values (p_plan_id, v_rounds, 1, true, v_semi, 1, 'loser'),
           (p_plan_id, v_rounds, 2, true, v_semi, 2, 'loser');
  end if;

  if not exists (select 1 from public.tournament_bracket_pairings where plan_id = p_plan_id and is_third_place) then
    insert into public.tournament_bracket_pairings (plan_id, round_number, game_position, is_third_place)
    values (p_plan_id, v_rounds, 2, true);
    perform internal.schedule_bracket_pairings(p_plan_id);
  end if;

  select case when g.winner_participant_id = g.side_a_id then g.side_b_id else g.side_a_id end
  into v_a from public.tournament_games g
  where g.plan_id = p_plan_id and g.round_number = v_semi and g.bracket_position = 1
    and not g.is_third_place and g.winner_participant_id is not null;
  select case when g.winner_participant_id = g.side_a_id then g.side_b_id else g.side_a_id end
  into v_b from public.tournament_games g
  where g.plan_id = p_plan_id and g.round_number = v_semi and g.bracket_position = 2
    and not g.is_third_place and g.winner_participant_id is not null;

  -- EACH PLACE IS NAMED THE MOMENT ITS OWN SEMI-FINAL DECIDES IT -- independently, the same as the
  -- Final's places either side of it.
  if v_a is not null then
    update public.tournament_bracket_slots set participant_id = v_a, updated_at = now()
    where plan_id = p_plan_id and round_number = v_rounds and position = 1 and is_third_place;
  end if;
  if v_b is not null then
    update public.tournament_bracket_slots set participant_id = v_b, updated_at = now()
    where plan_id = p_plan_id and round_number = v_rounds and position = 2 and is_third_place;
  end if;

  -- THE GAME ITSELF still needs both losers, exactly as the Final needs both semi-final winners.
  if v_a is null or v_b is null then return v_existing; end if;

  if v_existing is not null then
    if internal.tournament_game_has_activity(v_existing) then return v_existing; end if;
    delete from public.tournament_games where id = v_existing;
  end if;

  select * into bp from public.tournament_bracket_pairings where plan_id = p_plan_id and is_third_place;

  insert into public.tournament_games
    (tournament_id, plan_id, age_group, side_a_id, side_b_id, game_date, start_time, pitch_id, status,
     round_number, bracket_position, is_third_place, sort_order, created_by, updated_by)
  values
    (v_t, p_plan_id, v_grade, v_a, v_b,
     coalesce(bp.game_date, (select max(d.day_date) from public.tournament_plan_days d where d.plan_id = p_plan_id)),
     bp.start_time, bp.pitch_id,
     'SCHEDULED', v_rounds, 2, true, v_rounds * 1000 + 2, auth.uid(), auth.uid())
  returning id into v_id;

  update public.tournament_bracket_pairings set game_id = v_id, updated_at = now()
  where plan_id = p_plan_id and is_third_place;
  return v_id;
end;
$function$;
