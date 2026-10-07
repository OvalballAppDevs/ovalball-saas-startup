-- =====================================================================================================
-- MAKING THE DRAW.
--
-- Three ways in, one structure out. Whichever way an organiser arranges a bracket -- pulled out of a
-- hat, arranged by hand, or seeded -- what lands in `tournament_bracket_slots` is the same thing: every
-- participating side in exactly one place, and the leftover places marked as byes.
--
-- ---- WHERE THE BYES GO ---------------------------------------------------------------------------
--
-- A six-side knockout needs an eight-place bracket, so two places are empty. Putting them next to each
-- other would send two sides through from one corner and make the other corner play twice as much
-- rugby to reach the same semi-final.
--
-- So places are filled in CLASSIC BRACKET ORDER, the arrangement every printed draw sheet uses:
--
--   size 2   seeds  1 2
--   size 4   seeds  1 4 2 3
--   size 8   seeds  1 8 4 5 2 7 3 6
--
-- built by taking the previous round's order and pairing each seed with its complement. The property
-- that matters is SEPARATION: the top seed and the second seed cannot meet before the final, and the
-- empty places -- always the highest seed numbers -- fall opposite the strongest positions and spread
-- themselves through the draw rather than bunching.
--
-- A RANDOM DRAW IS THE SAME ARRANGEMENT WITH THE SIDES SHUFFLED FIRST. The shuffle decides who is
-- "seed 1"; the bracket order decides where seed 1 sits. That is what makes a random draw fair rather
-- than merely arbitrary, and it is why randomising redraws the WHOLE bracket rather than shuffling
-- within one corner of it.
--
-- ---- AND NOBODY IS EVER DROPPED ------------------------------------------------------------------
--
-- Every function here finishes by asserting that the number of sides placed equals the number of sides
-- entered. A draw that silently loses a club is the failure this guards, and it is checked rather than
-- trusted.
-- =====================================================================================================

/**
 * CLASSIC BRACKET ORDER for a bracket of `p_size` places: the seed number that belongs in each slot,
 * in slot order. Built by the standard doubling rule rather than by a table of magic numbers, so it is
 * right at every size without anybody maintaining it.
 */
create or replace function internal.bracket_seed_order(p_size integer)
returns integer[]
language plpgsql
immutable
as $function$
declare v_order integer[] := array[1]; v_next integer[]; v_n integer := 1; v_seed integer;
begin
  if coalesce(p_size, 0) < 2 then return array[]::integer[]; end if;
  while v_n < p_size loop
    v_next := array[]::integer[];
    foreach v_seed in array v_order loop
      -- Each seed is paired with its complement in the doubled bracket: 1 with 2n, 2 with 2n-1, ...
      v_next := v_next || v_seed || (2 * v_n + 1 - v_seed);
    end loop;
    v_order := v_next;
    v_n := v_n * 2;
  end loop;
  return v_order;
end;
$function$;

do $$
begin
  if internal.bracket_seed_order(2) <> array[1,2] then raise exception 'two-place order is wrong.'; end if;
  if internal.bracket_seed_order(4) <> array[1,4,2,3] then raise exception 'four-place order is wrong.'; end if;
  if internal.bracket_seed_order(8) <> array[1,8,4,5,2,7,3,6] then raise exception 'eight-place order is wrong.'; end if;
  -- THE PROPERTY THAT MATTERS: seeds 1 and 2 sit in opposite halves at every size.
  if (array_position(internal.bracket_seed_order(16), 1) <= 8)
     = (array_position(internal.bracket_seed_order(16), 2) <= 8) then
    raise exception 'the top two seeds are in the same half of a sixteen-place bracket.';
  end if;
end $$;

-- ---- placing an ordered list of sides into the draw ---------------------------------------------------

/**
 * WRITE A DRAW from an ordered list of sides, where position in the list IS the seed.
 *
 * Shared by all three draw methods, because the only thing that differs between them is how the order
 * was arrived at. Replaces the plan's existing draw outright: a draw is one arrangement, not an
 * accumulation of attempts.
 */
create or replace function internal.write_tournament_draw(p_plan_id uuid, p_sides uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_size integer;
  v_rounds integer;
  v_order integer[];
  v_slot integer;
  v_seed integer;
  v_placed integer := 0;
  v_round integer;
begin
  v_size := internal.bracket_size(cardinality(p_sides));
  if v_size = 0 then
    raise exception 'A knockout needs at least two sides.' using errcode = '22023';
  end if;
  v_rounds := internal.bracket_rounds(v_size);
  v_order := internal.bracket_seed_order(v_size);

  delete from public.tournament_bracket_slots where plan_id = p_plan_id;

  -- ROUND ONE: every place, holding a side or marked as a bye.
  for v_slot in 1 .. v_size loop
    v_seed := v_order[v_slot];
    insert into public.tournament_bracket_slots (plan_id, round_number, position, participant_id, is_bye)
    values (
      p_plan_id, 1, v_slot,
      case when v_seed <= cardinality(p_sides) then p_sides[v_seed] end,
      v_seed > cardinality(p_sides)
    );
    if v_seed <= cardinality(p_sides) then v_placed := v_placed + 1; end if;
  end loop;

  -- EVERY LATER ROUND EXISTS FROM THE START, empty. A bracket a parent opens before a ball is kicked
  -- should show the shape of the competition -- the quarter-finals, the semi-finals, the final -- not
  -- appear a round at a time as results arrive.
  for v_round in 2 .. v_rounds loop
    for v_slot in 1 .. (v_size / power(2, v_round - 1)::int) loop
      insert into public.tournament_bracket_slots (plan_id, round_number, position)
      values (p_plan_id, v_round, v_slot);
    end loop;
  end loop;

  -- NOBODY WAS DROPPED. Asserted, not assumed: this is the failure that would otherwise be discovered
  -- by a club arriving to find they are not in the competition.
  if v_placed <> cardinality(p_sides) then
    raise exception 'The draw placed % of % sides.', v_placed, cardinality(p_sides) using errcode = '22023';
  end if;

  -- A SIDE ADVANCED BY A BYE IS IN THE NEXT ROUND IMMEDIATELY. There is no game to play and nothing to
  -- wait for, so the bracket says so from the moment it is drawn.
  perform internal.settle_tournament_byes(p_plan_id);

  return v_size;
end;
$function$;

/**
 * A SIDE OPPOSITE AN EMPTY PLACE ADVANCES, with no game and no result.
 *
 * Run when the draw is written rather than when the round is played, because a bye is a property of
 * the arrangement and the side knows straight away that it is through.
 */
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
           b.position as pos_b, b.participant_id as side_b, b.is_bye as bye_b,
           ((a.position + 1) / 2) as target
    from public.tournament_bracket_slots a
    join public.tournament_bracket_slots b
      on b.plan_id = a.plan_id and b.round_number = a.round_number and b.position = a.position + 1
    where a.plan_id = p_plan_id and a.round_number = 1 and a.position % 2 = 1
  loop
    -- EXACTLY ONE OF THE PAIR IS EMPTY. Two empty places meet nobody and advance nobody; two real
    -- sides play a game.
    if r.bye_a and r.side_b is not null then
      update public.tournament_bracket_slots set participant_id = r.side_b, updated_at = now()
      where plan_id = p_plan_id and round_number = 2 and position = r.target;
      v_n := v_n + 1;
    elsif r.bye_b and r.side_a is not null then
      update public.tournament_bracket_slots set participant_id = r.side_a, updated_at = now()
      where plan_id = p_plan_id and round_number = 2 and position = r.target;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$function$;

-- ---- the three ways an organiser makes one -----------------------------------------------------------

/** Every side entered in this competition, in a stable order. */
create or replace function internal.tournament_plan_sides(p_plan_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(array_agg(tp.id order by cd.name, tp.id), '{}'::uuid[])
  from public.tournament_plans p
  join public.tournament_participants tp
    on tp.tournament_id = p.tournament_id and tp.age_group = p.age_group
  join public.club_directory cd on cd.id = tp.club_directory_id
  where p.id = p_plan_id;
$function$;

create or replace function public.randomise_tournament_bracket(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid; v_sides uuid[];
begin
  perform internal.require_live_session();
  select tournament_id into v_tournament from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  perform internal.refuse_if_bracket_has_results(p_plan_id);

  -- THE WHOLE DRAW, REDRAWN. Shuffling within one corner is not a random draw, it is a random corner.
  select coalesce(array_agg(s order by random()), '{}'::uuid[]) into v_sides
  from unnest(internal.tournament_plan_sides(p_plan_id)) s;

  update public.tournament_plans set draw_method = 'random', updated_by = auth.uid(), updated_at = now()
  where id = p_plan_id;
  return internal.write_tournament_draw(p_plan_id, v_sides);
end;
$function$;

/**
 * THE ORGANISER'S OWN ARRANGEMENT -- used by a manual draw, by a seeded one, and by dragging a side
 * from one place to another.
 *
 * `p_sides` is the draw in SEED ORDER: the first id is seed 1. Dragging two sides to swap them is this
 * call with two entries exchanged, which is why there is no separate swap endpoint -- one way to write
 * a draw means one place for it to be validated.
 */
create or replace function public.set_tournament_bracket_draw(
  p_plan_id uuid,
  p_sides uuid[],
  p_draw_method text default 'manual'
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid; v_expected uuid[];
begin
  perform internal.require_live_session();
  select tournament_id into v_tournament from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;
  if p_draw_method not in ('random', 'manual', 'seeded') then
    raise exception 'A draw is made at random, by hand, or from seeds.' using errcode = '22023';
  end if;
  perform internal.refuse_if_bracket_has_results(p_plan_id);

  v_expected := internal.tournament_plan_sides(p_plan_id);

  -- ARRANGING A DRAW NEVER CHANGES WHO IS IN IT. Dragging sides around the bracket moves places; it
  -- does not enter a club, withdraw one, or invent one. Checked as a set, so a repeated id or a side
  -- from another competition is refused rather than quietly seated.
  if (select count(*) from (select unnest(p_sides) except select unnest(v_expected)) x) > 0 then
    raise exception 'That draw contains a side that is not entered in this competition.' using errcode = '22023';
  end if;
  if (select count(*) from (select unnest(v_expected) except select unnest(p_sides)) x) > 0 then
    raise exception 'Every side entered in this competition must have a place in the draw.' using errcode = '22023';
  end if;
  if (select count(distinct s) from unnest(p_sides) s) <> cardinality(p_sides) then
    raise exception 'A side cannot be in the draw twice.' using errcode = '22023';
  end if;

  update public.tournament_plans set draw_method = p_draw_method, updated_by = auth.uid(), updated_at = now()
  where id = p_plan_id;
  return internal.write_tournament_draw(p_plan_id, p_sides);
end;
$function$;

/**
 * A SEEDED DRAW, from seeds the ORGANISER names.
 *
 * Ovalball has no ranking authority, so it does not invent one: the organiser says who seed 1 is, and
 * who seed 2 is, and so on. Everybody they did not seed is drawn at random into the places that are
 * left, which is how a real seeded draw works.
 *
 * It deliberately does NOT read Round Robin standings. A knockout that follows a group stage is a
 * different product idea -- a progression between competitions -- and inferring it here would silently
 * decide something nobody configured.
 */
create or replace function public.seed_tournament_bracket(p_plan_id uuid, p_seeds uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_all uuid[]; v_rest uuid[]; v_ordered uuid[];
begin
  v_all := internal.tournament_plan_sides(p_plan_id);
  if (select count(*) from (select unnest(p_seeds) except select unnest(v_all)) x) > 0 then
    raise exception 'A seed must be a side entered in this competition.' using errcode = '22023';
  end if;
  if (select count(distinct s) from unnest(p_seeds) s) <> cardinality(coalesce(p_seeds, '{}'::uuid[])) then
    raise exception 'A side cannot be seeded twice.' using errcode = '22023';
  end if;

  select coalesce(array_agg(s order by random()), '{}'::uuid[]) into v_rest
  from (select unnest(v_all) except select unnest(coalesce(p_seeds, '{}'::uuid[]))) t(s);

  v_ordered := coalesce(p_seeds, '{}'::uuid[]) || v_rest;
  return public.set_tournament_bracket_draw(p_plan_id, v_ordered, 'seeded');
end;
$function$;

-- ---- a draw that has been played is not redrawn ------------------------------------------------------

/**
 * REDRAWING A KNOCKOUT THAT HAS STARTED WOULD REWRITE WHAT HAPPENED.
 *
 * The same principle as the Round Robin regeneration guard, for the same reason: a side that has
 * played, won and gone through cannot be moved to the other half of the bracket because somebody
 * pressed Randomise. The organiser clears the results deliberately first, or does not redraw.
 */
create or replace function internal.refuse_if_bracket_has_results(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_history record;
begin
  select * into v_history from internal.tournament_plan_result_history(p_plan_id);
  if v_history.games_with_results > 0 then
    raise exception
      '% game(s) in this knockout already have a result. Redrawing would move sides that have already played. Clear the results deliberately first.',
      v_history.games_with_results
      using errcode = '22023', hint = 'TOURNAMENT_PLAN_HAS_RESULTS';
  end if;
end;
$function$;

revoke all on function public.randomise_tournament_bracket(uuid) from public, anon;
revoke all on function public.set_tournament_bracket_draw(uuid, uuid[], text) from public, anon;
revoke all on function public.seed_tournament_bracket(uuid, uuid[]) from public, anon;
grant execute on function public.randomise_tournament_bracket(uuid) to authenticated, service_role;
grant execute on function public.set_tournament_bracket_draw(uuid, uuid[], text) to authenticated, service_role;
grant execute on function public.seed_tournament_bracket(uuid, uuid[]) to authenticated, service_role;
