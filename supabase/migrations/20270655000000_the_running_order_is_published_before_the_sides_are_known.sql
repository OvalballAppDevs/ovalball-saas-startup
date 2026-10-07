-- =====================================================================================================
-- THE RUNNING ORDER IS PUBLISHED BEFORE THE SIDES ARE KNOWN.
--
-- Generation now builds the PAIRINGS -- every place in the bracket, with a day, a time and a pitch --
-- and then creates a game under each pairing whose two sides are already known. The rest fill in as the
-- competition is played, each inheriting the time its pairing was published at.
--
-- ROUNDS DO NOT OVERLAP. A semi-final cannot kick off before the quarter-finals that feed it, so every
-- pairing of a round is placed after every pairing of the round before it. That is the one scheduling
-- rule a knockout has which a round robin does not, and it is why this walks the slots in round order
-- rather than handing the whole set to the shared scheduler.
--
-- THE THIRD-PLACE PLAY-OFF is placed alongside the final, because that is when it is played.
-- =====================================================================================================

/**
 * EVERY PLAYABLE SLOT the organiser has reserved, in the order a day runs.
 *
 * A reservation is a window on a pitch; a window holds as many games as its length allows at this
 * competition's own game length and turnaround. Several games genuinely run at once on one ground --
 * Ovalball has always modelled a pitch as shared -- so slots on different pitches at the same minute
 * are all real.
 */
create or replace function internal.bracket_slots_available(p_plan_id uuid)
returns table(slot_day date, slot_start time, pitch_id uuid, ordinal integer)
language sql
stable
security definer
set search_path to ''
as $function$
  with plan as (
    select p.tournament_id, p.game_duration_minutes, p.changeover_minutes
    from public.tournament_plans p where p.id = p_plan_id
  ),
  windows as (
    select tp.reserved_on, tp.start_time, tp.end_time, tp.pitch_id
    from public.tournament_pitches tp, plan
    where tp.tournament_id = plan.tournament_id
      and tp.reserved_on in (select day_date from public.tournament_plan_days where plan_id = p_plan_id)
  ),
  steps as (
    select w.reserved_on, w.pitch_id, w.start_time, w.end_time,
           greatest(1, floor(
             (extract(epoch from (w.end_time - w.start_time)) / 60)
             / nullif(plan.game_duration_minutes + plan.changeover_minutes, 0)
           )::int) as n,
           plan.game_duration_minutes + plan.changeover_minutes as step
    from windows w, plan
  )
  select s.reserved_on,
         (s.start_time + ((i - 1) * s.step || ' minutes')::interval)::time,
         s.pitch_id,
         row_number() over (order by s.reserved_on,
                            (s.start_time + ((i - 1) * s.step || ' minutes')::interval)::time,
                            s.pitch_id)::int
  from steps s, generate_series(1, s.n) i
  where (s.start_time + ((i - 1) * s.step || ' minutes')::interval)::time < s.end_time;
$function$;

create or replace function internal.schedule_bracket_pairings(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record; s record; v_cursor integer := 0; v_n integer := 0; v_round integer := 0;
begin
  -- ROUND BY ROUND, never overlapping: the cursor only ever moves forward, so a later round cannot be
  -- handed a slot earlier than one already given to the round that feeds it.
  for r in
    select * from public.tournament_bracket_pairings
    where plan_id = p_plan_id
    order by round_number, is_third_place, game_position
  loop
    if r.round_number > v_round then v_round := r.round_number; end if;
    select * into s from internal.bracket_slots_available(p_plan_id)
    where ordinal > v_cursor order by ordinal limit 1;

    if s.ordinal is null then
      -- NOTHING LEFT TO GIVE IT. The pairing keeps its place in the bracket and simply has no time
      -- yet, which an organiser can see and fix by reserving another pitch.
      update public.tournament_bracket_pairings
      set game_date = null, start_time = null, pitch_id = null, updated_at = now()
      where id = r.id;
    else
      update public.tournament_bracket_pairings
      set game_date = s.slot_day, start_time = s.slot_start, pitch_id = s.pitch_id, updated_at = now()
      where id = r.id;
      v_cursor := s.ordinal;
      v_n := v_n + 1;
    end if;
  end loop;

  -- Every game that already exists takes the time its pairing was published at.
  update public.tournament_games g
  set game_date = coalesce(bp.game_date, g.game_date),
      start_time = bp.start_time,
      pitch_id = bp.pitch_id,
      updated_at = now()
  from public.tournament_bracket_pairings bp
  where bp.game_id = g.id and bp.plan_id = p_plan_id;

  return v_n;
end;
$function$;

-- ---- a game is created under its pairing -------------------------------------------------------------

create or replace function internal.create_bracket_game(p_plan_id uuid, p_round integer, p_game_position integer)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare v_a uuid; v_b uuid; v_t uuid; v_grade text; v_id uuid; bp record;
begin
  select p.tournament_id, p.age_group into v_t, v_grade from public.tournament_plans p where p.id = p_plan_id;
  select participant_id into v_a from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = p_game_position * 2 - 1;
  select participant_id into v_b from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = p_round and position = p_game_position * 2;
  if v_a is null or v_b is null then return null; end if;

  select * into bp from public.tournament_bracket_pairings
  where plan_id = p_plan_id and round_number = p_round and game_position = p_game_position and not is_third_place;

  insert into public.tournament_games
    (tournament_id, plan_id, age_group, side_a_id, side_b_id, game_date, start_time, pitch_id, status,
     round_number, bracket_position, sort_order, created_by, updated_by)
  values
    (v_t, p_plan_id, v_grade, v_a, v_b,
     coalesce(bp.game_date, (select min(d.day_date) from public.tournament_plan_days d where d.plan_id = p_plan_id)),
     bp.start_time, bp.pitch_id,
     'SCHEDULED', p_round, p_game_position, p_round * 1000 + p_game_position, auth.uid(), auth.uid())
  returning id into v_id;

  update public.tournament_bracket_pairings set game_id = v_id, updated_at = now()
  where plan_id = p_plan_id and round_number = p_round and game_position = p_game_position and not is_third_place;
  return v_id;
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

  select count(*) into v_size from public.tournament_bracket_slots where plan_id = p_plan_id and round_number = 1;
  if v_size = 0 then
    raise exception 'Make the draw before generating the games.' using errcode = '22023';
  end if;
  v_rounds := internal.bracket_rounds(v_size);

  delete from public.tournament_games where plan_id = p_plan_id;
  delete from public.tournament_bracket_pairings where plan_id = p_plan_id;

  -- THE WHOLE RUNNING ORDER, including the rounds nobody has qualified for.
  for v_round in 1 .. v_rounds loop
    for v_pos in 1 .. (v_size / power(2, v_round)::int) loop
      -- A PAIRING WHOSE BOTH PLACES ARE BYES IS NOT PLAYED. It cannot happen in a bracket sized to the
      -- field, but a draw arranged by hand could produce one, and scheduling a pitch for it would take
      -- a slot from a game that is real.
      if v_round > 1 or exists (
        select 1 from public.tournament_bracket_slots s
        where s.plan_id = p_plan_id and s.round_number = v_round
          and s.position in (v_pos * 2 - 1, v_pos * 2) and not s.is_bye
      ) then
        insert into public.tournament_bracket_pairings (plan_id, round_number, game_position)
        values (p_plan_id, v_round, v_pos);
      end if;
    end loop;
  end loop;

  if (select third_place_playoff from public.tournament_plans where id = p_plan_id) then
    insert into public.tournament_bracket_pairings (plan_id, round_number, game_position, is_third_place)
    values (p_plan_id, v_rounds, 2, true);
  end if;

  perform internal.schedule_bracket_pairings(p_plan_id);

  -- AND THE GAMES THAT CAN EXIST YET.
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

-- The third-place game, when it becomes real, takes its pairing's published time too.
create or replace function internal.ensure_third_place_game(p_plan_id uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
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
    return null;
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

-- ---- and the settings RPC speaks the mock-up's vocabulary ---------------------------------------------

create or replace function public.set_tournament_knockout_settings(
  p_plan_id uuid,
  p_draw_method text default null,
  p_extra_time_minutes integer default null,
  p_tie_resolution text default null,
  p_third_place_playoff boolean default null
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
  if p_draw_method is not null and p_draw_method not in ('random', 'manual', 'seeded') then
    raise exception 'A draw is made at random, by hand, or from seeds.' using errcode = '22023';
  end if;
  if p_tie_resolution is not null and p_tie_resolution not in ('none', 'golden_point', 'organiser_decision') then
    raise exception 'That is not a way Ovalball can settle a level game.' using errcode = '22023';
  end if;
  if p_extra_time_minutes is not null and (p_extra_time_minutes < 1 or p_extra_time_minutes > 40) then
    raise exception 'Extra time is between 1 and 40 minutes.' using errcode = '22023';
  end if;

  update public.tournament_plans
  set draw_method = coalesce(p_draw_method, draw_method),
      tie_resolution = coalesce(p_tie_resolution, tie_resolution),
      third_place_playoff = coalesce(p_third_place_playoff, third_place_playoff),
      -- EXTRA TIME IS ITS OWN SETTING NOW, so it is kept or cleared on its own terms rather than being
      -- wiped whenever the resolution changes.
      extra_time_minutes = coalesce(p_extra_time_minutes, extra_time_minutes),
      updated_by = auth.uid(), updated_at = now()
  where id = p_plan_id;

  perform internal.ensure_third_place_game(p_plan_id);
end;
$function$;

/** Which shape this competition is played in -- confirmed from the tournament, changeable per age group. */
create or replace function public.set_tournament_plan_format(p_plan_id uuid, p_format text)
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
  if p_format not in ('round_robin', 'tri_fixture', 'swiss', 'knockout', 'hybrid') then
    raise exception 'That is not a competition shape Ovalball runs.' using errcode = '22023';
  end if;
  perform internal.refuse_if_bracket_has_results(p_plan_id);

  update public.tournament_plans
  set format = p_format, updated_by = auth.uid(), updated_at = now()
  where id = p_plan_id;
end;
$function$;

revoke all on function public.set_tournament_plan_format(uuid, text) from public, anon;
grant execute on function public.set_tournament_plan_format(uuid, text) to authenticated, service_role;
