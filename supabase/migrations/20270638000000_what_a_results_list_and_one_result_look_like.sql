-- =====================================================================================================
-- WHAT A RESULTS LIST AND ONE RESULT LOOK LIKE.
--
-- Two reads that DO carry unsettled scores, and therefore two reads that decide for themselves who is
-- asking. The standings read refuses to return anything unsettled precisely so that these can, under a
-- permission check neither of them delegates to a client.
--
-- ---- WHO SEES WHICH GAMES ------------------------------------------------------------------------
--
--   THE ORGANISER   every game in the competition, in every state. Settling disagreements is their job
--                   and they cannot do it from a filtered list.
--   A SIDE          its own games only. A club has no business reading what two other clubs are
--                   arguing about, and `sideFilterApplied` says in the payload that the list was cut
--                   server-side rather than leaving a client to wonder why it is short.
--   ANYBODY ELSE    nothing. Not an empty list of games they could have seen: nothing.
--
-- ---- NEEDS ATTENTION IS COMPUTED, NOT STORED -----------------------------------------------------
--
-- A game needs somebody's attention when a human has to act, and who it needs depends on who asks:
--
--   for the ORGANISER   a contest, a proposed change to an agreed score, or a game that kicked off and
--                       still has no result at all.
--   for a SIDE          a score the OTHER side submitted and this side has not answered, or a game of
--                       theirs that kicked off with no result.
--
-- A side's own submission sitting with the opposition is NOT their attention -- they have done their
-- part -- and showing it as outstanding work is how a list of real tasks turns into noise people learn
-- to ignore.
-- =====================================================================================================

/**
 * ONE SIDE, THE WAY EVERY TOURNAMENT SURFACE ALREADY DRAWS ONE.
 *
 * Planning, the draft plan and the participant Agenda all build this same object inline. Results and
 * Tables need it too, and a fourth copy is a fourth thing to forget to change -- so it becomes a
 * function, and the migration proves it returns exactly what the existing surfaces build.
 */
create or replace function internal.tournament_side_summary(p_participant_id uuid, p_host_club_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_build_object(
    'participantId', tp.id,
    'clubName', cd.name,
    'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id),
                          cd.logo_storage_path),
    'label', coalesce(tm.display_name,
                      case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label
                           else tp.age_group end),
    'isHost', (tp.club_id is not null and tp.club_id = p_host_club_id),
    'onOvalball', (tp.status <> 'external_recorded')
  )
  from public.tournament_participants tp
  join public.club_directory cd on cd.id = tp.club_directory_id
  left join public.teams tm on tm.id = tp.team_id
  where tp.id = p_participant_id;
$function$;

comment on function internal.tournament_side_summary(uuid, uuid) is
  'One tournament side as every tournament surface draws it -- club name, crest, canonical team label, '
  'whether it is the host and whether it is on Ovalball. The one shape, so Results and Tables cannot '
  'drift from Planning and the Agenda.';

-- It returns what the existing surfaces build, for every side that exists.
do $$
declare v_mismatch integer;
begin
  select count(*) into v_mismatch
  from public.tournament_participants tp
  join public.club_directory cd on cd.id = tp.club_directory_id
  join public.tournaments t on t.id = tp.tournament_id
  left join public.teams tm on tm.id = tp.team_id
  where internal.tournament_side_summary(tp.id, t.host_club_id) is distinct from jsonb_build_object(
    'participantId', tp.id,
    'clubName', cd.name,
    'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),
    'label', coalesce(tm.display_name, case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label else tp.age_group end),
    'isHost', (tp.club_id is not null and tp.club_id = t.host_club_id),
    'onOvalball', (tp.status <> 'external_recorded')
  );
  if v_mismatch > 0 then
    raise exception 'tournament_side_summary disagrees with the shape the existing surfaces build, for % side(s).', v_mismatch;
  end if;
end $$;

/**
 * DOES THIS GAME NEED SOMEBODY'S ATTENTION -- and whose.
 *
 * ONE DEFINITION, used by the filter and by the count and by the flag on each row, because a tab that
 * says 3 and a list that shows 4 is worse than no tab at all.
 *
 * `p_sides` is the set of sides the asker may record results for. For the organiser it is irrelevant;
 * for a side it is what makes "the other side submitted this" answerable.
 */
create or replace function internal.tournament_result_needs_attention(
  p_game_id uuid,
  p_is_host boolean,
  p_sides uuid[]
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when g.id is null then false
    when p_is_host then
      -- A disagreement to settle, a proposed change to rule on, or a game that has been played and
      -- whose result nobody has recorded at all.
      g.result_status in ('disputed', 'amendment_pending')
      or (g.result_status = 'none' and internal.tournament_game_result_eligible(g.id))
    else
      -- A game of theirs with no result yet, or one where the OTHER side has submitted and they have
      -- not answered. Their own submission waiting with the opposition is not their task.
      (g.result_status = 'none' and internal.tournament_game_result_eligible(g.id))
      or (g.result_status = 'awaiting_confirmation'
          and not (g.result_submitted_by_participant_id = any (coalesce(p_sides, '{}'::uuid[]))))
      or g.result_status in ('disputed', 'amendment_pending')
  end
  from public.tournament_games g
  where g.id = p_game_id;
$function$;

comment on function internal.tournament_result_needs_attention(uuid, boolean, uuid[]) is
  'Whether a tournament game needs the asker to act -- the organiser settles contests and chases '
  'unrecorded results; a side answers the opposition. The one definition, so the Needs Attention count '
  'and the Needs Attention list can never disagree.';

-- ---- the list ----------------------------------------------------------------------------------------

create or replace function public.get_tournament_results_overview(
  p_tournament_id uuid,
  p_age_group text,
  p_filter text default 'all'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
    'confirmed', count(*) filter (where tg.result_status = 'final')
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
    'submittedBySideName', (select coalesce(tm.display_name, cd.name)
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
          when 'confirmed' then tg.result_status = 'final'
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

comment on function public.get_tournament_results_overview(uuid, text, text) is
  'Every tournament game the caller is entitled to see the result state of -- all of them for the '
  'organiser, their own for a participating side, none for anybody else. Carries unsettled scores, so '
  'the entitlement is resolved here and never by the client.';

-- ---- one game, in full -------------------------------------------------------------------------------

/**
 * ONE GAME'S RESULT, with everything a human needs to decide what to do about it.
 *
 * THE SUBMISSION TRAIL IS THE POINT. A contest is two claims and the reason somebody gave, and an
 * organiser settling it has to read both -- so the trail comes back whole and attributed rather than
 * flattened into the word "disputed".
 *
 * WHAT THE CALLER MAY DO comes back with it, resolved by the same authorities the write path uses, so a
 * screen never has to guess at a button's state -- and a disabled button is never the only thing
 * stopping an action.
 */
create or replace function public.get_tournament_game_result(p_game_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
        'bySideName', (select coalesce(tm.display_name, cd.name)
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

comment on function public.get_tournament_game_result(uuid) is
  'One tournament game''s result in full -- state, both claims, every note and who said what -- for the '
  'two sides and the organiser only. Carries what the caller may do, resolved by the same authorities '
  'the write path enforces.';

revoke all on function public.get_tournament_results_overview(uuid, text, text) from public, anon;
revoke all on function public.get_tournament_game_result(uuid) from public, anon;
grant execute on function public.get_tournament_results_overview(uuid, text, text) to authenticated, service_role;
grant execute on function public.get_tournament_game_result(uuid) to authenticated, service_role;
