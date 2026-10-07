-- =====================================================================================================
-- A PLACE IN THE BRACKET SAYS WHERE IT COMES FROM.
--
-- A slot resolves from one of three things, and now says which:
--
--   A DRAWN SIDE          round one, holding a real participating side.
--   A BYE                 round one, deliberately empty. The side opposite advances.
--   THE WINNER OF A GAME  every later round. Slot p of round r+1 is the winner of game p of round r.
--   THE LOSER OF A GAME   the third-place play-off's two places, and only those.
--
-- WHY THIS IS STORED RATHER THAN CALCULATED. The arithmetic alone is enough to RUN the competition, and
-- that is how progression works. It is not enough to DRAW it: a bracket has to print "Winner QF1" and
-- "Loser SF1" in the places nobody has reached yet, and a screen that worked those labels out for
-- itself would be a second implementation of the dependency -- free to disagree with the one that
-- actually advances sides.
--
-- NOTHING HERE IS A TEAM. "Winner QF1" is a sentence a screen prints about an empty place. There is no
-- participant, no club, no crest and no row anywhere called Winner QF1 or Bye.
--
-- THE GRAPH CANNOT CYCLE. A slot's source is always a STRICTLY EARLIER round, which is checked by the
-- table itself -- so a dependency loop is not a bug that can be introduced, it is a row the database
-- refuses.
-- =====================================================================================================

alter table public.tournament_bracket_slots
  add column if not exists source_round integer,
  add column if not exists source_game_position integer,
  add column if not exists source_kind text,
  add column if not exists is_third_place boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_bracket_slots_source_kind_check') then
    alter table public.tournament_bracket_slots add constraint tournament_bracket_slots_source_kind_check
      check (source_kind is null or source_kind in ('winner', 'loser'));
  end if;

  -- A SOURCE IS ALL THREE PARTS OR NONE. Half a dependency is a label nobody can print.
  if not exists (select 1 from pg_constraint where conname = 'tournament_bracket_slots_source_shape') then
    alter table public.tournament_bracket_slots add constraint tournament_bracket_slots_source_shape
      check (num_nonnulls(source_round, source_game_position, source_kind) in (0, 3));
  end if;

  /**
   * THE ACYCLICITY GUARANTEE, as a CHECK rather than as a convention.
   *
   * A place can only ever be fed by an EARLIER round. A graph whose every edge points strictly forward
   * in a finite ordering cannot contain a cycle, so "a game cannot depend on itself" and "cycles are
   * impossible" are not properties this code has to maintain -- they are rows the database will not
   * accept.
   */
  if not exists (select 1 from pg_constraint where conname = 'tournament_bracket_slots_source_is_earlier') then
    alter table public.tournament_bracket_slots add constraint tournament_bracket_slots_source_is_earlier
      check (source_round is null or source_round < round_number or is_third_place);
  end if;

  -- A LOSER FEEDS ONLY THE THIRD-PLACE PLAY-OFF. Nothing else in a knockout is reached by losing.
  if not exists (select 1 from pg_constraint where conname = 'tournament_bracket_slots_loser_is_third_place') then
    alter table public.tournament_bracket_slots add constraint tournament_bracket_slots_loser_is_third_place
      check (source_kind is distinct from 'loser' or is_third_place);
  end if;
end $$;

-- The third-place places share a round number with the final, so uniqueness has to know about them.
drop index if exists tournament_bracket_slots_side_once_per_round;
alter table public.tournament_bracket_slots
  drop constraint if exists tournament_bracket_slots_one_per_place;
create unique index if not exists tournament_bracket_slots_one_per_place
  on public.tournament_bracket_slots (plan_id, round_number, position, is_third_place);
create unique index if not exists tournament_bracket_slots_side_once_per_round
  on public.tournament_bracket_slots (plan_id, round_number, participant_id)
  where participant_id is not null and not is_third_place;

comment on column public.tournament_bracket_slots.source_kind is
  'Whether this place is filled by the WINNER of its source game, or -- only for the third-place '
  'play-off -- by the LOSER. Null in round one, where the place holds a drawn side or a bye.';

-- ---- what a place is called before anybody reaches it ------------------------------------------------

/** "Final", "SF", "QF", "R16" -- from how many rounds are left, which is what a bracket column is. */
create or replace function internal.bracket_round_code(p_round integer, p_rounds integer)
returns text
language sql
immutable
as $function$
  select case p_rounds - p_round
    when 0 then 'Final'
    when 1 then 'SF'
    when 2 then 'QF'
    when 3 then 'R16'
    when 4 then 'R32'
    else 'R' || power(2, p_rounds - p_round + 1)::int
  end;
$function$;

create or replace function internal.bracket_round_name(p_round integer, p_rounds integer)
returns text
language sql
immutable
as $function$
  select case p_rounds - p_round
    when 0 then 'Final'
    when 1 then 'Semi Finals'
    when 2 then 'Quarter Finals'
    when 3 then 'Round of 16'
    when 4 then 'Round of 32'
    else 'Round of ' || power(2, p_rounds - p_round + 1)::int
  end;
$function$;

/**
 * WHAT A SCREEN PRINTS IN AN EMPTY PLACE -- "Winner QF1", "Loser SF2", "BYE".
 *
 * Built from the stored dependency, in the database, so the bracket a participant reads and the rule
 * that actually advances a side are the same statement rather than two that agree today.
 */
create or replace function internal.bracket_slot_label(p_slot_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare s record; v_size integer; v_rounds integer;
begin
  select * into s from public.tournament_bracket_slots where id = p_slot_id;
  if s.id is null then return null; end if;
  if s.participant_id is not null then return null; end if;
  if s.is_bye then return 'BYE'; end if;
  if s.source_round is null then return null; end if;

  select count(*) into v_size from public.tournament_bracket_slots
  where plan_id = s.plan_id and round_number = 1 and not is_third_place;
  v_rounds := internal.bracket_rounds(v_size);

  return initcap(s.source_kind) || ' '
         || internal.bracket_round_code(s.source_round, v_rounds)
         || s.source_game_position::text;
end;
$function$;

-- ---- the draw writes the dependencies --------------------------------------------------------------

create or replace function internal.write_tournament_draw(p_plan_id uuid, p_sides uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_size integer; v_rounds integer; v_order integer[]; v_slot integer; v_seed integer;
  v_placed integer := 0; v_round integer; v_third boolean;
begin
  v_size := internal.bracket_size(cardinality(p_sides));
  if v_size = 0 then
    raise exception 'A knockout needs at least two sides.' using errcode = '22023';
  end if;
  v_rounds := internal.bracket_rounds(v_size);
  v_order := internal.bracket_seed_order(v_size);

  delete from public.tournament_bracket_slots where plan_id = p_plan_id;

  for v_slot in 1 .. v_size loop
    v_seed := v_order[v_slot];
    insert into public.tournament_bracket_slots (plan_id, round_number, position, participant_id, is_bye)
    values (p_plan_id, 1, v_slot,
            case when v_seed <= cardinality(p_sides) then p_sides[v_seed] end,
            v_seed > cardinality(p_sides));
    if v_seed <= cardinality(p_sides) then v_placed := v_placed + 1; end if;
  end loop;

  -- EVERY LATER PLACE, EMPTY BUT NAMED: it knows which game fills it long before that game is played.
  for v_round in 2 .. v_rounds loop
    for v_slot in 1 .. (v_size / power(2, v_round - 1)::int) loop
      insert into public.tournament_bracket_slots
        (plan_id, round_number, position, source_round, source_game_position, source_kind)
      values (p_plan_id, v_round, v_slot, v_round - 1, v_slot, 'winner');
    end loop;
  end loop;

  -- THE THIRD-PLACE PLACES, fed by LOSING -- the only places in a knockout that are.
  select third_place_playoff into v_third from public.tournament_plans where id = p_plan_id;
  if coalesce(v_third, false) and v_rounds >= 2 then
    insert into public.tournament_bracket_slots
      (plan_id, round_number, position, is_third_place, source_round, source_game_position, source_kind)
    values (p_plan_id, v_rounds, 1, true, v_rounds - 1, 1, 'loser'),
           (p_plan_id, v_rounds, 2, true, v_rounds - 1, 2, 'loser');
  end if;

  if v_placed <> cardinality(p_sides) then
    raise exception 'The draw placed % of % sides.', v_placed, cardinality(p_sides) using errcode = '22023';
  end if;

  perform internal.settle_tournament_byes(p_plan_id);
  return v_size;
end;
$function$;

-- The bye settler must ignore the third-place places, which are not part of round one's pairing.
create or replace function internal.settle_tournament_byes(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare r record; v_n integer := 0;
begin
  for r in
    select a.position as pos_a, a.participant_id as side_a, a.is_bye as bye_a,
           b.participant_id as side_b, b.is_bye as bye_b,
           ((a.position + 1) / 2) as target
    from public.tournament_bracket_slots a
    join public.tournament_bracket_slots b
      on b.plan_id = a.plan_id and b.round_number = a.round_number
         and b.position = a.position + 1 and not b.is_third_place
    where a.plan_id = p_plan_id and a.round_number = 1 and a.position % 2 = 1 and not a.is_third_place
  loop
    if r.bye_a and r.side_b is not null then
      update public.tournament_bracket_slots set participant_id = r.side_b, updated_at = now()
      where plan_id = p_plan_id and round_number = 2 and position = r.target and not is_third_place;
      v_n := v_n + 1;
    elsif r.bye_b and r.side_a is not null then
      update public.tournament_bracket_slots set participant_id = r.side_a, updated_at = now()
      where plan_id = p_plan_id and round_number = 2 and position = r.target and not is_third_place;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;
