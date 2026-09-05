-- Manual verification for auth session compatibility versioning
-- (20260901130000_auth_session_versioning.sql): record_session_version()
-- authorization, self-only writes, and RLS on user_session_versions. The
-- actual cookie-lifetime and forced-reauth-redirect behavior lives in
-- proxy.ts/lib/supabase/remember.ts and can only be verified live in a
-- real browser (see the live-test report) -- this suite covers exactly
-- what SQL/RLS can prove: the DB-side authorization boundary. NOT a
-- migration -- run after permission_matrix.sql (reuses Burnley admin,
-- 0002, and Rossendale admin, 0003).

\set ON_ERROR_STOP off
\pset pager off

-- ------------------------------------------------------------
-- 1. Not signed in cannot record a session version.
-- ------------------------------------------------------------
begin;
set local role anon;
do $$
begin
  perform public.record_session_version(1);
  raise notice 'FAIL 1: an unauthenticated caller recorded a session version';
exception when others then
  raise notice 'PASS 1: an unauthenticated caller cannot record a session version (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. Signed-in user can record their OWN session version.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_version int;
begin
  perform public.record_session_version(1);
  select version into v_version from public.user_session_versions where user_id = '00000000-0000-0000-0000-000000000002';
  if v_version = 1 then raise notice 'PASS 2: user recorded their own session version';
  else raise notice 'FAIL 2: recorded version is %', v_version; end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 3. Calling it again upserts (bumps set_at, replaces version) rather
--    than erroring or duplicating.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count int;
  v_version int;
begin
  perform public.record_session_version(2);
  select count(*), max(version) into v_count, v_version from public.user_session_versions where user_id = '00000000-0000-0000-0000-000000000002';
  if v_count = 1 and v_version = 2 then raise notice 'PASS 3: re-recording upserts to exactly one row with the new version';
  else raise notice 'FAIL 3: % rows, version %', v_count, v_version; end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 4. A user can read their own row.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.user_session_versions where user_id = '00000000-0000-0000-0000-000000000002';
  if v_count = 1 then raise notice 'PASS 4: a user can read their own session version row';
  else raise notice 'FAIL 4: % rows visible', v_count; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. A user CANNOT read another user's row.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.user_session_versions where user_id = '00000000-0000-0000-0000-000000000002';
  if v_count = 0 then raise notice 'PASS 5: a user cannot read another user''s session version row';
  else raise notice 'FAIL 5: unrelated user read % row(s)', v_count; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. A user cannot record a version for someone ELSE -- there is no
--    p_user_id parameter at all; record_session_version always writes
--    auth.uid()'s own row, so this is really "no such capability exists",
--    verified by confirming Rossendale's row is untouched by Burnley's
--    calls above.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.user_session_versions where user_id = '00000000-0000-0000-0000-000000000003';
  if v_count = 0 then raise notice 'PASS 6: Burnley''s record_session_version calls never touched Rossendale''s row (no such row exists)';
  else raise notice 'FAIL 6: unexpected row for an unrelated user'; end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. No direct INSERT/UPDATE policy for authenticated -- a raw table
--    write is rejected even for the row's own owner; record_session_version()
--    (SECURITY DEFINER) is the only write path.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_rows int;
begin
  update public.user_session_versions set version = 999 where user_id = '00000000-0000-0000-0000-000000000002';
  get diagnostics v_rows = row_count;
  -- No UPDATE policy at all means RLS silently matches zero rows rather
  -- than raising -- a 0-row UPDATE is the real "rejected" signal here,
  -- not an exception.
  if v_rows = 0 then raise notice 'PASS 7: a direct UPDATE on user_session_versions affects 0 rows under RLS';
  else raise notice 'FAIL 7: a direct UPDATE on user_session_versions changed % row(s)', v_rows; end if;
exception when others then
  raise notice 'PASS 7: a direct UPDATE on user_session_versions is rejected (%)', sqlerrm;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  insert into public.user_session_versions (user_id, version) values ('00000000-0000-0000-0000-000000000004', 1);
  raise notice 'FAIL 8: a direct INSERT into user_session_versions succeeded';
exception when others then
  raise notice 'PASS 8: a direct INSERT into user_session_versions is rejected (%)', sqlerrm;
end $$;
rollback;

do $$
begin
  delete from public.user_session_versions where user_id = '00000000-0000-0000-0000-000000000002';
exception when others then null;
end $$;

\echo '=== Done. Review PASS/FAIL lines above; every assertion should read PASS. ==='
