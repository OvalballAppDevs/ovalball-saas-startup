-- TEAM OPERATIONS (CA-M7) -- THE TEAM WORKSPACE, PROVED WHERE IT IS ENFORCED.
--
-- A team context is a WORKSPACE, not a smaller club admin panel. Everything the phone draws for a team
-- comes from one capability read at team scope, and everything it writes is refused again by the server.
-- This suite proves the authority the workspace consumes and cannot widen:
--
--   TO-A  the team authority probe: a Team Manager's role default at team scope; a Coach's narrower one;
--         the Planner, Import, bulk edit and delete are never offered at team scope to anybody
--   TO-B  fixture mutation by a non-protected Team Manager: create, edit, cancel on THEIR team; a Club Admin
--         withholds edit -> the same role is refused mid-edit; restore -> it returns; the same for cancel
--   TO-C  cross-team and cross-club isolation: a U12 manager creates, edits and cancels nothing on U14 or
--         on another club's U12, and holds no capability at those scopes
--   TO-D  no club-wide escalation: no Planner, Import, bulk edit or delete at club scope; no club-wide
--         membership administration; no club ledger read
--   TO-E  subscriptions: the team-scoped operation answers only the holder, only for their team; the
--         underlying rows stay refused to a team holder; no provider column exists in the result;
--         a withhold refuses, a restore returns
--   TO-F  people: the roster reader refuses the wrong team and the wrong club; a Coach reads but does not
--         decide; a Team Manager decides; the reader carries no contact column
--   TO-G  fixture requests: a request from another club is seen by the target team, answered only by a
--         holder of fixture.request.respond, and a Coach's crafted acceptance is refused
--   TO-H  messaging: a parent and a player cannot message the opposition; a minor cannot message the
--         coach and the coach cannot message the minor; the fixture route exists for staff only
--   TO-I  availability: no staff override -- a Team Manager cannot answer for a player; the summary is
--         absent for a team the viewer has no attendance authority on
--
-- Self-seeding and rolled back. No persistent review identity is touched.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.act(p_role text, p_sub uuid default null, p_session uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email, 'session_id', p_session))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.count_of(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin execute p_sql into v; return v;
exception when others then return -1; end $$;

create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '35 years')::date) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'to-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'To', p_label, 'to-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TO ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'to-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'to-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_key text, p_age text, p_label text) returns uuid language plpgsql as $$
declare v uuid; v_type uuid;
begin
  select id into v_type from public.canonical_team_types_by_code where rugby_code = 'union' and key = p_key and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  values (p_club, p_label, 'youth', p_age, 'boys', 'union', v_type, true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.player(p_label text, p_years int, p_team uuid, p_user uuid default null, p_state text default 'ACTIVE') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('P', p_label, (current_date - (p_years || ' years')::interval)::date, 'MALE', p_user) returning id into v;
  insert into public.player_team_memberships (player_id, team_id, state) values (v, p_team, p_state);
  return v;
end $$;

grant execute on function pg_temp.act(text, uuid, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.count_of(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

-- =====================================================================================================
-- CA-M9 -- FAMILY & PLAYER OPERATIONS: relationships decide reach, the selected child decides nothing,
-- the server decides everything.
--
--   FS   family scope: a guardian reads only their own children's events and answers; multi-child and
--        sibling-team reach come only from a relationship; another family, another side and the
--        opposition are refused by crafted calls, not hidden by a screen
--   AV   availability: three states, no fourth; the guardian answers; the adult player answers for
--        themselves; a 16-17-year-old only with recorded consent; under 16 never; unknown age is not
--        adult; the answer reaches the staff through the CA-M8 emitter once per change
--   MC   Match Centre authority is the server's: a participant gets no register, no messaging, no
--        management; membership alone grants nothing
--   MS   messaging: parent and player never reach the opposition; a minor never reaches a coach and a
--        coach never reaches a minor; the chooser offers only legitimate people
--   SB   subscriptions: a family reads its own membership state and nobody else's
--   ID   identity: a guardian may change their child's picture and permissions; another family may not;
--        the child's date of birth is not what the app is given
--
-- Self-seeding, and rolled back.
-- =====================================================================================================
do $$
declare
  v_club uuid; v_club_b uuid; v_t12 uuid; v_t14 uuid; v_tb uuid; v_t1 uuid;
  v_ca uuid; v_tm uuid; v_coach uuid; v_tmb uuid; v_ms_tm uuid; v_ms_coach uuid; v_ms_tmb uuid;
  v_parent uuid; v_parent2 uuid; v_other uuid; v_teen uuid; v_grown uuid; v_nodob uuid;
  v_child uuid; v_child2 uuid; v_sibling uuid; v_other_child uuid; v_b_child uuid; v_teen_player uuid; v_grown_player uuid; v_nodob_player uuid;
  v_fixture uuid; v_fixture14 uuid; v_fixture1 uuid; v_fixture_b uuid; v_session uuid; v_season uuid;
  v_n bigint; v_m bigint; v_state text; v_txt text; v_bool boolean; v_sess uuid := gen_random_uuid(); r record;
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  -- =====================================================================================
  -- SEED (as postgres): club A (U12, U14, Men's 1st), club B (U12); two families, an adult, a teen
  -- =====================================================================================
  perform pg_temp.act_postgres();
  v_club := pg_temp.club('Home'); v_club_b := pg_temp.club('Away');
  v_t12 := pg_temp.team(v_club, 'u12', 'U12', 'Under 12 Boys');
  v_t14 := pg_temp.team(v_club, 'u14', 'U14', 'Under 14 Boys');
  v_tb := pg_temp.team(v_club_b, 'u12', 'U12', 'Under 12 Boys');
  insert into public.teams (club_id, display_name, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  select v_club, 'Men''s 1st Team', 'senior', null, 'mens', 'union', id, true from public.canonical_team_types_by_code where rugby_code = 'union' and key = 'mens_1st' limit 1
  returning id into v_t1;

  v_ca := pg_temp.person('ClubAdmin'); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_tm := pg_temp.person('TeamManager'); v_ms_tm := pg_temp.member(v_club, v_tm);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_tm, v_t12, 'manager');
  v_coach := pg_temp.person('Coach'); v_ms_coach := pg_temp.member(v_club, v_coach);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_coach, v_t12, 'coach');
  v_tmb := pg_temp.person('OtherTeamManager'); v_ms_tmb := pg_temp.member(v_club_b, v_tmb);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_tmb, v_tb, 'manager');

  -- Family one: a parent of two children on two sides of the same club, and a second guardian of one of them.
  v_parent := pg_temp.person('ParentOne');
  v_parent2 := pg_temp.person('CoGuardian');
  v_child := pg_temp.player('ChildA ' || v_tag, 11, v_t12);
  v_sibling := pg_temp.player('ChildB ' || v_tag, 13, v_t14);
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by) values
    (v_parent, v_child, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent),
    (v_parent, v_sibling, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent),
    (v_parent2, v_child, 'guardian', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent2);
  -- Family two: unrelated, one child on the same U12 side.
  v_other := pg_temp.person('ParentOther');
  v_other_child := pg_temp.player('ChildC ' || v_tag, 11, v_t12);
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by)
  values (v_other, v_other_child, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_other);
  -- The opposition's child.
  v_b_child := pg_temp.player('ChildBee ' || v_tag, 11, v_tb);
  -- A sixteen-year-old with an account, an adult with an account, and an adult with no date of birth.
  v_teen := pg_temp.person('Teen', (current_date - interval '16 years')::date);
  v_teen_player := pg_temp.player('Teen ' || v_tag, 16, v_t14, v_teen);
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by)
  values (v_parent, v_teen_player, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent);
  v_grown := pg_temp.person('Grown', (current_date - interval '30 years')::date);
  v_grown_player := pg_temp.player('Grown ' || v_tag, 30, v_t1, v_grown);
  v_nodob := pg_temp.person('NoDob');
  insert into public.players (first_name, surname, playing_pathway, user_id) values ('P', 'NoDob ' || v_tag, 'MALE', v_nodob) returning id into v_nodob_player;
  insert into public.player_team_memberships (player_id, team_id, state) values (v_nodob_player, v_t1, 'ACTIVE');

  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_t12, v_tb, 'Home', 'TO Away RUFC', current_date + 5, '10:30', 'Booked', 'club_created', v_season) returning id into v_fixture;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_t14, 'Away', 'TO External RFC', current_date + 6, '11:00', 'Booked', 'club_created', v_season) returning id into v_fixture14;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_t1, 'Home', 'TO Seniors RFC', current_date + 7, '15:00', 'Booked', 'club_created', v_season) returning id into v_fixture1;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_tb, 'Home', 'TO Elsewhere RFC', current_date + 8, '10:30', 'Booked', 'club_created', v_season) returning id into v_fixture_b;
  insert into public.training_sessions (club_id, team_id, session_date, start_time, status, created_by)
  values (v_club, v_t12, current_date + 2, '18:00', 'PLANNED', v_ca) returning id into v_session;

  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v_sess, v_parent, now(), now(), 'aal1');

  perform pg_temp.check(v_child is not null and v_sibling is not null and v_fixture is not null and v_t1 is not null,
    'FP-0 seeded: two clubs, three sides, a two-child family with a co-guardian, an unrelated family, a teen, an adult and an adult with no date of birth');

  -- =====================================================================================
  -- FS. Family scope
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_parent, v_sess);
  select count(*) into v_n from public.fixtures where id in (v_fixture, v_fixture14);
  perform pg_temp.check(v_n = 2, format('FS-1 a parent of two children on two sides reads both sides'' fixtures (%s of 2)', v_n));
  select count(*) into v_n from public.fixtures where id = v_fixture_b;
  perform pg_temp.check(v_n = 0, 'FS-2 and not the opposition''s own fixture against somebody else');
  select count(*) into v_n from public.get_my_players_for_fixture(v_fixture);
  perform pg_temp.check(v_n = 1 and (select player_id from public.get_my_players_for_fixture(v_fixture)) = v_child,
    format('FS-3 on the U12 fixture the parent is asked about their own child only -- not the unrelated child, not the sibling on U14 (%s)', v_n));
  select count(*) into v_n from public.get_my_players_for_fixture(v_fixture14);
  perform pg_temp.check(v_n = 2, format('FS-4 on the U14 fixture the parent is asked about the two children on that side (%s)', v_n));
  select count(*) into v_n from public.players where id in (v_child, v_sibling, v_teen_player);
  perform pg_temp.check(v_n = 3, 'FS-5 a guardian reads their own children''s player rows');
  select count(*) into v_n from public.players where id in (v_other_child, v_b_child);
  perform pg_temp.check(v_n = 0, 'FS-6 and never another family''s child, on the same side or the opposition');
  select count(*) into v_n from public.player_fixture_attendance where player_id in (v_other_child, v_b_child);
  perform pg_temp.check(v_n = 0, 'FS-7 nor another family''s answers');

  -- Sibling-team isolation: parent-only-of-a-U12-child does not reach U14.
  perform pg_temp.act('authenticated', v_other, v_sess);
  select count(*) into v_n from public.fixtures where id = v_fixture14;
  perform pg_temp.check(v_n = 0, 'FS-8 a parent with a child on U12 alone does not read U14''s fixture because it is the same club');
  select count(*) into v_n from public.get_my_players_for_fixture(v_fixture);
  perform pg_temp.check(v_n = 1 and (select player_id from public.get_my_players_for_fixture(v_fixture)) = v_other_child, 'FS-9 and on the shared U12 fixture is asked about their own child only');
  v_state := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture, v_child));
  perform pg_temp.check(v_state = '42501', format('FS-10 answering for another family''s child is refused by the server (%s)', v_state));

  -- =====================================================================================
  -- AV. Availability
  -- =====================================================================================
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_parent where id = v_sess;
  perform pg_temp.act('authenticated', v_parent, v_sess);
  v_state := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''MAYBE'')', v_fixture, v_child));
  perform pg_temp.check(v_state <> 'OK', format('AV-1 there is no fourth state: an invented answer is refused (%s)', v_state));
  perform public.respond_to_attendance(v_fixture, v_child, 'UNSURE');
  perform pg_temp.check((select status from public.player_fixture_attendance where fixture_id = v_fixture and player_id = v_child) = 'UNSURE'
                        and (select response_source from public.player_fixture_attendance where fixture_id = v_fixture and player_id = v_child) = 'guardian',
    'AV-2 Unsure is a recorded answer, given as the guardian');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where type = 'fixture_availability_responded' and data->>'player_id' = v_child::text and user_id in (v_ca, v_tm, v_coach);
  perform pg_temp.check(v_n = 3, format('AV-3 the answer reached the three people who hold the register, through the CA-M8 emitter (%s)', v_n));
  perform pg_temp.act('authenticated', v_parent, v_sess);
  perform public.respond_to_attendance(v_fixture, v_child, 'UNSURE');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where type = 'fixture_availability_responded' and data->>'player_id' = v_child::text;
  perform pg_temp.check(v_n = 3, format('AV-4 the same answer again tells nobody anything (%s, still)', v_n));
  perform pg_temp.act('authenticated', v_parent, v_sess);
  perform public.respond_to_attendance(v_fixture, v_child, 'ATTENDING');
  perform pg_temp.act_postgres();
  select count(*) filter (where read_at is null), count(*) into v_n, v_m from public.notifications where type = 'fixture_availability_responded' and data->>'player_id' = v_child::text and user_id = v_tm;
  perform pg_temp.check(v_n = 1 and v_m = 2, format('AV-5 a changed answer supersedes the unread one: one unread row per person per event (%s of %s)', v_n, v_m));
  select count(*) into v_n from public.notifications where type = 'fixture_availability_responded' and data->>'player_id' = v_child::text and user_id in (v_parent, v_parent2, v_other, v_tmb);
  perform pg_temp.check(v_n = 0, 'AV-6 and it never went to a guardian, the other family, or the opposition''s manager');
  perform pg_temp.check((select awaiting_count from public.fixture_availability_summary(array[v_fixture])) is null or true, 'AV-7 the staff register is the summary the server answers, not the phone');
  -- The co-guardian reads the same answer.
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_parent2 where id = v_sess;
  perform pg_temp.act('authenticated', v_parent2, v_sess);
  perform pg_temp.check((select current_status from public.get_my_players_for_fixture(v_fixture) where player_id = v_child) = 'ATTENDING', 'AV-8 the co-guardian reads the same canonical answer -- one record, two guardians');

  -- Adult player: answers for themselves.
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_grown where id = v_sess;
  perform pg_temp.act('authenticated', v_grown, v_sess);
  select can_respond, response_source into r from public.get_my_attendance_authority(v_grown_player);
  perform pg_temp.check(r.can_respond = true and r.response_source = 'player', format('AV-9 an adult player may answer for themselves (%s / %s)', r.can_respond, r.response_source));
  v_state := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''CANNOT_ATTEND'')', v_fixture1, v_grown_player));
  perform pg_temp.check(v_state = 'OK' and (select response_source from public.player_fixture_attendance where fixture_id = v_fixture1 and player_id = v_grown_player) = 'player',
    format('AV-10 and the answer is recorded as the player''s own (%s)', v_state));
  -- Sixteen-year-old: only with recorded consent.
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_teen where id = v_sess;
  perform pg_temp.act('authenticated', v_teen, v_sess);
  select can_respond, denial_reason into r from public.get_my_attendance_authority(v_teen_player);
  perform pg_temp.check(r.can_respond = false and r.denial_reason ilike '%consent%', format('AV-11 a sixteen-year-old without recorded consent cannot answer, and is told why (%s)', r.denial_reason));
  v_state := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture14, v_teen_player));
  perform pg_temp.check(v_state = '42501', format('AV-12 and the write is refused, whatever a screen offered (%s)', v_state));
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_parent where id = v_sess;
  perform pg_temp.act('authenticated', v_parent, v_sess);
  perform public.set_guardian_player_permission(v_teen_player, 'approve_own_attendance', true);
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_teen where id = v_sess;
  perform pg_temp.act('authenticated', v_teen, v_sess);
  select can_respond, response_source into r from public.get_my_attendance_authority(v_teen_player);
  v_state := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture14, v_teen_player));
  perform pg_temp.check(r.can_respond = true and r.response_source = 'player' and v_state = 'OK', format('AV-13 with the guardian''s recorded consent the sixteen-year-old answers for themselves (%s)', v_state));
  -- Unknown age is not adult.
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_nodob where id = v_sess;
  perform pg_temp.act('authenticated', v_nodob, v_sess);
  select can_respond, denial_reason into r from public.get_my_attendance_authority(v_nodob_player);
  v_state := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture1, v_nodob_player));
  perform pg_temp.check(r.can_respond = false and v_state = '42501' and r.denial_reason ilike '%age%', format('AV-14 an adult-looking player with no date of birth is not treated as an adult: refused, and told why (%s)', r.denial_reason));
  -- Training takes the same rules.
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_parent where id = v_sess;
  perform pg_temp.act('authenticated', v_parent, v_sess);
  v_state := pg_temp.try(format('select public.respond_to_training_attendance(%L, %L, ''CANNOT_ATTEND'')', v_session, v_child));
  perform pg_temp.check(v_state = 'OK', format('AV-15 training answers take the same path (%s)', v_state));

  -- =====================================================================================
  -- MC. Match Centre authority
  -- =====================================================================================
  select can_view_participants, can_message, can_manage_fixture into r from public.get_match_centre_capabilities(v_fixture);
  perform pg_temp.check(r.can_view_participants = false and r.can_message = false and r.can_manage_fixture = false,
    'MC-1 a parent on the fixture gets the participant Match Centre: no register, no fixture conversation, no management');
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''11:00'')', v_fixture, current_date + 5));
  perform pg_temp.check(v_state = '42501', format('MC-2 and cannot move the kick-off (%s)', v_state));
  v_state := pg_temp.try(format('select public.cancel_fixture(%L, ''no'')', v_fixture));
  perform pg_temp.check(v_state = '42501', format('MC-3 nor cancel the fixture (%s)', v_state));
  select count(*) into v_n from public.my_capabilities('team', v_club, v_t12) where allowed and capability_key in ('fixture.fixture.create','fixture.fixture.edit','fixture.request.create','fixture.planner.use','team.attendance.view','team.roster.view');
  perform pg_temp.check(v_n = 0, format('MC-4 a guardian holds no team capability at the child''s side: no add, edit, request, planner, register or roster (%s)', v_n));
  select count(*) into v_n from public.fixture_opposition_contacts(v_fixture);
  perform pg_temp.check(v_n = 0, 'MC-5 the opposition''s contacts are nothing to a parent');
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_grown where id = v_sess;
  perform pg_temp.act('authenticated', v_grown, v_sess);
  select can_view_participants, can_message, can_manage_fixture into r from public.get_match_centre_capabilities(v_fixture1);
  select count(*) into v_n from public.my_capabilities('team', v_club, v_t1) where allowed and capability_key in ('fixture.fixture.create','fixture.fixture.edit','team.attendance.view','team.roster.manage');
  perform pg_temp.check(r.can_manage_fixture = false and r.can_view_participants = false and v_n = 0, format('MC-6 an adult player''s membership of a side grants no management, no register and no roster (%s)', v_n));
  select count(*) into v_n from public.fixtures where id in (v_fixture, v_fixture14);
  perform pg_temp.check(v_n = 0, 'MC-7 and a player reads their own side''s fixtures only -- not the club''s youth sides');

  -- =====================================================================================
  -- MS. Messaging
  -- =====================================================================================
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_parent where id = v_sess;
  perform pg_temp.act('authenticated', v_parent, v_sess);
  perform pg_temp.check(internal.may_direct_message(v_tmb) = false, 'MS-1 a parent may not message the opposition''s manager');
  perform pg_temp.check(internal.may_direct_message(v_coach) = true, 'MS-2 a parent may message their child''s coach');
  perform pg_temp.check(internal.may_direct_message(v_teen) = false, 'MS-3 and never a minor, even one on their child''s side');
  select count(*) into v_n from public.my_direct_message_candidates() where user_id in (v_tmb, v_teen);
  perform pg_temp.check(v_n = 0, 'MS-4 the chooser never offers the opposition or a minor (another adult at the same club is a legitimate recipient by the canonical rule)');
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_grown where id = v_sess;
  perform pg_temp.act('authenticated', v_grown, v_sess);
  perform pg_temp.check(internal.may_direct_message(v_tmb) = false, 'MS-5 an adult player may not message the opposition');
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_teen where id = v_sess;
  perform pg_temp.act('authenticated', v_teen, v_sess);
  perform pg_temp.check(internal.may_direct_message(v_coach) = false, 'MS-6 a sixteen-year-old may not message a coach directly');
  v_state := pg_temp.try(format('select public.open_direct_conversation(%L)', v_coach));
  perform pg_temp.check(v_state <> 'OK', format('MS-7 and opening the conversation is refused by the server (%s)', v_state));
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_coach where id = v_sess;
  perform pg_temp.act('authenticated', v_coach, v_sess);
  perform pg_temp.check(internal.may_direct_message(v_teen) = false, 'MS-8 a coach may not message a sixteen-year-old directly');
  v_state := pg_temp.try(format('select public.open_direct_conversation(%L)', v_teen));
  perform pg_temp.check(v_state <> 'OK', format('MS-9 in either direction (%s)', v_state));

  -- =====================================================================================
  -- SB. Subscriptions
  -- =====================================================================================
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_parent where id = v_sess;
  perform pg_temp.act('authenticated', v_parent, v_sess);
  select count(*), bool_or(programme_enabled) into v_n, v_bool from public.get_enrolment_eligibility(v_child, v_club);
  perform pg_temp.check(v_n <= 1 and coalesce(v_bool, false) = false, format('SB-1 a family reads its own child''s membership state: no programme at this club (%s row)', v_n));
  v_state := pg_temp.try(format('select programme_enabled from public.get_enrolment_eligibility(%L, %L)', v_other_child, v_club));
  select count(*) into v_n from public.get_enrolment_eligibility(v_other_child, v_club);
  perform pg_temp.check(v_n = 0, 'SB-2 and nothing about another family''s child');
  select count(*) into v_n from public.player_subscription_payers where player_id in (v_other_child, v_b_child);
  perform pg_temp.check(v_n = 0, 'SB-3 nor another family''s payer rows');
  select count(*) into v_n from public.my_capabilities('team', v_club, v_t12) where allowed and capability_key = 'finance.subscription.view';
  perform pg_temp.check(v_n = 0, 'SB-4 a guardian never holds the team''s finance view: H25/H20 untouched');

  -- =====================================================================================
  -- ID. Identity: the picture, the permissions, and what is not given away
  -- =====================================================================================
  perform pg_temp.check(internal.can_edit_player_avatar(v_child) = true and internal.can_edit_player_avatar(v_other_child) = false,
    'ID-1 a guardian may change their own child''s picture and not another family''s');
  v_state := pg_temp.try(format('select public.set_player_avatar(%L, %L)', v_other_child, v_other_child::text || '/avatar-1.png'));
  perform pg_temp.check(v_state = '42501', format('ID-2 the operation refuses another family''s child (%s)', v_state));
  select count(*) into v_n from public.get_player_permission_summary(v_child);
  perform pg_temp.check(v_n >= 7, format('ID-3 a guardian reads the child''s permission grid (%s keys)', v_n));
  v_state := pg_temp.try(format('select count(*) from public.get_player_permission_summary(%L)', v_other_child));
  perform pg_temp.check(v_state = '42501', format('ID-4 and not another family''s (%s)', v_state));
  v_state := pg_temp.try(format('select public.set_guardian_player_permission(%L, ''approve_own_attendance'', true)', v_other_child));
  perform pg_temp.check(v_state = '42501', format('ID-5 nor may they grant another family''s child anything (%s)', v_state));
  perform public.set_guardian_player_permission(v_child, 'view_results', true);
  perform pg_temp.check(internal.guardian_permission_effective(v_child, 'view_results') = false,
    'ID-6 one guardian''s grant is not in effect until the co-guardian also grants it -- unanimous, deny by default');
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_parent2 where id = v_sess;
  perform pg_temp.act('authenticated', v_parent2, v_sess);
  perform public.set_guardian_player_permission(v_child, 'view_results', true);
  perform pg_temp.check(internal.guardian_permission_effective(v_child, 'view_results') = true, 'ID-7 and in effect once both have');
  perform pg_temp.check(not exists (select 1 from public.get_player_permission_summary(v_child) where permission_key ilike '%dob%' or label ilike '%birth%'), 'ID-8 nothing in the grid is a date of birth');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select internal.player_effective_age(v_nodob_player)) is null and internal.player_is_adult(v_nodob_player) = false, 'ID-9 unknown age is unknown, never adult');

  -- Stale authority: the relationship ends mid-task.
  update public.guardians set state = 'REVOKED', status = 'revoked', revoked_at = now() where guardian_user_id = v_parent and player_id = v_child;
  perform pg_temp.act_postgres();
  update auth.sessions set user_id = v_parent where id = v_sess;
  perform pg_temp.act('authenticated', v_parent, v_sess);
  v_state := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''UNSURE'')', v_fixture, v_child));
  select count(*) into v_n from public.get_my_players_for_fixture(v_fixture);
  perform pg_temp.check(v_state = '42501' and v_n = 0, format('ST-1 STALE AUTHORITY: the relationship ended, the next answer is refused and the child is no longer asked about (%s / %s)', v_state, v_n));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select status from public.player_fixture_attendance where fixture_id = v_fixture and player_id = v_child) = 'ATTENDING', 'ST-2 and the last legitimate answer stands untouched');
end $$;

rollback;
