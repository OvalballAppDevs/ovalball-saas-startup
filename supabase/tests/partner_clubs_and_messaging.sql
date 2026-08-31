-- Manual RLS/permission verification for the Partner Clubs / Calendar
-- Sharing / Fixture Messaging vertical slice. NOT a migration -- never
-- applied automatically by `db reset`. Run by hand against local Supabase:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/partner_clubs_and_messaging.sql
--
-- Self-contained: reuses the same shared fixture ids as permission_matrix.sql
-- (Burnley/Rossendale clubs, U12 A/U13 A teams, test users 1-8) via
-- `on conflict do nothing`, so this runs correctly whether or not that
-- script has already run in the same session, and either order is safe.
-- Adds one new activated club (Leigh RUFC) and two new test users (a
-- Fixture Secretary and a U13-only Team Admin) this file specifically
-- needs. Never touches remote/production -- local docker Postgres only.
-- Covers the 14 scenarios required for this slice's review.
--
-- NOT rerunnable without a fresh `db reset --local` in between, unlike
-- permission_matrix.sql: scenarios 1/4/7/7b deliberately `commit` (rather
-- than `rollback`) an active partnership -> fixture request -> acceptance
-- chain with fixed ids, since later scenarios (8-13, 15) need that state to
-- actually exist. Running this file twice against the same database hits
-- primary-key conflicts and a few false FAILs on the second pass -- reset
-- first, matching the workflow's own step 8 (`npx supabase db reset
-- --local`) before every run of this file.

\set ON_ERROR_STOP off
\pset pager off

do $$
declare
  v_burnley_dir_id uuid;
  v_rossendale_dir_id uuid;
  v_leigh_dir_id uuid;
begin
  select id into v_burnley_dir_id from public.club_directory where name = 'Burnley RUFC';
  select id into v_rossendale_dir_id from public.club_directory where name = 'Rossendale RUFC';
  select id into v_leigh_dir_id from public.club_directory where name = 'Leigh RUFC';

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.site.admin@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.burnley.admin@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.rossendale.admin@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.u12.admin@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.parent@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.pending.claimant@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.burnley.fixturesec@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.burnley.u13admin@ovalball.local', '', now(), now(), '{}', '{}'),
    ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.leigh.admin@ovalball.local', '', now(), now(), '{}', '{}')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values
    ('00000000-0000-0000-0000-000000000001', 'Test', 'SiteAdmin', 'test.site.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000002', 'Test', 'BurnleyAdmin', 'test.burnley.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000003', 'Test', 'RossendaleAdmin', 'test.rossendale.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000004', 'Test', 'U12Admin', 'test.u12.admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000007', 'Test', 'Parent', 'test.parent@ovalball.local'),
    ('00000000-0000-0000-0000-000000000008', 'Test', 'PendingClaimant', 'test.pending.claimant@ovalball.local'),
    ('00000000-0000-0000-0000-000000000009', 'Test', 'FixtureSecretary', 'test.burnley.fixturesec@ovalball.local'),
    ('00000000-0000-0000-0000-000000000010', 'Test', 'U13Admin', 'test.burnley.u13admin@ovalball.local'),
    ('00000000-0000-0000-0000-000000000011', 'Test', 'LeighAdmin', 'test.leigh.admin@ovalball.local')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, status) values ('00000000-0000-0000-0000-000000000001', 'active')
  on conflict (user_id) do nothing;

  insert into public.clubs (id, directory_id, slug, status)
  values
    ('10000000-0000-0000-0000-000000000001', v_burnley_dir_id, 'burnley-rufc-test', 'active'),
    ('10000000-0000-0000-0000-000000000002', v_rossendale_dir_id, 'rossendale-rufc-test', 'active'),
    ('10000000-0000-0000-0000-000000000003', v_leigh_dir_id, 'leigh-rufc-test', 'active')
  on conflict (id) do nothing;

  insert into public.club_memberships (id, club_id, user_id, role, status)
  values
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'CLUB_ADMIN', 'active'),
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004', 'BASIC_USER', 'active'),
    ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000007', 'BASIC_USER', 'active'),
    ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000009', 'FIXTURE_SECRETARY', 'active'),
    ('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'BASIC_USER', 'active'),
    ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000011', 'CLUB_ADMIN', 'active')
  on conflict (id) do nothing;

  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug)
  values
    ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U12', 'U12 A', 'u12-a'),
    ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U13', 'U13 A', 'u13-a'),
    ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'union', 'youth', 'U12', 'U12 A', 'u12-a')
  on conflict (id) do nothing;

  insert into public.team_permissions (membership_id, team_id, permission)
  values
    ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'team_admin'),
    ('20000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000001', 'view_only'),
    ('20000000-0000-0000-0000-000000000010', '30000000-0000-0000-0000-000000000002', 'team_admin')
  on conflict do nothing;

  insert into public.club_claims (id, directory_id, claimant_user_id, claimed_role, authority_declaration, status)
  values ('40000000-0000-0000-0000-000000000002', v_leigh_dir_id, '00000000-0000-0000-0000-000000000008', 'Fixture Secretary', 'I confirm...', 'pending')
  on conflict (id) do nothing;
end $$;

\echo '=== Fixtures ready. Running partner-club / calendar-sharing / messaging scenarios. ==='

-- ------------------------------------------------------------
-- 1. Club Admin requests a partner relationship.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  insert into public.club_partnerships (id, requesting_club_id, partner_club_id, requested_by)
    values ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002');
  raise notice 'PASS 1: Club Admin created a partnership request';
exception when others then
  raise notice 'FAIL 1: %', sqlerrm;
end $$;
commit;

-- Confirms the partner_request_received notification trigger fired for
-- Rossendale's Club Admin (not the requester).
select case when count(*) = 1 then 'PASS 1n: partner_request_received notification created for the receiving club''s admin'
  else 'FAIL 1n: expected 1 notification, found ' || count(*) end
from public.notifications
where user_id = '00000000-0000-0000-0000-000000000003' and type = 'partner_request_received';

-- ------------------------------------------------------------
-- 2. Fixture Secretary requests a partner relationship (a second, distinct
--    request so it doesn't collide with the unique active/pending pair
--    index -- uses Leigh as the target instead of Rossendale).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}';
do $$ begin
  insert into public.club_partnerships (id, requesting_club_id, partner_club_id, requested_by)
    values ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000009');
  raise notice 'PASS 2: Fixture Secretary created a partnership request';
exception when others then
  raise notice 'FAIL 2: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Team Admin cannot create a club-wide partnership.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  insert into public.club_partnerships (requesting_club_id, partner_club_id, requested_by)
    values ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004');
  raise notice 'FAIL 3: Team Admin (U12 only) created a club-wide partnership';
exception when insufficient_privilege or others then
  raise notice 'PASS 3: Team Admin cannot create a club-wide partnership (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5 (first half). Availability is NOT visible while the partnership is
--    still pending.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  perform public.get_partner_team_availability('30000000-0000-0000-0000-000000000003'::uuid, current_date, current_date + 30);
  raise notice 'FAIL 5a: read partner availability while the partnership is still pending';
exception when others then
  raise notice 'PASS 5a: cannot read partner availability while pending (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. The other club (Rossendale) approves.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  perform public.respond_to_club_partnership('70000000-0000-0000-0000-000000000001'::uuid, true);
  if (select status from public.club_partnerships where id = '70000000-0000-0000-0000-000000000001') = 'active' then
    raise notice 'PASS 4: Rossendale approved -- partnership is now active';
  else
    raise notice 'FAIL 4: partnership did not transition to active';
  end if;
end $$;
commit;

-- Confirms the existing calendar_share_approved notification (built in the
-- prior session) still fires correctly for the requesting club's admin.
select case when count(*) = 1 then 'PASS 4n: calendar_share_approved notification created for the requesting club''s admin'
  else 'FAIL 4n: expected 1 notification, found ' || count(*) end
from public.notifications
where user_id = '00000000-0000-0000-0000-000000000002' and type = 'calendar_share_approved';

-- ------------------------------------------------------------
-- 5 (second half). Availability IS visible now that the partnership is
--    active.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  perform public.get_partner_team_availability('30000000-0000-0000-0000-000000000003'::uuid, current_date, current_date + 30);
  raise notice 'PASS 5b: Burnley admin can read Rossendale U12 A''s availability now the partnership is active';
exception when others then
  raise notice 'FAIL 5b: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. A club with NO relationship (Leigh) cannot see Rossendale's
--    availability.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}';
do $$ begin
  perform public.get_partner_team_availability('30000000-0000-0000-0000-000000000003'::uuid, current_date, current_date + 30);
  raise notice 'FAIL 6: unrelated club (Leigh) read Rossendale''s availability';
exception when others then
  raise notice 'PASS 6: unrelated club cannot read Rossendale''s availability (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. Approved Club Admin requests a fixture from the shared slot --
--    exactly what the UI does after clicking an available date: one group
--    + one team-level request naming the specific partner team.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  insert into public.fixture_request_groups (id, requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
    values ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'Rossendale RUFC', current_date + 14, '00000000-0000-0000-0000-000000000002')
    returning id into v_group_id;
  insert into public.fixture_requests (id, group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
    values ('80000000-0000-0000-0000-000000000002', v_group_id, '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'home', 'sent', '00000000-0000-0000-0000-000000000002');
  raise notice 'PASS 7: Club Admin requested a fixture from Rossendale''s shared availability, naming the specific partner team';
exception when others then
  raise notice 'FAIL 7: %', sqlerrm;
end $$;
commit;

-- ------------------------------------------------------------
-- 7b. Rossendale accepts -- creates the real fixtures rows via
--     accept_fixture_request, giving scenario 15 below a real fixture_id
--     to test the FIXTURE-based conversation branch against (not just the
--     fixture_request-based one every other scenario here uses).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$ begin
  perform public.accept_fixture_request('80000000-0000-0000-0000-000000000002'::uuid);
  raise notice 'PASS 7b: Rossendale accepted -- resulting fixture created';
exception when others then
  raise notice 'FAIL 7b: %', sqlerrm;
end $$;
commit;

-- ------------------------------------------------------------
-- 8. U12 Team Admin can access the U12-vs-Rossendale-U12 conversation.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$ begin
  insert into public.fixture_messages (fixture_request_id, sender_user_id, body)
    values ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000004', 'Can you confirm 11:00?');
  raise notice 'PASS 8: U12 Team Admin can message about the U12 vs Rossendale U12 fixture request';
exception when others then
  raise notice 'FAIL 8: %', sqlerrm;
end $$;
commit;

select case when count(*) >= 1 then 'PASS 8n: new_fixture_message notification created for the other side (excluding the sender)'
  else 'FAIL 8n: no notification found' end
from public.notifications
where type = 'new_fixture_message' and user_id <> '00000000-0000-0000-0000-000000000004';

-- ------------------------------------------------------------
-- 9. U13 Team Admin (Burnley, no U12 assignment) cannot access the U12
--    conversation.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000010","role":"authenticated"}';
do $$ begin
  perform 1 from public.fixture_messages where fixture_request_id = '80000000-0000-0000-0000-000000000002';
  if found then
    raise notice 'FAIL 9a: U13 Team Admin read the U12 conversation';
  else
    raise notice 'PASS 9a: U13 Team Admin cannot read the U12 conversation (0 rows)';
  end if;
end $$;
do $$ begin
  insert into public.fixture_messages (fixture_request_id, sender_user_id, body)
    values ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010', 'Trying to butt in');
  raise notice 'FAIL 9b: U13 Team Admin sent a message into the U12 conversation';
exception when insufficient_privilege or others then
  raise notice 'PASS 9b: U13 Team Admin cannot send into the U12 conversation (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 10. Club Admin can access club-wide fixture conversations (no direct
--     team_permissions row needed).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$ begin
  perform 1 from public.fixture_messages where fixture_request_id = '80000000-0000-0000-0000-000000000002';
  if found then
    raise notice 'PASS 10: Club Admin can read the U12 fixture conversation club-wide';
  else
    raise notice 'FAIL 10: Club Admin could not read the conversation';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 11. Parent (view_only) cannot send or read operational fixture messages.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$ begin
  perform 1 from public.fixture_messages where fixture_request_id = '80000000-0000-0000-0000-000000000002';
  if found then
    raise notice 'FAIL 11a: parent (view_only) read the fixture conversation';
  else
    raise notice 'PASS 11a: parent (view_only) cannot read the fixture conversation (0 rows)';
  end if;
end $$;
do $$ begin
  insert into public.fixture_messages (fixture_request_id, sender_user_id, body)
    values ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000007', 'Can I help?');
  raise notice 'FAIL 11b: parent (view_only) sent a fixture message';
exception when insufficient_privilege or others then
  raise notice 'PASS 11b: parent (view_only) cannot send a fixture message (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 12. Pending claimant (zero club/team authority) cannot message.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}';
do $$ begin
  insert into public.fixture_messages (fixture_request_id, sender_user_id, body)
    values ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000008', 'Hello?');
  raise notice 'FAIL 12: pending claimant sent a fixture message';
exception when insufficient_privilege or others then
  raise notice 'PASS 12: pending claimant cannot send a fixture message (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 13. User from an unrelated club (Leigh, no relationship to Burnley or
--     Rossendale, no team there) cannot access the conversation.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000011","role":"authenticated"}';
do $$ begin
  perform 1 from public.fixture_messages where fixture_request_id = '80000000-0000-0000-0000-000000000002';
  if found then
    raise notice 'FAIL 13a: unrelated club''s admin read the conversation';
  else
    raise notice 'PASS 13a: unrelated club''s admin cannot read the conversation (0 rows)';
  end if;
end $$;
do $$ begin
  insert into public.fixture_messages (fixture_request_id, sender_user_id, body)
    values ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000011', 'Cold message');
  raise notice 'FAIL 13b: unrelated club''s admin sent a message with no relationship';
exception when insufficient_privilege or others then
  raise notice 'PASS 13b: unrelated club''s admin cannot send with no relationship (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 14. External (non-Ovalball) fixture still works, and the owning side can
--     message about their own external fixture -- there is no second party
--     to message until that club activates.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, raw_opposition_text)
    values ('30000000-0000-0000-0000-000000000001', current_date + 21, 'Away', 'Wigan St Judes (not on Ovalball)')
    returning id into v_fixture_id;
  insert into public.fixture_messages (fixture_id, sender_user_id, body)
    values (v_fixture_id, '00000000-0000-0000-0000-000000000002', 'Internal note: confirm minibus.');
  raise notice 'PASS 14: external-opponent fixture created and its owning club can message about it (no second-party account needed, none exists)';
exception when others then
  raise notice 'FAIL 14: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 15. Fixture Secretary can access a club-wide FIXTURE-based conversation
--     (not just a fixture_request-based one) with no direct
--     team_permissions row on that specific team -- regression test for
--     the gap 20260831141000_fixture_conversation_club_wide_access.sql
--     fixes.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
begin
  select resulting_fixture_id into v_fixture_id from public.fixture_requests where id = '80000000-0000-0000-0000-000000000002';
  if v_fixture_id is null then
    raise notice 'FAIL 15: no resulting fixture found -- scenario 7b may not have committed';
    return;
  end if;
  insert into public.fixture_messages (fixture_id, sender_user_id, body)
    values (v_fixture_id, '00000000-0000-0000-0000-000000000009', 'Fixture Secretary checking in on the confirmed fixture.');
  raise notice 'PASS 15: Fixture Secretary can message about a club-wide fixture conversation with no direct team assignment';
exception when others then
  raise notice 'FAIL 15: %', sqlerrm;
end $$;
rollback;

\echo '=== Done. Review PASS/FAIL lines above; every assertion should read PASS. ==='
