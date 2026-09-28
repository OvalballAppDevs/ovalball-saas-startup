-- TEAM STAFF IS AN ASSIGNMENT, NOT AN IDENTITY (Team Profiles Section 1, staff/role model audit).
--
-- Proves the architecture already supports the owner's locked multi-role rule -- a person may
-- simultaneously be a guardian, a player and staff, and may hold more than one staff role on the same
-- team -- without any schema change, and pins the `team_people_counts` staff fix (20270566000000):
-- staff is counted by DISTINCT PERSON, never by role row, and a Volunteer-only staff member is no
-- longer silently dropped.
--
--   TSR1  a guardian who is also Team Manager: both relationships hold at once
--   TSR2  Coach + Team Manager, same person, same team: team_people_counts.staff = 1, not 2
--   TSR3  a Volunteer-only staff member is counted at all (the exact undercount the audit found)
--   TSR4  an adult player who also coaches: player and staff coexist for the same person
--   TSR5  a minor cannot be granted a minor-prohibited team role (grant_role's own enforcement)
--   TSR6  revoking one role leaves the other role, the guardian link and the player membership intact
--   TSR7  an unrelated viewer still gets null/null, never a fabricated zero, after all of the above
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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tsr-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Tsr', p_label, 'tsr-' || v::text || '@ovalball.test', p_dob);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TSR ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tsr-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tsr-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid) returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under 12 Boys', 'tsr-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status, state) values (p_club, p_user, 'BASIC_USER', 'active', 'ACTIVE') returning id into v;
  return v;
end $$;

create or replace function pg_temp.player(p_dob date) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, active) values ('Tsr', 'Player', p_dob, true) returning id into v;
  return v;
end $$;

-- team_people_counts, asked as a specific signed-in subject (psql :'var' substitution does not cross
-- into a dollar-quoted do-block body, so this takes the subject as a real function argument instead).
create or replace function pg_temp.counts_as(p_subject uuid, p_team uuid) returns table(players integer, staff integer) language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  return query select * from public.team_people_counts(p_team);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Attempts internal.grant_role and returns 'OK' or the error message, never raising.
create or replace function pg_temp.try_grant(p_membership uuid, p_role text, p_team uuid, p_source text, p_reason text) returns text language plpgsql as $$
begin
  perform internal.grant_role(p_membership, p_role, p_team, p_source, p_reason, '{}'::jsonb);
  return 'OK';
exception when others then
  return sqlerrm;
end $$;

-- ---- SEED --------------------------------------------------------------------------------------
select pg_temp.club('Staff Model') as club_id \gset
select pg_temp.team(:'club_id') as team_id \gset

-- TSR1: a guardian who is also Team Manager.
select pg_temp.person('Guardian-Manager', '1988-06-01') as guardian_id \gset
select pg_temp.member(:'club_id', :'guardian_id') as guardian_membership \gset
select pg_temp.player('2016-03-01') as guardian_child_id \gset
insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state)
  values (:'guardian_id', :'guardian_child_id', 'guardian', 'active', 'ACTIVE');
select internal.grant_role(:'guardian_membership'::uuid, 'TEAM_MANAGER'::text, :'team_id'::uuid, 'CLUB_ADMIN_ASSIGNMENT'::text, 'TSR1'::text, '{}'::jsonb);
select pg_temp.check(
  (select count(*) = 1 from public.guardians where guardian_user_id = :'guardian_id' and player_id = :'guardian_child_id' and state = 'ACTIVE')
  and (select count(*) = 1 from public.role_assignments where membership_id = :'guardian_membership' and role_key = 'TEAM_MANAGER' and state = 'ACTIVE'),
  'TSR1 guardian relationship and Team Manager role coexist for the same person'
);

-- TSR2: Coach + Team Manager, same person, same team -- must still count as ONE staff person.
select pg_temp.person('Coach-Manager', '1990-06-01') as dual_id \gset
select pg_temp.member(:'club_id', :'dual_id') as dual_membership \gset
select internal.grant_role(:'dual_membership'::uuid, 'COACH'::text, :'team_id'::uuid, 'CLUB_ADMIN_ASSIGNMENT'::text, 'TSR2'::text, '{}'::jsonb);
select internal.grant_role(:'dual_membership'::uuid, 'TEAM_MANAGER'::text, :'team_id'::uuid, 'CLUB_ADMIN_ASSIGNMENT'::text, 'TSR2'::text, '{}'::jsonb);
select pg_temp.check(
  (select count(distinct role_key) from public.role_assignments where membership_id = :'dual_membership' and team_id = :'team_id' and state = 'ACTIVE') = 2,
  'TSR2 setup: two distinct roles genuinely recorded for one person'
);

-- TSR3: a Volunteer-only staff member -- the exact case `team_permissions` (and the pre-fix
-- `team_people_counts`) silently dropped, since its role filter never included VOLUNTEER.
select pg_temp.person('Volunteer-Only', '1975-06-01') as volunteer_id \gset
select pg_temp.member(:'club_id', :'volunteer_id') as volunteer_membership \gset
select internal.grant_role(:'volunteer_membership'::uuid, 'VOLUNTEER'::text, :'team_id'::uuid, 'CLUB_ADMIN_ASSIGNMENT'::text, 'TSR3'::text, '{}'::jsonb);
select pg_temp.check(
  not exists (select 1 from public.team_permissions where membership_id = :'volunteer_membership'),
  'TSR3 setup: the legacy team_permissions view genuinely still excludes a Volunteer (proves the bug this fix closes)'
);

-- Authorise the club's own admin so team_people_counts.view resolves true for the assertions below.
select pg_temp.person('Club Admin', '1985-01-01') as admin_id \gset
select pg_temp.member(:'club_id', :'admin_id') as admin_membership \gset
select internal.grant_role(:'admin_membership'::uuid, 'CLUB_ADMIN'::text, null, 'CLUB_ADMIN_ASSIGNMENT'::text, 'setup'::text, '{}'::jsonb);

select pg_temp.check(staff = 3, format('TSR2/TSR3 team_people_counts.staff counts 3 distinct people (Coach-Manager once, Volunteer included), got %s', staff))
  from pg_temp.counts_as(:'admin_id'::uuid, :'team_id'::uuid);

-- TSR4: an adult player who also coaches -- player and staff relationships coexist for one person.
select pg_temp.person('Adult Player Coach', '2000-01-01') as adult_player_person_id \gset
select pg_temp.player('2000-01-01') as adult_player_id \gset
update public.players set user_id = :'adult_player_person_id'::uuid, playing_pathway = 'MALE' where id = :'adult_player_id'::uuid;
insert into public.player_team_memberships (player_id, team_id, status, state) values (:'adult_player_id', :'team_id', 'active', 'ACTIVE');
select pg_temp.member(:'club_id', :'adult_player_person_id') as adult_player_membership \gset
select pg_temp.try_grant(:'adult_player_membership'::uuid, 'COACH', :'team_id'::uuid, 'CLUB_ADMIN_ASSIGNMENT', 'TSR4') as tsr4_grant_result \gset
select pg_temp.check(:'tsr4_grant_result' = 'OK', 'TSR4 setup: the adult player''s Coach grant succeeded (' || :'tsr4_grant_result' || ')');
select pg_temp.check(
  (select count(*) = 1 from public.player_team_memberships where player_id = :'adult_player_id' and team_id = :'team_id' and status = 'active')
  and (select count(*) = 1 from public.role_assignments where membership_id = :'adult_player_membership' and role_key = 'COACH' and state = 'ACTIVE'),
  'TSR4 an adult player also holds a genuine Coach role on the same team'
);

-- TSR5: a minor CANNOT be granted a minor-prohibited team role (grant_role's own enforcement, not a
-- second, duplicated rule invented here).
select pg_temp.person('Minor Player', '2015-01-01') as minor_id \gset
select pg_temp.member(:'club_id', :'minor_id') as minor_membership \gset
select pg_temp.try_grant(:'minor_membership'::uuid, 'COACH', :'team_id'::uuid, 'CLUB_ADMIN_ASSIGNMENT', 'TSR5') as tsr5_grant_result \gset
select pg_temp.check(:'tsr5_grant_result' != 'OK', 'TSR5 a minor is refused a minor-prohibited team role by grant_role itself (' || :'tsr5_grant_result' || ')');

-- TSR6: revoking ONE role leaves the other role, the guardian link and the player relationship intact.
update public.role_assignments set state = 'REVOKED', revoked_at = now(), revocation_reason = 'TSR6'
  where membership_id = :'dual_membership' and role_key = 'COACH';
select pg_temp.check(
  (select state from public.role_assignments where membership_id = :'dual_membership' and role_key = 'TEAM_MANAGER') = 'ACTIVE'
  and (select count(*) = 1 from public.guardians where guardian_user_id = :'guardian_id' and state = 'ACTIVE')
  and (select count(*) = 1 from public.player_team_memberships where player_id = :'adult_player_id' and status = 'active'),
  'TSR6 revoking one role leaves the person''s other role, guardian link and player membership untouched'
);

-- TSR7: after all of the above, a genuinely unrelated viewer still gets null/null, never a fabricated
-- zero or a partial count.
select pg_temp.person('Unrelated Viewer') as stranger_id \gset
select pg_temp.check(players is null and staff is null, 'TSR7 an unrelated viewer gets null/null, never zero, from team_people_counts')
  from pg_temp.counts_as(:'stranger_id'::uuid, :'team_id'::uuid);

rollback;
