-- =====================================================================================================
-- GENERATING A DRAFT IS NOT PUBLISHING IT.
--
-- Generation produces games against a DRAFT plan. Nobody outside the organising club sees them: the
-- participant Agenda reads a game only when it has no plan behind it (a hand-made fixture, which was
-- always visible) or when its plan is PUBLISHED. An organiser must be able to generate, look at what
-- came out, and change their mind -- which is impossible if generating is also announcing.
--
-- PAIRING AND SCHEDULING ARE SEPARATE, and the separation is the point of this file.
--
--   PAIRING     internal.tournament_round_robin_pairs -- who plays whom, by the circle method. Knows
--               nothing about days, pitches or clocks.
--   SCHEDULING  internal.schedule_tournament_plan_games -- places pairings on a day, a pitch and a
--               time. Knows nothing about WHY two sides are playing.
--
-- Swiss and Knockout are different PAIRING rules over the same sides. They will reuse the scheduler
-- below unchanged, which is the whole reason it does not know what a round robin is.
--
-- A PLAN THAT CANNOT FIT IS NOT GENERATED. If the pairings need more pitch-time than the selected days
-- and reserved pitches provide, this refuses and says by how much, rather than producing a schedule
-- that quietly drops games or runs past the end of the day.
-- =====================================================================================================

-- ---- scheduling: place pairings on day, pitch and time ---------------------------------------------

create or replace function internal.schedule_tournament_plan_games(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan public.tournament_plans;
  v_slot_count int;
  v_game_count int;
  v_needed int;
  v_available int;
  v_g record;
  v_s record;
  v_placed boolean;
begin
  select * into v_plan from public.tournament_plans where id = p_plan_id;

  -- EVERY PLACE A GAME COULD GO: each reserved pitch on each selected day, stepped by the game length
  -- plus the changeover, inside both the plan's hours and the reservation's own.
  create temp table if not exists plan_slots (
    slot_day date, pitch_id uuid, slot_start time, slot_end time, ordinal bigint
  ) on commit drop;
  -- `where true`, DELIBERATELY. Ovalball refuses an unqualified DELETE for a browser-originated
  -- session, which is a guard worth having and one that fires here even though the target is a
  -- throwaway temp table. Found in the Simulator: generating from the app failed with "DELETE requires
  -- a WHERE clause" while the identical call from psql, as the owner, succeeded -- the two run under
  -- different roles, and only one of them is the one a person actually uses.
  delete from plan_slots where true;

  insert into plan_slots (slot_day, pitch_id, slot_start, slot_end, ordinal)
  select d.day_date, tp.pitch_id, s.t,
         s.t + make_interval(mins => v_plan.game_duration_minutes),
         row_number() over (order by d.day_date, s.t, tp.pitch_id)
  from public.tournament_plan_days d
  join public.tournament_pitches tp
    on tp.tournament_id = v_plan.tournament_id and tp.reserved_on = d.day_date
  cross join lateral (
    select greatest(v_plan.day_start_time, tp.start_time)
             + make_interval(mins => (v_plan.game_duration_minutes + v_plan.changeover_minutes) * g.i) as t
    from generate_series(0, 200) as g(i)
  ) s
  where d.plan_id = p_plan_id
    and s.t + make_interval(mins => v_plan.game_duration_minutes) <= least(v_plan.day_end_time, tp.end_time);

  select count(*) into v_slot_count from plan_slots;
  select count(*) into v_game_count from public.tournament_games where plan_id = p_plan_id;

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

  if v_game_count > v_slot_count then
    v_needed := v_game_count * (v_plan.game_duration_minutes + v_plan.changeover_minutes);
    v_available := v_slot_count * (v_plan.game_duration_minutes + v_plan.changeover_minutes);
    raise exception
      '% games need about % minutes of pitch time, but the selected days and reserved pitches provide about %. Add another pitch, widen the playing hours, shorten the games, or add another day.',
      v_game_count, v_needed, v_available
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
    for v_s in select * from plan_slots order by ordinal
    loop
      if not exists (
        select 1 from public.tournament_games o
        where o.plan_id = p_plan_id and o.id <> v_g.id
          and o.game_date = v_s.slot_day and o.start_time = v_s.slot_start
          and (o.side_a_id in (v_g.side_a_id, v_g.side_b_id) or o.side_b_id in (v_g.side_a_id, v_g.side_b_id))
      ) and not exists (
        -- and the pitch is not already taken at that minute, by this plan or by anything else at the
        -- same tournament.
        select 1 from public.tournament_games o
        where o.tournament_id = v_plan.tournament_id and o.id <> v_g.id
          and o.game_date = v_s.slot_day and o.start_time = v_s.slot_start and o.pitch_id = v_s.pitch_id
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
        'The games cannot be arranged without a side playing twice at once. Add another pitch, widen the playing hours, or add another day.'
        using errcode = '22023';
    end if;
  end loop;
end;
$function$;

-- ---- generate the draft ----------------------------------------------------------------------------

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

  select min(day_date) into v_first_day from public.tournament_plan_days where plan_id = p_plan_id;
  if v_first_day is null then
    raise exception 'Choose at least one day before generating fixtures.' using errcode = '22023';
  end if;

  -- REGENERATING REPLACES THIS PLAN'S OWN GAMES AND NOTHING ELSE. A hand-made game, which has no plan,
  -- is not swept away by an organiser pressing Generate.
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

-- ---- preview, which writes nothing -----------------------------------------------------------------

create or replace function public.preview_tournament_plan_fixtures(p_plan_id uuid)
returns jsonb
language plpgsql
stable
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

  -- THE SAME FUNCTION THE GENERATOR CALLS. A preview computed a second way would eventually disagree
  -- with the thing it is previewing, and the organiser would have no way to know which was true.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'tableName', t.name,
      'round', p.round_number,
      'sideA', coalesce(ta.display_name, case when a.squad_label is not null then a.age_group || ' ' || a.squad_label else cda.name end),
      'sideAClub', cda.name,
      'sideB', coalesce(tb.display_name, case when b.squad_label is not null then b.age_group || ' ' || b.squad_label else cdb.name end),
      'sideBClub', cdb.name
    ) order by p.table_sort, p.round_number, p.pair_in_round)
    from internal.tournament_round_robin_pairs(p_plan_id) p
    join public.tournament_plan_tables t on t.id = p.table_id
    join public.tournament_participants a on a.id = p.side_a_id
    join public.tournament_participants b on b.id = p.side_b_id
    join public.club_directory cda on cda.id = a.club_directory_id
    join public.club_directory cdb on cdb.id = b.club_directory_id
    left join public.teams ta on ta.id = a.team_id
    left join public.teams tb on tb.id = b.team_id
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.generate_tournament_plan_fixtures(uuid) from public, anon;
revoke all on function public.preview_tournament_plan_fixtures(uuid) from public, anon;
grant execute on function public.generate_tournament_plan_fixtures(uuid) to authenticated, service_role;
grant execute on function public.preview_tournament_plan_fixtures(uuid) to authenticated, service_role;

-- ---- a draft does not reach a participant ----------------------------------------------------------
--
-- The one place this has to hold is the participant read model, which is where the Agenda comes from.
-- Rewritten rather than restated, so the rest of the projection cannot drift while this one clause
-- changes.

do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'get_tournament_participant_centre';
  if v_def is null then raise exception 'the participant centre read is missing.'; end if;

  if position('g.plan_id is null' in v_def) = 0 then
    v_def := replace(v_def,
      'where g.tournament_id = p_tournament_id and g.age_group = grade',
      'where g.tournament_id = p_tournament_id and g.age_group = grade' || chr(10) ||
      '          -- A GENERATED GAME IS THE ORGANISER''S WORKINGS UNTIL THEY PUBLISH IT. A game with no' || chr(10) ||
      '          -- plan behind it is one somebody added by hand, which was always visible and stays so.' || chr(10) ||
      '          and (g.plan_id is null or exists (select 1 from public.tournament_plans pl' || chr(10) ||
      '                                            where pl.id = g.plan_id and pl.publication_state = ''PUBLISHED''))');
    if position('g.plan_id is null' in v_def) = 0 then
      raise exception 'the participant centre read is not the shape this migration expects.';
    end if;
    execute v_def;
  end if;
end $$;

do $$
begin
  if (select pg_get_functiondef(oid) from pg_proc where proname = 'get_tournament_participant_centre')
     not like '%publication_state = ''PUBLISHED''%' then
    raise exception 'a draft plan would reach the participant Agenda.';
  end if;
end $$;
