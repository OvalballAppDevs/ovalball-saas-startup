-- =====================================================================================================
-- WHAT A TABLE LOOKS LIKE.
--
-- One read for a competition's standings. It resolves from canonical rows every time it is called and
-- stores nothing: the table cannot go stale because there is no table, only the games underneath it.
--
-- ---- THREE THINGS IT REFUSES TO DO ---------------------------------------------------------------
--
-- IT NEVER RETURNS AN UNSETTLED SCORE. Not a submitted one awaiting the other side, not a contested
-- one, not a proposed change to an agreed one, and not the notes anybody attached to any of them. Those
-- belong to the two sides and the organiser, and they are read through the results overview -- which
-- checks who is asking -- not through a standings call that a spectator may legitimately make.
--
-- IT NEVER DECIDES MEMBERSHIP FROM RESULTS. The left-hand side of the standings query is the PUBLISHED
-- PLAN, so a side that has played nothing sits in its table on zero, and no result can move a side
-- between tables.
--
-- AND IT NEVER INVENTS AN ORDER. The ordering is `internal.tournament_table_ordered`, which applies the
-- organiser's own configured tie-breakers. This read model just draws what that returns.
-- =====================================================================================================

create or replace function public.get_tournament_tables(p_tournament_id uuid, p_age_group text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_t public.tournaments;
  v_plan public.tournament_plans;
  v_tables jsonb;
begin
  perform internal.require_live_session();

  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then return null; end if;

  -- The tournament must be readable at all before anything inside it is.
  if not internal.tournament_visible_row(p_tournament_id) then
    return null;
  end if;

  -- AND ITS RESULTS ARE A SEPARATE PERMISSION. A publicly listed festival may keep its scores inside
  -- it; `results_visibility` is what decides, not `visibility`.
  if not internal.tournament_results_readable(p_tournament_id) then
    return jsonb_build_object('tournamentId', v_t.id, 'ageGroup', p_age_group,
                              'published', true, 'restricted', true, 'tables', '[]'::jsonb);
  end if;

  select * into v_plan from public.tournament_plans
  where tournament_id = p_tournament_id and age_group = p_age_group and publication_state = 'PUBLISHED';
  if v_plan.id is null then
    -- NOTHING IS PUBLISHED, so there are no standings. Said plainly, rather than as an empty table that
    -- looks like a competition where nobody has scored.
    return jsonb_build_object('tournamentId', v_t.id, 'ageGroup', p_age_group,
                              'published', false, 'tables', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(x.payload order by x.sort_order, x.name), '[]'::jsonb) into v_tables
  from (
    select
      t.sort_order,
      t.name,
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
            'position', o.table_position,
            'participantId', o.participant_id,
            'clubName', cd.name,
            'label', coalesce(tm.display_name,
                              case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label
                                   else tp.age_group end),
            'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id),
                                  cd.logo_storage_path),
            'isHost', (tp.club_id is not null and tp.club_id = v_t.host_club_id),
            'played', o.played, 'won', o.won, 'drawn', o.drawn, 'lost', o.lost,
            'pointsFor', o.points_for, 'pointsAgainst', o.points_against,
            'pointsDifference', o.points_difference, 'points', o.competition_points
          ) order by o.table_position)
          from internal.tournament_table_ordered(t.id) o
          join public.tournament_participants tp on tp.id = o.participant_id
          join public.club_directory cd on cd.id = tp.club_directory_id
          left join public.teams tm on tm.id = tp.team_id
        ), '[]'::jsonb),
        -- RECENT RESULTS: confirmed only, newest first. A contested or unsettled score is not a result.
        'recentResults', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', g.id, 'date', g.game_date, 'startTime', g.start_time, 'round', g.round_number,
            'sideA', jsonb_build_object(
              'clubName', acd.name, 'label', coalesce(atm.display_name, a.age_group),
              'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = a.club_id),
                                    acd.logo_storage_path),
              'score', g.side_a_score),
            'sideB', jsonb_build_object(
              'clubName', bcd.name, 'label', coalesce(btm.display_name, b.age_group),
              'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = b.club_id),
                                    bcd.logo_storage_path),
              'score', g.side_b_score)
          ) order by g.game_date desc, g.start_time desc nulls last)
          from public.tournament_games g
          join public.tournament_participants a on a.id = g.side_a_id
          join public.tournament_participants b on b.id = g.side_b_id
          join public.club_directory acd on acd.id = a.club_directory_id
          join public.club_directory bcd on bcd.id = b.club_directory_id
          left join public.teams atm on atm.id = a.team_id
          left join public.teams btm on btm.id = b.team_id
          where g.table_id = t.id and g.result_status = 'final' and g.status <> 'CANCELLED'
        ), '[]'::jsonb),
        -- WHAT THE TABLE IS STILL WAITING FOR. A count, never the scores: this payload is readable by
        -- anybody the results setting allows, and an unsettled score is not.
        'confirmedCount', (select count(*) from public.tournament_games g
                           where g.table_id = t.id and g.result_status = 'final' and g.status <> 'CANCELLED'),
        'scheduledCount', (select count(*) from public.tournament_games g
                           where g.table_id = t.id and g.status <> 'CANCELLED')
      ) as payload
    from public.tournament_plan_tables t
    where t.plan_id = v_plan.id
  ) x;

  return jsonb_build_object(
    'tournamentId', v_t.id,
    'tournamentName', v_t.name,
    'ageGroup', p_age_group,
    'published', true,
    'format', v_t.format,
    -- The organiser's own scoring system, so a table can explain itself rather than asking people to
    -- trust its arithmetic.
    'points', jsonb_build_object(
      'win', v_plan.points_win, 'draw', v_plan.points_draw, 'loss', v_plan.points_loss,
      'losingBonus', v_plan.points_losing_bonus, 'losingBonusMargin', v_plan.losing_bonus_margin,
      'tryBonus', v_plan.points_try_bonus),
    'tieBreakers', to_jsonb(v_plan.tie_breakers),
    'tables', v_tables
  );
end;
$function$;

comment on function public.get_tournament_tables(uuid, text) is
  'One competition''s standings, calculated from CONFIRMED results only and ordered by '
  'internal.tournament_table_ordered. Honours tournaments.results_visibility through '
  'internal.tournament_results_readable; never returns an unsettled, contested or proposed score.';

revoke all on function public.get_tournament_tables(uuid, text) from public, anon;
grant execute on function public.get_tournament_tables(uuid, text) to authenticated, service_role;
