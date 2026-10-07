-- =====================================================================================================
-- MATCH CENTRE ARENA, CANONICAL FACILITIES & THE PUBLIC TEAM PAGE (20270728000000_a_match_is_played_at_the_hosts_ground)
--
-- The server half of the promise, which no client can get wrong on somebody's behalf:
--
--   H  the host is the HOME side: a club on Ovalball offers its own grounds (CANONICAL), one that is not
--      starts from its Club Directory ground (PROVISIONAL), and until home or away is agreed there is none
--   X  a match references only the HOST's ground, pitch and rooms -- never another club's, never a pitch
--      at another ground -- whichever way the write arrives
--   F  one write for where the match is; a choice that no longer fits is cleared and said so; the people
--      who need to know are told ONCE; the opposition picks from the host's catalogue but cannot change it
--   N  numbered rooms 1-20 and "no changing rooms" for a host not on Ovalball; neither for one that is
--   S  switching home and away re-resolves the ground on BOTH rows of a mirrored pair, in every direction
--   T  the public team page: club default -> team override; contact for the opposition's staff only;
--      squad numbers and positions; only the photos chosen for the public page
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

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
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
  v_admin_h uuid := gen_random_uuid();   -- Club Admin, home club
  v_admin_a uuid := gen_random_uuid();   -- Club Admin, away club
  v_coach_h uuid := gen_random_uuid();   -- coach, home U12
  v_coach_a uuid := gen_random_uuid();   -- coach, away U12 (the opposition)
  v_parent_h uuid := gen_random_uuid();  -- guardian, home child
  v_parent_a uuid := gen_random_uuid();  -- guardian, away child
  v_member_h uuid := gen_random_uuid();  -- an ordinary member of the home club, no team role
  v_stranger uuid := gen_random_uuid();  -- Club Admin somewhere else entirely
  v_dir_h uuid; v_dir_a uuid; v_dir_c uuid; v_dir_x uuid;
  v_club_h uuid; v_club_a uuid; v_club_c uuid;
  v_ms uuid;
  v_team_h uuid; v_team_a uuid;
  v_child_h uuid; v_child_a uuid;
  -- grounds
  v_vh1 uuid; v_vh2 uuid; v_va1 uuid;            -- home: main + second ground; away: main
  v_ph1 uuid; v_ph2 uuid; v_pa1 uuid;            -- a pitch at each
  v_rh1 uuid; v_rh2 uuid; v_rh_other uuid; v_ra1 uuid;  -- rooms: two at home main, one at home second, one away
  -- fixtures
  v_f uuid;        -- home v away, Home, 3 days out (attendance open)
  v_fm uuid;       -- a mirrored pair: v_fm (home club's row) and v_fm2 (away club's row)
  v_fm2 uuid;
  v_fd uuid;       -- v a Club Directory club not on Ovalball, Away
  v_ft uuid;       -- v an opposition known only by typed name, Away
  v_fu uuid;       -- home or away not agreed
  -- scratch
  v_json jsonb; v_n int; v_n2 int; v_row public.fixtures; v_row2 public.fixtures; v_media uuid; v_media2 uuid; v_path text;
begin
  -- ------------------------------------------------------------------------------------- the people
  foreach v_person in array array[v_admin_h, v_admin_a, v_coach_h, v_coach_a, v_parent_h, v_parent_a, v_member_h, v_stranger] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'mcf-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Facilities', 'Person', 'mcf-' || v_person::text || '@ovalball.test', (current_date - interval '40 years')::date)
    on conflict (id) do nothing;
  end loop;

  -- ------------------------------------------------------------------------------------- the clubs
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MCF Home RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mcf-h-' || v_tag) returning id into v_dir_h;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MCF Away RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mcf-a-' || v_tag) returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('MCF Elsewhere RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mcf-c-' || v_tag) returning id into v_dir_c;
  -- A Directory club with nobody on Ovalball, and a home ground on record.
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key, home_ground, postcode)
  values ('MCF Directory RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mcf-x-' || v_tag, 'Powder House Lane', 'LA1 2TT')
  returning id into v_dir_x;
  insert into public.clubs (directory_id, slug, status) values (v_dir_h, 'mcf-h-' || v_tag, 'active') returning id into v_club_h;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'mcf-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c, 'mcf-c-' || v_tag, 'active') returning id into v_club_c;

  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active, description)
  values (v_club_h, 'Under 12 Boys', 'mcf-h-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true, 'A friendly U12 side.') returning id into v_team_h;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_a, 'Under 12 Boys', 'mcf-a-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_a;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_h, v_admin_h, 'CLUB_ADMIN', 'active'), (v_club_a, v_admin_a, 'CLUB_ADMIN', 'active'),
    (v_club_h, v_parent_h, 'BASIC_USER', 'active'), (v_club_a, v_parent_a, 'BASIC_USER', 'active'),
    (v_club_h, v_member_h, 'BASIC_USER', 'active'), (v_club_c, v_stranger, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_h, v_coach_h, 'BASIC_USER', 'active') returning id into v_ms;
  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source)
  values (v_coach_h, v_ms, v_club_h, v_team_h, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_coach_a, 'BASIC_USER', 'active') returning id into v_ms;
  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source)
  values (v_coach_a, v_ms, v_club_a, v_team_a, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');

  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Harvey', 'Homeside' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_child_h;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Aled', 'Awayside' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_child_a;
  insert into public.player_team_memberships (player_id, team_id, status, state) values (v_child_h, v_team_h, 'active', 'ACTIVE'), (v_child_a, v_team_a, 'active', 'ACTIVE');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by) values
    (v_parent_h, v_child_h, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent_h),
    (v_parent_a, v_child_a, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent_a);

  -- ------------------------------------------------------------------------------------- the grounds
  insert into public.venues (club_id, name, slug, is_default_home, active, address_line_1, town, postcode, cover_stock_key, directions)
  values (v_club_h, 'Home Main Ground', 'mcf-vh1-' || v_tag, true, true, '1 Home Lane', 'Hometown', 'HM1 1AA', 'venue-dusk-01', 'Park behind the clubhouse.') returning id into v_vh1;
  insert into public.venues (club_id, name, slug, is_default_home, active) values (v_club_h, 'Home Second Ground', 'mcf-vh2-' || v_tag, false, true) returning id into v_vh2;
  insert into public.venues (club_id, name, slug, is_default_home, active, address_line_1, town, postcode)
  values (v_club_a, 'Away Main Ground', 'mcf-va1-' || v_tag, true, true, '9 Away Road', 'Awaytown', 'AW9 9ZZ') returning id into v_va1;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values (v_club_h, v_vh1, 'Pitch 1', true) returning id into v_ph1;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values (v_club_h, v_vh2, 'Back Pitch', true) returning id into v_ph2;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values (v_club_a, v_va1, 'Away Pitch', true) returning id into v_pa1;
  insert into public.venue_changing_rooms (club_id, venue_id, display_name, room_type, active) values (v_club_h, v_vh1, 'Room A', 'full_size', true) returning id into v_rh1;
  insert into public.venue_changing_rooms (club_id, venue_id, display_name, room_type, active) values (v_club_h, v_vh1, 'Room B', 'full_size', true) returning id into v_rh2;
  insert into public.venue_changing_rooms (club_id, venue_id, display_name, room_type, active) values (v_club_h, v_vh2, 'Second Room', 'smaller', true) returning id into v_rh_other;
  insert into public.venue_changing_rooms (club_id, venue_id, display_name, room_type, active) values (v_club_a, v_va1, 'Away Room', 'full_size', true) returning id into v_ra1;

  -- ------------------------------------------------------------------------------------- the fixtures
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'Home', 'MCF Away RFC', current_date + 3, '10:30', 'Booked', 'club_created') returning id into v_f;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'Home', 'MCF Away RFC', current_date + 20, '10:30', 'Booked', 'club_created') returning id into v_fm;
  -- A LEGACY MIRRORED PAIR. New matches are one row (unified_fixture_conversation); the capacity guard
  -- now refuses a second row for the same two teams on the same day, so it is set aside -- in this
  -- rolled-back transaction only -- to build the kind of pair older data still holds.
  alter table public.fixtures disable trigger enforce_shared_team_fixture_capacity;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, mirror_fixture_id)
  values (v_team_a, v_team_h, 'Away', 'MCF Home RUFC', current_date + 20, '10:30', 'Booked', 'club_created', v_fm) returning id into v_fm2;
  update public.fixtures set mirror_fixture_id = v_fm2 where id = v_fm;
  alter table public.fixtures enable trigger enforce_shared_team_fixture_capacity;
  insert into public.fixtures (owning_team_id, opponent_directory_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_dir_x, 'Away', 'MCF Directory RUFC', current_date + 10, '10:30', 'Booked', 'club_created') returning id into v_fd;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, 'Away', 'Typed Only RUFC', current_date + 11, '10:30', 'Booked', 'club_created') returning id into v_ft;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'TBD', 'MCF Away RFC', current_date + 12, '10:30', 'Booked', 'club_created') returning id into v_fu;

  -- ===============================================================================================
  -- H. WHOSE GROUND IT IS
  -- ===============================================================================================
  -- A new fixture is stored exactly as its creator wrote it; until somebody chooses, the Match Centre reads
  -- the host's default ground (resolveFixtureVenue). The ground is RE-resolved when the host changes (S).
  perform pg_temp.act_postgres();
  select * into v_row from public.fixtures where id = v_f;
  perform pg_temp.check(v_row.venue_id is null and v_row.pitch_id is null, 'H1 a new fixture is stored as written -- nothing filled in on insert');
  select * into v_row from public.fixtures where id = v_fd;
  perform pg_temp.check(v_row.venue_id is null and v_row.no_changing_rooms = false and v_row.home_changing_room_number is null,
    'H2 including one at a club not on Ovalball: rooms "not set", not "none"');

  perform pg_temp.act('authenticated', v_coach_h);
  v_json := public.get_fixture_facility_options(v_f);
  perform pg_temp.check(v_json ->> 'mode' = 'CANONICAL' and (v_json ->> 'hostIsOwning')::boolean
                        and jsonb_array_length(v_json -> 'venues') = 2 and v_json ->> 'defaultVenueId' = v_vh1::text,
    'H3 at home: the home club''s own two grounds, its default first');
  perform pg_temp.check(position(v_va1::text in v_json::text) = 0 and position(v_pa1::text in v_json::text) = 0,
    'H4 and nothing of the away club''s ground');
  v_json := public.get_fixture_facility_options(v_f, 'Away');
  perform pg_temp.check(v_json ->> 'mode' = 'CANONICAL' and not (v_json ->> 'hostIsOwning')::boolean
                        and jsonb_array_length(v_json -> 'venues') = 1 and v_json -> 'venues' -> 0 ->> 'id' = v_va1::text
                        and v_json ->> 'hostClubName' like 'MCF Away RFC%',
    'H5 asked "as if Away" before saving: the away club''s ground, pitches and rooms instead');
  perform pg_temp.check(position(v_vh1::text in v_json::text) = 0, 'H6 and none of the home club''s');
  v_json := public.get_fixture_facility_options(v_fd);
  perform pg_temp.check(v_json ->> 'mode' = 'PROVISIONAL' and v_json -> 'provisionalGround' ->> 'name' = 'Powder House Lane'
                        and v_json -> 'provisionalGround' ->> 'postcode' = 'LA1 2TT' and jsonb_array_length(v_json -> 'venues') = 0,
    'H7 away at a club not on Ovalball: PROVISIONAL, from its Club Directory ground, nothing to pick from');
  v_json := public.get_fixture_facility_options(v_ft);
  perform pg_temp.check(v_json ->> 'mode' = 'PROVISIONAL' and v_json ->> 'hostClubName' = 'Typed Only RUFC',
    'H8 an opposition known only by a typed name hosts under that name');
  v_json := public.get_fixture_facility_options(v_fu);
  perform pg_temp.check(v_json ->> 'mode' = 'UNDECIDED', 'H9 home or away not agreed: no host, so no ground');
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_fu, jsonb_build_object('venue_id', v_vh1))) = '22023',
    'H10 and a ground cannot be set until it is');

  -- The visiting family cannot read the host's venue row, and is still shown the host's own picture.
  perform pg_temp.act('authenticated', v_parent_a);
  select count(*) into v_n from public.venues where id = v_vh1;
  v_json := public.get_match_centre_viewer(v_f) -> 'ground';
  perform pg_temp.check(v_n = 0 and v_json ->> 'name' = 'Home Main Ground' and v_json ->> 'coverStockKey' = 'venue-dusk-01'
                        and v_json ->> 'directions' = 'Park behind the clubhouse.',
    format('H10a the visiting family is shown the host ground''s own picture and arrival notes (row visible: %s)', v_n));
  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(pg_temp.try(format('select public.get_fixture_facility_options(%L)', v_f)) = '42501', 'H11 a guardian cannot read the arranging options');
  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(pg_temp.try(format('select public.get_fixture_facility_options(%L)', v_f)) = '42501', 'H12 nor an unrelated Club Admin');
  perform pg_temp.act('anon');
  perform pg_temp.check(pg_temp.try(format('select public.get_fixture_facility_options(%L)', v_f)) <> 'OK', 'H13 nor a signed-out visitor');

  -- ===============================================================================================
  -- X. ONLY THE HOST'S RECORDS, WHICHEVER WAY THE WRITE ARRIVES
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_coach_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_f, jsonb_build_object('venue_id', v_va1))) = '23514',
    'X1 a Home match cannot be put at the away club''s ground');
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_f, jsonb_build_object('venue_id', v_vh1, 'pitch_id', v_ph2))) = '23514',
    'X2 nor on a pitch at the host''s OTHER ground');
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_f, jsonb_build_object('pitch_id', v_pa1))) = '23514',
    'X3 nor on another club''s pitch');
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_f, jsonb_build_object('home_room_id', v_rh_other))) = '23514',
    'X4 nor given a room at another ground');
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_f, jsonb_build_object('away_room_id', v_ra1))) = '23514',
    'X5 nor another club''s room');
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_f, jsonb_build_object('home_room_number', 3))) = '22023',
    'X6 nor a numbered room: a host on Ovalball has real rooms');
  perform public.set_fixture_facilities(v_f, jsonb_build_object('venue_id', v_vh1));
  perform pg_temp.act_postgres();
  perform pg_temp.check(pg_temp.try(format('update public.fixtures set venue_id = %L where id = %L', v_va1, v_f)) = '23514',
    'X7 the rule is the table''s own: even a direct write is refused');
  perform pg_temp.check(pg_temp.try(format('update public.fixtures set pitch_id = %L where id = %L', v_ph2, v_f)) = '23514',
    'X8 including a pitch at the wrong ground');

  -- ===============================================================================================
  -- F. ONE WRITE, CLEARED WHAT NO LONGER FITS, TOLD ONCE
  -- ===============================================================================================
  perform pg_temp.act_postgres();
  select count(*) into v_n2 from public.notifications where user_id = v_parent_h and type = 'fixture_pitch_changed' and data ->> 'fixture_id' = v_f::text;
  perform pg_temp.act('authenticated', v_coach_h);
  v_json := public.set_fixture_facilities(v_f, jsonb_build_object('venue_id', v_vh1, 'pitch_id', v_ph1, 'home_room_id', v_rh1, 'away_room_id', v_rh2,
                                                                  'changing_room_notes', 'Side door', 'catering_required', true));
  perform pg_temp.act_postgres();
  select * into v_row from public.fixtures where id = v_f;
  perform pg_temp.check(v_row.pitch_id = v_ph1 and v_row.pitch_allocation = 'Pitch 1' and v_row.home_changing_room_id = v_rh1
                        and v_row.away_changing_room_id = v_rh2 and v_row.catering_required and v_row.changing_room = 'Side door',
    'F1 the home coach sets the pitch, both rooms, notes and catering in one write');
  select count(*) - v_n2 into v_n from public.notifications where user_id = v_parent_h and type = 'fixture_pitch_changed' and data ->> 'fixture_id' = v_f::text;
  select count(*) into v_n2 from public.notifications where user_id = v_parent_h and type = 'fixture_arrangements_changed' and data ->> 'fixture_id' = v_f::text;
  perform pg_temp.check(v_n = 1 and v_n2 = 0, format('F2 the families are told ONCE, by the bigger change (pitch %s, rooms %s)', v_n, v_n2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = v_parent_h and type = 'fixture_pitch_changed'
                          and data ->> 'fixture_id' = v_f::text and body like '%is now at Home Main Ground, Pitch 1.'),
    'F2a and the notice names the whole location -- ground and pitch -- not just the pitch');
  select count(*) into v_n from public.notifications where user_id = v_coach_h and data ->> 'fixture_id' = v_f::text and type in ('fixture_pitch_changed', 'fixture_arrangements_changed');
  perform pg_temp.check(v_n = 0, 'F3 never the person who made the change');

  perform pg_temp.act('authenticated', v_coach_h);
  v_json := public.set_fixture_facilities(v_f, jsonb_build_object('venue_id', v_vh2));
  perform pg_temp.check(v_json -> 'cleared' ? 'pitch' and v_json -> 'cleared' ? 'home_room' and v_json -> 'cleared' ? 'away_room',
    format('F4 moving to the other ground clears the pitch and rooms, and says so (%s)', v_json));
  perform pg_temp.act_postgres();
  select * into v_row from public.fixtures where id = v_f;
  perform pg_temp.check(v_row.venue_id = v_vh2 and v_row.pitch_id is null and v_row.pitch_allocation is null
                        and v_row.home_changing_room_id is null and v_row.away_changing_room_id is null,
    'F5 nothing from the old ground survives');

  -- Rooms only, attendance open: the families hear about the rooms, once.
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.set_fixture_facilities(v_f, jsonb_build_object('home_room_id', v_rh_other));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where user_id = v_parent_h and type = 'fixture_arrangements_changed' and data ->> 'fixture_id' = v_f::text;
  perform pg_temp.check(v_n = 1, format('F6 a room change with attendance open tells the families once (%s)', v_n));
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.set_fixture_facilities(v_f, jsonb_build_object('changing_room_notes', 'Front door'));
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.notifications where user_id = v_parent_h and type = 'fixture_arrangements_changed' and data ->> 'fixture_id' = v_f::text;
  perform pg_temp.check(v_n = 1, 'F7 a save that changes no room tells nobody again');

  -- The opposition picks from the host's catalogue, and cannot change it.
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_f, jsonb_build_object('away_room_id', v_rh_other))) = 'OK',
    'F8 the away coach chooses their own room from the host''s rooms');
  perform pg_temp.check(pg_temp.try(format('select public.create_venue_changing_room(%L, %L, %L, %L, %L)', v_club_h, v_vh2, 'Visitors Hut', 'smaller', null)) = '42501',
    'F9 but cannot add a room to the host''s ground');
  perform pg_temp.check(pg_temp.try(format('select public.update_venue(%L, %L, %L)', v_vh2, 'Renamed By Visitors', null)) <> 'OK',
    'F10 nor rename the host''s ground');
  perform pg_temp.try(format('update public.venue_changing_rooms set display_name = %L where id = %L', 'Hijacked', v_rh_other));
  perform pg_temp.try(format('update public.club_pitches set display_name = %L where id = %L', 'Hijacked', v_ph1));
  perform pg_temp.try(format('update public.venues set name = %L where id = %L', 'Hijacked', v_vh2));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select display_name from public.venue_changing_rooms where id = v_rh_other) = 'Second Room'
                        and (select display_name from public.club_pitches where id = v_ph1) = 'Pitch 1'
                        and (select name from public.venues where id = v_vh2) = 'Home Second Ground',
    'F11 and a direct write to the host''s rooms, pitches or grounds changes nothing');

  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_f, jsonb_build_object('catering_required', false))) = '42501',
    'F12 a guardian cannot arrange the match');
  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_f, jsonb_build_object('catering_required', false))) = '42501',
    'F13 nor an unrelated Club Admin');

  -- ===============================================================================================
  -- N. A HOST NOT ON OVALBALL: WRITTEN FOR THIS MATCH, NUMBERED ROOMS, OR NONE AT ALL
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.set_fixture_facilities(v_fd, jsonb_build_object('pitch_text', 'Pitch 2 (top field)', 'home_room_number', 4, 'away_room_number', 7));
  perform pg_temp.act_postgres();
  select * into v_row from public.fixtures where id = v_fd;
  perform pg_temp.check(v_row.pitch_allocation = 'Pitch 2 (top field)' and v_row.pitch_id is null
                        and v_row.home_changing_room_number = 4 and v_row.away_changing_room_number = 7 and not v_row.no_changing_rooms,
    'N1 the pitch is written down and the rooms numbered, for this match alone');
  perform pg_temp.act('authenticated', v_coach_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_fd, jsonb_build_object('home_room_number', 21))) = '22023',
    'N2 rooms run 1 to 20');
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_fd, jsonb_build_object('venue_id', v_vh1))) = '22023',
    'N3 and no Ovalball club''s ground can be pinned to a host that is not that club');
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_fd, jsonb_build_object('home_room_id', v_rh1))) = '22023',
    'N4 nor any Ovalball club''s room');
  perform public.set_fixture_facilities(v_fd, jsonb_build_object('no_changing_rooms', true));
  perform pg_temp.act_postgres();
  select * into v_row from public.fixtures where id = v_fd;
  perform pg_temp.check(v_row.no_changing_rooms and v_row.home_changing_room_number is null and v_row.away_changing_room_number is null,
    'N5 "no changing rooms" is its own answer, and clears any numbers');
  perform pg_temp.check(pg_temp.try(format('update public.fixtures set home_changing_room_number = 2 where id = %L', v_fd)) = '23514',
    'N6 the table will not hold a room AND "no rooms"');
  select * into v_row from public.fixtures where id = v_ft;
  perform pg_temp.check(not v_row.no_changing_rooms and v_row.home_changing_room_number is null,
    'N7 while a match nobody has arranged is "not set", not "none"');

  -- ===============================================================================================
  -- S. SWITCHING HOME AND AWAY -- both rows, every direction
  -- ===============================================================================================
  -- Claimed -> claimed, on a mirrored pair. The capacity guard (which predates this work) refuses ANY
  -- write to a legacy pair, because it sees the pair's two rows as two matches on one day; it is set aside
  -- for S1-S7 so the pair-sync itself can be proved, and that pre-existing limit is reported separately.
  perform pg_temp.act_postgres();
  alter table public.fixtures disable trigger enforce_shared_team_fixture_capacity;
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.set_fixture_facilities(v_fm, jsonb_build_object('venue_id', v_vh1, 'pitch_id', v_ph1, 'home_room_id', v_rh1, 'away_room_id', v_rh2));
  perform pg_temp.act_postgres();
  select * into v_row2 from public.fixtures where id = v_fm2;
  perform pg_temp.check(v_row2.venue_id = v_vh1 and v_row2.pitch_id = v_ph1 and v_row2.home_changing_room_id = v_rh1,
    'S1 the arrangements are written to both clubs'' rows of the match');
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.update_fixture_details(v_fm, jsonb_build_object('home_away', 'Away'));
  perform pg_temp.act_postgres();
  select * into v_row from public.fixtures where id = v_fm;
  select * into v_row2 from public.fixtures where id = v_fm2;
  perform pg_temp.check(v_row.home_away = 'Away' and v_row2.home_away = 'Home', 'S2 Home -> Away flips the other club''s row the other way');
  perform pg_temp.check(v_row.venue_id = v_va1 and v_row2.venue_id = v_va1, 'S3 and both rows move to the new host''s default ground');
  perform pg_temp.check(v_row.pitch_id is null and v_row.home_changing_room_id is null and v_row.away_changing_room_id is null
                        and v_row2.pitch_id is null and v_row2.home_changing_room_id is null and v_row2.away_changing_room_id is null,
    'S4 with nothing of the old host''s pitch or rooms on either row');
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(pg_temp.try(format('select public.set_fixture_facilities(%L, %L::jsonb)', v_fm2, jsonb_build_object('pitch_id', v_pa1, 'home_room_id', v_ra1))) = 'OK',
    'S5 the new host arranges its own pitch and room');
  perform pg_temp.act_postgres();
  select * into v_row from public.fixtures where id = v_fm;
  perform pg_temp.check(v_row.pitch_id = v_pa1 and v_row.home_changing_room_id = v_ra1, 'S6 and the other row reads the same');
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.swap_fixture_home_away(v_fm);
  perform pg_temp.act_postgres();
  select * into v_row from public.fixtures where id = v_fm;
  select * into v_row2 from public.fixtures where id = v_fm2;
  perform pg_temp.check(v_row.home_away = 'Home' and v_row2.home_away = 'Away' and v_row.venue_id = v_vh1 and v_row2.venue_id = v_vh1
                        and v_row.pitch_id is null and v_row2.home_changing_room_id is null,
    'S7 swapping back returns both rows to the original host''s default, cleared');
  perform pg_temp.act_postgres();
  alter table public.fixtures enable trigger enforce_shared_team_fixture_capacity;

  -- Claimed -> unclaimed -> claimed.
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.update_fixture_details(v_fd, jsonb_build_object('home_away', 'Home'));
  perform pg_temp.act_postgres();
  select * into v_row from public.fixtures where id = v_fd;
  perform pg_temp.check(v_row.venue_id = v_vh1 and v_row.venue_address is null and v_row.pitch_allocation is null
                        and v_row.home_changing_room_number is null and not v_row.no_changing_rooms,
    'S8 unclaimed -> claimed: our default ground; the typed pitch, numbers and "no rooms" are gone');
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.set_fixture_facilities(v_fd, jsonb_build_object('pitch_id', v_ph1, 'home_room_id', v_rh1));
  perform public.update_fixture_details(v_fd, jsonb_build_object('home_away', 'Away'));
  perform pg_temp.act_postgres();
  select * into v_row from public.fixtures where id = v_fd;
  perform pg_temp.check(v_row.venue_id is null and v_row.venue_address ilike 'Powder House Lane%' and v_row.pitch_id is null
                        and v_row.home_changing_room_id is null,
    'S9 claimed -> unclaimed: back to their Club Directory ground, none of our records left behind');
  perform pg_temp.act('authenticated', v_coach_h);
  perform public.update_fixture_details(v_fd, jsonb_build_object('home_away', 'TBD'));
  perform pg_temp.act_postgres();
  select * into v_row from public.fixtures where id = v_fd;
  perform pg_temp.check(v_row.venue_id is null and v_row.pitch_id is null, 'S10 not agreed: no host, no ground record');

  -- ===============================================================================================
  -- T. THE PUBLIC TEAM PAGE
  -- ===============================================================================================
  perform pg_temp.act_postgres();
  insert into public.team_contacts (team_id, name, role, phone, is_public) values (v_team_h, 'Coach Own', 'head_coach', '07700 900111', true);
  insert into public.team_contacts (team_id, name, role, phone, is_public) values (v_team_h, 'Team Line', 'team_manager', '01234 567890', true);
  -- A number the club keeps private is never handed to another club.
  insert into public.club_contacts (club_id, name, role, phone, is_public) values (v_club_h, 'Private Line', 'general', '01234 111222', false);
  insert into public.team_media (club_id, team_id, storage_path, uploaded_by, state) values (v_club_h, v_team_h, v_team_h || '/one.jpg', v_coach_h, 'ACTIVE') returning id into v_media;
  insert into public.team_media (club_id, team_id, storage_path, uploaded_by, state) values (v_club_h, v_team_h, v_team_h || '/two.jpg', v_coach_h, 'ACTIVE') returning id into v_media2;

  perform pg_temp.act('anon');
  v_json := public.get_public_team_profile(v_team_h);
  perform pg_temp.check(v_json is not null and v_json ->> 'description' = 'A friendly U12 side.' and (v_json ->> 'staffShown')::boolean
                        and jsonb_array_length(v_json -> 'staff') >= 1,
    'T1 by default the page is public, with the overview and the staff');
  perform pg_temp.check(v_json -> 'squad' = 'null'::jsonb and v_json -> 'media' = 'null'::jsonb, 'T2 and no squad and no photos');
  perform pg_temp.check(coalesce(v_json -> 'contact', 'null'::jsonb) = 'null'::jsonb and position('01234' in v_json::text) = 0 and position('07700' in v_json::text) = 0,
    'T3 a signed-out visitor is sent no contact at all');

  perform pg_temp.act('authenticated', v_coach_a);
  v_json := public.get_public_team_profile(v_team_h);
  perform pg_temp.check((v_json -> 'contact' ->> 'canMessage')::boolean and (v_json -> 'contact' ->> 'canCall')::boolean
                        and v_json -> 'contact' ->> 'phone' = '01234 567890' and v_json -> 'contact' ->> 'fixtureId' is not null,
    'T4 the opposition coach is offered Message Staff and Call, with the operational number');
  perform pg_temp.check(position('07700' in v_json::text) = 0 and v_json -> 'contact' ->> 'phoneLabel' = 'Team Manager',
    'T4a never a coach''s own entry, and labelled in words rather than a stored key');
  perform pg_temp.check(position('01234 111222' in v_json::text) = 0, 'T4c nor a club number the club keeps private');
  perform pg_temp.act_postgres();
  insert into public.club_contacts (club_id, name, role, phone, is_public) values (v_club_h, 'Fixtures', 'fixture_secretary', '01234 000999', true);
  perform pg_temp.act('authenticated', v_coach_a);
  v_json := public.get_public_team_profile(v_team_h);
  perform pg_temp.check(v_json -> 'contact' ->> 'phone' = '01234 000999' and v_json -> 'contact' ->> 'phoneLabel' = 'Fixture Secretary',
    'T4b the club''s fixture secretary is whom another club calls first');
  perform pg_temp.act_postgres();
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'Home', 'MCF Away RFC', current_date - 1, '10:30', 'Booked', 'club_created');
  perform pg_temp.act('authenticated', v_coach_a);
  v_json := public.get_public_team_profile(v_team_h);
  perform pg_temp.check(v_json -> 'contact' ->> 'fixtureId' = v_f::text,
    'T4d Message Staff opens the NEXT match against them, not yesterday''s nearer one');
  perform pg_temp.act('authenticated', v_admin_a);
  v_json := public.get_public_team_profile(v_team_h);
  perform pg_temp.check((v_json -> 'contact' ->> 'canMessage')::boolean, 'T5 so is the opposition''s Club Admin');
  foreach v_person in array array[v_parent_a, v_parent_h, v_member_h, v_stranger, v_coach_h] loop
    perform pg_temp.act('authenticated', v_person);
    v_json := public.get_public_team_profile(v_team_h);
    perform pg_temp.check(coalesce(v_json -> 'contact', 'null'::jsonb) = 'null'::jsonb and position('01234' in v_json::text) = 0 and position('07700' in v_json::text) = 0,
      format('T6 no contact, and no number, for %s', case v_person when v_parent_a then 'an opposition parent' when v_parent_h then 'the team''s own parent'
             when v_member_h then 'an ordinary member' when v_stranger then 'an unrelated Club Admin' else 'the team''s own coach' end));
  end loop;

  perform pg_temp.act('authenticated', v_coach_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_club_public_profile(%L, %L::jsonb)', v_club_h, '{"opposition_can_call": false}')) = '42501',
    'T7 a coach cannot change the club''s defaults');
  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(pg_temp.try(format('select public.set_club_public_profile(%L, %L::jsonb)', v_club_h, '{"opposition_can_call": false}')) = '42501',
    'T8 nor can another club''s admin');
  perform pg_temp.act('authenticated', v_admin_h);
  perform public.set_club_public_profile(v_club_h, '{"opposition_can_call": false}');
  perform pg_temp.act('authenticated', v_coach_a);
  v_json := public.get_public_team_profile(v_team_h);
  perform pg_temp.check((v_json -> 'contact' ->> 'canMessage')::boolean and not (v_json -> 'contact' ->> 'canCall')::boolean
                        and v_json -> 'contact' ->> 'phone' is null and position('01234' in v_json::text) = 0 and position('07700' in v_json::text) = 0,
    'T9 the club turns Call off: Message stays, and the number is no longer sent');
  perform pg_temp.act('authenticated', v_admin_h);
  perform public.set_team_public_profile(v_team_h, '{"opposition_can_call": true}');
  perform pg_temp.act('authenticated', v_coach_a);
  v_json := public.get_public_team_profile(v_team_h);
  perform pg_temp.check((v_json -> 'contact' ->> 'canCall')::boolean, 'T10 the team''s own choice beats the club default');
  perform pg_temp.act('authenticated', v_admin_h);
  perform public.set_team_public_profile(v_team_h, '{"opposition_can_call": null, "opposition_can_message": false}');
  perform pg_temp.act('authenticated', v_coach_a);
  v_json := public.get_public_team_profile(v_team_h);
  perform pg_temp.check(coalesce(v_json -> 'contact', 'null'::jsonb) = 'null'::jsonb,
    'T11 back to the club default for Call (off), and Message off: no contact block at all');

  perform pg_temp.act('authenticated', v_admin_h);
  perform public.set_club_public_profile(v_club_h, '{"show_staff": false, "show_overview": false}');
  perform pg_temp.act('anon');
  v_json := public.get_public_team_profile(v_team_h);
  perform pg_temp.check(not (v_json ->> 'staffShown')::boolean and jsonb_array_length(v_json -> 'staff') = 0 and v_json ->> 'description' is null,
    'T12 staff and overview off: not sent');
  perform pg_temp.act('authenticated', v_admin_h);
  perform public.set_club_public_profile(v_club_h, '{"profile_public": false}');
  perform pg_temp.act('anon');
  perform pg_temp.check(public.get_public_team_profile(v_team_h) is null, 'T13 a private page is nothing to a visitor');
  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(public.get_public_team_profile(v_team_h) is null, 'T14 or to another club''s admin');
  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(public.get_public_team_profile(v_team_h) is not null, 'T15 while the team''s own family still sees its page');
  perform pg_temp.act('authenticated', v_admin_h);
  perform public.set_club_public_profile(v_club_h, '{"profile_public": true, "show_staff": true, "show_overview": true, "share_squad": true, "share_media": true}');

  -- Squad numbers and positions.
  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_team_squad_detail(%L, %L, 9, %L)', v_team_h, v_child_h, 'scrum_half')) = '42501',
    'T16 a guardian cannot set squad numbers');
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(pg_temp.try(format('select public.set_team_squad_detail(%L, %L, 9, %L)', v_team_h, v_child_h, 'scrum_half')) = '42501',
    'T17 nor the opposition''s coach');
  perform pg_temp.act('authenticated', v_member_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_team_squad_detail(%L, %L, 9, %L)', v_team_h, v_child_h, 'scrum_half')) = '42501',
    'T17a nor an ordinary member of the club');
  perform pg_temp.act('authenticated', v_coach_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_team_squad_detail(%L, %L, 10, %L)', v_team_h, v_child_h, 'fly_half')) = 'OK',
    'T17b the side''s coach sets a number and position (match-day selection)');
  perform pg_temp.check(not internal.can('team.roster.manage', 'team', v_club_h, v_team_h, null),
    'T17c without gaining any say over who is in the squad');
  perform pg_temp.act('authenticated', v_admin_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_team_squad_detail(%L, %L, 9, %L)', v_team_h, v_child_h, 'stand_off')) = '22023',
    'T18 a rugby league position is refused for a union side');
  perform pg_temp.check(pg_temp.try(format('select public.set_team_squad_detail(%L, %L, 100, null)', v_team_h, v_child_h)) <> 'OK',
    'T19 numbers run 0 to 99');
  perform pg_temp.check(pg_temp.try(format('select public.set_team_squad_detail(%L, %L, 9, %L)', v_team_h, v_child_a, 'scrum_half')) <> 'OK',
    'T20 and only for a player in this squad');
  perform public.set_team_squad_detail(v_team_h, v_child_h, 9, 'scrum_half');
  perform pg_temp.act('anon');
  v_json := public.get_public_team_profile(v_team_h);
  perform pg_temp.check((select (p ->> 'shirtNumber')::int = 9 and p ->> 'positionKey' = 'scrum_half' and p ->> 'name' = 'Harvey H.'
                           from jsonb_array_elements(v_json -> 'squad') p where p ->> 'playerId' = v_child_h::text),
    'T21 shared, the squad shows first name, surname initial, number and position -- nothing more');
  perform pg_temp.check(position('Homeside' in v_json::text) = 0 and position('date_of_birth' in v_json::text) = 0,
    'T22 and no surname or date of birth anywhere in the payload');
  perform pg_temp.check(not (v_json ->> 'canEditSquad')::boolean, 'T23 a visitor is not offered the squad editor');

  -- Only the photos chosen for the public page.
  perform pg_temp.check(jsonb_array_length(v_json -> 'media') = 0, 'T24 sharing media shares nothing until a photo is chosen');
  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(pg_temp.try(format('select public.set_team_media_public(%L, true)', v_media)) = '42501', 'T25 a guardian cannot choose a photo');
  perform pg_temp.act('authenticated', v_coach_a);
  perform pg_temp.check(pg_temp.try(format('select public.set_team_media_public(%L, true)', v_media)) = '42501', 'T26 nor the opposition');
  perform pg_temp.act('authenticated', v_admin_h);
  perform public.set_team_media_public(v_media, true);
  perform pg_temp.act('anon');
  v_json := public.get_public_team_profile(v_team_h);
  perform pg_temp.check(jsonb_array_length(v_json -> 'media') = 1 and v_json -> 'media' -> 0 ->> 'id' = v_media::text,
    'T27 the chosen photo is public; the other is not');
  perform pg_temp.act_postgres();
  select storage_path into v_path from public.team_media where id = v_media;
  perform pg_temp.check(internal.team_gallery_media_is_public(v_path), 'T28 and storage agrees for the chosen photo');
  select storage_path into v_path from public.team_media where id = v_media2;
  perform pg_temp.check(not internal.team_gallery_media_is_public(v_path), 'T29 and refuses the one that was not chosen');
end $$;

rollback;
