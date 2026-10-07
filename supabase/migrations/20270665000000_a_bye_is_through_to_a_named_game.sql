-- A BYE IS THROUGH TO A NAMED GAME, NOT TO A ROUND.
--
-- The byes block said a side was "through to the Semi Finals" -- the plural, which is the heading over
-- a column of games. One side goes through to ONE game: the Semi Final. The singular name already
-- exists (`internal.bracket_game_name`, which the results use), so this is the same fact said with the
-- same authority rather than a second phrasing.

create or replace function public.get_tournament_bracket(p_tournament_id uuid, p_age_group text)
returns jsonb
language plpgsql
stable security definer
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
  v_draw jsonb;
begin
  perform internal.require_live_session();

  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then return null; end if;
  if not internal.tournament_visible_row(p_tournament_id) then return null; end if;

  v_is_host := internal.can_manage_tournament(p_tournament_id);

  select * into v_plan from public.tournament_plans
  where tournament_id = p_tournament_id and age_group = p_age_group
    and (v_is_host or publication_state = 'PUBLISHED')
  order by case when publication_state = 'PUBLISHED' then 0 else 1 end
  limit 1;

  if v_plan.id is null then
    return jsonb_build_object('tournamentId', v_t.id, 'ageGroup', p_age_group,
                              'published', false, 'rounds', '[]'::jsonb, 'byes', '[]'::jsonb,
                              'drawOrder', '[]'::jsonb);
  end if;

  select count(*) into v_size from public.tournament_bracket_slots
  where plan_id = v_plan.id and round_number = 1 and not is_third_place;
  v_rounds := internal.bracket_rounds(v_size);

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
          'winnerParticipantId', p.winner_participant_id,
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

  -- THE SIDES ALREADY THROUGH, with no game to play. One side goes through to ONE game, so the name
  -- here is the singular -- the Semi Final, not the Semi Finals, which heads a column of four.
  select coalesce(jsonb_agg(jsonb_build_object(
    'participantId', s.participant_id,
    'side', internal.tournament_side_summary(s.participant_id, v_t.host_club_id),
    'advancesToRound', 2,
    'advancesToName', internal.bracket_game_name(2, v_rounds)
  ) order by s.position), '[]'::jsonb)
  into v_byes
  from public.tournament_bracket_slots b
  join public.tournament_bracket_slots s
    on s.plan_id = b.plan_id and s.round_number = 1 and not s.is_third_place
       and s.position = case when b.position % 2 = 1 then b.position + 1 else b.position - 1 end
  where b.plan_id = v_plan.id and b.round_number = 1 and not b.is_third_place
    and b.is_bye and s.participant_id is not null;

  select coalesce(jsonb_agg(x.participant_id order by x.seed), '[]'::jsonb)
  into v_draw
  from (
    select s.participant_id,
           (internal.bracket_seed_order(v_size))[s.position] as seed
    from public.tournament_bracket_slots s
    where s.plan_id = v_plan.id and s.round_number = 1 and not s.is_third_place
      and s.participant_id is not null
  ) x;

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
    'byes', v_byes,
    'drawOrder', v_draw
  );
end;
$function$;
