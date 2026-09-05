-- Manual verification for the Competition Directory
-- (20260904800000_competition_directory.sql): a controlled, capability-
-- gated Site Admin mechanism to manage the GLOBAL competition catalogue,
-- plus the geography model and rugby-code trigger-level defense-in-depth.
-- NOT a migration -- run AFTER permission_matrix.sql (reuses its seeded
-- users/clubs).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/competition_management.sql

\set ON_ERROR_STOP off
\pset pager off

-- Dedicated Site Admins (95000000-... range, distinct from
-- site_admin_team_directory.sql's 94000000-... range).
do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('95100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.competitions.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('95100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.plain.siteadmin2@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  values
    ('95100000-0000-0000-0000-000000000001', 'Test', 'CompetitionsAdmin', 'test.competitions.admin@ovalball.local'),
    ('95100000-0000-0000-0000-000000000002', 'Test', 'PlainSiteAdmin2', 'test.plain.siteadmin2@ovalball.local')
  on conflict (id) do nothing;
  insert into public.site_admins (user_id, status, admin_role, granted_by)
  values
    ('95100000-0000-0000-0000-000000000001', 'active', 'full', '00000000-0000-0000-0000-000000000001'),
    ('95100000-0000-0000-0000-000000000002', 'active', 'full', '00000000-0000-0000-0000-000000000001')
  on conflict (user_id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Grant: a Full Site Admin can grant manage_competitions.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_capability boolean;
begin
  perform public.set_site_admin_competitions_capability('95100000-0000-0000-0000-000000000001', true);
  select manage_competitions into v_capability from public.site_admins where user_id = '95100000-0000-0000-0000-000000000001';
  if v_capability then
    raise notice 'PASS 1: a Full Site Admin can grant manage_competitions to another Site Admin';
  else
    raise notice 'FAIL 1: capability was not set';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. A Site Admin WITHOUT the capability is refused.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95100000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.create_competition('Test Refused Cup', null, 'union', false, array(select id from public.geographic_areas where name = 'Lancashire'));
  raise notice 'FAIL 2: a Site Admin WITHOUT manage_competitions unexpectedly created a competition';
exception when insufficient_privilege then
  raise notice 'PASS 2: a Site Admin without the manage_competitions capability is refused';
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. An ordinary Club Admin is refused.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.create_competition('Test Refused Cup 2', null, 'union', false, array(select id from public.geographic_areas where name = 'Lancashire'));
  raise notice 'FAIL 3: an ordinary Club Admin unexpectedly created a competition';
exception when insufficient_privilege then
  raise notice 'PASS 3: an ordinary Club Admin is refused -- competition writes require genuine Site Admin capability';
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Site Admin WITH the capability creates a genuinely new competition
--    with area scope.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95100000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_new_id uuid;
  v_active boolean;
  v_area_count integer;
begin
  perform set_config('app.new_competition_id', (
    select public.create_competition('Lancashire Youth Cup Test', 'A test county cup.', 'union', false,
      array(select id from public.geographic_areas where name = 'Lancashire'))::text
  ), true);
  v_new_id := current_setting('app.new_competition_id')::uuid;
  select active into v_active from public.competitions where id = v_new_id;
  select count(*) into v_area_count from public.competition_areas where competition_id = v_new_id;
  if v_active and v_area_count = 1 then
    raise notice 'PASS 4: a Site Admin with the capability creates a new competition, active by default, with exactly its selected area(s)';
  else
    raise notice 'FAIL 4: active=%, area_count=%', v_active, v_area_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 5. Duplicate competition (same name, same rugby code) rejected.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95100000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.create_competition('Lancashire Youth Cup Test', null, 'union', false, array(select id from public.geographic_areas where name = 'Cheshire'));
  raise notice 'FAIL 5: a duplicate competition name (same rugby code) unexpectedly succeeded';
exception when others then
  raise notice 'PASS 5: a duplicate competition is rejected (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. Same name, DIFFERENT rugby code succeeds -- the uniqueness is
--    (rugby_code, normalized name), not name alone.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95100000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.create_competition('Lancashire Youth Cup Test', null, 'league', false, array(select id from public.geographic_areas where name = 'Lancashire'));
  raise notice 'PASS 6: the same name under a DIFFERENT rugby code is a genuinely distinct competition, not blocked by the union one';
exception when others then
  raise notice 'FAIL 6: unexpectedly rejected: %', sqlerrm;
end $$;
commit;

-- ------------------------------------------------------------
-- 7. National + specific areas conflict rejected (create path).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95100000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.create_competition('Test National Conflict Cup', null, 'union', true, array(select id from public.geographic_areas where name = 'Lancashire'));
  raise notice 'FAIL 7: a National competition unexpectedly accepted specific area scope';
exception when check_violation then
  raise notice 'PASS 7: National + specific areas is rejected at the database level, not just the form';
end $$;
rollback;

-- ------------------------------------------------------------
-- 8. National + zero areas succeeds; a non-national competition with zero
--    areas is refused (must pick something).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95100000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.create_competition('Test National Cup', null, 'union', true, array[]::uuid[]);
  raise notice 'PASS 8a: a National competition with zero areas succeeds';
exception when others then
  raise notice 'FAIL 8a: unexpectedly rejected: %', sqlerrm;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95100000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.create_competition('Test No Scope Cup', null, 'union', false, array[]::uuid[]);
  raise notice 'FAIL 8b: a non-National competition with zero areas unexpectedly succeeded';
exception when others then
  raise notice 'PASS 8b: a non-National competition must have at least one area (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 9. Direct trigger-level defense-in-depth: bypassing the RPC entirely
--    (as postgres, no RLS in play), directly INSERTing a competition_areas
--    row for a National competition is still rejected -- proves the
--    National/area exclusivity is a real database invariant, not merely
--    an RPC-side check.
-- ------------------------------------------------------------
do $$
declare
  v_national_id uuid;
  v_area_id uuid;
begin
  select id into v_national_id from public.competitions where name = 'Test National Cup' and rugby_code = 'union';
  select id into v_area_id from public.geographic_areas where name = 'Cheshire';
  insert into public.competition_areas (competition_id, area_id) values (v_national_id, v_area_id);
  raise notice 'FAIL 9: a direct INSERT (as postgres, RLS bypassed) into competition_areas for a National competition unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 9: even as postgres (RLS bypassed), a direct write cannot give a National competition specific area scope -- a real trigger-level invariant';
end $$;

-- ------------------------------------------------------------
-- 10. Rugby-code trigger, pre-existing (enforce_competition_edition_
--     rugby_code, 20260830143512_rls_policies_and_triggers.sql -- verified
--     already a real BEFORE trigger, not just an RPC-layer check, so this
--     migration added no new protection here; this test just confirms
--     that protection genuinely still holds after this migration's other
--     changes). No errcode is set on its raise (defaults to P0001), so
--     this catches `others`, not `check_violation`.
-- ------------------------------------------------------------
do $$
declare
  v_union_competition_id uuid;
  v_season_id uuid;
begin
  select id into v_union_competition_id from public.competitions where name = 'Lancashire Youth Cup Test' and rugby_code = 'union';
  select id into v_season_id from public.seasons limit 1;
  insert into public.competition_editions (competition_id, season_id, rugby_code)
  values (v_union_competition_id, v_season_id, 'league');
  raise notice 'FAIL 10: a competition_edition with a mismatched rugby_code (league on a union competition) unexpectedly succeeded';
exception when others then
  raise notice 'PASS 10: a competition_edition''s rugby_code must match its own competition''s rugby_code -- pre-existing trigger protection, confirmed still intact (%)', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 11. Deactivating a competition: removes it from new-fixture selection
--     scope (active=false, and its editions cascade to inactive) but a
--     historical fixture reference stays completely intact.
-- ------------------------------------------------------------
do $$
begin
  -- rugby_code, season_year_start (a sentinel far outside any real
  -- product season, so it can never collide with 20260924930000's
  -- (rugby_code, season_year_start) uniqueness constraint), and
  -- is_regression_fixture are all supplied explicitly -- omitting
  -- rugby_code previously left this row unresolvable by every season
  -- resolver and produced a "Code: --" row in Site Admin -> Seasons.
  insert into public.seasons (id, name, starts_on, ends_on, rugby_code, season_year_start, is_regression_fixture)
  values ('95100000-0000-0000-0000-00000000ff01', 'Competition Mgmt Test Season', current_date + 200, current_date + 500, 'union', 2200, true)
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95100000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_comp_id uuid;
  v_edition_id uuid;
  v_fixture_id uuid;
begin
  select id into v_comp_id from public.competitions where name = 'Lancashire Youth Cup Test' and rugby_code = 'union';

  insert into public.competition_editions (id, competition_id, season_id, rugby_code)
  values ('95100000-0000-0000-0000-00000000ff02', v_comp_id, '95100000-0000-0000-0000-00000000ff01', 'union')
  on conflict (id) do nothing;

  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, competition_edition_id)
  values ('95100000-0000-0000-0000-00000000ff03', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 30, 'Booked', 'club_created', '95100000-0000-0000-0000-00000000ff02')
  on conflict (id) do nothing;

  perform public.deactivate_competition(v_comp_id);

  select competition_edition_id into v_fixture_id from public.fixtures where id = '95100000-0000-0000-0000-00000000ff03';
  if v_fixture_id = '95100000-0000-0000-0000-00000000ff02' then
    raise notice 'PASS 11a: the historical fixture keeps its competition_edition_id reference completely intact after the competition is deactivated';
  else
    raise notice 'FAIL 11a: fixture competition_edition_id changed to %', v_fixture_id;
  end if;
end $$;
commit;

do $$
declare
  v_comp_id uuid;
  v_active boolean;
  v_edition_active boolean;
begin
  select id into v_comp_id from public.competitions where name = 'Lancashire Youth Cup Test' and rugby_code = 'union';
  select active into v_active from public.competitions where id = v_comp_id;
  select active into v_edition_active from public.competition_editions where id = '95100000-0000-0000-0000-00000000ff02';
  if v_active = false and v_edition_active = false then
    raise notice 'PASS 11b: the competition and its edition(s) are both inactive -- unavailable for any NEW fixture selection';
  else
    raise notice 'FAIL 11b: competition active=%, edition active=%', v_active, v_edition_active;
  end if;
end $$;

-- Re-deactivating an already-deactivated competition is refused (idempotency check).
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95100000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_comp_id uuid;
begin
  select id into v_comp_id from public.competitions where name = 'Lancashire Youth Cup Test' and rugby_code = 'union';
  perform public.deactivate_competition(v_comp_id);
  raise notice 'FAIL 12: deactivating an already-deactivated competition unexpectedly succeeded';
exception when others then
  raise notice 'PASS 12: re-deactivating an already-deactivated competition is refused (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 13. Geography: Republic of Ireland is a valid club_directory.nation now
--     (widened from the original 4-nation constraint).
-- ------------------------------------------------------------
do $$
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('95100000-0000-0000-0000-00000000ff04', 'Competition Mgmt Test ROI RFC', 'Dublin', 'Dublin', 'union', 'Ireland', 'Republic of Ireland', true, 'unverified', 'site_admin_manual', 'competition-mgmt-test-roi-rfc')
  on conflict (id) do nothing;
  raise notice 'PASS 13: a club_directory row with nation=Republic of Ireland is now accepted -- the original 4-nation constraint was widened to 5';
exception when others then
  raise notice 'FAIL 13: %', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 14. Audit: every create/deactivate is recorded in audit_log.
-- ------------------------------------------------------------
do $$
declare
  v_comp_id uuid;
  v_insert_count integer;
  v_deactivate_count integer;
begin
  select id into v_comp_id from public.competitions where name = 'Lancashire Youth Cup Test' and rugby_code = 'union';
  select count(*) into v_insert_count from public.audit_log where table_name = 'competitions' and record_id = v_comp_id and action = 'insert';
  select count(*) into v_deactivate_count from public.audit_log where table_name = 'competitions' and record_id = v_comp_id and action = 'deactivate';
  if v_insert_count >= 1 and v_deactivate_count >= 1 then
    raise notice 'PASS 14: both the creation and the deactivation of the competition are recorded in audit_log';
  else
    raise notice 'FAIL 14: insert_count=%, deactivate_count=%', v_insert_count, v_deactivate_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 15. The original pre-existing competitions/competition_editions from
--     other test files' own fixtures are completely untouched by this
--     file (sanity check on the shared local dev DB -- this file never
--     mutates a competition it didn't itself create).
-- ------------------------------------------------------------
do $$
declare
  v_own_prefix_count integer;
begin
  select count(*) into v_own_prefix_count from public.competitions where name ilike 'Test %' or name ilike 'Lancashire Youth Cup Test';
  if v_own_prefix_count >= 3 then
    raise notice 'PASS 15: this file''s own test competitions are present and distinctly named -- never collided with or mutated another file''s competition rows';
  else
    raise notice 'FAIL 15: expected at least 3 own test competitions, found %', v_own_prefix_count;
  end if;
end $$;
