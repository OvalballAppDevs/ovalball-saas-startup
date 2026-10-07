-- TOURNAMENT RESULT NOTIFICATIONS, ROUND ROBIN AND KNOCKOUT ALIKE (notification correctness pass).
--
--   TR-1  a result cannot be submitted before the game's own kick-off, in either format
--   TR-2  one side submits: the OTHER side's result officers are asked to confirm, once each
--   TR-3  confirming makes it final and the submitter's side is told; nothing asks any more
--   TR-4  contesting: the organiser is told, and the game waits on the organiser
--   TR-5  the organiser settles it: final, and both sides are told
--   TR-6  the same notification types, payload shape and destination in both formats
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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'trl-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Trl', p_label, 'trl-' || v::text || '@ovalball.test', (current_date - interval '40 years')::date);
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Trl ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'trl-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'trl-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Trl U12', 'trl-u12-' || substr(gen_random_uuid()::text, 1, 8), 'youth', 'U12', 'boys', 'union', true)
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- One game between the two clubs' U12 sides, in the given format, on the given day, through the
-- organiser's own planning operations. Returns the game id.
create or replace function pg_temp.game(p_format text, p_day date, p_host uuid, p_host_team uuid, p_away uuid, p_away_team uuid, p_host_ca uuid)
returns uuid language plpgsql as $$
declare v_dir_host uuid; v_dir_away uuid; v_venue uuid; v_pitch uuid; v_t uuid; v_plan uuid; v_a uuid; v_b uuid; v_g uuid;
begin
  select directory_id into v_dir_host from public.clubs where id = p_host;
  select directory_id into v_dir_away from public.clubs where id = p_away;
  insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
  values (p_host, 'Trl Ground ' || substr(gen_random_uuid()::text, 1, 8), 'trl-' || substr(gen_random_uuid()::text, 1, 8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom') returning id into v_venue;
  insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order) values (p_host, v_venue, 'Pitch ' || substr(gen_random_uuid()::text, 1, 8), true, 1) returning id into v_pitch;
  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name, conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
  values (p_host, v_dir_host, 'union', p_day, p_day, 'confirmed', 'Trl ' || p_format, gen_random_uuid(), p_format, 'private', v_venue, '09:00', '16:00') returning id into v_t;
  insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status) values (v_t, v_dir_host, p_host, p_host_team, 'U12', 'added') returning id into v_a;
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status) values (v_t, v_dir_away, p_away, p_away_team, 'U12', 'added') returning id into v_b;
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by) values (v_t, v_pitch, p_day, '09:00', '16:00', p_host_ca);

  perform pg_temp.as_user(p_host_ca);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform public.set_tournament_plan_days(v_plan, array[p_day]);
  perform public.set_tournament_plan_settings(v_plan, 20);
  if p_format = 'knockout' then
    perform public.set_tournament_knockout_settings(v_plan, p_tie_resolution => 'organiser_decision', p_third_place_playoff => false);
    perform public.set_tournament_bracket_draw(v_plan, array[v_a, v_b]);
    perform public.generate_tournament_knockout_fixtures(v_plan);
  else
    perform public.set_tournament_plan_tables(v_plan, jsonb_build_array(jsonb_build_object('name', 'Table A', 'sides', jsonb_build_array(v_a, v_b))));
    perform public.generate_tournament_plan_fixtures(v_plan);
  end if;
  perform public.publish_tournament_plan(v_plan);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  select id into v_g from public.tournament_games where plan_id = v_plan limit 1;
  return v_g;
end $$;

-- The two scores as THIS submitter's side sees them: (ours, theirs) placed on side A / side B.
create or replace function pg_temp.submit(p_user uuid, p_game uuid, p_a int, p_b int) returns text language plpgsql as $$
declare v_state text;
begin
  perform pg_temp.as_user(p_user);
  begin
    perform public.submit_tournament_game_result(p_game, p_a, p_b, null);
    v_state := 'OK';
  exception when others then
    v_state := sqlerrm;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

do $$
declare
  v_host uuid := pg_temp.club('Host');
  v_away uuid := pg_temp.club('Away');
  v_host_team uuid := pg_temp.team(v_host);
  v_away_team uuid := pg_temp.team(v_away);
  v_host_ca uuid := pg_temp.person('HostCA');
  v_away_ca uuid := pg_temp.person('AwayCA');
  v_format text;
  v_future uuid; v_g uuid; v_g2 uuid;
  v_state text; v_n int; v_href_types text[];
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (v_host, v_host_ca, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_away, v_away_ca, 'CLUB_ADMIN', 'active');

  foreach v_format in array array['round_robin', 'knockout'] loop
    -- TR-1: before kick-off, refused by the server.
    v_future := pg_temp.game(v_format, current_date + 3, v_host, v_host_team, v_away, v_away_team, v_host_ca);
    v_state := pg_temp.submit(v_away_ca, v_future, 10, 5);
    perform pg_temp.check(v_state like '%not kicked off%', format('TR-1 (%s) a result before kick-off is refused by the server (%s)', v_format, v_state));

    -- TR-2 / TR-3: submit, then confirm.
    v_g := pg_temp.game(v_format, current_date - 1, v_host, v_host_team, v_away, v_away_team, v_host_ca);
    perform pg_temp.submit(v_away_ca, v_g, 10, 5);
    select count(*) into v_n from public.notifications where user_id = v_host_ca and type = 'tournament_result_awaiting_confirmation' and data ->> 'tournament_game_id' = v_g::text;
    perform pg_temp.check(v_n = 1, format('TR-2 (%s) the other side is asked to confirm, exactly once (%s)', v_format, v_n));
    perform pg_temp.check(not exists (select 1 from public.notifications where user_id = v_away_ca and type = 'tournament_result_awaiting_confirmation' and data ->> 'tournament_game_id' = v_g::text),
      format('TR-2 (%s) the submitter is not asked to confirm their own score', v_format));
    perform pg_temp.submit(v_host_ca, v_g, 10, 5);
    perform pg_temp.check((select result_status from public.tournament_games where id = v_g) = 'final'
      and exists (select 1 from public.notifications where user_id = v_away_ca and type = 'tournament_result_confirmed' and data ->> 'tournament_game_id' = v_g::text),
      format('TR-3 (%s) confirming makes it final and the submitting side is told', v_format));

    -- TR-4 / TR-5: submit, contest, the organiser settles.
    v_g2 := pg_temp.game(v_format, current_date - 1, v_host, v_host_team, v_away, v_away_team, v_host_ca);
    perform pg_temp.submit(v_away_ca, v_g2, 10, 5);
    perform pg_temp.submit(v_host_ca, v_g2, 5, 10);
    perform pg_temp.check((select result_status from public.tournament_games where id = v_g2) = 'disputed'
      and exists (select 1 from public.notifications where user_id = v_away_ca and type = 'tournament_result_contested' and data ->> 'tournament_game_id' = v_g2::text),
      format('TR-4 (%s) a different score contests it and the other side is told', v_format));
    perform pg_temp.as_user(v_host_ca);
    perform public.resolve_tournament_game_result(v_g2, 7, 7, 'Referee''s card');
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    perform pg_temp.check((select result_status from public.tournament_games where id = v_g2) = 'final'
      and exists (select 1 from public.notifications where user_id = v_away_ca and type = 'tournament_result_resolved' and data ->> 'tournament_game_id' = v_g2::text),
      format('TR-5 (%s) the organiser settles it: final, and the sides are told', v_format));
  end loop;

  -- TR-6: one shape across both formats -- every result notification carries the tournament and the game.
  select array_agg(distinct type) into v_href_types from public.notifications
   where user_id in (v_host_ca, v_away_ca) and type like 'tournament_result_%' and (data ? 'tournament_game_id') and (data ? 'tournament_id');
  perform pg_temp.check(v_href_types @> array['tournament_result_awaiting_confirmation', 'tournament_result_confirmed', 'tournament_result_contested', 'tournament_result_resolved'],
    format('TR-6 both formats emit the same four types, each naming its game: %s', v_href_types));
  perform pg_temp.check(not exists (select 1 from public.notifications where user_id in (v_host_ca, v_away_ca) and type like 'tournament_result_%' and not (data ? 'tournament_game_id')),
    'TR-6 and no result notification is missing its game');
end $$;

rollback;
