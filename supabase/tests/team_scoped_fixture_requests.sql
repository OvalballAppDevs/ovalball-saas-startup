-- Manual verification for Team Manager / Coach permission parity, part 2
-- (20260903800000): a team-scoped-only Coach/Manager/Team Admin (no
-- separate club-wide CLUB_ADMIN/FIXTURE_SECRETARY role) can create a
-- fixture_request_groups row for their own team, and fixture_request_groups
-- select/insert/update no longer triggers RLS policy recursion. NOT a
-- migration -- run after permission_matrix.sql:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/team_scoped_fixture_requests.sql
--
-- Self-contained: two fresh standalone clubs, never Burnley/Rossendale.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    ('99b00000-0000-0000-0000-0000000d0001', 'Team Scoped Test Home RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'team-scoped-test-home-99b00000'),
    ('99b00000-0000-0000-0000-0000000d0002', 'Team Scoped Test Away RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'team-scoped-test-away-99b00000')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status) values
    ('99b00000-0000-0000-0000-0000000c0001', '99b00000-0000-0000-0000-0000000d0001', 'team-scoped-test-home-99b00000', 'active'),
    ('99b00000-0000-0000-0000-0000000c0002', '99b00000-0000-0000-0000-0000000d0002', 'team-scoped-test-away-99b00000', 'active')
  on conflict (id) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change) values
    ('99b00000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.tsc.coach@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99b00000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.tsc.otherteam@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99b00000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.tsc.awayadmin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email) values
    ('99b00000-0000-0000-0000-000000000101', 'Test', 'TscCoach', 'test.tsc.coach@ovalball.local'),
    ('99b00000-0000-0000-0000-000000000102', 'Test', 'TscOtherTeam', 'test.tsc.otherteam@ovalball.local'),
    ('99b00000-0000-0000-0000-000000000201', 'Test', 'TscAwayAdmin', 'test.tsc.awayadmin@ovalball.local')
  on conflict (id) do nothing;

  -- Both team-scoped users are plain BASIC_USER club members at Home --
  -- neither has CLUB_ADMIN/FIXTURE_SECRETARY there.
  insert into public.club_memberships (id, club_id, user_id, role, status) values
    ('99b00000-0000-0000-0000-000000000103', '99b00000-0000-0000-0000-0000000c0001', '99b00000-0000-0000-0000-000000000101', 'BASIC_USER', 'active'),
    ('99b00000-0000-0000-0000-000000000104', '99b00000-0000-0000-0000-0000000c0001', '99b00000-0000-0000-0000-000000000102', 'BASIC_USER', 'active'),
    ('99b00000-0000-0000-0000-000000000202', '99b00000-0000-0000-0000-0000000c0002', '99b00000-0000-0000-0000-000000000201', 'CLUB_ADMIN', 'active')
  on conflict (id) do nothing;

  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug) values
    ('99b00000-0000-0000-0000-000000000105', '99b00000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U12', 'boys', null, 'Team Scoped Test Home RUFC U12 Boys', 'tsc-home-u12-boys'),
    ('99b00000-0000-0000-0000-000000000106', '99b00000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U12', 'boys', 'B', 'Team Scoped Test Home RUFC U12 Boys B', 'tsc-home-u12-boys-b'),
    ('99b00000-0000-0000-0000-000000000203', '99b00000-0000-0000-0000-0000000c0002', 'union', 'youth', 'U12', 'boys', null, 'Team Scoped Test Away RUFC U12 Boys', 'tsc-away-u12-boys')
  on conflict (id) do nothing;

  -- test.tsc.coach@ovalball.local is a Coach for team A ONLY. test.tsc.otherteam@ovalball.local is a Coach for team B ONLY -- used to prove SELECT stays scoped to a caller's own visible requests, not "any team at the club".
  insert into public.team_permissions (id, membership_id, team_id, permission) values
    ('99b00000-0000-0000-0000-000000000107', '99b00000-0000-0000-0000-000000000103', '99b00000-0000-0000-0000-000000000105', 'coach'),
    ('99b00000-0000-0000-0000-000000000108', '99b00000-0000-0000-0000-000000000104', '99b00000-0000-0000-0000-000000000106', 'coach')
  on conflict (id) do nothing;
end $$;

\echo '=== Fixtures ready. Running team-scoped fixture request scenarios. ==='

-- ------------------------------------------------------------
-- 1. A team-scoped-only Coach (no club-wide role) CAN insert a
--    fixture_request_groups row for their own club -- this used to fail
--    with "new row violates row-level security policy" before
--    20260903800000.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99b00000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  begin
    insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, proposed_date, raw_opponent_text, created_by)
    values ('99b00000-0000-0000-0000-0000000c0001', '99b00000-0000-0000-0000-0000000c0002', current_date + 30, 'Team Scoped Test Away RUFC', '99b00000-0000-0000-0000-000000000101')
    returning id into v_group_id;
    raise notice 'PASS 1: team-scoped-only Coach created a fixture_request_groups row (id=%)', v_group_id;
  exception when others then
    raise notice 'FAIL 1: team-scoped-only Coach could not create a fixture_request_groups row (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. Full end-to-end: the group row PLUS its fixture_requests child row,
--    both by the same team-scoped Coach, in one transaction -- exactly
--    what the real "Request a Fixture" form does.
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
  v_request_id uuid;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99b00000-0000-0000-0000-000000000101","role":"authenticated"}';

  insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, proposed_date, raw_opponent_text, created_by)
  values ('99b00000-0000-0000-0000-0000000c0001', '99b00000-0000-0000-0000-0000000c0002', current_date + 31, 'Team Scoped Test Away RUFC', '99b00000-0000-0000-0000-000000000101')
  returning id into v_group_id;

  insert into public.fixture_requests (group_id, requesting_team_id, venue_preference, status, created_by)
  values (v_group_id, '99b00000-0000-0000-0000-000000000105', 'home', 'sent', '99b00000-0000-0000-0000-000000000101')
  returning id into v_request_id;

  if v_group_id is not null and v_request_id is not null then
    raise notice 'PASS 2: end-to-end group + request creation succeeded for a team-scoped-only Coach';
  else
    raise notice 'FAIL 2: end-to-end creation did not produce both rows';
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. The requesting Coach can SELECT their own group back (no recursion
--    error), and the away club's Club Admin can also see it (opponent
--    side, club-wide authority -- the pre-existing path, unaffected).
-- ------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99b00000-0000-0000-0000-000000000101","role":"authenticated"}';
  select count(*) into v_count from public.fixture_request_groups where requesting_club_id = '99b00000-0000-0000-0000-0000000c0001';
  if v_count >= 1 then
    raise notice 'PASS 3a: requesting Coach can select their own groups back (count=%)', v_count;
  else
    raise notice 'FAIL 3a: expected at least 1 visible group, got %', v_count;
  end if;
end $$;

do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99b00000-0000-0000-0000-000000000201","role":"authenticated"}';
  select count(*) into v_count from public.fixture_request_groups where opponent_club_id = '99b00000-0000-0000-0000-0000000c0002';
  if v_count >= 1 then
    raise notice 'PASS 3b: opponent club-wide admin can still see the incoming groups (count=%)', v_count;
  else
    raise notice 'FAIL 3b: expected at least 1 visible group for the opponent admin, got %', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. A DIFFERENT team-scoped Coach at the SAME club, with no permission
--    on the requesting team, cannot see the group -- SELECT stays scoped
--    to "groups with a request I can see", never "any group at my club".
-- ------------------------------------------------------------
do $$
declare
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99b00000-0000-0000-0000-000000000102","role":"authenticated"}';
  select count(*) into v_count from public.fixture_request_groups where requesting_club_id = '99b00000-0000-0000-0000-0000000c0001';
  if v_count = 0 then
    raise notice 'PASS 4: an unrelated team-scoped Coach at the same club cannot see the other team''s group';
  else
    raise notice 'FAIL 4: unrelated team-scoped Coach could see % groups belonging to a team they do not manage', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. The team-scoped Coach can UPDATE (e.g. cancel) their own group.
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
  v_updated_rows int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99b00000-0000-0000-0000-000000000101","role":"authenticated"}';

  select id into v_group_id from public.fixture_request_groups
    where requesting_club_id = '99b00000-0000-0000-0000-0000000c0001'
    order by created_at desc limit 1;

  update public.fixture_request_groups set raw_opponent_text = 'Team Scoped Test Away RUFC (updated)' where id = v_group_id;
  get diagnostics v_updated_rows = row_count;

  if v_updated_rows = 1 then
    raise notice 'PASS 5: team-scoped-only Coach can update their own fixture_request_groups row';
  else
    raise notice 'FAIL 5: update affected % rows, expected 1', v_updated_rows;
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. A team-scoped-only Coach CANNOT create a group for a club they have
--    no team authority at (never a blanket "any authenticated user").
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99b00000-0000-0000-0000-000000000101","role":"authenticated"}';
do $$
begin
  begin
    insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, proposed_date, raw_opponent_text, created_by)
    values ('99b00000-0000-0000-0000-0000000c0002', '99b00000-0000-0000-0000-0000000c0001', current_date + 32, 'Team Scoped Test Home RUFC', '99b00000-0000-0000-0000-000000000101');
    raise notice 'FAIL 6: created a group for a club the caller has no authority at';
  exception when others then
    raise notice 'PASS 6: creating a group for an unrelated club is refused (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. An ordinary club-wide Club Admin (the pre-existing, unaffected path)
--    can still create and see groups without hitting the new recursion
--    class of bug -- regression safety on the original behavior.
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
  v_count int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99b00000-0000-0000-0000-000000000201","role":"authenticated"}';

  insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, proposed_date, raw_opponent_text, created_by)
  values ('99b00000-0000-0000-0000-0000000c0002', '99b00000-0000-0000-0000-0000000c0001', current_date + 33, 'Team Scoped Test Home RUFC', '99b00000-0000-0000-0000-000000000201')
  returning id into v_group_id;

  select count(*) into v_count from public.fixture_request_groups where id = v_group_id;

  if v_group_id is not null and v_count = 1 then
    raise notice 'PASS 7: club-wide Club Admin path still works with no recursion error';
  else
    raise notice 'FAIL 7: club-wide Club Admin path broke';
  end if;
end $$;
