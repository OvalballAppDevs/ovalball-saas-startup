-- FINAL VERIFICATION CLOSURE Section 8: notification recipients for the
-- player-request/eligibility domain must be derived from stable
-- team/club capabilities, and no unrelated team or club may ever
-- receive one. Seeds TWO clubs (Club A = the real subject, Club B =
-- a genuinely unrelated club) plus, within Club A, an unrelated third
-- team that has no relationship to either side of any request -- then
-- asserts, by querying public.notifications directly per user, exactly
-- who received what and who received nothing.
--
-- This local Supabase database also carries REAL notification rows
-- from earlier live browser verification passes on this same feature
-- (which reused the same real auth.users identities, e.g. 002 = the
-- actual Burnley admin). A plain "count(*) where type=... and
-- user_id=..." would therefore double-count against that legitimate
-- pre-existing data. Every assertion here is instead scoped to the
-- EXACT call_up_id/dispensation_id this test itself created (captured
-- into a session-temp table), so a pass/fail can never be an artifact
-- of unrelated real data sitting in the same database.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/player_movement_notification_recipients.sql

\set ON_ERROR_STOP off
\pset pager off
begin;

create temp table notify_test_ids (call_up_adult uuid, call_up_same_age uuid, dispensation_adult uuid);
grant all on notify_test_ids to authenticated;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d00c0', 'Notify Test Club A', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'notify-test-club-a-9d000000'),
  ('9d000000-0000-0000-0000-0000000d00c1', 'Notify Test Club B (unrelated)', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'notify-test-club-b-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c00c0', '9d000000-0000-0000-0000-0000000d00c0', 'notify-test-club-a-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000c00c1', '9d000000-0000-0000-0000-0000000d00c1', 'notify-test-club-b-9d000000', 'active');

-- 002 = Club A's CLUB_ADMIN. 009 = Club A's FIXTURE_SECRETARY (a
-- distinct club-scope role -- must NOT receive the eligibility
-- notification, which the RPC deliberately restricts to CLUB_ADMIN
-- only). 006 = source-team admin on BOTH source teams under test.
-- 005 = target-team admin on BOTH target teams under test (the
-- requester in both flows). 004 = admin of a genuinely UNRELATED team
-- in the SAME club -- must receive nothing. 003 = CLUB_ADMIN of the
-- unrelated Club B -- must receive nothing.
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000c00001', '9d000000-0000-0000-0000-0000000c00c0', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
  ('9d000000-0000-0000-0000-000000c00002', '9d000000-0000-0000-0000-0000000c00c0', '00000000-0000-0000-0000-000000000009', 'FIXTURE_SECRETARY', 'active'),
  ('9d000000-0000-0000-0000-000000c00003', '9d000000-0000-0000-0000-0000000c00c0', '00000000-0000-0000-0000-000000000006', 'BASIC_USER', 'active'),
  ('9d000000-0000-0000-0000-000000c00004', '9d000000-0000-0000-0000-0000000c00c0', '00000000-0000-0000-0000-000000000005', 'BASIC_USER', 'active'),
  ('9d000000-0000-0000-0000-000000c00005', '9d000000-0000-0000-0000-0000000c00c0', '00000000-0000-0000-0000-000000000004', 'BASIC_USER', 'active'),
  ('9d000000-0000-0000-0000-000000c00006', '9d000000-0000-0000-0000-0000000c00c1', '00000000-0000-0000-0000-000000000003', 'CLUB_ADMIN', 'active');

insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-00000000f101', '9d000000-0000-0000-0000-0000000c00c0', 'union', 'colts', 'SeniorColts', null, null, 'Senior Colts', 'nt-sc', true),
  ('9d000000-0000-0000-0000-00000000f102', '9d000000-0000-0000-0000-0000000c00c0', 'union', 'senior', null, 'mens', '2nd', 'Men''s 2nd', 'nt-mens2', true),
  ('9d000000-0000-0000-0000-00000000f103', '9d000000-0000-0000-0000-0000000c00c0', 'union', 'youth', 'U14', 'boys', null, 'U14', 'nt-u14', true),
  ('9d000000-0000-0000-0000-00000000f104', '9d000000-0000-0000-0000-0000000c00c0', 'union', 'youth', 'U14', 'boys', 'B', 'U14 B', 'nt-u14b', true),
  ('9d000000-0000-0000-0000-00000000f105', '9d000000-0000-0000-0000-0000000c00c0', 'union', 'youth', 'U16', 'boys', null, 'U16 (unrelated)', 'nt-u16', true),
  ('9d000000-0000-0000-0000-00000000f106', '9d000000-0000-0000-0000-0000000c00c1', 'union', 'youth', 'U14', 'boys', null, 'Club B U14', 'nt-b-u14', true);

insert into public.team_permissions (membership_id, team_id, permission, created_by) values
  ('9d000000-0000-0000-0000-000000c00003', '9d000000-0000-0000-0000-00000000f101', 'team_admin', '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-000000c00003', '9d000000-0000-0000-0000-00000000f103', 'team_admin', '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-000000c00004', '9d000000-0000-0000-0000-00000000f102', 'team_admin', '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-000000c00004', '9d000000-0000-0000-0000-00000000f104', 'team_admin', '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-000000c00005', '9d000000-0000-0000-0000-00000000f105', 'team_admin', '00000000-0000-0000-0000-000000000002');

insert into public.players (id, first_name, surname, date_of_birth, active, created_by) values
  ('9d000000-0000-0000-0000-00000000f110', 'Notify', 'AdultCrossing17', (current_date - interval '17 years')::date, true, '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-00000000f111', 'Notify', 'SameAge14', (current_date - interval '14 years')::date, true, '00000000-0000-0000-0000-000000000002');
insert into public.player_team_memberships (player_id, team_id, status, created_by) values
  ('9d000000-0000-0000-0000-00000000f110', '9d000000-0000-0000-0000-00000000f101', 'active', '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-00000000f111', '9d000000-0000-0000-0000-00000000f103', 'active', '00000000-0000-0000-0000-000000000002');
insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-00000000f120', '9d000000-0000-0000-0000-00000000f102', current_date + 7, 'Home', 'Notify Test Opponent Adult', 'Booked'),
  ('9d000000-0000-0000-0000-00000000f121', '9d000000-0000-0000-0000-00000000f104', current_date + 7, 'Home', 'Notify Test Opponent Same-Age', 'Booked');

-- === Flow 1: adult crossing (17yo Senior Colts -> Men's 2nd) requested
-- by the TARGET team admin (005). Expected: exactly one
-- player_eligibility_approval_required notification, to Club A's
-- CLUB_ADMIN (002) ONLY -- not the FIXTURE_SECRETARY (009), not the
-- source-team admin (006), not the requester (005) themself, not the
-- unrelated team admin (004), and not Club B's admin (003).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  v_id := public.request_player_call_up('9d000000-0000-0000-0000-00000000f120', '9d000000-0000-0000-0000-00000000f110', '9d000000-0000-0000-0000-00000000f101', '9d000000-0000-0000-0000-00000000f102', 'RFU Regulation 15');
  update notify_test_ids set call_up_adult = v_id;
  if not found then insert into notify_test_ids (call_up_adult) values (v_id); end if;
end $$;
reset role;

update notify_test_ids set dispensation_adult = (select eligibility_requirement_id from public.fixture_player_call_up where id = call_up_adult);

do $$
declare v_count integer; v_call_up uuid;
begin
  select call_up_adult into v_call_up from notify_test_ids;

  select count(*) into v_count from public.notifications where type = 'player_eligibility_approval_required' and user_id = '00000000-0000-0000-0000-000000000002' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 1 then raise notice 'PASS 1: Club A CLUB_ADMIN (002) received exactly one player_eligibility_approval_required notification for THIS request'; else raise notice 'FAIL 1: count=%', v_count; end if;

  select count(*) into v_count from public.notifications where type = 'player_eligibility_approval_required' and user_id = '00000000-0000-0000-0000-000000000009' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 0 then raise notice 'PASS 2: Club A FIXTURE_SECRETARY (009) received ZERO eligibility notifications for THIS request -- that role is deliberately excluded'; else raise notice 'FAIL 2: count=%', v_count; end if;

  select count(*) into v_count from public.notifications where type = 'player_eligibility_approval_required' and user_id = '00000000-0000-0000-0000-000000000006' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 0 then raise notice 'PASS 3: source-team admin (006) received ZERO eligibility notifications for THIS request -- they are not the approval authority for this stage'; else raise notice 'FAIL 3: count=%', v_count; end if;

  select count(*) into v_count from public.notifications where type = 'player_eligibility_approval_required' and user_id = '00000000-0000-0000-0000-000000000005' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 0 then raise notice 'PASS 4: the requester themself (005) received ZERO eligibility notifications for their own request'; else raise notice 'FAIL 4: count=%', v_count; end if;

  select count(*) into v_count from public.notifications where type = 'player_eligibility_approval_required' and user_id = '00000000-0000-0000-0000-000000000004' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 0 then raise notice 'PASS 5: an unrelated team admin in the SAME club (004) received ZERO eligibility notifications for THIS request'; else raise notice 'FAIL 5: count=%', v_count; end if;

  select count(*) into v_count from public.notifications where type = 'player_eligibility_approval_required' and user_id = '00000000-0000-0000-0000-000000000003' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 0 then raise notice 'PASS 6: the UNRELATED club B admin (003) received ZERO eligibility notifications for THIS request -- no cross-club leak'; else raise notice 'FAIL 6: count=%', v_count; end if;
end $$;

-- === Flow 2: ordinary same-age call-up (U14 -> U14 B, both Club A)
-- requested by the TARGET team admin (005). Expected: fixture_call_up_
-- requested goes to the SOURCE team admin (006) and to Club A's
-- CLUB_ADMIN (002) and FIXTURE_SECRETARY (009) -- but NOT to the
-- unrelated same-club team admin (004) and NOT to Club B's admin (003).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}';
do $$
declare v_id uuid;
begin
  v_id := public.request_player_call_up('9d000000-0000-0000-0000-00000000f121', '9d000000-0000-0000-0000-00000000f111', '9d000000-0000-0000-0000-00000000f103', '9d000000-0000-0000-0000-00000000f104', 'Same-age team-to-team');
  update notify_test_ids set call_up_same_age = v_id;
end $$;
reset role;

do $$
declare v_count integer; v_call_up uuid;
begin
  select call_up_same_age into v_call_up from notify_test_ids;

  select count(*) into v_count from public.notifications where type = 'fixture_call_up_requested' and user_id = '00000000-0000-0000-0000-000000000006' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 1 then raise notice 'PASS 7: source-team admin (006) received exactly one fixture_call_up_requested notification for THIS request'; else raise notice 'FAIL 7: count=%', v_count; end if;

  select count(*) into v_count from public.notifications where type = 'fixture_call_up_requested' and user_id = '00000000-0000-0000-0000-000000000002' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 1 then raise notice 'PASS 8: Club A CLUB_ADMIN (002) received exactly one fixture_call_up_requested notification for THIS request'; else raise notice 'FAIL 8: count=%', v_count; end if;

  select count(*) into v_count from public.notifications where type = 'fixture_call_up_requested' and user_id = '00000000-0000-0000-0000-000000000009' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 1 then raise notice 'PASS 9: Club A FIXTURE_SECRETARY (009) received exactly one fixture_call_up_requested notification for THIS request'; else raise notice 'FAIL 9: count=%', v_count; end if;

  select count(*) into v_count from public.notifications where type = 'fixture_call_up_requested' and user_id = '00000000-0000-0000-0000-000000000004' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 0 then raise notice 'PASS 10: an unrelated team admin in the SAME club (004) received ZERO fixture_call_up_requested notifications for THIS request'; else raise notice 'FAIL 10: count=%', v_count; end if;

  select count(*) into v_count from public.notifications where type = 'fixture_call_up_requested' and user_id = '00000000-0000-0000-0000-000000000003' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 0 then raise notice 'PASS 11: the UNRELATED club B admin (003) received ZERO fixture_call_up_requested notifications for THIS request -- no cross-club leak'; else raise notice 'FAIL 11: count=%', v_count; end if;

  select count(*) into v_count from public.notifications where type = 'fixture_call_up_requested' and user_id = '00000000-0000-0000-0000-000000000005' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 0 then raise notice 'PASS 12: the requester themself (005) received ZERO fixture_call_up_requested notifications for their own request'; else raise notice 'FAIL 12: count=%', v_count; end if;
end $$;

-- === Flow 3: decide the same-age call-up as the source-team admin
-- (006). Expected: fixture_call_up_decided goes ONLY to the original
-- requester (005) -- not to 002/009/006 (the deciding admin themself
-- gets nothing for their own decision), not to unrelated users.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
do $$
declare v_call_up_id uuid;
begin
  select call_up_same_age into v_call_up_id from notify_test_ids;
  perform public.decide_player_call_up(v_call_up_id, 'approve');
end $$;
reset role;

do $$
declare v_count integer; v_call_up uuid;
begin
  select call_up_same_age into v_call_up from notify_test_ids;

  select count(*) into v_count from public.notifications where type = 'fixture_call_up_decided' and user_id = '00000000-0000-0000-0000-000000000005' and (data->>'call_up_id')::uuid = v_call_up;
  if v_count = 1 then raise notice 'PASS 13: the requester (005) received exactly one fixture_call_up_decided notification for THIS decision'; else raise notice 'FAIL 13: count=%', v_count; end if;

  select count(*) into v_count from public.notifications where type = 'fixture_call_up_decided' and (data->>'call_up_id')::uuid = v_call_up and user_id <> '00000000-0000-0000-0000-000000000005';
  if v_count = 0 then raise notice 'PASS 14: no one else (deciding admin, club roles, unrelated users) received a fixture_call_up_decided notification for THIS decision'; else raise notice 'FAIL 14: count=%', v_count; end if;
end $$;

-- === Flow 4: carry the adult-crossing dispensation through
-- source_team -> club -> governing_body approval, then confirm the
-- resulting "Age-grade approval granted" propagation notification also
-- goes ONLY to the original call-up requester (005), never to the
-- deciding Club Admin (002) or anyone else.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}';
do $$
declare v_disp_id uuid;
begin
  select dispensation_adult into v_disp_id from notify_test_ids;
  perform public.decide_player_dispensation(v_disp_id, 'source_team', true);
end $$;
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare v_disp_id uuid;
begin
  select dispensation_adult into v_disp_id from notify_test_ids;
  perform public.decide_player_dispensation(v_disp_id, 'club', true);
  perform public.decide_player_dispensation(v_disp_id, 'governing_body', true, 'CB-REF-9D000000-NOTIFY');
end $$;
reset role;

do $$
declare v_count integer; v_call_up uuid;
begin
  select call_up_adult into v_call_up from notify_test_ids;

  select count(*) into v_count from public.notifications where type = 'fixture_call_up_decided' and user_id = '00000000-0000-0000-0000-000000000005' and (data->>'call_up_id')::uuid = v_call_up and body like '%has been recorded%';
  if v_count = 1 then raise notice 'PASS 15: the requester (005) received exactly one governing-body-approval-granted propagation notification for THIS request'; else raise notice 'FAIL 15: count=%', v_count; end if;

  select count(*) into v_count from public.notifications where type = 'fixture_call_up_decided' and (data->>'call_up_id')::uuid = v_call_up and body like '%has been recorded%' and user_id <> '00000000-0000-0000-0000-000000000005';
  if v_count = 0 then raise notice 'PASS 16: no one else received the governing-body-approval-granted propagation notification for THIS request'; else raise notice 'FAIL 16: count=%', v_count; end if;
end $$;

rollback;
