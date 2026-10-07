-- A PLAN READS BACK THE SETTINGS IT WAS GIVEN.
--
-- `get_tournament_plan` returned the round robin half of a plan -- durations, changeover, day window,
-- scoring, tables -- and none of the knockout half. Planning's Settings step is a set of controls over
-- exactly those missing columns, so it opened at its own defaults however the competition had actually
-- been configured: no extra time, golden point, no third-place play-off, no round assigned to any day.
--
-- The display was the smaller problem. Generate SAVES whatever those controls hold, so returning to a
-- configured competition and pressing Generate again overwrote the organiser's extra time, tie
-- resolution, play-off and round scheduling with the defaults -- silently, and with the bracket beside
-- it still showing the play-off that had just been switched off.
--
-- Nothing else changes: the same function, the same authority check, the same round robin keys.

CREATE OR REPLACE FUNCTION public.get_tournament_plan(p_tournament_id uuid, p_age_group text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.tournaments;
  v_plan public.tournament_plans;
  v_defaults record;
begin
  perform internal.require_live_session();
  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then return null; end if;
  if not internal.can_manage_tournament(p_tournament_id) then
    raise exception 'You do not have permission to plan this tournament.' using errcode = '42501';
  end if;

  select * into v_plan from public.tournament_plans
  where tournament_id = p_tournament_id and age_group = p_age_group and publication_state <> 'SUPERSEDED';

  select * into v_defaults from internal.tournament_plan_defaults(p_tournament_id, p_age_group);

  return jsonb_build_object(
    'tournamentId', v_t.id,
    'tournamentName', v_t.name,
    'ageGroup', p_age_group,
    'format', v_t.format,
    'swissRounds', v_t.swiss_rounds,
    'venueName', (select v.name from public.venues v where v.id = v_t.venue_id),
    -- THE TOURNAMENT'S OWN RANGE, which planning selects from and never changes.
    'tournamentStartsOn', v_t.event_date,
    'tournamentEndsOn', coalesce(v_t.ends_on, v_t.event_date),
    -- Every competition this tournament runs, so the Planning header can offer the age-group context.
    'ageGroups', coalesce((select jsonb_agg(g.age_group order by g.age_group)
                           from public.tournament_age_groups g where g.tournament_id = p_tournament_id), '[]'::jsonb),

    -- THE SIDES THIS COMPETITION HAS. Planning operates on these ids and never on a club's name; a
    -- club Ovalball does not have is a side here exactly like any other.
    -- WHICH SCORING RULES CAN ACTUALLY BE APPLIED, and why not where they cannot. Planning draws
    -- its controls from this rather than deciding on the device.
    'scoringRules', case when v_plan.id is not null then internal.tournament_scoring_rules(v_plan.id) end,
    'losingBonusMargin', v_plan.losing_bonus_margin,
    'tieBreakers', to_jsonb(v_plan.tie_breakers),
    'sides', coalesce((
      -- ONE DEFINITION OF A PARTICIPATING SIDE, shared with the participant Centre and with
      -- Results. `onOvalball` asks whether anybody could actually answer for this side, which is
      -- the question every surface downstream needs and the one the old inline test got wrong.
      select jsonb_agg(internal.tournament_side_summary(tp.id, v_t.host_club_id)
      order by (tp.club_id is not null and tp.club_id = v_t.host_club_id) desc, cd.name, tp.id)
      from public.tournament_participants tp
      join public.club_directory cd on cd.id = tp.club_directory_id
      left join public.teams tm on tm.id = tp.team_id
      where tp.tournament_id = p_tournament_id and tp.age_group = p_age_group
    ), '[]'::jsonb),

    -- WHAT THE DEFAULTS WOULD BE, and where they come from, so Settings can say so rather than
    -- presenting a number nobody chose.
    'defaults', jsonb_build_object(
      'gameDurationMinutes', v_defaults.game_duration_minutes,
      'changeoverMinutes', v_defaults.changeover_minutes,
      'dayStartTime', v_defaults.day_start_time,
      'dayEndTime', v_defaults.day_end_time,
      'durationSource', v_defaults.duration_source),

    'pitchesReserved', (select count(*) from public.tournament_pitches where tournament_id = p_tournament_id),

    'plan', case when v_plan.id is null then null else jsonb_build_object(
      'id', v_plan.id,
      'publicationState', v_plan.publication_state,
      'version', v_plan.version,
      'publishedAt', v_plan.published_at,
      'gameDurationMinutes', v_plan.game_duration_minutes,
      'changeoverMinutes', v_plan.changeover_minutes,
      'dayStartTime', v_plan.day_start_time,
      'dayEndTime', v_plan.day_end_time,
      'pointsWin', v_plan.points_win,
      'pointsDraw', v_plan.points_draw,
      'pointsLoss', v_plan.points_loss,
      'pointsTryBonus', v_plan.points_try_bonus,
      'pointsLosingBonus', v_plan.points_losing_bonus,
      'days', coalesce((select jsonb_agg(d.day_date order by d.day_date)
                        from public.tournament_plan_days d where d.plan_id = v_plan.id), '[]'::jsonb),
      'tables', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'name', t.name, 'sortOrder', t.sort_order,
          'sides', coalesce((select jsonb_agg(s.participant_id order by s.position)
                             from public.tournament_plan_table_sides s where s.table_id = t.id), '[]'::jsonb)
        ) order by t.sort_order)
        from public.tournament_plan_tables t where t.plan_id = v_plan.id), '[]'::jsonb),
      'gameCount', (select count(*) from public.tournament_games where plan_id = v_plan.id),

      -- THE KNOCKOUT SETTINGS THE PLAN ALREADY HOLDS. Planning's Settings step is a set of controls
      -- over these columns, so it has to be able to read them: a step that opens at its defaults every
      -- time does not merely display the wrong thing, it writes the wrong thing back the moment the
      -- organiser presses Generate, quietly discarding the extra time, the tie resolution, the
      -- play-off and the round days somebody chose earlier.
      'drawMethod', v_plan.draw_method,
      'tieResolution', v_plan.tie_resolution,
      'extraTimeMinutes', v_plan.extra_time_minutes,
      'thirdPlacePlayoff', v_plan.third_place_playoff,
      'roundDays', coalesce((select jsonb_agg(jsonb_build_object('round', r.round_number, 'day', r.day_date)
                                              order by r.round_number)
                             from public.tournament_plan_round_days r where r.plan_id = v_plan.id), '[]'::jsonb)
    ) end
  );
end;
$function$;
