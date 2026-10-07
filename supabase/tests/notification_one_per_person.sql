-- ONE NOTIFICATION PER PERSON (notification closure UAT, 20270719000000).
--
--   OP-1  accepting a fixture request tells a person who holds two roles on the side once, not twice
--   OP-2  applying to a tournament tells an organiser who is both Club Admin and Fixtures Secretary once
--   OP-3  a published schedule names its tournament and age group, so two tournaments' notices differ
--
-- Self-seeding and rolled back. No persistent review identity is touched.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'opp-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Opp', p_label, 'opp-' || v::text || '@ovalball.test', (current_date - interval '40 years')::date);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Opp ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'opp-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'opp-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under 12 Boys', 'opp-u12-' || substr(gen_random_uuid()::text, 1, 8), 'youth', 'U12', 'boys', 'union', true)
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  v_secretary uuid := pg_temp.person('Secretary');
  v_two_hats uuid := pg_temp.person('TwoHats');
  v_other_admin uuid := pg_temp.person('OtherAdmin');
  v_organiser uuid := pg_temp.person('Organiser');
  v_applicant uuid := pg_temp.person('Applicant');
  v_club uuid := pg_temp.club('Home');
  v_other uuid := pg_temp.club('Away');
  v_team uuid := pg_temp.team(v_club);
  v_other_team uuid := pg_temp.team(v_other);
  v_ms uuid; v_org_ms uuid;
  v_batch uuid; v_row uuid; v_request uuid; v_fixture uuid;
  v_t uuid; v_t2 uuid; v_plan uuid; v_plan2 uuid; v_dir_club uuid; v_dir_other uuid;
  v_venue uuid; v_pitch uuid; v_a uuid; v_b uuid;
  v_n int; v_bodies text[];
begin
  perform pg_temp.member(v_club, v_secretary, 'FIXTURE_SECRETARY');
  perform pg_temp.member(v_other, v_other_admin, 'CLUB_ADMIN');
  v_ms := pg_temp.member(v_club, v_two_hats, 'BASIC_USER');
  insert into testing.team_roles (membership_id, team_id, role_key) values (v_ms, v_team, 'COACH');
  insert into testing.team_roles (membership_id, team_id, role_key) values (v_ms, v_team, 'TEAM_MANAGER');

  -- OP-1: the home secretary asks the other club; the other club accepts.
  perform pg_temp.as_user(v_secretary);
  insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
  values (v_secretary, 'opp suite', 1, 'processing', v_club) returning id into v_batch;
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, errors, resolved_home_team_id, resolved_away_team_id, raw_opposition_text, fixture_date, kickoff_time, home_away, notes)
  values (v_batch, 1, '{}'::jsonb, 'ready', '[]'::jsonb, v_team, v_other_team, 'Opp Away RUFC', current_date + 20, '10:30', 'Home', 'opp-1')
  returning id into v_row;
  v_request := public.publish_import_row(v_row);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_other_admin, 'role', 'authenticated')::text, true);
  v_fixture := public.accept_fixture_request(v_request, null);
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);

  select count(*) into v_n from public.notifications where user_id = v_two_hats and type = 'fixture_request_accepted' and data ->> 'fixture_id' = v_fixture::text;
  perform pg_temp.check(v_n = 1, format('OP-1 a person with two roles on the side is told once that the fixture is confirmed (%s)', v_n));
  perform pg_temp.check((select count(*) from public.notifications where type = 'fixture_request_accepted' and data ->> 'fixture_id' = v_fixture::text)
                      = (select count(distinct user_id) from public.notifications where type = 'fixture_request_accepted' and data ->> 'fixture_id' = v_fixture::text),
    'OP-1 and nobody is told twice');

  -- OP-2: an organiser holding Club Admin and Fixtures Secretary hears of one application once.
  v_org_ms := pg_temp.member(v_club, v_organiser, 'CLUB_ADMIN');
  insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, source, granted_by, reason)
  values (v_organiser, v_club, v_org_ms, 'FIXTURES_SECRETARY', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT', v_organiser, 'opp suite');
  perform pg_temp.member(v_other, v_applicant, 'CLUB_ADMIN');
  select directory_id into v_dir_club from public.clubs where id = v_club;
  select directory_id into v_dir_other from public.clubs where id = v_other;
  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name, conversation_id, format, visibility)
  values (v_club, v_dir_club, 'union', current_date + 20, current_date + 20, 'confirmed', 'Opp Open Festival', gen_random_uuid(), 'round_robin', 'public')
  returning id into v_t;
  insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');
  perform pg_temp.as_user(v_applicant);
  perform public.apply_to_tournament(v_t, v_other, 'U12', array[v_other_team]);
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.notifications where user_id = v_organiser and type = 'tournament_application_received' and data ->> 'tournament_id' = v_t::text;
  perform pg_temp.check(v_n = 1, format('OP-2 an organiser with two club roles is told of one application once (%s)', v_n));

  -- OP-3: two tournaments published together give two notices that say which is which.
  insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
  values (v_club, 'Opp Ground ' || substr(gen_random_uuid()::text, 1, 8), 'opp-' || substr(gen_random_uuid()::text, 1, 8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom') returning id into v_venue;
  insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order) values (v_club, v_venue, 'Pitch ' || substr(gen_random_uuid()::text, 1, 8), true, 1) returning id into v_pitch;
  for v_n in 1..2 loop
    insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name, conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
    values (v_club, v_dir_club, 'union', current_date + 30 + v_n, current_date + 30 + v_n, 'confirmed', 'Opp Festival ' || v_n, gen_random_uuid(), 'round_robin', 'private', v_venue, '09:00', '16:00')
    returning id into v_t2;
    insert into public.tournament_age_groups (tournament_id, age_group) values (v_t2, 'U12');
    insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status) values (v_t2, v_dir_club, v_club, v_team, 'U12', 'added') returning id into v_a;
    insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status) values (v_t2, v_dir_other, v_other, v_other_team, 'U12', 'added') returning id into v_b;
    insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by) values (v_t2, v_pitch, current_date + 30 + v_n, '09:00', '16:00', v_organiser);
    perform pg_temp.as_user(v_organiser);
    v_plan := public.start_tournament_plan(v_t2, 'U12');
    perform public.set_tournament_plan_days(v_plan, array[current_date + 30 + v_n]);
    perform public.set_tournament_plan_settings(v_plan, 20);
    perform public.set_tournament_plan_tables(v_plan, jsonb_build_array(jsonb_build_object('name', 'Table A', 'sides', jsonb_build_array(v_a, v_b))));
    perform public.generate_tournament_plan_fixtures(v_plan);
    perform public.publish_tournament_plan(v_plan);
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
  end loop;
  select array_agg(distinct body order by body) into v_bodies from public.notifications
   where user_id = v_other_admin and type = 'tournament_schedule_published';
  perform pg_temp.check(v_bodies = array['The U12 schedule for Opp Festival 1 has been published.', 'The U12 schedule for Opp Festival 2 has been published.'],
    format('OP-3 each schedule notice names its tournament and age group: %s', v_bodies));
end $$;

rollback;
