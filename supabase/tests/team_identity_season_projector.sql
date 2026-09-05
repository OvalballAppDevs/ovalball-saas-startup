-- Manual verification for 20260924820000_team_identity_season_projector.sql:
-- internal.project_team_identity() (pure age-ladder projection, no DB
-- reads) and public.get_team_identity_for_season()'s new projection
-- tier (snapshot -> projection -> current live row).
--
-- Uses one isolated test club (prefix 9d000000, never used anywhere
-- else in local seed data) so re-running this file cannot collide with
-- real Burnley/Rossendale teams or any other test file's isolated
-- clubs. Real `seasons` rows ARE reused (read-only, shared reference
-- data spanning multiple real seasons already seeded locally) since
-- the projector's whole point is walking real season boundaries.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/team_identity_season_projector.sql

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    ('9d000000-0000-0000-0000-0000000d0003', 'Team Identity Projector Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'team-identity-projector-test-club-9d000000')
  on conflict (id) do nothing;

  insert into public.clubs (id, directory_id, slug, status) values
    ('9d000000-0000-0000-0000-0000000c0003', '9d000000-0000-0000-0000-0000000d0003', 'team-identity-projector-test-club-9d000000', 'active')
  on conflict (id) do nothing;

  -- U9 boys, U10 mixed (to exercise the U11 boundary), and U16 (to
  -- exercise the "no automatic mapping" terminal case) -- each active,
  -- each a distinct age so no canonical-identity collision is possible.
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, gender, display_name, slug, active) values
    ('9d000000-0000-0000-0000-000000000901', '9d000000-0000-0000-0000-0000000c0003', 'union', 'youth', 'U9', null, null, 'U9', 'ti-test-u9', true),
    ('9d000000-0000-0000-0000-000000000902', '9d000000-0000-0000-0000-0000000c0003', 'union', 'youth', 'U10', null, 'mixed', 'U10', 'ti-test-u10-mixed', true),
    ('9d000000-0000-0000-0000-000000000903', '9d000000-0000-0000-0000-0000000c0003', 'union', 'youth', 'U16', null, null, 'U16', 'ti-test-u16', true),
    ('9d000000-0000-0000-0000-000000000904', '9d000000-0000-0000-0000-0000000c0003', 'union', 'youth', 'U12', null, 'girls', 'Girls U12', 'ti-test-u12-girls', true)
  on conflict (id) do nothing;
end $$;

-- Test 1-3: internal.project_team_identity() in isolation (pure
-- function, exercises the age ladder directly with no team/season rows
-- at all).
do $$
declare
  v_age text; v_det boolean;
begin
  select projected_age_group, is_deterministic into v_age, v_det from internal.project_team_identity('U9', null, 2);
  if v_age = 'U11' and v_det then
    raise notice 'PASS 1: U9 + 2 seasons (non-mixed) -> U11, deterministic';
  else
    raise notice 'FAIL 1: got age=% deterministic=%', v_age, v_det;
  end if;

  select projected_age_group, is_deterministic into v_age, v_det from internal.project_team_identity('U16', null, 1);
  if v_age is null and not v_det then
    raise notice 'PASS 2: U16 + 1 season -> non-deterministic (no automatic mapping past U16, matching generate_rollover_proposal)';
  else
    raise notice 'FAIL 2: got age=% deterministic=%', v_age, v_det;
  end if;

  select projected_age_group, is_deterministic into v_age, v_det from internal.project_team_identity('U10', 'mixed', 2);
  if v_age is null and not v_det then
    raise notice 'PASS 3: Mixed U10 + 2 seasons (crosses the U11 -> U12 structural boundary) -> non-deterministic';
  else
    raise notice 'FAIL 3: got age=% deterministic=%', v_age, v_det;
  end if;
end $$;

-- Tests 4-8: public.get_team_identity_for_season() against the real
-- season chain seeded locally (Rugby Union 26/27 = current as of any
-- date in this local database's seed window; 27/28 = +1; 28/29 = +2).
do $$
declare
  v_current_season uuid := internal.resolve_season_for_date('union', current_date);
  v_plus1_season uuid;
  v_plus2_season uuid;
  v_current_starts date;
  r record;
begin
  select starts_on into v_current_starts from public.seasons where id = v_current_season;
  -- Real seasons only: another test file (tournaments.sql) leaves a
  -- persistent regression-fixture union season behind by design, and
  -- without this filter it can land inside this real +1/+2 chain and
  -- silently shift which real season "plus1"/"plus2" actually means --
  -- matching the same is_regression_fixture convention the resolver
  -- functions themselves now use (20260925010000).
  select id into v_plus1_season from public.seasons where rugby_code = 'union' and is_regression_fixture = false and starts_on > v_current_starts order by starts_on asc limit 1;
  select id into v_plus2_season from public.seasons where rugby_code = 'union' and is_regression_fixture = false and starts_on > (select starts_on from public.seasons where id = v_plus1_season) order by starts_on asc limit 1;

  if v_current_season is null or v_plus1_season is null or v_plus2_season is null then
    raise notice 'SKIP 4-8: local seed data does not have a current + 2 future union seasons to project across (re-seed to run this section)';
    return;
  end if;

  select * into r from public.get_team_identity_for_season('9d000000-0000-0000-0000-000000000901', v_current_season);
  if r.age_group = 'U9' and not r.is_projected then
    raise notice 'PASS 4: current season resolves to the live row, not flagged as projected';
  else
    raise notice 'FAIL 4: age_group=% is_projected=%', r.age_group, r.is_projected;
  end if;

  select * into r from public.get_team_identity_for_season('9d000000-0000-0000-0000-000000000901', v_plus1_season);
  if r.age_group = 'U10' and r.is_projected then
    raise notice 'PASS 5: +1 season with no snapshot yet projects U9 -> U10, flagged is_projected';
  else
    raise notice 'FAIL 5: age_group=% is_projected=%', r.age_group, r.is_projected;
  end if;

  select * into r from public.get_team_identity_for_season('9d000000-0000-0000-0000-000000000901', v_plus2_season);
  if r.age_group = 'U11' and r.is_projected then
    raise notice 'PASS 6: +2 seasons projects U9 -> U11, flagged is_projected';
  else
    raise notice 'FAIL 6: age_group=% is_projected=%', r.age_group, r.is_projected;
  end if;

  select * into r from public.get_team_identity_for_season('9d000000-0000-0000-0000-000000000902', v_plus2_season);
  if r.age_group = 'U10' and not r.is_projected then
    raise notice 'PASS 7: Mixed U10 +2 seasons (crosses the U11 -> U12 boundary) honestly falls back to the current live U10, never fabricates a guess';
  else
    raise notice 'FAIL 7: age_group=% is_projected=%', r.age_group, r.is_projected;
  end if;

  select * into r from public.get_team_identity_for_season('9d000000-0000-0000-0000-000000000904', v_plus1_season);
  if r.age_group = 'U13' and r.display_name = 'Girls U13' and r.is_projected then
    raise notice 'PASS 8: Girls U12 +1 season projects to Girls U13 with the club''s own "Girls " naming convention reconstructed, flagged is_projected';
  else
    raise notice 'FAIL 8: age_group=% display_name=% is_projected=%', r.age_group, r.display_name, r.is_projected;
  end if;
end $$;
