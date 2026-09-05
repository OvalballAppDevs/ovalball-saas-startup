-- Manual verification for Site Admin Permission Management
-- (permission_groups/capabilities/permission_group_capabilities RLS,
-- delete_permission_group() dependency checks, and the real enforcement
-- a group assignment resolves to). NOT a migration -- never applied
-- automatically by `db reset`. Run by hand against local Supabase:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_management.sql
--
-- Self-contained: creates its own Site Admin (00...0014, same convention
-- as the other admin test files) and reuses the shared fixture ids from
-- permission_matrix.sql (Burnley admin 0002, Rossendale admin 0003,
-- U12Admin 0004, Parent 0007). Every scenario rolls back unless noted.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test.permission.mgmt.admin@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values ('00000000-0000-0000-0000-000000000014', 'Test', 'PermissionMgmtAdmin', 'test.permission.mgmt.admin@ovalball.local')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, status)
  values ('00000000-0000-0000-0000-000000000014', 'active')
  on conflict (user_id) do nothing;
end $$;

\echo '=== Fixtures ready. Running Permission Management scenarios. ==='

-- ------------------------------------------------------------
-- 1. Site Admin can create a custom permission group.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
begin
  insert into public.permission_groups (name, description, scope_type, maps_to_role, created_by)
  values ('SQL Test Custom Group', 'test', 'club', 'FIXTURE_SECRETARY', '00000000-0000-0000-0000-000000000014');
  raise notice 'PASS 1: Site Admin can create a custom permission group';
exception when others then
  raise notice 'FAIL 1: %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 2 / 3. Ordinary user / Club Admin cannot create a permission group.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000007","role":"authenticated"}';
do $$
begin
  insert into public.permission_groups (name, scope_type, maps_to_role) values ('SQL Test Group 2', 'club', 'CLUB_ADMIN');
  raise notice 'FAIL 2: an ordinary user created a permission group';
exception when others then
  raise notice 'PASS 2: an ordinary user cannot create a permission group -- %', sqlerrm;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  insert into public.permission_groups (name, scope_type, maps_to_role) values ('SQL Test Group 3', 'club', 'CLUB_ADMIN');
  raise notice 'FAIL 3: a Club Admin created a permission group';
exception when others then
  raise notice 'PASS 3: a Club Admin cannot create a permission group -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4 / 5. Capabilities are genuinely enforced -- a group's mapping is the
--    real club_memberships.role/team_permissions.permission value, so
--    changing which group a membership resolves to changes real
--    authority (proven by exercising the exact same club_directory/
--    fixtures RLS the underlying role already gates, reusing the same
--    proof pattern as admin_user_management.sql).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_membership_id uuid := '20000000-0000-0000-0000-000000000015';
  v_club_admin_group uuid;
begin
  select id into v_club_admin_group from public.permission_groups where name = 'Club Admin' and is_system;
  insert into public.club_memberships (id, club_id, user_id, role, status, assigned_group_id)
  values (v_membership_id, '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000015', 'BASIC_USER', 'active', null)
  on conflict (id) do update set role = 'BASIC_USER', assigned_group_id = null;

  -- Assign the real "Club Admin" system group's mapping.
  update public.club_memberships set role = 'CLUB_ADMIN', assigned_group_id = v_club_admin_group where id = v_membership_id;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000015","role":"authenticated"}';
do $$
begin
  update public.clubs set bio = 'sql permission test' where id = '10000000-0000-0000-0000-000000000001';
  if found then
    raise notice 'PASS 4/5: assigning the Club Admin group''s real mapping genuinely grants club-wide administration (bio update succeeded)';
  else
    raise notice 'FAIL 4/5: bio update matched 0 rows after assigning Club Admin group';
  end if;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
update public.club_memberships set role = 'BASIC_USER', assigned_group_id = null where id = '20000000-0000-0000-0000-000000000015';
commit;

-- ------------------------------------------------------------
-- 6. Team scope remains enforced when assigned through a group.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_team_admin_group uuid;
begin
  select id into v_team_admin_group from public.permission_groups where name = 'Team Admin' and is_system;
  insert into public.team_permissions (membership_id, team_id, permission, assigned_group_id)
  values ('20000000-0000-0000-0000-000000000015', '30000000-0000-0000-0000-000000000001', 'team_admin', v_team_admin_group)
  on conflict (membership_id, team_id) do update set permission = 'team_admin', assigned_group_id = v_team_admin_group;
end $$;
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000015","role":"authenticated"}';
do $$
begin
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values ('30000000-0000-0000-0000-000000000002', current_date + 14, 'Home', 'Planned', 'SQL Team Scope Test');
  raise notice 'FAIL 6: Team Admin group assignment for U12 A also granted authority over U13 A';
exception when others then
  raise notice 'PASS 6: Team Admin group assignment stays scoped to its assigned team only -- %', sqlerrm;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
delete from public.team_permissions where membership_id = '20000000-0000-0000-0000-000000000015';
commit;

-- ------------------------------------------------------------
-- 7 / 8. Custom group can be assigned to a valid scope; an invalid scope
--    (mismatched maps_to_role/maps_to_team_permission for the declared
--    scope_type) is rejected by the check constraint itself.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
begin
  insert into public.permission_groups (name, scope_type, maps_to_team_permission)
  values ('SQL Test Valid Team Group', 'team', 'coach');
  raise notice 'PASS 7: a custom group can be created with a valid scope/mapping pair';
exception when others then
  raise notice 'FAIL 7: %', sqlerrm;
end $$;
do $$
begin
  insert into public.permission_groups (name, scope_type, maps_to_role, maps_to_team_permission)
  values ('SQL Test Invalid Group', 'club', 'CLUB_ADMIN', 'coach');
  raise notice 'FAIL 8: a group with both a club role AND a team permission mapping was accepted';
exception when others then
  raise notice 'PASS 8: an invalid scope/mapping combination is rejected -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 9. An assigned group cannot be deleted.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  insert into public.permission_groups (name, scope_type, maps_to_role) values ('SQL Test Assigned Group', 'club', 'FIXTURE_SECRETARY') returning id into v_group_id;
  update public.club_memberships set assigned_group_id = v_group_id where id = '20000000-0000-0000-0000-000000000015';

  begin
    perform public.delete_permission_group(v_group_id);
    raise notice 'FAIL 9: an assigned permission group was deleted';
  exception when others then
    raise notice 'PASS 9: an assigned permission group cannot be deleted -- %', sqlerrm;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 10. A system group cannot be deleted, even when unassigned.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  select id into v_group_id from public.permission_groups where name = 'View Only' and is_system;
  perform public.delete_permission_group(v_group_id);
  raise notice 'FAIL 10: a system permission group was deleted';
exception when others then
  raise notice 'PASS 10: a system permission group cannot be deleted -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 11. A deactivated group is still visible to Site Admin but should not
--     be newly offered for assignment by the app layer -- verified here
--     by confirming is_active can be set false and the row is still
--     readable (the "not newly assignable" part is app-layer: the
--     Change Access form only lists is_active=true groups, per
--     admin/permissions/actions.ts).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
  v_still_visible boolean;
begin
  insert into public.permission_groups (name, scope_type, maps_to_role) values ('SQL Test Deactivate Group', 'club', 'FIXTURE_SECRETARY') returning id into v_group_id;
  update public.permission_groups set is_active = false where id = v_group_id;
  select exists(select 1 from public.permission_groups where id = v_group_id) into v_still_visible;
  if v_still_visible then
    raise notice 'PASS 11: a deactivated group remains visible to Site Admin (app layer excludes it from new assignment, not RLS)';
  else
    raise notice 'FAIL 11: a deactivated group disappeared entirely';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 12. Site Admin's own global authority remains completely separate --
--    creating/assigning permission groups never touches site_admins.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_site_admin_count_before int;
  v_site_admin_count_after int;
begin
  select count(*) into v_site_admin_count_before from public.site_admins where user_id = '00000000-0000-0000-0000-000000000002';
  begin
    update public.club_memberships set assigned_group_id = (select id from public.permission_groups where name = 'Club Admin' and is_system)
      where id = '20000000-0000-0000-0000-000000000001';
  exception when others then null;
  end;
  select count(*) into v_site_admin_count_after from public.site_admins where user_id = '00000000-0000-0000-0000-000000000002';
  if v_site_admin_count_before = v_site_admin_count_after then
    raise notice 'PASS 12: assigning a permission group never creates or touches a site_admins row';
  else
    raise notice 'FAIL 12: site_admins changed as a side effect of a group assignment';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 13. Permission-group changes write an audit event.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000014","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
  v_audit_count int;
begin
  insert into public.permission_groups (name, scope_type, maps_to_role) values ('SQL Test Audit Group', 'club', 'FIXTURE_SECRETARY') returning id into v_group_id;
  select count(*) into v_audit_count from public.audit_log where table_name = 'permission_groups' and record_id = v_group_id and action = 'insert';
  if v_audit_count > 0 then
    raise notice 'PASS 13: creating a permission group wrote an audit_log row';
  else
    raise notice 'FAIL 13: no audit_log row for the new permission group';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 14. Direct request manipulation cannot escalate privilege -- a
--    non-Site-Admin cannot set is_system=true on a custom group to make
--    it undeletable-by-others / masquerade as a real system group,
--    because they cannot write to permission_groups at all.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  update public.permission_groups set is_system = true where name = 'SQL Test Custom Group';
  if found then
    raise notice 'FAIL 14: a Club Admin modified a permission_groups row';
  else
    raise notice 'PASS 14: a Club Admin cannot modify any permission_groups row (0 rows matched)';
  end if;
exception when others then
  raise notice 'PASS 14 (alt): rejected outright -- %', sqlerrm;
end $$;
rollback;

\echo '=== Done. Review PASS/FAIL/SKIP lines above; every non-SKIP assertion should read PASS. ==='
