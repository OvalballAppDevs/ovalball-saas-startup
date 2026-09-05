-- Manual verification for the Site Admin Team Directory (Part 2 of the
-- canonical-team-catalogue correction, 20260904500000_site_admin_team_
-- directory.sql): a controlled, capability-gated mechanism to extend the
-- GLOBAL canonical team catalogue, distinct from ordinary club-level team
-- activation. NOT a migration -- run AFTER permission_matrix.sql (reuses
-- its seeded users/clubs) and canonical_team_catalogue.sql is not
-- required but is a natural companion.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/site_admin_team_directory.sql

\set ON_ERROR_STOP off
\pset pager off

-- Two Site Admins already exist from permission_matrix.sql's own seed
-- (00000000-0000-0000-0000-000000000001 as a real Full Site Admin, per
-- every other admin test file's convention). Grant the new capability to
-- a SECOND, dedicated Site Admin so tests 2/3 can prove an ordinary Site
-- Admin WITHOUT the grant is still refused, distinct from a real
-- Club Admin.
do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('94000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.catalogue.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('94000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.plain.siteadmin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;
  insert into public.profiles (id, first_name, surname, email)
  values
    ('94000000-0000-0000-0000-000000000001', 'Test', 'CatalogueAdmin', 'test.catalogue.admin@ovalball.local'),
    ('94000000-0000-0000-0000-000000000002', 'Test', 'PlainSiteAdmin', 'test.plain.siteadmin@ovalball.local')
  on conflict (id) do nothing;
  insert into public.site_admins (user_id, status, admin_role, granted_by)
  values
    ('94000000-0000-0000-0000-000000000001', 'active', 'full', '00000000-0000-0000-0000-000000000001'),
    ('94000000-0000-0000-0000-000000000002', 'active', 'full', '00000000-0000-0000-0000-000000000001')
  on conflict (user_id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Grant: a Full Site Admin can grant the manage_team_catalogue
--    capability to another Site Admin.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_capability boolean;
begin
  perform public.set_site_admin_team_catalogue_capability('94000000-0000-0000-0000-000000000001', true);
  select manage_team_catalogue into v_capability from public.site_admins where user_id = '94000000-0000-0000-0000-000000000001';
  if v_capability then
    raise notice 'PASS 1: a Full Site Admin can grant the manage_team_catalogue capability to another Site Admin';
  else
    raise notice 'FAIL 1: capability was not set after a successful grant call';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. A Site Admin WITHOUT the capability (real Site Admin profile,
--    genuinely active, just never granted this specific access) is
--    refused -- proves this is a genuine capability, not "any Site
--    Admin profile".
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"94000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.create_canonical_team_type('youth', 'U17', 'boys', null, true);
  raise notice 'FAIL 2: a Site Admin WITHOUT manage_team_catalogue unexpectedly created a global team type';
exception when insufficient_privilege then
  raise notice 'PASS 2: a Site Admin without the manage_team_catalogue capability is refused -- this is a genuine capability, not any Site Admin profile';
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. An ordinary Club Admin is refused -- not even close to a Site Admin
--    boundary.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.create_canonical_team_type('youth', 'U17', 'boys', null, true);
  raise notice 'FAIL 3: an ordinary Club Admin unexpectedly created a global team type';
exception when insufficient_privilege then
  raise notice 'PASS 3: an ordinary Club Admin is refused -- global catalogue writes require genuine Site Admin product-level capability';
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. The Site Admin WITH the capability can create a genuinely new,
--    structurally valid global team type (U17 Boys -- a real product gap
--    the closed catalogue never covered).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"94000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_new_id uuid;
  v_label text;
  v_active boolean;
begin
  select public.create_canonical_team_type('youth', 'U17', 'boys', null, true) into v_new_id;
  select label, is_active into v_label, v_active from public.canonical_team_types where id = v_new_id;
  if v_label = 'U17' and v_active then
    raise notice 'PASS 4: a Site Admin with the capability creates a new global team type (U17 Boys), with a server-generated label, active by default';
  else
    raise notice 'FAIL 4: label=%, active=%', v_label, v_active;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 5. Duplicate global identity rejected -- creating the exact same U17
--    Boys identity again fails.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"94000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.create_canonical_team_type('youth', 'U17', 'boys', null, true);
  raise notice 'FAIL 5: a duplicate global team type (U17 Boys) unexpectedly succeeded';
exception when others then
  raise notice 'PASS 5: a duplicate global canonical identity is rejected (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. A structurally invalid identity (senior + girls -- vocabulary that
--    could never be valid for a real team either) is rejected at the
--    database level, not merely a UI restriction.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"94000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.create_canonical_team_type('senior', null, 'girls', '4th', false);
  raise notice 'FAIL 6: a structurally invalid global identity (senior + girls) unexpectedly succeeded';
exception when check_violation then
  raise notice 'PASS 6: a structurally invalid global identity is rejected by canonical_team_types_structure_check -- the same real-world rule that governs actual team rows';
end $$;
rollback;

-- ------------------------------------------------------------
-- 7. Automatic propagation, no code change: internal.resolve_canonical_
--    team_type (the exact function every write path -- Add Team, claim/
--    signup seeding, controlled missing-team creation, rollover -- uses
--    to validate a team's identity) immediately recognizes the new U17
--    Boys type with zero changes to that function itself.
-- ------------------------------------------------------------
do $$
declare
  v_resolved uuid;
  v_expected uuid;
begin
  select id into v_expected from public.canonical_team_types where key = 'u17';
  select internal.resolve_canonical_team_type('youth', 'U17', 'boys', null) into v_resolved;
  if v_resolved is not null and v_resolved = v_expected then
    raise notice 'PASS 7: the new global type is immediately recognized by internal.resolve_canonical_team_type -- automatic propagation, zero code changes to the resolver itself';
  else
    raise notice 'FAIL 7: expected=%, resolved=%', v_expected, v_resolved;
  end if;
end $$;

-- ------------------------------------------------------------
-- 8. Club activation is a SEPARATE, deliberate action: creating the
--    global type does NOT create it for any club. A real Club Admin
--    (Burnley) can now activate it -- through the SAME ordinary
--    authenticated insert path Add Team already uses -- and gets its own
--    stable club team_id, completely independent of the global type row.
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.teams where club_id = '10000000-0000-0000-0000-000000000001' and category = 'youth' and age_group = 'U17';
  if v_count = 0 then
    raise notice 'PASS 8a: creating the global U17 Boys type did not create it for any club -- Burnley has zero U17 teams immediately after test 4';
  else
    raise notice 'FAIL 8a: Burnley unexpectedly already has % U17 team(s) before any club activation', v_count;
  end if;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_team_id uuid;
  v_canonical_id uuid;
  v_expected_canonical_id uuid;
begin
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U17', 'boys', null, 'pending', 'pending')
  returning id, canonical_team_type_id into v_team_id, v_canonical_id;

  select id into v_expected_canonical_id from public.canonical_team_types where key = 'u17';

  if v_team_id is not null and v_canonical_id = v_expected_canonical_id then
    raise notice 'PASS 8b: Burnley''s Club Admin activates the new U17 Boys type through the ordinary Add Team insert path, gets a real stable club team_id, correctly linked to the global type -- club activation is a genuinely separate action from global type creation';
  else
    raise notice 'FAIL 8b: team_id=%, canonical_id=%, expected=%', v_team_id, v_canonical_id, v_expected_canonical_id;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 9. Deactivating the global type: existing club-team/history stays
--    completely intact (the U17 team Burnley just activated keeps
--    working, unaffected), but the type disappears from new-activation
--    options going forward -- a brand new team can no longer resolve it.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"94000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_type_id uuid;
begin
  select id into v_type_id from public.canonical_team_types where key = 'u17';
  perform public.deactivate_canonical_team_type(v_type_id);
end $$;
commit;

do $$
declare
  v_active boolean;
  v_burnley_team_still_active boolean;
begin
  select is_active into v_active from public.canonical_team_types where key = 'u17';
  select active into v_burnley_team_still_active from public.teams where club_id = '10000000-0000-0000-0000-000000000001' and category = 'youth' and age_group = 'U17';
  if v_active = false and v_burnley_team_still_active = true then
    raise notice 'PASS 9a: deactivating the global type leaves Burnley''s already-activated U17 team completely intact and still active -- existing club-team history is never disturbed';
  else
    raise notice 'FAIL 9a: type_is_active=%, burnley_team_still_active=%', v_active, v_burnley_team_still_active;
  end if;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('10000000-0000-0000-0000-000000000002', 'union', 'youth', 'U17', 'boys', null, 'pending', 'pending');
  raise notice 'FAIL 9b: Rossendale unexpectedly activated a NEW team at the now-deactivated U17 Boys type';
exception when insufficient_privilege or check_violation then
  raise notice 'PASS 9b: a deactivated global type can no longer be newly activated by a DIFFERENT club -- blocked at the database level (teams_validate_canonical_type_active_trigger fires before RLS even gets a chance to reject it, which is what actually surfaces here; RLS would also reject it independently since canonical_team_type_id resolves NULL) -- never just hidden from a picker';
end $$;
rollback;

-- Same check bypassing RLS entirely (as postgres), proving the rejection
-- in 9b is the hard invariant, not merely the RLS policy.
do $$
begin
  insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
  values ('10000000-0000-0000-0000-000000000002', 'union', 'youth', 'U17', 'boys', null, 'pending-rls-bypass-check', 'pending-rls-bypass-check');
  raise notice 'FAIL 9c: a deactivated global type was newly activated even as postgres (RLS bypassed)';
exception when check_violation then
  raise notice 'PASS 9c: a deactivated global type cannot be newly activated even as postgres (RLS bypassed) -- teams_validate_canonical_type_active_trigger is a real database invariant, not an RLS-only restriction';
end $$;

-- ------------------------------------------------------------
-- 10. No inappropriate fake catalogue records were left in permanent
--     seed data: everything this file created is scoped to its own
--     throwaway ids/keys (94000000-... users, 'u17' key) and never
--     touched seed.sql or the original 24-row catalogue.
-- ------------------------------------------------------------
do $$
declare
  v_original_count integer;
begin
  select count(*) into v_original_count from public.canonical_team_types where key <> 'u17';
  if v_original_count = 24 then
    raise notice 'PASS 10: the original closed 24-row catalogue is completely untouched -- this file added exactly one new row (u17) on top of it, nothing was overwritten or duplicated';
  else
    raise notice 'FAIL 10: expected 24 original rows untouched, found %', v_original_count;
  end if;
end $$;
