-- =====================================================================================================
-- A SCORING RULE THAT CANNOT BE APPLIED IS NOT OFFERED.
--
-- Planning's Table Points card offered five numbers as though all five decided a table. Four of them
-- do. The TRY BONUS does not, and cannot: awarding it needs TRIES SCORED, and no Ovalball surface
-- records tries for any game -- not a fixture, not a competition match, not a tournament game. A score
-- of 24 might be four tries and two conversions, or three tries, two conversions and three penalties,
-- and nothing in the database can tell the difference. Inferring it from the points would put a point
-- on a table that nobody scored.
--
-- SO IT IS NOT SILENTLY IGNORED, AND IT IS NOT SILENTLY APPLIED. The column stays, because it is part
-- of the competition an organiser described and deleting it would lose what they said. What changes is
-- that it is no longer PRESENTED as an active rule: the server reports it as unavailable with the
-- reason, the Planning control is disabled against that reason, and the table prints the same sentence
-- under itself. A number a club typed and the app quietly dropped is the worst of the three outcomes.
--
-- ---- AND THE TWO THAT DO DECIDE A TABLE BECOME SETTABLE ------------------------------------------
--
-- `losing_bonus_margin` and `tie_breakers` were added with the standings and had no way to be changed.
-- A default nobody can alter is a hidden rule with extra steps, and the whole reason tie-breakers are
-- configuration is that Ovalball has no canonical sporting tie-break to impose. Both join the one
-- settings RPC.
--
-- THE OLD SIGNATURE IS DROPPED, NOT REPLACED AROUND. `create or replace` with new trailing defaulted
-- parameters creates a SECOND overload, and because both carry defaults every existing positional
-- caller then fails with "function ... is not unique". That has happened on this estate before --
-- `tournament_cover`'s suite asserts against it by name -- so the old signature goes first.
-- =====================================================================================================

drop function if exists public.set_tournament_plan_settings(uuid, integer, integer, time, time, integer, integer, integer, integer, integer);

create or replace function public.set_tournament_plan_settings(
  p_plan_id uuid,
  p_game_duration_minutes integer default null,
  p_changeover_minutes integer default null,
  p_day_start_time time default null,
  p_day_end_time time default null,
  p_points_win integer default null,
  p_points_draw integer default null,
  p_points_loss integer default null,
  p_points_try_bonus integer default null,
  p_points_losing_bonus integer default null,
  p_losing_bonus_margin integer default null,
  p_tie_breakers text[] default null
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

  -- THE GAME LENGTH IS NOT VALIDATED HERE, DELIBERATELY. Player welfare is enforced by a TRIGGER on
  -- tournament_plans (20270617), so it holds for every writer rather than for this one -- and the first
  -- draft of this migration re-implemented the check in the RPC, which both duplicated the rule and
  -- shadowed the trigger's own message. The suite caught it. The rule stays where it was.

  if p_losing_bonus_margin is not null and (p_losing_bonus_margin < 0 or p_losing_bonus_margin > 100) then
    raise exception 'A losing-bonus margin is between 0 and 100 points.' using errcode = '22023';
  end if;

  -- EVERY CRITERION MUST BE ONE THE ORDERING CAN ACTUALLY RESOLVE. A tie-break nobody implements is a
  -- table that orders itself by something invisible, which is the thing this configuration exists to
  -- prevent. Duplicates are refused too: a criterion applied twice says nothing the first did not.
  if p_tie_breakers is not null then
    if exists (
      select 1 from unnest(p_tie_breakers) t(k)
      where k not in ('points_difference', 'points_for', 'points_against', 'head_to_head', 'wins')
    ) then
      raise exception 'That is not a tie-break Ovalball can resolve.' using errcode = '22023';
    end if;
    if (select count(distinct k) from unnest(p_tie_breakers) t(k)) <> cardinality(p_tie_breakers) then
      raise exception 'A tie-break may only appear once.' using errcode = '22023';
    end if;
  end if;

  update public.tournament_plans
  set game_duration_minutes = coalesce(p_game_duration_minutes, game_duration_minutes),
      changeover_minutes = coalesce(p_changeover_minutes, changeover_minutes),
      day_start_time = coalesce(p_day_start_time, day_start_time),
      day_end_time = coalesce(p_day_end_time, day_end_time),
      points_win = coalesce(p_points_win, points_win),
      points_draw = coalesce(p_points_draw, points_draw),
      points_loss = coalesce(p_points_loss, points_loss),
      points_try_bonus = coalesce(p_points_try_bonus, points_try_bonus),
      points_losing_bonus = coalesce(p_points_losing_bonus, points_losing_bonus),
      losing_bonus_margin = coalesce(p_losing_bonus_margin, losing_bonus_margin),
      tie_breakers = coalesce(p_tie_breakers, tie_breakers),
      updated_by = auth.uid(), updated_at = now()
  where id = p_plan_id;
end;
$function$;

revoke all on function public.set_tournament_plan_settings(uuid, integer, integer, time, time, integer, integer, integer, integer, integer, integer, text[]) from public, anon;
grant execute on function public.set_tournament_plan_settings(uuid, integer, integer, time, time, integer, integer, integer, integer, integer, integer, text[]) to authenticated, service_role;

-- EXACTLY ONE SIGNATURE. The defect this guards against is specific and has happened: two overloads
-- both carrying defaults make every positional call ambiguous.
do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_tournament_plan_settings') <> 1 then
    raise exception 'set_tournament_plan_settings has more than one signature.';
  end if;
end $$;

-- ---- what the organiser is told about each rule --------------------------------------------------

/**
 * THE SCORING RULES, AND WHETHER OVALBALL CAN ACTUALLY APPLY EACH ONE.
 *
 * The server answers this rather than the client, because "can this be calculated" is a fact about the
 * data model and not about a screen -- and the day tries ARE recorded, the try bonus must become live
 * everywhere at once rather than wherever somebody remembers to delete a hardcoded `disabled`.
 */
create or replace function internal.tournament_scoring_rules(p_plan_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'win', jsonb_build_object('value', p.points_win, 'available', true),
    'draw', jsonb_build_object('value', p.points_draw, 'available', true),
    'loss', jsonb_build_object('value', p.points_loss, 'available', true),
    'losingBonus', jsonb_build_object('value', p.points_losing_bonus, 'available', true,
                                      'margin', p.losing_bonus_margin),
    'tryBonus', jsonb_build_object(
      'value', p.points_try_bonus,
      -- NOT AVAILABLE, AND THE REASON TRAVELS WITH THE ANSWER so a screen cannot invent a vaguer one.
      'available', false,
      'unavailableReason', 'Requires try recording — not currently available')
  )
  from public.tournament_plans p where p.id = p_plan_id;
$function$;

comment on function internal.tournament_scoring_rules(uuid) is
  'Each of a plan''s scoring rules with whether Ovalball can apply it. The try bonus is unavailable '
  'because no surface records tries; the reason is carried so no screen has to invent one, and the day '
  'tries are recorded it becomes live everywhere at once.';

-- ---- and the planning read carries it ------------------------------------------------------------

do $$
declare v_def text; v_old text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_tournament_plan';
  if v_def is null then raise exception 'get_tournament_plan is missing.'; end if;
  if position('scoringRules' in v_def) > 0 then return; end if;

  v_old := '    ''sides'', coalesce((';
  if position(v_old in v_def) = 0 then
    raise exception 'get_tournament_plan does not carry its sides where this migration expects.';
  end if;

  execute replace(v_def, v_old,
    '    -- WHICH SCORING RULES CAN ACTUALLY BE APPLIED, and why not where they cannot. Planning draws' || chr(10) ||
    '    -- its controls from this rather than deciding on the device.' || chr(10) ||
    '    ''scoringRules'', case when v_plan.id is not null then internal.tournament_scoring_rules(v_plan.id) end,' || chr(10) ||
    '    ''losingBonusMargin'', v_plan.losing_bonus_margin,' || chr(10) ||
    '    ''tieBreakers'', to_jsonb(v_plan.tie_breakers),' || chr(10) ||
    v_old);
end $$;

do $$
begin
  if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_tournament_plan') not like '%scoringRules%' then
    raise exception 'the planning read does not say which scoring rules can be applied.';
  end if;
end $$;
