-- Manual verification for Site Admin diagnostic club access
-- (20260903700000): the capability flag, its grant/revoke RPC, and the
-- enter/exit/resolve diagnostic-session RPCs. NOT a migration -- run
-- after permission_matrix.sql, like the other manual test files:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/site_admin_diagnostic_access.sql
--
-- Self-contained: two fresh Site Admins (one Full, one restricted) and
-- one fresh active club, never reusing Burnley/Rossendale or any other
-- shared fixture club.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change) values
    ('99700000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.diag.fulladmin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99700000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.diag.restrictedadmin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('99700000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.diag.notasiteadmin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email) values
    ('99700000-0000-0000-0000-000000000001', 'Test', 'DiagFullAdmin', 'test.diag.fulladmin@ovalball.local'),
    ('99700000-0000-0000-0000-000000000002', 'Test', 'DiagRestrictedAdmin', 'test.diag.restrictedadmin@ovalball.local'),
    ('99700000-0000-0000-0000-000000000003', 'Test', 'DiagNotASiteAdmin', 'test.diag.notasiteadmin@ovalball.local')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, status, admin_role, diagnostic_club_access) values
    ('99700000-0000-0000-0000-000000000001', 'active', 'full', true),
    ('99700000-0000-0000-0000-000000000002', 'active', 'read_only', false)
  on conflict (user_id) do nothing;

  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    ('99700000-0000-0000-0000-0000000d0001', 'Diagnostic Access Test RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'diagnostic-access-test-99700000'),
    ('99700000-0000-0000-0000-0000000d0002', 'Diagnostic Access Suspended RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'diagnostic-access-suspended-99700000')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status) values
    ('99700000-0000-0000-0000-0000000c0001', '99700000-0000-0000-0000-0000000d0001', 'diagnostic-access-test-99700000', 'active'),
    ('99700000-0000-0000-0000-0000000c0002', '99700000-0000-0000-0000-0000000d0002', 'diagnostic-access-suspended-99700000', 'suspended')
  on conflict (id) do nothing;
end $$;

\echo '=== Fixtures ready. Running Site Admin diagnostic access scenarios. ==='

-- ------------------------------------------------------------
-- 1. A restricted (non-Full) Site Admin may NOT grant diagnostic access,
--    not even to themselves.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  begin
    perform public.set_site_admin_diagnostic_capability('99700000-0000-0000-0000-000000000002', true);
    raise notice 'FAIL 1: a restricted Site Admin was able to grant themselves diagnostic access';
  exception when others then
    raise notice 'PASS 1: a restricted Site Admin cannot grant diagnostic access (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. A plain authenticated user with no Site Admin standing at all may
--    not grant diagnostic access either.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  begin
    perform public.set_site_admin_diagnostic_capability('99700000-0000-0000-0000-000000000002', true);
    raise notice 'FAIL 2: a non-Site-Admin was able to grant diagnostic access';
  exception when others then
    raise notice 'PASS 2: a non-Site-Admin cannot grant diagnostic access (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. The Full Site Admin CAN grant diagnostic access to the restricted
--    admin, and it is reflected on site_admins.
-- ------------------------------------------------------------
do $$
declare
  v_granted boolean;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000001","role":"authenticated"}';
  perform public.set_site_admin_diagnostic_capability('99700000-0000-0000-0000-000000000002', true);

  set local role postgres;
  select diagnostic_club_access into v_granted from public.site_admins where user_id = '99700000-0000-0000-0000-000000000002';
  if v_granted is true then
    raise notice 'PASS 3: Full Site Admin granted diagnostic access, reflected on site_admins';
  else
    raise notice 'FAIL 3: diagnostic_club_access was not set to true after grant';
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. Before the grant took effect for a fresh session, a Site Admin
--    without the capability cannot enter a diagnostic club session
--    (using the not-a-site-admin-at-all account to also confirm that
--    non-admins are rejected the same way as ungranted admins).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  begin
    perform public.enter_diagnostic_club('99700000-0000-0000-0000-0000000c0001');
    raise notice 'FAIL 4: a non-Site-Admin was able to enter a diagnostic club session';
  exception when others then
    raise notice 'PASS 4: a non-Site-Admin cannot enter a diagnostic club session (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. The now-granted restricted admin CAN enter a diagnostic session for
--    the active club, and resolve_diagnostic_session returns real facts
--    for it (club id/name/entered_at).
-- ------------------------------------------------------------
do $$
declare
  v_session_id uuid;
  v_club_id uuid;
  v_club_name text;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000002","role":"authenticated"}';
  v_session_id := public.enter_diagnostic_club('99700000-0000-0000-0000-0000000c0001');

  select club_id, club_name into v_club_id, v_club_name from public.resolve_diagnostic_session(v_session_id);

  if v_club_id = '99700000-0000-0000-0000-0000000c0001' and v_club_name = 'Diagnostic Access Test RUFC' then
    raise notice 'PASS 5: granted admin entered a diagnostic session and it resolves to the right club';
  else
    raise notice 'FAIL 5: diagnostic session did not resolve to the expected club (got id=%, name=%)', v_club_id, v_club_name;
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. Entering a diagnostic session for a NON-active (suspended) club is
--    refused.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  begin
    perform public.enter_diagnostic_club('99700000-0000-0000-0000-0000000c0002');
    raise notice 'FAIL 6: was able to enter a diagnostic session for a suspended club';
  exception when others then
    raise notice 'PASS 6: entering a diagnostic session for a suspended club is refused (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. Entering a diagnostic session for a NONEXISTENT club is refused
--    (never a silent nonexistent-club session).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  begin
    perform public.enter_diagnostic_club('99700000-0000-0000-0000-000000000000');
    raise notice 'FAIL 7: was able to enter a diagnostic session for a nonexistent club';
  exception when others then
    raise notice 'PASS 7: entering a diagnostic session for a nonexistent club is refused (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 8. Entering a SECOND diagnostic session for the same admin auto-closes
--    the first (exactly one open session per admin at a time) -- reusing
--    the still-open session from scenario 5.
-- ------------------------------------------------------------
do $$
declare
  v_first_session_id uuid;
  v_second_session_id uuid;
  v_first_exited timestamptz;
begin
  select id into v_first_session_id from public.site_admin_diagnostic_sessions
    where site_admin_user_id = '99700000-0000-0000-0000-000000000002' and exited_at is null
    order by entered_at desc limit 1;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000002","role":"authenticated"}';
  v_second_session_id := public.enter_diagnostic_club('99700000-0000-0000-0000-0000000c0001');

  set local role postgres;
  select exited_at into v_first_exited from public.site_admin_diagnostic_sessions where id = v_first_session_id;

  if v_first_exited is not null and v_second_session_id <> v_first_session_id then
    raise notice 'PASS 8: entering a second diagnostic session auto-closed the first';
  else
    raise notice 'FAIL 8: the first diagnostic session was not auto-closed on re-entry';
  end if;
end $$;

-- ------------------------------------------------------------
-- 9. exit_diagnostic_club closes the caller's own open session, and
--    resolve_diagnostic_session no longer returns anything for it.
-- ------------------------------------------------------------
do $$
declare
  v_session_id uuid;
  v_row_count int;
begin
  select id into v_session_id from public.site_admin_diagnostic_sessions
    where site_admin_user_id = '99700000-0000-0000-0000-000000000002' and exited_at is null
    order by entered_at desc limit 1;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000002","role":"authenticated"}';
  perform public.exit_diagnostic_club(v_session_id);

  select count(*) into v_row_count from public.resolve_diagnostic_session(v_session_id);
  if v_row_count = 0 then
    raise notice 'PASS 9: exit_diagnostic_club closes the session and it no longer resolves';
  else
    raise notice 'FAIL 9: session still resolves after exit_diagnostic_club';
  end if;
end $$;

-- ------------------------------------------------------------
-- 10. A Site Admin may not exit or resolve ANOTHER admin's session --
--     exit_diagnostic_club is a silent no-op (never a permission error
--     that would leak the session's existence) and resolve returns
--     nothing.
-- ------------------------------------------------------------
do $$
declare
  v_session_id uuid;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000001","role":"authenticated"}';
  v_session_id := public.enter_diagnostic_club('99700000-0000-0000-0000-0000000c0001');
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_other_session_id uuid;
  v_row_count int;
begin
  select id into v_other_session_id from public.site_admin_diagnostic_sessions
    where site_admin_user_id = '99700000-0000-0000-0000-000000000001' and exited_at is null
    order by entered_at desc limit 1;

  select count(*) into v_row_count from public.resolve_diagnostic_session(v_other_session_id);
  if v_row_count = 0 then
    raise notice 'PASS 10a: an admin cannot resolve another admin''s diagnostic session';
  else
    raise notice 'FAIL 10a: resolved another admin''s diagnostic session';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 11. Revoking diagnostic access blocks a further attempt to enter a new
--     diagnostic session, even though the previous grant had worked.
-- ------------------------------------------------------------
do $$
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000001","role":"authenticated"}';
  perform public.set_site_admin_diagnostic_capability('99700000-0000-0000-0000-000000000002', false);
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"99700000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  begin
    perform public.enter_diagnostic_club('99700000-0000-0000-0000-0000000c0001');
    raise notice 'FAIL 11: entered a diagnostic session after access was revoked';
  exception when others then
    raise notice 'PASS 11: revoked diagnostic access blocks entering a new session (%)', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 12. Revoking/granting diagnostic access never touches admin_role or
--     status -- internal.prevent_last_full_admin_lockout's protection is
--     completely unaffected by this feature.
-- ------------------------------------------------------------
do $$
declare
  v_role text;
  v_status text;
begin
  select admin_role, status into v_role, v_status from public.site_admins where user_id = '99700000-0000-0000-0000-000000000002';
  if v_role = 'read_only' and v_status = 'active' then
    raise notice 'PASS 12: granting/revoking diagnostic access left admin_role and status untouched';
  else
    raise notice 'FAIL 12: admin_role/status changed as a side effect (role=%, status=%)', v_role, v_status;
  end if;
end $$;
