-- =====================================================================================================
-- REGENERATION NEVER DESTROYS A RESULT.
--
-- `generate_tournament_plan_fixtures` begins by clearing the plan's games:
--
--     delete from public.tournament_games where plan_id = p_plan_id;
--
-- That was right while a draft was only ever machine-made pairings nobody had played. It stops being
-- right the moment somebody records a score. A regeneration would then delete the game, and the
-- `on delete cascade` would take every submission with it -- both sides' claims, the organiser's
-- resolution, the lot -- and the standings would quietly re-resolve as though the match had never been
-- played. No warning, no audit, nothing to recover from.
--
-- SO IT REFUSES, by name and by number. An organiser who genuinely needs to re-plan a competition that
-- has started is not blocked from doing anything they could legitimately do -- they can still change
-- days, tables, settings and pitches, and they can still correct any individual result. What they
-- cannot do is press one button and have the record of a played game disappear.
--
-- THE SAFE ROUTE OUT IS NAMED IN THE REFUSAL, because a guard that only says no teaches people to look
-- for a way round it. `clear_tournament_plan_results` exists for the organiser who really does want to
-- start again: it is explicit, it is their decision, and it says exactly how many games it is about to
-- clear before it does it.
-- =====================================================================================================

/** How much result history a plan is carrying, so a refusal or a confirmation can name it. */
create or replace function internal.tournament_plan_result_history(p_plan_id uuid)
returns table(games_with_results integer, confirmed integer, submissions integer)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    count(*) filter (where g.result_status <> 'none')::int,
    count(*) filter (where g.result_status = 'final')::int,
    coalesce((select count(*) from public.tournament_game_result_submissions s
              join public.tournament_games g2 on g2.id = s.game_id
              where g2.plan_id = p_plan_id), 0)::int
  from public.tournament_games g
  where g.plan_id = p_plan_id;
$function$;

do $$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'generate_tournament_plan_fixtures';
  if v_def is null then raise exception 'generate_tournament_plan_fixtures is missing.'; end if;
  if position('RESULT HISTORY IS NOT A DRAFT' in v_def) > 0 then return; end if;

  v_old := '  delete from public.tournament_games where plan_id = p_plan_id;';
  if position(v_old in v_def) = 0 then
    raise exception 'the generator does not clear its games in the shape this guard expects.';
  end if;

  v_new :=
    '  -- RESULT HISTORY IS NOT A DRAFT, and clearing it is not a planning operation. Anything anybody' || chr(10) ||
    '  -- has recorded a score for -- submitted, contested, agreed or settled by the organiser -- stops' || chr(10) ||
    '  -- this outright, because the delete below cascades to every submission on the game.' || chr(10) ||
    '  declare v_history record;' || chr(10) ||
    '  begin' || chr(10) ||
    '    select * into v_history from internal.tournament_plan_result_history(p_plan_id);' || chr(10) ||
    '    if v_history.games_with_results > 0 then' || chr(10) ||
    '      raise exception' || chr(10) ||
    '        ''% game(s) in this plan already have a result (% confirmed, % submission(s) recorded). Regenerating would delete them and everything both sides said about them. Change the days, tables or settings instead, or clear the results deliberately first.'',' || chr(10) ||
    '        v_history.games_with_results, v_history.confirmed, v_history.submissions' || chr(10) ||
    '        using errcode = ''22023'', hint = ''TOURNAMENT_PLAN_HAS_RESULTS'';' || chr(10) ||
    '    end if;' || chr(10) ||
    '  end;' || chr(10) ||
    '' || chr(10) ||
    v_old;

  execute replace(v_def, v_old, v_new);
end $$;

-- ---- and the deliberate way out ---------------------------------------------------------------------

create or replace function public.clear_tournament_plan_results(p_plan_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_tournament uuid; v_state text; v_history record; v_n int;
begin
  perform internal.require_live_session();
  select tournament_id, publication_state into v_tournament, v_state
  from public.tournament_plans where id = p_plan_id;
  if v_tournament is null then raise exception 'That plan does not exist.' using errcode = 'P0002'; end if;
  if not internal.can_manage_tournament(v_tournament) then
    raise exception 'Only the tournament organiser can clear results.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why the results are being cleared -- it is recorded against the tournament.'
      using errcode = '22023';
  end if;

  select * into v_history from internal.tournament_plan_result_history(p_plan_id);
  if v_history.games_with_results = 0 then return 0; end if;

  -- THE SUBMISSIONS ARE KEPT. Clearing a result means the GAME no longer has one; it does not mean
  -- nobody ever said anything. The audit trail stays, attributed and timestamped, and the organiser's
  -- reason is written into it so the record says why the scores went.
  insert into public.tournament_game_result_submissions
    (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
  select g.id, 'host_resolution', coalesce(g.side_a_score, 0), coalesce(g.side_b_score, 0), auth.uid(), null,
         'Results cleared by the organiser before re-planning: ' || trim(p_reason)
  from public.tournament_games g
  where g.plan_id = p_plan_id and g.result_status <> 'none';

  update public.tournament_games
  set result_status = 'none', side_a_score = null, side_b_score = null,
      result_submitted_by = null, result_submitted_by_participant_id = null, result_submitted_at = null,
      result_confirmed_by = null, result_confirmed_at = null,
      result_resolved_by = auth.uid(), result_resolved_at = now(),
      result_resolution_reason = 'Cleared before re-planning: ' || trim(p_reason),
      status = case when status = 'PLAYED' then 'SCHEDULED' else status end,
      updated_by = auth.uid(), updated_at = now()
  where plan_id = p_plan_id and result_status <> 'none';
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

comment on function public.clear_tournament_plan_results(uuid, text) is
  'The organiser deliberately clears every result in a plan so it can be re-planned, with a reason that '
  'is recorded. The submissions are KEPT: clearing means the games no longer have results, not that '
  'nobody ever said anything.';

revoke all on function public.clear_tournament_plan_results(uuid, text) from public, anon;
grant execute on function public.clear_tournament_plan_results(uuid, text) to authenticated, service_role;

-- ---- the guard is real -------------------------------------------------------------------------------

do $$
begin
  if (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'generate_tournament_plan_fixtures')
     !~ 'tournament_plan_result_history' then
    raise exception 'the regeneration guard is not in the generator.';
  end if;
end $$;
