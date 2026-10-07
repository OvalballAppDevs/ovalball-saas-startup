-- EVERY REAL TOURNAMENT GAME IS ON THE FIXTURE LIST (Tournament Planning parity programme, phase 9).
--
-- The Fixtures list used to leave tournaments out entirely, because a FESTIVAL is not a match: no
-- opposition, no home or away, no single score. But a tournament's GAMES are matches -- two real sides,
-- a kick-off, a pitch, a score -- and once a plan is published a parent looking at "what is my child
-- playing" should find the 10:15 Semi Final against Fylde where they find every other game.
--
-- So the list reads published games, one row per game per side of ours, from the same tournament
-- records everything else reads. It never invents a row: a draft plan's games, a cancelled tournament
-- and a cancelled game are not on it, and a place in the draw with no sides yet is not a game. The
-- stage ("Group Stage · Table A · Round 2", "Semi Final", "Swiss · Round 3") is the server's own label.
-- Each row opens the one canonical game screen.

create or replace function public.get_tournament_fixture_rows(p_team_ids uuid[], p_from date, p_to date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  perform internal.require_live_session();
  if p_team_ids is null or cardinality(p_team_ids) = 0 then return '[]'::jsonb; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'gameId', g.id,
      'tournamentId', t.id,
      'tournamentName', t.name,
      'ageGroup', g.age_group,
      'teamId', us.team_id,
      'date', g.game_date,
      'startTime', g.start_time,
      'pitchName', (select cp.display_name from public.club_pitches cp where cp.id = g.pitch_id),
      'stageLabel', internal.tournament_game_stage_label(g.plan_id, g.round_number, g.is_third_place, g.table_id),
      'opponent', internal.tournament_side_summary(them.id, t.host_club_id),
      'opponentDirectoryId', them.club_directory_id,
      -- A SCORE ONLY WHEN IT COUNTS: a submitted, unconfirmed score is not a result yet.
      'ourScore', case when internal.tournament_result_counts(g.result_status)
                       then case when us.id = g.side_a_id then g.side_a_score else g.side_b_score end end,
      'theirScore', case when internal.tournament_result_counts(g.result_status)
                         then case when us.id = g.side_a_id then g.side_b_score else g.side_a_score end end
    ) order by g.game_date, g.start_time nulls last, g.sort_order)
    from public.tournament_games g
    join public.tournament_plans pl on pl.id = g.plan_id and pl.publication_state = 'PUBLISHED'
    join public.tournaments t on t.id = g.tournament_id and t.cancelled_at is null
    join public.tournament_participants us on us.id in (g.side_a_id, g.side_b_id) and us.team_id = any (p_team_ids)
    join public.tournament_participants them on them.id in (g.side_a_id, g.side_b_id) and them.id <> us.id
    where g.game_date between p_from and p_to
      and g.status <> 'CANCELLED'
      and internal.tournament_visible_row(t.id)
      and internal.tournament_plan_readable(g.plan_id)
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.get_tournament_fixture_rows(uuid[], date, date) from public, anon;
grant execute on function public.get_tournament_fixture_rows(uuid[], date, date) to authenticated;
