-- =====================================================================================================
-- SUBMITTING, CONFIRMING, CONTESTING AND RESOLVING.
--
-- One function for the two sides and one for the host, following `submit_fixture_result` and
-- `resolve_fixture_result_dispute` -- the same shape, the same transitions, the same refusal to
-- overwrite what somebody said.
--
--     no result  --submit-->  awaiting confirmation  --matching--> FINAL
--                                                    --differing--> DISPUTED --host--> FINAL
--     FINAL      --submit-->  amendment pending                              --host--> FINAL
--
-- WHAT THE TRANSITIONS DELIBERATELY DO NOT DO:
--
--   * a side never confirms its OWN submission. Submitting again from the same side replaces that
--     side's proposal and nothing more -- it does not become agreement, because one club agreeing with
--     itself is not two clubs agreeing.
--   * a contest never overwrites the submission it disagrees with. The disagreement IS two rows, and
--     the host resolves it by reading both.
--   * a confirmed result is never silently changed. A later score is a PROPOSAL -- `amendment_pending`
--     -- and the standings keep using the confirmed one until somebody settles it.
--   * nothing here deletes anything, ever.
--
-- THE HOST IS THE FINAL AUTHORITY and their resolution is attributable: who, when, and why, recorded on
-- the game and again in the audit trail.
-- =====================================================================================================

create or replace function public.submit_tournament_game_result(
  p_game_id uuid,
  p_side_a_score integer,
  p_side_b_score integer,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  g public.tournament_games;
  v_side uuid;
  v_enabled boolean;
begin
  perform internal.require_live_session();

  if p_side_a_score is null or p_side_b_score is null or p_side_a_score < 0 or p_side_b_score < 0 then
    raise exception 'A score must be zero or a positive whole number.' using errcode = '22023';
  end if;

  select * into g from public.tournament_games where id = p_game_id for update;
  if g.id is null then raise exception 'That game does not exist.' using errcode = 'P0002'; end if;

  -- THE ORGANISER DECIDES WHETHER TEAMS SUBMIT AT ALL. When they do not, the host records results
  -- themselves through the resolution path, which is a deliberate setting rather than a missing one.
  select coalesce(t.results_submission_enabled, true) into v_enabled
  from public.tournaments t where t.id = g.tournament_id;
  if not v_enabled then
    raise exception 'The organiser has turned off result submission for this tournament.' using errcode = '42501';
  end if;

  v_side := internal.tournament_game_side_for_caller(p_game_id);
  if v_side is null then
    raise exception 'Only somebody who can record results for one of the two sides may submit this result.'
      using errcode = '42501';
  end if;

  if not internal.tournament_game_result_eligible(p_game_id) then
    if g.status = 'CANCELLED' then
      raise exception 'This game was cancelled, so it has no result.' using errcode = '22023';
    end if;
    raise exception 'This game has not kicked off yet.' using errcode = '22023';
  end if;

  -- ---- nothing recorded yet -------------------------------------------------------------------------
  if g.result_status = 'none' then
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'initial', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));

    update public.tournament_games
    set side_a_score = p_side_a_score, side_b_score = p_side_b_score,
        result_status = 'awaiting_confirmation',
        result_submitted_by = auth.uid(), result_submitted_by_participant_id = v_side,
        result_submitted_at = now(), updated_by = auth.uid(), updated_at = now()
    where id = p_game_id;

    perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_awaiting_confirmation',
      'Result awaiting your confirmation',
      'A result has been submitted for your tournament game. Confirm it, or say what you think the score was.');
    return jsonb_build_object('status', 'awaiting_confirmation');
  end if;

  -- ---- somebody has already submitted ---------------------------------------------------------------
  if g.result_status = 'awaiting_confirmation' then
    if v_side = g.result_submitted_by_participant_id then
      -- THE SAME SIDE CORRECTING ITSELF. A new proposal, not an agreement.
      insert into public.tournament_game_result_submissions
        (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
      values (p_game_id, 'initial', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
      update public.tournament_games
      set side_a_score = p_side_a_score, side_b_score = p_side_b_score,
          result_submitted_by = auth.uid(), result_submitted_at = now(),
          updated_by = auth.uid(), updated_at = now()
      where id = p_game_id;
      return jsonb_build_object('status', 'awaiting_confirmation');
    end if;

    if p_side_a_score = g.side_a_score and p_side_b_score = g.side_b_score then
      insert into public.tournament_game_result_submissions
        (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
      values (p_game_id, 'confirmation', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
      update public.tournament_games
      set result_status = 'final', result_confirmed_by = auth.uid(), result_confirmed_at = now(),
          status = 'PLAYED', updated_by = auth.uid(), updated_at = now()
      where id = p_game_id;
      perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_confirmed',
        'Result confirmed', 'Both sides agree the score, so it now counts towards the table.');
      return jsonb_build_object('status', 'final');
    end if;

    -- A CONTEST. The original submission is untouched; this is a second row saying something else.
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'dispute', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
    update public.tournament_games
    set result_status = 'disputed', updated_by = auth.uid(), updated_at = now()
    where id = p_game_id;
    perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_contested',
      'Result contested', 'The two sides have given different scores. The organiser will settle it.');
    return jsonb_build_object('status', 'disputed');
  end if;

  -- ---- already settled, or already in dispute -------------------------------------------------------
  if g.result_status = 'disputed' then
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'dispute', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
    return jsonb_build_object('status', 'disputed');
  end if;

  if g.result_status in ('final', 'amendment_pending') then
    if p_side_a_score = g.side_a_score and p_side_b_score = g.side_b_score and g.result_status = 'final' then
      return jsonb_build_object('status', 'final');
    end if;
    -- A CORRECTION AFTER AGREEMENT IS A PROPOSAL. The confirmed score stays canonical, and the table
    -- stays as it is, until the organiser settles it.
    insert into public.tournament_game_result_submissions
      (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
    values (p_game_id, 'amendment_proposal', p_side_a_score, p_side_b_score, auth.uid(), v_side, nullif(trim(p_note), ''));
    update public.tournament_games
    set result_status = 'amendment_pending', updated_by = auth.uid(), updated_at = now()
    where id = p_game_id;
    perform internal.notify_tournament_result(p_game_id, v_side, 'tournament_result_contested',
      'A change to a confirmed result', 'A side has proposed a different score for a game that was already agreed.');
    return jsonb_build_object('status', 'amendment_pending');
  end if;

  raise exception 'This result cannot be submitted in its current state (%).', g.result_status using errcode = '22023';
end;
$function$;

comment on function public.submit_tournament_game_result(uuid, integer, integer, text) is
  'One side records, confirms or contests the score of its own tournament game. A matching score from '
  'the other side confirms it; a different one contests it without overwriting anything. Mirrors '
  'public.submit_fixture_result.';

-- ---- the host settles it ----------------------------------------------------------------------------

create or replace function public.resolve_tournament_game_result(
  p_game_id uuid,
  p_side_a_score integer,
  p_side_b_score integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.tournament_games;
begin
  perform internal.require_live_session();
  if p_side_a_score is null or p_side_b_score is null or p_side_a_score < 0 or p_side_b_score < 0 then
    raise exception 'A score must be zero or a positive whole number.' using errcode = '22023';
  end if;

  select * into g from public.tournament_games where id = p_game_id for update;
  if g.id is null then raise exception 'That game does not exist.' using errcode = 'P0002'; end if;

  if not internal.can_resolve_tournament_result(p_game_id) then
    raise exception 'Only the tournament organiser can settle a result.' using errcode = '42501';
  end if;
  if g.status = 'CANCELLED' then
    raise exception 'This game was cancelled, so it has no result.' using errcode = '22023';
  end if;

  -- ATTRIBUTABLE, AND ADDITIVE. The resolution is a row of its own; nothing already said is altered.
  insert into public.tournament_game_result_submissions
    (game_id, kind, side_a_score, side_b_score, submitted_by, submitted_by_participant_id, note)
  values (p_game_id, 'host_resolution', p_side_a_score, p_side_b_score, auth.uid(), null, nullif(trim(p_reason), ''));

  update public.tournament_games
  set side_a_score = p_side_a_score, side_b_score = p_side_b_score,
      result_status = 'final', status = 'PLAYED',
      result_confirmed_by = auth.uid(), result_confirmed_at = now(),
      result_resolved_by = auth.uid(), result_resolved_at = now(),
      result_resolution_reason = nullif(trim(p_reason), ''),
      updated_by = auth.uid(), updated_at = now()
  where id = p_game_id;

  perform internal.notify_tournament_result(p_game_id, null, 'tournament_result_resolved',
    'The organiser settled a result', 'The organiser has set the final score for a tournament game.');
  return jsonb_build_object('status', 'final');
end;
$function$;

comment on function public.resolve_tournament_game_result(uuid, integer, integer, text) is
  'The tournament organiser sets the canonical score for one of their games -- settling a contest, '
  'recording a game for sides that are not on Ovalball, or correcting an agreed result. Attributable, '
  'and never destructive: the resolution is appended to the audit trail.';

revoke all on function public.submit_tournament_game_result(uuid, integer, integer, text) from public, anon;
revoke all on function public.resolve_tournament_game_result(uuid, integer, integer, text) from public, anon;
grant execute on function public.submit_tournament_game_result(uuid, integer, integer, text) to authenticated, service_role;
grant execute on function public.resolve_tournament_game_result(uuid, integer, integer, text) to authenticated, service_role;
