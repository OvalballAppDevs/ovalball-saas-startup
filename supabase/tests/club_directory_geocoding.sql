-- Manual verification for the map's geocoding columns and trigger
-- (20260901100000_club_directory_geocoding): admin-only write access to
-- latitude/longitude/geocode_status/geocode_source/geocoded_at (the same
-- club_directory_update_admin policy that already gates every other
-- column -- these are new columns on an existing table, not a new
-- authorization surface), the geocode_status check constraint, and the
-- reset-on-postcode-change trigger. NOT a migration -- run after
-- permission_matrix.sql (reuses Burnley RUFC and its Club Admin, user
-- 0002, and the 'full' Site Admin, user 0001).

\set ON_ERROR_STOP off
\pset pager off

do $$
declare
  v_burnley_dir_id uuid;
begin
  select id into v_burnley_dir_id from public.club_directory where name = 'Burnley RUFC';

  update public.club_directory
  set latitude = 53.8, longitude = -2.2, geocoded_at = now(), geocode_status = 'success', geocode_source = 'postcodes.io'
  where id = v_burnley_dir_id;
end $$;

-- ------------------------------------------------------------
-- 1. Ordinary Club Admin (Burnley, 0002) cannot set the map location
--    directly -- club_directory_update_admin is Site-Admin-only, and
--    these are ordinary columns on that same table.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_burnley_dir_id uuid;
  v_rows int;
begin
  select id into v_burnley_dir_id from public.club_directory where name = 'Burnley RUFC';
  update public.club_directory set latitude = 0, longitude = 0 where id = v_burnley_dir_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise notice 'PASS 1: an ordinary Club Admin cannot move a club''s map pin (0 rows affected under RLS)';
  else
    raise notice 'FAIL 1: an ordinary Club Admin updated the map location (% rows)', v_rows;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2. Site Admin can set the map location.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_burnley_dir_id uuid;
  v_status text;
begin
  select id into v_burnley_dir_id from public.club_directory where name = 'Burnley RUFC';
  update public.club_directory set latitude = 53.81, longitude = -2.23, geocode_status = 'success', geocoded_at = now(), geocode_source = 'postcodes.io' where id = v_burnley_dir_id;
  select geocode_status into v_status from public.club_directory where id = v_burnley_dir_id;
  if v_status = 'success' then
    raise notice 'PASS 2: Site Admin can set a club''s map location';
  else
    raise notice 'FAIL 2: geocode_status is % after Site Admin update', v_status;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 3. geocode_status rejects a value outside the check constraint.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_burnley_dir_id uuid;
begin
  select id into v_burnley_dir_id from public.club_directory where name = 'Burnley RUFC';
  update public.club_directory set geocode_status = 'geocoded' where id = v_burnley_dir_id;
  raise notice 'FAIL 3: an invalid geocode_status was accepted';
exception when check_violation then
  raise notice 'PASS 3: an invalid geocode_status is rejected by the check constraint';
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Changing postcode resets the cached location back to pending --
--    never leaves a stale pin at the old postcode's coordinates.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_burnley_dir_id uuid;
  v_status text;
  v_lat numeric;
begin
  select id into v_burnley_dir_id from public.club_directory where name = 'Burnley RUFC';
  update public.club_directory set postcode = 'BB10 2LT' where id = v_burnley_dir_id;
  select geocode_status, latitude into v_status, v_lat from public.club_directory where id = v_burnley_dir_id;
  if v_status = 'pending' and v_lat is null then
    raise notice 'PASS 4: editing the postcode resets geocode_status to pending and clears the stale coordinates';
  else
    raise notice 'FAIL 4: geocode_status=%, latitude=% after a postcode edit', v_status, v_lat;
  end if;
  -- Restore for the next scenario -- in two separate statements. Doing
  -- the postcode restore and the geocode-field restore in one UPDATE
  -- would change postcode again in the same statement, so the trigger
  -- would fire and stomp the very geocode values this is trying to set
  -- (a real bug this test caught in itself while first being written).
  update public.club_directory set postcode = 'BB10 2LS' where id = v_burnley_dir_id;
  update public.club_directory set latitude = 53.81, longitude = -2.23, geocode_status = 'success', geocoded_at = now(), geocode_source = 'postcodes.io' where id = v_burnley_dir_id;
end $$;
commit;

-- ------------------------------------------------------------
-- 5. Editing an unrelated column (town) does NOT reset the location --
--    the trigger fires only when postcode itself actually changes.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_burnley_dir_id uuid;
  v_status text;
begin
  select id into v_burnley_dir_id from public.club_directory where name = 'Burnley RUFC';
  update public.club_directory set town = 'Burnley' where id = v_burnley_dir_id;
  select geocode_status into v_status from public.club_directory where id = v_burnley_dir_id;
  if v_status = 'success' then
    raise notice 'PASS 5: editing an unrelated column leaves the cached location untouched';
  else
    raise notice 'FAIL 5: geocode_status became % after an unrelated column edit', v_status;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 6. Setting postcode to its own current value (no real change) does
--    NOT reset the location -- `is distinct from`, not a blind reset on
--    every UPDATE statement that merely touches the column.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_burnley_dir_id uuid;
  v_status text;
begin
  select id into v_burnley_dir_id from public.club_directory where name = 'Burnley RUFC';
  update public.club_directory set postcode = 'BB10 2LS' where id = v_burnley_dir_id;
  select geocode_status into v_status from public.club_directory where id = v_burnley_dir_id;
  if v_status = 'success' then
    raise notice 'PASS 6: re-setting postcode to its unchanged value does not reset the location';
  else
    raise notice 'FAIL 6: geocode_status became % after a no-op postcode write', v_status;
  end if;
end $$;
commit;

do $$
declare
  v_burnley_dir_id uuid;
begin
  select id into v_burnley_dir_id from public.club_directory where name = 'Burnley RUFC';
  update public.club_directory set latitude = null, longitude = null, geocoded_at = null, geocode_status = 'pending', geocode_source = null where id = v_burnley_dir_id;
exception when others then null;
end $$;
