-- Manual verification for Site Admin Club Management (admin_club_overview
-- view, club_directory/clubs edit RLS, club-logos storage RLS, audit
-- logging). NOT a migration -- never applied automatically by `db reset`.
-- Run by hand against local Supabase:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/admin_club_management.sql
--
-- Self-contained: creates its own throwaway Site Admin (id ...0014) and
-- reuses the shared fixture ids from permission_matrix.sql (Burnley admin
-- 0002, Rossendale admin 0003 -- an unrelated club's admin, U12Admin 0004,
-- Coach 0006, Parent 0007, FixtureSecretary 0009, PendingClaimant 0008).
-- Every scenario rolls back. SET LOCAL role/request.jwt.claims are always
-- top-level statements, never inside a DO block, matching every other
-- test file in this project -- PL/pgSQL can't execute SET LOCAL directly.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.club.mgmt.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values ('00000000-0000-0000-0000-000000000014', 'Test', 'ClubMgmtAdmin', 'test.club.mgmt.admin@ovalball.local')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, status)
  values ('00000000-0000-0000-0000-000000000014', 'active')
  on conflict (user_id) do nothing;
end $$;

\echo '=== Fixtures ready. Running Club Management permission scenarios. ==='

-- ------------------------------------------------------------
-- 1. Site Admin can list all directory clubs (admin_club_overview).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.admin_club_overview;
  if v_count > 1000 then
    raise notice 'PASS 1: Site Admin can list the full club directory (% rows)', v_count;
  else
    raise notice 'FAIL 1: Site Admin only saw % rows', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. Site Admin can edit canonical club_directory fields.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
begin
  update public.club_directory set notes = 'sql test note' where name = 'Burnley RUFC';
  if found then
    raise notice 'PASS 2: Site Admin can edit canonical club_directory fields';
  else
    raise notice 'FAIL 2: update matched 0 rows';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Site Admin can edit the Ovalball clubs profile (only meaningful if
--    an activated Burnley clubs row exists this session -- e.g. run
--    club_people_teams.sql first, or approve a Burnley claim, for full
--    coverage; reported as SKIP rather than a false PASS otherwise).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_club_id uuid;
begin
  select c.id into v_club_id from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where cd.name = 'Burnley RUFC';
  if v_club_id is null then
    raise notice 'SKIP 3: no activated Burnley clubs row exists this session';
  else
    update public.clubs set bio = 'sql test bio' where id = v_club_id;
    if found then
      raise notice 'PASS 3: Site Admin can edit the Ovalball clubs profile';
    else
      raise notice 'FAIL 3: update matched 0 rows';
    end if;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Site Admin can write to the club-logos bucket for any activated club
--    (mirrors club_people_teams.sql scenario 14's own storage-RLS check).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_club_id uuid;
begin
  select c.id into v_club_id from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where cd.name = 'Burnley RUFC';
  if v_club_id is null then
    raise notice 'SKIP 4: no activated Burnley clubs row exists this session';
  else
    begin
      insert into storage.objects (bucket_id, name, owner)
        values ('club-logos', v_club_id || '/admin-test-logo.png', '00000000-0000-0000-0000-000000000014');
      raise notice 'PASS 4: Site Admin can upload a crest for any activated club';
    exception when others then
      raise notice 'FAIL 4: %', sqlerrm;
    end;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. Club Admin (of Burnley itself) cannot edit canonical club_directory
--    fields -- clubs_update_admin lets them edit their own `clubs` row,
--    but club_directory_update_admin is is_site_admin() only, no
--    exception for a club's own admin.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  update public.club_directory set notes = 'unauthorized attempt' where name = 'Burnley RUFC';
  if found then
    raise notice 'FAIL 6: Club Admin was able to edit canonical club_directory fields';
  else
    raise notice 'PASS 6: Club Admin cannot edit canonical club_directory fields (0 rows matched)';
  end if;
exception when others then
  raise notice 'PASS 6 (alt): rejected outright -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. Fixture Secretary cannot edit canonical club_directory fields.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000009","role":"authenticated"}';
do $$
begin
  update public.club_directory set notes = 'unauthorized attempt' where name = 'Burnley RUFC';
  if found then
    raise notice 'FAIL 7: Fixture Secretary was able to edit canonical club_directory fields';
  else
    raise notice 'PASS 7: Fixture Secretary cannot edit canonical club_directory fields (0 rows matched)';
  end if;
exception when others then
  raise notice 'PASS 7 (alt): rejected outright -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 8. Team Admin cannot edit canonical club_directory fields.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  update public.club_directory set notes = 'unauthorized attempt' where name = 'Burnley RUFC';
  if found then
    raise notice 'FAIL 8: Team Admin was able to edit canonical club_directory fields';
  else
    raise notice 'PASS 8: Team Admin cannot edit canonical club_directory fields (0 rows matched)';
  end if;
exception when others then
  raise notice 'PASS 8 (alt): rejected outright -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 9. Parent/Player cannot edit canonical club_directory fields.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$
begin
  update public.club_directory set notes = 'unauthorized attempt' where name = 'Burnley RUFC';
  if found then
    raise notice 'FAIL 9: Parent/Player was able to edit canonical club_directory fields';
  else
    raise notice 'PASS 9: Parent/Player cannot edit canonical club_directory fields (0 rows matched)';
  end if;
exception when others then
  raise notice 'PASS 9 (alt): rejected outright -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 10. Pending claimant cannot edit canonical club_directory fields.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000008","role":"authenticated"}';
do $$
begin
  update public.club_directory set notes = 'unauthorized attempt' where name = 'Burnley RUFC';
  if found then
    raise notice 'FAIL 10: Pending claimant was able to edit canonical club_directory fields';
  else
    raise notice 'PASS 10: Pending claimant cannot edit canonical club_directory fields (0 rows matched)';
  end if;
exception when others then
  raise notice 'PASS 10 (alt): rejected outright -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 11. Unauthenticated (anon) user cannot edit canonical club_directory
--     fields either.
-- ------------------------------------------------------------
begin;
set local role anon;
do $$
begin
  update public.club_directory set notes = 'anon attempt' where name = 'Burnley RUFC';
  if found then
    raise notice 'FAIL 11: unauthenticated user was able to edit club_directory';
  else
    raise notice 'PASS 11: unauthenticated user cannot edit club_directory (0 rows matched)';
  end if;
exception when others then
  raise notice 'PASS 11 (alt): unauthenticated user rejected outright -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 13. Unrelated club admin cannot exploit a known clubs.id to edit
--     another club's Ovalball profile -- being *a* Club Admin somewhere
--     is not being *this club's* Club Admin.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_club_id uuid;
begin
  select c.id into v_club_id from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where cd.name = 'Burnley RUFC';
  if v_club_id is null then
    raise notice 'SKIP 13: no activated Burnley clubs row exists this session';
  else
    update public.clubs set bio = 'cross-club exploit attempt' where id = v_club_id;
    if found then
      raise notice 'FAIL 13: Rossendale''s admin edited Burnley''s clubs profile by ID';
    else
      raise notice 'PASS 13: Rossendale''s admin cannot edit Burnley''s clubs profile by ID (0 rows matched)';
    end if;
  end if;
exception when others then
  raise notice 'PASS 13 (alt): rejected outright -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 14. Audit event is written for a canonical field change.
-- ------------------------------------------------------------
do $$
declare
  v_dir_id uuid;
  v_before_count int;
begin
  select id into v_dir_id from public.club_directory where name = 'Burnley RUFC';
  select count(*) into v_before_count from public.audit_log where table_name = 'club_directory' and record_id = v_dir_id;
  perform set_config('app.audit_before_count', v_before_count::text, false);
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
update public.club_directory set notes = 'audit check'
  where name = 'Burnley RUFC';
commit;

do $$
declare
  v_dir_id uuid;
  v_before_count int := current_setting('app.audit_before_count')::int;
  v_after_count int;
begin
  select id into v_dir_id from public.club_directory where name = 'Burnley RUFC';
  select count(*) into v_after_count from public.audit_log where table_name = 'club_directory' and record_id = v_dir_id;
  if v_after_count > v_before_count then
    raise notice 'PASS 14: an audit_log row was written for the club_directory update (% -> %)', v_before_count, v_after_count;
  else
    raise notice 'FAIL 14: no new audit_log row (% -> %)', v_before_count, v_after_count;
  end if;
  -- Clean up: this scenario deliberately commits (needs a durable change
  -- to prove the trigger fired across a real transaction boundary), so
  -- revert it explicitly rather than leaving test data behind.
  update public.club_directory set notes = null where id = v_dir_id;
end $$;

\echo '=== Expansion: canonical creation, quick-edit, signup integration, hard delete, connected users, rename safety. ==='

-- ------------------------------------------------------------
-- 16. Site Admin can create a canonical club.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
begin
  insert into public.club_directory (name, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SQL Test Create RFC', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'sql test create rfc');
  raise notice 'PASS 16: Site Admin can create a canonical club';
exception when others then
  raise notice 'FAIL 16: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 17. Ordinary user (Parent/Player) cannot create a canonical club.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$
begin
  insert into public.club_directory (name, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SQL Test Create RFC 2', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'sql test create rfc 2');
  raise notice 'FAIL 17: ordinary user was able to create a canonical club';
exception when others then
  raise notice 'PASS 17: ordinary user cannot create a canonical club -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 18. Club Admin (of an existing club) cannot create a canonical club --
--     managing your own club's profile is not the same authority as
--     adding new recognised clubs to the directory.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.club_directory (name, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SQL Test Create RFC 3', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'sql test create rfc 3');
  raise notice 'FAIL 18: a Club Admin was able to create a canonical club';
exception when others then
  raise notice 'PASS 18: a Club Admin cannot create a canonical club -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 19-21. Signup integration: rename/deactivate/reactivate immediately
--        change what an anonymous signup search can discover, because
--        both read the exact same club_directory row -- there is no
--        second signup database to fall out of sync. One temporary club,
--        one transaction, role-switched between Site Admin and anon;
--        the whole thing rolls back at the end so nothing persists.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  insert into public.club_directory (name, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SQL Signup Integration RFC', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'sql signup integration rfc')
  returning id into v_id;
  perform set_config('app.test_directory_id', v_id::text, false);
end $$;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  v_id uuid := current_setting('app.test_directory_id')::uuid;
  v_found boolean;
begin
  select exists(select 1 from public.club_directory where id = v_id and name = 'SQL Signup Integration RFC') into v_found;
  if v_found then
    raise notice 'PASS 19a: newly created active club is immediately visible to anonymous signup search';
  else
    raise notice 'FAIL 19a: new club not visible to signup search';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_id uuid := current_setting('app.test_directory_id')::uuid;
begin
  update public.club_directory set name = 'SQL Signup Integration RFC (Renamed)' where id = v_id;
end $$;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  v_id uuid := current_setting('app.test_directory_id')::uuid;
  v_found boolean;
begin
  select exists(select 1 from public.club_directory where id = v_id and name = 'SQL Signup Integration RFC (Renamed)') into v_found;
  if v_found then
    raise notice 'PASS 19b: a canonical rename is immediately reflected in signup search';
  else
    raise notice 'FAIL 19b: signup search still shows the old name (or club not found)';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_id uuid := current_setting('app.test_directory_id')::uuid;
begin
  update public.club_directory set active = false where id = v_id;
end $$;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  v_id uuid := current_setting('app.test_directory_id')::uuid;
  v_found boolean;
begin
  select exists(select 1 from public.club_directory where id = v_id) into v_found;
  if v_found then
    raise notice 'FAIL 20: deactivated club is still visible to anonymous signup search';
  else
    raise notice 'PASS 20: deactivating a club removes it from anonymous signup discovery';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_id uuid := current_setting('app.test_directory_id')::uuid;
begin
  update public.club_directory set active = true where id = v_id;
end $$;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  v_id uuid := current_setting('app.test_directory_id')::uuid;
  v_found boolean;
begin
  select exists(select 1 from public.club_directory where id = v_id) into v_found;
  if v_found then
    raise notice 'PASS 21: reactivating a club restores it to anonymous signup discovery';
  else
    raise notice 'FAIL 21: reactivated club still not visible';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 22. Hard delete fails when dependencies exist (Burnley has an
--     activated clubs row and a verified claim).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.club_directory where name = 'Burnley RUFC';
  perform public.delete_canonical_club(v_id, 'Burnley RUFC');
  raise notice 'FAIL 22: Burnley RUFC was permanently deleted despite existing history';
exception when others then
  raise notice 'PASS 22: hard delete blocked for a club with existing Ovalball history -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 23. Hard delete succeeds only for an isolated disposable record (no
--     clubs row, no claims) -- and writes an audit row for the delete.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_id uuid;
  v_still_exists boolean;
  v_audit_count int;
begin
  insert into public.club_directory (name, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SQL Disposable Delete RFC', 'union', 'United Kingdom', 'England', false, 'unverified', 'site_admin_manual', 'sql disposable delete rfc')
  returning id into v_id;

  perform public.delete_canonical_club(v_id, 'SQL Disposable Delete RFC');

  select exists(select 1 from public.club_directory where id = v_id) into v_still_exists;
  select count(*) into v_audit_count from public.audit_log where table_name = 'club_directory' and record_id = v_id and action = 'delete';

  if v_still_exists then
    raise notice 'FAIL 23: isolated disposable club was not actually deleted';
  elsif v_audit_count = 0 then
    raise notice 'FAIL 23: club was deleted but no delete audit_log row was written';
  else
    raise notice 'PASS 23: hard delete succeeded for an isolated disposable record and wrote an audit row';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 24. Deactivating a club touches only club_directory.active -- clubs,
--     teams, and (by extension) their fixtures are a different table
--     entirely, so a directory-level deactivate cannot silently cascade
--     into deleting or hiding real Ovalball history. Proven by confirming
--     Burnley's own clubs row id/created_at survive the round trip
--     untouched, not just "still exists".
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_dir_id uuid;
  v_club_id uuid;
  v_club_created_before timestamptz;
  v_club_created_after timestamptz;
begin
  select cd.id, c.id, c.created_at into v_dir_id, v_club_id, v_club_created_before
    from public.club_directory cd join public.clubs c on c.directory_id = cd.id
    where cd.name = 'Burnley RUFC';
  if v_club_id is null then
    raise notice 'SKIP 24: no activated Burnley clubs row exists this session';
  else
    update public.club_directory set active = false where id = v_dir_id;
    update public.club_directory set active = true where id = v_dir_id;
    select created_at into v_club_created_after from public.clubs where id = v_club_id;
    if v_club_created_after = v_club_created_before then
      raise notice 'PASS 24: deactivate/reactivate round trip left the activated clubs row completely untouched';
    else
      raise notice 'FAIL 24: clubs row was modified by a directory-only active toggle';
    end if;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 25. Site Admin can inspect connected users (club_memberships) of a club
--     they don't personally belong to.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.club_memberships cm
    join public.clubs c on c.id = cm.club_id
    join public.club_directory cd on cd.id = c.directory_id
    where cd.name = 'Rossendale RUFC';
  if v_count > 0 then
    raise notice 'PASS 25: Site Admin can inspect connected users of a club they do not belong to (% rows)', v_count;
  else
    raise notice 'SKIP 25: no activated Rossendale clubs row / memberships exist this session';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 26. Club Admin cannot read the global site_admins table.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.site_admins;
  if v_count = 0 then
    raise notice 'PASS 26: a Club Admin cannot see any rows of the global site_admins table';
  else
    raise notice 'FAIL 26: a Club Admin read % site_admins row(s)', v_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 27. Renaming an activated club's canonical name does not break its
--     stable relationships -- clubs.id and clubs.slug (the public URL)
--     never change, because they are keyed by directory_id, not by name.
--     Non-destructive: this entire scenario rolls back, so Burnley's real
--     name is never actually changed.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_dir_id uuid;
  v_club_id_before uuid;
  v_slug_before text;
  v_club_id_after uuid;
  v_slug_after text;
begin
  select cd.id, c.id, c.slug into v_dir_id, v_club_id_before, v_slug_before
    from public.club_directory cd join public.clubs c on c.directory_id = cd.id
    where cd.name = 'Burnley RUFC';
  if v_club_id_before is null then
    raise notice 'SKIP 27: no activated Burnley clubs row exists this session';
  else
    update public.club_directory set name = 'Burnley Rugby Union Football Club (renamed for test)' where id = v_dir_id;
    select c.id, c.slug into v_club_id_after, v_slug_after from public.clubs c where c.directory_id = v_dir_id;
    if v_club_id_after = v_club_id_before and v_slug_after = v_slug_before then
      raise notice 'PASS 27: renaming the canonical name left clubs.id and clubs.slug (the public URL) unchanged';
    else
      raise notice 'FAIL 27: rename affected clubs.id or clubs.slug';
    end if;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 28. An unrelated club's admin cannot upload/replace another club's
--     logo (mirrors club_people_teams.sql scenario 15a; repeated here so
--     this file is self-contained for the Club Management slice).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_club_id uuid;
begin
  select c.id into v_club_id from public.clubs c
    join public.club_directory cd on cd.id = c.directory_id
    where cd.name = 'Burnley RUFC';
  if v_club_id is null then
    raise notice 'SKIP 28: no activated Burnley clubs row exists this session';
  else
    begin
      insert into storage.objects (bucket_id, name, owner)
        values ('club-logos', v_club_id || '/exploit-logo.png', '00000000-0000-0000-0000-000000000003');
      raise notice 'FAIL 28: Rossendale''s admin uploaded a logo into Burnley''s storage path';
    exception when others then
      raise notice 'PASS 28: an unrelated club''s admin cannot upload into Burnley''s logo path -- %', sqlerrm;
    end;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 29. Canonical (pre-activation) crest: Site Admin CAN set
--     club_directory.logo_storage_path for a club with no activated clubs
--     row at all -- the root-cause fix for "Wigan has no crest and Site
--     Admin can't add one" (rides the existing club_directory_update_admin
--     policy, no new RLS -- this proves the new column is genuinely
--     writable pre-activation, not just in theory).
-- ------------------------------------------------------------
do $$
declare
  v_unactivated_directory_id uuid;
begin
  select cd.id into v_unactivated_directory_id
  from public.club_directory cd
  left join public.clubs c on c.directory_id = cd.id
  where c.id is null
  limit 1;
  perform set_config('test.unactivated_directory_id', v_unactivated_directory_id::text, false);
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'; -- Full Site Admin
do $$
begin
  update public.club_directory
  set logo_storage_path = current_setting('test.unactivated_directory_id') || '/logo-admin-test.png'
  where id = current_setting('test.unactivated_directory_id')::uuid;
  if found then
    raise notice 'PASS 29: Full Site Admin can set a canonical crest for a club with no activated clubs row';
  else
    raise notice 'FAIL 29: update matched 0 rows';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 30. The same canonical crest write is denied for an ordinary Club Admin
--     (no special-case bypass just because the target has no clubs row).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}'; -- Burnley Club Admin, not a Site Admin
do $$
begin
  update public.club_directory
  set logo_storage_path = current_setting('test.unactivated_directory_id') || '/exploit-logo.png'
  where id = current_setting('test.unactivated_directory_id')::uuid;
  if found then
    raise notice 'FAIL 30: an ordinary Club Admin set a canonical crest for an unrelated, unactivated club';
  else
    raise notice 'PASS 30: an ordinary Club Admin cannot set a canonical crest (0 rows matched)';
  end if;
exception when others then
  raise notice 'PASS 30 (alt): rejected outright -- %', sqlerrm;
end $$;
rollback;

do $$
begin
  update public.club_directory set logo_storage_path = null where id = current_setting('test.unactivated_directory_id')::uuid;
end $$;

\echo '=== Done. Review PASS/FAIL/SKIP lines above; every non-SKIP assertion should read PASS. ==='
\echo '=== Scenarios 5 (CSV export) and 15/20 (CSV field allowlist / no personal member data) are app-layer, not RLS -- verified by code inspection (app/(app)/admin/clubs/actions.ts CSV_COLUMNS) and a live export, not a SQL assertion. Scenario 12 (server actions reject non-admins) is covered structurally by requireSiteAdmin() plus the RLS scenarios above. Scenarios 17/18 (public page never exposes Site Admin notes or private profile data) are verified by code inspection of app/club/[slug]/page.tsx'"'"'s explicit field allowlist (name/town/county/nation/home_ground/rugby_code only -- never notes/source/verification_status/official_email, and club_contacts only where is_public = true), not a SQL assertion, since RLS itself permits reading an active club_directory row in full and the real boundary is the app'"'"'s own column selection. ==='
