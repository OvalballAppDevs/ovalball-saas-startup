-- ROLE ASSIGNMENT CEILINGS (Identity/Auth Slice 2, Phase 2 M.2 / I).
--
-- Who may give which role, until Slice 3's capability resolution:
--
--   A. A Club Admin gives club and team roles in their own club, never on
--      another club's or an archived team, and never Safeguarding Officer.
--   B. A Fixtures Secretary, a Team Admin and a plain member give nothing.
--   C. Only a Full Site Admin acts at site level, always with a reason, and
--      never for themselves.
--   D. No browser write reaches role_assignments, the team_permissions view
--      or the role catalogue.
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Runs one statement as the current role; returns OK or the SQLSTATE.
create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_full uuid := gen_random_uuid();
  v_access uuid := gen_random_uuid();
  v_readonly uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_fs uuid := gen_random_uuid();
  v_ta uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_dir uuid; v_dir_b uuid; v_club uuid; v_club_b uuid; v_team uuid; v_team_b uuid; v_archived uuid;
  v_ms_admin uuid; v_ms_fs uuid; v_ms_ta uuid; v_ms_member uuid; v_ms_full uuid;
  v_text text;
  v_role text;
begin
  foreach v_person in array array[v_full, v_access, v_readonly, v_admin, v_other_admin, v_fs, v_ta, v_member] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rac-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_person, 'Rac', 'Tester', 'rac-' || v_person::text || '@ovalball.test')
    on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role) values (v_full, 'active', 'full'), (v_access, 'active', 'user_access'), (v_readonly, 'active', 'read_only');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('RAC Alpha RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'rac-a-' || v_tag) returning id into v_dir;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('RAC Bravo RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'rac-b-' || v_tag) returning id into v_dir_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'rac-a-' || v_tag, 'active') returning id into v_club;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'rac-b-' || v_tag, 'active') returning id into v_club_b;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'rac-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_b, 'Under 12 Boys', 'rac-b-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_b;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 14 Boys', 'rac-u14-' || v_tag, 'youth', 'U14', 'boys', 'union', false) returning id into v_archived;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active') returning id into v_ms_admin;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_fs, 'FIXTURE_SECRETARY', 'active') returning id into v_ms_fs;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_ta, 'BASIC_USER', 'active') returning id into v_ms_ta;
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_ta, v_team, 'team_admin');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_member, 'BASIC_USER', 'active') returning id into v_ms_member;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_full, 'BASIC_USER', 'active') returning id into v_ms_full;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_other_admin, 'CLUB_ADMIN', 'active');

  -- ===============================================================
  -- A. Club Admin: club and team roles in their own club only
  -- ===============================================================
  foreach v_role in array array['FIXTURES_SECRETARY', 'VOLUNTEER', 'CLUB_ADMIN'] loop
    perform pg_temp.act('authenticated', v_admin);
    v_text := pg_temp.try(format('select public.assign_role(%L, %L, null, null)', v_ms_member, v_role));
    perform pg_temp.act_postgres();
    perform pg_temp.check(v_text = 'OK', 'A1: a Club Admin can give ' || v_role || ' in their club (' || v_text || ')');
  end loop;

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''COACH'', %L, null)', v_ms_member, v_team_b));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A2: not on another club''s team (' || v_text || ')');

  perform pg_temp.act('authenticated', v_other_admin);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''COACH'', %L, null)', v_ms_member, v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A3: another club''s admin gives nothing here (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''COACH'', %L, null)', v_ms_member, v_archived));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'A4: no role on an archived team (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''SAFEGUARDING_OFFICER'', null, null)', v_ms_member));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A5: a Club Admin cannot assign Safeguarding Officer (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''SAFEGUARDING_OFFICER'', null, ''x'')', v_ms_member));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A6: nor a Site Admin: an officer is nominated and accepts (' || v_text || ')');

  -- ===============================================================
  -- B. Roles that do not confer people management
  -- ===============================================================
  perform pg_temp.act('authenticated', v_fs);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''COACH'', %L, null)', v_ms_member, v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'B1: a Fixtures Secretary cannot assign roles (' || v_text || ')');

  perform pg_temp.act('authenticated', v_fs);
  v_text := pg_temp.try(format('select public.set_primary_club_role(%L, ''CLUB_ADMIN'', null)', v_ms_fs));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'B2: a Fixtures Secretary cannot make themselves Club Admin (' || v_text || ')');

  perform pg_temp.act('authenticated', v_ta);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''COACH'', %L, null)', v_ms_member, v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'B3: a Team Admin gains no role-assignment authority in this slice (' || v_text || ')');

  perform pg_temp.act('authenticated', v_ta);
  v_text := pg_temp.try(format('select public.set_team_access(%L, %L, ''coach'', null)', v_ms_member, v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'B4: not through the legacy adapter either (' || v_text || ')');

  -- (v_member became Club Admin in A1; v_ta holds only a team role.)
  perform pg_temp.act('authenticated', v_ta);
  v_text := pg_temp.try(format('select public.set_primary_club_role(%L, ''CLUB_ADMIN'', null)', v_ms_ta));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501' and (select role from public.club_memberships where id = v_ms_ta) = 'BASIC_USER',
    'B5: someone without a club role cannot promote themselves (' || v_text || ')');

  -- ===============================================================
  -- C. Site Admin ceilings
  -- ===============================================================
  perform pg_temp.act('authenticated', v_access);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''CLUB_ADMIN'', null, ''x'')', v_ms_member));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'C1: a user-access Site Admin cannot assign (' || v_text || ')');

  perform pg_temp.act('authenticated', v_readonly);
  v_text := pg_temp.try(format('select public.set_team_access(%L, %L, ''coach'', ''x'')', v_ms_member, v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'C2: a read-only Site Admin cannot assign (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''COACH'', %L, null)', v_ms_fs, v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'C3: a Full Site Admin gives a reason (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''COACH'', %L, ''Club asked Support to add their coach'')', v_ms_fs, v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK' and exists (select 1 from public.role_assignments where membership_id = v_ms_fs and role_key = 'COACH' and source = 'SITE_ADMIN_ASSIGNMENT'),
    'C4: with a reason, recorded as a Site Admin assignment');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''CLUB_ADMIN'', null, ''self'')', v_ms_full));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501' and not exists (select 1 from public.role_assignments where membership_id = v_ms_full and role_key = 'CLUB_ADMIN'),
    'C5: a Site Admin never gives themselves a club role (' || v_text || ')');

  perform pg_temp.act('authenticated', v_full);
  v_text := pg_temp.try(format('select public.change_membership_access_profile(%L, (select id from public.permission_groups where scope_type = ''club'' and maps_to_role = ''CLUB_ADMIN'' limit 1), ''[]''::jsonb, ''self'')', v_ms_full));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'C6: nor through the access profile (' || v_text || ')');

  perform pg_temp.act('authenticated', v_access);
  v_text := pg_temp.try(format('select public.change_membership_access_profile(%L, (select id from public.permission_groups where scope_type = ''club'' and maps_to_role = ''CLUB_ADMIN'' limit 1), ''[]''::jsonb, ''x'')', v_ms_member));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'C7: the access profile is Full Site Admin only (' || v_text || ')');

  -- ===============================================================
  -- D. Direct writes
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, source) values (%L, %L, %L, ''CLUB_ADMIN'', ''ACTIVE'', ''CLUB_ADMIN_ASSIGNMENT'')', v_member, v_club, v_ms_member));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'D1: no browser insert into role_assignments (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('insert into public.team_permissions (membership_id, team_id, permission) values (%L, %L, ''coach'')', v_ms_member, v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'D2: no browser write through the team_permissions view (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try('update public.role_definitions set assignable_by = array[''CLUB''] where role_key = ''SAFEGUARDING_OFFICER''');
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'D3: nobody widens the role catalogue through the API (' || v_text || ')');

  raise notice 'Role assignment ceilings complete.';
end $$;

rollback;
