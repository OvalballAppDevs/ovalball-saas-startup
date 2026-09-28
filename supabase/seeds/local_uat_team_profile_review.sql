-- Local UAT data for TEAM PROFILE PHYSICAL REVIEW (Section 1B).
--
-- WHY THIS FILE EXISTS
--
-- Before this seed, the Women's 1st Team (Ovalball UAT RUFC) had exactly one fixture -- a single
-- completed match with no score -- so the Team Profile's Next Fixture card, Fixtures/Wins metrics and
-- Fixtures tab could not be reviewed in any populated state. This adds five more fixtures against the
-- existing unclaimed "Ovalball UAT Opposition RFC" directory entry (built for exactly this purpose --
-- an opponent nobody has to sign in as to answer), covering the states Section 1B asked for:
--
--   upcoming home        2026-10-10, Friendly, Ovalball UAT Ground
--   upcoming away         2026-10-17, League Fixture
--   past win              2026-09-13, 28-12
--   past loss             2026-09-20, 10-22
--   cancelled             2026-10-24 (never rearranged)
--
-- These rows are the exact shape `create_fixture`/`submit_fixture_result`/`cancel_fixture` already
-- produced when first created interactively against this same local database -- reproduced here as a
-- direct insert (the established shape for a seed file, which runs before any session exists to hold
-- the capability check those RPCs would otherwise re-run) so the enrichment survives a clean rebuild
-- rather than being lost the way an interactive-only change would be.
--
-- Committed, idempotent, additive and local-only, like every UAT seed.

do $$
begin
  if exists (select 1 from public.clubs c join public.club_directory d on d.id = c.directory_id
             where d.source not in ('local_dev_seed','site_admin_manual','manual','official_club') limit 1)
     and not exists (select 1 from public.club_directory where source = 'local_dev_seed') then
    raise exception 'This looks like a real dataset. The Team Profile review UAT seed is local-only.';
  end if;
end $$;

do $$
declare
  v_team uuid := 'c06be292-cebb-4bcc-bfca-81258cfaf100'; -- Women's 1st Team, Ovalball UAT RUFC
  v_opponent uuid := 'cca9e0d0-d6a5-4e5e-9805-6ce9950718df'; -- Ovalball UAT Opposition RFC (unclaimed)
  v_season uuid := '362e8624-ed76-4fea-b336-8cf01da664e9'; -- Rugby Union 26/27
  v_ground uuid := '874d9f51-5c73-4982-8bd5-e29c2eca0c46'; -- Ovalball UAT Ground
  v_id uuid;
begin
  if not exists (select 1 from public.teams where id = v_team)
     or not exists (select 1 from public.club_directory where id = v_opponent)
     or not exists (select 1 from public.seasons where id = v_season) then
    return; -- the teams/opponent/season this seed enriches don't exist in this database; nothing to add.
  end if;

  if not exists (select 1 from public.fixtures where owning_team_id = v_team and opponent_directory_id = v_opponent and kickoff_date = '2026-10-10') then
    insert into public.fixtures (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, venue_id, season_id, source)
    values (v_team, 'Home', v_opponent, 'Ovalball UAT Opposition RFC', '2026-10-10', '14:00', 'Friendly', 'Booked', v_ground, v_season, 'club_created');
  end if;

  if not exists (select 1 from public.fixtures where owning_team_id = v_team and opponent_directory_id = v_opponent and kickoff_date = '2026-10-17') then
    insert into public.fixtures (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, season_id, source)
    values (v_team, 'Away', v_opponent, 'Ovalball UAT Opposition RFC', '2026-10-17', '15:00', 'League Fixture', 'Booked', v_season, 'club_created');
  end if;

  if not exists (select 1 from public.fixtures where owning_team_id = v_team and opponent_directory_id = v_opponent and kickoff_date = '2026-09-13') then
    insert into public.fixtures (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, venue_id, season_id, source, home_score, away_score, result_status)
    values (v_team, 'Home', v_opponent, 'Ovalball UAT Opposition RFC', '2026-09-13', '14:00', 'League Fixture', 'Completed', v_ground, v_season, 'club_created', 28, 12, 'external_recorded');
  end if;

  if not exists (select 1 from public.fixtures where owning_team_id = v_team and opponent_directory_id = v_opponent and kickoff_date = '2026-09-20') then
    insert into public.fixtures (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, venue_id, season_id, source, home_score, away_score, result_status)
    values (v_team, 'Home', v_opponent, 'Ovalball UAT Opposition RFC', '2026-09-20', '14:00', 'League Fixture', 'Completed', v_ground, v_season, 'club_created', 10, 22, 'external_recorded');
  end if;

  if not exists (select 1 from public.fixtures where owning_team_id = v_team and opponent_directory_id = v_opponent and kickoff_date = '2026-10-24') then
    insert into public.fixtures (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, venue_id, season_id, source, notes)
    values (v_team, 'Home', v_opponent, 'Ovalball UAT Opposition RFC', '2026-10-24', '14:00', 'Friendly', 'Cancelled', v_ground, v_season, 'club_created', 'UAT review data -- weather cancellation, kept for interface review only.');
  end if;
end $$;
