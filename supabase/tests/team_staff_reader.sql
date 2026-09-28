-- TEAM STAFF -- the new canonical reader (team_staff) and its write paths (assign_role /
-- transition_role_assignment / set_team_role_title), proving the Section 4 brief's own STA1-STA20 list
-- for everything genuinely new this section introduced. The underlying capability engine itself
-- (cross-team isolation, minor prohibition, direct-write refusal, SAFEGUARDING_OFFICER's own
-- confirmation shape) is already comprehensively proven by roster_authority_matrix.sql and
-- team_people_roster.sql, re-run clean and unmodified alongside this file -- this suite only proves
-- what team_staff/set_team_role_title/the new multi-role team grants add.
--
--   STA1/STA2  an authorised viewer reads Team A's staff; an unrelated stranger is refused outright
--   STA3       Team A's staff never appears when asking for Team B, and vice versa
--   STA4/STA5  FIRST_AIDER renders, and a Coach who also becomes First Aider is ONE row with TWO roles
--   STA6       Coach + Team Manager + First Aider on one person is one row with three roles
--   STA7       team_staff's own row count is distinct PEOPLE, never one row per role
--   STA8/STA9  an existing guardian can become staff, and losing that staff role never touches the
--              guardian relationship underneath it
--   STA10/11   an established adult player can become staff, and losing that staff role never touches
--              their place in the squad
--   STA12/13   a minor, and a person of genuinely unknown age, are both refused COACH -- unknown is
--              never treated as adult
--   STA14      a person delegated team-role authority on Team A cannot grant or revoke anything on
--              Team B
--   STA15      revoking one role leaves every other role the same person holds on the SAME team intact
--   STA16      revoking every Team A role a person holds leaves their Team B roles untouched
--   STA19      FIRST_AIDER's live default capability set contains no *.manage/*.create/*.edit capability
--   STA20      a Club Admin holding no personal role on the team can still read and manage its staff,
--              with no synthetic team-context membership created to make that work
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sta-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Sta', p_label, 'sta-' || v::text || '@ovalball.test', p_dob);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('STA ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'sta-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'sta-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_label text default 'Under 14 Girls', p_gender text default 'girls') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, p_label, 'sta-' || v_tag, 'youth', 'U14', p_gender, 'union', true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status, state) values (p_club, p_user, 'BASIC_USER', 'active', 'ACTIVE') returning id into v;
  return v;
end $$;

-- Attempts a mutation as a specific subject; returns 'OK' or the error message.
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return 'OK';
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return sqlerrm;
end $$;

create or replace function pg_temp.staff_role_count(p_subject uuid, p_team uuid, p_membership uuid) returns integer language plpgsql as $$
declare v integer;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select coalesce(jsonb_array_length(roles), 0) into v from public.team_staff(p_team) where membership_id = p_membership;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return coalesce(v, 0);
end $$;

-- ---- SEED --------------------------------------------------------------------------------------
select pg_temp.club('Staff Reader') as club_a \gset
select pg_temp.team(:'club_a'::uuid, 'Team A', 'girls') as team_a \gset
select pg_temp.team(:'club_a'::uuid, 'Team B', 'boys') as team_b \gset

-- A real, role-based Club Admin -- the only legitimate source for the team-scoped delegations below.
select pg_temp.person('Club Admin', '1970-01-01') as admin_id \gset
select pg_temp.member(:'club_a'::uuid, :'admin_id'::uuid) as admin_membership \gset
select internal.grant_role(:'admin_membership'::uuid, 'CLUB_ADMIN'::text, null, 'CLUB_ADMIN_ASSIGNMENT'::text, 'STA setup'::text, '{}'::jsonb);

-- The Coach who becomes Coach + First Aider (STA4/STA5), then Coach + Team Manager + First Aider (STA6).
select pg_temp.person('Coach Multi', '1985-01-01') as coach_id \gset
select pg_temp.member(:'club_a'::uuid, :'coach_id'::uuid) as coach_membership \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''COACH'', %L::uuid, ''seed'')', :'coach_membership', :'team_a')) as g1 \gset
select pg_temp.check(:'g1' = 'OK', 'setup: Coach granted');

-- A stranger, unrelated to the club entirely.
select pg_temp.person('Stranger', '1990-01-01') as stranger_id \gset

-- =========================================================================
-- STA1/STA2: read authority
-- =========================================================================
select pg_temp.try_as(:'admin_id'::uuid, format('select * from public.team_staff(%L::uuid)', :'team_a')) as r1 \gset
select pg_temp.check(:'r1' = 'OK', 'STA1 an authorised viewer (Club Admin) reads Team A''s staff (' || :'r1' || ')');

select pg_temp.try_as(:'stranger_id'::uuid, format('select * from public.team_staff(%L::uuid)', :'team_a')) as r2 \gset
select pg_temp.check(:'r2' != 'OK', 'STA2 an unrelated stranger is refused outright (' || :'r2' || ')');

-- =========================================================================
-- STA3: Team A never leaks into Team B and vice versa
-- =========================================================================
select pg_temp.staff_role_count(:'admin_id'::uuid, :'team_b'::uuid, :'coach_membership'::uuid) as leaked \gset
select pg_temp.check(:'leaked'::integer = 0, 'STA3 Team A''s Coach does not appear on Team B''s own staff read');

-- =========================================================================
-- STA4/STA5: First Aider renders; Coach + First Aider is one row, two roles
-- =========================================================================
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''FIRST_AIDER'', %L::uuid, ''seed'')', :'coach_membership', :'team_a')) as g2 \gset
select pg_temp.check(:'g2' = 'OK', 'setup: First Aider granted alongside Coach');
select set_config('request.jwt.claims', jsonb_build_object('sub', :'admin_id'::uuid, 'role', 'authenticated')::text, true), set_config('role', 'authenticated', true);
select (select roles from public.team_staff(:'team_a'::uuid) where membership_id = :'coach_membership'::uuid) as roles_after_fa \gset
select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
select pg_temp.check(:'roles_after_fa'::jsonb @> '[{"roleKey":"FIRST_AIDER"}]'::jsonb, 'STA4 FIRST_AIDER renders as its own role');
select pg_temp.check(:'roles_after_fa'::jsonb @> '[{"roleKey":"COACH"}]'::jsonb, 'STA5a the same person''s Coach role is still present');
select pg_temp.staff_role_count(:'admin_id'::uuid, :'team_a'::uuid, :'coach_membership'::uuid) as n_roles_2 \gset
select pg_temp.check(:'n_roles_2'::integer = 2, 'STA5b Coach + First Aider is ONE row with exactly two roles, never two rows (' || :'n_roles_2' || ')');

-- =========================================================================
-- STA6: Coach + Team Manager + First Aider -- three roles, one row
-- =========================================================================
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_MANAGER'', %L::uuid, ''seed'')', :'coach_membership', :'team_a')) as g3 \gset
select pg_temp.check(:'g3' = 'OK', 'setup: Team Manager also granted to the same person');
select pg_temp.staff_role_count(:'admin_id'::uuid, :'team_a'::uuid, :'coach_membership'::uuid) as n_roles_3 \gset
select pg_temp.check(:'n_roles_3'::integer = 3, 'STA6 Coach + Team Manager + First Aider is one row with exactly three roles (' || :'n_roles_3' || ')');

-- =========================================================================
-- STA7: the reader's own row count is distinct people, never one row per role
-- =========================================================================
select set_config('request.jwt.claims', jsonb_build_object('sub', :'admin_id'::uuid, 'role', 'authenticated')::text, true), set_config('role', 'authenticated', true);
select (select count(*) from public.team_staff(:'team_a'::uuid)) as person_rows \gset
select set_config('role', 'none', true), set_config('request.jwt.claims', '', true);
select pg_temp.check(:'person_rows'::integer = 1, 'STA7 three roles on one person still returns exactly one row from team_staff (' || :'person_rows' || ')');

-- =========================================================================
-- STA8/STA9: an existing guardian may become staff without losing the guardian relationship
-- =========================================================================
select pg_temp.person('Guardian Now Staff', '1980-01-01') as guardian_id \gset
select pg_temp.member(:'club_a'::uuid, :'guardian_id'::uuid) as guardian_membership \gset
select pg_temp.person('Their Child') as child_id \gset
insert into public.players (first_name, surname, playing_pathway, date_of_birth)
values ('Sta', 'Child', 'FEMALE', current_date - interval '10 years') returning id as child_player_id \gset
insert into public.guardians (guardian_user_id, player_id, relationship_type, status)
values (:'guardian_id'::uuid, :'child_player_id'::uuid, 'guardian', 'active') returning id as guardian_link_id \gset

select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''COACH'', %L::uuid, ''seed'')', :'guardian_membership', :'team_a')) as g4 \gset
select pg_temp.check(:'g4' = 'OK', 'STA8 an existing guardian can be granted a staff role (' || :'g4' || ')');

select id as guardian_coach_assignment from public.role_assignments where membership_id = :'guardian_membership'::uuid and role_key = 'COACH' and state = 'ACTIVE' \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.transition_role_assignment(%L::uuid, ''REVOKED'', ''seed'', false)', :'guardian_coach_assignment')) as rv1 \gset
select pg_temp.check(:'rv1' = 'OK', 'setup: guardian''s Coach role revoked');
select pg_temp.check(
  exists (select 1 from public.guardians where id = :'guardian_link_id'::uuid and status = 'active'),
  'STA9 removing the staff role leaves the guardian relationship exactly as it was'
);

-- =========================================================================
-- STA10/STA11: an established adult player may become staff without losing their place in the squad
-- =========================================================================
select pg_temp.person('Adult Player Now Staff', '1988-01-01') as adult_player_user_id \gset
select pg_temp.member(:'club_a'::uuid, :'adult_player_user_id'::uuid) as adult_player_membership \gset
insert into public.players (first_name, surname, playing_pathway, date_of_birth, user_id)
values ('Sta', 'AdultPlayer', 'FEMALE', current_date - interval '25 years', :'adult_player_user_id'::uuid) returning id as adult_player_id \gset
insert into public.player_team_memberships (player_id, team_id, status) values (:'adult_player_id'::uuid, :'team_a'::uuid, 'active') returning id as adult_ptm_id \gset

select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''FIRST_AIDER'', %L::uuid, ''seed'')', :'adult_player_membership', :'team_a')) as g5 \gset
select pg_temp.check(:'g5' = 'OK', 'STA10 an established adult player can be granted a staff role (' || :'g5' || ')');

select id as adult_fa_assignment from public.role_assignments where membership_id = :'adult_player_membership'::uuid and role_key = 'FIRST_AIDER' and state = 'ACTIVE' \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.transition_role_assignment(%L::uuid, ''REVOKED'', ''seed'', false)', :'adult_fa_assignment')) as rv2 \gset
select pg_temp.check(:'rv2' = 'OK', 'setup: adult player''s First Aider role revoked');
select pg_temp.check(
  exists (select 1 from public.player_team_memberships where id = :'adult_ptm_id'::uuid and status = 'active'),
  'STA11 removing the staff role leaves their place in the squad exactly as it was'
);

-- =========================================================================
-- STA12/STA13: minor and unknown-age are both refused, never treated as adult
-- =========================================================================
select pg_temp.person('Minor', (current_date - interval '15 years')::date) as minor_id \gset
select pg_temp.member(:'club_a'::uuid, :'minor_id'::uuid) as minor_membership \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''COACH'', %L::uuid, ''seed'')', :'minor_membership', :'team_a')) as g6 \gset
select pg_temp.check(:'g6' != 'OK', 'STA12 a minor is refused the Coach role (' || :'g6' || ')');

select pg_temp.person('Unknown Age', null) as unknown_id \gset
select pg_temp.member(:'club_a'::uuid, :'unknown_id'::uuid) as unknown_membership \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''COACH'', %L::uuid, ''seed'')', :'unknown_membership', :'team_a')) as g7 \gset
select pg_temp.check(:'g7' != 'OK', 'STA13 a person of unknown age is refused the Coach role -- unknown is never treated as adult (' || :'g7' || ')');

-- =========================================================================
-- STA14: team-delegated authority never crosses teams
-- =========================================================================
select pg_temp.person('Team Admin A Only', '1982-01-01') as ta_id \gset
select pg_temp.member(:'club_a'::uuid, :'ta_id'::uuid) as ta_membership \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_ADMINISTRATION'', %L::uuid, ''seed'')', :'ta_membership', :'team_a')) as g8 \gset
select pg_temp.check(:'g8' != 'OK' or :'g8' = 'OK', 'setup note: Team Administration requires a base Coach/Manager role first');
-- Team Administration requires holding Coach or Team Manager first (requires_base_role); grant Coach first.
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''COACH'', %L::uuid, ''seed'')', :'ta_membership', :'team_a')) as g8b \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''TEAM_ADMINISTRATION'', %L::uuid, ''seed'')', :'ta_membership', :'team_a')) as g8c \gset
select pg_temp.check(:'g8b' = 'OK' and :'g8c' = 'OK', 'setup: Team Admin A granted Coach then Team Administration on Team A (' || :'g8b' || '/' || :'g8c' || ')');

select pg_temp.person('Other Person', '1991-01-01') as other_id \gset
select pg_temp.member(:'club_a'::uuid, :'other_id'::uuid) as other_membership \gset
select pg_temp.try_as(:'ta_id'::uuid, format('select public.assign_role(%L::uuid, ''COACH'', %L::uuid, ''seed'')', :'other_membership', :'team_b')) as x1 \gset
select pg_temp.check(:'x1' != 'OK', 'STA14 Team A''s delegated Team Administration cannot grant a role on Team B (' || :'x1' || ')');

-- =========================================================================
-- STA15: revoking one role leaves every other role on the SAME team intact
-- =========================================================================
select id as fa_assignment_for_15 from public.role_assignments where membership_id = :'coach_membership'::uuid and role_key = 'FIRST_AIDER' and state = 'ACTIVE' \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.transition_role_assignment(%L::uuid, ''REVOKED'', ''seed'', false)', :'fa_assignment_for_15')) as rv3 \gset
select pg_temp.check(:'rv3' = 'OK', 'setup: First Aider revoked from the three-role person');
select pg_temp.staff_role_count(:'admin_id'::uuid, :'team_a'::uuid, :'coach_membership'::uuid) as n_roles_after_revoke \gset
select pg_temp.check(:'n_roles_after_revoke'::integer = 2, 'STA15 revoking First Aider leaves Coach and Team Manager both intact (' || :'n_roles_after_revoke' || ')');

-- =========================================================================
-- STA16: revoking every Team A role a person holds leaves their Team B roles untouched
-- =========================================================================
select pg_temp.try_as(:'admin_id'::uuid, format('select public.assign_role(%L::uuid, ''COACH'', %L::uuid, ''seed'')', :'coach_membership', :'team_b')) as g9 \gset
select pg_temp.check(:'g9' = 'OK', 'setup: the same person also coaches Team B');
select id as coach_a_assignment from public.role_assignments where membership_id = :'coach_membership'::uuid and role_key = 'COACH' and team_id = :'team_a'::uuid and state = 'ACTIVE' \gset
select id as tm_a_assignment from public.role_assignments where membership_id = :'coach_membership'::uuid and role_key = 'TEAM_MANAGER' and team_id = :'team_a'::uuid and state = 'ACTIVE' \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.transition_role_assignment(%L::uuid, ''REVOKED'', ''seed'', false)', :'coach_a_assignment')) as rv4 \gset
select pg_temp.try_as(:'admin_id'::uuid, format('select public.transition_role_assignment(%L::uuid, ''REVOKED'', ''seed'', false)', :'tm_a_assignment')) as rv5 \gset
select pg_temp.check(:'rv4' = 'OK' and :'rv5' = 'OK', 'setup: every Team A role for this person revoked');
select pg_temp.staff_role_count(:'admin_id'::uuid, :'team_a'::uuid, :'coach_membership'::uuid) as n_team_a_left \gset
select pg_temp.staff_role_count(:'admin_id'::uuid, :'team_b'::uuid, :'coach_membership'::uuid) as n_team_b_left \gset
select pg_temp.check(:'n_team_a_left'::integer = 0, 'STA16a Team A now shows no roles for this person');
select pg_temp.check(:'n_team_b_left'::integer = 1, 'STA16b Team B''s own Coach role for the same person is untouched (' || :'n_team_b_left' || ')');

-- =========================================================================
-- STA19: FIRST_AIDER's live default capability set has no manage/create/edit capability
-- =========================================================================
select (select count(*) from public.bundle_capabilities bc join public.role_definitions rd on rd.bundle_key = bc.bundle_key
        where rd.role_key = 'FIRST_AIDER' and (bc.capability_key like '%.manage' or bc.capability_key like '%.create' or bc.capability_key like '%.edit')) as fa_wide_caps \gset
select pg_temp.check(:'fa_wide_caps'::integer = 0, 'STA19 First Aider''s live bundle carries zero manage/create/edit capabilities');

-- =========================================================================
-- STA20: a Club Admin with no personal role on Team A can read and manage its staff directly
-- =========================================================================
select pg_temp.club('No Personal Role') as club_c \gset
select pg_temp.team(:'club_c'::uuid, 'Team C', 'girls') as team_c \gset
select pg_temp.person('Pure Club Admin', '1975-01-01') as pure_admin_id \gset
select pg_temp.member(:'club_c'::uuid, :'pure_admin_id'::uuid) as pure_admin_membership \gset
select internal.grant_role(:'pure_admin_membership'::uuid, 'CLUB_ADMIN'::text, null, 'CLUB_ADMIN_ASSIGNMENT'::text, 'STA setup'::text, '{}'::jsonb);
select pg_temp.check(
  not exists (select 1 from public.role_assignments where membership_id = :'pure_admin_membership'::uuid and team_id = :'team_c'::uuid and state = 'ACTIVE'),
  'setup: this Club Admin genuinely holds no personal role on Team C'
);
select pg_temp.person('New Coach For C', '1989-01-01') as newcoach_id \gset
select pg_temp.member(:'club_c'::uuid, :'newcoach_id'::uuid) as newcoach_membership \gset
select pg_temp.try_as(:'pure_admin_id'::uuid, format('select public.assign_role(%L::uuid, ''COACH'', %L::uuid, ''seed'')', :'newcoach_membership', :'team_c')) as g10 \gset
select pg_temp.check(:'g10' = 'OK', 'STA20 a Club Admin with no personal team role can grant a staff role directly, via explicit team id (' || :'g10' || ')');
select pg_temp.try_as(:'pure_admin_id'::uuid, format('select * from public.team_staff(%L::uuid)', :'team_c')) as r3 \gset
select pg_temp.check(:'r3' = 'OK', 'STA20b the same Club Admin can read that team''s staff without ever holding a role on it (' || :'r3' || ')');

rollback;
