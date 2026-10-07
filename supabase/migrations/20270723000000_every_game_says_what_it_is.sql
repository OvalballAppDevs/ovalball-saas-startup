-- EVERY GAME SAYS WHAT IT IS, AND WHETHER IT COUNTS TOWARDS A TABLE (Tournament Planning parity
-- programme, phases 11 and 18).
--
-- The screens named a game's place in its competition from `roundName`, which only a knockout has, so
-- every other format fell back to "Round 2" and to "counts towards the table" -- including a Tri-Fixture
-- that keeps no table, and a Swiss or Hybrid competition where "Round 2" is not the whole truth. One
-- server helper now names every game the way an organiser would ("Table A · Round 2", "Quarter Final",
-- "Tri-Fixture · Game 2", "Swiss · Round 3", "Group Stage · Table B · Round 1"), and says whether its
-- result moves a table, from the same rule the Tables tab follows. The three reads that describe a game
-- carry both.

create or replace function internal.tournament_game_stage_label(p_plan_id uuid, p_round integer, p_is_third boolean, p_table_id uuid)
returns text
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v_format text; v_table text; v_ko text;
begin
  v_format := internal.tournament_plan_format(p_plan_id);
  select name into v_table from public.tournament_plan_tables where id = p_table_id;
  v_ko := internal.tournament_game_round_label(p_plan_id, p_round, p_is_third);
  return case
    when v_format = 'knockout' then v_ko
    when v_format = 'tri_fixture' then 'Tri-Fixture · Game ' || coalesce(p_round, 1)
    when v_format = 'swiss' then 'Swiss · Round ' || coalesce(p_round, 1)
    when v_format = 'hybrid' and p_table_id is null then coalesce(v_ko, 'Knockout Stage')
    when v_format = 'hybrid' then 'Group Stage · ' || coalesce(v_table, 'Table') || ' · Round ' || coalesce(p_round, 1)
    else concat_ws(' · ', v_table, 'Round ' || coalesce(p_round, 1))
  end;
end;
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
          'stageLabel', internal.tournament_game_stage_label(g.plan_id, g.round_number, g.is_third_place, g.table_id),
          'countsToTable', coalesce(internal.tournament_plan_has_standings(g.plan_id), false),
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
          'stageLabel', internal.tournament_game_stage_label(tg.plan_id, tg.round_number, tg.is_third_place, tg.table_id),
          'countsToTable', coalesce(internal.tournament_plan_has_standings(tg.plan_id), false),
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

CREATE OR REPLACE FUNCTION public.get_tournament_participant_centre(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.tournaments;
  v_can_manage boolean;
  v_contexts jsonb;
  v_mine uuid[];
  v_grades text[];
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to read this. Sign in again.' using errcode = '42501';
  end if;

  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then
    return null;
  end if;

  -- The same rule every other tournament read uses. A viewer who cannot see the tournament gets
  -- nothing -- deliberately the same answer as one that does not exist, because the difference is not
  -- ours to reveal.
  if not internal.tournament_visible_row(p_tournament_id) then
    return null;
  end if;

  v_can_manage := internal.can('tournament.tournament.manage', 'club', v_t.host_club_id, null, null);

  -- ---- THE SIDES THIS VIEWER IS PART OF ------------------------------------------------------------
  --
  -- "Part of" is the connection, not the tournament. It is what decides which age-group contexts
  -- appear, and which sides may show their full attendance breakdown.
  select coalesce(array_agg(distinct tp.id), '{}') into v_mine
  from public.tournament_participants tp
  where tp.tournament_id = p_tournament_id
    and (
      -- the viewer's own club
      (tp.club_id is not null and internal.can('tournament.tournament.view', 'club', tp.club_id, null, null))
      -- the entered team's own staff
      or (tp.team_id is not null and tp.club_id is not null
          and internal.can('tournament.tournament.view', 'team', tp.club_id, tp.team_id, null))
      -- the family of a player in the entered team
      or (tp.team_id is not null and exists (
            select 1 from public.player_team_memberships ptm
            where ptm.team_id = tp.team_id and ptm.status = 'active'
              and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
          ))
    );

  -- The grades those sides play in, in the tournament's own order. A host with management authority
  -- gets every grade the tournament runs, because the whole field is legitimately theirs.
  if v_can_manage then
    select coalesce(array_agg(g.age_group order by g.age_group), '{}') into v_grades
    from public.tournament_age_groups g where g.tournament_id = p_tournament_id;
  else
    select coalesce(array_agg(distinct tp.age_group), '{}') into v_grades
    from public.tournament_participants tp
    where tp.tournament_id = p_tournament_id and tp.id = any(v_mine);
  end if;

  -- ---- ONE CONTEXT PER AGE GROUP -------------------------------------------------------------------
  select coalesce(jsonb_agg(ctx order by ctx->>'ageGroup'), '[]'::jsonb) into v_contexts
  from (
    select jsonb_build_object(
      'ageGroup', grade,
      -- CAN THIS VIEWER RECORD A RESULT for one of this competition''s sides. The same
      -- capability the submit path enforces, so a Results tab can never appear for somebody the
      -- write would refuse -- and a parent is never shown an action list that is empty by design.
      'canRecordResults', exists (
        select 1 from public.tournament_participants rp
        where rp.tournament_id = p_tournament_id and rp.age_group = grade
          and rp.club_id is not null
          and (internal.can('fixture.result.record', 'club', rp.club_id, null, null)
               or (rp.team_id is not null
                   and internal.can('fixture.result.record', 'team', rp.club_id, rp.team_id, null)))
      ),

      -- EVERY SIDE IN THIS COMPETITION, and only this competition. A U12 context never lists the U16
      -- field: telling a U12 parent which clubs are in the U16 competition is describing a different
      -- day's rugby.
      'sides', coalesce((
        -- THE SHARED SIDE, plus only what is genuinely this surface''s own: which team a club is
        -- bringing, and whether the side is one of the viewer''s. An organiser reading the whole
        -- field has no use for either.
        select jsonb_agg(
          internal.tournament_side_summary(tp.id, v_t.host_club_id)
          || jsonb_build_object('teamId', tp.team_id, 'isMine', (tp.id = any(v_mine)))
        order by (tp.club_id is not null and tp.club_id = v_t.host_club_id) desc, cd.name, tp.id)
        from public.tournament_participants tp
        join public.club_directory cd on cd.id = tp.club_directory_id
        left join public.teams tm on tm.id = tp.team_id
        where tp.tournament_id = p_tournament_id and tp.age_group = grade
      ), '[]'::jsonb),

      -- ---- ATTENDANCE, FILTERED BEFORE IT IS SENT ------------------------------------------------
      --
      -- `attending` for everybody, because that is the number the day is organised around. Everything
      -- else only for a side this viewer is part of. A side with no Ovalball team behind it has no
      -- roster to count and reports nothing rather than zero -- "0 attending" would read as a club
      -- that answered, when the truth is that there is nobody here to ask.
      'attendance', coalesce((
        select jsonb_agg(jsonb_build_object(
          'participantId', tp.id,
          'clubName', cd.name,
          'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),
          'label', coalesce(tm.display_name, case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label else tp.age_group end),
          'isMine', (tp.id = any(v_mine)),
          'attending', case when tp.team_id is null then null else (
            select count(*) from public.player_fixture_attendance a
            join public.player_team_memberships m on m.player_id = a.player_id and m.team_id = tp.team_id and m.status = 'active'
            where a.tournament_id = p_tournament_id and a.status = 'ATTENDING') end,
          'unsure', case when tp.id = any(v_mine) and tp.team_id is not null then (
            select count(*) from public.player_fixture_attendance a
            join public.player_team_memberships m on m.player_id = a.player_id and m.team_id = tp.team_id and m.status = 'active'
            where a.tournament_id = p_tournament_id and a.status = 'UNSURE') end,
          'cannotAttend', case when tp.id = any(v_mine) and tp.team_id is not null then (
            select count(*) from public.player_fixture_attendance a
            join public.player_team_memberships m on m.player_id = a.player_id and m.team_id = tp.team_id and m.status = 'active'
            where a.tournament_id = p_tournament_id and a.status = 'CANNOT_ATTEND') end,
          'awaiting', case when tp.id = any(v_mine) and tp.team_id is not null then (
            select count(*) from public.player_team_memberships m
            where m.team_id = tp.team_id and m.status = 'active'
              and not exists (select 1 from public.player_fixture_attendance a
                              where a.tournament_id = p_tournament_id and a.player_id = m.player_id)) end
        ) order by (tp.id = any(v_mine)) desc, cd.name, tp.id)
        from public.tournament_participants tp
        join public.club_directory cd on cd.id = tp.club_directory_id
        left join public.teams tm on tm.id = tp.team_id
        where tp.tournament_id = p_tournament_id and tp.age_group = grade
      ), '[]'::jsonb),

      -- ---- THE PUBLISHED PROGRAMME ---------------------------------------------------------------
      --
      -- Read straight from what planning writes. An empty array means nothing has been published, and
      -- the screen says so in words rather than drawing an empty table or inventing a game.
      -- WHETHER THIS COMPETITION KEEPS A TABLE. The Tournament Centre's tabs ask this rather than the
      -- format, so a Tri-Fixture that is three sides sharing a morning does not get a Tables tab that
      -- can only ever be empty -- the same rule that keeps a knockout from getting one.
      'keepsStandings', coalesce((
        select bool_or(internal.tournament_plan_has_standings(pl.id))
        from public.tournament_plans pl
        where pl.tournament_id = p_tournament_id and pl.age_group = grade
          and pl.publication_state = 'PUBLISHED'), false),
      'competitionDays', coalesce((
        select jsonb_agg(d.day_date order by d.day_date)
        from public.tournament_plan_days d
        join public.tournament_plans pl on pl.id = d.plan_id
        where pl.tournament_id = p_tournament_id and pl.age_group = grade
          and pl.publication_state = 'PUBLISHED'), '[]'::jsonb),
      'games', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id,
          'gameDate', g.game_date,
          'startTime', g.start_time,
          'durationMinutes', g.duration_minutes,
          'pitchName', cp.display_name,
          'status', g.status,
          -- WHERE THIS GAME SITS IN THE COMPETITION. Null for a game somebody added by hand,
          -- which belongs to no table and no round and must not be given one.
          'tableName', pt.name,
          'round', g.round_number,
          -- WHAT A KNOCKOUT CALLS THIS GAME -- "Quarter Final", "Final", "Third-Place Play-Off" --
          -- from the bracket's own naming authority. Null on a round robin, which reads as a table
          -- and a round. A parent at a cup is told what everybody at the ground will call the game.
          'roundName', internal.tournament_game_round_label(g.plan_id, g.round_number, g.is_third_place),
          'stageLabel', internal.tournament_game_stage_label(g.plan_id, g.round_number, g.is_third_place, g.table_id),
          'countsToTable', coalesce(internal.tournament_plan_has_standings(g.plan_id), false),
          'sideA', jsonb_build_object('participantId', a.id, 'clubName', acd.name, 'label', coalesce(atm.display_name, a.age_group),
                                      'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = a.club_id), acd.logo_storage_path),
                                      'score', g.side_a_score, 'isMine', (a.id = any(v_mine))),
          'sideB', jsonb_build_object('participantId', b.id, 'clubName', bcd.name, 'label', coalesce(btm.display_name, b.age_group),
                                      'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = b.club_id), bcd.logo_storage_path),
                                      'score', g.side_b_score, 'isMine', (b.id = any(v_mine)))
        ) order by g.game_date, pt.sort_order nulls first, g.round_number nulls first, g.start_time nulls last, g.sort_order)
        from public.tournament_games g
        join public.tournament_participants a on a.id = g.side_a_id
        join public.tournament_participants b on b.id = g.side_b_id
        join public.club_directory acd on acd.id = a.club_directory_id
        join public.club_directory bcd on bcd.id = b.club_directory_id
        left join public.teams atm on atm.id = a.team_id
        left join public.teams btm on btm.id = b.team_id
        left join public.club_pitches cp on cp.id = g.pitch_id
        left join public.tournament_plan_tables pt on pt.id = g.table_id
        where g.tournament_id = p_tournament_id and g.age_group = grade
          -- A GENERATED GAME IS THE ORGANISER'S WORKINGS UNTIL THEY PUBLISH IT. A game with no
          -- plan behind it is one somebody added by hand, which was always visible and stays so.
          and (g.plan_id is null or exists (select 1 from public.tournament_plans pl
                                            where pl.id = g.plan_id and pl.publication_state = 'PUBLISHED'))
      ), '[]'::jsonb),

      -- ---- THE KNOCKOUT'S SCHEDULED PLACES, WHICH ARE NOT YET GAMES ------------------------------
      --
      -- An organiser schedules a semi-final for three o'clock before anybody has qualified for it. A
      -- parent planning their Sunday needs to know that; "Winner QF1 v Winner QF2, 15:00, Pitch 1" is
      -- a true and useful sentence, and the one the draw already prints.
      --
      -- It is a READ PROJECTION OF THE PLAN, not a game. No `tournament_games` row is created to give
      -- the Agenda something to render -- a game has two real sides by definition, and inventing one
      -- would put a fixture against nobody into Results, the Draw and every count of what was played.
      -- The moment both sides resolve, `internal.create_bracket_game` materialises the canonical game
      -- and it disappears from here, because it is then carried by `games` like everything else.
      --
      -- Published plans only, by the same rule the games follow: a draft is the organiser's workings.
      'pairings', coalesce((
        select jsonb_agg(jsonb_build_object(
          'pairingId', bp.id,
          'gameDate', bp.game_date,
          'startTime', bp.start_time,
          'pitchName', (select cp2.display_name from public.club_pitches cp2 where cp2.id = bp.pitch_id),
          'roundName', internal.tournament_game_round_label(bp.plan_id, bp.round_number, bp.is_third_place),
          'stageLabel', internal.tournament_game_stage_label(bp.plan_id, bp.round_number, bp.is_third_place, null::uuid),
          'countsToTable', coalesce(internal.tournament_plan_has_standings(bp.plan_id), false),
          'sideALabel', internal.bracket_slot_label(sa.id),
          'sideBLabel', internal.bracket_slot_label(sb.id)
        ) order by bp.game_date, bp.start_time nulls last, bp.round_number, bp.game_position)
        from public.tournament_bracket_pairings bp
        join public.tournament_plans pl on pl.id = bp.plan_id
        left join public.tournament_bracket_slots sa
          on sa.plan_id = bp.plan_id and sa.round_number = bp.round_number
             and sa.is_third_place = bp.is_third_place
             and sa.position = case when bp.is_third_place then 1 else bp.game_position * 2 - 1 end
        left join public.tournament_bracket_slots sb
          on sb.plan_id = bp.plan_id and sb.round_number = bp.round_number
             and sb.is_third_place = bp.is_third_place
             and sb.position = case when bp.is_third_place then 2 else bp.game_position * 2 end
        where pl.tournament_id = p_tournament_id and pl.age_group = grade
          and pl.publication_state = 'PUBLISHED'
          and bp.game_id is null
          and bp.game_date is not null
      ), '[]'::jsonb)
    ) as ctx
    from unnest(v_grades) as grade
  ) contexts;

  return jsonb_build_object(
    'id', v_t.id,
    'name', v_t.name,
    'startsOn', v_t.event_date,
    'endsOn', v_t.ends_on,
    'kickoffTime', v_t.kickoff_time,
    'endsAt', v_t.ends_at,
    'format', v_t.format,
    'swissRounds', v_t.swiss_rounds,
    'visibility', v_t.visibility,
    -- HOW RESULTS ARE RUN, which is NOT the tournament''s own visibility: a club may list a
    -- festival publicly and still keep its scores inside it.
    'resultsSubmissionEnabled', v_t.results_submission_enabled,
    'resultsVisibility', v_t.results_visibility,
    'status', v_t.status,
    'cancelled', (v_t.cancelled_at is not null),
    'coverImagePath', v_t.cover_image_path,
    'coverStockKey', v_t.cover_stock_key,
    'notes', v_t.notes,
    'venueName', (select v.name from public.venues v where v.id = v_t.venue_id),
    'venueAddress', (select nullif(concat_ws(', ', v.address_line_1, v.town, v.postcode), '') from public.venues v where v.id = v_t.venue_id),
    'hostClubName', (select cd.name from public.club_directory cd where cd.id = v_t.host_directory_id),
    'hostCrestPath', coalesce(
      (select c.logo_storage_path from public.clubs c where c.id = v_t.host_club_id),
      (select cd.logo_storage_path from public.club_directory cd where cd.id = v_t.host_directory_id)),
    'hostTown', (select nullif(concat_ws(', ', cd.town, cd.county), '') from public.club_directory cd where cd.id = v_t.host_directory_id),
    -- The client routes a manager to the management surface that already exists rather than drawing a
    -- second organiser dashboard behind this one.
    'canManage', v_can_manage,
    'contexts', v_contexts,

    -- ---- WHO THIS VIEWER MAY ANSWER FOR ---------------------------------------------------------
    --
    -- Resolved by the ONE canonical authority, and never by a role. `resolve_attendance_response_source`
    -- raises for a 16-17 year old without recorded consent and for anybody under 16, so it is called
    -- defensively here: this list decides whether a CONTROL is drawn, and the write refuses
    -- independently whether or not one was.
    'myPlayers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'playerId', pl.id,
        'firstName', pl.first_name,
        -- Whether this is the viewer THEMSELVES rather than a child they answer for. The question and
        -- the confirmation both change person on it -- "Can you make the tournament?" against "Can
        -- Harry make the tournament?" -- so it is a fact the server states rather than one the client
        -- infers from whether a name happens to match.
        'isSelf', internal.is_own_linked_player(pl.id),
        'teamId', ptm.team_id,
        'ageGroup', tp.age_group,
        'status', (select a.status from public.player_fixture_attendance a
                   where a.tournament_id = p_tournament_id and a.player_id = pl.id),
        'canRespond', (select internal.resolve_attendance_response_source(pl.id) is not null)
      ) order by pl.first_name)
      from public.tournament_participants tp
      join public.player_team_memberships ptm on ptm.team_id = tp.team_id and ptm.status = 'active'
      join public.players pl on pl.id = ptm.player_id
      where tp.tournament_id = p_tournament_id
        and tp.team_id is not null
        and (internal.is_own_linked_player(pl.id) or internal.is_active_player_guardian(pl.id))
    ), '[]'::jsonb)
  );
exception
  -- `resolve_attendance_response_source` raises rather than returning null for a refusal, and a
  -- refusal is an ordinary answer here: it means "no control for this player", not "the page failed".
  when sqlstate '42501' then
    raise;
end;
$function$;
