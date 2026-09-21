-- CONVERGENCE STEP 10 — TEAM EXPERIENCE.
--
--   A. WHAT A PERSON IS TO A TEAM. Every relationship, as a list: a coach who
--      is also a parent is two badges, not one invented primary role. A
--      revoked role and a suspended membership return nothing, so a badge can
--      never outlive the relationship it describes.
--   B. IT IS PRESENTATION, NOT AUTHORITY. A badge confers nothing, and the
--      capability engine still answers every question independently.
--   C. TEAM IDOR. Another club's team, another team's roster and another
--      family's child are unreachable by naming their ids.
--   D. TEAM STAFF DO NOT BECOME CLUB ADMINISTRATORS. A coach may arrange a
--      single fixture for their own team and may not reach the mass tools.
--   E. A SITE ADMIN INSPECTING A TEAM DOES NOT JOIN IT.
--
-- Self-seeding and rolled back. No persistent review identity is touched.
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
  v_coach uuid := gen_random_uuid();       -- coach of team A, and a parent in it
  v_manager uuid := gen_random_uuid();     -- manager of team B
  v_parent uuid := gen_random_uuid();      -- parent only
  v_stranger uuid := gen_random_uuid();    -- another club entirely
  v_site uuid := gen_random_uuid();        -- Full Site Admin, no club membership
  v_dir uuid; v_dir_b uuid; v_club uuid; v_club_b uuid;
  v_team uuid; v_team_b uuid; v_far_team uuid;
  v_ms_coach uuid; v_ms_manager uuid; v_ms_parent uuid;
  v_child uuid; v_other_child uuid;
  v_text text; v_n int; v_bool boolean;
begin
  foreach v_person in array array[v_coach, v_manager, v_parent, v_stranger, v_site] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      's10-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Step', 'Ten', 's10-' || v_person::text || '@ovalball.test', (current_date - interval '38 years')::date)
    on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role) values (v_site, 'active', 'full');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('S10 RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's10-' || v_tag)
  returning id into v_dir;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('S10 Far RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's10-far-' || v_tag)
  returning id into v_dir_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 's10-' || v_tag, 'active') returning id into v_club;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 's10-far-' || v_tag, 'active') returning id into v_club_b;

  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 's10-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 14 Boys', 's10-u14-' || v_tag, 'youth', 'U14', 'boys', 'union', true) returning id into v_team_b;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_b, 'Under 12 Boys', 's10-far-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_far_team;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach, 'BASIC_USER', 'active') returning id into v_ms_coach;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_manager, 'BASIC_USER', 'active') returning id into v_ms_manager;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_parent, 'BASIC_USER', 'active') returning id into v_ms_parent;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_stranger, 'CLUB_ADMIN', 'active');

  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Cass', 'Ten ' || v_tag, (current_date - interval '11 years')::date, 'MALE') returning id into v_child;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Otto', 'Other ' || v_tag, (current_date - interval '11 years')::date, 'MALE') returning id into v_other_child;
  insert into public.player_team_memberships (player_id, team_id, state) values (v_child, v_team, 'ACTIVE'), (v_other_child, v_team, 'ACTIVE');

  -- The coach is ALSO this child's parent: the most ordinary shape in grassroots rugby.
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by)
  values (v_coach, v_child, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_coach);
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by)
  values (v_parent, v_other_child, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent);

  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source)
  values (v_coach, v_ms_coach, v_club, v_team, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');
  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source)
  values (v_manager, v_ms_manager, v_club, v_team_b, 'TEAM_MANAGER', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');
  -- A second, disposable assignment for the revocation check, so the coach's
  -- real role at team A survives for the authority sections below. The state
  -- machine is right that a revoked role cannot be restored -- "assign it
  -- again" -- so the test does not try to.
  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source)
  values (v_coach, v_ms_coach, v_club, v_team_b, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');

  -- ===============================================================
  -- A. WHAT A PERSON IS TO A TEAM
  -- ===============================================================
  perform pg_temp.act('authenticated', v_coach);
  select count(*) into v_n from public.my_team_relationship(v_team);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 2,
    'A1: a coach who is also a parent of a child in the team is TWO relationships, not one (' || v_n || ')');

  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(
    exists (select 1 from public.my_team_relationship(v_team) where relationship = 'COACH')
    and exists (select 1 from public.my_team_relationship(v_team) where relationship = 'GUARDIAN'),
    'A2: and both are named for what they are');
  perform pg_temp.check(
    (select subject_name from public.my_team_relationship(v_team) where relationship = 'GUARDIAN') like 'Cass%',
    'A3: the guardian badge names the child, so two children in one team are distinguishable');
  perform pg_temp.act_postgres();

  perform pg_temp.act('authenticated', v_manager);
  select count(*) into v_n from public.my_team_relationship(v_team_b);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 1, 'A4: a manager of another team holds one relationship there (' || v_n || ')');

  perform pg_temp.act('authenticated', v_manager);
  select count(*) into v_n from public.my_team_relationship(v_team);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 0,
    'A5: and NONE at the team they do not run -- a badge is per team, not per club (' || v_n || ')');

  -- A revoked role stops being a badge immediately.
  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(exists (select 1 from public.my_team_relationship(v_team_b) where relationship = 'COACH'),
    'A6a: the coach holds a badge at the second team to begin with');
  perform pg_temp.act_postgres();

  update public.role_assignments
     set state = 'REVOKED', revoked_by = v_coach, revoked_at = now(), revocation_reason = 'stepped down'
   where membership_id = v_ms_coach and team_id = v_team_b;

  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(
    not exists (select 1 from public.my_team_relationship(v_team_b) where relationship = 'COACH'),
    'A6: a revoked role is not a badge');
  perform pg_temp.check(
    exists (select 1 from public.my_team_relationship(v_team) where relationship = 'COACH')
    and exists (select 1 from public.my_team_relationship(v_team) where relationship = 'GUARDIAN'),
    'A7: and removing one relationship leaves every other one standing');
  perform pg_temp.act_postgres();

  -- A suspended membership must not keep a badge alive. It turns out the
  -- answer is stronger than the question: a suspended member loses
  -- team.team.view at rule 1, so they are refused the team itself and there is
  -- no stale badge to show. Asserted as what actually happens rather than as
  -- what was expected.
  update public.club_memberships set state = 'SUSPENDED', authority_suspended = true where id = v_ms_coach;
  perform pg_temp.act('authenticated', v_coach);
  v_text := pg_temp.try(format('select * from public.my_team_relationship(%L)', v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'A8: a suspended membership cannot reach the team at all, so no badge can outlive it (' || v_text || ')');
  update public.club_memberships set state = 'ACTIVE', authority_suspended = false where id = v_ms_coach;

  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(exists (select 1 from public.my_team_relationship(v_team) where relationship = 'COACH'),
    'A9: and reactivation brings the badge back, because the role was never deleted');
  perform pg_temp.act_postgres();

  -- ===============================================================
  -- B. A BADGE IS NOT AUTHORITY
  -- ===============================================================
  perform pg_temp.act('authenticated', v_parent);
  v_bool := (select allowed from public.explain_access(v_parent, 'team.roster.manage', 'team', v_club, v_team, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool is not true, 'B1: a parent badge does not confer roster authority');

  perform pg_temp.act('authenticated', v_coach);
  v_bool := (select allowed from public.explain_access(v_coach, 'team.team.manage', 'team', v_club, v_team, null));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_bool is not true,
    'B2: nor a Coach badge confer team SETTINGS authority -- that is the club''s');

  -- ===============================================================
  -- C. TEAM IDOR
  -- ===============================================================
  perform pg_temp.act('authenticated', v_stranger);
  v_text := pg_temp.try(format('select * from public.my_team_relationship(%L)', v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'C1: another club''s Club Admin cannot even ask about this team (' || v_text || ')');

  perform pg_temp.act('authenticated', v_coach);
  v_text := pg_temp.try(format('select * from public.my_team_relationship(%L)', v_far_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'C2: and naming another club''s team id does not reach it (' || v_text || ')');

  perform pg_temp.act('authenticated', v_coach);
  v_text := pg_temp.try(format('select * from public.my_team_relationship(%L)', gen_random_uuid()));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'P0002', 'C3: a forged team id is not found, not leaked (' || v_text || ')');

  -- A parent sees their own child's relationship and not the other family's.
  perform pg_temp.act('authenticated', v_parent);
  select count(*) into v_n from public.my_team_relationship(v_team);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 1, 'C4: a parent of one child in the team holds exactly one relationship (' || v_n || ')');
  perform pg_temp.act('authenticated', v_parent);
  perform pg_temp.check(
    (select subject_name from public.my_team_relationship(v_team)) like 'Otto%',
    'C5: and it is about THEIR child, never the other family''s');
  perform pg_temp.act_postgres();

  -- ===============================================================
  -- D. TEAM STAFF DO NOT BECOME CLUB ADMINISTRATORS
  -- ===============================================================
  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(
    (select allowed from public.explain_access(v_coach, 'fixture.fixture.create', 'team', v_club, v_team, null)),
    'D1: a coach may arrange a single fixture for their own team');
  perform pg_temp.act_postgres();

  perform pg_temp.act('authenticated', v_coach);
  perform pg_temp.check(
    (select allowed from public.explain_access(v_coach, 'fixture.import.run', 'club', v_club, null, null)) is not true,
    'D2: and may not import a season');
  perform pg_temp.check(
    (select allowed from public.explain_access(v_coach, 'fixture.planner.use', 'club', v_club, null, null)) is not true,
    'D3: nor use the Season Planner');
  perform pg_temp.check(
    (select allowed from public.explain_access(v_coach, 'fixture.fixture.bulk_edit', 'club', v_club, null, null)) is not true,
    'D4: nor edit fixtures in bulk');
  perform pg_temp.check(
    (select allowed from public.explain_access(v_coach, 'competition.creator.use', 'club', v_club, null, null)) is not true,
    'D5: nor create a competition');
  perform pg_temp.check(
    (select allowed from public.explain_access(v_coach, 'people.capability.manage', 'club', v_club, null, null)) is not true,
    'D6: nor manage the club''s permissions');
  perform pg_temp.act_postgres();

  -- ===============================================================
  -- E. A SITE ADMIN INSPECTING A TEAM DOES NOT JOIN IT
  -- ===============================================================
  select count(*) into v_n from public.club_memberships where user_id = v_site;
  perform pg_temp.check(v_n = 0, 'E1: the Site Admin holds no club membership to begin with');

  perform pg_temp.act('authenticated', v_site);
  v_text := pg_temp.try(format('select * from public.my_team_relationship(%L)', v_team));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK', 'E2: and may still inspect a team (' || v_text || ')');

  perform pg_temp.act('authenticated', v_site);
  select count(*) into v_n from public.my_team_relationship(v_team);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 0,
    'E3: holding NO relationship to it -- inspecting is not joining (' || v_n || ')');

  select count(*) into v_n from public.club_memberships where user_id = v_site;
  perform pg_temp.check(v_n = 0, 'E4: and they are still not a member of the club afterwards (' || v_n || ')');

  -- ===============================================================
  -- F. THE COVER PHOTO IS IDENTITY IMAGERY, NOT MEMBER DATA
  -- ===============================================================
  perform pg_temp.check(
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'teams' and column_name = 'cover_image_path'),
    'F1: a team can carry its own cover photo');
  perform pg_temp.check(
    (select count(*) from information_schema.tables where table_schema = 'public' and table_name like '%team_media%') = 0,
    'F2: and it needed no second media architecture to do it');
end $$;

rollback;
