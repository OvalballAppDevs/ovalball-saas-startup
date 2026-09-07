-- Site Admin Club Directory Verification Status.
--
-- club_directory.admin_verification_status is the Site Admin attestation,
-- deliberately separate from the pre-existing verification_status column
-- (the import/data-quality pipeline's own provenance tag -- see the
-- migration's own doc comment for why these are two columns, not one).
-- club_directory_update_admin (RLS, is_site_admin()) is the real
-- authorization boundary; there is no bespoke RPC. audit_row_change
-- (already attached to club_directory) is the real audit boundary.
--
-- Self-contained/transactional: fresh gen_random_uuid() identities,
-- begin/rollback, no persistent fixture.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Club Directory: Site Admin verification status ==='

begin;

do $$
declare
  v_site_admin uuid := gen_random_uuid();
  v_club_admin uuid := gen_random_uuid();
  v_team_admin uuid := gen_random_uuid();
  v_unrelated  uuid := gen_random_uuid();
  v_dir_claimed uuid;
  v_dir_unclaimed uuid;
  v_club uuid;
  v_status text;
  v_audit_count int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_site_admin, 'dvs-site-' || v_site_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_club_admin, 'dvs-clubadmin-' || v_club_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_team_admin, 'dvs-teamadmin-' || v_team_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_unrelated,  'dvs-unrelated-' || v_unrelated::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_site_admin, 'DVS', 'Site', 'dvs-site-' || v_site_admin::text || '@ovalball.test'),
    (v_club_admin, 'DVS', 'ClubAdmin', 'dvs-clubadmin-' || v_club_admin::text || '@ovalball.test'),
    (v_team_admin, 'DVS', 'TeamAdmin', 'dvs-teamadmin-' || v_team_admin::text || '@ovalball.test'),
    (v_unrelated,  'DVS', 'Unrelated', 'dvs-unrelated-' || v_unrelated::text || '@ovalball.test');
  insert into public.site_admins (user_id, status, admin_role) values (v_site_admin, 'active', 'full');

  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'DVS Claimed RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'source_verified_address', 'site_admin_manual', 'dvs-claimed-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_dir_claimed;
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'DVS Unclaimed RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'wikipedia_current_league_discovery', 'directory_import', 'dvs-unclaimed-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_dir_unclaimed;
  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_dir_claimed, 'dvs-claimed-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club, v_club_admin, 'CLUB_ADMIN', 'active');
  -- v_team_admin represents "holds team-scoped authority only, no club-wide
  -- admin role" -- club_directory_update_admin gates on is_site_admin()
  -- alone, so a BASIC_USER-tier membership (the same shape a real Team
  -- Admin's club_memberships row has) is the correct persona here; no
  -- teams/team_permissions rows are needed to prove this specific boundary.
  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club, v_team_admin, 'BASIC_USER', 'active');

  -- =================================================================
  -- A. Default/legacy null semantics -- both rows start TBD, never VERIFIED.
  -- =================================================================
  select admin_verification_status into v_status from public.club_directory where id = v_dir_claimed;
  if v_status = 'TBD' then
    raise notice 'PASS A1: a pre-existing/legacy row defaults to TBD, never VERIFIED';
  else
    raise exception 'FAIL A1: expected TBD, got %', v_status;
  end if;
  select admin_verification_status into v_status from public.club_directory where id = v_dir_unclaimed;
  if v_status = 'TBD' then
    raise notice 'PASS A2: an unclaimed directory row also defaults to TBD';
  else
    raise exception 'FAIL A2: expected TBD, got %', v_status;
  end if;

  -- =================================================================
  -- B. Site Admin can set VERIFIED / FAILED / TBD, and it persists.
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site_admin::text, 'role', 'authenticated')::text, true);

  update public.club_directory set admin_verification_status = 'VERIFIED' where id = v_dir_claimed;
  select admin_verification_status into v_status from public.club_directory where id = v_dir_claimed;
  if v_status = 'VERIFIED' then
    raise notice 'PASS B1: Site Admin can set VERIFIED';
  else
    raise exception 'FAIL B1';
  end if;

  update public.club_directory set admin_verification_status = 'FAILED' where id = v_dir_claimed;
  select admin_verification_status into v_status from public.club_directory where id = v_dir_claimed;
  if v_status = 'FAILED' then
    raise notice 'PASS B2: Site Admin can set FAILED (club not deleted/deactivated by this alone)';
  else
    raise exception 'FAIL B2';
  end if;
  if exists (select 1 from public.club_directory where id = v_dir_claimed) and exists (select 1 from public.clubs where id = v_club and status = 'active') then
    raise notice 'PASS B3: FAILED does not delete the directory row or deactivate the club';
  else
    raise exception 'FAIL B3';
  end if;

  update public.club_directory set admin_verification_status = 'TBD' where id = v_dir_claimed;
  select admin_verification_status into v_status from public.club_directory where id = v_dir_claimed;
  if v_status = 'TBD' then
    raise notice 'PASS B4: Site Admin can set TBD';
  else
    raise exception 'FAIL B4';
  end if;

  -- Refresh (new read in the same session) preserves the value.
  update public.club_directory set admin_verification_status = 'VERIFIED' where id = v_dir_claimed;
  perform pg_sleep(0);
  select admin_verification_status into v_status from public.club_directory where id = v_dir_claimed;
  if v_status = 'VERIFIED' then
    raise notice 'PASS C: a fresh read after the write still shows the persisted value';
  else
    raise exception 'FAIL C';
  end if;

  -- =================================================================
  -- D. Invalid arbitrary value rejected (CHECK constraint, not app-layer trust).
  -- =================================================================
  begin
    update public.club_directory set admin_verification_status = 'Green Tick Verified' where id = v_dir_claimed;
    raise exception 'FAIL D: an arbitrary non-canonical value was accepted';
  exception when check_violation then
    raise notice 'PASS D: an arbitrary/emoji-string value is rejected at the database level: %', sqlerrm;
  end;

  -- =================================================================
  -- E. Changing constituent_body_id does not silently change verification status.
  -- =================================================================
  update public.club_directory set admin_verification_status = 'VERIFIED' where id = v_dir_claimed;
  update public.club_directory set constituent_body_id = (select id from public.constituent_bodies limit 1) where id = v_dir_claimed;
  select admin_verification_status into v_status from public.club_directory where id = v_dir_claimed;
  if v_status = 'VERIFIED' then
    raise notice 'PASS E: changing Constituent Body does not reset verification status';
  else
    raise exception 'FAIL E: expected VERIFIED to survive a Constituent Body change, got %', v_status;
  end if;

  reset role;

  -- =================================================================
  -- F. Ordinary Club Admin cannot change it.
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin::text, 'role', 'authenticated')::text, true);
  update public.club_directory set admin_verification_status = 'FAILED' where id = v_dir_claimed;
  if not found then
    raise notice 'PASS F: an ordinary Club Admin cannot change directory verification status (RLS silently matched zero rows)';
  else
    raise exception 'FAIL F: a Club Admin updated club_directory.admin_verification_status';
  end if;
  reset role;
  select admin_verification_status into v_status from public.club_directory where id = v_dir_claimed;
  if v_status = 'VERIFIED' then
    raise notice 'PASS F2: the value is unchanged after the denied Club Admin attempt';
  else
    raise exception 'FAIL F2: value changed to % despite RLS denial', v_status;
  end if;

  -- =================================================================
  -- G. Team Admin cannot change it.
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_team_admin::text, 'role', 'authenticated')::text, true);
  update public.club_directory set admin_verification_status = 'FAILED' where id = v_dir_claimed;
  if not found then
    raise notice 'PASS G: a Team Admin cannot change directory verification status';
  else
    raise exception 'FAIL G';
  end if;
  reset role;

  -- =================================================================
  -- H. An unrelated/unauthenticated Club user cannot change it.
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_unrelated::text, 'role', 'authenticated')::text, true);
  update public.club_directory set admin_verification_status = 'FAILED' where id = v_dir_claimed;
  if not found then
    raise notice 'PASS H: an unrelated user with no relationship to this club cannot change it';
  else
    raise exception 'FAIL H';
  end if;
  reset role;

  -- =================================================================
  -- I. Unclaimed club: verification status still lives on club_directory,
  -- no fake `clubs` row required, and Site Admin can set it directly.
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site_admin::text, 'role', 'authenticated')::text, true);
  update public.club_directory set admin_verification_status = 'VERIFIED' where id = v_dir_unclaimed;
  select admin_verification_status into v_status from public.club_directory where id = v_dir_unclaimed;
  if v_status = 'VERIFIED' and not exists (select 1 from public.clubs where directory_id = v_dir_unclaimed) then
    raise notice 'PASS I: an unclaimed club''s directory row can be verified without creating a clubs row, and remains unclaimed';
  else
    raise exception 'FAIL I';
  end if;
  reset role;

  -- =================================================================
  -- J. Audit row created for a Site Admin change (canonical audit_log, no
  -- new audit system).
  -- =================================================================
  select count(*) into v_audit_count
  from public.audit_log
  where table_name = 'club_directory' and record_id = v_dir_unclaimed and action = 'update'
    and (after->>'admin_verification_status') = 'VERIFIED';
  if v_audit_count >= 1 then
    raise notice 'PASS J: the canonical audit_log recorded the Site Admin change (% row(s))', v_audit_count;
  else
    raise exception 'FAIL J: no audit_log row found for the verification status change';
  end if;

  raise notice 'Directory admin verification status regression complete.';
end $$;

rollback;
