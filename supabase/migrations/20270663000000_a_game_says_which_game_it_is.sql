-- A GAME SAYS WHICH GAME IT IS, IN THE COMPETITION'S OWN WORDS.
--
-- A result carried its ROUND NUMBER, which is what a round robin calls its games. A knockout does not
-- call anything "Round 1": it calls it the Quarter Final, and a parent reading "Round 1 · Pitch 2" on
-- the morning of a cup has been told the one thing that is not how anybody at the ground will describe
-- that game. The third-place play-off is not a round at all.
--
-- The naming authority already exists and is the bracket's own -- `internal.bracket_round_name`, which
-- `get_tournament_bracket` uses for the round headings. This puts the same sentence on the result, so
-- the draw, the results list and one result all name a game identically. A round robin's games get
-- NULL here and go on reading as a table and a round, which is correct for them.

-- ONE GAME, NOT THE ROUND IT IS IN. The bracket's column heading is "Quarter Finals" because it heads
-- four of them; a single game is a Quarter Final. The two differ by a letter and by nothing else, so
-- they are derived from the same case rather than by a client stripping an "s" off the other.
create or replace function internal.bracket_game_name(p_round integer, p_rounds integer)
returns text
language sql
immutable
as $function$
  select case p_rounds - p_round
    when 0 then 'Final'
    when 1 then 'Semi Final'
    when 2 then 'Quarter Final'
    else internal.bracket_round_name(p_round, p_rounds)
  end;
$function$;

create or replace function internal.tournament_game_round_label(
  p_plan_id uuid, p_round integer, p_is_third boolean
) returns text
language sql
stable
set search_path to ''
as $function$
  select case
    when coalesce(p_is_third, false) then 'Third-Place Play-Off'
    else internal.bracket_game_name(
      p_round,
      internal.bracket_rounds((select count(*)::int
                               from public.tournament_bracket_slots s
                               where s.plan_id = p_plan_id and s.round_number = 1 and not s.is_third_place)))
  end
  -- NOTHING TO SAY ABOUT A ROUND ROBIN. No bracket, no round name, and the caller keeps its own wording.
  where exists (select 1 from public.tournament_bracket_slots s where s.plan_id = p_plan_id);
$function$;

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
    'roundName', internal.tournament_game_round_label(g.plan_id, g.round_number, g.is_third_place),
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
    'roundName', internal.tournament_game_round_label(tg.plan_id, tg.round_number, tg.is_third_place),
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


-- THE NAME IS THE BRACKET'S OWN, so prove the two agree rather than trusting that they were written
-- from the same rule.
do $$
begin
  if internal.bracket_round_name(1, 3) <> 'Quarter Finals' then
    raise exception 'The bracket no longer calls the first round of an eight-place draw the Quarter Finals.';
  end if;
  if internal.bracket_game_name(1, 3) <> 'Quarter Final' then
    raise exception 'One game of that round is no longer called a Quarter Final.';
  end if;
  if internal.bracket_game_name(3, 3) <> 'Final' then
    raise exception 'The last game is no longer called the Final.';
  end if;
end $$;
