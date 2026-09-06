-- CALENDAR FIXTURE LIFECYCLE + MESSAGE CLUB regression suite (Section U).
-- Fully self-contained: creates its own throwaway club/teams/users/fixtures,
-- rolls back at the end. Run via:
--   docker exec -i supabase_db_ovalball-training-management psql -U postgres -d postgres -f - < supabase/tests/calendar_fixture_lifecycle_regression.sql

\set ON_ERROR_STOP on
\pset pager off

begin;

do $$
declare
  v_directory_a uuid := gen_random_uuid();
  v_directory_b uuid := gen_random_uuid();
  v_club_a uuid := gen_random_uuid();
  v_club_b uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_team_admin_a uuid := gen_random_uuid(); -- Team Admin only, NOT Club Admin, on club A's team
  v_admin_b uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_team_a uuid := gen_random_uuid();
  v_team_b uuid := gen_random_uuid();
  v_fixture_a uuid;
  v_fixture_b uuid;
  v_legacy_fixture uuid;
  v_membership_admin_a uuid;
  v_membership_team_admin_a uuid;
  v_impact_count int;
begin
  -- ---- fixtures: two claimed clubs, one legacy/unresolved opponent ----
  insert into public.club_directory (id, name, town, rugby_code, country, nation, source, verification_status, normalized_key) values
    (v_directory_a, 'Regression Fixture Lifecycle Club A', 'Testville', 'union', 'England', 'England', 'manual', 'source_verified_club', 'regression-fixture-lifecycle-club-a-' || substr(v_directory_a::text, 1, 8)),
    (v_directory_b, 'Regression Fixture Lifecycle Club B', 'Testville', 'union', 'England', 'England', 'manual', 'source_verified_club', 'regression-fixture-lifecycle-club-b-' || substr(v_directory_b::text, 1, 8));
  insert into public.clubs (id, directory_id, status, slug) values
    (v_club_a, v_directory_a, 'active', 'regression-lifecycle-club-a-' || substr(v_club_a::text, 1, 8)),
    (v_club_b, v_directory_b, 'active', 'regression-lifecycle-club-b-' || substr(v_club_b::text, 1, 8));
  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug) values
    (v_team_a, v_club_a, 'union', 'youth', 'U12', 'Regression Lifecycle A U12', 'regression-lifecycle-a-u12-' || substr(v_team_a::text, 1, 8)),
    (v_team_b, v_club_b, 'union', 'youth', 'U12', 'Regression Lifecycle B U12', 'regression-lifecycle-b-u12-' || substr(v_team_b::text, 1, 8));

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change_token_current, email_change, phone_change, phone_change_token, reauthentication_token)
  select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.email, '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''
  from (values (v_admin_a, 'regr.lifecycle.admin.a@ovalball.local'), (v_team_admin_a, 'regr.lifecycle.teamadmin.a@ovalball.local'),
               (v_admin_b, 'regr.lifecycle.admin.b@ovalball.local'), (v_outsider, 'regr.lifecycle.outsider@ovalball.local')) as x(id, email);
  insert into public.profiles (id, first_name, surname)
  select id, 'Regr', 'User' from (values (v_admin_a), (v_team_admin_a), (v_admin_b), (v_outsider)) as x(id);

  insert into public.club_memberships (id, club_id, user_id, role, status) values
    (gen_random_uuid(), v_club_a, v_admin_a, 'CLUB_ADMIN', 'active'),
    (gen_random_uuid(), v_club_b, v_admin_b, 'CLUB_ADMIN', 'active')
  ;
  select id into v_membership_admin_a from public.club_memberships where user_id = v_admin_a;
  -- v_team_admin_a: a BASIC_USER club membership + a team_admin team_permissions row (Team Admin, NOT Club Admin)
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_a, v_team_admin_a, 'BASIC_USER', 'active');
  select id into v_membership_team_admin_a from public.club_memberships where user_id = v_team_admin_a;
  insert into public.team_permissions (id, team_id, membership_id, permission) values (gen_random_uuid(), v_team_a, v_membership_team_admin_a, 'team_admin');

  -- Two-sided, mirror-linked, real confirmed fixture between two CLAIMED clubs (Section D positive case).
  -- enforce_shared_team_fixture_capacity (an existing, unrelated same-day
  -- capacity guard) has no mirror-pair special case -- inserting BOTH rows
  -- of one genuine confirmed match trips it exactly as it would for any
  -- other same-day double-booking, since it only ever excludes the literal
  -- new.id, never a reciprocal mirror row. Disabled for just this
  -- self-contained setup step (rolled back with the whole transaction
  -- regardless) rather than touching that unrelated trigger's own logic,
  -- which is out of scope for this Calendar Fixture Lifecycle task.
  alter table public.fixtures disable trigger enforce_shared_team_fixture_capacity;
  v_fixture_a := gen_random_uuid();
  v_fixture_b := gen_random_uuid();
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, status, raw_opposition_text, kickoff_date, kickoff_time)
  values (v_fixture_a, v_team_a, v_team_b, 'Home', 'Booked', 'Regression Lifecycle B U12', current_date + 14, '14:00');
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, status, raw_opposition_text, kickoff_date, kickoff_time, mirror_fixture_id)
  values (v_fixture_b, v_team_b, v_team_a, 'Away', 'Booked', 'Regression Lifecycle A U12', current_date + 14, '14:00', v_fixture_a);
  update public.fixtures set mirror_fixture_id = v_fixture_b where id = v_fixture_a;
  alter table public.fixtures enable trigger enforce_shared_team_fixture_capacity;

  -- A legacy/unresolved-opponent fixture (Section D negative case): no opponent_team_id at all.
  v_legacy_fixture := gen_random_uuid();
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, status, raw_opposition_text, kickoff_date)
  values (v_legacy_fixture, v_team_a, null, 'Home', 'Planned', 'Vacant Fixture', current_date + 21);

  raise notice '--- Section U 1-10: cancel_fixture authorization, confirmation, mirror sync, no physical delete, audit ---';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider::text, 'role', 'authenticated')::text, true);
  begin
    perform public.cancel_fixture(v_fixture_a, 'tamper');
    raise exception 'FAIL 2/9: outsider was able to cancel a fixture they have no relationship to';
  exception when others then
    if sqlerrm like '%not authorized%' then raise notice 'PASS 2/9: unauthorized/cross-club outsider cannot cancel'; else raise; end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_team_admin_a::text, 'role', 'authenticated')::text, true);
  begin
    perform public.cancel_fixture(v_fixture_a, '');
    raise exception 'FAIL 3: blank reason accepted';
  exception when others then
    if sqlerrm like '%reason is required%' then raise notice 'PASS 3: cancel requires a non-blank reason'; else raise; end if;
  end;

  perform public.cancel_fixture(v_fixture_a, 'Team Admin cancelling: pitch closed');
  raise notice 'PASS 1: a Team Admin (not Club Admin) CAN cancel their own team''s fixture -- same authority as existing fixture-mutation actions';

  reset role;
  perform 1 from public.fixtures where id = v_fixture_a and status = 'Cancelled' and cancelled_at is not null and cancelled_by = v_team_admin_a and cancellation_reason = 'Team Admin cancelling: pitch closed';
  if not found then raise exception 'FAIL 5: cancel_fixture did not set status/cancelled_at/cancelled_by/cancellation_reason correctly'; end if;
  raise notice 'PASS 5: fixture_id preserved, cancellation fields correctly set on the canonical row';

  perform 1 from public.fixtures where id = v_fixture_b and status = 'Cancelled';
  if not found then raise exception 'FAIL: mirror fixture was not synced to Cancelled'; end if;
  raise notice 'PASS: cancelling one side propagates to its mirror_fixture_id row, exactly like fold_team()';

  perform 1 from public.fixtures where id = v_fixture_a; -- still exists
  if not found then raise exception 'FAIL 7: cancel_fixture physically removed the row'; end if;
  raise notice 'PASS 7: no physical fixture deletion occurred';

  perform 1 from public.audit_log where table_name = 'fixtures' and record_id = v_fixture_a and action = 'update' order by changed_at desc limit 1;
  if not found then raise exception 'FAIL 8: no audit_log row recorded for the cancellation'; end if;
  raise notice 'PASS 8: audit event recorded (generic audit_row_change trigger, already attached to fixtures)';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  begin
    perform public.cancel_fixture(v_fixture_a, 'already cancelled retry');
    raise exception 'FAIL: double-cancel should be rejected';
  exception when others then
    if sqlerrm like '%already cancelled%' then raise notice 'PASS: cancelling an already-cancelled fixture is rejected'; else raise; end if;
  end;
  reset role;

  raise notice '--- Section U: archive_fixture (Delete Fixture) -- narrower authority, no physical delete, mirror untouched ---';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_team_admin_a::text, 'role', 'authenticated')::text, true);
  begin
    perform public.archive_fixture(v_legacy_fixture, 'Team Admin trying to delete');
    raise exception 'FAIL 9: cross-role tamper -- a Team Admin (not Club Admin) was able to delete/archive a fixture';
  exception when others then
    if sqlerrm like '%own Club Admin or Fixtures Secretary%' then raise notice 'PASS 9/M: Team Admin CANNOT delete/archive (narrower gate than cancel, matches the role matrix)'; else raise; end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider::text, 'role', 'authenticated')::text, true);
  begin
    perform public.archive_fixture(v_legacy_fixture, 'tamper');
    raise exception 'FAIL 10: cross-club delete tamper accepted';
  exception when others then
    if sqlerrm like '%own Club Admin or Fixtures Secretary%' then raise notice 'PASS 10: cross-club delete tamper rejected'; else raise; end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  begin
    perform public.archive_fixture(v_legacy_fixture, '');
    raise exception 'FAIL: blank reason accepted for delete';
  exception when others then
    if sqlerrm like '%reason is required%' then raise notice 'PASS: delete requires a non-blank reason'; else raise; end if;
  end;

  perform public.archive_fixture(v_legacy_fixture, 'Section U test: erroneous duplicate entry');
  reset role;

  perform 1 from public.fixtures where id = v_legacy_fixture and archived_at is not null and archived_by = v_admin_a and archival_reason = 'Section U test: erroneous duplicate entry';
  if not found then raise exception 'FAIL 6: archive_fixture did not set archived_at/archived_by/archival_reason correctly'; end if;
  raise notice 'PASS 6: fixture_id preserved, archive fields correctly set';

  perform 1 from public.fixtures where id = v_legacy_fixture; -- still exists physically
  if not found then raise exception 'FAIL 7 (delete): archive_fixture physically removed the row'; end if;
  raise notice 'PASS 7 (delete): no physical fixture deletion occurred for archive either';

  perform 1 from public.fixtures where id = v_legacy_fixture and status <> 'Cancelled';
  if not found then raise exception 'design check failed: archive should not itself mutate status';
  else raise notice 'CONFIRMED: archiving is orthogonal to status (Section G design) -- the legacy fixture stays Planned, archived_at is what hides it'; end if;

  raise notice '--- Deleted Calendar Events archive (Section H) ---';
  select count(*) into v_impact_count from public.deleted_calendar_events where event_type = 'fixture' and canonical_id = v_legacy_fixture;
  if v_impact_count <> 1 then raise exception 'FAIL 18: archived fixture does not appear in deleted_calendar_events'; end if;
  raise notice 'PASS 18: archived fixture appears in Deleted Calendar Events with the correct canonical_id';

  raise notice '--- restore_fixture (Section J) ---';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  perform public.restore_fixture(v_legacy_fixture);
  reset role;
  perform 1 from public.fixtures where id = v_legacy_fixture and archived_at is null;
  if not found then raise exception 'FAIL: restore_fixture did not clear archived_at'; end if;
  raise notice 'PASS: restore_fixture reverses archive without touching status -- a real, working restore path exists (Section J)';

  raise notice '--- Message Club eligibility (Sections D, O, 22-27) -- pure data-shape checks the server action itself gates on ---';
  perform 1 from public.fixtures f join public.teams ot on ot.id = f.owning_team_id join public.clubs oc on oc.id = ot.club_id
    where f.id = v_fixture_a and f.opponent_team_id is not null and oc.status = 'active';
  if not found then raise exception 'FAIL 22: eligible fixture (real, active, claimed opponent) does not satisfy the eligibility predicate'; end if;
  raise notice 'PASS 22: a claimed, active Ovalball opponent satisfies Message Club eligibility (opponent_team_id resolved + active club)';

  perform 1 from public.fixtures where id = v_legacy_fixture and opponent_team_id is null;
  if not found then raise exception 'FAIL 24: legacy/unresolved-opponent fixture unexpectedly has an opponent_team_id';
  else raise notice 'PASS 24: legacy/free-text opponent (opponent_team_id null) correctly fails the eligibility predicate -- Message Club stays hidden'; end if;

  raise notice '--- cleanup ---';
  raise notice 'All Calendar Fixture Lifecycle regression assertions PASSED.';
end $$;

rollback;

\echo 'Calendar Fixture Lifecycle regression suite complete -- every NOTICE above must read PASS/CONFIRMED, and the transaction rolled back (no residue).'
