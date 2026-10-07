-- =====================================================================================================
-- WHAT AN ORGANISER SEES WHILE PLANNING.
--
-- One read behind all four steps -- Teams & Dates, Tables, Settings, Review -- for the same reason the
-- tournament's own four tabs share one: four loaders over one plan is how the step that counts the
-- sides and the step that arranges them come to disagree about how many there are.
--
-- IT IS THE ORGANISER'S READ, and it says so: `canManage` is false for anybody else and the payload is
-- refused outright, because planning state is not a participant's business until it is published.
-- =====================================================================================================

create or replace function public.get_tournament_plan(p_tournament_id uuid, p_age_group text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
    'sides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participantId', tp.id,
        'clubName', cd.name,
        'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),
        'label', coalesce(tm.display_name, case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label else tp.age_group end),
        'isHost', (tp.club_id is not null and tp.club_id = v_t.host_club_id),
        'onOvalball', (tp.status <> 'external_recorded')
      ) order by (tp.club_id is not null and tp.club_id = v_t.host_club_id) desc, cd.name, tp.id)
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
      'gameCount', (select count(*) from public.tournament_games where plan_id = v_plan.id)
    ) end
  );
end;
$function$;

comment on function public.get_tournament_plan(uuid, text) is
  'One read behind all four Planning steps for one COMPETITION. Organiser only: refuses anybody '
  'without tournament.tournament.manage, because a draft plan is not a participant''s business.';

revoke all on function public.get_tournament_plan(uuid, text) from public, anon;
grant execute on function public.get_tournament_plan(uuid, text) to authenticated, service_role;
