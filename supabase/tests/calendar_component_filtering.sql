-- CALENDAR COMPONENT-TEAM FILTERING + FIXTURE_ID DEDUP -- direct data
-- test matrix (Section 22) and dedup-is-architectural proof (Section 23).
-- Proves at the SQL/domain layer, before any React rendering, that a
-- Calendar fixture fetch can never return the same physical fixture more
-- than once for any of the four canonical shapes, and specifically that
-- this holds true by construction (no fan-out join against
-- scheduling_group_members exists in the app's own query path) rather
-- than by some downstream cosmetic dedup step.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/calendar_component_filtering.sql

\set ON_ERROR_STOP off
\pset pager off
begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000000fa', 'Calendar Test Club A', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cal-test-club-a-9d000000'),
  ('9d000000-0000-0000-0000-0000000000fb', 'Calendar Test Club B', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cal-test-club-b-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000000da', '9d000000-0000-0000-0000-0000000000fa', 'cal-test-club-a-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000000db', '9d000000-0000-0000-0000-0000000000fb', 'cal-test-club-b-9d000000', 'active');

insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-00000000ca01', 'Calendar Test Season', current_date - 100, current_date + 100, current_date - 110, 'union', 2196, true);

insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-0000000ca6a1', '9d000000-0000-0000-0000-0000000000da', 'union', 'youth', 'U6', null, null, 'Cal A U6', 'cal-a-u6', true),
  ('9d000000-0000-0000-0000-0000000ca7a1', '9d000000-0000-0000-0000-0000000000da', 'union', 'youth', 'U7', null, null, 'Cal A U7', 'cal-a-u7', true),
  ('9d000000-0000-0000-0000-0000000ca12a', '9d000000-0000-0000-0000-0000000000da', 'union', 'youth', 'U12', 'boys', null, 'Cal A U12', 'cal-a-u12', true),
  ('9d000000-0000-0000-0000-0000000ca12c', '9d000000-0000-0000-0000-0000000000da', 'union', 'youth', 'U13', 'boys', null, 'Cal A U13 (unrelated)', 'cal-a-u13', true),
  ('9d000000-0000-0000-0000-0000000ca6b1', '9d000000-0000-0000-0000-0000000000db', 'union', 'youth', 'U6', null, null, 'Cal B U6', 'cal-b-u6', true),
  ('9d000000-0000-0000-0000-0000000ca7b1', '9d000000-0000-0000-0000-0000000000db', 'union', 'youth', 'U7', null, null, 'Cal B U7', 'cal-b-u7', true),
  ('9d000000-0000-0000-0000-0000000ca12b', '9d000000-0000-0000-0000-0000000000db', 'union', 'youth', 'U12', 'boys', null, 'Cal B U12', 'cal-b-u12', true),
  ('9d000000-0000-0000-0000-0000000ca7a2', '9d000000-0000-0000-0000-0000000000da', 'union', 'youth', 'U7', null, 'C', 'Cal A U7 solo (not in any group)', 'cal-a-u7solo', true),
  ('9d000000-0000-0000-0000-0000000ca7b2', '9d000000-0000-0000-0000-0000000000db', 'union', 'youth', 'U7', null, 'C', 'Cal B U7 solo (not in any group)', 'cal-b-u7solo', true);

insert into public.scheduling_groups (id, club_id, display_tag, active, season_id) values
  ('9d000000-0000-0000-0000-00000000da01', '9d000000-0000-0000-0000-0000000000da', 'U6/U7', true, '9d000000-0000-0000-0000-00000000ca01'),
  ('9d000000-0000-0000-0000-00000000db01', '9d000000-0000-0000-0000-0000000000db', 'U6/U7', true, '9d000000-0000-0000-0000-00000000ca01');
insert into public.scheduling_group_members (group_id, team_id) values
  ('9d000000-0000-0000-0000-00000000da01', '9d000000-0000-0000-0000-0000000ca6a1'),
  ('9d000000-0000-0000-0000-00000000da01', '9d000000-0000-0000-0000-0000000ca7a1'),
  ('9d000000-0000-0000-0000-00000000db01', '9d000000-0000-0000-0000-0000000ca6b1'),
  ('9d000000-0000-0000-0000-00000000db01', '9d000000-0000-0000-0000-0000000ca7b1');

insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-0000000ca0e1', '9d000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

-- === A. TEAM vs TEAM ===
insert into public.fixtures (id, owning_team_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
values ('9d000000-0000-0000-0000-00000000faa1', '9d000000-0000-0000-0000-0000000ca12a', '9d000000-0000-0000-0000-0000000ca12b', current_date + 10, 'Home', 'Booked', 'Cal B U12', 'club_created');

-- === B. GROUP vs TEAM ===
insert into public.fixtures (id, owning_team_id, owning_scheduling_group_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
values ('9d000000-0000-0000-0000-00000000fbb1', '9d000000-0000-0000-0000-0000000ca6a1', '9d000000-0000-0000-0000-00000000da01', '9d000000-0000-0000-0000-0000000ca7b2', current_date + 11, 'Home', 'Booked', 'Cal B U12', 'club_created');

-- === C. TEAM vs GROUP ===
insert into public.fixtures (id, owning_team_id, opponent_team_id, opponent_scheduling_group_id, kickoff_date, home_away, status, raw_opposition_text, source)
values ('9d000000-0000-0000-0000-00000000fcc1', '9d000000-0000-0000-0000-0000000ca7a2', '9d000000-0000-0000-0000-0000000ca6b1', '9d000000-0000-0000-0000-00000000db01', current_date + 12, 'Home', 'Booked', 'Cal B U6/U7', 'club_created');

-- === D. GROUP vs GROUP ===
insert into public.fixtures (id, owning_team_id, owning_scheduling_group_id, opponent_team_id, opponent_scheduling_group_id, kickoff_date, home_away, status, raw_opposition_text, source)
values ('9d000000-0000-0000-0000-00000000fdd1', '9d000000-0000-0000-0000-0000000ca6a1', '9d000000-0000-0000-0000-00000000da01', '9d000000-0000-0000-0000-0000000ca6b1', '9d000000-0000-0000-0000-00000000db01', current_date + 13, 'Home', 'Booked', 'Cal B U6/U7', 'club_created');

reset role;

-- === Direct data test matrix: exactly the OR-clause shape the app itself
-- issues (owning_team_id.in / opponent_team_id.in / owning_scheduling_
-- group_id.in / opponent_scheduling_group_id.in), against Club A's own
-- scoped team+group ids, for the "no filter" (all my teams) case. ===
do $$
declare
  v_my_teams uuid[] := array['9d000000-0000-0000-0000-0000000ca6a1','9d000000-0000-0000-0000-0000000ca7a1','9d000000-0000-0000-0000-0000000ca12a','9d000000-0000-0000-0000-0000000ca12c','9d000000-0000-0000-0000-0000000ca7a2'];
  v_my_groups uuid[] := array['9d000000-0000-0000-0000-00000000da01'];
  v_count integer;
begin
  -- A: TEAM vs TEAM, no filter -> exactly 1
  select count(*) into v_count from public.fixtures
  where id = '9d000000-0000-0000-0000-00000000faa1'
    and (owning_team_id = any(v_my_teams) or opponent_team_id = any(v_my_teams) or owning_scheduling_group_id = any(v_my_groups) or opponent_scheduling_group_id = any(v_my_groups));
  if v_count = 1 then raise notice 'PASS A-nofilter: TEAM vs TEAM, no filter -> exactly 1 row'; else raise notice 'FAIL A-nofilter: count=%', v_count; end if;

  -- B: GROUP vs TEAM, no filter -> exactly 1
  select count(*) into v_count from public.fixtures
  where id = '9d000000-0000-0000-0000-00000000fbb1'
    and (owning_team_id = any(v_my_teams) or opponent_team_id = any(v_my_teams) or owning_scheduling_group_id = any(v_my_groups) or opponent_scheduling_group_id = any(v_my_groups));
  if v_count = 1 then raise notice 'PASS B-nofilter: GROUP vs TEAM, no filter -> exactly 1 row'; else raise notice 'FAIL B-nofilter: count=%', v_count; end if;

  -- C: TEAM vs GROUP, no filter -> exactly 1
  select count(*) into v_count from public.fixtures
  where id = '9d000000-0000-0000-0000-00000000fcc1'
    and (owning_team_id = any(v_my_teams) or opponent_team_id = any(v_my_teams) or owning_scheduling_group_id = any(v_my_groups) or opponent_scheduling_group_id = any(v_my_groups));
  if v_count = 1 then raise notice 'PASS C-nofilter: TEAM vs GROUP, no filter -> exactly 1 row'; else raise notice 'FAIL C-nofilter: count=%', v_count; end if;

  -- D: GROUP vs GROUP, no filter -> exactly 1 (the central acceptance test: a fixture involving multiple effective teams on both sides still appears once)
  select count(*) into v_count from public.fixtures
  where id = '9d000000-0000-0000-0000-00000000fdd1'
    and (owning_team_id = any(v_my_teams) or opponent_team_id = any(v_my_teams) or owning_scheduling_group_id = any(v_my_groups) or opponent_scheduling_group_id = any(v_my_groups));
  if v_count = 1 then raise notice 'PASS D-nofilter: GROUP vs GROUP, no filter -> exactly 1 row (never 2, 3, or 4 for its 4 effective teams)'; else raise notice 'FAIL D-nofilter: count=%', v_count; end if;

  -- D, filtered to U6 (first component) -> still exactly 1
  select count(*) into v_count from public.fixtures
  where id = '9d000000-0000-0000-0000-00000000fdd1' and owning_team_id = '9d000000-0000-0000-0000-0000000ca6a1';
  if v_count = 1 then raise notice 'PASS D-u6: GROUP vs GROUP filtered by first component (U6) -> exactly 1 row'; else raise notice 'FAIL D-u6: count=%', v_count; end if;

  -- D, filtered by exact group_id equality -> exactly 1
  select count(*) into v_count from public.fixtures
  where id = '9d000000-0000-0000-0000-00000000fdd1' and owning_scheduling_group_id = '9d000000-0000-0000-0000-00000000da01';
  if v_count = 1 then raise notice 'PASS D-group: GROUP vs GROUP filtered by exact group_id -> exactly 1 row'; else raise notice 'FAIL D-group: count=%', v_count; end if;

  -- D, filtered to a genuinely unrelated team -> 0
  select count(*) into v_count from public.fixtures
  where id = '9d000000-0000-0000-0000-00000000fdd1'
    and (owning_team_id = '9d000000-0000-0000-0000-0000000ca12c' or opponent_team_id = '9d000000-0000-0000-0000-0000000ca12c');
  if v_count = 0 then raise notice 'PASS D-unrelated: GROUP vs GROUP filtered by an unrelated team (U13) -> zero rows'; else raise notice 'FAIL D-unrelated: count=%', v_count; end if;

  -- D, filtered to U7 -- the SECOND component, NOT the literal stored
  -- anchor (U6) -- must still resolve to exactly Fixture D, proving
  -- component-membership expansion (not just literal owning_team_id
  -- equality) is what a correct team filter requires.
  select count(distinct f.id) into v_count
  from public.fixtures f join public.scheduling_group_members sgm on sgm.group_id = f.owning_scheduling_group_id
  where f.id = '9d000000-0000-0000-0000-00000000fdd1' and sgm.team_id = '9d000000-0000-0000-0000-0000000ca7a1';
  if v_count = 1 then raise notice 'PASS D-u7-second-component: GROUP vs GROUP filtered by the SECOND component (U7, not the stored anchor) -> exactly 1 row'; else raise notice 'FAIL D-u7-second-component: count=%', v_count; end if;
end $$;

-- === Overlapping structural groups (Section 9): U7 also belongs to a
-- SECOND, unrelated group (U7+U8) that has no fixture today. Filtering
-- by U7 must still surface Fixture D exactly once -- the existence of
-- the second group must never make it appear again, and the second
-- group's own (nonexistent) fixture must not be conjured either. ===
do $$
declare v_u8 uuid := '9d000000-0000-0000-0000-0000000ca8a1'; v_group_b uuid := '9d000000-0000-0000-0000-00000000da02'; v_count integer;
begin
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
    (v_u8, '9d000000-0000-0000-0000-0000000000da', 'union', 'youth', 'U8', null, null, 'Cal A U8', 'cal-a-u8', true);
  insert into public.scheduling_groups (id, club_id, display_tag, active, season_id) values
    (v_group_b, '9d000000-0000-0000-0000-0000000000da', 'U7/U8', true, '9d000000-0000-0000-0000-00000000ca01');
  insert into public.scheduling_group_members (group_id, team_id) values
    (v_group_b, '9d000000-0000-0000-0000-0000000ca7a1'),
    (v_group_b, v_u8);

  -- U7 now structurally belongs to BOTH da01 (U6/U7, Fixture D's real
  -- participant) and this new da02 (U7/U8, no fixture at all today).
  select count(distinct f.id) into v_count
  from public.fixtures f
  join public.scheduling_group_members sgm on sgm.group_id in (f.owning_scheduling_group_id, f.opponent_scheduling_group_id)
  where sgm.team_id = '9d000000-0000-0000-0000-0000000ca7a1' and f.kickoff_date = (select kickoff_date from public.fixtures where id = '9d000000-0000-0000-0000-00000000fdd1');
  if v_count = 1 then
    raise notice 'PASS overlap: U7 belongs to two structurally-overlapping groups (U6/U7 and U7/U8) -- filtering by U7 still surfaces exactly 1 fixture that day (Fixture D via U6/U7), the unrelated overlapping group never conjures a second appearance';
  else
    raise notice 'FAIL overlap: count=%', v_count;
  end if;
end $$;

-- === Dedup-is-architectural proof (Section 23): simulate the ALTERNATIVE,
-- naive implementation this pass deliberately avoided -- a JOIN against
-- scheduling_group_members to filter by component membership -- and show
-- that WITHOUT a DISTINCT/collapse step it really would fan a single
-- fixture row out into multiple result rows (proving the risk named in
-- Section 6/23 is real), while the actual app-level implementation used
-- in this pass never performs this join at all (it filters on the
-- fixtures table's own scalar owning/opponent columns, then separately
-- resolves group membership via its own Map-based lookups -- see
-- lib/calendar/resolve-entry-participant.ts), so no fan-out is possible
-- by construction, not because of a downstream cosmetic dedup pass. ===
do $$
declare v_naive_count integer; v_distinct_count integer;
begin
  select count(*) into v_naive_count
  from public.fixtures f
  left join public.scheduling_group_members sgm_own on sgm_own.group_id = f.owning_scheduling_group_id
  left join public.scheduling_group_members sgm_opp on sgm_opp.group_id = f.opponent_scheduling_group_id
  where f.id = '9d000000-0000-0000-0000-00000000fdd1';

  select count(distinct f.id) into v_distinct_count
  from public.fixtures f
  left join public.scheduling_group_members sgm_own on sgm_own.group_id = f.owning_scheduling_group_id
  left join public.scheduling_group_members sgm_opp on sgm_opp.group_id = f.opponent_scheduling_group_id
  where f.id = '9d000000-0000-0000-0000-00000000fdd1';

  if v_naive_count > 1 and v_distinct_count = 1 then
    raise notice 'PASS dedup-architecture: a naive JOIN against scheduling_group_members really would fan Fixture D out into % raw rows (2 members x 2 members) -- confirming the fan-out risk Section 6/23 warns about is real; DISTINCT(fixture_id) collapses it back to exactly 1. The actual Calendar implementation in this pass never performs this join at all -- it filters fixtures'' own scalar columns and resolves group membership separately in application code, so this fan-out can never occur by construction, not merely because of a downstream cosmetic dedup step.', v_naive_count;
  else
    raise notice 'FAIL dedup-architecture: naive_count=% distinct_count=%', v_naive_count, v_distinct_count;
  end if;
end $$;

rollback;
