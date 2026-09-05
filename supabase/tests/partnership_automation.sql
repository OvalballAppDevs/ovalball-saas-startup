-- Manual verification for Phase D (partnership half) -- automatic
-- Partnership Request creation on fixture-request acceptance
-- (20260903500000). NOT a migration -- run AFTER permission_matrix.sql.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/partnership_automation.sql
--
-- Self-contained: fresh standalone clubs throughout, never Burnley/
-- Rossendale -- other test files in the full ordered suite legitimately
-- leave a real Burnley<->Rossendale partnership behind (see
-- scheduling_groups.sql's own comment), which would make "not already
-- partners" scenarios here order-dependent.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  -- Club A (home) and Club B (away): the ordinary two-active-clubs case.
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    ('99900000-0000-0000-0000-0000000d0001', 'Auto Partner Test Home RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'auto-partner-test-home-99900000'),
    ('99900000-0000-0000-0000-0000000d0002', 'Auto Partner Test Away RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'auto-partner-test-away-99900000'),
    ('99900000-0000-0000-0000-0000000d0003', 'Auto Partner Test Deactivated RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'auto-partner-test-deactivated-99900000')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status) values
    ('99900000-0000-0000-0000-0000000c0001', '99900000-0000-0000-0000-0000000d0001', 'auto-partner-test-home-99900000', 'active'),
    ('99900000-0000-0000-0000-0000000c0002', '99900000-0000-0000-0000-0000000d0002', 'auto-partner-test-away-99900000', 'active'),
    ('99900000-0000-0000-0000-0000000c0003', '99900000-0000-0000-0000-0000000d0003', 'auto-partner-test-deactivated-99900000', 'active')
  on conflict (id) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change) values
    ('99900000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.autopartner.home@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99900000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.autopartner.away@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99900000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.autopartner.deactivated@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email) values
    ('99900000-0000-0000-0000-000000000101', 'Test', 'AutoPartnerHome', 'test.autopartner.home@ovalball.local'),
    ('99900000-0000-0000-0000-000000000201', 'Test', 'AutoPartnerAway', 'test.autopartner.away@ovalball.local'),
    ('99900000-0000-0000-0000-000000000301', 'Test', 'AutoPartnerDeactivated', 'test.autopartner.deactivated@ovalball.local')
  on conflict (id) do nothing;
  insert into public.club_memberships (id, club_id, user_id, role, status) values
    ('99900000-0000-0000-0000-000000000102', '99900000-0000-0000-0000-0000000c0001', '99900000-0000-0000-0000-000000000101', 'CLUB_ADMIN', 'active'),
    ('99900000-0000-0000-0000-000000000202', '99900000-0000-0000-0000-0000000c0002', '99900000-0000-0000-0000-000000000201', 'CLUB_ADMIN', 'active'),
    ('99900000-0000-0000-0000-000000000302', '99900000-0000-0000-0000-0000000c0003', '99900000-0000-0000-0000-000000000301', 'CLUB_ADMIN', 'active')
  on conflict (id) do nothing;

  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug) values
    ('99900000-0000-0000-0000-000000000103', '99900000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U12', 'boys', 'Auto Partner Test Home RUFC U12 Boys', 'apt-home-u12-boys'),
    ('99900000-0000-0000-0000-000000000203', '99900000-0000-0000-0000-0000000c0002', 'union', 'youth', 'U12', 'boys', 'Auto Partner Test Away RUFC U12 Boys', 'apt-away-u12-boys'),
    ('99900000-0000-0000-0000-000000000303', '99900000-0000-0000-0000-0000000c0003', 'union', 'youth', 'U12', 'boys', 'Auto Partner Test Deactivated RUFC U12 Boys', 'apt-deactivated-u12-boys')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1/2. Ordinary case: accepting a fixture request between two distinct,
--      active, not-yet-partnered clubs creates exactly one PENDING
--      Partnership Request, attributed to the fixture that triggered it,
--      and the responding club is notified.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixture_request_groups (id, requesting_club_id, opponent_club_id, opponent_directory_id, raw_opponent_text, proposed_date, created_by)
  values ('99900000-0000-0000-0000-000000000401', '99900000-0000-0000-0000-0000000c0001', '99900000-0000-0000-0000-0000000c0002', '99900000-0000-0000-0000-0000000d0002', 'Auto Partner Test Away RUFC', current_date + 10, '99900000-0000-0000-0000-000000000101')
  on conflict (id) do nothing;
  insert into public.fixture_requests (id, group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values ('99900000-0000-0000-0000-000000000402', '99900000-0000-0000-0000-000000000401', '99900000-0000-0000-0000-000000000103', '99900000-0000-0000-0000-000000000203', 'away', 'sent', '99900000-0000-0000-0000-000000000101')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99900000-0000-0000-0000-000000000201","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
  v_partnership_count integer;
  v_status text;
  v_requesting_club uuid;
  v_partner_club uuid;
  v_source_fixture uuid;
begin
  v_fixture_id := public.accept_fixture_request('99900000-0000-0000-0000-000000000402', null);

  select count(*) into v_partnership_count from public.club_partnerships
  where least(requesting_club_id, partner_club_id) = least('99900000-0000-0000-0000-0000000c0001'::uuid, '99900000-0000-0000-0000-0000000c0002'::uuid)
    and greatest(requesting_club_id, partner_club_id) = greatest('99900000-0000-0000-0000-0000000c0001'::uuid, '99900000-0000-0000-0000-0000000c0002'::uuid);

  select status, requesting_club_id, partner_club_id, source_fixture_id into v_status, v_requesting_club, v_partner_club, v_source_fixture
  from public.club_partnerships
  where least(requesting_club_id, partner_club_id) = least('99900000-0000-0000-0000-0000000c0001'::uuid, '99900000-0000-0000-0000-0000000c0002'::uuid)
    and greatest(requesting_club_id, partner_club_id) = greatest('99900000-0000-0000-0000-0000000c0001'::uuid, '99900000-0000-0000-0000-0000000c0002'::uuid);

  if v_partnership_count = 1 then
    raise notice 'PASS 1: accepting a fixture request between two active, not-yet-partnered clubs creates exactly one Partnership Request';
  else
    raise notice 'FAIL 1: expected exactly 1 club_partnerships row, found %', v_partnership_count;
  end if;

  if v_status = 'pending' and v_source_fixture = v_fixture_id and v_requesting_club = '99900000-0000-0000-0000-0000000c0001' and v_partner_club = '99900000-0000-0000-0000-0000000c0002' then
    raise notice 'PASS 2: the auto-created partnership is pending (never auto-accepted), attributed to the real fixture that triggered it';
  else
    raise notice 'FAIL 2: status=%, source_fixture=% (expected %), requesting_club=%, partner_club=%', v_status, v_source_fixture, v_fixture_id, v_requesting_club, v_partner_club;
  end if;
end $$;
commit;

do $$
begin
  if exists (
    select 1 from public.notifications
    where user_id = '99900000-0000-0000-0000-000000000201' and type = 'partner_request_received'
  ) then
    raise notice 'PASS 3: the responding club (who just accepted the fixture) is notified of the new Partnership Request, same as any manually-created one';
  else
    raise notice 'FAIL 3: no partner_request_received notification found for the responding club';
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. Never a duplicate: accepting a SECOND fixture request between the
--    SAME two clubs while the first Partnership Request is still pending
--    creates no additional partnership.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixture_request_groups (id, requesting_club_id, opponent_club_id, opponent_directory_id, raw_opponent_text, proposed_date, created_by)
  values ('99900000-0000-0000-0000-000000000411', '99900000-0000-0000-0000-0000000c0001', '99900000-0000-0000-0000-0000000c0002', '99900000-0000-0000-0000-0000000d0002', 'Auto Partner Test Away RUFC', current_date + 17, '99900000-0000-0000-0000-000000000101')
  on conflict (id) do nothing;
  insert into public.fixture_requests (id, group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values ('99900000-0000-0000-0000-000000000412', '99900000-0000-0000-0000-000000000411', '99900000-0000-0000-0000-000000000103', '99900000-0000-0000-0000-000000000203', 'home', 'sent', '99900000-0000-0000-0000-000000000101')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99900000-0000-0000-0000-000000000201","role":"authenticated"}';
do $$
declare
  v_partnership_count integer;
begin
  perform public.accept_fixture_request('99900000-0000-0000-0000-000000000412', null);
  select count(*) into v_partnership_count from public.club_partnerships
  where least(requesting_club_id, partner_club_id) = least('99900000-0000-0000-0000-0000000c0001'::uuid, '99900000-0000-0000-0000-0000000c0002'::uuid)
    and greatest(requesting_club_id, partner_club_id) = greatest('99900000-0000-0000-0000-0000000c0001'::uuid, '99900000-0000-0000-0000-0000000c0002'::uuid);
  if v_partnership_count = 1 then
    raise notice 'PASS 4: a second fixture accepted between the same two clubs never creates a second Partnership Request while one is already pending';
  else
    raise notice 'FAIL 4: expected still exactly 1 club_partnerships row, found %', v_partnership_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 5. Decline: the fixture remains confirmed, and BOTH sides are told so
--    explicitly.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99900000-0000-0000-0000-000000000201","role":"authenticated"}';
do $$
declare
  v_partnership_id uuid;
  v_fixture_status text;
begin
  select id into v_partnership_id from public.club_partnerships
  where least(requesting_club_id, partner_club_id) = least('99900000-0000-0000-0000-0000000c0001'::uuid, '99900000-0000-0000-0000-0000000c0002'::uuid)
    and greatest(requesting_club_id, partner_club_id) = greatest('99900000-0000-0000-0000-0000000c0001'::uuid, '99900000-0000-0000-0000-0000000c0002'::uuid);
  perform public.respond_to_club_partnership(v_partnership_id, false);

  select status into v_fixture_status from public.fixture_requests where id = '99900000-0000-0000-0000-000000000402';
  if v_fixture_status = 'accepted' then
    raise notice 'PASS 5: declining the auto-created partnership leaves the original fixture request status untouched (still accepted) -- the fixture is never affected by the partnership outcome';
  else
    raise notice 'FAIL 5: fixture_requests.status=%, expected accepted', v_fixture_status;
  end if;
end $$;
commit;

do $$
declare
  v_home_body text;
  v_away_body text;
begin
  select body into v_home_body from public.notifications
  where user_id = '99900000-0000-0000-0000-000000000101' and type = 'calendar_share_declined' order by created_at desc limit 1;
  select body into v_away_body from public.notifications
  where user_id = '99900000-0000-0000-0000-000000000201' and type = 'calendar_share_declined' order by created_at desc limit 1;

  if v_home_body = 'Partnership request declined. Your fixture remains confirmed.' and v_away_body = 'Partnership request declined. Your fixture remains confirmed.' then
    raise notice 'PASS 6: both clubs are told explicitly the fixture remains confirmed when an auto-created partnership is declined -- never left to infer it';
  else
    raise notice 'FAIL 6: home_body=%, away_body=%', v_home_body, v_away_body;
  end if;
end $$;

-- ------------------------------------------------------------
-- 7. External/unresolved opponent: accepting a fixture request with no
--    real target club at all creates no partnership (nothing to
--    partner with).
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixture_request_groups (id, requesting_club_id, raw_opponent_text, proposed_date, created_by)
  values ('99900000-0000-0000-0000-000000000421', '99900000-0000-0000-0000-0000000c0001', 'Some Unclaimed Club FC', current_date + 20, '99900000-0000-0000-0000-000000000101')
  on conflict (id) do nothing;
  insert into public.fixture_requests (id, group_id, requesting_team_id, venue_preference, status, created_by)
  values ('99900000-0000-0000-0000-000000000422', '99900000-0000-0000-0000-000000000421', '99900000-0000-0000-0000-000000000103', 'away', 'sent', '99900000-0000-0000-0000-000000000101')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_partnership_count_before integer;
  v_partnership_count_after integer;
begin
  select count(*) into v_partnership_count_before from public.club_partnerships;
  perform public.accept_fixture_request('99900000-0000-0000-0000-000000000422', null);
  select count(*) into v_partnership_count_after from public.club_partnerships;
  if v_partnership_count_after = v_partnership_count_before then
    raise notice 'PASS 7: accepting a fixture request against a fully external/unresolved opponent (no real club) creates no partnership -- nothing to partner with';
  else
    raise notice 'FAIL 7: partnership count changed from % to %', v_partnership_count_before, v_partnership_count_after;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 8. Deactivated club: accepting a fixture request where the OTHER side
--    is deactivated creates no partnership -- "between two ACTIVE
--    Ovalball clubs" is a real condition, not just "two real clubs".
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.deactivate_club('99900000-0000-0000-0000-0000000c0003', 'test: deactivated for auto-partnership boundary check');
end $$;
commit;

do $$
begin
  insert into public.fixture_request_groups (id, requesting_club_id, opponent_club_id, opponent_directory_id, raw_opponent_text, proposed_date, created_by)
  values ('99900000-0000-0000-0000-000000000431', '99900000-0000-0000-0000-0000000c0003', '99900000-0000-0000-0000-0000000c0002', '99900000-0000-0000-0000-0000000d0002', 'Auto Partner Test Away RUFC', current_date + 25, '99900000-0000-0000-0000-000000000301')
  on conflict (id) do nothing;
  insert into public.fixture_requests (id, group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values ('99900000-0000-0000-0000-000000000432', '99900000-0000-0000-0000-000000000431', '99900000-0000-0000-0000-000000000303', '99900000-0000-0000-0000-000000000203', 'away', 'sent', '99900000-0000-0000-0000-000000000301')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99900000-0000-0000-0000-000000000201","role":"authenticated"}';
do $$
declare
  v_partnership_count integer;
begin
  -- The deactivated club's own fixture request can still be accepted
  -- normally by the real active opponent (Club Lifecycle: deactivation
  -- never touches fixtures) -- but it must never spawn a partnership.
  perform public.accept_fixture_request('99900000-0000-0000-0000-000000000432', null);
  select count(*) into v_partnership_count from public.club_partnerships
  where least(requesting_club_id, partner_club_id) = least('99900000-0000-0000-0000-0000000c0002'::uuid, '99900000-0000-0000-0000-0000000c0003'::uuid)
    and greatest(requesting_club_id, partner_club_id) = greatest('99900000-0000-0000-0000-0000000c0002'::uuid, '99900000-0000-0000-0000-0000000c0003'::uuid);
  if v_partnership_count = 0 then
    raise notice 'PASS 8: accepting a fixture request where one side is a DEACTIVATED club creates no partnership, even though both are real, distinct clubs';
  else
    raise notice 'FAIL 8: expected 0 club_partnerships rows for the deactivated-club pair, found %', v_partnership_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 9. A previously REVOKED partnership never blocks a fresh one: Club A
--    and Club B already have exactly one revoked partnership (test 5's
--    decline) -- a THIRD fixture accepted between them still gets a
--    brand-new pending Partnership Request, never silently skipped.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixture_request_groups (id, requesting_club_id, opponent_club_id, opponent_directory_id, raw_opponent_text, proposed_date, created_by)
  values ('99900000-0000-0000-0000-000000000441', '99900000-0000-0000-0000-0000000c0001', '99900000-0000-0000-0000-0000000c0002', '99900000-0000-0000-0000-0000000d0002', 'Auto Partner Test Away RUFC', current_date + 30, '99900000-0000-0000-0000-000000000101')
  on conflict (id) do nothing;
  insert into public.fixture_requests (id, group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values ('99900000-0000-0000-0000-000000000442', '99900000-0000-0000-0000-000000000441', '99900000-0000-0000-0000-000000000103', '99900000-0000-0000-0000-000000000203', 'away', 'sent', '99900000-0000-0000-0000-000000000101')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99900000-0000-0000-0000-000000000201","role":"authenticated"}';
do $$
declare
  v_pending_count integer;
  v_revoked_count integer;
begin
  perform public.accept_fixture_request('99900000-0000-0000-0000-000000000442', null);
  select count(*) into v_pending_count from public.club_partnerships
  where least(requesting_club_id, partner_club_id) = least('99900000-0000-0000-0000-0000000c0001'::uuid, '99900000-0000-0000-0000-0000000c0002'::uuid)
    and greatest(requesting_club_id, partner_club_id) = greatest('99900000-0000-0000-0000-0000000c0001'::uuid, '99900000-0000-0000-0000-0000000c0002'::uuid)
    and status = 'pending';
  select count(*) into v_revoked_count from public.club_partnerships
  where least(requesting_club_id, partner_club_id) = least('99900000-0000-0000-0000-0000000c0001'::uuid, '99900000-0000-0000-0000-0000000c0002'::uuid)
    and greatest(requesting_club_id, partner_club_id) = greatest('99900000-0000-0000-0000-0000000c0001'::uuid, '99900000-0000-0000-0000-0000000c0002'::uuid)
    and status = 'revoked';
  if v_pending_count = 1 and v_revoked_count = 1 then
    raise notice 'PASS 9: a previously revoked partnership never blocks a fresh one -- a new pending Partnership Request is created alongside the old revoked history, not silently skipped';
  else
    raise notice 'FAIL 9: pending_count=%, revoked_count=%', v_pending_count, v_revoked_count;
  end if;
end $$;
commit;
