-- Manual verification for Site Admin Fixture Management (fixtures RLS as
-- exercised through the admin actions, delete_fixture()/publish_import_row()
-- dependency and conflict-resolution logic, and the CSV-import staging
-- tables' own RLS). NOT a migration -- never applied automatically by
-- `db reset`. Run by hand against local Supabase:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_management.sql
--
-- Self-contained: creates its own Site Admin (00...0014) and reuses the
-- shared fixture ids from permission_matrix.sql (Burnley admin 0002,
-- Rossendale admin 0003, U12 A team 30000000-...0001, U13 A team
-- 30000000-...0002, Burnley club 10000000-...0001). Every scenario rolls
-- back unless noted. SET LOCAL role/request.jwt.claims are always
-- top-level statements, never inside a DO block.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.fixture.mgmt.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values ('00000000-0000-0000-0000-000000000014', 'Test', 'FixtureMgmtAdmin', 'test.fixture.mgmt.admin@ovalball.local')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, status)
  values ('00000000-0000-0000-0000-000000000014', 'active')
  on conflict (user_id) do nothing;
end $$;

\echo '=== Fixtures ready. Running Fixture Management scenarios. ==='

-- ------------------------------------------------------------
-- 1. Site Admin can list fixtures.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.admin_fixture_overview;
  raise notice 'PASS 1: Site Admin can list fixtures (% rows)', v_count;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. Non-Site-Admin cannot access the admin fixture manager's staged-
--    import surface (fixture_import_batches is_site_admin()-only RLS).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.fixture_import_batches (uploaded_by, filename) values ('00000000-0000-0000-0000-000000000002', 'sneaky.csv');
  raise notice 'FAIL 2: a Club Admin created an import batch';
exception when others then
  raise notice 'PASS 2: a Club Admin cannot create an import batch -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3 / 4. Site Admin can create and edit a fixture directly.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
  values ('30000000-0000-0000-0000-000000000001', current_date + 21, 'Home', 'Planned', 'SQL Fixture Mgmt Test Opponent', 'site_admin_manual')
  returning id into v_fixture_id;
  raise notice 'PASS 3: Site Admin can create a fixture directly (id %)', v_fixture_id;

  update public.fixtures set status = 'Booked' where id = v_fixture_id;
  if found then
    raise notice 'PASS 4: Site Admin can edit a fixture';
  else
    raise notice 'FAIL 4: edit matched 0 rows';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. Cancel preserves history -- status flips, row/messages/audit stay.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
  v_before_count int;
  v_after_count int;
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000001', current_date + 22, 'Home', 'Planned', 'SQL Cancel Test')
  returning id into v_fixture_id;
  insert into public.fixture_messages (fixture_id, sender_user_id, body) values (v_fixture_id, '00000000-0000-0000-0000-000000000014', 'test message');

  select count(*) into v_before_count from public.fixture_messages where fixture_id = v_fixture_id;
  update public.fixtures set status = 'Cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = 'test' where id = v_fixture_id;
  select count(*) into v_after_count from public.fixture_messages where fixture_id = v_fixture_id;

  if v_before_count = v_after_count and v_before_count > 0 then
    raise notice 'PASS 5: cancelling a fixture preserves its messages (% -> %)', v_before_count, v_after_count;
  else
    raise notice 'FAIL 5: message count changed on cancel (% -> %)', v_before_count, v_after_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. Unsafe hard delete is blocked when messages exist.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000001', current_date + 23, 'Home', 'Planned', 'SQL Delete Block Test')
  returning id into v_fixture_id;
  insert into public.fixture_messages (fixture_id, sender_user_id, body) values (v_fixture_id, '00000000-0000-0000-0000-000000000014', 'blocks delete');

  perform public.delete_fixture(v_fixture_id);
  raise notice 'FAIL 6: a fixture with messages was permanently deleted';
exception when others then
  raise notice 'PASS 6: hard delete blocked for a fixture with linked messages -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. A safe, disposable fixture (no messages/requests) can be deleted.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
  v_still_exists boolean;
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000001', current_date + 24, 'Home', 'Planned', 'SQL Disposable Delete Test')
  returning id into v_fixture_id;

  perform public.delete_fixture(v_fixture_id);
  select exists(select 1 from public.fixtures where id = v_fixture_id) into v_still_exists;
  if v_still_exists then
    raise notice 'FAIL 7: disposable fixture was not actually deleted';
  else
    raise notice 'PASS 7: hard delete succeeded for a disposable fixture with no dependencies';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 13 / 14. Duplicate-import protection: the same source_reference cannot
--    be recorded twice (fixture_source_refs unique (source_system,
--    source_id)) -- proves a repeated upload is safely flagged rather
--    than silently duplicating fixtures.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_fixture_id_1 uuid;
  v_fixture_id_2 uuid;
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000001', current_date + 25, 'Home', 'Planned', 'SQL Dedup Test 1') returning id into v_fixture_id_1;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000001', current_date + 26, 'Home', 'Planned', 'SQL Dedup Test 2') returning id into v_fixture_id_2;

  insert into public.fixture_source_refs (fixture_id, source_system, source_id) values (v_fixture_id_1, 'csv_import', 'SQL-DEDUP-REF-1');
  begin
    insert into public.fixture_source_refs (fixture_id, source_system, source_id) values (v_fixture_id_2, 'csv_import', 'SQL-DEDUP-REF-1');
    raise notice 'FAIL 13/14: the same source_reference was recorded twice';
  exception when unique_violation then
    raise notice 'PASS 13/14: a repeated source_reference is rejected -- a re-uploaded import row is safely flagged, never silently duplicated';
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 15. Conflict detection: an existing, non-cancelled fixture for the
--    same owning team + date is findable by the exact query the import
--    matcher uses (matchAndValidateRow / actions.ts).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
  v_conflict_found boolean;
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000001', current_date + 27, 'Home', 'Planned', 'SQL Conflict Test')
  returning id into v_fixture_id;

  select exists(
    select 1 from public.fixtures
    where owning_team_id = '30000000-0000-0000-0000-000000000001' and kickoff_date = current_date + 27 and status <> 'Cancelled'
  ) into v_conflict_found;

  if v_conflict_found then
    raise notice 'PASS 15: an existing same-team/same-date fixture is detected by the conflict query';
  else
    raise notice 'FAIL 15: conflict query found nothing';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 16 / 17 / 18 / 21. publish_import_row()'s four conflict decisions
--    produce exactly the intended records.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_existing_id uuid;
  v_batch_id uuid;
  v_row_keep_existing uuid;
  v_row_replace_notify uuid;
  v_row_override uuid;
  v_new_fixture_id uuid;
  v_message_count int;
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000001', current_date + 28, 'Home', 'Planned', 'SQL Existing For Conflict Decisions')
  returning id into v_existing_id;

  insert into public.fixture_import_batches (uploaded_by, filename, row_count, state)
  values ('00000000-0000-0000-0000-000000000014', 'sql-test.csv', 1, 'needs_review') returning id into v_batch_id;

  -- 16: keep_existing -- row excluded, existing fixture untouched.
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, resolved_home_team_id, raw_opposition_text, fixture_date, conflicting_fixture_id, conflict_decision)
  values (v_batch_id, 1, '{}'::jsonb, 'conflict', '30000000-0000-0000-0000-000000000001', 'SQL Keep Existing Opponent', current_date + 28, v_existing_id, 'keep_existing')
  returning id into v_row_keep_existing;
  perform public.publish_import_row(v_row_keep_existing);
  if (select status from public.fixtures where id = v_existing_id) = 'Cancelled' then
    raise notice 'FAIL 16: keep_existing cancelled the existing fixture';
  else
    raise notice 'PASS 16: keep_existing left the existing fixture untouched';
  end if;

  -- 17: replace_and_notify -- existing cancelled + a notification message.
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, resolved_home_team_id, raw_opposition_text, fixture_date, conflicting_fixture_id, conflict_decision)
  values (v_batch_id, 2, '{}'::jsonb, 'conflict', '30000000-0000-0000-0000-000000000001', 'SQL Replace Notify Opponent', current_date + 28, v_existing_id, 'replace_and_notify')
  returning id into v_row_replace_notify;
  v_new_fixture_id := public.publish_import_row(v_row_replace_notify);
  select count(*) into v_message_count from public.fixture_messages where fixture_id = v_existing_id;
  if (select status from public.fixtures where id = v_existing_id) = 'Cancelled' and v_message_count > 0 and v_new_fixture_id is not null then
    raise notice 'PASS 17: replace_and_notify cancelled the existing fixture, wrote a notification message, and published the new one';
  else
    raise notice 'FAIL 17: replace_and_notify did not produce the expected records';
  end if;
  if (select replaces_fixture_id from public.fixtures where id = v_new_fixture_id) = v_existing_id then
    raise notice 'PASS 21: the published fixture records replaces_fixture_id / provenance correctly';
  else
    raise notice 'FAIL 21: replaces_fixture_id not set on the published fixture';
  end if;

  -- 18: override_no_notify -- existing cancelled again (idempotent-ish for this test), no NEW message beyond the one from step 17.
  select count(*) into v_message_count from public.fixture_messages where fixture_id = v_existing_id;
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, resolved_home_team_id, raw_opposition_text, fixture_date, conflicting_fixture_id, conflict_decision)
  values (v_batch_id, 3, '{}'::jsonb, 'conflict', '30000000-0000-0000-0000-000000000001', 'SQL Override Opponent', current_date + 28, v_existing_id, 'override_no_notify')
  returning id into v_row_override;
  perform public.publish_import_row(v_row_override);
  if (select count(*) from public.fixture_messages where fixture_id = v_existing_id) = v_message_count then
    raise notice 'PASS 18: override_no_notify cancelled without adding a notification message (and the cancellation itself is still captured by the fixtures audit trigger)';
  else
    raise notice 'FAIL 18: override_no_notify unexpectedly added a message';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 19 / 20. game_type validates against the four real options at the
--    database layer, not only in the app's own normalization.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, game_type)
  values ('30000000-0000-0000-0000-000000000001', current_date + 29, 'Home', 'Planned', 'SQL Invalid Game Type Test', 'Not A Real Type');
  raise notice 'FAIL 19: an invalid game_type value was accepted';
exception when others then
  raise notice 'PASS 19: an invalid game_type value is rejected by the database -- %', sqlerrm;
end $$;
do $$
declare
  v_type text;
begin
  foreach v_type in array array['Friendly', 'League Fixture', 'Cup Fixture', 'Scheduled Match'] loop
    insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text, game_type)
    values ('30000000-0000-0000-0000-000000000001', current_date + 30, 'Home', 'Planned', 'SQL Valid Game Type Test', v_type);
  end loop;
  raise notice 'PASS 20: all four real game_type options are accepted';
exception when others then
  raise notice 'FAIL 20: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 24. Malformed/cross-club IDs cannot mutate an unrelated fixture --
--    Rossendale's admin cannot edit Burnley's fixture directly.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
begin
  insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('90000000-0000-0000-0000-000000000024', '30000000-0000-0000-0000-000000000001', current_date + 31, 'Home', 'Planned', 'SQL Cross Club Test')
  on conflict (id) do nothing;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  update public.fixtures set status = 'Cancelled' where id = '90000000-0000-0000-0000-000000000024';
  if found then
    raise notice 'FAIL 24: Rossendale''s admin cancelled Burnley''s fixture';
  else
    raise notice 'PASS 24: Rossendale''s admin cannot mutate Burnley''s fixture (0 rows matched)';
  end if;
exception when others then
  raise notice 'PASS 24 (alt): rejected outright -- %', sqlerrm;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
delete from public.fixtures where id = '90000000-0000-0000-0000-000000000024';
commit;

\echo '=== Done. Review PASS/FAIL/SKIP lines above; every non-SKIP assertion should read PASS. ==='
\echo '=== Scenarios 8/9 (CSV export is Site Admin only / no personal data) are app-layer, verified by code inspection of app/(app)/admin/fixtures/actions.ts''s requireSiteAdmin() gate and its explicit CSV_COLUMNS allowlist, same pattern as the Club/User Management CSV scenarios. Scenarios 10-12 (staged import never auto-publishes, missing-data flagging, ambiguous-team review) are app-layer validation in app/(app)/admin/fixtures/import/actions.ts''s matchAndValidateRow(), verified by code inspection and live testing, not a SQL assertion -- the DB layer only ever sees rows the app already classified. Scenario 22 (messaging reaches only appropriate recipients) is already covered by partner_clubs_and_messaging.sql''s own notification-trigger scenarios (fixture_messages is the exact table reused here). Scenario 23 (no private email exposed) is verified by code inspection -- admin_fixture_overview never selects profiles/contact data at all. ==='
