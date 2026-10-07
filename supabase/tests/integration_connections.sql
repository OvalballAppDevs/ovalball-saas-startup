-- =====================================================================================================
-- ONE CONNECTED SYSTEM (integration audit, 20270730000000_a_ground_has_one_name_on_every_surface)
--
-- The server half of "a match, an event and a list say the same thing about the same object":
--
--   G  ONE GROUND. A fixture's ground is decided once (internal.fixture_ground_id) and every surface asks
--      it: Match Centre (get_match_centre_viewer.ground) and every list (schedule_grounds). A visiting
--      family, who cannot read the host club's venue rows, is told the same ground Match Centre names --
--      and nobody is told about a fixture they cannot already see.
--   V  ONE VENUE. A club's event at its own ground references the same canonical venue a match there does,
--      and an invited guest from outside the club is told where it is.
--   P  ONE PERSON. An award names its winner by the canonical player, never by a copied name.
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
  v_parent_h uuid := gen_random_uuid();  -- guardian, home child
  v_parent_a uuid := gen_random_uuid();  -- guardian, away child (a visiting family)
  v_stranger uuid := gen_random_uuid();  -- Club Admin somewhere else entirely
  v_admin_a uuid := gen_random_uuid();   -- Club Admin, the away club (joins for the Home/Away case only)
  v_fs uuid;     -- home v away, Away until the Home/Away switch
  v_dir_h uuid; v_dir_a uuid; v_dir_c uuid;
  v_club_h uuid; v_club_a uuid; v_club_c uuid;
  v_team_h uuid; v_team_a uuid;
  v_child_h uuid; v_child_a uuid;
  v_vh1 uuid; v_vh2 uuid; v_va1 uuid; v_ph1 uuid;
  v_f uuid;      -- home v away, Home, nothing chosen yet (a legacy-shaped row)
  v_fv uuid;     -- home v away, Home, at the home club's second ground, Pitch 1 allocated
  v_ft uuid;     -- typed place, nothing chosen
  v_fu uuid;     -- home or away not agreed
  v_e uuid;      -- the home club's event at its main ground
  v_dir_x uuid;  -- a Club Directory club that is not on Ovalball
  v_fx uuid;     -- home v that Directory club: a kick-off change applies at once (nobody else to agree)
  v_json jsonb; v_n int; v_ids uuid[];
begin
  -- ------------------------------------------------------------------------------------- the people
  foreach v_person in array array[v_admin_h, v_parent_h, v_parent_a, v_stranger, v_admin_a] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'ic-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Integration', 'Person', 'ic-' || v_person::text || '@ovalball.test', (current_date - interval '40 years')::date)
    on conflict (id) do nothing;
  end loop;

  -- ------------------------------------------------------------------------------------- clubs, teams, children
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('IC Home RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ic-h-' || v_tag) returning id into v_dir_h;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('IC Away RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ic-a-' || v_tag) returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('IC Elsewhere RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ic-c-' || v_tag) returning id into v_dir_c;
  insert into public.clubs (directory_id, slug, status) values (v_dir_h, 'ic-h-' || v_tag, 'active') returning id into v_club_h;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'ic-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c, 'ic-c-' || v_tag, 'active') returning id into v_club_c;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_h, 'Under 12 Boys', 'ic-h-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_h;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_a, 'Under 12 Boys', 'ic-a-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_a;
  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_h, v_admin_h, 'CLUB_ADMIN', 'active'), (v_club_h, v_parent_h, 'BASIC_USER', 'active'),
    (v_club_a, v_parent_a, 'BASIC_USER', 'active'), (v_club_c, v_stranger, 'CLUB_ADMIN', 'active');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Harvey', 'Homeside' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_child_h;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Aled', 'Awayside' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_child_a;
  insert into public.player_team_memberships (player_id, team_id, status, state) values (v_child_h, v_team_h, 'active', 'ACTIVE'), (v_child_a, v_team_a, 'active', 'ACTIVE');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by) values
    (v_parent_h, v_child_h, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent_h),
    (v_parent_a, v_child_a, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent_a);

  -- ------------------------------------------------------------------------------------- grounds
  insert into public.venues (club_id, name, slug, is_default_home, active, address_line_1, town, postcode)
  values (v_club_h, 'IC Home Main Ground', 'ic-vh1-' || v_tag, true, true, '1 Home Lane', 'Hometown', 'HM1 1AA') returning id into v_vh1;
  insert into public.venues (club_id, name, slug, is_default_home, active) values (v_club_h, 'IC Home Second Ground', 'ic-vh2-' || v_tag, false, true) returning id into v_vh2;
  insert into public.venues (club_id, name, slug, is_default_home, active) values (v_club_a, 'IC Away Main Ground', 'ic-va1-' || v_tag, true, true) returning id into v_va1;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values (v_club_h, v_vh2, 'Pitch 1', true) returning id into v_ph1;

  -- ------------------------------------------------------------------------------------- fixtures
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'Home', 'IC Away RFC', current_date + 3, '10:30', 'Booked', 'club_created') returning id into v_f;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, venue_id, pitch_id)
  values (v_team_h, v_team_a, 'Home', 'IC Away RFC', current_date + 17, '10:30', 'Booked', 'club_created', v_vh2, v_ph1) returning id into v_fv;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, venue_address)
  values (v_team_h, v_team_a, 'Home', 'IC Away RFC', current_date + 24, '10:30', 'Booked', 'club_created', 'Memorial Park, Hometown') returning id into v_ft;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'TBD', 'IC Away RFC', current_date + 31, '10:30', 'Booked', 'club_created') returning id into v_fu;

  -- ===============================================================================================
  -- G. ONE GROUND, ON EVERY SURFACE
  -- ===============================================================================================
  perform pg_temp.act_postgres();
  perform pg_temp.check(internal.fixture_ground_id(v_f) = v_vh1,
    'G1 nothing chosen yet: the ground is the canonical host''s default ground');
  perform pg_temp.check(internal.fixture_ground_id(v_fv) = v_vh2, 'G2 a chosen ground always wins');
  perform pg_temp.check(internal.fixture_ground_id(v_ft) is null,
    'G3 a place the fixture typed for itself is not overridden by a default ground');
  perform pg_temp.check(internal.fixture_ground_id(v_fu) is null, 'G4 with home or away not agreed there is no host, so no ground');

  perform pg_temp.act('authenticated', v_parent_a);
  perform pg_temp.check(not exists (select 1 from public.venues where id in (v_vh1, v_vh2)),
    'G5 the visiting family cannot read the home club''s venue rows (why a list could not name the ground)');
  select count(*) into v_n from public.schedule_grounds(array[v_f, v_fv, v_ft, v_fu]);
  perform pg_temp.check(v_n = 2, format('G6 the visiting family is told the ground of each match that has one (%s)', v_n));
  perform pg_temp.check((select name from public.schedule_grounds(array[v_f]) ) = 'IC Home Main Ground'
                        and (select name from public.schedule_grounds(array[v_f])) = public.get_match_centre_viewer(v_f) -> 'ground' ->> 'name',
    'G7 and the list names the SAME ground Match Centre names');
  perform pg_temp.check((select name = 'IC Home Second Ground' and pitch_name = 'Pitch 1' from public.schedule_grounds(array[v_fv])),
    'G8 the chosen ground and its allocated pitch, for the visitors too');
  perform pg_temp.check((public.get_match_centre_viewer(v_fv) -> 'ground' ->> 'id')::uuid = v_vh2,
    'G9 Match Centre reads the same canonical rule (internal.fixture_ground_id)');

  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(not exists (select 1 from public.schedule_grounds(array[v_f, v_fv])),
    'G10 somebody who cannot see the match is told nothing about where it is');
  perform pg_temp.check(not exists (select 1 from public.schedule_grounds(array[gen_random_uuid()])),
    'G11 an unknown id is simply absent -- never an error that would confirm it exists');
  select array_agg(gen_random_uuid()) into v_ids from generate_series(1, 1001);
  perform pg_temp.check(pg_temp.try(format('select count(*) from public.schedule_grounds(%L::uuid[])', v_ids)) = '22023',
    'G12 a list asks for at most 1000 grounds at once');
  perform pg_temp.act('anon');
  perform pg_temp.check(pg_temp.try(format('select count(*) from public.schedule_grounds(%L::uuid[])', array[v_f])) <> 'OK',
    'G13 a signed-out visitor cannot ask');

  -- ===============================================================================================
  -- V. ONE VENUE ACROSS MATCH AND EVENT
  -- ===============================================================================================
  perform pg_temp.act('authenticated', v_admin_h);
  v_e := (public.save_event(null, v_club_h, jsonb_build_object('name', 'IC Awards Evening', 'event_type', 'AWARDS', 'starts_on', current_date + 40,
    'start_time', '19:00', 'is_club_wide', false, 'team_ids', jsonb_build_array(v_team_h),
    'location_kind', 'VENUE', 'venue_id', v_vh1)) ->> 'eventId')::uuid;
  perform pg_temp.check(pg_temp.try(format('select public.save_event(%L, null, %L::jsonb)', v_e, jsonb_build_object('individual_user_ids', jsonb_build_array(v_parent_a)))) = '42501',
    'V0 an event invites people from its own club only -- an outside guest is recorded as a guest, never handed the club''s data');
  perform public.send_event_invitations(v_e, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check((select venue_id from public.club_events where id = v_e) = internal.fixture_ground_id(v_f),
    'V1 the club''s event at its own ground references the same canonical venue its home match does');
  perform pg_temp.act('authenticated', v_parent_h);
  perform pg_temp.check(exists (select 1 from public.club_events where id = v_e),
    'V2 the invited family sees the event');
  perform pg_temp.check((select name from public.schedule_grounds('{}'::uuid[], '{}'::uuid[], array[v_e])) = 'IC Home Main Ground'
                        and (select name from public.schedule_grounds(array[v_f])) = 'IC Home Main Ground',
    'V3 and is told the same ground for the event as for the match played there');
  perform pg_temp.act('authenticated', v_parent_a);
  perform pg_temp.check(not exists (select 1 from public.schedule_grounds('{}'::uuid[], '{}'::uuid[], array[v_e])),
    'V4 a family the event is not for is told nothing about it -- while still told where their own match is');
  perform pg_temp.act('authenticated', v_stranger);
  perform pg_temp.check(not exists (select 1 from public.schedule_grounds('{}'::uuid[], '{}'::uuid[], array[v_e])),
    'V5 nor is somebody from another club');

  -- ===============================================================================================
  -- N. ONE SAVE, ONE NOTICE (20270734)
  -- ===============================================================================================
  perform pg_temp.act_postgres();
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('IC Directory RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ic-x-' || v_tag) returning id into v_dir_x;
  insert into public.fixtures (owning_team_id, opponent_directory_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, venue_id)
  values (v_team_h, v_dir_x, 'Home', 'IC Directory RUFC', current_date + 45, '10:30', 'Booked', 'club_created', v_vh1) returning id into v_fx;
  perform pg_temp.act('authenticated', v_admin_h);
  v_json := public.save_match_details(v_fx, jsonb_build_object(
    'kickoff', jsonb_build_object('date', (current_date + 45)::text, 'time', '11:15'),
    'facilities', jsonb_build_object('venue_id', v_vh2::text, 'pitch_id', v_ph1::text)));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select count(*) from public.notifications where user_id = v_parent_h and data ->> 'fixture_id' = v_fx::text) = 1,
    format('N1 a Save that moved the kick-off AND the ground tells the family once (%s)', (select count(*) from public.notifications where user_id = v_parent_h and data ->> 'fixture_id' = v_fx::text)));
  perform pg_temp.check(exists (select 1 from public.notifications where user_id = v_parent_h and data ->> 'fixture_id' = v_fx::text
                                  and title = 'Match details changed' and body like '%11:15%' and body like '%Pitch 1%'),
    'N2 and that one notice says both things');
  perform pg_temp.check(not exists (select 1 from public.notifications where data ->> 'fixture_id' = v_fx::text group by user_id having count(*) > 1),
    'N3 nobody at all is told twice');
  perform pg_temp.check(not exists (select 1 from internal.notification_batch_items), 'N4 nothing is left held once the Save is done');
  perform pg_temp.act('authenticated', v_admin_h);
  perform public.update_fixture_kickoff(v_fx, current_date + 45, '12:00');
  perform pg_temp.act_postgres();
  perform pg_temp.check((select count(*) from public.notifications where user_id = v_parent_h and data ->> 'fixture_id' = v_fx::text) = 2,
    'N5 a writer called on its own still tells people straight away -- the hold belongs to a Save alone');

  -- A HOME/AWAY SWITCH IS ONE CHANGE. The website saved it as two requests -- update_fixture_details, then
  -- update_fixture_schedule for the new ground and pitch -- so the other club's staff were told twice ("now at
  -- their ground", then "where the match is"). It now sends both as one save (`schedule` in save_match_details).
  perform pg_temp.act_postgres();
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_admin_a, 'CLUB_ADMIN', 'active');
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_h, v_team_a, 'Away', 'IC Away RFC', current_date + 52, '10:30', 'Booked', 'club_created') returning id into v_fs;
  perform pg_temp.act('authenticated', v_admin_h);
  v_json := public.save_match_details(v_fs, jsonb_build_object(
    'details', jsonb_build_object('home_away', 'Home'),
    'schedule', jsonb_build_object('venue_id', v_vh2::text, 'pitch_id', v_ph1::text, 'source', 'fixture_editor')));
  perform pg_temp.act_postgres();
  perform pg_temp.check((select home_away = 'Home' and venue_id = v_vh2 and pitch_id = v_ph1 from public.fixtures where id = v_fs),
    'N6 one save switches the match home and puts it on the chosen ground and pitch');
  perform pg_temp.check((select count(*) from public.notifications where user_id = v_admin_a and data ->> 'fixture_id' = v_fs::text) = 1,
    format('N7 the other club''s administrator is told once, not once per writer (%s)', (select count(*) from public.notifications where user_id = v_admin_a and data ->> 'fixture_id' = v_fs::text)));
  perform pg_temp.check(not exists (select 1 from public.notifications where data ->> 'fixture_id' = v_fs::text group by user_id having count(*) > 1)
                        and (v_json ->> 'kickoffProposed')::boolean is false,
    'N8 nobody at all is told twice, and an unchanged kick-off is not proposed');

  -- ===============================================================================================
  -- P. ONE PERSON
  -- ===============================================================================================
  perform pg_temp.act_postgres();
  perform pg_temp.check(not exists (select 1 from information_schema.columns
                                     where table_schema = 'public' and table_name in ('match_awards', 'match_award_votes')
                                       and (column_name like '%name%' or column_name like '%initials%')),
    'P1 an award and a vote name the canonical player by id; no copied name can drift from the player');
  perform pg_temp.check(not exists (select 1 from information_schema.columns
                                     where table_schema = 'public' and table_name in ('club_event_responses', 'club_event_invitees')
                                       and (column_name like '%first_name%' or column_name like '%surname%' or column_name like '%full_name%')),
    'P2 an event answer names its child or person by id, never by a copied name');
end $$;

rollback;
