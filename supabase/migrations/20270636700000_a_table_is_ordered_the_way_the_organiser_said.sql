-- =====================================================================================================
-- A TABLE IS ORDERED THE WAY THE ORGANISER SAID.
--
-- Competition points first. Then the organiser's own criteria, IN THEIR OWN ORDER, from
-- `tournament_plans.tie_breakers`. Then a stable neutral fallback.
--
-- ---- WHY THIS IS A FUNCTION AND NOT AN `ORDER BY` ------------------------------------------------
--
-- Four of the five criteria are a number per side and could be columns in an order clause. HEAD TO HEAD
-- is not: it is only defined BETWEEN sides, and which sides it compares depends on the criteria ordered
-- before it. Two clubs level on points and points difference are separated by how they did against each
-- other; a third club three points behind is irrelevant to that comparison and must not be dragged
-- into it.
--
-- So the ordering is built in three parts:
--
--   1. the criteria configured BEFORE head-to-head, as a comparable key;
--   2. head-to-head WITHIN each group of sides identical on that key -- a mini-table of exactly the
--      sides that are genuinely level;
--   3. the criteria configured after it.
--
-- Criteria are normalised so higher always wins, which is why points against is negated: conceding
-- fewer is better, and an order clause should not have to remember that.
--
-- WHEN HEAD TO HEAD IS NOT CONFIGURED IT CONTRIBUTES NOTHING -- not "nothing much", nothing: every side
-- scores zero, so the term cannot move anybody. A criterion the organiser did not choose must not order
-- their table.
--
-- ---- AND THE LAST CASE ---------------------------------------------------------------------------
--
-- When every configured criterion is level, the side's own name and then its id. That makes the order
-- TOTAL, so the same table read twice reads the same way, and it makes no sporting claim: two sides
-- genuinely level are shown level.
-- =====================================================================================================

create or replace function internal.tournament_table_ordered(p_table_id uuid)
returns table(
  table_position integer,
  participant_id uuid,
  played integer,
  won integer,
  drawn integer,
  lost integer,
  points_for integer,
  points_against integer,
  points_difference integer,
  competition_points integer,
  h2h_advantage integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  with plan as (
    select p.tie_breakers
    from public.tournament_plan_tables t
    join public.tournament_plans p on p.id = t.plan_id
    where t.id = p_table_id
  ),
  crit as (
    select c.key::text as key, c.ord::int as ord
    from plan, unnest(plan.tie_breakers) with ordinality as c(key, ord)
  ),
  -- Where head-to-head sits in the organiser's order. Absent, and everything else is "before" it.
  h2h_at as (
    select coalesce((select min(ord) from crit where key = 'head_to_head'), 2147483647) as ord,
           exists (select 1 from crit where key = 'head_to_head') as configured
  ),
  s as (select * from internal.tournament_table_standings(p_table_id)),
  keyed as (
    select
      s.*,
      coalesce((
        select array_agg(
                 case c.key
                   when 'points_difference' then s.points_difference
                   when 'points_for' then s.points_for
                   when 'points_against' then -s.points_against
                   when 'wins' then s.won
                 end::numeric order by c.ord)
        from crit c, h2h_at h
        where c.key <> 'head_to_head' and c.ord < h.ord
      ), '{}'::numeric[]) as pre_key,
      coalesce((
        select array_agg(
                 case c.key
                   when 'points_difference' then s.points_difference
                   when 'points_for' then s.points_for
                   when 'points_against' then -s.points_against
                   when 'wins' then s.won
                 end::numeric order by c.ord)
        from crit c, h2h_at h
        where c.key <> 'head_to_head' and c.ord > h.ord
      ), '{}'::numeric[]) as post_key
    from s
  ),
  -- THE MINI-TABLE. Only the sides identical on competition points and on every criterion ordered
  -- before head-to-head, and only the games they played against each other.
  settled as (
    select
      k.*,
      coalesce((
        select sum(internal.tournament_head_to_head(p_table_id, k.participant_id, o.participant_id))
        from keyed o, h2h_at h
        where h.configured
          and o.participant_id <> k.participant_id
          and o.competition_points = k.competition_points
          and o.pre_key = k.pre_key
      ), 0)::int as h2h_advantage
    from keyed k
  )
  select
    row_number() over (
      order by
        g.competition_points desc,
        g.pre_key desc,
        g.h2h_advantage desc,
        g.post_key desc,
        -- THE STABLE NEUTRAL FALLBACK.
        coalesce(tm.display_name, cd.name),
        g.participant_id
    )::int,
    g.participant_id, g.played, g.won, g.drawn, g.lost,
    g.points_for, g.points_against, g.points_difference, g.competition_points, g.h2h_advantage
  from settled g
  join public.tournament_participants tp on tp.id = g.participant_id
  join public.club_directory cd on cd.id = tp.club_directory_id
  left join public.teams tm on tm.id = tp.team_id;
$function$;

comment on function internal.tournament_table_ordered(uuid) is
  'One table''s standings in order: competition points, then the organiser''s own tie-breakers in their '
  'own order, then a stable neutral fallback. Head-to-head is resolved inside each group of sides that '
  'are genuinely level, and contributes nothing when the organiser did not configure it.';
