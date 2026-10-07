-- =====================================================================================================
-- ONE WAY TO BRING PEOPLE IN (20270739000000) -- People & Invitations programme
--
-- WHAT THIS GUARDS
--
--   T. TITLES DESCRIBE, NEVER GRANT: a club title and a team title on any team role are words; the name
--      of a governed role or of administration is refused as a title; a custom role (a Volunteer at a
--      team called "Strength & Conditioning Coach", a club "Chair") carries no authority beyond the role
--      it rests on.
--   V. A TEAM ADMIN MAY GIVE VOLUNTEER AT THEIR OWN TEAM, and nothing more than before: not club-wide,
--      not at another team, not to themselves, never Club Admin; a Team Manager or a Coach without Team
--      Admin gives nothing; a Coach cannot make anybody Fixture Secretary.
--   I. ONE ENGINE, ONE SHAPE: the staff invitation People, Home and Team Staff issue is CLUB_STAFF; it
--      carries Member, First Aider, Team Safeguarding Lead and a team Volunteer with titles; club access
--      is one seat; Team Administration and a title on a role it does not carry are refused, and a
--      governed name as a custom role or as their role at the club is refused in words naming it; nobody
--      outside the issuing authority, and no other club, can issue one; a personal team code carries a
--      name and nothing else a caller sends.
--   R. ACCEPTING IT admits through the one admission path (source INVITATION, the invitation recorded),
--      approves a waiting membership instead of failing, refuses a deactivated one without spending the
--      invitation, never lowers club access, applies titles, gives a team Volunteer only at the team,
--      reuses an existing member's row, and an invitation stored before this change still works; a
--      revoked or expired invitation fails.
--   P. ONE REGISTER: players are rows for the people who may read the club's rosters and never for a
--      Fixture Secretary; a player who is also a member is one row; every team role and title shows;
--      the filters, a role and a title narrow it; deactivated people are a state, not mixed into All;
--      an open invitation shows its real offer; another club's administrator reads nothing.
--   S. ACCESS SUMMARY, CANDIDATES, PICKERS AND PREVIEW: counts per access level, role, title and state;
--      a Team Admin may search the club's members for their team's staff and a Coach may not; the role
--      picker offers only what the caller may give; the preview says what accepting grants, without
--      the email, and a withdrawn link says only that it no longer works.
--   L. LIFECYCLE: deactivating keeps the account, the history and the roles (paused); reactivating
--      restores them; removing ends the relationship and a later invitation admits the person on a new
--      membership; another club's administrator cannot touch the membership by its id.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.
-- =====================================================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create temp table ctx (k text primary key, v uuid) on commit drop;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ctx where k = p_k $$;
create or replace function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v $$;

create or replace function pg_temp.person(p_label text, p_email text, p_dob date default (current_date - interval '35 years')::date)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',p_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth) values (v,'People',p_label,p_email,p_dob)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.as_(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
end $$;
create or replace function pg_temp.off() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims','', true);
end $$;

-- Runs one statement as a person; returns OK or the SQLSTATE.
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_(p_subject);
  begin execute p_sql; v := 'OK'; exception when others then get stacked diagnostics v = returned_sqlstate; end;
  perform pg_temp.off();
  return v;
end $$;

-- Runs one statement as a person; returns OK, or the SQLSTATE and the sentence a person would read.
create or replace function pg_temp.refusal_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  perform pg_temp.as_(p_subject);
  begin execute p_sql; v_state := 'OK'; exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  perform pg_temp.off();
  return v_state || coalesce(': ' || v_msg, '');
end $$;

create or replace function pg_temp.json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_(p_subject);
  execute p_sql into v;
  perform pg_temp.off();
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

-- How many capabilities a person holds at a team or club, by key -- the custom-role checks compare these.
create or replace function pg_temp.can_as(p_subject uuid, p_key text, p_scope text, p_club uuid, p_team uuid) returns boolean
language plpgsql as $$
declare v boolean;
begin
  perform pg_temp.as_(p_subject);
  v := internal.can(p_key, p_scope, p_club, p_team, null);
  perform pg_temp.off();
  return v;
end $$;

-- =====================================================================================================
-- SEED: one club with two teams, a second club, and the people the matrix needs.
-- =====================================================================================================
do $$
declare
  v_u uuid := gen_random_uuid();
  v_tag text := substr(v_u::text, 1, 8);
  v_dir uuid; v_club uuid; v_fdir uuid; v_far uuid; v_t1 uuid; v_t2 uuid; v_ft uuid;
  v_m uuid; v_child uuid; v_adultp uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('People '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','people-'||v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'people-'||v_tag,'active') returning id into v_club;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('People Far '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','people-far-'||v_tag) returning id into v_fdir;
  insert into public.clubs (directory_id, slug, status) values (v_fdir,'people-far-'||v_tag,'active') returning id into v_far;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club,'Women''s 1st Team','people-w1-'||v_tag,'senior',null,'womens','union',true) returning id into v_t1;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club,'Under 12 Boys','people-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_t2;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_far,'Men''s 1st Team','people-far1-'||v_tag,'senior',null,'mens','union',true) returning id into v_ft;
  perform pg_temp.put('club', v_club); perform pg_temp.put('far', v_far);
  perform pg_temp.put('t1', v_t1); perform pg_temp.put('t2', v_t2); perform pg_temp.put('ft', v_ft);
  perform pg_temp.put('tag', v_u);

  perform pg_temp.put('ca',     pg_temp.person('Admin',   'p-ca-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('fs',     pg_temp.person('Fixtures','p-fs-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('mb',     pg_temp.person('Member',  'p-mb-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('ta',     pg_temp.person('TeamAdmin','p-ta-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('tm',     pg_temp.person('Manager', 'p-tm-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('coach',  pg_temp.person('Coach',   'p-co-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('player', pg_temp.person('Playing', 'p-pl-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('gone',   pg_temp.person('Paused',  'p-gone-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('farca',  pg_temp.person('FarAdmin','p-farca-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('new1',   pg_temp.person('NewOne',  'p-new1-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('new2',   pg_temp.person('NewTwo',  'p-new2-'||v_tag||'@ovalball.test'));
  perform pg_temp.put('waiter', pg_temp.person('Waiting', 'p-wait-'||v_tag||'@ovalball.test'));

  perform pg_temp.put('m_ca', pg_temp.member(v_club, pg_temp.id('ca'), 'CLUB_ADMIN'));
  perform pg_temp.put('m_fs', pg_temp.member(v_club, pg_temp.id('fs'), 'FIXTURE_SECRETARY'));
  perform pg_temp.put('m_mb', pg_temp.member(v_club, pg_temp.id('mb')));
  perform pg_temp.put('m_ta', pg_temp.member(v_club, pg_temp.id('ta')));
  perform pg_temp.put('m_tm', pg_temp.member(v_club, pg_temp.id('tm')));
  perform pg_temp.put('m_coach', pg_temp.member(v_club, pg_temp.id('coach')));
  perform pg_temp.put('m_player', pg_temp.member(v_club, pg_temp.id('player')));
  perform pg_temp.put('m_gone', pg_temp.member(v_club, pg_temp.id('gone')));
  perform pg_temp.put('m_farca', pg_temp.member(v_far, pg_temp.id('farca'), 'CLUB_ADMIN'));

  perform internal.grant_role(pg_temp.id('m_ta'), 'COACH', v_t1, 'LEGACY_BACKFILL', 'people seed');
  perform internal.grant_role(pg_temp.id('m_ta'), 'TEAM_ADMINISTRATION', v_t1, 'LEGACY_BACKFILL', 'people seed');
  perform internal.grant_role(pg_temp.id('m_tm'), 'TEAM_MANAGER', v_t1, 'LEGACY_BACKFILL', 'people seed');
  perform internal.grant_role(pg_temp.id('m_coach'), 'COACH', v_t1, 'LEGACY_BACKFILL', 'people seed');

  -- A child on the Under 12s, and an adult player whose own account is a member.
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
  values ('Harry', 'Peoplechild', internal.date_of_birth_in_age_grade('union', 'U12'), true, 'MALE') returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_t2, 'active');
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway, user_id)
  values ('People', 'Playing', (current_date - interval '35 years')::date, true, 'FEMALE', pg_temp.id('player')) returning id into v_adultp;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_adultp, v_t1, 'active');
  perform pg_temp.put('child', v_child); perform pg_temp.put('adultp', v_adultp);

  -- Somebody who has asked to join (an open request opens a PENDING membership).
  insert into public.club_join_requests (club_id, requesting_user_id, requested_role, status)
  values (v_club, pg_temp.id('waiter'), 'BASIC_USER', 'pending');

  -- One deactivated member, deactivated the canonical way.
  perform pg_temp.as_(pg_temp.id('ca'));
  perform public.transition_club_membership(pg_temp.id('m_gone'), 'SUSPENDED', 'people suite: deactivate', false);
  perform pg_temp.off();
end $$;

-- =====================================================================================================
-- T. TITLES DESCRIBE, NEVER GRANT
-- =====================================================================================================
do $$
declare v_fa uuid; v_vol uuid; v_state text;
begin
  -- A write and the check of its effect are separate statements throughout: within one boolean
  -- expression SQL may evaluate the check before the write.
  perform pg_temp.check(internal.descriptive_title_ok('Treasurer') and internal.descriptive_title_ok('Physio')
                        and internal.descriptive_title_ok('Strength & Conditioning Coach') and internal.descriptive_title_ok(null),
    'T1 a description is a title: Treasurer, Physio, Strength & Conditioning Coach');
  perform pg_temp.check(not internal.descriptive_title_ok('Club Admin') and not internal.descriptive_title_ok('  club   ADMINISTRATOR ')
                        and not internal.descriptive_title_ok('Coach') and not internal.descriptive_title_ok('Welfare Officer')
                        and not internal.descriptive_title_ok('Site Admin') and not internal.descriptive_title_ok('Team Safeguarding Lead'),
    'T2 the name of a governed role, of administration or of safeguarding is not a title, however it is spaced or cased');

  v_state := pg_temp.try_as(pg_temp.id('ca'), format('select public.set_membership_governance_title(%L, %L)', pg_temp.id('m_mb'), 'Treasurer'));
  perform pg_temp.check(v_state = 'OK' and (select governance_title from public.club_memberships where id = pg_temp.id('m_mb')) = 'Treasurer',
    'T3 a Club Admin gives a member the club title Treasurer');
  v_state := pg_temp.try_as(pg_temp.id('ca'), format('select public.set_membership_governance_title(%L, %L)', pg_temp.id('m_mb'), 'Club Admin'));
  perform pg_temp.check(v_state = '22023' and (select governance_title from public.club_memberships where id = pg_temp.id('m_mb')) = 'Treasurer',
    'T4 but not the title "Club Admin" -- a title can never read as a privilege, and nothing changes');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('mb'), format('select public.set_membership_governance_title(%L, %L)', pg_temp.id('m_mb'), 'Chair')) = '42501',
    'T5 a member cannot title themselves');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('farca'), format('select public.set_membership_governance_title(%L, %L)', pg_temp.id('m_mb'), 'Chair')) = '42501',
    'T6 nor can another club''s Club Admin, naming this membership''s id');

  -- A team title on any team role.
  v_fa := internal.grant_role(pg_temp.id('m_mb'), 'FIRST_AIDER', pg_temp.id('t1'), 'LEGACY_BACKFILL', 'people seed');
  perform pg_temp.put('fa_mb', v_fa);
  v_state := pg_temp.try_as(pg_temp.id('ca'), format('select public.set_team_role_title(%L, %L)', v_fa, 'Physio'));
  perform pg_temp.check(v_state = 'OK' and (select attributes->>'staff_title' from public.role_assignments where id = v_fa) = 'Physio',
    'T7 a First Aider can be described as the team''s Physio');
  v_state := pg_temp.try_as(pg_temp.id('ca'), format('select public.set_team_role_title(%L, %L)',
                (select id from public.role_assignments where membership_id = pg_temp.id('m_coach') and role_key = 'COACH'), 'head coach'));
  perform pg_temp.check(v_state = 'OK' and (select attributes->>'staff_title' from public.role_assignments
                                             where membership_id = pg_temp.id('m_coach') and role_key = 'COACH') = 'HEAD_COACH',
    'T8 "head coach" typed on a Coach is the Coach role''s own HEAD_COACH title, one spelling');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('ca'), format('select public.set_team_role_title(%L, %L)',
                          (select id from public.role_assignments where membership_id = pg_temp.id('m_tm') and role_key = 'TEAM_MANAGER'), 'Head Coach')) = '23514',
    'T9 a coaching title stays on a Coach role');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('ca'), format('select public.set_team_role_title(%L, %L)', v_fa, 'Team Manager')) = '22023'
                        and pg_temp.try_as(pg_temp.id('ca'), format('select public.set_team_role_title(%L, %L)', v_fa, repeat('x', 61))) = '22023',
    'T10 a role''s name, or more than 60 characters, is refused as a team title');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('coach'), format('select public.set_team_role_title(%L, %L)', v_fa, 'Medic')) = '42501',
    'T11 a Coach without Team Admin cannot describe somebody else''s role');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('ca'), format('select public.set_team_role_title(%L, %L)',
                          (select id from public.role_assignments where membership_id = pg_temp.id('m_ca') and role_key = 'CLUB_ADMIN'), 'Chair')) = '23514',
    'T12 a club-wide role takes no team title (a club description is the person''s club title)');

  -- A custom role grants nothing beyond the role it rests on.
  v_vol := internal.grant_role(pg_temp.id('m_player'), 'VOLUNTEER', pg_temp.id('t1'), 'LEGACY_BACKFILL', 'people seed');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('ca'), format('select public.set_team_role_title(%L, %L)', v_vol, 'Strength & Conditioning Coach')) = 'OK',
    'T13 a custom team role: a Volunteer at Women''s 1st described as Strength & Conditioning Coach');
  perform pg_temp.check(not pg_temp.can_as(pg_temp.id('player'), 'team.roster.manage', 'team', pg_temp.id('club'), pg_temp.id('t1'))
                        and not pg_temp.can_as(pg_temp.id('player'), 'team.join_code.manage', 'team', pg_temp.id('club'), pg_temp.id('t1'))
                        and not pg_temp.can_as(pg_temp.id('player'), 'people.member.view', 'club', pg_temp.id('club'), null),
    'T14 and it gives them no roster, joining-code or people authority -- the title is a word');
  perform pg_temp.check(not pg_temp.can_as(pg_temp.id('mb'), 'people.member.view', 'club', pg_temp.id('club'), null)
                        and not pg_temp.can_as(pg_temp.id('mb'), 'people.invitation.create', 'club', pg_temp.id('club'), null),
    'T15 a club title ("Treasurer") gives no club authority either');
end $$;

-- =====================================================================================================
-- V. A TEAM ADMIN MAY GIVE VOLUNTEER AT THEIR OWN TEAM -- and nothing more
-- =====================================================================================================
do $$
declare v_state text;
begin
  v_state := pg_temp.try_as(pg_temp.id('ta'), format('select public.assign_role(%L, %L, %L, null)', pg_temp.id('m_tm'), 'VOLUNTEER', pg_temp.id('t1')));
  perform pg_temp.check(v_state = 'OK'
                        and exists (select 1 from public.role_assignments where membership_id = pg_temp.id('m_tm') and role_key = 'VOLUNTEER'
                                       and team_id = pg_temp.id('t1') and state = 'ACTIVE' and source = 'TEAM_ADMIN_ASSIGNMENT'),
    'V1 a Team Admin gives Volunteer at their own team, recorded as a Team Admin assignment');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('ta'), format('select public.assign_role(%L, %L, null, null)', pg_temp.id('m_coach'), 'VOLUNTEER')) = '42501',
    'V2 but not club-wide');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('ta'), format('select public.assign_role(%L, %L, %L, null)', pg_temp.id('m_coach'), 'VOLUNTEER', pg_temp.id('t2'))) = '42501',
    'V3 nor at a team they do not administer');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('ta'), format('select public.assign_role(%L, %L, %L, null)', pg_temp.id('m_ta'), 'VOLUNTEER', pg_temp.id('t1'))) = '42501',
    'V4 nor to themselves');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('ta'), format('select public.assign_role(%L, %L, null, null)', pg_temp.id('m_ta'), 'CLUB_ADMIN')) = '42501'
                        and pg_temp.try_as(pg_temp.id('ta'), format('select public.set_primary_club_role(%L, %L, %L)', pg_temp.id('m_ta'), 'CLUB_ADMIN', 'escalate')) = '42501',
    'V5 SELF-ESCALATION: a Team Admin cannot make themselves Club Admin by either door');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('tm'), format('select public.assign_role(%L, %L, %L, null)', pg_temp.id('m_coach'), 'VOLUNTEER', pg_temp.id('t1'))) = '42501'
                        and pg_temp.try_as(pg_temp.id('tm'), format('select public.set_primary_club_role(%L, %L, %L)', pg_temp.id('m_tm'), 'CLUB_ADMIN', 'escalate')) = '42501',
    'V6 a Team Manager without Team Admin gives nothing, and cannot grant themselves Club Admin');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('coach'), format('select public.set_primary_club_role(%L, %L, %L)', pg_temp.id('m_mb'), 'FIXTURE_SECRETARY', 'promote')) = '42501'
                        and pg_temp.try_as(pg_temp.id('coach'), format('select public.assign_role(%L, %L, null, null)', pg_temp.id('m_mb'), 'FIXTURES_SECRETARY')) = '42501',
    'V7 a Coach cannot make anybody Fixture Secretary');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('farca'), format('select public.assign_role(%L, %L, %L, null)', pg_temp.id('m_mb'), 'COACH', pg_temp.id('t1'))) = '42501'
                        and pg_temp.try_as(pg_temp.id('farca'), format('select public.set_primary_club_role(%L, %L, %L)', pg_temp.id('m_mb'), 'CLUB_ADMIN', 'cross club')) = '42501',
    'V8 CROSS-CLUB: another club''s Club Admin cannot give a role here by naming the membership');
end $$;

-- =====================================================================================================
-- I. ONE ENGINE, ONE SHAPE
-- =====================================================================================================
do $$
declare v record; v_out jsonb; v_tag text := substr(pg_temp.id('tag')::text, 1, 8);
begin
  -- Team Staff's invitation: a Women's 1st First Aider described as Physio and a Volunteer described as Kit Manager.
  perform pg_temp.as_(pg_temp.id('ca'));
  select * into v from public.issue_invitation('CLUB_STAFF', pg_temp.id('club'), null, null, null, null, 'p-new1-'||v_tag||'@ovalball.test',
    jsonb_build_object('roles', jsonb_build_array('MEMBER'), 'declared_role', 'Matchday helper', 'invitee_name', ' Emma   Taylor '),
    null, null,
    jsonb_build_array(jsonb_build_object('id', pg_temp.id('t1'), 'roles', jsonb_build_array('FIRST_AIDER', 'VOLUNTEER'),
                                         'titles', jsonb_build_object('FIRST_AIDER', 'Physio', 'VOLUNTEER', 'Kit Manager'))));
  perform pg_temp.off();
  perform pg_temp.put('inv_new1', v.invitation_id);
  create temp table if not exists secrets (k text primary key, token text) on commit drop;
  insert into secrets values ('new1', v.token);
  select intended_outcome into v_out from public.access_invitations where id = v.invitation_id;
  perform pg_temp.check((select kind from public.access_invitations where id = v.invitation_id) = 'CLUB_STAFF'
                        and v_out->'club_roles' = '["MEMBER"]'::jsonb
                        and (v_out->'teams'->0->'roles') = '["FIRST_AIDER", "VOLUNTEER"]'::jsonb
                        and (v_out->'teams'->0->'titles') = '{"FIRST_AIDER": "Physio", "VOLUNTEER": "Kit Manager"}'::jsonb,
    'I1 the Team Staff invitation is the same CLUB_STAFF invitation People issues, carrying Member, First Aider and a team Volunteer with their titles');
  perform pg_temp.check(v_out->>'invitee_name' = 'Emma Taylor' and v_out->>'declared_role' = 'Matchday helper',
    'I2 and the name and the person''s own role at the club, tidied');

  perform pg_temp.check(pg_temp.try_as(pg_temp.id('ca'), format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb)',
      pg_temp.id('club'), 'two-seats-'||v_tag||'@ovalball.test', '{"roles":["CLUB_ADMIN","MEMBER"]}')) = '22023',
    'I3 club access is one seat: Club Admin and Member together are refused');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('ca'), format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb, null, null, %L::jsonb)',
      pg_temp.id('club'), 'ta-'||v_tag||'@ovalball.test', '{}', jsonb_build_array(jsonb_build_object('id', pg_temp.id('t1'), 'roles', jsonb_build_array('TEAM_ADMINISTRATION'))))) = '42501',
    'I4 CEILING: Team Administration is still not something an invitation carries');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('ca'), format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb, null, null, %L::jsonb)',
      pg_temp.id('club'), 'title-'||v_tag||'@ovalball.test', '{}',
      jsonb_build_array(jsonb_build_object('id', pg_temp.id('t1'), 'roles', jsonb_build_array('COACH'), 'titles', jsonb_build_object('TEAM_MANAGER', 'Kit Manager'))))) = '22023'
    and pg_temp.try_as(pg_temp.id('ca'), format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb, null, null, %L::jsonb)',
      pg_temp.id('club'), 'title2-'||v_tag||'@ovalball.test', '{}',
      jsonb_build_array(jsonb_build_object('id', pg_temp.id('t1'), 'roles', jsonb_build_array('VOLUNTEER'), 'titles', jsonb_build_object('VOLUNTEER', 'Club Admin'))))) = '22023'
    and pg_temp.try_as(pg_temp.id('ca'), format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb, null, null, %L::jsonb)',
      pg_temp.id('club'), 'title3-'||v_tag||'@ovalball.test', '{}',
      jsonb_build_array(jsonb_build_object('id', pg_temp.id('t1'), 'roles', jsonb_build_array('TEAM_MANAGER'), 'titles', jsonb_build_object('TEAM_MANAGER', 'HEAD_COACH'))))) = '22023',
    'I5 a title on a role the invitation does not carry, a privilege''s name as a title, and a coaching title off a Coach are refused');
  perform pg_temp.check(pg_temp.refusal_as(pg_temp.id('ca'), format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb, null, null, %L::jsonb)',
      pg_temp.id('club'), 'title4-'||v_tag||'@ovalball.test', '{}',
      jsonb_build_array(jsonb_build_object('id', pg_temp.id('t1'), 'roles', jsonb_build_array('VOLUNTEER'), 'titles', jsonb_build_object('VOLUNTEER', 'Safeguarding Lead')))))
        = '22023: "Safeguarding Lead" is reserved for a role that carries access, so it cannot be used as a custom role. Choose that role instead.'
    and pg_temp.refusal_as(pg_temp.id('ca'), format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb)',
      pg_temp.id('club'), 'declared-'||v_tag||'@ovalball.test', '{"roles":["MEMBER"],"declared_role":"Team Manager"}'))
        = '22023: "Team Manager" is reserved for a role that carries access, so it cannot be their role at the club. Choose that role instead.'
    and not exists (select 1 from public.access_invitations where invited_email_normalised in ('title4-'||v_tag||'@ovalball.test', 'declared-'||v_tag||'@ovalball.test')),
    'I5b the refusal names the words -- a custom role called Safeguarding Lead, "Team Manager" typed as their role at the club -- and issues nothing');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('tm'), format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb)',
      pg_temp.id('club'), 'x-'||v_tag||'@ovalball.test', '{"roles":["VOLUNTEER"]}')) = '42501'
    and pg_temp.try_as(pg_temp.id('ta'), format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb)',
      pg_temp.id('club'), 'y-'||v_tag||'@ovalball.test', '{"roles":["CLUB_ADMIN"]}')) = '42501'
    and pg_temp.try_as(pg_temp.id('coach'), format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb)',
      pg_temp.id('club'), 'z-'||v_tag||'@ovalball.test', '{"roles":["FIXTURES_SECRETARY"]}')) = '42501',
    'I6 a Team Manager, a Team Admin and a Coach cannot issue a staff invitation -- least of all for Club Admin or Fixture Secretary');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('farca'), format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb)',
      pg_temp.id('club'), 'far-'||v_tag||'@ovalball.test', '{"roles":["CLUB_ADMIN"]}')) = '42501'
    and pg_temp.try_as(pg_temp.id('farca'), format('select * from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, %L, %L::jsonb, null, null, %L::jsonb)',
      pg_temp.id('far'), 'far2-'||v_tag||'@ovalball.test', '{}',
      jsonb_build_array(jsonb_build_object('id', pg_temp.id('t1'), 'roles', jsonb_build_array('COACH'))))) = '42501',
    'I7 CROSS-CLUB: another club''s Club Admin cannot invite to this club, nor name this club''s team in their own invitation');

  -- A personal invitation to a player: a single-use team code with a name, and nothing else a caller sends.
  perform pg_temp.as_(pg_temp.id('tm'));
  select * into v from public.issue_invitation('TEAM_JOIN_CODE', null, pg_temp.id('t1'), null, null, null, null,
    jsonb_build_object('invitee_name', 'Sam Player', 'roles', jsonb_build_array('CLUB_ADMIN'), 'audience', 'ADMIN'), 1);
  perform pg_temp.off();
  perform pg_temp.put('inv_player', v.invitation_id);
  select intended_outcome into v_out from public.access_invitations where id = v.invitation_id;
  perform pg_temp.check(v_out = '{"invitee_name": "Sam Player", "audience": "PLAYER"}'::jsonb
                        and (select max_uses from public.access_invitations where id = v.invitation_id) = 1,
    'I8 a Team Manager''s personal invitation to a player keeps the name and drops everything else the caller sent');
end $$;

-- =====================================================================================================
-- R. ACCEPTING IT
-- =====================================================================================================
do $$
declare v record; v_res jsonb; v_mid uuid; v_tag text := substr(pg_temp.id('tag')::text, 1, 8); v_before uuid;
begin
  v_res := pg_temp.json_as(pg_temp.id('new1'), format('select public.redeem_invitation(%L, null)', (select token from secrets where k = 'new1')));
  v_mid := (v_res->>'membership_id')::uuid;
  perform pg_temp.check(v_res->>'outcome' = 'MEMBERSHIP_ACTIVE'
                        and (select source from public.club_memberships where id = v_mid) = 'INVITATION'
                        and (select source_invitation_id from public.club_memberships where id = v_mid) = pg_temp.id('inv_new1'),
    'R1 ONE ADMISSION PATH: the membership records INVITATION and the invitation it came from');
  perform pg_temp.check(exists (select 1 from public.role_assignments where membership_id = v_mid and role_key = 'FIRST_AIDER'
                                   and team_id = pg_temp.id('t1') and state = 'ACTIVE' and attributes->>'staff_title' = 'Physio')
                        and exists (select 1 from public.role_assignments where membership_id = v_mid and role_key = 'VOLUNTEER'
                                       and team_id = pg_temp.id('t1') and state = 'ACTIVE' and attributes->>'staff_title' = 'Kit Manager'),
    'R2 they are Women''s 1st''s Physio (First Aider) and Kit Manager (Volunteer)');
  perform pg_temp.check(not exists (select 1 from public.role_assignments where membership_id = v_mid and role_key = 'VOLUNTEER' and team_id is null),
    'R3 and a team Volunteer is NOT also made a club-wide Volunteer');
  perform pg_temp.check((select governance_title from public.club_memberships where id = v_mid) = 'Matchday helper'
                        and exists (select 1 from public.role_assignments where membership_id = v_mid and role_key = 'MEMBER' and state = 'ACTIVE'),
    'R4 their own words become their club title, and their access is Member');

  -- Somebody who asked to join, then was invited: one membership, approved -- not a unique-index failure.
  select id into v_before from public.club_memberships where club_id = pg_temp.id('club') and user_id = pg_temp.id('waiter') and state = 'PENDING';
  perform pg_temp.as_(pg_temp.id('ca'));
  select * into v from public.issue_invitation('CLUB_STAFF', pg_temp.id('club'), null, null, null, null, 'p-wait-'||v_tag||'@ovalball.test',
    '{"roles":["VOLUNTEER"]}'::jsonb);
  perform pg_temp.off();
  v_res := pg_temp.json_as(pg_temp.id('waiter'), format('select public.redeem_invitation(%L, null)', v.token));
  perform pg_temp.check(v_before is not null and v_res->>'outcome' = 'MEMBERSHIP_ACTIVE' and (v_res->>'membership_id')::uuid = v_before
                        and (select state from public.club_memberships where id = v_before) = 'ACTIVE'
                        and (select count(*) from public.club_memberships where club_id = pg_temp.id('club') and user_id = pg_temp.id('waiter')) = 1,
    'R5 a person who had asked to join accepts on their waiting membership -- one row, now active');

  -- A deactivated membership is refused, and the invitation is not spent.
  perform pg_temp.as_(pg_temp.id('ca'));
  select * into v from public.issue_invitation('CLUB_STAFF', pg_temp.id('club'), null, null, null, null, 'p-gone-'||v_tag||'@ovalball.test',
    '{"roles":["VOLUNTEER"]}'::jsonb);
  perform pg_temp.off();
  v_res := pg_temp.json_as(pg_temp.id('gone'), format('select public.redeem_invitation(%L, null)', v.token));
  perform pg_temp.check(v_res->>'outcome' = 'REFUSED' and v_res->>'reason' = 'ORGANISATION_ACCESS_SUSPENDED'
                        and (select state from public.access_invitations where id = v.invitation_id) = 'ISSUED'
                        and (select use_count from public.access_invitations where id = v.invitation_id) = 0
                        and (select state from public.club_memberships where id = pg_temp.id('m_gone')) = 'SUSPENDED',
    'R6 a deactivated member is refused in words, stays deactivated, and the invitation is left usable');
  insert into secrets values ('gone', v.token);

  -- Access is raised, never lowered.
  perform pg_temp.as_(pg_temp.id('ca'));
  select * into v from public.issue_invitation('CLUB_STAFF', pg_temp.id('club'), null, null, null, null, 'p-fs-'||v_tag||'@ovalball.test',
    '{"roles":["MEMBER"]}'::jsonb, null, null, jsonb_build_array(jsonb_build_object('id', pg_temp.id('t2'), 'roles', jsonb_build_array('COACH'))));
  perform pg_temp.off();
  v_res := pg_temp.json_as(pg_temp.id('fs'), format('select public.redeem_invitation(%L, null)', v.token));
  perform pg_temp.check(v_res->>'outcome' = 'MEMBERSHIP_ACTIVE' and (v_res->>'membership_id')::uuid = pg_temp.id('m_fs')
                        and exists (select 1 from public.role_assignments where membership_id = pg_temp.id('m_fs') and role_key = 'FIXTURES_SECRETARY' and state = 'ACTIVE')
                        and not exists (select 1 from public.role_assignments where membership_id = pg_temp.id('m_fs') and role_key = 'MEMBER' and state = 'ACTIVE')
                        and exists (select 1 from public.role_assignments where membership_id = pg_temp.id('m_fs') and role_key = 'COACH' and team_id = pg_temp.id('t2') and state = 'ACTIVE'),
    'R7 an existing Fixture Secretary invited as Member keeps Fixture Secretary (and is on their existing row) and gains the team role');
  perform pg_temp.as_(pg_temp.id('ca'));
  select * into v from public.issue_invitation('CLUB_STAFF', pg_temp.id('club'), null, null, null, null, 'p-mb-'||v_tag||'@ovalball.test',
    '{"roles":["FIXTURES_SECRETARY"]}'::jsonb);
  perform pg_temp.off();
  v_res := pg_temp.json_as(pg_temp.id('mb'), format('select public.redeem_invitation(%L, null)', v.token));
  perform pg_temp.check(v_res->>'outcome' = 'MEMBERSHIP_ACTIVE'
                        and exists (select 1 from public.role_assignments where membership_id = pg_temp.id('m_mb') and role_key = 'FIXTURES_SECRETARY' and state = 'ACTIVE')
                        and not exists (select 1 from public.role_assignments where membership_id = pg_temp.id('m_mb') and role_key = 'MEMBER' and state = 'ACTIVE')
                        and (select count(*) from public.role_assignments ra join public.role_definitions rd on rd.role_key = ra.role_key
                              where ra.membership_id = pg_temp.id('m_mb') and ra.state = 'ACTIVE' and rd.is_primary_seat) = 1,
    'R8 a Member invited as Fixture Secretary is raised to it, holding exactly one seat');

  -- An invitation stored before club roles were stored apart still does what it said.
  perform pg_temp.as_(pg_temp.id('ca'));
  select * into v from public.issue_invitation('CLUB_STAFF', pg_temp.id('club'), null, null, null, null, 'p-new2-'||v_tag||'@ovalball.test',
    '{"roles":["VOLUNTEER"]}'::jsonb);
  perform pg_temp.off();
  update public.access_invitations set intended_outcome = intended_outcome - 'club_roles' where id = v.invitation_id;
  v_res := pg_temp.json_as(pg_temp.id('new2'), format('select public.redeem_invitation(%L, null)', v.token));
  perform pg_temp.check(v_res->>'outcome' = 'MEMBERSHIP_ACTIVE'
                        and exists (select 1 from public.role_assignments where membership_id = (v_res->>'membership_id')::uuid
                                       and role_key = 'VOLUNTEER' and team_id is null and state = 'ACTIVE'),
    'R9 an invitation issued before this change (no stored club roles) still makes a club-wide Volunteer');
  perform pg_temp.put('m_new2', (v_res->>'membership_id')::uuid);

  -- Revoked and expired fail.
  perform pg_temp.as_(pg_temp.id('ca'));
  select * into v from public.issue_invitation('CLUB_STAFF', pg_temp.id('club'), null, null, null, null, 'p-new2-'||v_tag||'@ovalball.test', '{"roles":["COACH"]}'::jsonb,
    null, array[pg_temp.id('t1')]);
  perform public.revoke_invitation(v.invitation_id, 'people suite: revoked');
  perform pg_temp.off();
  perform pg_temp.check((pg_temp.json_as(pg_temp.id('new2'), format('select public.redeem_invitation(%L, null)', v.token)))->>'outcome' = 'REFUSED',
    'R10 a revoked invitation fails');
  perform pg_temp.as_(pg_temp.id('ca'));
  select * into v from public.issue_invitation('CLUB_STAFF', pg_temp.id('club'), null, null, null, null, 'p-new2-'||v_tag||'@ovalball.test', '{"roles":["COACH"]}'::jsonb,
    null, array[pg_temp.id('t2')]);
  perform pg_temp.off();
  update public.access_invitations set expires_at = now() - interval '1 minute' where id = v.invitation_id;
  perform pg_temp.check((pg_temp.json_as(pg_temp.id('new2'), format('select public.redeem_invitation(%L, null)', v.token)))->>'outcome' = 'REFUSED'
                        and not exists (select 1 from public.role_assignments where membership_id = pg_temp.id('m_new2') and role_key = 'COACH'),
    'R11 an expired invitation fails and grants nothing');
end $$;

-- =====================================================================================================
-- P. ONE REGISTER
-- =====================================================================================================
do $$
declare v_n int; v_row record;
begin
  perform pg_temp.as_(pg_temp.id('ca'));
  perform pg_temp.check(exists (select 1 from public.club_people(pg_temp.id('club'), null, 'all', 200) p
                                 where p.kind = 'player' and p.player_id = pg_temp.id('child')
                                   and p.player_teams->0->>'team_display_name' = 'Under 12 Boys'),
    'P1 a child on the Under 12s is in the club''s register for the Club Admin');
  select count(*) into v_n from public.club_people(pg_temp.id('club'), null, 'all', 200) p
   where p.player_id = pg_temp.id('adultp') or p.user_id = pg_temp.id('player');
  perform pg_temp.check(v_n = 1 and exists (select 1 from public.club_people(pg_temp.id('club'), null, 'players', 200) p
                                               where p.kind = 'member' and p.user_id = pg_temp.id('player') and p.player_id = pg_temp.id('adultp')),
    'P2 an adult who plays and is a member is ONE row -- the member''s -- and is among the Players');
  perform pg_temp.check(exists (select 1 from public.club_people(pg_temp.id('club'), null, 'all', 200) p, jsonb_array_elements(p.team_roles) tr
                                 where p.membership_id = pg_temp.id('m_mb') and tr->>'role_key' = 'FIRST_AIDER' and tr->>'title' = 'Physio'),
    'P3 a First Aider''s role and title are on their row (they used to be invisible here)');
  perform pg_temp.check(exists (select 1 from public.club_people(pg_temp.id('club'), null, 'admins', 200) p where p.membership_id = pg_temp.id('m_ca') and p.access = 'CLUB_ADMIN')
                        and not exists (select 1 from public.club_people(pg_temp.id('club'), null, 'admins', 200) p where p.membership_id = pg_temp.id('m_coach')),
    'P4 Admins holds the Club Admin and not a Coach');
  perform pg_temp.check(exists (select 1 from public.club_people(pg_temp.id('club'), null, 'deactivated', 200) p where p.membership_id = pg_temp.id('m_gone'))
                        and not exists (select 1 from public.club_people(pg_temp.id('club'), null, 'all', 200) p where p.membership_id = pg_temp.id('m_gone'))
                        and exists (select 1 from public.club_people(pg_temp.id('club'), 'Paused', 'all', 200) p where p.membership_id = pg_temp.id('m_gone') and p.state = 'SUSPENDED')
                        and exists (select 1 from public.club_people(pg_temp.id('club'), null, 'suspended', 200) p where p.membership_id = pg_temp.id('m_gone')),
    'P5 deactivated is a state: not mixed into All, its own view, found by a search, and the old word still answers');
  select * into v_row from public.club_people(pg_temp.id('club'), null, 'pending', 200) p where p.invitation_id = pg_temp.id('inv_player');
  perform pg_temp.check(v_row.invitation_kind = 'TEAM_JOIN_CODE' and v_row.invitation_name = 'Sam Player'
                        and v_row.invitation_offer->'teams'->0->>'team_display_name' = 'Women''s 1st Team' and v_row.invited_by_name is not null,
    'P6 a personal invitation to a player waits in Pending with its name, its team and who sent it');
  perform pg_temp.check((select count(*) from public.club_people(pg_temp.id('club'), null, 'all', 200, 0, null, 'COACH') p) = 3
                        and exists (select 1 from public.club_people(pg_temp.id('club'), null, 'all', 200, 0, null, null, 'physio') p where p.membership_id = pg_temp.id('m_mb')),
    'P7 a role (Coach: three people) and a title (Physio) narrow the register -- what Access Control opens');
  perform pg_temp.off();

  -- A Fixture Secretary reads the members, not the players.
  perform pg_temp.as_(pg_temp.id('fs'));
  perform pg_temp.check(not exists (select 1 from public.club_people(pg_temp.id('club'), null, 'all', 200) p where p.kind = 'player' or p.player_id is not null)
                        and not exists (select 1 from public.club_people(pg_temp.id('club'), null, 'pending', 200) p where p.invitation_kind = 'TEAM_JOIN_CODE')
                        and exists (select 1 from public.club_people(pg_temp.id('club'), null, 'all', 200) p where p.membership_id = pg_temp.id('m_ca')),
    'P8 a Fixture Secretary sees the members and no player, no player''s team and no invitation to a player');
  perform pg_temp.off();
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('farca'), format('select * from public.club_people(%L)', pg_temp.id('club'))) = '42501'
                        and pg_temp.try_as(pg_temp.id('tm'), format('select * from public.club_people(%L)', pg_temp.id('club'))) = '42501',
    'P9 another club''s Club Admin and a Team Manager cannot read the register');
end $$;

-- =====================================================================================================
-- S. SUMMARY, CANDIDATES, PICKERS, PREVIEW
-- =====================================================================================================
do $$
declare v_n bigint; v record; v_tag text := substr(pg_temp.id('tag')::text, 1, 8); v_p record;
begin
  perform pg_temp.as_(pg_temp.id('ca'));
  perform pg_temp.check((select people from public.club_access_summary(pg_temp.id('club')) where section = 'club_access' and item_key = 'CLUB_ADMIN') = 1
                        and (select people from public.club_access_summary(pg_temp.id('club')) where section = 'club_access' and item_key = 'FIXTURES_SECRETARY') = 2
                        and (select people from public.club_access_summary(pg_temp.id('club')) where section = 'team_role' and item_key = 'COACH') = 3
                        and (select people from public.club_access_summary(pg_temp.id('club')) where section = 'team_role' and item_key = 'FIRST_AIDER') = 2
                        and (select people from public.club_access_summary(pg_temp.id('club')) where section = 'team_title' and lower(item_key) = 'physio') = 2
                        and (select people from public.club_access_summary(pg_temp.id('club')) where section = 'club_title' and item_key = 'Treasurer') = 1
                        and (select people from public.club_access_summary(pg_temp.id('club')) where section = 'state' and item_key = 'DEACTIVATED') = 1
                        and (select people from public.club_access_summary(pg_temp.id('club')) where section = 'state' and item_key = 'PENDING_INVITATIONS') >= 2
                        and (select people from public.club_access_summary(pg_temp.id('club')) where section = 'club_access' and item_key = 'SAFEGUARDING_OFFICER') = 0,
    'S1 Access Control''s counts: each level of club access, each team role and title, deactivated and pending -- and nought where nobody holds it');
  perform pg_temp.off();
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('coach'), format('select * from public.club_access_summary(%L)', pg_temp.id('club'))) = '42501'
                        and pg_temp.try_as(pg_temp.id('farca'), format('select * from public.club_access_summary(%L)', pg_temp.id('club'))) = '42501',
    'S2 a Coach and another club''s Club Admin read no summary');

  perform pg_temp.as_(pg_temp.id('ta'));
  select count(*) into v_n from public.team_staff_candidates(pg_temp.id('t1'), 'Member');
  perform pg_temp.check(v_n >= 1 and exists (select 1 from public.team_staff_candidates(pg_temp.id('t1'), null, 50) c
                                                where c.membership_id = pg_temp.id('m_tm') and c.team_roles @> '[{"role_key":"TEAM_MANAGER"}]'),
    'S3 a Team Admin searches the club''s members for their team''s staff and sees what each already holds there');
  perform pg_temp.off();
  perform pg_temp.check(not exists (select 1 from information_schema.parameters
                                         where specific_schema = 'public' and specific_name like 'team_staff_candidates%' and parameter_mode = 'OUT' and parameter_name ilike '%email%'),
    'S4 and the candidates read carries no contact details');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('coach'), format('select * from public.team_staff_candidates(%L)', pg_temp.id('t1'))) = '42501'
                        and pg_temp.try_as(pg_temp.id('ta'), format('select * from public.team_staff_candidates(%L)', pg_temp.id('t2'))) = '42501'
                        and pg_temp.try_as(pg_temp.id('farca'), format('select * from public.team_staff_candidates(%L)', pg_temp.id('t1'))) = '42501',
    'S5 a Coach without Team Admin, a Team Admin at another team and another club''s Club Admin cannot search');

  perform pg_temp.as_(pg_temp.id('ta'));
  perform pg_temp.check((select array_agg(role_key order by role_key) from public.club_assignable_roles(pg_temp.id('club'), pg_temp.id('t1')))
                          = array['COACH','FIRST_AIDER','TEAM_MANAGER','TEAM_SAFEGUARDING_LEAD','VOLUNTEER'],
    'S6 the team role picker offers a Team Admin exactly what the server lets them give there, never Team Administration');
  perform pg_temp.check(not exists (select 1 from public.club_assignable_roles(pg_temp.id('club'), pg_temp.id('t2'))),
    'S7 and nothing at a team they do not administer');
  perform pg_temp.off();
  perform pg_temp.as_(pg_temp.id('player'));
  perform pg_temp.check(not exists (select 1 from public.club_assignable_roles(pg_temp.id('club'), pg_temp.id('t1')))
                        and not exists (select 1 from public.club_assignable_roles(pg_temp.id('club'))),
    'S8 a member is offered nothing to give, at a team or at the club');
  perform pg_temp.off();
  perform pg_temp.check((select array_agg(role_key order by role_key) from public.invitation_staff_role_options() where allowed_at_team)
                          = array['COACH','FIRST_AIDER','TEAM_MANAGER','TEAM_SAFEGUARDING_LEAD','VOLUNTEER']
                        and exists (select 1 from public.invitation_staff_role_options() where role_key = 'MEMBER' and not allowed_at_team),
    'S9 the staff invitation''s picker is the ceiling, saying which roles may be named at a team');

  -- The preview, for the person holding the link.
  perform pg_temp.as_(pg_temp.id('ca'));
  select * into v from public.issue_invitation('CLUB_STAFF', pg_temp.id('club'), null, null, null, null, 'preview-'||v_tag||'@ovalball.test',
    '{"roles":["MEMBER"],"declared_role":"Under 12s coach"}'::jsonb, null, null,
    jsonb_build_array(jsonb_build_object('id', pg_temp.id('t2'), 'roles', jsonb_build_array('COACH'), 'titles', jsonb_build_object('COACH', 'Assistant Coach'))));
  perform pg_temp.off();
  select * into v_p from public.preview_invitation(v.token, null);
  perform pg_temp.check(v_p.state = 'usable' and v_p.club_name like 'People % RUFC' and v_p.offer->'club_roles' = '["MEMBER"]'::jsonb
                        and v_p.offer->'teams'->0->>'team_display_name' = 'Under 12 Boys'
                        and v_p.offer->'teams'->0->'titles'->>'COACH' = 'ASSISTANT_COACH' and v_p.offer->>'title' = 'Under 12s coach',
    'S10 the preview says which club, and what accepting grants: Member, and Assistant Coach of the Under 12s');
  perform pg_temp.as_(pg_temp.id('ca'));
  perform public.revoke_invitation(v.invitation_id, 'people suite: a withdrawn link');
  perform pg_temp.off();
  select * into v_p from public.preview_invitation(v.token, null);
  perform pg_temp.check(v_p.state = 'revoked' and v_p.offer = '{}'::jsonb and v_p.club_name like 'People % RUFC',
    'S10b a withdrawn link -- a poster still on a noticeboard -- says it no longer works, and no longer what it would have given');
  perform pg_temp.check(not exists (select 1 from information_schema.parameters
                                     where specific_schema = 'public' and specific_name like 'preview_invitation%' and parameter_mode = 'OUT' and parameter_name ilike '%email%')
                        and has_function_privilege('anon', 'public.preview_invitation(text,text)', 'EXECUTE'),
    'S11 still never the email, and still open to somebody holding the link who has no account yet');
  perform pg_temp.check(not has_function_privilege('anon', 'public.club_people(uuid,text,text,integer,integer,uuid,text,text)', 'EXECUTE')
                        and not has_function_privilege('anon', 'public.club_access_summary(uuid)', 'EXECUTE')
                        and not has_function_privilege('anon', 'public.team_staff_candidates(uuid,text,integer)', 'EXECUTE')
                        and has_function_privilege('authenticated', 'public.club_access_summary(uuid)', 'EXECUTE')
                        and not has_function_privilege('authenticated', 'internal.descriptive_title_ok(text)', 'EXECUTE'),
    'S12 the register, the summary and the candidates are for signed-in callers only, and the helpers for nobody');
end $$;

-- =====================================================================================================
-- L. LIFECYCLE
-- =====================================================================================================
do $$
declare v record; v_res jsonb; v_tag text := substr(pg_temp.id('tag')::text, 1, 8); v_state text;
begin
  perform pg_temp.check((select state from public.club_memberships where id = pg_temp.id('m_gone')) = 'SUSPENDED'
                        and exists (select 1 from public.profiles where id = pg_temp.id('gone'))
                        and not exists (select 1 from public.role_assignments where membership_id = pg_temp.id('m_gone') and state = 'ACTIVE')
                        and exists (select 1 from public.role_assignments where membership_id = pg_temp.id('m_gone') and state = 'SUSPENDED')
                        and exists (select 1 from public.security_events where event_type = 'membership.suspended' and club_id = pg_temp.id('club')),
    'L1 DEACTIVATE: the membership is paused, their roles paused with it, the account and the record of it kept');
  perform pg_temp.check(not pg_temp.can_as(pg_temp.id('gone'), 'calendar.event.view', 'club', pg_temp.id('club'), null),
    'L2 and they lose access to the club');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('farca'), format('select public.transition_club_membership(%L, %L, %L, false)', pg_temp.id('m_gone'), 'ACTIVE', 'cross club')) = '42501'
                        and pg_temp.try_as(pg_temp.id('farca'), format('select public.transition_club_membership(%L, %L, %L, false)', pg_temp.id('m_coach'), 'REVOKED', 'cross club')) = '42501',
    'L3 CROSS-CLUB: another club''s Club Admin cannot reactivate or remove a membership here by its id');
  v_state := pg_temp.try_as(pg_temp.id('ca'), format('select public.transition_club_membership(%L, %L, %L, false)', pg_temp.id('m_gone'), 'ACTIVE', 'people suite: reactivate'));
  perform pg_temp.check(v_state = 'OK'
                        and (select state from public.club_memberships where id = pg_temp.id('m_gone')) = 'ACTIVE'
                        and exists (select 1 from public.role_assignments where membership_id = pg_temp.id('m_gone') and state = 'ACTIVE'),
    'L4 REACTIVATE: the same membership comes back with its roles');
  -- Now they can accept the invitation they were refused while deactivated.
  v_res := pg_temp.json_as(pg_temp.id('gone'), format('select public.redeem_invitation(%L, null)', (select token from secrets where k = 'gone')));
  perform pg_temp.check(v_res->>'outcome' = 'MEMBERSHIP_ACTIVE' and (v_res->>'membership_id')::uuid = pg_temp.id('m_gone'),
    'L5 and the invitation left unspent while they were deactivated now works, on their own membership');

  v_state := pg_temp.try_as(pg_temp.id('ca'), format('select public.transition_club_membership(%L, %L, %L, false)', pg_temp.id('m_coach'), 'REVOKED', 'people suite: remove'));
  perform pg_temp.check(v_state = 'OK'
                        and (select state from public.club_memberships where id = pg_temp.id('m_coach')) = 'REVOKED'
                        and not exists (select 1 from public.role_assignments where membership_id = pg_temp.id('m_coach') and state in ('ACTIVE','SUSPENDED'))
                        and exists (select 1 from public.profiles where id = pg_temp.id('coach'))
                        and exists (select 1 from public.role_assignments where membership_id = pg_temp.id('m_coach') and state = 'REVOKED'),
    'L6 REMOVE: the relationship ends and every role with it; the account and the record of what they held remain');
  perform pg_temp.check(pg_temp.try_as(pg_temp.id('ca'), format('select public.transition_club_membership(%L, %L, %L, false)', pg_temp.id('m_coach'), 'ACTIVE', 'undo')) <> 'OK',
    'L7 a removal is not undone by reactivating');
  perform pg_temp.as_(pg_temp.id('ca'));
  select * into v from public.issue_invitation('CLUB_STAFF', pg_temp.id('club'), null, null, null, null, 'p-co-'||v_tag||'@ovalball.test',
    '{"roles":["MEMBER"]}'::jsonb);
  perform pg_temp.off();
  v_res := pg_temp.json_as(pg_temp.id('coach'), format('select public.redeem_invitation(%L, null)', v.token));
  perform pg_temp.check(v_res->>'outcome' = 'MEMBERSHIP_ACTIVE' and (v_res->>'membership_id')::uuid <> pg_temp.id('m_coach')
                        and (select count(*) from public.profiles where id = pg_temp.id('coach')) = 1,
    'L8 invited again, they are admitted on a NEW membership by the same one identity');
end $$;

rollback;
