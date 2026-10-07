-- A HYBRID IS GROUPS, THEN A KNOCKOUT -- ONE PLAN (Tournament Planning parity programme, phase 7).
--
-- The owner's rule (2026-10-02, memory ovalball-tournament-format-sporting-rules): the organiser sets how
-- many sides qualify from each table (1-4); qualifiers are crossed so table winners avoid each other
-- early -- 1st A v 2nd B, 1st B v 2nd A -- and a knockout place reads "1st Table A" until that table's
-- standings settle, then fills itself.
--
-- NOTHING NEW IS INVENTED FOR IT. The group stage is the round robin's own tables, pairing rule, scheduler
-- and standings. The knockout stage is the knockout's own bracket, places, progression and third-place
-- play-off. What is new is the seam between them:
--
--   * a bracket place can come from a TABLE POSITION (source_kind 'qualifier', source_round 0 -- "the
--     group stage" -- source_game_position = the finishing position, source_table_id = the table), the
--     same dependency idea as "Winner QF1";
--   * qualifiers are seeded by finishing position, then table order, into the knockout's own seed order,
--     which is exactly the crossover: two tables x two qualifiers gives 1A v 2B and 1B v 2A; four tables
--     x two gives 1A v 2D, 1D v 2A, 1B v 2C, 1C v 2B;
--   * a table's qualifiers fill their places only when EVERY game in that table has a settled result,
--     read from the table's own ordered standings. A correction that would change a qualifier after the
--     knockout game it feeds has been played is refused by the bracket (it never silently invalidates a
--     played game); before then, the knockout game is rebuilt with the right side;
--   * the knockout stage is scheduled after the group stage has finished, in the same slots model.
--
-- Group games carry their table; knockout games carry a bracket position. Every shared function that
-- reads "the plan's games" now asks which of the two it means.

-- ---- schema --------------------------------------------------------------------------------------

alter table public.tournament_plans add column if not exists qualifiers_per_table integer;
alter table public.tournament_plans drop constraint if exists tournament_plans_qualifiers_per_table_range;
alter table public.tournament_plans add constraint tournament_plans_qualifiers_per_table_range
  check (qualifiers_per_table is null or qualifiers_per_table between 1 and 4);
comment on column public.tournament_plans.qualifiers_per_table is
  'Hybrid only: how many sides from each group table go through to the knockout stage (1-4).';

alter table public.tournament_bracket_slots add column if not exists source_table_id uuid
  references public.tournament_plan_tables(id) on delete set null;
alter table public.tournament_bracket_slots drop constraint if exists tournament_bracket_slots_source_kind_check;
alter table public.tournament_bracket_slots add constraint tournament_bracket_slots_source_kind_check
  check (source_kind is null or source_kind in ('winner', 'loser', 'qualifier'));
alter table public.tournament_bracket_slots drop constraint if exists tournament_bracket_slots_qualifier_shape;
alter table public.tournament_bracket_slots add constraint tournament_bracket_slots_qualifier_shape
  check (source_table_id is null or source_kind = 'qualifier');

-- The marker the readiness calculation looks for: a Hybrid now has its own generator.
create or replace function internal.tournament_hybrid_supported()
returns boolean language sql immutable set search_path to '' as $function$ select true; $function$;

-- ---- a hybrid keeps a table (its group stage) ------------------------------------------------------

create or replace function internal.tournament_plan_has_standings(p_plan_id uuid)
returns boolean
language sql
stable
set search_path to ''
as $function$
  select case
    when coalesce(p.format, t.format) in ('knockout') then false
    when coalesce(p.format, t.format) = 'hybrid' then true
    when p.standings_enabled is not null then p.standings_enabled
    when coalesce(p.format, t.format) = 'tri_fixture' then false
    when coalesce(p.format, t.format) = 'round_robin' then true
    else false
  end
  from public.tournament_plans p
  join public.tournaments t on t.id = p.tournament_id
  where p.id = p_plan_id;
$function$;

-- ---- what a qualifier place is called --------------------------------------------------------------

create or replace function internal.ordinal(p_n integer)
returns text language sql immutable set search_path to '' as $function$
  select p_n::text || case when p_n % 100 in (11, 12, 13) then 'th'
                           when p_n % 10 = 1 then 'st' when p_n % 10 = 2 then 'nd' when p_n % 10 = 3 then 'rd'
                           else 'th' end;
$function$;

create or replace function internal.bracket_slot_label(p_slot_id uuid)
returns text
language plpgsql
stable security definer
set search_path to ''
as $function$
declare s record; v_size integer; v_rounds integer; v_table text;
begin
  select * into s from public.tournament_bracket_slots where id = p_slot_id;
  if s.id is null then return null; end if;
  if s.participant_id is not null then return null; end if;
  if s.is_bye then return 'BYE'; end if;
  if s.source_round is null then return null; end if;

  -- A GROUP-STAGE QUALIFIER: "1st Table A".
  if s.source_kind = 'qualifier' then
    select name into v_table from public.tournament_plan_tables where id = s.source_table_id;
    return internal.ordinal(s.source_game_position) || ' ' || coalesce(v_table, 'Table');
  end if;

  select count(*) into v_size from public.tournament_bracket_slots
  where plan_id = s.plan_id and round_number = 1 and not is_third_place;
  v_rounds := internal.bracket_rounds(v_size);

  return initcap(s.source_kind) || ' '
         || internal.bracket_round_code(s.source_round, v_rounds)
         || s.source_game_position::text;
end;
$function$;

-- ---- the knockout stage's draw, built from the group tables ----------------------------------------

-- THE ONE SEEDING RULE: by finishing position, then table order -- all the table winners, then all the
-- runners-up, and so on -- laid into the knockout's own seed order, which puts seed 1 against the last
-- seed. That is the crossover: two tables x two gives 1A v 2B and 1B v 2A; four tables x two gives
-- 1A v 2D, 1D v 2A, 1B v 2C, 1C v 2B. Generation builds from it and the planner previews from it.
create or replace function internal.hybrid_knockout_places(p_plan_id uuid, p_qualifiers integer)
returns table (slot_position integer, finishing integer, table_id uuid, table_name text, is_bye boolean, bracket_size integer)
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v_q integer; v_size integer; v_order integer[]; v_seeds jsonb := '[]'; r record; v_slot integer; v_seed integer;
begin
  for r in
    select pos.p as position, t.id, t.name
    from generate_series(1, coalesce(p_qualifiers, 0)) pos(p)
    cross join public.tournament_plan_tables t
    where t.plan_id = p_plan_id
    order by pos.p, t.sort_order
  loop
    v_seeds := v_seeds || jsonb_build_object('position', r.position, 'table', r.id, 'name', r.name);
  end loop;
  v_q := jsonb_array_length(v_seeds);
  if v_q < 2 then return; end if;
  v_size := internal.bracket_size(v_q);
  v_order := internal.bracket_seed_order(v_size);
  for v_slot in 1 .. v_size loop
    v_seed := v_order[v_slot];
    slot_position := v_slot;
    bracket_size := v_size;
    if v_seed <= v_q then
      finishing := (v_seeds -> (v_seed - 1) ->> 'position')::int;
      table_id := (v_seeds -> (v_seed - 1) ->> 'table')::uuid;
      table_name := v_seeds -> (v_seed - 1) ->> 'name';
      is_bye := false;
    else
      finishing := null; table_id := null; table_name := null; is_bye := true;
    end if;
    return next;
  end loop;
end;
$function$;

create or replace function internal.build_hybrid_bracket(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_n integer; v_size integer; v_rounds integer; v_round integer; v_slot integer; v_third boolean; v_small text; r record;
begin
  select qualifiers_per_table, third_place_playoff into v_n, v_third from public.tournament_plans where id = p_plan_id;
  if v_n is null then
    raise exception 'Choose how many teams from each table go through to the knockout stage.' using errcode = '22023',
      hint = 'TOURNAMENT_PLAN_HYBRID_QUALIFIERS';
  end if;
  select string_agg(t.name, ', ' order by t.sort_order) into v_small
  from public.tournament_plan_tables t
  where t.plan_id = p_plan_id
    and (select count(*) from public.tournament_plan_table_sides s where s.table_id = t.id) <= v_n;
  if v_small is not null then
    raise exception '% from each table go through, so every table needs more teams than that (% does not).', v_n, v_small
      using errcode = '22023', hint = 'TOURNAMENT_PLAN_HYBRID_QUALIFIERS';
  end if;

  delete from public.tournament_bracket_slots where plan_id = p_plan_id;

  for r in select * from internal.hybrid_knockout_places(p_plan_id, v_n) loop
    v_size := r.bracket_size;
    if r.is_bye then
      insert into public.tournament_bracket_slots (plan_id, round_number, position, is_bye)
      values (p_plan_id, 1, r.slot_position, true);
    else
      insert into public.tournament_bracket_slots
        (plan_id, round_number, position, source_round, source_game_position, source_kind, source_table_id)
      values (p_plan_id, 1, r.slot_position, 0, r.finishing, 'qualifier', r.table_id);
    end if;
  end loop;
  if v_size is null then
    raise exception 'A knockout stage needs at least two teams going through.' using errcode = '22023', hint = 'TOURNAMENT_PLAN_HYBRID_QUALIFIERS';
  end if;

  v_rounds := internal.bracket_rounds(v_size);
  for v_round in 2 .. v_rounds loop
    for v_slot in 1 .. (v_size / power(2, v_round - 1)::int) loop
      insert into public.tournament_bracket_slots
        (plan_id, round_number, position, source_round, source_game_position, source_kind)
      values (p_plan_id, v_round, v_slot, v_round - 1, v_slot, 'winner');
    end loop;
  end loop;

  if coalesce(v_third, false) and v_rounds >= 2 then
    insert into public.tournament_bracket_slots
      (plan_id, round_number, position, is_third_place, source_round, source_game_position, source_kind)
    values (p_plan_id, v_rounds, 1, true, v_rounds - 1, 1, 'loser'),
           (p_plan_id, v_rounds, 2, true, v_rounds - 1, 2, 'loser');
  end if;
  return v_size;
end;
$function$;

-- WHAT THE KNOCKOUT STAGE WILL BE, before anything is generated: the planner's preview, from the same rule.
create or replace function public.get_hybrid_knockout_preview(p_plan_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_plan public.tournament_plans; v_size integer; v_rounds integer; v_games jsonb;
begin
  perform internal.require_live_session();
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.id is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_plan.tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  select max(bracket_size) into v_size from internal.hybrid_knockout_places(p_plan_id, v_plan.qualifiers_per_table);
  if v_size is null then
    return jsonb_build_object('qualifiersPerTable', v_plan.qualifiers_per_table, 'teams', 0, 'rounds', 0, 'firstRound', null, 'games', '[]'::jsonb);
  end if;
  v_rounds := internal.bracket_rounds(v_size);

  select jsonb_agg(jsonb_build_object(
           'game', (a.slot_position + 1) / 2,
           'sideA', case when a.is_bye then 'Bye' else internal.ordinal(a.finishing) || ' ' || a.table_name end,
           'sideB', case when b.is_bye then 'Bye' else internal.ordinal(b.finishing) || ' ' || b.table_name end,
           'bye', a.is_bye or b.is_bye)
         order by a.slot_position)
  into v_games
  from internal.hybrid_knockout_places(p_plan_id, v_plan.qualifiers_per_table) a
  join internal.hybrid_knockout_places(p_plan_id, v_plan.qualifiers_per_table) b on b.slot_position = a.slot_position + 1
  where a.slot_position % 2 = 1;

  return jsonb_build_object(
    'qualifiersPerTable', v_plan.qualifiers_per_table,
    'teams', (select count(*) from internal.hybrid_knockout_places(p_plan_id, v_plan.qualifiers_per_table) x where not x.is_bye),
    'rounds', v_rounds,
    'firstRound', internal.bracket_game_name(1, v_rounds),
    'thirdPlacePlayoff', coalesce(v_plan.third_place_playoff, false) and v_rounds >= 2,
    'games', coalesce(v_games, '[]'::jsonb));
end;
$function$;
revoke all on function public.get_hybrid_knockout_preview(uuid) from public, anon;
grant execute on function public.get_hybrid_knockout_preview(uuid) to authenticated;
revoke all on function internal.hybrid_knockout_places(uuid, integer) from public, anon, authenticated;

-- ---- qualification: a settled table fills its places --------------------------------------------------

create or replace function internal.resolve_hybrid_qualification(p_plan_id uuid, p_table_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  s record; v_settled boolean; v_side uuid; v_pair record; v_tournament uuid; v_table text;
  v_published boolean; v_label text; v_mine jsonb; v_opp jsonb;
begin
  if internal.tournament_plan_format(p_plan_id) is distinct from 'hybrid' then return; end if;
  select tournament_id into v_tournament from public.tournament_plans where id = p_plan_id;
  v_published := internal.tournament_plan_is_published(p_plan_id);
  select name into v_table from public.tournament_plan_tables where id = p_table_id;

  -- A TABLE IS DECIDED WHEN EVERY GAME IN IT HAS A SETTLED RESULT -- not when most have, and not on a
  -- score one side has submitted and the other has not yet confirmed.
  select count(*) > 0 and bool_and(g.result_status in ('final', 'external_recorded')) into v_settled
  from public.tournament_games g where g.plan_id = p_plan_id and g.table_id = p_table_id;

  -- WHO EACH PLACE SHOULD HOLD NOW, worked out before anything moves: a correction can swap two sides
  -- between places, and a side is never in two places of one round, so every changed place is emptied
  -- first and only then filled.
  create temp table if not exists hybrid_places (position int, finishing int, side uuid, changed boolean) on commit drop;
  delete from hybrid_places where true;
  insert into hybrid_places
  select b.position, b.source_game_position,
         case when v_settled then (select o.participant_id from internal.tournament_table_ordered(p_table_id) o
                                    where o.table_position = b.source_game_position) end,
         false
  from public.tournament_bracket_slots b
  where b.plan_id = p_plan_id and b.round_number = 1 and not b.is_third_place
    and b.source_kind = 'qualifier' and b.source_table_id = p_table_id;
  update hybrid_places h set changed = (b.participant_id is distinct from h.side)
  from public.tournament_bracket_slots b
  where b.plan_id = p_plan_id and b.round_number = 1 and not b.is_third_place and b.position = h.position;

  -- The bracket's own write throughout: it deletes and rebuilds an unplayed game, and refuses -- rolling
  -- back the correction that caused it -- if the game a place feeds has already been played.
  for s in select * from hybrid_places where changed order by position loop
    perform internal.fill_bracket_slot(p_plan_id, 1, s.position, null);
    select * into v_pair from public.tournament_bracket_slots
    where plan_id = p_plan_id and round_number = 1 and not is_third_place
      and position = case when s.position % 2 = 1 then s.position + 1 else s.position - 1 end;
    if v_pair.is_bye then
      perform internal.fill_bracket_slot(p_plan_id, 2, (s.position + 1) / 2, null);
    end if;
  end loop;

  for s in select * from hybrid_places where changed and side is not null order by position loop
    v_side := s.side;
    perform internal.fill_bracket_slot(p_plan_id, 1, s.position, v_side);

    select * into v_pair from public.tournament_bracket_slots
    where plan_id = p_plan_id and round_number = 1 and not is_third_place
      and position = case when s.position % 2 = 1 then s.position + 1 else s.position - 1 end;

    if v_pair.is_bye then
      -- A qualifier drawn against a bye goes straight into the next round, as a draw's bye does; the
      -- bracket tells them who they meet there.
      perform internal.fill_bracket_slot(p_plan_id, 2, (s.position + 1) / 2, v_side);
      continue;
    end if;

    if v_published then
      v_label := internal.tournament_game_round_label(p_plan_id, 1, false);
      v_mine := internal.tournament_side_summary(v_side, null);
      if v_pair.participant_id is not null then
        v_opp := internal.tournament_side_summary(v_pair.participant_id, null);
      else
        v_opp := null;
      end if;
      perform internal.notify_tournament_side(v_side, 'tournament_side_advanced',
        'Through to the knockout stage',
        format('You finished %s in %s. %s', internal.ordinal(s.finishing), coalesce(v_table, 'your table'),
               case when v_opp is not null then format('Your %s opponent is %s.', coalesce(v_label, 'knockout'), v_opp ->> 'clubName')
                    else format('Your %s opponent is decided when their table finishes.', coalesce(v_label, 'knockout')) end),
        jsonb_build_object('tournament_id', v_tournament, 'tournament_plan_id', p_plan_id));
      if v_opp is not null then
        perform internal.notify_tournament_side(v_pair.participant_id, 'tournament_opponent_known',
          format('Your %s opponent is known', coalesce(v_label, 'knockout')),
          format('You will play %s.', coalesce(v_mine ->> 'clubName', 'your opponent')),
          jsonb_build_object('tournament_id', v_tournament, 'tournament_plan_id', p_plan_id));
      end if;
    end if;
  end loop;
end;
$function$;

create or replace function internal.tournament_game_progression()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_winner uuid;
begin
  -- A HYBRID'S GROUP GAME DECIDES QUALIFICATION, once its whole table is settled.
  if new.bracket_position is null then
    if new.table_id is not null and new.plan_id is not null
       and (tg_op = 'UPDATE' and (new.result_status is distinct from old.result_status
                                  or new.side_a_score is distinct from old.side_a_score
                                  or new.side_b_score is distinct from old.side_b_score))
       and internal.tournament_plan_format(new.plan_id) = 'hybrid' then
      perform internal.resolve_hybrid_qualification(new.plan_id, new.table_id);
    end if;
    return new;
  end if;

  v_winner := internal.tournament_score_winner(new.id);
  if v_winner is null and new.winner_decided_by is not null then
    v_winner := new.winner_participant_id;
  end if;
  if v_winner is distinct from new.winner_participant_id then
    update public.tournament_games set winner_participant_id = v_winner where id = new.id;
    new.winner_participant_id := v_winner;
  end if;

  perform internal.advance_tournament_bracket(new.id);
  return new;
end;
$function$;
-- ---- the shared pieces, asked which stage they mean ----------------------------------------------

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
         from public.tournament_games g where g.plan_id = p_plan_id and g.bracket_position is null)
        union all
        (select g.table_id, least(g.side_a_id, g.side_b_id), greatest(g.side_a_id, g.side_b_id)
         from public.tournament_games g where g.plan_id = p_plan_id and g.bracket_position is null
         except
         select p.table_id, least(p.side_a_id, p.side_b_id), greatest(p.side_a_id, p.side_b_id)
         from internal.tournament_round_robin_pairs(p_plan_id) p))
      into v_pairs_differ;
    end if;

    -- A HYBRID'S KNOCKOUT STAGE IS PART OF ITS FIXTURES: one place for every finishing position that
    -- qualifies from every table. A changed qualifier count, or a table added or taken away, means the
    -- knockout stage no longer matches and the fixtures are regenerated.
    if v_format = 'hybrid' and not v_pairs_differ then
      select exists (
        (select t.id, q.n from public.tournament_plan_tables t
           cross join generate_series(1, coalesce((select qualifiers_per_table from public.tournament_plans where id = p_plan_id), 0)) q(n)
          where t.plan_id = p_plan_id
         except
         select b.source_table_id, b.source_game_position from public.tournament_bracket_slots b
          where b.plan_id = p_plan_id and b.source_kind = 'qualifier')
        union all
        (select b.source_table_id, b.source_game_position from public.tournament_bracket_slots b
          where b.plan_id = p_plan_id and b.source_kind = 'qualifier'
         except
         select t.id, q.n from public.tournament_plan_tables t
           cross join generate_series(1, coalesce((select qualifiers_per_table from public.tournament_plans where id = p_plan_id), 0)) q(n)
          where t.plan_id = p_plan_id))
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
  where g.plan_id = p_plan_id and g.bracket_position is null and g.result_status = 'none'
    and not exists (select 1 from public.tournament_game_result_submissions s where s.game_id = g.id);

  -- A HYBRID'S KNOCKOUT GAMES FOLLOW THE GROUP STAGE, so an unplayed one gives up its time while the
  -- group stage is placed; the knockout scheduler then puts it back after the last group game.
  if internal.tournament_plan_format(p_plan_id) = 'hybrid' then
    update public.tournament_games g
    set start_time = null, pitch_id = null
    where g.plan_id = p_plan_id and g.bracket_position is not null and g.result_status = 'none'
      and not exists (select 1 from public.tournament_game_result_submissions s where s.game_id = g.id);
  end if;

  -- NO PITCHES RESERVED IS NOT A FAILURE AT THIS STAGE: the pairings are real; the readiness
  -- calculation reports the games without a kick-off and offers the route to give them one.
  if v_slot_count = 0 then return; end if;

  -- WHAT A PLAN ACTUALLY NEEDS IS KICK-OFF TIMES, not pitches (a pitch is not exclusive).
  select count(distinct (slot_day, slot_start)) into v_available from plan_slots;
  select coalesce(max(round_number), 1) into v_needed from public.tournament_games
  where plan_id = p_plan_id and bracket_position is null;
  if v_needed > v_available then
    raise exception
      '% rounds need % kick-off times, but the selected days and reserved pitches provide %. Widen the playing hours, shorten the games, or add another day.',
      v_needed, v_needed, v_available
      using errcode = '22023';
  end if;

  for v_g in
    select g.id, g.side_a_id, g.side_b_id
    from public.tournament_games g
    where g.plan_id = p_plan_id and g.bracket_position is null and g.start_time is null
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

  -- A HYBRID'S KNOCKOUT STAGE STARTS WHEN ITS GROUP STAGE HAS FINISHED: the latest group game's end,
  -- plus the changeover, is the first round's floor. A knockout has no group games, so no floor.
  select max(g.game_date + g.start_time + make_interval(mins => coalesce(g.duration_minutes, v_dur) + v_change))
  into v_next_floor
  from public.tournament_games g
  where g.plan_id = p_plan_id and g.bracket_position is null and g.start_time is not null;

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

-- ONE PLACE THAT TURNS A DRAW INTO ITS GAMES-TO-BE, used by the knockout and by a hybrid's knockout stage.
create or replace function internal.create_bracket_pairings(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_size integer; v_rounds integer; v_round integer; v_pos integer;
begin
  select count(*) into v_size from public.tournament_bracket_slots
  where plan_id = p_plan_id and round_number = 1 and not is_third_place;
  v_rounds := internal.bracket_rounds(v_size);

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
  return v_rounds;
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
  perform internal.create_bracket_pairings(p_plan_id);

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
  delete from public.tournament_bracket_pairings where plan_id = p_plan_id;

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

  -- A HYBRID'S KNOCKOUT STAGE: the knockout's own draw, places, pairings and scheduler, with places that
  -- read "1st Table A" until that table is decided.
  if v_format = 'hybrid' then
    perform internal.build_hybrid_bracket(p_plan_id);
    perform internal.create_bracket_pairings(p_plan_id);
    perform internal.schedule_bracket_pairings(p_plan_id);
    perform internal.ensure_third_place_game(p_plan_id);
  end if;

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
  elsif internal.tournament_plan_format(p_plan_id) = 'hybrid' then
    perform internal.schedule_tournament_plan_games(p_plan_id);
    perform internal.schedule_bracket_pairings(p_plan_id);
  else
    perform internal.schedule_tournament_plan_games(p_plan_id);
  end if;

  update public.tournament_plans set updated_by = auth.uid(), updated_at = now() where id = p_plan_id;
  perform internal.announce_published_schedule_change(p_plan_id, 'been rescheduled');
  return internal.tournament_plan_readiness(p_plan_id);
end;
$function$;

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
  v_fixtures_out boolean; v_q int; v_short text;
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

    if v_format in ('knockout', 'hybrid') then
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
      -- A HYBRID'S SEAM: how many from each table go through to the knockout stage.
      'qualifiersPerTable', v_plan.qualifiers_per_table,
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

-- ---- the organiser's one new control -----------------------------------------------------------

create or replace function public.set_tournament_hybrid_settings(p_plan_id uuid, p_qualifiers_per_table integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_plan public.tournament_plans;
begin
  perform internal.require_live_session();
  select * into v_plan from public.tournament_plans where id = p_plan_id;
  if v_plan.id is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_plan.tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  if internal.tournament_plan_format(p_plan_id) <> 'hybrid' then
    raise exception 'Only a Hybrid competition sends teams from its tables to a knockout stage.' using errcode = '22023';
  end if;
  if p_qualifiers_per_table is null or p_qualifiers_per_table not between 1 and 4 then
    raise exception 'Between 1 and 4 teams can go through from each table.' using errcode = '22023';
  end if;
  if v_plan.qualifiers_per_table is distinct from p_qualifiers_per_table then
    perform internal.refuse_if_competition_has_results(v_plan.tournament_id, v_plan.age_group, 'change who goes through to the knockout stage');
    update public.tournament_plans
    set qualifiers_per_table = p_qualifiers_per_table, updated_by = auth.uid(), updated_at = now()
    where id = p_plan_id;
  end if;
  return internal.tournament_plan_readiness(p_plan_id);
end;
$function$;
revoke all on function public.set_tournament_hybrid_settings(uuid, integer) from public, anon;
grant execute on function public.set_tournament_hybrid_settings(uuid, integer) to authenticated;

revoke all on function internal.build_hybrid_bracket(uuid) from public, anon, authenticated;
revoke all on function internal.resolve_hybrid_qualification(uuid, uuid) from public, anon, authenticated;
revoke all on function internal.create_bracket_pairings(uuid) from public, anon, authenticated;

-- ---- a group game is not a knockout round ------------------------------------------------------
-- `roundName` names a game's knockout round, and internal.tournament_game_round_label answers for any
-- game in a plan that has a bracket. A Hybrid's plan has one, so its GROUP games came back as "Semi
-- Final" and "Final" by their round-robin round number. A game that belongs to a table has no knockout
-- round: its name is its stageLabel ("Group Stage · Table A · Round 2"). And the other way round, a
-- knockout-stage game -- or a knockout place not yet a game -- never counts towards a table, even in a
-- competition that keeps one.


CREATE OR REPLACE FUNCTION public.get_tournament_game_result(p_game_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  g public.tournament_games;
  v_t public.tournaments;
  v_side uuid;
  v_is_host boolean;
begin
  perform internal.require_live_session();

  select * into g from public.tournament_games where id = p_game_id;
  if g.id is null then return null; end if;
  select * into v_t from public.tournaments where id = g.tournament_id;

  v_is_host := internal.can_manage_tournament(g.tournament_id);
  v_side := internal.tournament_game_side_for_caller(p_game_id);

  if not v_is_host and v_side is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', g.id,
    'tournamentId', g.tournament_id,
    'tournamentName', v_t.name,
    'ageGroup', g.age_group,
    'date', g.game_date,
    'startTime', g.start_time,
    'durationMinutes', g.duration_minutes,
    'round', g.round_number,
    -- WHAT THIS GAME IS CALLED when the competition is a knockout. Null on a round robin.
    'roundName', case when g.table_id is null then internal.tournament_game_round_label(g.plan_id, g.round_number, g.is_third_place) end,
          'stageLabel', internal.tournament_game_stage_label(g.plan_id, g.round_number, g.is_third_place, g.table_id),
          'countsToTable', coalesce(internal.tournament_plan_has_standings(g.plan_id), false) and g.bracket_position is null,
    'tableId', g.table_id,
    'tableName', (select pt.name from public.tournament_plan_tables pt where pt.id = g.table_id),
    'pitchName', (select cp.display_name from public.club_pitches cp where cp.id = g.pitch_id),
    'status', g.status,
    'resultStatus', g.result_status,
    'sideA', internal.tournament_side_summary(g.side_a_id, v_t.host_club_id),
    'sideB', internal.tournament_side_summary(g.side_b_id, v_t.host_club_id),
    'sideAScore', g.side_a_score,
    'sideBScore', g.side_b_score,
    -- WHICH SIDE THE CALLER IS, so a screen can say "your score" and "their score" without inferring
    -- it from a club name. A host who also has a side in the game is both, and is told so.
    'viewerRole', case when v_is_host and v_side is not null then 'host_and_side'
                       when v_is_host then 'host'
                       else 'side' end,
    'viewerSideId', v_side,
    'viewerIsSideA', (v_side is not null and v_side = g.side_a_id),
    'submittedAt', g.result_submitted_at,
    'submittedBySideId', g.result_submitted_by_participant_id,
    'confirmedAt', g.result_confirmed_at,
    'resolvedAt', g.result_resolved_at,
    'resolutionReason', g.result_resolution_reason,
    'kickedOff', internal.tournament_game_result_eligible(p_game_id),
    'can', jsonb_build_object(
      -- ONE CALL SUBMITS, CONFIRMS, CONTESTS AND PROPOSES A CHANGE: which of those it is depends on the
      -- state and on who submitted last, and the screen reads that from `resultStatus` and
      -- `submittedBySideId` rather than from four separate permissions.
      'submit', (v_side is not null
                 and coalesce(v_t.results_submission_enabled, true)
                 and internal.tournament_game_result_eligible(p_game_id)),
      'resolve', internal.can_resolve_tournament_result(p_game_id)
    ),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'kind', s.kind,
        'sideAScore', s.side_a_score,
        'sideBScore', s.side_b_score,
        'note', s.note,
        'at', s.created_at,
        'bySideId', s.submitted_by_participant_id,
        'bySideTeam', (select tm.display_name
                       from public.tournament_participants tp
                       left join public.teams tm on tm.id = tp.team_id
                       where tp.id = s.submitted_by_participant_id),
    'bySideName', (select cd.name
                       from public.tournament_participants tp
                       join public.club_directory cd on cd.id = tp.club_directory_id
                       left join public.teams tm on tm.id = tp.team_id
                       where tp.id = s.submitted_by_participant_id),
        -- The organiser's own rows have no side. Named, rather than left as a null a client has to
        -- interpret.
        'byHost', (s.submitted_by_participant_id is null),
        'byViewer', (v_side is not null and s.submitted_by_participant_id = v_side)
      ) order by s.created_at)
      from public.tournament_game_result_submissions s
      where s.game_id = p_game_id
    ), '[]'::jsonb)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_tournament_participant_centre(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.tournaments;
  v_can_manage boolean;
  v_contexts jsonb;
  v_mine uuid[];
  v_grades text[];
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to read this. Sign in again.' using errcode = '42501';
  end if;

  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then
    return null;
  end if;

  -- The same rule every other tournament read uses. A viewer who cannot see the tournament gets
  -- nothing -- deliberately the same answer as one that does not exist, because the difference is not
  -- ours to reveal.
  if not internal.tournament_visible_row(p_tournament_id) then
    return null;
  end if;

  v_can_manage := internal.can('tournament.tournament.manage', 'club', v_t.host_club_id, null, null);

  -- ---- THE SIDES THIS VIEWER IS PART OF ------------------------------------------------------------
  --
  -- "Part of" is the connection, not the tournament. It is what decides which age-group contexts
  -- appear, and which sides may show their full attendance breakdown.
  select coalesce(array_agg(distinct tp.id), '{}') into v_mine
  from public.tournament_participants tp
  where tp.tournament_id = p_tournament_id
    and (
      -- the viewer's own club
      (tp.club_id is not null and internal.can('tournament.tournament.view', 'club', tp.club_id, null, null))
      -- the entered team's own staff
      or (tp.team_id is not null and tp.club_id is not null
          and internal.can('tournament.tournament.view', 'team', tp.club_id, tp.team_id, null))
      -- the family of a player in the entered team
      or (tp.team_id is not null and exists (
            select 1 from public.player_team_memberships ptm
            where ptm.team_id = tp.team_id and ptm.status = 'active'
              and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
          ))
    );

  -- The grades those sides play in, in the tournament's own order. A host with management authority
  -- gets every grade the tournament runs, because the whole field is legitimately theirs.
  if v_can_manage then
    select coalesce(array_agg(g.age_group order by g.age_group), '{}') into v_grades
    from public.tournament_age_groups g where g.tournament_id = p_tournament_id;
  else
    select coalesce(array_agg(distinct tp.age_group), '{}') into v_grades
    from public.tournament_participants tp
    where tp.tournament_id = p_tournament_id and tp.id = any(v_mine);
  end if;

  -- ---- ONE CONTEXT PER AGE GROUP -------------------------------------------------------------------
  select coalesce(jsonb_agg(ctx order by ctx->>'ageGroup'), '[]'::jsonb) into v_contexts
  from (
    select jsonb_build_object(
      'ageGroup', grade,
      -- CAN THIS VIEWER RECORD A RESULT for one of this competition''s sides. The same
      -- capability the submit path enforces, so a Results tab can never appear for somebody the
      -- write would refuse -- and a parent is never shown an action list that is empty by design.
      'canRecordResults', exists (
        select 1 from public.tournament_participants rp
        where rp.tournament_id = p_tournament_id and rp.age_group = grade
          and rp.club_id is not null
          and (internal.can('fixture.result.record', 'club', rp.club_id, null, null)
               or (rp.team_id is not null
                   and internal.can('fixture.result.record', 'team', rp.club_id, rp.team_id, null)))
      ),

      -- EVERY SIDE IN THIS COMPETITION, and only this competition. A U12 context never lists the U16
      -- field: telling a U12 parent which clubs are in the U16 competition is describing a different
      -- day's rugby.
      'sides', coalesce((
        -- THE SHARED SIDE, plus only what is genuinely this surface''s own: which team a club is
        -- bringing, and whether the side is one of the viewer''s. An organiser reading the whole
        -- field has no use for either.
        select jsonb_agg(
          internal.tournament_side_summary(tp.id, v_t.host_club_id)
          || jsonb_build_object('teamId', tp.team_id, 'isMine', (tp.id = any(v_mine)))
        order by (tp.club_id is not null and tp.club_id = v_t.host_club_id) desc, cd.name, tp.id)
        from public.tournament_participants tp
        join public.club_directory cd on cd.id = tp.club_directory_id
        left join public.teams tm on tm.id = tp.team_id
        where tp.tournament_id = p_tournament_id and tp.age_group = grade
      ), '[]'::jsonb),

      -- ---- ATTENDANCE, FILTERED BEFORE IT IS SENT ------------------------------------------------
      --
      -- `attending` for everybody, because that is the number the day is organised around. Everything
      -- else only for a side this viewer is part of. A side with no Ovalball team behind it has no
      -- roster to count and reports nothing rather than zero -- "0 attending" would read as a club
      -- that answered, when the truth is that there is nobody here to ask.
      'attendance', coalesce((
        select jsonb_agg(jsonb_build_object(
          'participantId', tp.id,
          'clubName', cd.name,
          'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),
          'label', coalesce(tm.display_name, case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label else tp.age_group end),
          'isMine', (tp.id = any(v_mine)),
          'attending', case when tp.team_id is null then null else (
            select count(*) from public.player_fixture_attendance a
            join public.player_team_memberships m on m.player_id = a.player_id and m.team_id = tp.team_id and m.status = 'active'
            where a.tournament_id = p_tournament_id and a.status = 'ATTENDING') end,
          'unsure', case when tp.id = any(v_mine) and tp.team_id is not null then (
            select count(*) from public.player_fixture_attendance a
            join public.player_team_memberships m on m.player_id = a.player_id and m.team_id = tp.team_id and m.status = 'active'
            where a.tournament_id = p_tournament_id and a.status = 'UNSURE') end,
          'cannotAttend', case when tp.id = any(v_mine) and tp.team_id is not null then (
            select count(*) from public.player_fixture_attendance a
            join public.player_team_memberships m on m.player_id = a.player_id and m.team_id = tp.team_id and m.status = 'active'
            where a.tournament_id = p_tournament_id and a.status = 'CANNOT_ATTEND') end,
          'awaiting', case when tp.id = any(v_mine) and tp.team_id is not null then (
            select count(*) from public.player_team_memberships m
            where m.team_id = tp.team_id and m.status = 'active'
              and not exists (select 1 from public.player_fixture_attendance a
                              where a.tournament_id = p_tournament_id and a.player_id = m.player_id)) end
        ) order by (tp.id = any(v_mine)) desc, cd.name, tp.id)
        from public.tournament_participants tp
        join public.club_directory cd on cd.id = tp.club_directory_id
        left join public.teams tm on tm.id = tp.team_id
        where tp.tournament_id = p_tournament_id and tp.age_group = grade
      ), '[]'::jsonb),

      -- ---- THE PUBLISHED PROGRAMME ---------------------------------------------------------------
      --
      -- Read straight from what planning writes. An empty array means nothing has been published, and
      -- the screen says so in words rather than drawing an empty table or inventing a game.
      -- WHETHER THIS COMPETITION KEEPS A TABLE. The Tournament Centre's tabs ask this rather than the
      -- format, so a Tri-Fixture that is three sides sharing a morning does not get a Tables tab that
      -- can only ever be empty -- the same rule that keeps a knockout from getting one.
      'keepsStandings', coalesce((
        select bool_or(internal.tournament_plan_has_standings(pl.id))
        from public.tournament_plans pl
        where pl.tournament_id = p_tournament_id and pl.age_group = grade
          and pl.publication_state = 'PUBLISHED'), false),
      'competitionDays', coalesce((
        select jsonb_agg(d.day_date order by d.day_date)
        from public.tournament_plan_days d
        join public.tournament_plans pl on pl.id = d.plan_id
        where pl.tournament_id = p_tournament_id and pl.age_group = grade
          and pl.publication_state = 'PUBLISHED'), '[]'::jsonb),
      'games', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id,
          'gameDate', g.game_date,
          'startTime', g.start_time,
          'durationMinutes', g.duration_minutes,
          'pitchName', cp.display_name,
          'status', g.status,
          -- WHERE THIS GAME SITS IN THE COMPETITION. Null for a game somebody added by hand,
          -- which belongs to no table and no round and must not be given one.
          'tableName', pt.name,
          'round', g.round_number,
          -- WHAT A KNOCKOUT CALLS THIS GAME -- "Quarter Final", "Final", "Third-Place Play-Off" --
          -- from the bracket's own naming authority. Null on a round robin, which reads as a table
          -- and a round. A parent at a cup is told what everybody at the ground will call the game.
          'roundName', case when g.table_id is null then internal.tournament_game_round_label(g.plan_id, g.round_number, g.is_third_place) end,
          'stageLabel', internal.tournament_game_stage_label(g.plan_id, g.round_number, g.is_third_place, g.table_id),
          'countsToTable', coalesce(internal.tournament_plan_has_standings(g.plan_id), false) and g.bracket_position is null,
          'sideA', jsonb_build_object('participantId', a.id, 'clubName', acd.name, 'label', coalesce(atm.display_name, a.age_group),
                                      'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = a.club_id), acd.logo_storage_path),
                                      'score', g.side_a_score, 'isMine', (a.id = any(v_mine))),
          'sideB', jsonb_build_object('participantId', b.id, 'clubName', bcd.name, 'label', coalesce(btm.display_name, b.age_group),
                                      'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = b.club_id), bcd.logo_storage_path),
                                      'score', g.side_b_score, 'isMine', (b.id = any(v_mine)))
        ) order by g.game_date, pt.sort_order nulls first, g.round_number nulls first, g.start_time nulls last, g.sort_order)
        from public.tournament_games g
        join public.tournament_participants a on a.id = g.side_a_id
        join public.tournament_participants b on b.id = g.side_b_id
        join public.club_directory acd on acd.id = a.club_directory_id
        join public.club_directory bcd on bcd.id = b.club_directory_id
        left join public.teams atm on atm.id = a.team_id
        left join public.teams btm on btm.id = b.team_id
        left join public.club_pitches cp on cp.id = g.pitch_id
        left join public.tournament_plan_tables pt on pt.id = g.table_id
        where g.tournament_id = p_tournament_id and g.age_group = grade
          -- A GENERATED GAME IS THE ORGANISER'S WORKINGS UNTIL THEY PUBLISH IT. A game with no
          -- plan behind it is one somebody added by hand, which was always visible and stays so.
          and (g.plan_id is null or exists (select 1 from public.tournament_plans pl
                                            where pl.id = g.plan_id and pl.publication_state = 'PUBLISHED'))
      ), '[]'::jsonb),

      -- ---- THE KNOCKOUT'S SCHEDULED PLACES, WHICH ARE NOT YET GAMES ------------------------------
      --
      -- An organiser schedules a semi-final for three o'clock before anybody has qualified for it. A
      -- parent planning their Sunday needs to know that; "Winner QF1 v Winner QF2, 15:00, Pitch 1" is
      -- a true and useful sentence, and the one the draw already prints.
      --
      -- It is a READ PROJECTION OF THE PLAN, not a game. No `tournament_games` row is created to give
      -- the Agenda something to render -- a game has two real sides by definition, and inventing one
      -- would put a fixture against nobody into Results, the Draw and every count of what was played.
      -- The moment both sides resolve, `internal.create_bracket_game` materialises the canonical game
      -- and it disappears from here, because it is then carried by `games` like everything else.
      --
      -- Published plans only, by the same rule the games follow: a draft is the organiser's workings.
      'pairings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'pairingId', bp.id,
          'gameDate', bp.game_date,
          'startTime', bp.start_time,
          'pitchName', (select cp2.display_name from public.club_pitches cp2 where cp2.id = bp.pitch_id),
          'roundName', internal.tournament_game_round_label(bp.plan_id, bp.round_number, bp.is_third_place),
          'stageLabel', internal.tournament_game_stage_label(bp.plan_id, bp.round_number, bp.is_third_place, null::uuid),
          'countsToTable', false,
          'sideALabel', internal.bracket_slot_label(sa.id),
          'sideBLabel', internal.bracket_slot_label(sb.id)
        ) order by bp.game_date, bp.start_time nulls last, bp.round_number, bp.game_position)
        from public.tournament_bracket_pairings bp
        join public.tournament_plans pl on pl.id = bp.plan_id
        left join public.tournament_bracket_slots sa
          on sa.plan_id = bp.plan_id and sa.round_number = bp.round_number
             and sa.is_third_place = bp.is_third_place
             and sa.position = case when bp.is_third_place then 1 else bp.game_position * 2 - 1 end
        left join public.tournament_bracket_slots sb
          on sb.plan_id = bp.plan_id and sb.round_number = bp.round_number
             and sb.is_third_place = bp.is_third_place
             and sb.position = case when bp.is_third_place then 2 else bp.game_position * 2 end
        where pl.tournament_id = p_tournament_id and pl.age_group = grade
          and pl.publication_state = 'PUBLISHED'
          and bp.game_id is null
          and bp.game_date is not null
      ), '[]'::jsonb)
    ) as ctx
    from unnest(v_grades) as grade
  ) contexts;

  return jsonb_build_object(
    'id', v_t.id,
    'name', v_t.name,
    'startsOn', v_t.event_date,
    'endsOn', v_t.ends_on,
    'kickoffTime', v_t.kickoff_time,
    'endsAt', v_t.ends_at,
    'format', v_t.format,
    'swissRounds', v_t.swiss_rounds,
    'visibility', v_t.visibility,
    -- HOW RESULTS ARE RUN, which is NOT the tournament''s own visibility: a club may list a
    -- festival publicly and still keep its scores inside it.
    'resultsSubmissionEnabled', v_t.results_submission_enabled,
    'resultsVisibility', v_t.results_visibility,
    'status', v_t.status,
    'cancelled', (v_t.cancelled_at is not null),
    'coverImagePath', v_t.cover_image_path,
    'coverStockKey', v_t.cover_stock_key,
    'notes', v_t.notes,
    'venueName', (select v.name from public.venues v where v.id = v_t.venue_id),
    'venueAddress', (select nullif(concat_ws(', ', v.address_line_1, v.town, v.postcode), '') from public.venues v where v.id = v_t.venue_id),
    'hostClubName', (select cd.name from public.club_directory cd where cd.id = v_t.host_directory_id),
    'hostCrestPath', coalesce(
      (select c.logo_storage_path from public.clubs c where c.id = v_t.host_club_id),
      (select cd.logo_storage_path from public.club_directory cd where cd.id = v_t.host_directory_id)),
    'hostTown', (select nullif(concat_ws(', ', cd.town, cd.county), '') from public.club_directory cd where cd.id = v_t.host_directory_id),
    -- The client routes a manager to the management surface that already exists rather than drawing a
    -- second organiser dashboard behind this one.
    'canManage', v_can_manage,
    'contexts', v_contexts,

    -- ---- WHO THIS VIEWER MAY ANSWER FOR ---------------------------------------------------------
    --
    -- Resolved by the ONE canonical authority, and never by a role. `resolve_attendance_response_source`
    -- raises for a 16-17 year old without recorded consent and for anybody under 16, so it is called
    -- defensively here: this list decides whether a CONTROL is drawn, and the write refuses
    -- independently whether or not one was.
    'myPlayers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'playerId', pl.id,
        'firstName', pl.first_name,
        -- Whether this is the viewer THEMSELVES rather than a child they answer for. The question and
        -- the confirmation both change person on it -- "Can you make the tournament?" against "Can
        -- Harry make the tournament?" -- so it is a fact the server states rather than one the client
        -- infers from whether a name happens to match.
        'isSelf', internal.is_own_linked_player(pl.id),
        'teamId', ptm.team_id,
        'ageGroup', tp.age_group,
        'status', (select a.status from public.player_fixture_attendance a
                   where a.tournament_id = p_tournament_id and a.player_id = pl.id),
        'canRespond', (select internal.resolve_attendance_response_source(pl.id) is not null)
      ) order by pl.first_name)
      from public.tournament_participants tp
      join public.player_team_memberships ptm on ptm.team_id = tp.team_id and ptm.status = 'active'
      join public.players pl on pl.id = ptm.player_id
      where tp.tournament_id = p_tournament_id
        and tp.team_id is not null
        and (internal.is_own_linked_player(pl.id) or internal.is_active_player_guardian(pl.id))
    ), '[]'::jsonb)
  );
exception
  -- `resolve_attendance_response_source` raises rather than returning null for a refusal, and a
  -- refusal is an ordinary answer here: it means "no control for this player", not "the page failed".
  when sqlstate '42501' then
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_tournament_results_overview(p_tournament_id uuid, p_age_group text, p_filter text DEFAULT 'all'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.tournaments;
  v_is_host boolean;
  v_sides uuid[];
  v_games jsonb;
  v_counts jsonb;
begin
  perform internal.require_live_session();

  if coalesce(p_filter, 'all') not in ('all', 'needs_attention', 'awaiting_confirmation', 'contested', 'confirmed') then
    raise exception 'Unknown results filter: %.', p_filter using errcode = '22023';
  end if;

  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then return null; end if;

  v_is_host := internal.can_manage_tournament(p_tournament_id);

  -- EVERY SIDE THIS CALLER MAY RECORD RESULTS FOR. A club running two sides in the same competition
  -- gets both, which is why this is an array rather than the single side the submit path resolves.
  select coalesce(array_agg(tp.id), '{}'::uuid[]) into v_sides
  from public.tournament_participants tp
  where tp.tournament_id = p_tournament_id
    and tp.club_id is not null
    and (internal.can('fixture.result.record', 'club', tp.club_id, null, null)
         or (tp.team_id is not null
             and internal.can('fixture.result.record', 'team', tp.club_id, tp.team_id, null)));

  if not v_is_host and cardinality(v_sides) = 0 then
    -- NOT THE ORGANISER AND NOT A SIDE. There is no list for this person, and saying so is not the same
    -- as handing them an empty one.
    return null;
  end if;

  -- THE COUNTS COME FIRST, over the whole entitled set. A tab showing how much is behind it is useless
  -- if it only counts what the current filter already put on screen.
  select jsonb_build_object(
    'all', count(*),
    'needsAttention', count(*) filter (where internal.tournament_result_needs_attention(tg.id, v_is_host, v_sides)),
    'awaitingConfirmation', count(*) filter (where tg.result_status = 'awaiting_confirmation'),
    'contested', count(*) filter (where tg.result_status in ('disputed', 'amendment_pending')),
    'confirmed', count(*) filter (where internal.tournament_result_counts(tg.result_status))
  ) into v_counts
  from public.tournament_games tg
  where tg.tournament_id = p_tournament_id
    and tg.age_group = p_age_group
    and (v_is_host or tg.side_a_id = any (v_sides) or tg.side_b_id = any (v_sides));

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', tg.id,
    'date', tg.game_date,
    'startTime', tg.start_time,
    'round', tg.round_number,
    -- WHAT THIS GAME IS CALLED when the competition is a knockout. Null on a round robin.
    'roundName', case when tg.table_id is null then internal.tournament_game_round_label(tg.plan_id, tg.round_number, tg.is_third_place) end,
          'stageLabel', internal.tournament_game_stage_label(tg.plan_id, tg.round_number, tg.is_third_place, tg.table_id),
          'countsToTable', coalesce(internal.tournament_plan_has_standings(tg.plan_id), false) and tg.bracket_position is null,
    'tableId', tg.table_id,
    'tableName', (select pt.name from public.tournament_plan_tables pt where pt.id = tg.table_id),
    'pitchName', (select cp.display_name from public.club_pitches cp where cp.id = tg.pitch_id),
    'status', tg.status,
    'resultStatus', tg.result_status,
    -- THE SCORES. Only ever the organiser's or one of the two sides' -- which is the condition this
    -- whole function is gated on, so by the time a row reaches here the scores may be shown.
    'sideAScore', tg.side_a_score,
    'sideBScore', tg.side_b_score,
    'submittedAt', tg.result_submitted_at,
    'submittedBySideId', tg.result_submitted_by_participant_id,
    'submittedBySideName', (select cd.name
                            from public.tournament_participants tp
                            join public.club_directory cd on cd.id = tp.club_directory_id
                            left join public.teams tm on tm.id = tp.team_id
                            where tp.id = tg.result_submitted_by_participant_id),
    'confirmedAt', tg.result_confirmed_at,
    'resolvedAt', tg.result_resolved_at,
    'resolutionReason', tg.result_resolution_reason,
    'needsAttention', internal.tournament_result_needs_attention(tg.id, v_is_host, v_sides),
    'isMine', (tg.side_a_id = any (v_sides) or tg.side_b_id = any (v_sides)),
    'kickedOff', internal.tournament_game_result_eligible(tg.id),
    'sideA', internal.tournament_side_summary(tg.side_a_id, v_t.host_club_id),
    'sideB', internal.tournament_side_summary(tg.side_b_id, v_t.host_club_id)
  ) order by tg.game_date, tg.start_time nulls last, tg.sort_order), '[]'::jsonb)
  into v_games
  from public.tournament_games tg
  where tg.tournament_id = p_tournament_id
    and tg.age_group = p_age_group
    and (v_is_host or tg.side_a_id = any (v_sides) or tg.side_b_id = any (v_sides))
    and case coalesce(p_filter, 'all')
          when 'needs_attention' then internal.tournament_result_needs_attention(tg.id, v_is_host, v_sides)
          when 'awaiting_confirmation' then tg.result_status = 'awaiting_confirmation'
          when 'contested' then tg.result_status in ('disputed', 'amendment_pending')
          when 'confirmed' then internal.tournament_result_counts(tg.result_status)
          else true
        end;

  return jsonb_build_object(
    'tournamentId', v_t.id,
    'tournamentName', v_t.name,
    'ageGroup', p_age_group,
    'viewerRole', case when v_is_host then 'host' else 'side' end,
    'sideFilterApplied', not v_is_host,
    'viewerSideIds', to_jsonb(v_sides),
    'submissionEnabled', v_t.results_submission_enabled,
    'resultsVisibility', v_t.results_visibility,
    'filter', coalesce(p_filter, 'all'),
    'counts', v_counts,
    'games', v_games
  );
end;
$function$;
