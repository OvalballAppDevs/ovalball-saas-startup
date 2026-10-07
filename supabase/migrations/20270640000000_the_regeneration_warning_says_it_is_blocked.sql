-- =====================================================================================================
-- THE REGENERATION WARNING SAYS IT IS BLOCKED.
--
-- `tournament_plan_regeneration_cost` feeds the confirmation an organiser reads before regenerating a
-- plan, and it told them that any recorded result "will be lost". That was true when it was written.
-- It is now false: `generate_tournament_plan_fixtures` refuses outright once any game has a result.
--
-- A WARNING THAT DESCRIBES THE WRONG OUTCOME IS WORSE THAN NONE. An organiser who reads "3 results will
-- be lost" and presses on expecting to lose three results instead gets an error they did not ask for
-- and cannot act on. So the read now carries whether regeneration is possible at all, and how much
-- stands in its way, and the screen states the refusal and the deliberate way past it BEFORE the button
-- is pressed.
-- =====================================================================================================

create or replace function public.tournament_plan_regeneration_cost(p_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid; v_state text; v_history record;
begin
  perform internal.require_live_session();
  select tournament_id, publication_state into v_tournament, v_state
  from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  -- THE SAME AUTHORITY THE GENERATOR ITSELF CONSULTS, so the warning and the refusal cannot disagree.
  select * into v_history from internal.tournament_plan_result_history(p_plan_id);

  return jsonb_build_object(
    'publicationState', v_state,
    'gameCount', (select count(*) from public.tournament_games where plan_id = p_plan_id),
    -- A GAME SOMEBODY HAS MOVED BY HAND is the one that makes regeneration expensive, so it is counted
    -- separately. Losing twelve machine-made pairings is nothing; losing the four an organiser spent
    -- the morning placing is the thing they need warning about.
    'placedCount', (select count(*) from public.tournament_games
                    where plan_id = p_plan_id and (start_time is not null or pitch_id is not null)),
    'recordedResultCount', v_history.games_with_results,
    'confirmedResultCount', v_history.confirmed,
    'resultSubmissionCount', v_history.submissions,
    -- WHETHER IT CAN HAPPEN AT ALL. Read from the history rather than restated, so this is the
    -- generator's own answer and not a second opinion about it.
    'blocked', (v_history.games_with_results > 0),
    'blockedReason', case when v_history.games_with_results > 0 then 'TOURNAMENT_PLAN_HAS_RESULTS' end
  );
end;
$function$;

comment on function public.tournament_plan_regeneration_cost(uuid) is
  'What regenerating a plan would cost, and whether it is possible at all. `blocked` comes from the '
  'same internal.tournament_plan_result_history the generator consults, so the warning an organiser '
  'reads and the refusal they would hit can never disagree.';
