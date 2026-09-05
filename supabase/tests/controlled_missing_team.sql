-- Manual verification for Phase C -- controlled automatic team creation
-- from an incoming fixture request (20260903400000). NOT a migration --
-- run AFTER permission_matrix.sql (reuses Burnley as the requester).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/controlled_missing_team.sql
--
-- Self-contained: a dedicated standalone recipient club, never Burnley/
-- Rossendale's own team set, so nothing here can collide with any other
-- test file's leftover teams at the same age group.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'missing-team-test-rufc-99800000')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status)
  values ('99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'missing-team-test-rufc-99800000', 'active')
  on conflict (id) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('99800000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.missingteam.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  values ('99800000-0000-0000-0000-000000000001', 'Test', 'MissingTeamAdmin', 'test.missingteam.admin@ovalball.local')
  on conflict (id) do nothing;
  insert into public.club_memberships (id, club_id, user_id, role, status)
  values ('99800000-0000-0000-0000-000000000002', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-000000000001', 'CLUB_ADMIN', 'active')
  on conflict (id) do nothing;

  -- Fixtures for the "existing team" and "ambiguous squad" scenarios.
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug) values
    ('99800000-0000-0000-0000-000000000101', '99800000-0000-0000-0000-00000000000c', 'union', 'youth', 'U9', 'boys', null, 'Missing Team Test RUFC U9 Boys', 'mtt-u9-boys'),
    ('99800000-0000-0000-0000-000000000102', '99800000-0000-0000-0000-00000000000c', 'union', 'youth', 'U9', 'boys', 'B', 'Missing Team Test RUFC U9 Boys B', 'mtt-u9-boys-b-folded'),
    ('99800000-0000-0000-0000-000000000103', '99800000-0000-0000-0000-00000000000c', 'union', 'youth', 'U10', 'boys', null, 'Missing Team Test RUFC U10 Boys', 'mtt-u10-boys'),
    ('99800000-0000-0000-0000-000000000104', '99800000-0000-0000-0000-00000000000c', 'union', 'youth', 'U10', 'boys', 'B', 'Missing Team Test RUFC U10 Boys B', 'mtt-u10-boys-b'),
    ('99800000-0000-0000-0000-000000000105', '99800000-0000-0000-0000-00000000000c', 'union', 'youth', 'U8', 'boys', null, 'Missing Team Test RUFC U8 Boys', 'mtt-u8-boys'),
    ('99800000-0000-0000-0000-000000000106', '99800000-0000-0000-0000-00000000000c', 'union', 'youth', 'U13', 'boys', null, 'Missing Team Test RUFC U13 Boys', 'mtt-u13-boys-zz'),
    ('99800000-0000-0000-0000-000000000107', '99800000-0000-0000-0000-00000000000c', 'union', 'youth', 'U11', 'mixed', null, 'Missing Team Test RUFC U11 Mixed', 'mtt-u11-mixed-zz')
  on conflict (id) do nothing;

  update public.teams set active = false, folded_at = now(), fold_reason = 'test: folded for exists_folded check' where id = '99800000-0000-0000-0000-000000000102';

  -- One fixture_request_groups row per scenario -- proposed_date varies so
  -- each is trivially distinguishable, requesting_club_id is always
  -- Burnley (the real, already-seeded requester), opponent_club_id is
  -- always this test club.
  insert into public.fixture_request_groups (id, requesting_club_id, opponent_club_id, opponent_directory_id, raw_opponent_text, proposed_date, created_by) values
    ('99800000-0000-0000-0000-000000000201', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 1, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000202', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 2, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000203', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 3, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000204', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 4, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000205', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 5, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000206', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 6, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000207', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 7, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000208', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 8, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000209', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 9, '00000000-0000-0000-0000-000000000002')
  on conflict (id) do nothing;

  -- Scenario requests, each naming a structured identity, none resolving
  -- to a real team yet (target_team_id null).
  insert into public.fixture_requests (id, group_id, requesting_team_id, venue_preference, status, target_team_age_group, target_team_gender, target_team_squad_designation, created_by) values
    ('99800000-0000-0000-0000-000000000301', '99800000-0000-0000-0000-000000000201', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U9',  'boys', 'A',  '00000000-0000-0000-0000-000000000002'),  -- exact-squad exists_active
    ('99800000-0000-0000-0000-000000000302', '99800000-0000-0000-0000-000000000202', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U9',  'boys', 'B',  '00000000-0000-0000-0000-000000000002'),  -- exact-squad exists_folded
    ('99800000-0000-0000-0000-000000000303', '99800000-0000-0000-0000-000000000203', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U10', 'boys', null, '00000000-0000-0000-0000-000000000002'),  -- no-squad ambiguous
    ('99800000-0000-0000-0000-000000000304', '99800000-0000-0000-0000-000000000204', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U8',  'boys', null, '00000000-0000-0000-0000-000000000002'),  -- no-squad unique match
    ('99800000-0000-0000-0000-000000000305', '99800000-0000-0000-0000-000000000205', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U14', 'boys', null, '00000000-0000-0000-0000-000000000002'),  -- pending ordinary rollover
    ('99800000-0000-0000-0000-000000000306', '99800000-0000-0000-0000-000000000206', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U12', 'girls', null, '00000000-0000-0000-0000-000000000002'), -- pending structural
    ('99800000-0000-0000-0000-000000000307', '99800000-0000-0000-0000-000000000207', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U12', 'boys', 'A',  '00000000-0000-0000-0000-000000000002'),  -- genuinely missing (U12 to match the requesting team's own age group, for the end-to-end accept check)
    ('99800000-0000-0000-0000-000000000308', '99800000-0000-0000-0000-000000000208', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U12', 'boys', 'A',  '00000000-0000-0000-0000-000000000002'),  -- authorization check (Rossendale must be refused)
    ('99800000-0000-0000-0000-000000000309', '99800000-0000-0000-0000-000000000209', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U17', 'boys', null, '00000000-0000-0000-0000-000000000002')   -- out-of-catalogue: this club must never be able to create U17 this way
  on conflict (id) do nothing;
end $$;

-- seasons is Site-Admin-write-scoped -- inserted as postgres, same as
-- every other test file's own season fixtures.
do $$
begin
  insert into public.seasons (id, name, starts_on, ends_on, rugby_code) values
    ('99800000-0000-0000-0000-000000000401', 'Union Missing-Team Test Season', current_date + 200, current_date + 500, 'union')
  on conflict (id) do nothing;
end $$;

-- Generate the two pending rollover proposals the tests above depend on
-- (as this test club's own Club Admin).
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99800000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.generate_rollover_proposal('99800000-0000-0000-0000-00000000000c', 'union', '99800000-0000-0000-0000-000000000401');
end $$;
commit;

-- ------------------------------------------------------------
-- 1. Fixture-request-level validation: an invalid structured identity
--    (senior vocabulary, or a paired gender with no age group) never
--    reaches team creation -- rejected at the request row itself.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixture_requests (group_id, requesting_team_id, venue_preference, status, target_team_age_group, target_team_gender, created_by)
  values ('99800000-0000-0000-0000-000000000201', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U13', 'mens', '00000000-0000-0000-0000-000000000002');
  raise notice 'FAIL 1: a fixture_requests row naming target_team_gender=mens (senior vocabulary) unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 1: target_team_gender is restricted to boys/girls -- an invalid structured identity can never reach team creation, rejected at the request row itself';
end $$;

do $$
begin
  insert into public.fixture_requests (group_id, requesting_team_id, venue_preference, status, target_team_gender, created_by)
  values ('99800000-0000-0000-0000-000000000201', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'boys', '00000000-0000-0000-0000-000000000002');
  raise notice 'FAIL 2: a fixture_requests row naming target_team_gender with no target_team_age_group unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 2: a structured identity requires an age group whenever a gender is named -- never a half-formed identity';
end $$;

-- ------------------------------------------------------------
-- 2. Resolution checks, as the recipient club's own Club Admin.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99800000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_resolution text;
  v_existing_id uuid;
begin
  select resolution, existing_team_id into v_resolution, v_existing_id from public.check_incoming_request_target('99800000-0000-0000-0000-000000000301');
  if v_resolution = 'exists_active' and v_existing_id = '99800000-0000-0000-0000-000000000101' then
    raise notice 'PASS 3: an exact-squad request (U9 Boys A) resolves to the real existing active team -- never a duplicate';
  else
    raise notice 'FAIL 3: resolution=%, existing_id=%', v_resolution, v_existing_id;
  end if;

  select resolution, existing_team_id into v_resolution, v_existing_id from public.check_incoming_request_target('99800000-0000-0000-0000-000000000302');
  if v_resolution = 'exists_folded' and v_existing_id = '99800000-0000-0000-0000-000000000102' then
    raise notice 'PASS 4: an exact-squad request (U9 Boys B) against a FOLDED team resolves to exists_folded, distinguishable from active -- never a duplicate';
  else
    raise notice 'FAIL 4: resolution=%, existing_id=%', v_resolution, v_existing_id;
  end if;

  select resolution into v_resolution from public.check_incoming_request_target('99800000-0000-0000-0000-000000000303');
  if v_resolution = 'ambiguous_squad' then
    raise notice 'PASS 5: a no-squad request (U10 Boys) where two active squads (A and B) already exist resolves ambiguous -- never guesses which one';
  else
    raise notice 'FAIL 5: resolution=%', v_resolution;
  end if;

  select resolution, existing_team_id into v_resolution, v_existing_id from public.check_incoming_request_target('99800000-0000-0000-0000-000000000304');
  if v_resolution = 'exists_active' and v_existing_id = '99800000-0000-0000-0000-000000000105' then
    raise notice 'PASS 6: a no-squad request (U8 Boys) where exactly one active team exists (itself with no squad letter) resolves to that team -- squad-omitted uniqueness is honoured, not treated as missing';
  else
    raise notice 'FAIL 6: resolution=%, existing_id=%', v_resolution, v_existing_id;
  end if;

  select resolution into v_resolution from public.check_incoming_request_target('99800000-0000-0000-0000-000000000305');
  if v_resolution = 'pending_rollover' then
    raise notice 'PASS 7: a request naming U14 Boys, where a pending (undecided) ordinary rollover already proposes exactly that age group, routes to Season Rollover -- never races it into a duplicate';
  else
    raise notice 'FAIL 7: resolution=%', v_resolution;
  end if;

  select resolution into v_resolution from public.check_incoming_request_target('99800000-0000-0000-0000-000000000306');
  if v_resolution = 'pending_structural' then
    raise notice 'PASS 8: a request naming U12 Girls, where a pending U11-Mixed structural transition already governs whether a Girls team should exist at U12, routes to that decision -- never bypasses it';
  else
    raise notice 'FAIL 8: resolution=%', v_resolution;
  end if;

  select resolution into v_resolution from public.check_incoming_request_target('99800000-0000-0000-0000-000000000307');
  if v_resolution = 'genuinely_missing' then
    raise notice 'PASS 9: a request naming U12 Boys A, with no active match, no folded match, no pending rollover, and no pending structural decision, resolves genuinely_missing -- safe to offer creation';
  else
    raise notice 'FAIL 9: resolution=%', v_resolution;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 3. Authorization: an unrelated club's admin cannot check or create.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  begin
    perform public.check_incoming_request_target('99800000-0000-0000-0000-000000000308');
    raise notice 'FAIL 10: an unrelated club admin (Rossendale) unexpectedly authorized to check this request';
  exception when others then
    raise notice 'PASS 10: check_incoming_request_target refuses a club admin who does not manage the recipient club';
  end;
  begin
    perform public.create_missing_target_team('99800000-0000-0000-0000-000000000308');
    raise notice 'FAIL 11: an unrelated club admin (Rossendale) unexpectedly authorized to create a team on this request';
  exception when others then
    raise notice 'PASS 11: create_missing_target_team refuses a club admin who does not manage the recipient club';
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 4. Creation: genuinely_missing succeeds, never accepts the fixture,
--    notifies the recipient Club Admin, and the second call cannot
--    duplicate it.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99800000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_new_team_id uuid;
  v_category text;
  v_age_group text;
  v_gender text;
  v_status text;
  v_target_team_id uuid;
begin
  select public.create_missing_target_team('99800000-0000-0000-0000-000000000307') into v_new_team_id;
  select category, age_group, gender into v_category, v_age_group, v_gender from public.teams where id = v_new_team_id;
  select status, target_team_id into v_status, v_target_team_id from public.fixture_requests where id = '99800000-0000-0000-0000-000000000307';

  if v_category = 'youth' and v_age_group = 'U12' and v_gender = 'boys' then
    raise notice 'PASS 12: create_missing_target_team creates exactly the named identity (U12 Boys A)';
  else
    raise notice 'FAIL 12: category=%, age_group=%, gender=%', v_category, v_age_group, v_gender;
  end if;

  if v_status = 'sent' and v_target_team_id = v_new_team_id then
    raise notice 'PASS 13: creating the team populates target_team_id but leaves the request status untouched (still ''sent'') -- creating a team never accepts a fixture';
  else
    raise notice 'FAIL 13: status=%, target_team_id=%, expected new team=%', v_status, v_target_team_id, v_new_team_id;
  end if;

  begin
    perform public.create_missing_target_team('99800000-0000-0000-0000-000000000307');
    raise notice 'FAIL 14: re-creating a team for an already-resolved request unexpectedly succeeded -- would duplicate it';
  exception when others then
    raise notice 'PASS 14: a second create_missing_target_team call on the same (now-resolved) request is refused -- never a duplicate on repeated submission';
  end;
end $$;
commit;

-- Notification check runs as postgres (notifications is Site-Admin/self
-- select-scoped by RLS, not visible to an ordinary session query here).
do $$
begin
  if exists (
    select 1 from public.notifications
    where user_id = '99800000-0000-0000-0000-000000000001' and type = 'team_created_from_fixture_request'
  ) then
    raise notice 'PASS 15: the recipient Club Admin is notified that the team was created from an incoming fixture request';
  else
    raise notice 'FAIL 15: no team_created_from_fixture_request notification found for the recipient Club Admin';
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. End to end: the newly created team can now be used to accept the
--    fixture normally, through the SAME accept_fixture_request path as
--    every other request -- a real, separate, deliberate action.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99800000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_target_team_id uuid;
  v_fixture_id uuid;
  v_final_status text;
begin
  select target_team_id into v_target_team_id from public.fixture_requests where id = '99800000-0000-0000-0000-000000000307';
  v_fixture_id := public.accept_fixture_request('99800000-0000-0000-0000-000000000307', v_target_team_id);
  select status into v_final_status from public.fixture_requests where id = '99800000-0000-0000-0000-000000000307';
  if v_final_status = 'accepted' and v_fixture_id is not null then
    raise notice 'PASS 16: the created team can accept the fixture through the normal accept_fixture_request path -- creation and acceptance are genuinely separate, deliberate actions';
  else
    raise notice 'FAIL 16: final_status=%, fixture_id=%', v_final_status, v_fixture_id;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 6. The controlled missing-team path re-checked directly against the
--    closed canonical catalogue: this is a SECURITY DEFINER RPC, never
--    gated by the teams_insert_admin RLS policy at all -- fixture_requests
--    itself places no whitelist on target_team_age_group (free text), so
--    resolve_incoming_request_target correctly still says genuinely_missing
--    for U17 (nothing else claims it), but the actual team creation must
--    still be blocked by the same hard invariant every other write path
--    goes through. It must be impossible for this RPC to create U17,
--    exactly like every other path.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99800000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_resolution text;
begin
  select resolution into v_resolution from public.check_incoming_request_target('99800000-0000-0000-0000-000000000309');
  if v_resolution <> 'genuinely_missing' then
    raise notice 'FAIL 17: expected resolution=genuinely_missing for the U17 request (nothing else claims it), got %', v_resolution;
  end if;

  begin
    perform public.create_missing_target_team('99800000-0000-0000-0000-000000000309');
    raise notice 'FAIL 17: create_missing_target_team unexpectedly created U17 -- the controlled missing-team path can create an out-of-catalogue team';
  exception when check_violation then
    raise notice 'PASS 17: create_missing_target_team cannot create U17 -- this SECURITY DEFINER RPC is not gated by RLS at all, and is still correctly blocked by the same closed-catalogue invariant every other write path goes through';
  end;
end $$;
commit;

-- ============================================================
-- Central Fixture Participant Resolution (2026-09-02 superseding
-- instruction): accept_fixture_request_with_team_action is the ONE atomic
-- "Accept Fixture & Create/Reactivate Team" entry point. Sections 7-12
-- below test it directly, plus the club-structural permission narrowing
-- (create_missing_target_team/reactivate_missing_target_team now require
-- internal.is_club_admin, not the broader can_manage_club_fixtures a
-- Fixtures Secretary also has) and the concurrent-requests-converge
-- requirement. Fresh request rows use group/request ids 210+/310+.
-- Every request that actually gets ACCEPTED (not just resolution-checked)
-- must name an age_group in the SAME eligibility band as the requesting
-- team (Burnley's U12 -- internal.teams_can_play_fixture requires matching
-- age_fixture_band, which U9-vs-U12 does NOT satisfy), so these use U12
-- itself with fresh B/C squad letters (the request-307 flow already made
-- U12 Boys the active primary, so B/C are legal once their own primary is
-- active -- exactly the closed-catalogue invariant every other path uses).
-- ============================================================

do $$
begin
  insert into public.fixture_request_groups (id, requesting_club_id, opponent_club_id, opponent_directory_id, raw_opponent_text, proposed_date, created_by) values
    ('99800000-0000-0000-0000-000000000210', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 10, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000211', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 11, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000212', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 12, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000213', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 13, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000214', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 14, '00000000-0000-0000-0000-000000000002'),
    ('99800000-0000-0000-0000-000000000215', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 15, '00000000-0000-0000-0000-000000000002')
  on conflict (id) do nothing;

  insert into public.fixture_requests (id, group_id, requesting_team_id, venue_preference, status, target_team_age_group, target_team_gender, target_team_squad_designation, created_by) values
    ('99800000-0000-0000-0000-000000000310', '99800000-0000-0000-0000-000000000210', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U12', 'boys', 'B', '00000000-0000-0000-0000-000000000002'), -- atomic create path (U12 Boys B -- primary already active from scenario 4/5 above)
    ('99800000-0000-0000-0000-000000000311', '99800000-0000-0000-0000-000000000211', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U12', 'boys', 'C', '00000000-0000-0000-0000-000000000002'), -- Fixtures Secretary denied (never actually created, so C's own "needs an active B" invariant is never exercised here)
    ('99800000-0000-0000-0000-000000000312', '99800000-0000-0000-0000-000000000212', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U12', 'boys', 'C', '00000000-0000-0000-0000-000000000002'), -- concurrent request #1 (same identity as 311 -- B is active by the time this runs, from request 310)
    ('99800000-0000-0000-0000-000000000313', '99800000-0000-0000-0000-000000000213', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U12', 'boys', 'C', '00000000-0000-0000-0000-000000000002'), -- concurrent request #2 (same identity)
    ('99800000-0000-0000-0000-000000000314', '99800000-0000-0000-0000-000000000214', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U12', 'girls', 'B', '00000000-0000-0000-0000-000000000002'), -- reject path (genuinely missing, never actually created -- so its own "needs an active Girls primary" is never exercised)
    ('99800000-0000-0000-0000-000000000315', '99800000-0000-0000-0000-000000000215', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U12', 'boys', 'B', '00000000-0000-0000-0000-000000000002') -- reactivation path -- resolves against the SAME U12 Boys B team request 310 creates, once section 8 folds it
  on conflict (id) do nothing;

  -- A dedicated Fixtures Secretary at the SAME recipient club, distinct
  -- from its Club Admin -- proves the permission narrowing (club-
  -- structural authority, not ordinary fixture authority) with a real
  -- capability the app actually grants, not an unrelated-club stand-in.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('99800000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.missingteam.secretary@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  values ('99800000-0000-0000-0000-000000000004', 'Test', 'MissingTeamSecretary', 'test.missingteam.secretary@ovalball.local')
  on conflict (id) do nothing;
  insert into public.club_memberships (id, club_id, user_id, role, status)
  values ('99800000-0000-0000-0000-000000000005', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-000000000004', 'FIXTURE_SECRETARY', 'active')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 7. accept_fixture_request_with_team_action -- atomic create path: ONE
--    call, no separate create-then-accept round trip. Proves the team,
--    the fixture, and BOTH audit events all exist after a single call.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99800000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
  v_target_team_id uuid;
  v_team_event_count integer;
  v_accept_event_count integer;
begin
  v_fixture_id := public.accept_fixture_request_with_team_action('99800000-0000-0000-0000-000000000310', true, null);
  select target_team_id into v_target_team_id from public.fixture_requests where id = '99800000-0000-0000-0000-000000000310';

  if v_fixture_id is not null and v_target_team_id is not null and exists (select 1 from public.teams where id = v_target_team_id and age_group = 'U12' and squad_designation = 'B') then
    raise notice 'PASS 18: accept_fixture_request_with_team_action creates the U12 Boys B team AND accepts the fixture in one atomic call';
  else
    raise notice 'FAIL 18: fixture_id=%, target_team_id=%', v_fixture_id, v_target_team_id;
  end if;

  -- Without consent, the same call on a fresh genuinely_missing request
  -- must refuse rather than silently creating anything.
  begin
    perform public.accept_fixture_request_with_team_action('99800000-0000-0000-0000-000000000314', false, null);
    raise notice 'FAIL 20: accept_fixture_request_with_team_action created a team without consent';
  exception when others then
    raise notice 'PASS 20: without p_consent_team_action, a genuinely_missing request is refused rather than silently creating a team';
  end;
end $$;
commit;

-- audit_log is Site-Admin-scoped by RLS, not visible to an ordinary club
-- admin session query -- checked as postgres, same pattern as the
-- notification check in section 4 above.
do $$
declare
  v_target_team_id uuid;
  v_team_event_count integer;
  v_accept_event_count integer;
begin
  select target_team_id into v_target_team_id from public.fixture_requests where id = '99800000-0000-0000-0000-000000000310';
  select count(*) into v_team_event_count from public.audit_log where table_name = 'teams' and record_id = v_target_team_id and (after->>'event') = 'TEAM_CREATED_FROM_FIXTURE_REQUEST';
  select count(*) into v_accept_event_count from public.audit_log where table_name = 'fixture_requests' and record_id = '99800000-0000-0000-0000-000000000310' and (after->>'event') = 'FIXTURE_REQUEST_ACCEPTED';
  if v_team_event_count = 1 and v_accept_event_count = 1 then
    raise notice 'PASS 19: two distinct audit events recorded (TEAM_CREATED_FROM_FIXTURE_REQUEST and FIXTURE_REQUEST_ACCEPTED), both referencing the same fixture_request_id';
  else
    raise notice 'FAIL 19: team_event_count=%, accept_event_count=%', v_team_event_count, v_accept_event_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 8. accept_fixture_request_with_team_action -- atomic reactivate path:
--    the SAME stable team_id is reactivated and used, never a duplicate.
--    First fold the U12 Boys B team request 310 just created, so request
--    315 (naming the identical structured identity) genuinely resolves
--    exists_folded rather than exists_active.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99800000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_u12b_team_id uuid;
  v_fixture_id uuid;
  v_target_team_id uuid;
  v_active boolean;
begin
  select target_team_id into v_u12b_team_id from public.fixture_requests where id = '99800000-0000-0000-0000-000000000310';
  perform public.fold_team(v_u12b_team_id, 'test: folded to exercise the reactivation path');

  v_fixture_id := public.accept_fixture_request_with_team_action('99800000-0000-0000-0000-000000000315', true, null);
  select target_team_id into v_target_team_id from public.fixture_requests where id = '99800000-0000-0000-0000-000000000315';
  select active into v_active from public.teams where id = v_target_team_id;

  if v_fixture_id is not null and v_target_team_id = v_u12b_team_id and v_active then
    raise notice 'PASS 21: accept_fixture_request_with_team_action reactivates the SAME stable team_id (U12 Boys B) and accepts the fixture -- never a duplicate team';
  else
    raise notice 'FAIL 21: fixture_id=%, target_team_id=%, expected=%, active=%', v_fixture_id, v_target_team_id, v_u12b_team_id, v_active;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 9. Permission narrowing: a Fixtures Secretary has ordinary fixture
--    authority (can check the request) but NOT club-structural authority
--    -- team creation is refused with a clear error, never silent.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99800000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
declare
  v_resolution text;
begin
  select resolution into v_resolution from public.check_incoming_request_target('99800000-0000-0000-0000-000000000311');
  if v_resolution = 'genuinely_missing' then
    raise notice 'PASS 22: a Fixtures Secretary CAN check an incoming request''s resolution (ordinary fixture authority) -- can_manage_club_fixtures covers viewing';
  else
    raise notice 'FAIL 22: resolution=%', v_resolution;
  end if;

  begin
    perform public.create_missing_target_team('99800000-0000-0000-0000-000000000311');
    raise notice 'FAIL 23: a Fixtures Secretary unexpectedly authorized to create a team -- club-structural authority must be required, not ordinary fixture authority';
  exception when others then
    raise notice 'PASS 23: create_missing_target_team refuses a Fixtures Secretary -- team creation requires club-structural authority (Club Admin), never ordinary fixture authority';
  end;

  begin
    perform public.accept_fixture_request_with_team_action('99800000-0000-0000-0000-000000000311', true, null);
    raise notice 'FAIL 24: accept_fixture_request_with_team_action unexpectedly let a Fixtures Secretary create a team via the atomic path';
  exception when others then
    raise notice 'PASS 24: the atomic accept-and-create path also refuses a Fixtures Secretary -- the narrowing is not bypassable through the wrapper';
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 10. Concurrent requests for the same missing identity: accepting the
--     FIRST creates the team; the SECOND, accepted afterward via the same
--     atomic entry point, must find the team already real and simply use
--     it -- never asked to create it again, never a duplicate team.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99800000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_fixture_id_1 uuid;
  v_fixture_id_2 uuid;
  v_team_id_1 uuid;
  v_team_id_2 uuid;
  v_c_team_count integer;
begin
  v_fixture_id_1 := public.accept_fixture_request_with_team_action('99800000-0000-0000-0000-000000000312', true, null);
  select target_team_id into v_team_id_1 from public.fixture_requests where id = '99800000-0000-0000-0000-000000000312';

  -- The second request, for the SAME identity, still nominally says
  -- "consent to a team action" -- but resolution is re-run fresh inside
  -- the call, so it must find exists_active (the team request #1 just
  -- created) and simply use it, never attempt a second create.
  v_fixture_id_2 := public.accept_fixture_request_with_team_action('99800000-0000-0000-0000-000000000313', true, null);
  select target_team_id into v_team_id_2 from public.fixture_requests where id = '99800000-0000-0000-0000-000000000313';

  select count(*) into v_c_team_count from public.teams where club_id = '99800000-0000-0000-0000-00000000000c' and age_group = 'U12' and gender = 'boys' and squad_designation = 'C';

  if v_team_id_1 = v_team_id_2 and v_c_team_count = 1 and v_fixture_id_1 <> v_fixture_id_2 then
    raise notice 'PASS 25: two concurrent requests for the same missing identity (U12 Boys C) converge on exactly ONE team -- the second accept never re-creates it, both fixtures reference the same team_id';
  else
    raise notice 'FAIL 25: team_id_1=%, team_id_2=%, c_team_count=%', v_team_id_1, v_team_id_2, v_c_team_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 11. Reject: declining a missing-team request creates no team and no
--     acceptance -- the ordinary decline path (fixture_requests RLS
--     update, app/(app)/fixtures/actions.ts's declineFixtureRequest) is
--     untouched by this migration, confirmed here for completeness.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99800000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_team_exists boolean;
begin
  update public.fixture_requests set status = 'declined', decided_by = auth.uid(), decided_at = now() where id = '99800000-0000-0000-0000-000000000314';
  select exists(select 1 from public.teams where club_id = '99800000-0000-0000-0000-00000000000c' and age_group = 'U12' and gender = 'girls' and squad_designation = 'B') into v_team_exists;
  if not v_team_exists then
    raise notice 'PASS 26: declining a missing-team request creates no team -- no ghost team from a rejected request';
  else
    raise notice 'FAIL 26: a team unexpectedly exists after declining a missing-team request';
  end if;

  begin
    perform public.accept_fixture_request_with_team_action('99800000-0000-0000-0000-000000000314', true, null);
    raise notice 'FAIL 27: accept_fixture_request_with_team_action succeeded on an already-declined request';
  exception when others then
    raise notice 'PASS 27: a declined request cannot be accepted afterward -- status is re-checked, never bypassed';
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 12. Genuinely NULL squad_designation (never explicitly named "A", never
--     B/C -- the real shape a normal UI sends when a user leaves the
--     "Primary squad" option selected) must create with squad_designation
--     IS NULL, not empty string. Found live: coalesce(x,'') then
--     nullif(...,'A') does NOT normalize a genuinely-NULL input to NULL --
--     nullif('','A') returns '' unchanged, which violated
--     teams_active_squad_designation_valid (only null/B/C valid for an
--     active youth team). No prior test (here or in the original
--     20260903400000 migration) ever exercised a genuinely-NULL squad --
--     every existing scenario passed 'A' explicitly.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixture_request_groups (id, requesting_club_id, opponent_club_id, opponent_directory_id, raw_opponent_text, proposed_date, created_by) values
    ('99800000-0000-0000-0000-000000000216', '10000000-0000-0000-0000-000000000001', '99800000-0000-0000-0000-00000000000c', '99800000-0000-0000-0000-00000000000d', 'Missing Team Test RUFC', current_date + 16, '00000000-0000-0000-0000-000000000002')
  on conflict (id) do nothing;
  -- U15 (not U12): create_missing_target_team itself does not check age-
  -- eligibility against the requester (accept_fixture_request does, and
  -- U12 has no unclaimed identity left after sections 4-10 above use
  -- Boys/null, Boys B, Boys C, and Girls is blocked by pending_structural
  -- from section 2) -- this test isolates the squad_designation
  -- normalization fix specifically, not the full accept flow (already
  -- proven end to end live at U12 Boys B in this session).
  insert into public.fixture_requests (id, group_id, requesting_team_id, venue_preference, status, target_team_age_group, target_team_gender, target_team_squad_designation, created_by) values
    ('99800000-0000-0000-0000-000000000316', '99800000-0000-0000-0000-000000000216', '30000000-0000-0000-0000-000000000001', 'away', 'sent', 'U15', 'boys', null, '00000000-0000-0000-0000-000000000002')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99800000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_new_team_id uuid;
  v_squad_is_null boolean;
begin
  v_new_team_id := public.create_missing_target_team('99800000-0000-0000-0000-000000000316');
  select squad_designation is null into v_squad_is_null from public.teams where id = v_new_team_id;

  if v_squad_is_null then
    raise notice 'PASS 28: a request naming a structured identity with a genuinely NULL squad_designation (never ''A'', never B/C) creates the team with squad_designation IS NULL, not empty string -- the live-found normalization bug is fixed';
  else
    raise notice 'FAIL 28: squad_is_null=%', v_squad_is_null;
  end if;
end $$;
commit;
