-- ROLE ASSIGNMENT STATE MACHINE (Identity/Auth Slice 2, Phase 2 M.2).
--
--   A. Assign: idempotent, with source and grantor; Team Administration only
--      on an ACTIVE Coach or Team Manager role for the same team; scope rules.
--   B. Suspend, restore and revoke with reasons; no restore across levels;
--      Team Administration pauses, resumes and ends with its base role; a
--      revoked role never returns, even through a backend write.
--   C. The legacy single-permission adapters (set_team_access,
--      remove_team_access, set_primary_club_role) keep replace semantics, and
--      nobody is left without a club role.
--   D. Backend legacy writes (team_permissions view, club_memberships.role,
--      authority_suspended) still land in role_assignments.
--   E. Every transition is a security event with its actor.
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
  v_admin uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_fs uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_team uuid; v_team2 uuid;
  v_ms_admin uuid; v_ms_coach uuid; v_ms_manager uuid; v_ms_fs uuid;
  v_co uuid; v_tm uuid; v_ta uuid; v_id uuid; v_fs_role uuid;
  v_text text;
begin
  foreach v_person in array array[v_full, v_admin, v_coach, v_manager, v_fs] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ras-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth) values (v_person, 'Ras', 'Tester', 'ras-' || v_person::text || '@ovalball.test', (current_date - interval '35 years')::date)
    on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role) values (v_full, 'active', 'full');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('RAS RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ras-' || v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'ras-' || v_tag, 'active') returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'ras-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 13 Boys', 'ras-u13-' || v_tag, 'youth', 'U13', 'boys', 'union', true) returning id into v_team2;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_admin, 'CLUB_ADMIN', 'active') returning id into v_ms_admin;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach, 'BASIC_USER', 'active') returning id into v_ms_coach;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_manager, 'BASIC_USER', 'active') returning id into v_ms_manager;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_fs, 'BASIC_USER', 'active') returning id into v_ms_fs;

  -- ===============================================================
  -- A. Assign
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''TEAM_ADMINISTRATION'', %L, null)', v_ms_coach, v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'A1: Team Administration cannot be given without a Coach or Team Manager role on that team (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_co := public.assign_role(v_ms_coach, 'COACH', v_team, null);
  v_id := public.assign_role(v_ms_coach, 'COACH', v_team, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_id = v_co and (select count(*) from public.role_assignments where membership_id = v_ms_coach and role_key = 'COACH') = 1
    and (select source || '|' || (granted_by = v_admin)::text from public.role_assignments where id = v_co) = 'CLUB_ADMIN_ASSIGNMENT|true',
    'A2: assigning is idempotent and records its source and who gave it');

  perform pg_temp.act('authenticated', v_admin);
  v_ta := public.assign_role(v_ms_coach, 'TEAM_ADMINISTRATION', v_team, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check((select base_assignment_id from public.role_assignments where id = v_ta) = v_co
    and (select permission from public.team_permissions where membership_id = v_ms_coach and team_id = v_team) = 'team_admin'
    and (select id from public.team_permissions where membership_id = v_ms_coach and team_id = v_team) = v_ta,
    'A3: Team Administration rests on the Coach role and the legacy view shows team_admin');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''COACH'', null, null)', v_ms_manager));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'A4: a team role needs a team (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.assign_role(%L, ''CLUB_ADMIN'', %L, null)', v_ms_manager, v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'A5: a club role is not held for a team (' || v_text || ')');

  -- ===============================================================
  -- B. Suspend, restore, revoke; Team Administration follows its base
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_role_assignment(%L, ''SUSPENDED'', null)', v_co));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'B1: suspending a role needs a reason (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  perform public.transition_role_assignment(v_co, 'SUSPENDED', 'Awaiting DBS renewal');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select state || '|' || suspended_level from public.role_assignments where id = v_co) = 'SUSPENDED|CLUB'
    and (select state || '|' || (attributes ->> 'suspension_cause') from public.role_assignments where id = v_ta) = 'SUSPENDED|BASE_ROLE'
    and not exists (select 1 from public.team_permissions where membership_id = v_ms_coach and team_id = v_team),
    'B2: suspending the Coach role pauses the Team Administration resting on it; no legacy team access remains');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_role_assignment(%L, ''ACTIVE'', ''x'')', v_ta));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'B3: Team Administration paused by its base cannot be restored on its own (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  perform public.transition_role_assignment(v_co, 'ACTIVE', 'DBS renewed');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select state from public.role_assignments where id = v_co) = 'ACTIVE' and (select state from public.role_assignments where id = v_ta) = 'ACTIVE',
    'B4: restoring the base role restores Team Administration with it');

  perform pg_temp.act('authenticated', v_full);
  perform public.transition_role_assignment(v_co, 'SUSPENDED', 'Site review');
  perform pg_temp.act_postgres();
  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_role_assignment(%L, ''ACTIVE'', ''x'')', v_co));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'B5: a Club Admin cannot restore a role a Site Admin suspended (' || v_text || ')');
  perform pg_temp.act('authenticated', v_full);
  perform public.transition_role_assignment(v_co, 'ACTIVE', 'Site review closed');
  perform pg_temp.act_postgres();

  perform pg_temp.act('authenticated', v_admin);
  perform public.transition_role_assignment(v_co, 'REVOKED', null);
  perform pg_temp.act_postgres();
  perform pg_temp.check((select state from public.role_assignments where id = v_co) = 'REVOKED'
    and (select state || '|' || revocation_reason from public.role_assignments where id = v_ta) = 'REVOKED|Its base role ended',
    'B6: revoking the base role revokes Team Administration');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.transition_role_assignment(%L, ''ACTIVE'', ''undo'')', v_co));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '23514', 'B7: a revoked role is never restored (' || v_text || ')');
  v_text := pg_temp.try(format('update public.role_assignments set state = ''ACTIVE'', revoked_at = null where id = %L', v_co));
  perform pg_temp.check(v_text = '23514', 'B8: not even by a backend write (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  v_id := public.assign_role(v_ms_coach, 'COACH', v_team, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_id <> v_co and (select count(*) from public.role_assignments where membership_id = v_ms_coach and role_key = 'COACH' and team_id = v_team) = 2,
    'B9: giving the role again is a new assignment beside the revoked one');

  -- ===============================================================
  -- C. Legacy single-permission adapters
  -- ===============================================================
  perform pg_temp.act('authenticated', v_admin);
  v_tm := public.set_team_access(v_ms_manager, v_team, 'manager', null);
  perform pg_temp.act_postgres();
  perform pg_temp.check((select role_key from public.role_assignments where id = v_tm) = 'TEAM_MANAGER'
    and (select permission from public.team_permissions where membership_id = v_ms_manager and team_id = v_team) = 'manager',
    'C1: set_team_access manager gives Team Manager');

  perform pg_temp.act('authenticated', v_admin);
  v_id := public.set_team_access(v_ms_manager, v_team, 'team_admin', null);
  perform pg_temp.act_postgres();
  perform pg_temp.check((select role_key || '|' || (base_assignment_id = v_tm)::text from public.role_assignments where id = v_id) = 'TEAM_ADMINISTRATION|true',
    'C2: team_admin adds Team Administration on the existing Team Manager role');

  perform pg_temp.act('authenticated', v_admin);
  v_id := public.set_team_access(v_ms_manager, v_team, 'coach', null);
  perform pg_temp.act_postgres();
  perform pg_temp.check((select string_agg(role_key, ',' order by role_key) from public.role_assignments where membership_id = v_ms_manager and team_id = v_team and state = 'ACTIVE') = 'COACH'
    and (select permission from public.team_permissions where membership_id = v_ms_manager and team_id = v_team) = 'coach',
    'C3: choosing coach replaces Team Manager and Team Administration (replace, as the legacy upsert was)');

  perform pg_temp.act('authenticated', v_admin);
  v_text := pg_temp.try(format('select public.set_team_access(%L, %L, ''view_only'', null)', v_ms_manager, v_team2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '22023', 'C4: View Only is not a team role (' || v_text || ')');

  perform pg_temp.act('authenticated', v_admin);
  perform public.remove_team_access(v_id, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check(not exists (select 1 from public.role_assignments where membership_id = v_ms_manager and team_id = v_team and state <> 'REVOKED')
    and not exists (select 1 from public.team_permissions where membership_id = v_ms_manager),
    'C5: remove_team_access ends every team role for that person on that team');

  perform pg_temp.act('authenticated', v_admin);
  perform public.set_primary_club_role(v_ms_fs, 'FIXTURE_SECRETARY', null);
  perform pg_temp.act_postgres();
  select id into v_fs_role from public.role_assignments where membership_id = v_ms_fs and role_key = 'FIXTURES_SECRETARY' and state = 'ACTIVE';
  perform pg_temp.check((select role from public.club_memberships where id = v_ms_fs) = 'FIXTURE_SECRETARY' and v_fs_role is not null
    and not exists (select 1 from public.role_assignments where membership_id = v_ms_fs and role_key = 'MEMBER' and state = 'ACTIVE'),
    'C6: Fixtures Secretary replaces Member and the legacy role follows');

  perform pg_temp.act('authenticated', v_admin);
  perform public.transition_role_assignment(v_fs_role, 'REVOKED', null);
  perform pg_temp.act_postgres();
  perform pg_temp.check((select role from public.club_memberships where id = v_ms_fs) = 'BASIC_USER'
    and exists (select 1 from public.role_assignments where membership_id = v_ms_fs and role_key = 'MEMBER' and state = 'ACTIVE'),
    'C7: revoking the only club role leaves the person a Member, never roleless');

  -- ===============================================================
  -- D. Legacy writes by backend sessions still land in role_assignments
  -- ===============================================================
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_manager, v_team2, 'manager');
  perform pg_temp.check(exists (select 1 from public.role_assignments where membership_id = v_ms_manager and team_id = v_team2 and role_key = 'TEAM_MANAGER' and state = 'ACTIVE' and source = 'LEGACY_BACKFILL'),
    'D1: a backend insert into the team_permissions view becomes a Team Manager assignment');
  delete from public.team_permissions where membership_id = v_ms_manager and team_id = v_team2;
  perform pg_temp.check(not exists (select 1 from public.role_assignments where membership_id = v_ms_manager and team_id = v_team2 and state <> 'REVOKED'),
    'D2: a backend delete through the view revokes it');
  update public.club_memberships set role = 'FIXTURE_SECRETARY' where id = v_ms_manager;
  perform pg_temp.check(exists (select 1 from public.role_assignments where membership_id = v_ms_manager and role_key = 'FIXTURES_SECRETARY' and state = 'ACTIVE')
    and (select role from public.club_memberships where id = v_ms_manager) = 'FIXTURE_SECRETARY',
    'D3: a backend legacy role write becomes a Fixtures Secretary assignment');
  update public.club_memberships set authority_suspended = true where id = v_ms_manager;
  perform pg_temp.check(not exists (select 1 from public.role_assignments where membership_id = v_ms_manager and state = 'ACTIVE')
    and (select role || '|' || authority_suspended from public.club_memberships where id = v_ms_manager) = 'FIXTURE_SECRETARY|true',
    'D4: the legacy club-authority flag suspends every role at SITE level and still reads back as before');
  update public.club_memberships set authority_suspended = false where id = v_ms_manager;
  perform pg_temp.check(exists (select 1 from public.role_assignments where membership_id = v_ms_manager and role_key = 'FIXTURES_SECRETARY' and state = 'ACTIVE'),
    'D5: clearing the flag restores exactly those roles');

  -- ===============================================================
  -- E. Events
  -- ===============================================================
  perform pg_temp.check((select count(*) from public.security_events where event_type = 'role.suspended' and subject_user_id = v_coach) = 2
    and exists (select 1 from public.security_events where event_type = 'role.restored' and subject_user_id = v_coach and actor_user_id = v_full)
    and exists (select 1 from public.security_events where event_type = 'role.revoked' and subject_user_id = v_coach and actor_user_id = v_admin and metadata ->> 'role_key' = 'COACH')
    and exists (select 1 from public.security_events where event_type = 'role.granted' and subject_user_id = v_coach and actor_user_id = v_admin and team_id = v_team),
    'E1: grant, suspend, restore and revoke are security events with actor and team');

  raise notice 'Role assignment state machine complete.';
end $$;

rollback;
