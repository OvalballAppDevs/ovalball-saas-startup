-- Manual verification for the opponent_directory_id reconciliation trigger
-- (20260831310000): a fixture request made against a canonical-but-
-- unactivated club must become linked and its officials notified the
-- moment that club activates, using stable ids only -- never fuzzy
-- name matching, never a fabricated fixture or user. NOT a migration --
-- never applied automatically by `db reset`. Run by hand, AFTER
-- permission_matrix.sql:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/opponent_reconciliation.sql
--
-- Self-contained: uses permission_matrix.sql's own Burnley club/team/admin
-- (0001 Site Admin, 0002 Burnley admin, U12 A team) as the requesting
-- side, and Alcester RFC (a real local_dev_seed club_directory
-- row with no `clubs` row yet -- confirmed unactivated by this file's own
-- setup query) as the opponent. Every scenario rolls back except the
-- final activation, which is the whole point of the test.

\set ON_ERROR_STOP off
\pset pager off

do $$
declare
  v_preston_directory_id uuid;
  v_already_activated boolean;
begin
  select id into v_preston_directory_id from public.club_directory where name = 'Alcester RFC';
  select exists(select 1 from public.clubs where directory_id = v_preston_directory_id) into v_already_activated;
  if v_already_activated then
    raise notice 'SKIP: Alcester RFC is already activated in this database -- run against a fresh db reset --local first.';
  end if;
  perform set_config('test.preston_directory_id', v_preston_directory_id::text, false);
end $$;

-- ------------------------------------------------------------
-- 1. Burnley (activated) can create a fixture request group against the
--    unactivated Alcester RFC, using opponent_directory_id --
--    no fake `clubs` row, no fake user, fixture creation not blocked.
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
  v_request_id uuid;
begin
  insert into public.fixture_request_groups (id, requesting_club_id, raw_opponent_text, opponent_directory_id, proposed_date, created_by)
  values ('81000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Alcester RFC',
          current_setting('test.preston_directory_id')::uuid, current_date + 30, '00000000-0000-0000-0000-000000000002')
  returning id into v_group_id;

  insert into public.fixture_requests (id, group_id, requesting_team_id, venue_preference, status, created_by)
  values ('81000000-0000-0000-0000-000000000001', v_group_id, '30000000-0000-0000-0000-000000000001', 'home', 'sent', '00000000-0000-0000-0000-000000000002')
  returning id into v_request_id;

  raise notice 'PASS 1: fixture request created against an unactivated canonical opponent (no clubs/user fabricated)';
exception when others then
  raise notice 'FAIL 1: %', sqlerrm;
end $$;

do $$
declare
  v_before_link boolean;
begin
  select (opponent_club_id is not null) into v_before_link from public.fixture_request_groups where id = '81000000-0000-0000-0000-000000000001';
  if v_before_link is false then
    raise notice 'PASS 2: opponent_club_id correctly stays null while the opponent has no Ovalball account';
  else
    raise notice 'FAIL 2: opponent_club_id was set before any club activated (%)', v_before_link;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Preston activates (the same path approve_club_claim uses -- a real
--    insert into public.clubs). The reconciliation trigger must link the
--    outstanding request group and notify Preston's new CLUB_ADMIN.
-- ------------------------------------------------------------
do $$
declare
  v_preston_club_id uuid;
  v_preston_admin_id uuid := '00000000-0000-0000-0000-000000000030';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values (v_preston_admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.preston.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  values (v_preston_admin_id, 'Test', 'PrestonAdmin', 'test.preston.admin@ovalball.local')
  on conflict (id) do nothing;

  insert into public.clubs (directory_id, slug, status, created_by, updated_by)
  values (current_setting('test.preston_directory_id')::uuid, 'preston-grasshoppers-recon-test', 'active', v_preston_admin_id, v_preston_admin_id)
  returning id into v_preston_club_id;

  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_preston_club_id, v_preston_admin_id, 'CLUB_ADMIN', 'active', v_preston_admin_id, v_preston_admin_id);

  perform set_config('test.preston_club_id', v_preston_club_id::text, false);
  perform set_config('test.preston_admin_id', v_preston_admin_id::text, false);
  raise notice 'PASS 3: Alcester RFC activated';
end $$;

do $$
declare
  v_linked_club_id uuid;
begin
  select opponent_club_id into v_linked_club_id from public.fixture_request_groups where id = '81000000-0000-0000-0000-000000000001';
  if v_linked_club_id = current_setting('test.preston_club_id')::uuid then
    raise notice 'PASS 4: outstanding request group linked to the newly-activated club by stable id';
  else
    raise notice 'FAIL 4: expected %, got %', current_setting('test.preston_club_id'), v_linked_club_id;
  end if;
end $$;

do $$
declare
  v_notif_count int;
begin
  select count(*) into v_notif_count
  from public.notifications
  where user_id = current_setting('test.preston_admin_id')::uuid
    and type = 'fixture_request_received'
    and (data->>'fixture_request_id')::uuid = '81000000-0000-0000-0000-000000000001';
  if v_notif_count = 1 then
    raise notice 'PASS 5: exactly one notification created for the new club''s real CLUB_ADMIN about the outstanding request';
  else
    raise notice 'FAIL 5: expected 1 notification, found %', v_notif_count;
  end if;
end $$;

do $$
declare
  v_fixture_count int;
begin
  select count(*) into v_fixture_count from public.fixtures where kickoff_date = (select proposed_date from public.fixture_request_groups where id = '81000000-0000-0000-0000-000000000001');
  if v_fixture_count = 0 then
    raise notice 'PASS 6: activation reconciliation did not fabricate a duplicate fixture -- the request still awaits an accept/decline decision';
  else
    raise notice 'FAIL 6: a fixture was created without an accept decision (% rows)', v_fixture_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- Cleanup -- this scenario deliberately committed real state (club
-- activation), so clean it up explicitly rather than relying on rollback.
-- ------------------------------------------------------------
do $$
begin
  delete from public.notifications where user_id = current_setting('test.preston_admin_id')::uuid and type = 'fixture_request_received';
  delete from public.fixture_requests where id = '81000000-0000-0000-0000-000000000001';
  delete from public.fixture_request_groups where id = '81000000-0000-0000-0000-000000000001';
  delete from public.club_memberships where user_id = current_setting('test.preston_admin_id')::uuid;
  delete from public.clubs where id = current_setting('test.preston_club_id')::uuid;
end $$;

-- ==============================================================
-- HISTORICAL vs FUTURE reconciliation (20260831380000): a stale, never-
-- accepted request whose proposed_date has already passed must quietly
-- expire on activation, never surface as a pending request.
-- ==============================================================

do $$
declare
  v_abercarn_directory_id uuid;
begin
  select id into v_abercarn_directory_id from public.club_directory where name = 'Abercarn Rugby Football Club';
  perform set_config('test.abercarn_directory_id', v_abercarn_directory_id::text, false);
end $$;

do $$
declare
  v_group_id uuid;
begin
  insert into public.fixture_request_groups (id, requesting_club_id, raw_opponent_text, opponent_directory_id, proposed_date, created_by)
  values ('81000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Abercarn RFC',
          current_setting('test.abercarn_directory_id')::uuid, current_date - 90, '00000000-0000-0000-0000-000000000002')
  returning id into v_group_id;

  insert into public.fixture_requests (id, group_id, requesting_team_id, venue_preference, status, created_by)
  values ('81000000-0000-0000-0000-000000000002', v_group_id, '30000000-0000-0000-0000-000000000001', 'home', 'sent', '00000000-0000-0000-0000-000000000002');

  raise notice 'PASS 7: a fixture request with a past proposed_date can still be created against an unactivated canonical opponent';
exception when others then
  raise notice 'FAIL 7: %', sqlerrm;
end $$;

do $$
declare
  v_abercarn_admin_id uuid := '00000000-0000-0000-0000-000000000031';
  v_abercarn_club_id uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values (v_abercarn_admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.abercarn.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  values (v_abercarn_admin_id, 'Test', 'AbercarnAdmin', 'test.abercarn.admin@ovalball.local')
  on conflict (id) do nothing;

  insert into public.clubs (directory_id, slug, status, created_by, updated_by)
  values (current_setting('test.abercarn_directory_id')::uuid, 'abercarn-recon-test', 'active', v_abercarn_admin_id, v_abercarn_admin_id)
  returning id into v_abercarn_club_id;

  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_abercarn_club_id, v_abercarn_admin_id, 'CLUB_ADMIN', 'active', v_abercarn_admin_id, v_abercarn_admin_id);

  perform set_config('test.abercarn_club_id', v_abercarn_club_id::text, false);
  perform set_config('test.abercarn_admin_id', v_abercarn_admin_id::text, false);
  raise notice 'PASS 8: Abercarn RFC activated';
end $$;

do $$
declare
  v_status text;
begin
  select status into v_status from public.fixture_requests where id = '81000000-0000-0000-0000-000000000002';
  if v_status = 'expired' then
    raise notice 'PASS 9: the past-dated, never-accepted request was quietly expired on activation rather than left pending';
  else
    raise notice 'FAIL 9: expected status expired, got %', v_status;
  end if;
end $$;

do $$
declare
  v_notif_count int;
begin
  select count(*) into v_notif_count
  from public.notifications
  where user_id = current_setting('test.abercarn_admin_id')::uuid and type = 'fixture_request_received';
  if v_notif_count = 0 then
    raise notice 'PASS 10: no pending-request notification/backlog was created for the historical request';
  else
    raise notice 'FAIL 10: expected 0 fixture_request_received notifications, found %', v_notif_count;
  end if;
end $$;

do $$
declare
  v_linked boolean;
begin
  select (opponent_club_id = current_setting('test.abercarn_club_id')::uuid) into v_linked
  from public.fixture_request_groups where id = '81000000-0000-0000-0000-000000000002';
  if v_linked then
    raise notice 'PASS 11: the expired request group is still linked to the newly-activated club by stable id (not orphaned)';
  else
    raise notice 'FAIL 11: opponent_club_id was not linked';
  end if;
end $$;

do $$
begin
  delete from public.notifications where user_id = current_setting('test.abercarn_admin_id')::uuid;
  delete from public.fixture_requests where id = '81000000-0000-0000-0000-000000000002';
  delete from public.fixture_request_groups where id = '81000000-0000-0000-0000-000000000002';
  delete from public.club_memberships where user_id = current_setting('test.abercarn_admin_id')::uuid;
  delete from public.clubs where id = current_setting('test.abercarn_club_id')::uuid;
end $$;

-- ==============================================================
-- Directly-created fixtures.opponent_directory_id (no request layer at
-- all -- Site Admin Add Fixture / CSV import shape) against an unactivated
-- canonical opponent: a past result recorded while unactivated must STAND
-- (never become an approval-required backlog item), while the newly-
-- activated opponent gets exactly one summary notification and an opt-in
-- per-fixture claim_external_fixture_result() path to confirm or dispute.
-- ==============================================================

do $$
declare
  v_abercrave_directory_id uuid;
begin
  select id into v_abercrave_directory_id from public.club_directory where name = 'Abercrave Rugby Football Club';
  perform set_config('test.abercrave_directory_id', v_abercrave_directory_id::text, false);
end $$;

-- Two historical fixtures, both created and resulted while Abercrave is
-- still unactivated -- one will be confirmed, one disputed, after activation.
do $$
declare
  v_fixture_1 uuid := '81000000-0000-0000-0000-000000000011';
  v_fixture_2 uuid := '81000000-0000-0000-0000-000000000012';
begin
  insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, status, raw_opposition_text, opponent_directory_id, created_by, updated_by)
  values (v_fixture_1, '30000000-0000-0000-0000-000000000001', current_date - 120, 'Home', 'Completed', 'Abercrave RFC',
          current_setting('test.abercrave_directory_id')::uuid, '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002');
  insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, status, raw_opposition_text, opponent_directory_id, created_by, updated_by)
  values (v_fixture_2, '30000000-0000-0000-0000-000000000001', current_date - 100, 'Away', 'Completed', 'Abercrave RFC',
          current_setting('test.abercrave_directory_id')::uuid, '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002');
  raise notice 'PASS 12: two historical fixtures created directly against an unactivated canonical opponent';
exception when others then
  raise notice 'FAIL 12: %', sqlerrm;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.submit_fixture_result('81000000-0000-0000-0000-000000000011', 12, 24);
  perform public.submit_fixture_result('81000000-0000-0000-0000-000000000012', 18, 3);
end $$;
commit;

do $$
declare
  v_status_1 text; v_status_2 text;
begin
  select result_status into v_status_1 from public.fixtures where id = '81000000-0000-0000-0000-000000000011';
  select result_status into v_status_2 from public.fixtures where id = '81000000-0000-0000-0000-000000000012';
  if v_status_1 = 'external_recorded' and v_status_2 = 'external_recorded' then
    raise notice 'PASS 13: both historical results recorded as external_recorded (one-sided, honestly labelled, immediately standing)';
  else
    raise notice 'FAIL 13: expected external_recorded/external_recorded, got %/%', v_status_1, v_status_2;
  end if;
end $$;

do $$
declare
  v_abercrave_admin_id uuid := '00000000-0000-0000-0000-000000000032';
  v_abercrave_club_id uuid;
  v_abercrave_team_id uuid := '30000000-0000-0000-0000-000000000099';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values (v_abercrave_admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.abercrave.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  values (v_abercrave_admin_id, 'Test', 'AbercraveAdmin', 'test.abercrave.admin@ovalball.local')
  on conflict (id) do nothing;

  insert into public.clubs (directory_id, slug, status, created_by, updated_by)
  values (current_setting('test.abercrave_directory_id')::uuid, 'abercrave-recon-test', 'active', v_abercrave_admin_id, v_abercrave_admin_id)
  returning id into v_abercrave_club_id;

  insert into public.club_memberships (club_id, user_id, role, status, created_by, updated_by)
  values (v_abercrave_club_id, v_abercrave_admin_id, 'CLUB_ADMIN', 'active', v_abercrave_admin_id, v_abercrave_admin_id);

  insert into public.teams (id, club_id, display_name, slug, rugby_code, category, age_group, created_by, updated_by)
  values (v_abercrave_team_id, v_abercrave_club_id, 'U12 A', 'u12-a', 'union', 'youth', 'U12', v_abercrave_admin_id, v_abercrave_admin_id);

  perform set_config('test.abercrave_club_id', v_abercrave_club_id::text, false);
  perform set_config('test.abercrave_admin_id', v_abercrave_admin_id::text, false);
  perform set_config('test.abercrave_team_id', v_abercrave_team_id::text, false);
  raise notice 'PASS 14: Abercrave RFC activated (with an age-eligible U12 A team of its own)';
end $$;

do $$
declare
  v_notif record;
begin
  select * into v_notif from public.notifications
  where user_id = current_setting('test.abercrave_admin_id')::uuid and type = 'historical_fixtures_linked';
  if found and v_notif.body like '2 historical fixtures%' then
    raise notice 'PASS 15: exactly one summary notification created, correctly counting both historical fixtures (not one notification each)';
  else
    raise notice 'FAIL 15: expected one historical_fixtures_linked notification mentioning 2 fixtures, got: %', v_notif.body;
  end if;
end $$;

do $$
declare
  v_spam_count int;
begin
  select count(*) into v_spam_count from public.notifications
  where user_id = current_setting('test.abercrave_admin_id')::uuid and type = 'fixture_request_received';
  if v_spam_count = 0 then
    raise notice 'PASS 16: no per-fixture pending-request notification was generated for the historical fixtures';
  else
    raise notice 'FAIL 16: expected 0, found %', v_spam_count;
  end if;
end $$;

-- Confirm fixture 1 (matching score) -- becomes a real mutual confirmation.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000032","role":"authenticated"}';
do $$
begin
  perform public.claim_external_fixture_result('81000000-0000-0000-0000-000000000011', current_setting('test.abercrave_team_id')::uuid, 12, 24, null);
end $$;
commit;

do $$
declare
  v_status text; v_opp uuid;
begin
  select result_status, opponent_team_id into v_status, v_opp from public.fixtures where id = '81000000-0000-0000-0000-000000000011';
  if v_status = 'final' and v_opp = current_setting('test.abercrave_team_id')::uuid then
    raise notice 'PASS 17: newly-activated opponent confirming a matching historical score links their team and finalizes the result';
  else
    raise notice 'FAIL 17: expected final/%, got %/%', current_setting('test.abercrave_team_id'), v_status, v_opp;
  end if;
end $$;

-- Dispute fixture 2 (differing score) -- original must be preserved.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000032","role":"authenticated"}';
do $$
begin
  perform public.claim_external_fixture_result('81000000-0000-0000-0000-000000000012', current_setting('test.abercrave_team_id')::uuid, 18, 6, 'We have this fixture at 18-6, not 18-3.');
end $$;
commit;

do $$
declare
  v_status text; v_home int; v_away int;
begin
  select result_status, home_score, away_score into v_status, v_home, v_away from public.fixtures where id = '81000000-0000-0000-0000-000000000012';
  if v_status = 'disputed' and v_home = 18 and v_away = 3 then
    raise notice 'PASS 18: a disputed historical claim moves the fixture to disputed while the ORIGINAL score (18-3) is preserved on the fixture, never silently overwritten';
  else
    raise notice 'FAIL 18: expected disputed/18/3, got %/%/%', v_status, v_home, v_away;
  end if;
end $$;

do $$
declare
  v_submission_count int;
begin
  select count(*) into v_submission_count from public.fixture_result_submissions
  where fixture_id = '81000000-0000-0000-0000-000000000012' and kind in ('external_recorded', 'dispute');
  if v_submission_count = 2 then
    raise notice 'PASS 19: both the original external_recorded submission and the new dispute submission survive in history (18-3 and 18-6 both visible)';
  else
    raise notice 'FAIL 19: expected 2 history rows, found %', v_submission_count;
  end if;
end $$;

do $$
declare
  v_notif_count int;
begin
  select count(*) into v_notif_count from public.notifications
  where type = 'fixture_result_disputed'
    and (data->>'fixture_id')::uuid = '81000000-0000-0000-0000-000000000012';
  if v_notif_count >= 1 then
    raise notice 'PASS 20: the originally-recording club was notified of the dispute';
  else
    raise notice 'FAIL 20: expected at least 1 dispute notification, found %', v_notif_count;
  end if;
end $$;

-- Cannot re-claim an already-linked fixture (double-claim protection).
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000032","role":"authenticated"}';
do $$
begin
  perform public.claim_external_fixture_result('81000000-0000-0000-0000-000000000011', current_setting('test.abercrave_team_id')::uuid, 12, 24, null);
  raise notice 'FAIL 21: re-claiming an already-linked fixture should have been rejected';
exception when others then
  raise notice 'PASS 21: re-claiming an already-linked fixture is correctly rejected (%)', sqlerrm;
end $$;
rollback;

-- An unrelated club's official (Rossendale, 0003) cannot claim Abercrave's fixture.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  perform public.claim_external_fixture_result('81000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000003', 18, 3, null);
  raise notice 'FAIL 22: an unrelated club (Rossendale) should not be able to claim Abercrave''s historical fixture';
exception when others then
  raise notice 'PASS 22: an unrelated club is correctly rejected when attempting to claim someone else''s historical fixture (%)', sqlerrm;
end $$;
rollback;

do $$
begin
  delete from public.fixture_result_submissions where fixture_id in ('81000000-0000-0000-0000-000000000011', '81000000-0000-0000-0000-000000000012');
  delete from public.fixture_messages where fixture_id in ('81000000-0000-0000-0000-000000000011', '81000000-0000-0000-0000-000000000012');
  delete from public.notifications where user_id = current_setting('test.abercrave_admin_id')::uuid;
  delete from public.notifications where (data->>'fixture_id') in ('81000000-0000-0000-0000-000000000011', '81000000-0000-0000-0000-000000000012');
  delete from public.fixtures where id in ('81000000-0000-0000-0000-000000000011', '81000000-0000-0000-0000-000000000012');
  delete from public.club_memberships where user_id = current_setting('test.abercrave_admin_id')::uuid;
  delete from public.teams where id = current_setting('test.abercrave_team_id')::uuid;
  delete from public.clubs where id = current_setting('test.abercrave_club_id')::uuid;
end $$;
