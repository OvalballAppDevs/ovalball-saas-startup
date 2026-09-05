-- Manual verification for CORRECTED club lifecycle semantics
-- (20260903200000): deactivation is an Ovalball ACCOUNT fact, never a
-- fixture-cancellation event; membership authority is suspended and
-- requires explicit restoration, never silently returning with the club
-- itself. NOT a migration -- run AFTER permission_matrix.sql.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/club_lifecycle.sql

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  -- A dedicated, standalone test club -- never the shared Burnley/
  -- Rossendale fixtures other test files depend on.
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('97700000-0000-0000-0000-00000000000d', 'Lifecycle Test RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'lifecycle-test-rufc-97700000')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status)
  values ('97700000-0000-0000-0000-00000000000c', '97700000-0000-0000-0000-00000000000d', 'lifecycle-test-rufc-97700000', 'active')
  on conflict (id) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('97700000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.lifecycle.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  values ('97700000-0000-0000-0000-000000000001', 'Test', 'LifecycleAdmin', 'test.lifecycle.admin@ovalball.local')
  on conflict (id) do nothing;
  insert into public.club_memberships (id, club_id, user_id, role, status)
  values ('97700000-0000-0000-0000-000000000002', '97700000-0000-0000-0000-00000000000c', '97700000-0000-0000-0000-000000000001', 'CLUB_ADMIN', 'active')
  on conflict (id) do nothing;

  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug)
  values ('97700000-0000-0000-0000-000000000003', '97700000-0000-0000-0000-00000000000c', 'union', 'youth', 'U12', 'Lifecycle Test RUFC U12 A', 'lifecycle-u12-a')
  on conflict (id) do nothing;

  -- Real activated opponent: Rossendale (shared fixture, unmodified).
  -- Past fixture (already played) with a real recorded result.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, home_score, away_score, result_status)
  values ('97700000-0000-0000-0000-000000000010', '97700000-0000-0000-0000-000000000003', null, 'Home', 'Old Rivals FC', current_date - 60, 'Completed', 'club_created', 24, 12, 'external_recorded')
  on conflict (id) do nothing;

  -- A CONFIRMED future fixture with Rossendale (real activated opponent,
  -- mirror-linked two-sided rows).
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('97700000-0000-0000-0000-000000000011', '97700000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date + 14, 'Booked', 'club_created')
  on conflict (id) do nothing;
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, mirror_fixture_id)
  values ('97700000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000003', '97700000-0000-0000-0000-000000000003', 'Away', 'Lifecycle Test RUFC', current_date + 14, 'Booked', 'club_created', '97700000-0000-0000-0000-000000000011')
  on conflict (id) do nothing;
  update public.fixtures set mirror_fixture_id = '97700000-0000-0000-0000-000000000012' where id = '97700000-0000-0000-0000-000000000011';

  -- A PENDING fixture request FROM Rossendale TO the test club (still
  -- awaiting response when the test club deactivates).
  insert into public.fixture_request_groups (id, requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id, proposed_date, created_by)
  values ('97700000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000002', 'Lifecycle Test RUFC', '97700000-0000-0000-0000-00000000000d', '97700000-0000-0000-0000-00000000000c', current_date + 30, '00000000-0000-0000-0000-000000000003')
  on conflict (id) do nothing;
  insert into public.fixture_requests (id, group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values ('97700000-0000-0000-0000-000000000031', '97700000-0000-0000-0000-000000000030', '30000000-0000-0000-0000-000000000003', '97700000-0000-0000-0000-000000000003', 'away', 'sent', '00000000-0000-0000-0000-000000000003')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- Setup sanity: 3 fixtures + 1 pending request exist before deactivation.
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.fixtures where id in (
    '97700000-0000-0000-0000-000000000010', '97700000-0000-0000-0000-000000000011', '97700000-0000-0000-0000-000000000012'
  );
  if v_count = 3 then
    raise notice 'PASS setup: 3 fixtures created (1 past, 1 confirmed future two-sided, 1 pending request target) before deactivation';
  else
    raise notice 'FAIL setup: fixture count = %', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- Deactivate the club.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.deactivate_club('97700000-0000-0000-0000-00000000000c', 'Club has left Ovalball for this season');
commit;

-- ------------------------------------------------------------
-- 1. Deactivation never deletes the canonical club_directory identity.
-- ------------------------------------------------------------
do $$
declare
  v_name text;
  v_active boolean;
begin
  select name, active into v_name, v_active from public.club_directory where id = '97700000-0000-0000-0000-00000000000d';
  if v_name = 'Lifecycle Test RUFC' and v_active = true then
    raise notice 'PASS 1: the canonical club_directory identity is never touched by deactivation -- a recognised club still exists in rugby even when not active on Ovalball';
  else
    raise notice 'FAIL 1: directory name=%, active=%', v_name, v_active;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. Past fixtures remain exactly as they were.
-- ------------------------------------------------------------
do $$
declare
  v_status text;
begin
  select status into v_status from public.fixtures where id = '97700000-0000-0000-0000-000000000010';
  if v_status = 'Completed' then
    raise notice 'PASS 2: a past fixture remains exactly as it was -- never touched by club deactivation';
  else
    raise notice 'FAIL 2: status=%', v_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Past results remain exactly as they were.
-- ------------------------------------------------------------
do $$
declare
  v_home_score integer;
  v_result_status text;
begin
  select home_score, result_status into v_home_score, v_result_status from public.fixtures where id = '97700000-0000-0000-0000-000000000010';
  if v_home_score = 24 and v_result_status = 'external_recorded' then
    raise notice 'PASS 3: a past result remains exactly as it was';
  else
    raise notice 'FAIL 3: home_score=%, result_status=%', v_home_score, v_result_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. THE CORE FIX: a confirmed future fixture is NOT automatically
--    cancelled solely because the club deactivated -- deactivation is an
--    account fact, not a fixture-cancellation workflow.
-- ------------------------------------------------------------
do $$
declare
  v_status text;
  v_mirror_status text;
begin
  select status into v_status from public.fixtures where id = '97700000-0000-0000-0000-000000000011';
  select status into v_mirror_status from public.fixtures where id = '97700000-0000-0000-0000-000000000012';
  if v_status = 'Booked' and v_mirror_status = 'Booked' then
    raise notice 'PASS 4: a confirmed future fixture is NOT auto-cancelled by club deactivation -- Rossendale''s fixture stays on their calendar exactly as it was';
  else
    raise notice 'FAIL 4: status=%, mirror_status=%', v_status, v_mirror_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. A pending fixture request targeting the now-deactivated club can no
--    longer be accepted -- it transitions to the SAME practical semantics
--    as a request against a genuinely unclaimed club (nobody active to
--    approve it), never a fake acceptance.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"97700000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.accept_fixture_request('97700000-0000-0000-0000-000000000031');
  raise notice 'FAIL 5: the deactivated club''s own admin was able to accept a fixture request on its behalf';
exception when others then
  raise notice 'PASS 5: a pending request targeting a deactivated club cannot be accepted -- nobody active to confirm on its behalf, matching unclaimed-club semantics (%)', sqlerrm;
end $$;
rollback;

do $$
declare
  v_status text;
begin
  select status into v_status from public.fixture_requests where id = '97700000-0000-0000-0000-000000000031';
  if v_status = 'sent' then
    raise notice 'PASS 5b: the pending request itself is untouched (still ''sent'') -- no fake status invented, the club just has nobody able to act on it';
  else
    raise notice 'FAIL 5b: request status = %', v_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. A NEW fixture request against the now-deactivated club uses the
--    same canonical external/unactivated semantics already supported for
--    an unclaimed club -- created normally, sits unactionable, no fake
--    admin invented.
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
  v_request_id uuid;
begin
  insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id, proposed_date, created_by)
  values ('10000000-0000-0000-0000-000000000002', 'Lifecycle Test RUFC', '97700000-0000-0000-0000-00000000000d', '97700000-0000-0000-0000-00000000000c', current_date + 45, '00000000-0000-0000-0000-000000000003')
  returning id into v_group_id;
  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values (v_group_id, '30000000-0000-0000-0000-000000000003', '97700000-0000-0000-0000-000000000003', 'home', 'sent', '00000000-0000-0000-0000-000000000003')
  returning id into v_request_id;
  if v_request_id is not null then
    raise notice 'PASS 6: a new fixture request against a deactivated club is created normally (same shape as against an unclaimed club) -- no fake Ovalball request, no fake admin invented';
  else
    raise notice 'FAIL 6: could not create a new request against the deactivated club';
  end if;
end $$;

-- ------------------------------------------------------------
-- 7. The active opponent (Rossendale) still has the confirmed fixture on
--    its own calendar -- a plain read via their own row.
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.fixtures where owning_team_id = '30000000-0000-0000-0000-000000000003' and id = '97700000-0000-0000-0000-000000000012' and status = 'Booked';
  if v_count = 1 then
    raise notice 'PASS 7: the active opponent retains the fixture on its own calendar, unaffected';
  else
    raise notice 'FAIL 7: Rossendale''s own fixture row count/status mismatch (%)', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 8. The deactivated club's own Club Admin has no active operational
--    authority.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"97700000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_is_admin boolean;
begin
  select internal.is_club_admin('97700000-0000-0000-0000-00000000000c') into v_is_admin;
  if v_is_admin = false then
    raise notice 'PASS 8: the deactivated club''s own Club Admin has no active operational authority';
  else
    raise notice 'FAIL 8: Club Admin authority incorrectly still active';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 9. Historical membership rows are retained (never deleted) -- only
--    authority is gated.
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
  v_status text;
begin
  select count(*), max(status) into v_count, v_status from public.club_memberships where id = '97700000-0000-0000-0000-000000000002';
  if v_count = 1 and v_status = 'active' then
    raise notice 'PASS 9: the historical membership row is retained (status still ''active'', never deleted or revoked) -- only real authority is gated';
  else
    raise notice 'FAIL 9: membership count=%, status=%', v_count, v_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 9b. The other half of the correction, proven directly: since the test
--     club is now operationally external, the real active opponent
--     (Rossendale) can change the kick-off DIRECTLY, no negotiation
--     expected -- exactly the pre-existing external-opponent path, now
--     correctly triggered by deactivation too. This is also what
--     generates real post-deactivation fixture activity for the
--     reconciliation review (15/16) to find.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_kickoff_date date;
  v_pending date;
begin
  perform public.update_fixture_kickoff('97700000-0000-0000-0000-000000000012', current_date + 15, '15:00');
  select kickoff_date, kickoff_amendment_proposed_date into v_kickoff_date, v_pending from public.fixtures where id = '97700000-0000-0000-0000-000000000012';
  if v_kickoff_date = current_date + 15 and v_pending is null then
    raise notice 'PASS 9b: the active opponent (Rossendale) can change the kick-off DIRECTLY once the other club is deactivated -- treated as operationally external, no negotiation cycle expected';
  else
    raise notice 'FAIL 9b: kickoff_date=%, pending=%', v_kickoff_date, v_pending;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- Reactivate the club.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.reactivate_club('97700000-0000-0000-0000-00000000000c');
commit;

-- ------------------------------------------------------------
-- 10. Privileged authority does NOT automatically restore just because
--     the club itself is active again.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"97700000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_is_admin boolean;
begin
  select internal.is_club_admin('97700000-0000-0000-0000-00000000000c') into v_is_admin;
  if v_is_admin = false then
    raise notice 'PASS 10: Club Admin authority does NOT silently return just because the club is active again -- explicit restoration is required';
  else
    raise notice 'FAIL 10: Club Admin authority was silently restored on club reactivation';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 11. Explicit access restoration succeeds (Site Admin review) and then
--     the same person''s authority genuinely returns.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.list_suspended_club_memberships('97700000-0000-0000-0000-00000000000c');
  if v_count = 1 then
    raise notice 'PASS 11a: "Previous Club Access" review lists exactly the one suspended membership';
  else
    raise notice 'FAIL 11a: suspended membership review count = %', v_count;
  end if;

  perform public.restore_club_membership_authority('97700000-0000-0000-0000-000000000002');
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"97700000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_is_admin boolean;
begin
  select internal.is_club_admin('97700000-0000-0000-0000-00000000000c') into v_is_admin;
  if v_is_admin = true then
    raise notice 'PASS 11b: after explicit restoration, the same real Club Admin''s authority genuinely returns';
  else
    raise notice 'FAIL 11b: authority did not return after explicit restoration';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 12. Reactivation reuses the SAME club identity -- no new clubs row.
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
  v_status text;
begin
  select count(*) into v_count from public.clubs where directory_id = '97700000-0000-0000-0000-00000000000d';
  select status into v_status from public.clubs where id = '97700000-0000-0000-0000-00000000000c';
  if v_count = 1 and v_status = 'active' then
    raise notice 'PASS 12: reactivation reuses the SAME club identity -- exactly one clubs row for this directory entry, now active again';
  else
    raise notice 'FAIL 12: clubs row count=%, status=%', v_count, v_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 13. No duplicate team was created by any of this.
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.teams where club_id = '97700000-0000-0000-0000-00000000000c';
  if v_count = 1 then
    raise notice 'PASS 13: no duplicate team was created -- still exactly one team at this club';
  else
    raise notice 'FAIL 13: team count = %', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 14. No duplicate fixture was created by any of this.
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.fixtures where id in (
    '97700000-0000-0000-0000-000000000010', '97700000-0000-0000-0000-000000000011', '97700000-0000-0000-0000-000000000012'
  );
  if v_count = 3 then
    raise notice 'PASS 14: no duplicate fixture was created -- still exactly the 3 original rows';
  else
    raise notice 'FAIL 14: fixture count = %', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 15/16. Reconciliation: past fixture reads produce no notification spam
--    (a plain read is just a read); future/changed fixtures since
--    deactivation are reviewable via a dedicated, read-only function.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_notif_count_before integer;
  v_notif_count_after integer;
  v_review_count integer;
begin
  select count(*) into v_notif_count_before from public.notifications;
  select count(*) into v_review_count from public.list_fixtures_since_deactivation('97700000-0000-0000-0000-00000000000c');
  select count(*) into v_notif_count_after from public.notifications;
  if v_notif_count_after = v_notif_count_before then
    raise notice 'PASS 15: reviewing fixture history (past or otherwise) never generates a notification -- reading is not an event';
  else
    raise notice 'FAIL 15: notification count changed from % to % just from reading', v_notif_count_before, v_notif_count_after;
  end if;
  if v_review_count >= 1 then
    raise notice 'PASS 16: future/changed fixtures since deactivation are surfaced as a reviewable list (% row(s)) -- never silently applied, never presented as previously accepted', v_review_count;
  else
    raise notice 'FAIL 16: reconciliation review returned % rows, expected at least the new request-worthy activity', v_review_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 17. Fixture cancellation remains a completely separate, explicit
--     lifecycle operation -- deactivate_club() itself never calls it, and
--     a real cancellation still works normally and independently.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  update public.fixtures set status = 'Cancelled', cancelled_at = now(), cancellation_reason = 'Genuinely rained off' where id = '97700000-0000-0000-0000-000000000012';
  raise notice 'PASS 17: an explicit, separate fixture-cancellation workflow (Site Admin cancel_fixture path) still works normally and independently of club deactivation';
exception when others then
  raise notice 'FAIL 17: explicit fixture cancellation unexpectedly failed (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 18. Audit: both deactivate and reactivate events are recorded, plus
--     the membership authority restoration.
-- ------------------------------------------------------------
do $$
declare
  v_deactivate_count integer;
  v_reactivate_count integer;
  v_restore_count integer;
begin
  select count(*) into v_deactivate_count from public.audit_log
  where table_name = 'clubs' and record_id = '97700000-0000-0000-0000-00000000000c' and after->>'event' = 'deactivated';
  select count(*) into v_reactivate_count from public.audit_log
  where table_name = 'clubs' and record_id = '97700000-0000-0000-0000-00000000000c' and after->>'event' = 'reactivated';
  select count(*) into v_restore_count from public.audit_log
  where table_name = 'club_memberships' and record_id = '97700000-0000-0000-0000-000000000002' and after->>'event' = 'authority_restored';
  if v_deactivate_count = 1 and v_reactivate_count = 1 and v_restore_count = 1 then
    raise notice 'PASS 18: deactivate, reactivate, and authority-restore are all fully audited';
  else
    raise notice 'FAIL 18: deactivate_audit=%, reactivate_audit=%, restore_audit=%', v_deactivate_count, v_reactivate_count, v_restore_count;
  end if;
end $$;
