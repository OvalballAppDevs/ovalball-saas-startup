-- =====================================================================================================
-- MATCH CENTRE CONSOLIDATION (owner brief, 2026-10-03; 20270727000000_a_match_centre_is_one_place)
--
-- One Match Centre for every game and every viewer. This suite pins the SERVER half of that promise --
-- the half no client can get wrong on somebody's behalf:
--
--   W  attendance opens six days out (a club may choose its own number), exactly on the boundary day,
--      earlier only when a side's staff open it -- and opening tells the families
--   P  privacy: a side's own staff read names; the other side reads NUMBERS ONLY; a family reads its
--      own side's numbers; somebody unrelated reads nothing -- in the projection AND in the rows
--   C  catering: the headcount is the players marked Attending on each Ovalball side, nothing else, and
--      it moves with the answers
--   R  reminders and announcements reach exactly their audience, and each family sees only what was
--      sent to them
--   M  a changed meet time is news for the side's families once attendance is open
--   A  awards: club default -> team override -> the match; nothing before kick-off; one vote per child;
--      each award given only by the people the brief names; the winner's family is told; a winner's
--      badge is current until the side's next match
--   T  the public team page: overview and staff public; squad and photos only where shared
--   V  the viewer's relationship to each side comes from canonical relationships only
--
-- Self-contained and transactional: everything it creates is rolled back.
-- =====================================================================================================

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

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.msg(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return '';
exception when others then return sqlerrm; end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.msg(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  -- PEOPLE
  v_admin_h uuid := gen_random_uuid();   -- Club Admin at the home club
  v_coach_h uuid := gen_random_uuid();   -- coach of the home U12
  v_coach_a uuid := gen_random_uuid();   -- coach of the away U12 (the opposition)
  v_parent_h uuid := gen_random_uuid();  -- guardian of TWO home children
  v_parent_h2 uuid := gen_random_uuid(); -- guardian of one home child
  v_parent_a uuid := gen_random_uuid();  -- guardian of the away child
  v_stranger uuid := gen_random_uuid();  -- Club Admin somewhere else entirely
  -- WORLD
  v_dir_h uuid; v_dir_a uuid; v_dir_c uuid; v_club_h uuid; v_club_a uuid; v_club_c uuid;
  v_ms_coach_h uuid; v_ms_coach_a uuid;
  v_team_h uuid; v_team_a uuid;
  v_child_h1 uuid; v_child_h2 uuid; v_child_h3 uuid; v_child_a uuid;
  -- FIXTURES (home U12 v away U12 unless named otherwise)
  v_f_open uuid;   -- 3 days out: inside the window
  v_f_edge uuid;   -- 6 days out: opens TODAY
  v_f_closed uuid; -- 7 days out: opens tomorrow
  v_f_far uuid;    -- 12 days out: for opening early
  v_f_past uuid;   -- kicked off two days ago
  v_f_next uuid;   -- kicked off yesterday: the side's NEXT match after v_f_past
  v_venue uuid; v_room_1 uuid; v_room_2 uuid; v_venue_other uuid; v_room_other uuid;
  -- SCRATCH
  v_json jsonb; v_txt text; v_n int; v_n2 int; v_bool boolean; v_award uuid; v_media text;
begin
  -- ------------------------------------------------------------------------------------- the people
  foreach v_person in array array[v_admin_h, v_coach_h, v_coach_a, v_parent_h, v_parent_h2, v_parent_a, v_stranger] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'mcc-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Consolidation', 'Person', 'mcc-' || v_person::text || '@ovalball.test', (current_date - interval '40 years')::date)
    on conflict (id) do nothing;
  end loop;

  -- ------------------------------------------------------------------------------------- the clubs
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MCC Home RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mcc-h-' || v_tag) returning id into v_dir_h;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MCC Away RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mcc-a-' || v_tag) returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MCC Elsewhere RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mcc-c-' || v_tag) returning id into v_dir_c;
  insert into public.clubs (directory_id, slug, status) values (v_dir_h, 'mcc-h-' || v_tag, 'active') returning id into v_club_h;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'mcc-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c, 'mcc-c-' || v_tag, 'active') returning id into v_club_c;

  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_h, 'Under 12 Boys', 'mcc-h-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_h;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_a, 'Under 12 Boys', 'mcc-a-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_a;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_h, v_admin_h, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_h, v_coach_h, 'BASIC_USER', 'active') returning id into v_ms_coach_h;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_coach_a, 'BASIC_USER', 'active') returning id into v_ms_coach_a;
  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_h, v_parent_h, 'BASIC_USER', 'active'), (v_club_h, v_parent_h2, 'BASIC_USER', 'active'),
    (v_club_a, v_parent_a, 'BASIC_USER', 'active'), (v_club_c, v_stranger, 'CLUB_ADMIN', 'active');
  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source) values
    (v_coach_h, v_ms_coach_h, v_club_h, v_team_h, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT'),
    (v_coach_a, v_ms_coach_a, v_club_a, v_team_a, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');

  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Harvey', 'Home' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_child_h1;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Hugo', 'Home' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_child_h2;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Henry', 'Second' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_child_h3;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Aled', 'Away' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_child_a;
  insert into public.player_team_memberships (player_id, team_id, status, state) values
    (v_child_h1, v_team_h, 'active', 'ACTIVE'), (v_child_h2, v_team_h, 'active', 'ACTIVE'),
    (v_child_h3, v_team_h, 'active', 'ACTIVE'), (v_child_a, v_team_a, 'active', 'ACTIVE');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by) values
    (v_parent_h, v_child_h1, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent_h),
    (v_parent_h, v_child_h2, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent_h),
    (v_parent_h2, v_child_h3, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent_h2),
    (v_parent_a, v_child_a, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent_a);

  -- ------------------------------------------------------------------------------------- the fixtures
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'Home', 'MCC Away RFC', current_date + 3, '10:30', 'Booked', 'club_created') returning id into v_f_open;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'Home', 'MCC Away RFC', current_date + 6, '10:30', 'Booked', 'club_created') returning id into v_f_edge;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'Home', 'MCC Away RFC', current_date + 7, '10:30', 'Booked', 'club_created') returning id into v_f_closed;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'Home', 'MCC Away RFC', current_date + 12, '10:30', 'Booked', 'club_created') returning id into v_f_far;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'Home', 'MCC Away RFC', current_date - 2, '10:30', 'Booked', 'club_created') returning id into v_f_past;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'Home', 'MCC Away RFC', current_date - 1, '10:30', 'Booked', 'club_created') returning id into v_f_next;

  -- Preconditions: the people the brief names hold the authority the brief assumes.
  perform pg_temp.act('authenticated', v_coach_h);
  perform pg_temp.check(internal.can('fixture.fixture.edit', 'team', v_club_h, v_team_h, null)
                        and internal.can('team.attendance.view', 'team', v_club_h, v_team_h, null),
    'S0 precondition: the home coach runs the home side''s fixtures and register');

  -- ===============================================================================================
  -- W. THE ATTENDANCE WINDOW
  -- ===============================================================================================
  perform pg_temp.act_postgres();
  perform pg_temp.check(internal.fixture_attendance_open_days(v_f_open) = 6, 'W1 attendance opens six days before the match by default');
  perform pg_temp.check(internal.fixture_attendance_is_open(v_f_open), 'W2 a match three days away is open');
  perform pg_temp.check(internal.fixture_attendance_opens_on(v_f_edge) = current_date
                        and internal.fixture_attendance_is_open(v_f_edge), 'W3 a match exactly six days away opens TODAY -- the boundary day is inside');
  perform pg_temp.check(internal.fixture_attendance_opens_on(v_f_closed) = current_date + 1
                        and not internal.fixture_attendance_is_open(v_f_closed), 'W4 a match seven days away opens tomorrow, not today');

  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_f_edge, v_child_h1)) = 'OK',
    'W5 a guardian answers on the boundary day');
  v_txt := pg_temp.msg(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_f_closed, v_child_h1));
  perform pg_temp.check(v_txt ilike 'Attendance opens on %6 days before the match.',
    format('W6 a day early it is refused, saying when it opens (%s)', v_txt));
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_f_closed, v_child_h1)) = '42501',
    'W7 and the refusal is the authority code, not a crash');

  -- A club may choose its own number.
  perform pg_temp.act_postgres();
  insert into public.club_scheduling_policy (club_id, attendance_open_days) values (v_club_h, 10)
  on conflict (club_id) do update set attendance_open_days = excluded.attendance_open_days;
  perform pg_temp.check(internal.fixture_attendance_open_days(v_f_closed) = 10 and internal.fixture_attendance_is_open(v_f_closed),
    'W8 a club that opens ten days out has the seven-day match open');
  delete from public.club_scheduling_policy where club_id = v_club_h;
  perform pg_temp.check(not internal.fixture_attendance_is_open(v_f_closed), 'W9 and without its own number the platform''s six days apply again');

  -- Opening early is a staff decision, and it tells the families.
  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(pg_temp.try(format('select public.open_fixture_attendance(%L)', v_f_far)) = '42501', 'W10 a guardian cannot open attendance');
  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(pg_temp.try(format('select public.open_fixture_attendance(%L)', v_f_far)) = '42501', 'W11 nor can a Club Admin from an unrelated club');
  perform pg_temp.act('authenticated', v_coach_h);
  select public.open_fixture_attendance(v_f_far) into v_json;
  perform pg_temp.check((v_json ->> 'opened')::boolean, format('W12 the home coach opens it early (%s)', v_json));
  perform pg_temp.act_postgres();
  perform pg_temp.check(internal.fixture_attendance_is_open(v_f_far), 'W13 and twelve days out it is now open');
  select count(*) into v_n from public.notifications
   where user_id = v_parent_h and type = 'fixture_attendance_invitation' and data ->> 'fixture_id' = v_f_far::text;
  perform pg_temp.check(v_n = 1, format('W14 the home families are told, once each (%s)', v_n));
  select count(*) into v_n from public.notifications
   where user_id = v_child_h1 and type = 'fixture_attendance_invitation';
  perform pg_temp.check(v_n = 0, 'W15 and never a child directly');
  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''UNSURE'')', v_f_far, v_child_h1)) = 'OK',
    'W16 once opened, the guardian answers twelve days out');

  -- ===============================================================================================
  -- P. PRIVACY -- names for a side's own staff, numbers across the line, nothing for outsiders
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_parent_h);
  perform public.respond_to_attendance(v_f_open, v_child_h1, 'ATTENDING');
  perform public.respond_to_attendance(v_f_open, v_child_h2, 'CANNOT_ATTEND');
  perform pg_temp.act('authenticated', v_parent_h2);
  perform public.respond_to_attendance(v_f_open, v_child_h3, 'UNSURE');
  perform pg_temp.act('authenticated', v_parent_a);
  perform public.respond_to_attendance(v_f_open, v_child_a, 'ATTENDING');
  perform pg_temp.check(pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_f_open, v_child_h1)) = '42501',
    'P1 a guardian answers only for their own child, never for the other side''s');

  perform pg_temp.act('authenticated', v_coach_h);
  select public.get_match_centre_attendance(v_f_open) into v_json;
  perform pg_temp.check((select s ->> 'visibility' from jsonb_array_elements(v_json -> 'sides') s where s ->> 'side' = 'home') = 'NAMES'
                        and jsonb_array_length((select s -> 'players' from jsonb_array_elements(v_json -> 'sides') s where s ->> 'side' = 'home')) = 3,
    'P2 the home coach reads the home squad by name');
  perform pg_temp.check((select s ->> 'visibility' from jsonb_array_elements(v_json -> 'sides') s where s ->> 'side' = 'away') = 'COUNTS'
                        and (select s -> 'players' from jsonb_array_elements(v_json -> 'sides') s where s ->> 'side' = 'away') = 'null'::jsonb
                        and (select (s -> 'counts' ->> 'attending')::int from jsonb_array_elements(v_json -> 'sides') s where s ->> 'side' = 'away') = 1,
    'P3 and the away side by NUMBERS ONLY');
  perform pg_temp.check(position(v_child_a::text in v_json::text) = 0 and position('Aled' in v_json::text) = 0,
    'P4 no away player id or name appears anywhere in the home coach''s payload');

  perform pg_temp.act('authenticated', v_coach_a);
  select public.get_match_centre_attendance(v_f_open) into v_json;
  perform pg_temp.check((select s ->> 'visibility' from jsonb_array_elements(v_json -> 'sides') s where s ->> 'side' = 'home') = 'COUNTS'
                        and (select (s -> 'counts' ->> 'attending')::int from jsonb_array_elements(v_json -> 'sides') s where s ->> 'side' = 'home') = 1
                        and (select (s -> 'counts' ->> 'unsure')::int from jsonb_array_elements(v_json -> 'sides') s where s ->> 'side' = 'home') = 1
                        and (select (s -> 'counts' ->> 'cannotAttend')::int from jsonb_array_elements(v_json -> 'sides') s where s ->> 'side' = 'home') = 1,
    'P5 the opposition coach reads the home side''s numbers');
  perform pg_temp.check(position(v_child_h1::text in v_json::text) = 0 and position(v_child_h3::text in v_json::text) = 0
                        and position('Harvey' in v_json::text) = 0 and position('Henry' in v_json::text) = 0,
    'P6 and never a home player''s id or name -- the payload itself holds none');
  select count(*) into v_n from public.player_fixture_attendance where fixture_id = v_f_open and player_id in (v_child_h1, v_child_h2, v_child_h3);
  perform pg_temp.check(v_n = 0, format('P7 nor can the opposition coach read the home side''s attendance ROWS (%s visible)', v_n));
  select count(*) into v_n from public.player_fixture_attendance where fixture_id = v_f_open and player_id = v_child_a;
  perform pg_temp.check(v_n = 1, 'P8 while their own side''s row is theirs to read');

  perform pg_temp.act('authenticated', v_parent_h2);
  select public.get_match_centre_attendance(v_f_open) into v_json;
  perform pg_temp.check((select s ->> 'visibility' from jsonb_array_elements(v_json -> 'sides') s where s ->> 'side' = 'home') = 'COUNTS'
                        and (select s ->> 'visibility' from jsonb_array_elements(v_json -> 'sides') s where s ->> 'side' = 'away') = 'NONE',
    'P9 a family reads its own side''s numbers and nothing of the other side');
  perform pg_temp.check(position('Harvey' in v_json::text) = 0 and position(v_child_h1::text in v_json::text) = 0,
    'P10 and no teammate''s name or id');
  perform pg_temp.check(v_json -> 'catering' ? 'total' = false, 'P11 a family is told whether there is catering, not the headcount');

  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(pg_temp.try(format('select public.get_match_centre_attendance(%L)', v_f_open)) = '42501',
    'P12 somebody unrelated to the match reads nothing at all');
  select count(*) into v_n from public.player_fixture_attendance where fixture_id = v_f_open;
  perform pg_temp.check(v_n = 0, 'P13 and no attendance rows');

  -- ===============================================================================================
  -- C. CATERING -- derived from Attending, both Ovalball sides, nothing invented
  -- ===============================================================================================
  perform pg_temp.act_postgres();
  insert into public.venues (club_id, name, slug, postcode, active) values (v_club_h, 'MCC Ground ' || v_tag, 'mcc-ground-' || v_tag, 'BB1 1AA', true) returning id into v_venue;
  insert into public.venues (club_id, name, slug, postcode, active) values (v_club_h, 'MCC Other Ground ' || v_tag, 'mcc-other-' || v_tag, 'BB1 1AB', true) returning id into v_venue_other;
  insert into public.venue_changing_rooms (club_id, venue_id, display_name) values (v_club_h, v_venue, 'Room 1') returning id into v_room_1;
  insert into public.venue_changing_rooms (club_id, venue_id, display_name) values (v_club_h, v_venue, 'Room 2') returning id into v_room_2;
  insert into public.venue_changing_rooms (club_id, venue_id, display_name) values (v_club_h, v_venue_other, 'Elsewhere') returning id into v_room_other;
  update public.fixtures set venue_id = v_venue where id = v_f_open;

  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_f_open, '{"catering_required": true}')) = '42501',
    'C1 a guardian cannot change the arrangements');
  perform pg_temp.act('authenticated', v_coach_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_f_open, jsonb_build_object('home_room_id', v_room_other))) <> 'OK',
    'C2 a changing room from another ground is refused');
  -- 20270728: the arrangements are written through set_fixture_facilities, the one write for where a match is.
  perform public.set_fixture_facilities(v_f_open, jsonb_build_object('home_room_id', v_room_1, 'away_room_id', v_room_2,
                                                                      'changing_room_notes', 'Side door by the car park.', 'catering_required', true));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select home_changing_room_id = v_room_1 and away_changing_room_id = v_room_2 and catering_required from public.fixtures where id = v_f_open),
    'C3 the home coach allocates both rooms and asks for catering');
  select count(*) into v_n from public.notifications where user_id = v_parent_h and type = 'fixture_arrangements_changed' and data ->> 'fixture_id' = v_f_open::text;
  perform pg_temp.check(v_n = 1, format('C4 the families are told where they change, attendance being open (%s)', v_n));

  perform pg_temp.act('authenticated', v_coach_h);
  select public.get_match_centre_attendance(v_f_open) -> 'catering' into v_json;
  perform pg_temp.check((v_json ->> 'required')::boolean and (v_json ->> 'total')::int = 2,
    format('C5 the headcount is the two players marked Attending, one per side -- not Unsure, not Can''t Attend (%s)', v_json));
  perform pg_temp.act('authenticated', v_parent_h2);
  perform public.respond_to_attendance(v_f_open, v_child_h3, 'ATTENDING');
  perform pg_temp.act('authenticated', v_coach_a);
  select public.get_match_centre_attendance(v_f_open) -> 'catering' into v_json;
  perform pg_temp.check((v_json ->> 'total')::int = 3, format('C6 it moves the moment an answer changes, and the other side''s staff see the same total (%s)', v_json ->> 'total'));
  perform pg_temp.act('authenticated', v_parent_h);
  perform public.respond_to_attendance(v_f_open, v_child_h1, 'CANNOT_ATTEND');
  perform pg_temp.act('authenticated', v_coach_h);
  select public.get_match_centre_attendance(v_f_open) -> 'catering' into v_json;
  perform pg_temp.check((v_json ->> 'total')::int = 2, 'C7 and falls when somebody can no longer come');
  perform pg_temp.act_postgres();
  update public.fixtures set opponent_team_id = null where id = v_f_far;
  perform pg_temp.act('authenticated', v_coach_h);
  select public.get_match_centre_attendance(v_f_far) -> 'catering' into v_json;
  perform pg_temp.check(v_json -> 'sidesNotCounted' ? 'away' and (v_json ->> 'total')::int = 0,
    'C8 an opposition not on Ovalball is named as not counted rather than guessed at');

  -- ===============================================================================================
  -- R. REMINDERS AND ANNOUNCEMENTS
  -- ===============================================================================================
  -- Now on v_f_open: Harvey CAN'T ATTEND, Hugo CAN'T ATTEND, Henry ATTENDING (home).
  perform pg_temp.act('authenticated', v_parent_h2);
  perform public.respond_to_attendance(v_f_open, v_child_h3, 'UNSURE');
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.send_fixture_communication(v_f_open, 'REMIND_UNSURE', 'Let us know by Thursday.');
  perform pg_temp.act_postgres();
  select count(*) filter (where r.user_id = v_parent_h2), count(*) filter (where r.user_id = v_parent_h)
    into v_n, v_n2
    from public.fixture_communications fc join public.fixture_communication_recipients r on r.communication_id = fc.id
   where fc.fixture_id = v_f_open and fc.action = 'REMIND_UNSURE';
  perform pg_temp.check(v_n = 1 and v_n2 = 0, format('R1 a reminder to the Unsure reaches Henry''s guardian and nobody else (%s/%s)', v_n, v_n2));

  perform pg_temp.act('authenticated', v_coach_h);
  perform public.send_fixture_communication(v_f_open, 'MESSAGE_CANNOT_ATTEND', 'Thanks for letting us know.');
  perform pg_temp.act_postgres();
  select count(*) filter (where r.user_id = v_parent_h), count(*) filter (where r.user_id = v_parent_h2)
    into v_n, v_n2
    from public.fixture_communications fc join public.fixture_communication_recipients r on r.communication_id = fc.id
   where fc.fixture_id = v_f_open and fc.action = 'MESSAGE_CANNOT_ATTEND';
  perform pg_temp.check(v_n = 1 and v_n2 = 0, format('R2 an announcement to Can''t Attend reaches that family once, though two of its children are in it (%s/%s)', v_n, v_n2));

  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(pg_temp.try(format('select public.send_fixture_communication(%L, ''MESSAGE_TEAM'', ''hello'')', v_f_open)) = '42501',
    'R3 a guardian cannot announce to the squad');
  select count(*) into v_n from public.get_fixture_announcements(v_f_open) a where a.sent_to_me;
  select count(*) into v_n2 from public.get_fixture_announcements(v_f_open);
  perform pg_temp.check(v_n = 1 and v_n2 = 1, format('R4 a family sees exactly what was sent to them (%s of %s)', v_n, v_n2));
  perform pg_temp.act('authenticated', v_parent_h2);
  select count(*) into v_n from public.get_fixture_announcements(v_f_open) a where a.body = 'Thanks for letting us know.';
  perform pg_temp.check(v_n = 0, 'R5 and not what was sent to somebody else');
  perform pg_temp.act('authenticated', v_coach_a);
  select count(*) into v_n from public.get_fixture_announcements(v_f_open);
  perform pg_temp.check(v_n = 0, 'R6 the other side''s staff do not read this side''s announcements');
  perform pg_temp.act('authenticated', v_coach_h);
  select count(*) into v_n from public.get_fixture_announcements(v_f_open) a where a.from_my_side;
  perform pg_temp.check(v_n = 2, 'R7 the side''s own staff see everything their side sent');
  perform pg_temp.check(pg_temp.try(format('select public.send_fixture_communication(%L, ''ATTENDANCE_REMINDER'', null)', v_f_closed)) <> 'OK',
    'R8 a reminder before attendance has opened is refused');

  -- ===============================================================================================
  -- M. A CHANGED MEET TIME IS NEWS
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.update_fixture_meet_time(v_f_open, '09:45');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where user_id = v_parent_h and type = 'fixture_meet_time_changed' and data ->> 'fixture_id' = v_f_open::text;
  select count(*) into v_n2 from public.notifications where user_id = v_parent_a and type = 'fixture_meet_time_changed';
  perform pg_temp.check(v_n = 1 and v_n2 = 0, format('M1 the home families are told the new meet time; the away families are not -- it is the home side''s (%s/%s)', v_n, v_n2));
  perform pg_temp.check((select meet_time = '09:45' from public.fixtures where id = v_f_open), 'M2 and the meet time is the one shown to everybody');

  -- ===============================================================================================
  -- A. REWARDS & RECOGNITION
  -- ===============================================================================================
  -- CLUB DEFAULT -> TEAM OVERRIDE -> THE MATCH
  perform pg_temp.act('authenticated', v_coach_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_club_award_category(%L, ''COACHES_PLAYER'', true)', v_club_h)) = '42501',
    'A1 a coach cannot change the club''s default awards');
  perform pg_temp.act('authenticated', v_admin_h);
  perform public.set_club_award_category(v_club_h, 'FAMILY_OR_SELF_PLAYER', true);
  perform public.set_club_award_category(v_club_h, 'COACHES_PLAYER', true);
  perform public.set_club_award_category(v_club_h, 'OPPOSITION_PLAYER', true);
  perform public.set_club_award_category(v_club_h, 'WORK_ETHIC', true);
  perform pg_temp.act_postgres();
  perform pg_temp.check(internal.match_award_enabled(v_team_h, 'COACHES_PLAYER'), 'A2 a team runs the club''s default award without doing anything');
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.set_team_award_category(v_team_h, 'COACHES_PLAYER', false);
  perform pg_temp.act_postgres();
  perform pg_temp.check(not internal.match_award_enabled(v_team_h, 'COACHES_PLAYER'), 'A3 a team that switches it off does not run it, whatever the club says');
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.clear_team_award_category(v_team_h, 'COACHES_PLAYER');
  perform pg_temp.act_postgres();
  perform pg_temp.check(internal.match_award_enabled(v_team_h, 'COACHES_PLAYER'), 'A4 and handing the choice back follows the club again');
  perform pg_temp.check(not internal.match_award_enabled(v_team_a, 'COACHES_PLAYER'), 'A5 one club''s default decides nothing for the other club''s teams');

  -- NOTHING BEFORE KICK-OFF
  perform pg_temp.act('authenticated', v_coach_h);
  perform pg_temp.check(pg_temp.try(format('select public.give_match_award(%L, %L, ''COACHES_PLAYER'', %L)', v_f_open, v_team_h, v_child_h1)) <> 'OK',
    'A6 no award can be given before kick-off');
  perform pg_temp.check(pg_temp.try(format('select public.open_match_award(%L, %L, ''FAMILY_OR_SELF_PLAYER'')', v_f_open, v_team_h)) <> 'OK',
    'A7 and the parents'' vote cannot be opened before kick-off');

  -- WHO GIVES WHAT
  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(pg_temp.try(format('select public.give_match_award(%L, %L, ''COACHES_PLAYER'', %L)', v_f_past, v_team_h, v_child_h1)) = '42501',
    'A8 a guardian cannot give the coaches'' award');
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(pg_temp.try(format('select public.give_match_award(%L, %L, ''COACHES_PLAYER'', %L)', v_f_past, v_team_h, v_child_h1)) = '42501',
    'A9 nor can the opposition give the home side''s coaches'' award');
  perform pg_temp.act('authenticated', v_coach_h);
  perform pg_temp.check(pg_temp.try(format('select public.give_match_award(%L, %L, ''COACHES_PLAYER'', %L)', v_f_past, v_team_h, v_child_h1)) = 'OK',
    'A10 the home coach gives the coaches'' award after the match');
  perform pg_temp.check(pg_temp.try(format('select public.give_match_award(%L, %L, ''WORK_ETHIC'', %L)', v_f_past, v_team_h, v_child_h3)) = 'OK',
    'A11 and the Beast Award');
  perform pg_temp.check(pg_temp.try(format('select public.give_match_award(%L, %L, ''OPPOSITION_PLAYER'', %L)', v_f_past, v_team_h, v_child_h2)) = '42501',
    'A12 but not the opposition''s award for their own side');
  perform pg_temp.check(pg_temp.try(format('select public.give_match_award(%L, %L, ''COACHES_PLAYER'', %L)', v_f_past, v_team_h, v_child_a)) <> 'OK',
    'A13 and never to a player who is not in the side');
  perform pg_temp.act('authenticated', v_coach_a);
  select string_agg(display_name, ',' order by display_name) into v_txt from public.get_match_recognition_squad(v_f_past, v_team_h);
  perform pg_temp.check(v_txt like '%Harvey H.%' and position('Home' || v_tag in v_txt) = 0,
    format('A13b choosing from the other side, the opposition sees first names and surname initials only (%s)', v_txt));
  perform pg_temp.check(pg_temp.try(format('select public.give_match_award(%L, %L, ''OPPOSITION_PLAYER'', %L)', v_f_past, v_team_h, v_child_h2)) = 'OK',
    'A14 the opposition''s representative chooses the home side''s Opposition Player of the Match');
  select (r ->> 'winner')::jsonb ->> 'displayName' into v_txt
    from jsonb_array_elements(public.get_match_rewards(v_f_past) -> 'awards') r where r ->> 'categoryKey' = 'OPPOSITION_PLAYER' and r ->> 'side' = 'home';
  perform pg_temp.check(v_txt = 'Hugo H.', format('A14b and reads the winner back as first name and surname initial (%s)', v_txt));
  perform pg_temp.act('authenticated', v_parent_h);
  select (r ->> 'winner')::jsonb ->> 'displayName' into v_txt
    from jsonb_array_elements(public.get_match_rewards(v_f_past) -> 'awards') r where r ->> 'categoryKey' = 'OPPOSITION_PLAYER' and r ->> 'side' = 'home';
  perform pg_temp.check(v_txt = 'Hugo Home' || v_tag, format('A14c while the winner''s own family reads the full name (%s)', v_txt));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where user_id = v_parent_h and type = 'match_award_received' and data ->> 'fixture_id' = v_f_past::text;
  select count(*) into v_n2 from public.notifications where user_id = v_parent_h2 and type = 'match_award_received' and data ->> 'fixture_id' = v_f_past::text;
  perform pg_temp.check(v_n = 2 and v_n2 = 1, format('A15 each winner''s guardian is told -- Harvey''s and Hugo''s parent twice, Henry''s once (%s/%s)', v_n, v_n2));
  select count(*) into v_n from public.notifications n join public.players p on p.user_id = n.user_id where n.type = 'match_award_received' and p.id in (v_child_h1, v_child_h2, v_child_h3);
  perform pg_temp.check(v_n = 0, 'A16 and no child is told directly');

  -- A family reads the other CLUB's name, never its team label ("Under 12 Boys" is every U12 side).
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = v_parent_h and type = 'match_award_received'
                                   and body like '%against MCC Away RFC ' || v_tag || '%'),
    'A16b the award notice names the opposing club');

  -- THE PARENTS' VOTE: opened by the schedule after kick-off, one vote per child
  perform pg_temp.check(internal.run_match_award_schedule() >= 1, 'A17 after kick-off the schedule opens the parents'' vote');
  select id into v_award from public.match_awards where fixture_id = v_f_past and team_id = v_team_h and category_key = 'FAMILY_OR_SELF_PLAYER';
  perform pg_temp.check(v_award is not null and (select status from public.match_awards where id = v_award) = 'OPEN', 'A18 and it is open');
  select count(*) into v_n from public.notifications where user_id = v_parent_h and type = 'match_award_voting_open' and data ->> 'fixture_id' = v_f_past::text;
  perform pg_temp.check(v_n = 1, format('A19 the home families are told voting is open, once each (%s)', v_n));
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = v_parent_h and type = 'match_award_voting_open'
                                   and data ->> 'fixture_id' = v_f_past::text
                                   and body = 'Choose who stood out against MCC Away RFC ' || v_tag || ' on ' || to_char(current_date - 2, 'FMDay FMDD FMMonth') || '. Voting closes in three days.'),
    'A19b and the notice says which match: the opposing club and its date');
  perform pg_temp.check(internal.run_match_award_schedule() = 0, 'A20 running the schedule again opens nothing twice');

  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(pg_temp.try(format('select public.cast_match_award_vote(%L, %L, %L)', v_award, v_child_h3, v_child_h1)) = 'OK', 'A21 a parent votes for Harvey''s entitlement');
  perform pg_temp.check(pg_temp.try(format('select public.cast_match_award_vote(%L, %L, %L)', v_award, v_child_h3, v_child_h2)) = 'OK', 'A22 and separately for Hugo''s -- one vote per child');
  perform pg_temp.check(pg_temp.try(format('select public.cast_match_award_vote(%L, %L, %L)', v_award, v_child_h1, v_child_h1)) = 'OK', 'A23 changing Harvey''s vote replaces it');
  perform pg_temp.check(pg_temp.try(format('select public.cast_match_award_vote(%L, %L, %L)', v_award, v_child_h1, v_child_h3)) = '42501', 'A24 a parent cannot spend another family''s vote');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.match_award_votes where award_id = v_award;
  perform pg_temp.check(v_n = 2, format('A25 two children, two votes -- never three (%s)', v_n));
  perform pg_temp.act('authenticated', v_parent_a);
  perform pg_temp.check(pg_temp.try(format('select public.cast_match_award_vote(%L, %L, %L)', v_award, v_child_h1, v_child_a)) <> 'OK', 'A26 the other side''s families do not vote in this side''s award');

  -- OPENED BY HAND IS STILL OPENED: the away side's staff open their own parents' vote, and that side's
  -- families are told once -- the same notice the schedule sends.
  perform pg_temp.act_postgres();
  insert into public.club_award_category_settings (club_id, category_key, enabled) values (v_club_a, 'FAMILY_OR_SELF_PLAYER', true);
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(pg_temp.try(format('select public.open_match_award(%L, %L, ''FAMILY_OR_SELF_PLAYER'')', v_f_past, v_team_a)) = 'OK',
    'A26b the away coach opens their own side''s parents'' vote by hand');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where user_id = v_parent_a and type = 'match_award_voting_open' and data ->> 'fixture_id' = v_f_past::text;
  select count(*) into v_n2 from public.notifications where user_id = v_parent_h2 and type = 'match_award_voting_open' and data ->> 'fixture_id' = v_f_past::text;
  perform pg_temp.check(v_n = 1 and v_n2 = 1, format('A26c and that side''s families are told once; the home families'' one notice is unchanged (%s/%s)', v_n, v_n2));

  -- RECOGNITION: the badge is current until the side's next match has kicked off
  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.act_postgres();
  update public.fixtures set kickoff_date = current_date + 20 where id = v_f_next;  -- the next match has not happened yet
  perform pg_temp.act('authenticated', v_parent_h);
  select count(*) into v_n from public.get_player_recognition(array[v_child_h1]) r where r.category_key = 'COACHES_PLAYER';
  perform pg_temp.check(v_n = 1, 'A27 Harvey''s family sees her current award');
  perform pg_temp.act('authenticated', v_stranger);
  select count(*) into v_n from public.get_player_recognition(array[v_child_h1]);
  perform pg_temp.check(v_n = 0, 'A28 somebody unrelated to his team does not');
  perform pg_temp.act_postgres();
  update public.fixtures set kickoff_date = current_date - 1 where id = v_f_next;   -- and now it has
  perform pg_temp.act('authenticated', v_parent_h);
  select count(*) into v_n from public.get_player_recognition(array[v_child_h1]) r where r.category_key = 'COACHES_PLAYER';
  perform pg_temp.check(v_n = 0, 'A29 once the side has played again, the badge is no longer current');

  -- ===============================================================================================
  -- T. THE PUBLIC TEAM PAGE
  -- ===============================================================================================
  perform pg_temp.act('anon');
  select public.get_public_team_profile(v_team_h) into v_json;
  perform pg_temp.check(v_json ->> 'name' = 'Under 12 Boys' and jsonb_array_length(v_json -> 'staff') >= 1
                        and (select bool_and(s ? 'name' and s ? 'role' and not (s ? 'email') and not (s ? 'phone')) from jsonb_array_elements(v_json -> 'staff') s),
    'T1 signed out, the page names the team and its staff by name and role -- no contact detail');
  perform pg_temp.check(v_json -> 'squad' = 'null'::jsonb and v_json -> 'media' = 'null'::jsonb and not (v_json ->> 'squadShared')::boolean,
    'T2 and no squad or photos until the club chooses to share them');
  perform pg_temp.check(position('Harvey' in v_json::text) = 0, 'T3 the payload holds no player name at all');

  perform pg_temp.act('authenticated', v_coach_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_club_public_sharing(%L, true, true)', v_club_h)) = '42501', 'T4 a coach cannot make the club''s squads public');
  perform pg_temp.act('authenticated', v_admin_h);
  perform public.set_club_public_sharing(v_club_h, true, false);
  perform pg_temp.act('anon');
  select public.get_public_team_profile(v_team_h) into v_json;
  perform pg_temp.check((v_json ->> 'squadShared')::boolean and jsonb_array_length(v_json -> 'squad') = 3, 'T5 shared, the squad appears');
  perform pg_temp.check(position(('Home' || v_tag) in v_json::text) = 0 and (select bool_or(s ->> 'name' = 'Harvey H.') from jsonb_array_elements(v_json -> 'squad') s),
    'T6 by first name and surname initial only -- never the full surname');
  perform pg_temp.act('authenticated', v_admin_h);
  perform public.set_team_public_sharing(v_team_h, false, null);
  perform pg_temp.act('anon');
  select public.get_public_team_profile(v_team_h) into v_json;
  perform pg_temp.check(v_json -> 'squad' = 'null'::jsonb, 'T7 a team that keeps its squad private overrides the club');

  perform pg_temp.act_postgres();
  v_media := v_team_h::text || '/mcc-' || v_tag || '.jpg';
  insert into public.team_media (team_id, club_id, storage_path, uploaded_by) values (v_team_h, v_club_h, v_media, v_coach_h);
  perform pg_temp.check(not internal.team_gallery_media_is_public(v_media), 'T8 a team photo is not public while photos are not shared');
  perform pg_temp.act('authenticated', v_admin_h);
  perform public.set_team_public_sharing(v_team_h, false, true);
  perform pg_temp.act_postgres();
  -- 20270728: sharing photos makes the CHOSEN photos public, one by one (match_centre_facilities T24-T29).
  perform pg_temp.check(not internal.team_gallery_media_is_public(v_media), 'T9a sharing photos publishes none until one is chosen');
  update public.team_media set shared_publicly = true where storage_path = v_media;
  perform pg_temp.check(internal.team_gallery_media_is_public(v_media), 'T9 and a chosen photo is public once the team shares its photos');
  perform pg_temp.check(not exists (select 1 from public.team_media where team_id = v_team_a) and not internal.team_shares_publicly(v_team_a, 'media'),
    'T10 one team''s choice shares nothing of another''s');

  -- ===============================================================================================
  -- V. WHO IS LOOKING
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_parent_h);
  select public.get_match_centre_viewer(v_f_open) into v_json;
  perform pg_temp.check(v_json ->> 'side' = 'home' and not (v_json ->> 'canManage')::boolean, 'V1 a home guardian is on the home side and manages nothing');
  perform pg_temp.act('authenticated', v_coach_a);
  select public.get_match_centre_viewer(v_f_open) into v_json;
  perform pg_temp.check(v_json ->> 'side' = 'away' and (v_json ->> 'canManage')::boolean, 'V2 the away coach is on the away side and manages it');
  perform pg_temp.act('authenticated', v_coach_h);
  select public.get_match_centre_viewer(v_f_open) into v_json;
  perform pg_temp.check(v_json ->> 'side' = 'home' and (v_json ->> 'canManage')::boolean, 'V3 the home coach is on the home side and manages it');
  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(pg_temp.try(format('select public.get_match_centre_viewer(%L)', v_f_open)) = '42501', 'V4 somebody unrelated is not shown the match at all');

  -- WHERE IT IS, FOR THE AWAY SIDE TOO. The match is at the home club's ground, whose venue row the away
  -- family cannot read; the viewer answer names it anyway, for somebody already allowed to see the match.
  perform pg_temp.act('authenticated', v_parent_a);
  select count(*) into v_n from public.venues where id = v_venue;
  select public.get_match_centre_viewer(v_f_open) -> 'ground' into v_json;
  perform pg_temp.check(v_n = 0 and v_json ->> 'name' = 'MCC Ground ' || v_tag and v_json ->> 'postcode' = 'BB1 1AA',
    format('V5 the away family cannot read the home club''s venue row, yet is told the ground (%s, %s)', v_n, v_json));

  perform pg_temp.act_postgres();
end $$;

rollback;
