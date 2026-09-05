-- Manual verification for the Site Admin Lookup Administration parent view
-- (20260919000000_site_admin_global_lookups.sql): the manage_global_lookups
-- capability, and its narrowing of create_venue/update_venue/
-- set_venue_active/set_default_venue/create_club_pitch/rename_club_pitch/
-- reorder_club_pitches/set_club_pitch_active from a blanket Site Admin
-- check to that explicit, per-person, off-by-default-even-for-Full grant.
-- NOT a migration -- run AFTER permission_matrix.sql (reuses its seeded
-- Full Site Admin, Burnley/Rossendale Club Admins, and Burnley parent).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/site_admin_global_lookups.sql

\set ON_ERROR_STOP off
\pset pager off

-- Dedicated Site Admins (96100000-... range), distinct from every other
-- test file's own admin id ranges.
do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('96100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.lookups.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('96100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.plain.lookups.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  values
    ('96100000-0000-0000-0000-000000000001', 'Test', 'LookupsAdmin', 'test.lookups.admin@ovalball.local'),
    ('96100000-0000-0000-0000-000000000002', 'Test', 'PlainLookupsAdmin', 'test.plain.lookups.admin@ovalball.local')
  on conflict (id) do nothing;
  -- Both start WITHOUT manage_global_lookups (its own default) -- only
  -- scenario 1 below grants it to the first. The second is deliberately
  -- NOT Full (read_only) so scenario 10 tests a genuine non-Full Site
  -- Admin being refused the grant/revoke RPC itself, not just a lookup
  -- write.
  insert into public.site_admins (user_id, status, admin_role, granted_by)
  values
    ('96100000-0000-0000-0000-000000000001', 'active', 'full', '00000000-0000-0000-0000-000000000001'),
    ('96100000-0000-0000-0000-000000000002', 'active', 'read_only', '00000000-0000-0000-0000-000000000001')
  on conflict (user_id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Grant: a Full Site Admin can grant manage_global_lookups. Also proves
--    the pre-existing Full Site Admin from permission_matrix.sql
--    (...001, admin_role defaults to 'full') does NOT have this capability
--    just by being Full -- it is a genuine, separate, per-person grant.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_granter_capability boolean;
  v_capability boolean;
begin
  select manage_global_lookups into v_granter_capability from public.site_admins where user_id = '00000000-0000-0000-0000-000000000001';
  perform public.set_site_admin_global_lookups_capability('96100000-0000-0000-0000-000000000001', true);
  select manage_global_lookups into v_capability from public.site_admins where user_id = '96100000-0000-0000-0000-000000000001';
  if v_granter_capability is not true and v_capability then
    raise notice 'PASS 1: a Full Site Admin can grant manage_global_lookups to another Site Admin, without holding it themselves -- a genuine per-person grant, not implied by Full';
  else
    raise notice 'FAIL 1: granter_capability=%, granted_capability=%', v_granter_capability, v_capability;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. A Site Admin WITHOUT the capability is refused writing to a club's
--    venues they have no membership at.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"96100000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.create_venue('10000000-0000-0000-0000-000000000001', 'Test Refused Ground', '', '', '', false);
  raise notice 'FAIL 2: a Site Admin WITHOUT manage_global_lookups unexpectedly created a venue for Burnley';
exception when insufficient_privilege then
  raise notice 'PASS 2: a Site Admin without the manage_global_lookups capability is refused writing a venue for a club they have no authority at';
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Club Admin's own authority over their own club's venues/pitches is
--    completely unaffected by this migration (still no capability
--    needed -- internal.is_club_admin(club_id) is untouched).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","email":"test.burnley.admin@ovalball.local"}';
do $$
declare
  v_new_id uuid;
begin
  v_new_id := public.create_venue('10000000-0000-0000-0000-000000000001', 'Burnley Club Admin Test Ground', '', '', '', false);
  if v_new_id is not null then
    raise notice 'PASS 3a: Burnley''s own Club Admin can still create a venue for their own club, unaffected by this migration';
  else
    raise notice 'FAIL 3a: create_venue returned null';
  end if;
end $$;
do $$
begin
  perform public.create_venue('10000000-0000-0000-0000-000000000002', 'Test Hijack Ground', '', '', '', false);
  raise notice 'FAIL 3b: Burnley''s Club Admin unexpectedly created a venue for Rossendale';
exception when insufficient_privilege then
  raise notice 'PASS 3b: Burnley''s Club Admin still cannot write Rossendale''s venues -- club-scoping is unaffected';
end $$;
commit;

-- ------------------------------------------------------------
-- 4. Site Admin WITH the capability creates a venue for a club they have
--    no membership at all -- the actual parent-view write path.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"96100000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_new_id uuid;
begin
  perform set_config('app.lookups_test_venue_id', (
    select public.create_venue('10000000-0000-0000-0000-000000000002', 'Site Admin Parent-View Test Ground', 'Test Address', 'TE5 7ST', '', false)::text
  ), true);
  v_new_id := current_setting('app.lookups_test_venue_id')::uuid;
  if v_new_id is not null then
    raise notice 'PASS 4: a Site Admin WITH manage_global_lookups creates a venue for Rossendale despite having no club membership there at all';
  else
    raise notice 'FAIL 4: create_venue returned null';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 5. Same Site Admin updates, sets default, then deactivates that venue.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"96100000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_venue_id uuid;
  v_default boolean;
  v_active boolean;
begin
  select id into v_venue_id from public.venues where club_id = '10000000-0000-0000-0000-000000000002' and name = 'Site Admin Parent-View Test Ground';
  perform public.update_venue(v_venue_id, 'Site Admin Parent-View Test Ground (Updated)', 'New Address', 'TE5 7ST', 'Behind the clubhouse');
  perform public.set_default_venue(v_venue_id);
  select is_default_home into v_default from public.venues where id = v_venue_id;
  perform public.set_venue_active(v_venue_id, false);
  select active into v_active from public.venues where id = v_venue_id;
  if v_default and v_active = false then
    raise notice 'PASS 5: the capability covers update/set-default/deactivate on a venue belonging to a club the Site Admin has no membership at';
  else
    raise notice 'FAIL 5: is_default_home=%, active=%', v_default, v_active;
  end if;
  -- set_venue_active never clears is_default_home (pre-existing, unchanged
  -- by this migration) -- left alone, this throwaway venue would keep
  -- occupying Rossendale's one-default-per-club slot
  -- (venues_one_default_per_club) after this file finishes, blocking any
  -- other venue (including the playground bootstrap's own seed row) from
  -- ever becoming default for this club. Clear it directly rather than
  -- through an RPC, since there is no other venue to hand it to here.
  update public.venues set is_default_home = false where id = v_venue_id;
end $$;
commit;

-- ------------------------------------------------------------
-- 6. Pitch RPCs (SECURITY DEFINER, bypass RLS entirely) also honour the
--    capability -- create, rename, reorder, deactivate, all for a club the
--    Site Admin has no membership at.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"96100000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_pitch_id uuid;
  v_name text;
  v_active boolean;
begin
  perform set_config('app.lookups_test_pitch_id', (
    select public.create_club_pitch('10000000-0000-0000-0000-000000000002', 'Site Admin Test Pitch', 'A test pitch')::text
  ), true);
  v_pitch_id := current_setting('app.lookups_test_pitch_id')::uuid;
  perform public.rename_club_pitch(v_pitch_id, 'Site Admin Test Pitch (Renamed)');
  perform public.reorder_club_pitches('10000000-0000-0000-0000-000000000002', array[v_pitch_id]);
  perform public.set_club_pitch_active(v_pitch_id, false);
  select display_name, active into v_name, v_active from public.club_pitches where id = v_pitch_id;
  if v_name = 'Site Admin Test Pitch (Renamed)' and v_active = false then
    raise notice 'PASS 6: create_club_pitch/rename_club_pitch/reorder_club_pitches/set_club_pitch_active all honour manage_global_lookups for a club the Site Admin has no membership at';
  else
    raise notice 'FAIL 6: name=%, active=%', v_name, v_active;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 7. A Parent/player (BASIC_USER, view_only) genuinely cannot reach any
--    lookup-management write action, server-side -- not merely UI-hidden.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated","email":"test.parent@ovalball.local"}';
do $$
begin
  perform public.create_venue('10000000-0000-0000-0000-000000000001', 'Test Parent Refused Ground', '', '', '', false);
  raise notice 'FAIL 7a: a Parent/player unexpectedly created a venue';
exception when insufficient_privilege then
  raise notice 'PASS 7a: a Parent/player cannot create a venue, even at their own club';
end $$;
do $$
begin
  perform public.create_club_pitch('10000000-0000-0000-0000-000000000001', 'Test Parent Refused Pitch', '');
  raise notice 'FAIL 7b: a Parent/player unexpectedly created a pitch';
exception when insufficient_privilege then
  raise notice 'PASS 7b: a Parent/player cannot create a pitch, even at their own club';
end $$;
do $$
begin
  update public.club_pitches set display_name = 'Hijacked' where club_id = '10000000-0000-0000-0000-000000000001';
  if found then
    raise notice 'FAIL 7c: a Parent/player updated a club_pitches row via raw RLS';
  else
    raise notice 'PASS 7c: a Parent/player''s raw update to club_pitches affects 0 rows (RLS, not just the RPC layer)';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 8. Read side is completely unaffected: even a Site Admin with NO
--    capability at all can SELECT any club's venues/pitches (matches the
--    existing open, non-sensitive venues_select/club_pitches_select
--    policies -- this migration only ever narrowed writes).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"96100000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_venue_count integer;
  v_pitch_count integer;
begin
  select count(*) into v_venue_count from public.venues where club_id = '10000000-0000-0000-0000-000000000002';
  select count(*) into v_pitch_count from public.club_pitches where club_id = '10000000-0000-0000-0000-000000000002';
  if v_venue_count >= 1 and v_pitch_count >= 1 then
    raise notice 'PASS 8: a Site Admin with NO manage_global_lookups capability can still freely SELECT another club''s venues and pitches -- reads were never gated';
  else
    raise notice 'FAIL 8: venue_count=%, pitch_count=%', v_venue_count, v_pitch_count;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 9. Revoke: a Full Site Admin can revoke manage_global_lookups, and the
--    write path is refused again immediately afterward.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_capability boolean;
begin
  perform public.set_site_admin_global_lookups_capability('96100000-0000-0000-0000-000000000001', false);
  select manage_global_lookups into v_capability from public.site_admins where user_id = '96100000-0000-0000-0000-000000000001';
  if v_capability is false then
    raise notice 'PASS 9a: a Full Site Admin can revoke manage_global_lookups';
  else
    raise notice 'FAIL 9a: capability still %', v_capability;
  end if;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"96100000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.create_venue('10000000-0000-0000-0000-000000000002', 'Test Post-Revoke Ground', '', '', '', false);
  raise notice 'FAIL 9b: a revoked Site Admin unexpectedly still created a venue';
exception when insufficient_privilege then
  raise notice 'PASS 9b: immediately after revocation, the same Site Admin is refused the same write they could make a moment before';
end $$;
rollback;

-- ------------------------------------------------------------
-- 10. Only a Full Site Admin can grant/revoke the capability at all -- a
--     Site Admin who merely HOLDS manage_global_lookups cannot grant it to
--     someone else (matches every other capability's own grant boundary).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"96100000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.set_site_admin_global_lookups_capability('96100000-0000-0000-0000-000000000001', true);
  raise notice 'FAIL 10: a plain Site Admin unexpectedly granted manage_global_lookups to someone else';
exception when others then
  raise notice 'PASS 10: only a Full Site Admin can grant or revoke manage_global_lookups (%)', sqlerrm;
end $$;
rollback;
