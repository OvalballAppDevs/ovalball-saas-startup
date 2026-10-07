-- =====================================================================================================
-- A TABLE IS CALCULATED, NEVER KEPT.
--
-- Standings are a PROJECTION of the confirmed results in a table, resolved every time they are read.
-- Nothing is stored: there is no standings row to go stale, no recalculation job to forget to run, and
-- no way for a table to disagree with the games underneath it. Ovalball already does exactly this for
-- team form (`public.team_result_stats`, a view over fixtures whose result is final), and this is that
-- pattern applied to a tournament table.
--
-- ONLY A CONFIRMED RESULT COUNTS. `result_status = 'final'`. A submitted score awaiting the other
-- side, a contested one, and a proposed change to an agreed one all count for nothing -- which is the
-- whole reason the lifecycle exists. A cancelled game counts for nothing either.
--
-- ---- WHAT THE POINTS ARE, AND THE ONE GAP --------------------------------------------------------
--
-- Planning already captures the scoring system, and it is the authority here: `points_win`,
-- `points_draw`, `points_loss`, `points_try_bonus`, `points_losing_bonus`.
--
-- Four of those five can be resolved from a confirmed score:
--
--   win / draw / loss      directly.
--   LOSING BONUS           the margin, against a threshold -- which did NOT exist as configuration and
--                          is added here as `losing_bonus_margin`, defaulting to 7, the RFU's own
--                          figure. It was previously an invisible assumption, which is exactly what
--                          this phase was told not to leave buried.
--
-- The fifth cannot:
--
--   TRY BONUS              needs TRIES SCORED, and no Ovalball surface records tries for any game --
--                          not a fixture, not a competition match, not a tournament game. A score of
--                          24 might be four tries and two conversions or three tries, two conversions
--                          and three penalties, and nothing in the database can tell the difference.
--
-- So the try bonus is NOT APPLIED, and that is stated rather than silently approximated. Awarding it
-- on a guess -- "four converted tries' worth of points" -- would put a point on a table that nobody
-- scored. `points_try_bonus` stays configurable because it is part of the competition the organiser
-- described; applying it needs per-game tries, which is a product decision and a data model this phase
-- was told not to invent.
-- =====================================================================================================

alter table public.tournament_plans
  add column if not exists losing_bonus_margin integer not null default 7,
  add column if not exists tie_breakers text[] not null
    default array['points_difference', 'points_for', 'head_to_head', 'wins']::text[];

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_plans_losing_bonus_margin_check') then
    alter table public.tournament_plans add constraint tournament_plans_losing_bonus_margin_check
      check (losing_bonus_margin >= 0 and losing_bonus_margin <= 100);
  end if;
  -- EVERY CRITERION IS ONE THIS CODE CAN ACTUALLY RESOLVE. A tie-break nobody implements is a table
  -- that orders itself by something invisible.
  if not exists (select 1 from pg_constraint where conname = 'tournament_plans_tie_breakers_check') then
    alter table public.tournament_plans add constraint tournament_plans_tie_breakers_check
      check (tie_breakers <@ array['points_difference', 'points_for', 'points_against', 'head_to_head', 'wins']::text[]);
  end if;
end $$;

comment on column public.tournament_plans.losing_bonus_margin is
  'How close a defeat has to be to earn the losing bonus, in points. 7 by default -- the RFU figure. '
  'Was an invisible assumption before: the bonus VALUE was configurable and the threshold was not.';

comment on column public.tournament_plans.tie_breakers is
  'The organiser''s own order of tie-break criteria, applied after competition points. Ovalball has no '
  'canonical sporting tie-break, so this is explicit configuration rather than a hidden default. A '
  'stable neutral fallback decides the last case without claiming anybody is superior.';

-- ---- the projection ----------------------------------------------------------------------------------

/**
 * ONE TABLE'S STANDINGS, resolved from its own confirmed games.
 *
 * A FUNCTION rather than a view, because the scoring system is the PLAN'S -- win, draw and loss points
 * and the losing-bonus threshold all vary per competition -- so the arithmetic cannot be a constant
 * expression over a join. It is still a projection: it stores nothing and is computed on every read.
 *
 * MEMBERSHIP COMES FROM THE PUBLISHED PLAN, not from the results. A side that has played nothing is in
 * its table on zero, which is what a table looks like before a festival starts; and a result can never
 * move a side between tables, because the left-hand side of this query is the plan.
 *
 * THE DAYS DO NOT DIVIDE IT. A competition playing Friday and Sunday has ONE table: every confirmed
 * game in it counts once, whichever of its days it was played on.
 */
create or replace function internal.tournament_table_standings(p_table_id uuid)
returns table(
  participant_id uuid,
  played integer,
  won integer,
  drawn integer,
  lost integer,
  points_for integer,
  points_against integer,
  points_difference integer,
  competition_points integer
)
language sql
stable
security definer
set search_path to ''
as $function$
  with plan as (
    select p.points_win, p.points_draw, p.points_loss, p.points_losing_bonus, p.losing_bonus_margin
    from public.tournament_plan_tables t
    join public.tournament_plans p on p.id = t.plan_id
    where t.id = p_table_id
  ),
  members as (
    select s.participant_id from public.tournament_plan_table_sides s where s.table_id = p_table_id
  ),
  -- ONE ROW PER SIDE PER CONFIRMED GAME, from that side's own point of view.
  sides as (
    select g.side_a_id as participant_id, g.side_a_score as scored, g.side_b_score as conceded
    from public.tournament_games g
    where g.table_id = p_table_id and g.result_status = 'final' and g.status <> 'CANCELLED'
      and g.side_a_score is not null and g.side_b_score is not null
    union all
    select g.side_b_id, g.side_b_score, g.side_a_score
    from public.tournament_games g
    where g.table_id = p_table_id and g.result_status = 'final' and g.status <> 'CANCELLED'
      and g.side_a_score is not null and g.side_b_score is not null
  )
  select
    m.participant_id,
    count(s.participant_id)::int as played,
    count(*) filter (where s.scored > s.conceded)::int as won,
    count(*) filter (where s.scored = s.conceded)::int as drawn,
    count(*) filter (where s.scored < s.conceded)::int as lost,
    coalesce(sum(s.scored), 0)::int as points_for,
    coalesce(sum(s.conceded), 0)::int as points_against,
    coalesce(sum(s.scored) - sum(s.conceded), 0)::int as points_difference,
    (
      count(*) filter (where s.scored > s.conceded) * (select points_win from plan)
      + count(*) filter (where s.scored = s.conceded) * (select points_draw from plan)
      + count(*) filter (where s.scored < s.conceded) * (select points_loss from plan)
      -- THE LOSING BONUS, from the margin and the configured threshold. The try bonus is not here, and
      -- the comment at the head of this file says why.
      + count(*) filter (
          where s.scored < s.conceded
            and (s.conceded - s.scored) <= (select losing_bonus_margin from plan)
        ) * (select points_losing_bonus from plan)
    )::int as competition_points
  from members m
  left join sides s on s.participant_id = m.participant_id
  group by m.participant_id;
$function$;

comment on function internal.tournament_table_standings(uuid) is
  'One table''s standings, calculated from its CONFIRMED results and the plan''s own points system. '
  'Stores nothing. Membership comes from the published plan, so a result can never move a side between '
  'tables, and a side that has played nothing appears on zero.';

/**
 * HEAD TO HEAD, between two sides in one table.
 *
 * Only the games they played against EACH OTHER, and only confirmed ones. Returns the first side's
 * advantage: positive if it did better, negative if worse, zero if they are level or never met.
 */
create or replace function internal.tournament_head_to_head(p_table_id uuid, p_a uuid, p_b uuid)
returns integer
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(sum(
    case when g.side_a_id = p_a then g.side_a_score - g.side_b_score
         else g.side_b_score - g.side_a_score end
  ), 0)::int
  from public.tournament_games g
  where g.table_id = p_table_id and g.result_status = 'final' and g.status <> 'CANCELLED'
    and g.side_a_score is not null and g.side_b_score is not null
    and ((g.side_a_id = p_a and g.side_b_id = p_b) or (g.side_a_id = p_b and g.side_b_id = p_a));
$function$;
