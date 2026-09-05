-- Section 5/32 live acceptance test: future-fixture identity across
-- automatic handover. Team T (current season = U13, next season = U14
-- after handover) with a fixture already booked for the NEXT season
-- BEFORE handover happens -- must display U14 through the season-aware
-- resolver while the live team row still says U13, and become U14 for
-- real (same team_id) exactly once handover runs, with zero fixture/
-- team duplication throughout.
--
-- Deliberately its own file/transaction, not folded into
-- season_transition_boundary.sql: get_team_identity_for_season's
-- future-season PROJECTION counts every season row of that rugby_code
-- between "today" and the target chronologically (real seasons AND any
-- other regression-fixture ones) to work out how many age-grade steps
-- to project forward. The boundary-matrix file deliberately creates
-- many synthetic union seasons across widely-separated date bands for
-- its OWN unrelated purpose; sharing a transaction with this test would
-- inflate that step count into nonsense. This file uses exactly one
-- club and one extra season, so the projector sees a clean "exactly one
-- season ahead of today's real current season" situation.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/season_transition_future_fixture.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0016', 'Future Fixture Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'future-fixture-test-club-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c0016', '9d000000-0000-0000-0000-0000000d0016', 'future-fixture-test-club-9d000000', 'active');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000600016', '9d000000-0000-0000-0000-0000000c0016', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');
insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug, active) values
  ('9d000000-0000-0000-0000-000000000b07', '9d000000-0000-0000-0000-0000000c0016', 'union', 'youth', 'U13', 'U13', 'ff-u13', true);
-- Exactly ONE season ahead of today's real current Union season (its
-- own pre-season already in the past, so a single engine tick
-- transitions it) -- no other synthetic union seasons in this
-- transaction to pollute the projector's step count.
-- Must land strictly between the real current Union season's own
-- starts_on (2026-09-01, this club's fallback anchor) and the real
-- Rugby Union 27/28's starts_on (2027-09-01) -- otherwise the real
-- 27/28 season, being chronologically closer, would win as "next
-- season" instead of this one. Deliberately NOT current_date + 200:
-- both tournaments.sql and controlled_missing_team.sql leave a
-- PERSISTENT (never rolled back, by their own design) regression-
-- fixture union season at exactly current_date + 200 -- an exact
-- starts_on tie there made this test's own engine-selection query
-- genuinely non-deterministic (see 20260925040000, which also adds a
-- general deterministic tiebreaker; this offset change removes the
-- specific collision so this test never depends on that tiebreaker).
insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-00000000c108', 'Future Fixture Next Season', current_date + 90, current_date + 190, current_date - 2, 'union', 2196, true);
insert into public.fixtures (id, owning_team_id, season_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-00000000c109', '9d000000-0000-0000-0000-000000000b07', '9d000000-0000-0000-0000-00000000c108', current_date + 100, 'Home', 'Future Fixture Test Opponent', 'Booked');

do $$
declare
  v_team_id uuid := '9d000000-0000-0000-0000-000000000b07';
  v_to_season_id uuid := '9d000000-0000-0000-0000-00000000c108';
  v_fixture_id uuid := '9d000000-0000-0000-0000-00000000c109';
  v_identity_before record;
  v_identity_after record;
  v_live_age_before text;
  v_live_age_after text;
begin
  select * into v_identity_before from public.get_team_identity_for_season(v_team_id, v_to_season_id);
  select age_group into v_live_age_before from public.teams where id = v_team_id;

  perform internal.process_due_season_transitions();

  select * into v_identity_after from public.get_team_identity_for_season(v_team_id, v_to_season_id);
  select age_group into v_live_age_after from public.teams where id = v_team_id;

  if v_live_age_before = 'U13' and v_identity_before.age_group = 'U14' and v_identity_before.is_projected then
    raise notice 'PASS 1: BEFORE handover -- live team row still says U13, but the future fixture''s own season correctly resolves U14 via the season-aware resolver (a genuine projection, since no snapshot exists yet)';
  else
    raise notice 'FAIL 1: live_before=% identity_before=% projected=%', v_live_age_before, v_identity_before.age_group, v_identity_before.is_projected;
  end if;

  if v_live_age_after = 'U14' and v_identity_after.age_group = 'U14' and not v_identity_after.is_projected then
    raise notice 'PASS 2: AFTER handover -- the SAME team_id is now genuinely U14, and the future fixture still resolves U14 (now from a real snapshot, not a projection) -- consistent throughout';
  else
    raise notice 'FAIL 2: live_after=% identity_after=% projected=%', v_live_age_after, v_identity_after.age_group, v_identity_after.is_projected;
  end if;

  if exists (select 1 from public.fixtures where id = v_fixture_id and owning_team_id = v_team_id and season_id = v_to_season_id) then
    raise notice 'PASS 3: the fixture_id, its owning team_id, and its season_id are ALL completely unchanged across handover -- no reassignment, no duplication';
  else
    raise notice 'FAIL 3: fixture drifted';
  end if;

  if (select count(*) from public.fixtures where owning_team_id = v_team_id and kickoff_date = current_date + 100) = 1 then
    raise notice 'PASS 4: exactly one fixture exists for this team on this date -- handover never created a duplicate/shadow fixture';
  else
    raise notice 'FAIL 4: unexpected fixture count';
  end if;
end $$;

rollback;
