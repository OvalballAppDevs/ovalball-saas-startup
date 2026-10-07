-- =====================================================================================================
-- WHAT A BRACKET LOOKS LIKE.
--
-- One read for a knockout competition's draw, for everybody who may see it: the organiser arranging it,
-- and the parent following their child's side through it.
--
-- EVERY PLACE IS ANSWERED THE SAME WAY -- a real side, or the sentence that describes what will fill it.
-- "Winner QF1" comes from `internal.bracket_slot_label`, which reads the stored dependency, so the
-- bracket a participant reads and the rule that actually advances a side are one statement. No row
-- anywhere is a club called Winner QF1.
--
-- A BYE IS NOT A GAME AND IS NOT RETURNED AS ONE. It comes back in its own list -- the side, and the
-- round it is already through to -- so a screen can say "advances to the Semi Finals" instead of
-- drawing a fixture against nobody.
--
-- SCORES OBEY THE TOURNAMENT'S RESULT VISIBILITY, through the same authority the table and the results
-- list use. A knockout does not get its own.
-- =====================================================================================================

create or replace function public.get_tournament_bracket(p_tournament_id uuid, p_age_group text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_t public.tournaments;
  v_plan public.tournament_plans;
  v_is_host boolean;
  v_scores boolean;
  v_size integer;
  v_rounds integer;
  v_rows jsonb;
  v_byes jsonb;
begin
  perform internal.require_live_session();

  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then return null; end if;
  if not internal.tournament_visible_row(p_tournament_id) then return null; end if;

  v_is_host := internal.can_manage_tournament(p_tournament_id);

  -- THE ORGANISER SEES THEIR DRAFT; EVERYBODY ELSE SEES WHAT THEY PUBLISHED. The same line a generated
  -- round robin draws, for the same reason: a draw being arranged is not an announcement.
  select * into v_plan from public.tournament_plans
  where tournament_id = p_tournament_id and age_group = p_age_group
    and (v_is_host or publication_state = 'PUBLISHED')
  order by case when publication_state = 'PUBLISHED' then 0 else 1 end
  limit 1;

  if v_plan.id is null then
    return jsonb_build_object('tournamentId', v_t.id, 'ageGroup', p_age_group,
                              'published', false, 'rounds', '[]'::jsonb, 'byes', '[]'::jsonb);
  end if;

  select count(*) into v_size from public.tournament_bracket_slots
  where plan_id = v_plan.id and round_number = 1 and not is_third_place;
  v_rounds := internal.bracket_rounds(v_size);

  -- A score is part of a result, so it follows the result-visibility authority rather than the draw's.
  v_scores := internal.tournament_results_readable(p_tournament_id);

  with pairing as (
    select bp.*,
           sa.participant_id as a_id, sa.id as a_slot, sa.is_bye as a_bye,
           sb.participant_id as b_id, sb.id as b_slot, sb.is_bye as b_bye,
           g.id as g_id, g.side_a_id as g_a, g.side_b_id as g_b,
           g.side_a_score, g.side_b_score, g.result_status, g.winner_participant_id, g.status as g_status
    from public.tournament_bracket_pairings bp
    left join public.tournament_bracket_slots sa
      on sa.plan_id = bp.plan_id and sa.round_number = bp.round_number
         and sa.is_third_place = bp.is_third_place
         and sa.position = case when bp.is_third_place then 1 else bp.game_position * 2 - 1 end
    left join public.tournament_bracket_slots sb
      on sb.plan_id = bp.plan_id and sb.round_number = bp.round_number
         and sb.is_third_place = bp.is_third_place
         and sb.position = case when bp.is_third_place then 2 else bp.game_position * 2 end
    left join public.tournament_games g on g.id = bp.game_id
    where bp.plan_id = v_plan.id
  )
  select jsonb_agg(r.payload order by r.round_number, r.is_third_place, r.sort_name)
  into v_rows
  from (
    select p.round_number, p.is_third_place, min(p.game_position) as sort_name,
      jsonb_build_object(
        'round', p.round_number,
        'isThirdPlace', p.is_third_place,
        'name', case when p.is_third_place then 'Third-Place Play-Off'
                     else internal.bracket_round_name(p.round_number, v_rounds) end,
        'code', case when p.is_third_place then '3rd'
                     else internal.bracket_round_code(p.round_number, v_rounds) end,
        'games', jsonb_agg(jsonb_build_object(
          'pairingId', p.id,
          'position', p.game_position,
          'gameId', p.g_id,
          'date', p.game_date,
          'startTime', p.start_time,
          'pitchName', (select cp.display_name from public.club_pitches cp where cp.id = p.pitch_id),
          'status', coalesce(p.g_status, 'SCHEDULED'),
          'resultStatus', coalesce(p.result_status, 'none'),
          -- A WINNER IS A FACT THE SERVER RECORDED, never something a screen works out from two numbers.
          'winnerParticipantId', p.winner_participant_id,
          -- A LEVEL GAME THAT CANNOT ADVANCE ANYBODY says so, rather than looking merely unfinished.
          'needsWinner', (internal.tournament_result_counts(coalesce(p.result_status, 'none'))
                          and p.winner_participant_id is null),
          'sideA', internal.bracket_side(p.a_id, p.a_slot, v_t.host_club_id,
                                         case when v_scores then p.side_a_score end, p.winner_participant_id),
          'sideB', internal.bracket_side(p.b_id, p.b_slot, v_t.host_club_id,
                                         case when v_scores then p.side_b_score end, p.winner_participant_id)
        ) order by p.game_position)
      ) as payload
    from pairing p
    group by p.round_number, p.is_third_place
  ) r;

  -- THE SIDES ALREADY THROUGH, with no game to play. Their own list, because they are not a fixture.
  select coalesce(jsonb_agg(jsonb_build_object(
    'participantId', s.participant_id,
    'side', internal.tournament_side_summary(s.participant_id, v_t.host_club_id),
    'advancesToRound', 2,
    'advancesToName', internal.bracket_round_name(2, v_rounds)
  ) order by s.position), '[]'::jsonb)
  into v_byes
  from public.tournament_bracket_slots b
  join public.tournament_bracket_slots s
    on s.plan_id = b.plan_id and s.round_number = 1 and not s.is_third_place
       and s.position = case when b.position % 2 = 1 then b.position + 1 else b.position - 1 end
  where b.plan_id = v_plan.id and b.round_number = 1 and not b.is_third_place
    and b.is_bye and s.participant_id is not null;

  return jsonb_build_object(
    'tournamentId', v_t.id,
    'tournamentName', v_t.name,
    'ageGroup', p_age_group,
    'planId', v_plan.id,
    'publicationState', v_plan.publication_state,
    'published', (v_plan.publication_state = 'PUBLISHED'),
    'canManage', v_is_host,
    'showsScores', v_scores,
    'bracketSize', v_size,
    'roundCount', v_rounds,
    'thirdPlacePlayoff', v_plan.third_place_playoff,
    'rounds', coalesce(v_rows, '[]'::jsonb),
    'byes', v_byes
  );
end;
$function$;

/**
 * ONE PLACE IN THE BRACKET, as a screen draws it.
 *
 * A real side comes back as the canonical side shape every tournament surface uses. An empty one comes
 * back as its LABEL -- "Winner QF1", "Loser SF1", "BYE" -- with no participant id, no club and no
 * crest, because there is nothing there yet and pretending otherwise is the whole mistake this model
 * exists to avoid.
 */
create or replace function internal.bracket_side(
  p_participant uuid,
  p_slot uuid,
  p_host_club uuid,
  p_score integer,
  p_winner uuid
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when p_participant is not null then
      internal.tournament_side_summary(p_participant, p_host_club)
      || jsonb_build_object('score', p_score, 'isWinner', (p_winner is not null and p_winner = p_participant))
    else
      jsonb_build_object(
        'participantId', null,
        'clubName', null,
        'crestPath', null,
        'label', internal.bracket_slot_label(p_slot),
        'isHost', false,
        'onOvalball', false,
        'score', null,
        'isWinner', false,
        'unresolved', true)
  end;
$function$;

revoke all on function public.get_tournament_bracket(uuid, text) from public, anon;
grant execute on function public.get_tournament_bracket(uuid, text) to authenticated, service_role;
