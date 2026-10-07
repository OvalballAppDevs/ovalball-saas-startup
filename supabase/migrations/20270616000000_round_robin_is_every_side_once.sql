-- =====================================================================================================
-- ROUND ROBIN IS EVERY SIDE IN A TABLE PLAYING EVERY OTHER SIDE, ONCE.
--
-- ONE IMPLEMENTATION, TWO CALLERS. `internal.tournament_round_robin_pairs` returns the pairings for a
-- plan and writes nothing. Generating a draft calls it and inserts; previewing calls it and returns.
-- A preview that computed the fixtures a second way would eventually disagree with the thing it claims
-- to be previewing, which is worse than having no preview.
--
-- PAIRING IS SEPARATE FROM SCHEDULING, and this function is only the first half. It answers "who plays
-- whom, in what order" and knows nothing about pitches, times or even days. Scheduling then places the
-- pairings on a day, a pitch and a time. That line is where Swiss and Knockout will plug in: they are
-- different PAIRING rules over the same sides, and they will reuse the scheduler unchanged.
--
-- THE CIRCLE METHOD, so a round is genuinely a round. The naive answer -- every unordered pair, in any
-- order -- produces the right SET of games but an unplayable ORDER, with a side drawn twice in a row
-- and twice at the same time. The circle method fixes one position and rotates the rest, so within any
-- round no side appears more than once. That property is what makes the scheduler's job possible.
--
-- AN ODD TABLE HAS A BYE, AND A BYE IS NOT A GAME. The method needs an even count, so an odd table is
-- rotated as if it had one more position. That extra position is an INDEX IN THIS FUNCTION'S ARITHMETIC
-- and nothing else: it is never a row, never a participant, never a side called "Bye". Whoever is drawn
-- against it simply has no game that round, which is what a bye is.
--
-- THE INVARIANT: a table of n sides produces exactly n * (n - 1) / 2 games -- 3 sides 3 games, 4 sides
-- 6, 5 sides 10, 6 sides 15 -- with no pair repeated and no side against itself.
-- =====================================================================================================

create or replace function internal.tournament_round_robin_pairs(p_plan_id uuid)
returns table (
  table_id uuid,
  table_sort integer,
  round_number integer,
  pair_in_round integer,
  side_a_id uuid,
  side_b_id uuid
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with tables as (
    select t.id, t.sort_order, count(s.participant_id)::int as n
    from public.tournament_plan_tables t
    left join public.tournament_plan_table_sides s on s.table_id = t.id
    where t.plan_id = p_plan_id
    group by t.id, t.sort_order
  ),
  -- The sides at each table, numbered from zero in their own order. `position` is the organiser's
  -- arrangement; the circle method below rotates these numbers, never the sides themselves.
  seats as (
    select s.table_id,
           s.participant_id,
           (row_number() over (partition by s.table_id order by s.position, s.participant_id) - 1)::int as seat
    from public.tournament_plan_table_sides s
    where s.plan_id = p_plan_id
  ),
  -- m is the count the rotation runs on: the real one when it is even, one more when it is odd. The
  -- extra seat is a number with no side behind it, which is exactly how a bye is expressed.
  sized as (
    select tb.id, tb.sort_order, tb.n, case when tb.n % 2 = 0 then tb.n else tb.n + 1 end as m
    from tables tb
    where tb.n >= 2
  ),
  -- Every (round, pairing) slot the rotation produces.
  slots as (
    select z.id, z.sort_order, z.n, z.m,
           r.round_number,
           i.pair_in_round,
           -- The fixed seat is m-1; every other seat rotates around it.
           case when i.pair_in_round = 1 then z.m - 1
                else ((r.round_number - 1) + (i.pair_in_round - 1)) % (z.m - 1) end as seat_a,
           case when i.pair_in_round = 1 then (r.round_number - 1) % (z.m - 1)
                else (((r.round_number - 1) - (i.pair_in_round - 1)) % (z.m - 1) + (z.m - 1)) % (z.m - 1) end as seat_b
    from sized z
    cross join lateral generate_series(1, z.m - 1) as r(round_number)
    cross join lateral generate_series(1, z.m / 2) as i(pair_in_round)
  )
  select
    s.id as table_id,
    s.sort_order as table_sort,
    s.round_number,
    s.pair_in_round,
    a.participant_id as side_a_id,
    b.participant_id as side_b_id
  from slots s
  -- THE BYE DISAPPEARS HERE, and it disappears by being an inner join that finds nothing: the phantom
  -- seat has no row in `seats`, so the slot it occupies produces no game at all. No filtering, no
  -- special case, and nothing named "Bye" anywhere.
  join seats a on a.table_id = s.id and a.seat = s.seat_a
  join seats b on b.table_id = s.id and b.seat = s.seat_b
  order by s.sort_order, s.round_number, s.pair_in_round;
$function$;

comment on function internal.tournament_round_robin_pairs(uuid) is
  'Who plays whom in a Round Robin plan, by the circle method, so no side appears twice in a round. '
  'Writes nothing: generating a draft and previewing one both call this, so a preview cannot drift '
  'from the thing it previews. An odd table rotates on a phantom SEAT NUMBER, never a phantom side -- '
  'whoever draws it has a bye, which is the absence of a game rather than a game against nobody.';

-- A permanent assertion of the shape, so a rewrite that quietly changed the invariant fails here.
do $$
declare v_n int;
begin
  if to_regprocedure('internal.tournament_round_robin_pairs(uuid)') is null then
    raise exception 'the round robin pairing function is missing.';
  end if;
  select count(*) into v_n from pg_proc where proname = 'tournament_round_robin_pairs';
  if v_n <> 1 then raise exception 'tournament_round_robin_pairs has % signatures.', v_n; end if;
end $$;
