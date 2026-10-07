-- A TOURNAMENT PLAN IS EDITED, NOT REBUILT (20270736).
--
-- WHAT THIS GUARDS
--
-- The organiser's job: "I have teams, dates and pitches. Build me a workable tournament, let me control
-- where and when every game happens, publish it, and let me safely change it afterwards." This suite is
-- the product owner's own cases, run against the one canonical planner:
--
--   A. Eight teams on four pitches play four games at the same kick-off -- accepted. Two games on one
--      whole pitch at once, one team on two pitches at once, a pitch not reserved, a time outside the
--      playing hours and a game longer than the age grade allows -- each refused, in words, changing
--      nothing.
--   B. The live Bolton Festival's shape: the 09:50 Pitch 2 game moved to 10:15 on Pitch 1. On its own it
--      is refused (Bolton would be in two games at 10:15); saved together with the 10:15 Pitch 1 game
--      moving to 11:05, it is one valid arrangement. It persists, reaches the Fixtures projection and the
--      participant centre, survives Schedule Games, and tells each moved team once -- nobody else.
--   C. U10 and U12 share a pitch: the clash is found across competitions; a pitch split into halves takes
--      two games and refuses a third; a pitch too small for the grade is refused; a game moves to the
--      tournament's second day and not to a day it does not play.
--   M. The owner's rule (2026-10-03): the ORGANISER says how a reserved pitch is marked out for the day.
--      A full-size pitch marked out for three takes three U10 games at once (the RFU U10 pitch is 60m x
--      35m), refuses a fourth game, never gives a U12 game (60m x 43m, "half a full-size pitch") a third of
--      it, and cannot be re-marked for fewer while the games on it would not fit. The club's own Grounds &
--      Pitches layout is untouched.
--   D. A turnaround inside the changeover is refused; a knockout's Final cannot start before its Semi
--      Finals have finished, and a knockout place not yet paired is moved by hand.
--   E. Publication is refused while a clash or a kick-off without a pitch remains.
--   F. A published plan's tables are not changed underneath its games.
--   G. Delete Plan: a draft, a published plan (teams told), and never a plan with a result.
--   H. Results are history: not moved, not rescheduled, not rewritten or deleted by the older writers,
--      and their reservation is not released from under them.
--   I. Only the host's organisers (Club Admin, Fixtures Secretary) may read or change a plan.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '40 years')::date) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tpe-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Tpe', p_label, 'tpe-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TPE ' || p_label || ' RUFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tpe-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tpe-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.directory_only(p_label text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TPE ' || p_label || ' RUFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'tournament_manual_entry',
          'tpe-d-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text) returns uuid language plpgsql as $$
declare v uuid;
begin
  -- U10 and below are mixed in the Team Directory; older grades here are boys' sides.
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || case when substr(p_age, 2)::int <= 10 then ' Mixed' else ' Boys' end,
          'tpe-' || lower(p_age) || '-' || substr(gen_random_uuid()::text, 1, 8),
          'youth', p_age, case when substr(p_age, 2)::int <= 10 then 'mixed' else 'boys' end, 'union', true)
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

-- A side in a competition: a club's own team, or a club Ovalball only has a directory entry for.
create or replace function pg_temp.side(p_t uuid, p_age text, p_club uuid, p_team uuid, p_dir uuid default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
  values (p_t, coalesce(p_dir, (select directory_id from public.clubs where id = p_club)), p_club, p_team, p_age,
          case when p_club is null then 'external_recorded' else 'added' end)
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.pitch(p_club uuid, p_venue uuid, p_name text, p_layout text default 'full_only',
                                         p_size text default 'full', p_len numeric default null, p_wid numeric default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order, physical_size_category, layout, custom_length_m, custom_width_m)
  values (p_club, p_venue, p_name, true, 1, p_size, p_layout, p_len, p_wid) returning id into v;
  return v;
end $$;

create temp table tpe_last (msg text, hint text);
grant all on tpe_last to authenticated, anon;

-- Run a statement as a person (or signed out, for null) and hand back OK or the SQLSTATE; the message
-- and hint are kept for the assertion that reads them.
create or replace function pg_temp.try_as(p_user uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text; v_hint text;
begin
  delete from tpe_last;
  if p_user is null then
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
    perform set_config('role', 'anon', true);
  else
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    insert into tpe_last values (v_msg, v_hint);
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

create or replace function pg_temp.json_as(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- The game between two sides, in either order.
create or replace function pg_temp.pair(p_plan uuid, p_a uuid, p_b uuid) returns uuid language sql as $$
  select id from public.tournament_games
  where plan_id = p_plan and ((side_a_id = p_a and side_b_id = p_b) or (side_a_id = p_b and side_b_id = p_a));
$$;

-- One move, as the editor sends it.
create or replace function pg_temp.mv(p_game uuid, p_day date, p_time text, p_pitch uuid, p_minutes int default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('gameId', p_game, 'date', p_day, 'startTime', p_time, 'pitchId', p_pitch, 'durationMinutes', p_minutes));
$$;

create or replace function pg_temp.save_sql(p_plan uuid, p_changes jsonb) returns text language sql as $$
  select format('select public.save_tournament_plan_schedule(%L::uuid, %L::jsonb)', p_plan, p_changes);
$$;

create or replace function pg_temp.told(p_user uuid, p_t uuid) returns int language sql as $$
  select count(*)::int from public.notifications
  where user_id = p_user and type = 'tournament_schedule_changed' and data ->> 'tournament_id' = p_t::text;
$$;

do $$
declare
  d date := current_date + 30;
  v_host uuid; v_bolton uuid; v_blackburn uuid; v_unrelated uuid;
  v_ca uuid; v_fs uuid; v_tm uuid; v_coach uuid; v_parent uuid; v_player_user uuid; v_bolton_ca uuid; v_blackburn_ca uuid; v_unrelated_ca uuid;
  v_mem uuid; v_child uuid; v_player uuid;
  v_h_u10 uuid; v_h_u12 uuid; v_bol_u10 uuid; v_bol_u12 uuid; v_bla_u12 uuid;
  v_venue uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p7 uuid; p8 uuid; p9 uuid; ph uuid; ps uuid; pk1 uuid; pk2 uuid; pk3 uuid;
  ta uuid; tb uuid; tc uuid; td uuid; te uuid; pe uuid; e_u10 uuid; e_u12 uuid; e_u8 uuid; e_res uuid;
  s_bla uuid; s_cli uuid; s_bol uuid; s_uat uuid; s_wig uuid; s_uat12 uuid; s_bla12 uuid;
  a_u10 uuid; a_u12 uuid; b_u12 uuid; c_u10 uuid; c_u12 uuid; d_ko uuid;
  v_g uuid; v_g1 uuid; v_g2 uuid; v_g3 uuid; v_final uuid; v_hand uuid; v_res uuid;
  v_state text; v_n int; v_m int; v_r jsonb; v_x jsonb; v_sides uuid[]; v_t time; v_who uuid; v_label text;
begin
  -- ============ the people ============
  v_host := pg_temp.club('Ovalball Host');
  v_bolton := pg_temp.club('Bolton');
  v_blackburn := pg_temp.club('Blackburn');
  v_unrelated := pg_temp.club('Elsewhere');
  v_h_u10 := pg_temp.team(v_host, 'U10'); v_h_u12 := pg_temp.team(v_host, 'U12');
  v_bol_u10 := pg_temp.team(v_bolton, 'U10'); v_bol_u12 := pg_temp.team(v_bolton, 'U12');
  v_bla_u12 := pg_temp.team(v_blackburn, 'U12');

  v_ca := pg_temp.person('HostCA'); perform pg_temp.member(v_host, v_ca, 'CLUB_ADMIN');
  v_fs := pg_temp.person('HostFS'); perform pg_temp.member(v_host, v_fs, 'FIXTURE_SECRETARY');
  v_tm := pg_temp.person('HostTM'); v_mem := pg_temp.member(v_host, v_tm);
  insert into testing.team_roles (membership_id, team_id, role_key) values (v_mem, v_h_u10, 'TEAM_MANAGER');
  v_coach := pg_temp.person('HostCoach'); v_mem := pg_temp.member(v_host, v_coach);
  insert into testing.team_roles (membership_id, team_id, role_key) values (v_mem, v_h_u10, 'COACH');
  v_parent := pg_temp.person('Parent');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Child', 'Tpe', internal.date_of_birth_in_age_grade('union', 'U10'), 'MALE')
  returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_h_u10, 'active');
  insert into public.guardians (guardian_user_id, player_id, status, state) values (v_parent, v_child, 'active', 'ACTIVE');
  v_player_user := pg_temp.person('Player', (current_date - interval '20 years')::date);
  insert into public.players (first_name, surname, date_of_birth, user_id, playing_pathway) values ('Adult', 'Tpe', (current_date - interval '20 years')::date, v_player_user, 'MALE')
  returning id into v_player;
  -- The adult player's place in the host's U12 side stands on an approved dispensation fixture.
  insert into public.player_team_dispensation (player_id, target_team_id, season_id, eligibility_rule_reference, status, governing_body_reference)
  values (v_player, v_h_u12, internal.resolve_season_for_date('union', current_date), 'Suite fixture', 'approved', 'SUITE-FIXTURE');
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_h_u12, 'active');
  v_bolton_ca := pg_temp.person('BoltonCA'); perform pg_temp.member(v_bolton, v_bolton_ca, 'CLUB_ADMIN');
  v_blackburn_ca := pg_temp.person('BlackburnCA'); perform pg_temp.member(v_blackburn, v_blackburn_ca, 'CLUB_ADMIN');
  v_unrelated_ca := pg_temp.person('UnrelatedCA'); perform pg_temp.member(v_unrelated, v_unrelated_ca, 'CLUB_ADMIN');

  insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
  values (v_host, 'TPE Ground', 'tpe-g-' || substr(gen_random_uuid()::text, 1, 8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom')
  returning id into v_venue;
  p1 := pg_temp.pitch(v_host, v_venue, 'Pitch 1');
  p2 := pg_temp.pitch(v_host, v_venue, 'Pitch 2', 'two_halves');
  p3 := pg_temp.pitch(v_host, v_venue, 'Pitch 3'); p4 := pg_temp.pitch(v_host, v_venue, 'Pitch 4');
  p5 := pg_temp.pitch(v_host, v_venue, 'Pitch 5'); p7 := pg_temp.pitch(v_host, v_venue, 'Pitch 7');
  p8 := pg_temp.pitch(v_host, v_venue, 'Pitch 8'); p9 := pg_temp.pitch(v_host, v_venue, 'Pitch 9');
  ph := pg_temp.pitch(v_host, v_venue, 'Pitch H', 'two_halves');
  ps := pg_temp.pitch(v_host, v_venue, 'Pitch S', 'full_only', 'custom', 30, 20);
  pe := pg_temp.pitch(v_host, v_venue, 'Pitch E');
  pk1 := pg_temp.pitch(v_host, v_venue, 'Pitch K1'); pk2 := pg_temp.pitch(v_host, v_venue, 'Pitch K2'); pk3 := pg_temp.pitch(v_host, v_venue, 'Pitch K3');

  -- ======================================================================================
  -- A. THE OWNER'S CASE: EIGHT TEAMS, FOUR PITCHES, FOUR GAMES AT ONCE
  -- ======================================================================================
  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                  conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
  values (v_host, (select directory_id from public.clubs where id = v_host), 'union', d + 1, d + 1, 'confirmed', 'TPE Four Pitch Festival',
          gen_random_uuid(), 'round_robin', 'private', v_venue, '09:00', '13:00')
  returning id into tb;
  insert into public.tournament_age_groups (tournament_id, age_group) values (tb, 'U12');
  perform pg_temp.side(tb, 'U12', v_bolton, v_bol_u12);
  perform pg_temp.side(tb, 'U12', v_host, v_h_u12);
  for v_n in 1 .. 6 loop
    perform pg_temp.side(tb, 'U12', null, null, pg_temp.directory_only('Four Pitch Side ' || v_n));
  end loop;
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
  values (tb, p3, d + 1, '09:00', '13:00', v_ca), (tb, p4, d + 1, '09:00', '13:00', v_ca),
         (tb, p5, d + 1, '09:00', '13:00', v_ca), (tb, p7, d + 1, '09:00', '13:00', v_ca);
  perform pg_temp.as_user(v_ca);
  b_u12 := public.start_tournament_plan(tb, 'U12');
  perform public.set_tournament_plan_settings(b_u12, p_game_duration_minutes => 10, p_changeover_minutes => 5,
                                              p_day_start_time => '09:00', p_day_end_time => '13:00');
  perform public.generate_tournament_plan_fixtures(b_u12);
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);

  select count(*), count(distinct pitch_id) into v_n, v_m from public.tournament_games where plan_id = b_u12 and start_time = '09:00';
  perform pg_temp.check(v_n = 4 and v_m = 4,
    format('A1 eight teams and four pitches: four games kick off together at 09:00, one on each pitch (%s games, %s pitches)', v_n, v_m));
  perform pg_temp.check((select count(*) from public.tournament_games where plan_id = b_u12 and start_time is not null) = 28
    and not exists (select 1 from internal.tournament_schedule_conflicts(tb)),
    'A2 all 28 games are placed and the one clash engine finds nothing wrong with four simultaneous games');

  -- One whole pitch, two games at once.
  select id into v_g from public.tournament_games where plan_id = b_u12 and start_time = '09:00' and pitch_id = p4;
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(b_u12, jsonb_build_array(pg_temp.mv(v_g, d + 1, '09:00', p3))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PITCH_CLASH'
    and (select msg from tpe_last) = 'Pitch 3 has two games at 09:00, but it takes one game at a time.',
    format('A3 two games on one whole pitch at once is refused, in words (%s: %s)', (select hint from tpe_last), (select msg from tpe_last)));
  perform pg_temp.check((select pitch_id from public.tournament_games where id = v_g) = p4
    and not (select placed_by_hand from public.tournament_games where id = v_g),
    'A4 and the refusal changes nothing');

  -- One team, two pitches, one kick-off: a second-round game moved onto a free pitch at 09:00.
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
  values (tb, p8, d + 1, '09:00', '13:00', v_ca);
  select id into v_g from public.tournament_games where plan_id = b_u12 and start_time = '09:15' order by sort_order limit 1;
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(b_u12, jsonb_build_array(pg_temp.mv(v_g, d + 1, '09:00', p8))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_SIDE_CLASH'
    and (select msg from tpe_last) like 'TPE % is scheduled in two games at 09:00.',
    format('A5 the same team on two pitches at 09:00 is refused, naming the team (%s)', (select msg from tpe_last)));

  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(b_u12, jsonb_build_array(pg_temp.mv(v_g, d + 1, '11:00', p9))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PITCH_NOT_RESERVED'
    and (select msg from tpe_last) like 'Pitch 9 is not reserved for this tournament from 11:00 to 11:10%',
    format('A6 a pitch the tournament has not reserved is refused (%s)', (select msg from tpe_last)));
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(b_u12, jsonb_build_array(pg_temp.mv(v_g, d + 1, '12:55', p8))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_OUTSIDE_PLAYING_HOURS',
    format('A7 a game running past the playing hours is refused (%s)', (select msg from tpe_last)));
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(b_u12, jsonb_build_array(pg_temp.mv(v_g, d + 1, '11:00', p8, 45))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_GAME_TOO_LONG'
    and (select msg from tpe_last) = 'A U12 game may be at most 40 minutes under the age-grade regulations.',
    format('A8 a game longer than the age grade allows is refused (%s)', (select msg from tpe_last)));
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(b_u12, jsonb_build_array(pg_temp.mv(v_g, d + 1, '11:00', p8, 15))));
  perform pg_temp.check(v_state = 'OK'
    and (select (start_time, pitch_id, duration_minutes, placed_by_hand) = ('11:00'::time, p8, 15, true) from public.tournament_games where id = v_g),
    format('A9 a free pitch at a free time, with its own length, is accepted and marked as placed by hand (%s %s)', v_state, (select msg from tpe_last)));

  -- A turnaround inside the changeover: the last game on Pitch 4 moved to Pitch 3 as Pitch 3's last ends.
  select max(start_time) into v_t from public.tournament_games where plan_id = b_u12 and pitch_id = p3;
  select id into v_g from public.tournament_games where plan_id = b_u12 and pitch_id = p4 and start_time = v_t;
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(b_u12, jsonb_build_array(pg_temp.mv(v_g, d + 1, to_char(v_t + interval '10 minutes', 'HH24:MI'), p3))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PITCH_TURNAROUND'
    and (select msg from tpe_last) = format('Pitch 3 needs 5 minutes between games: a game finishes at %s and the next kicks off at %s.',
                                             to_char(v_t + interval '10 minutes', 'HH24:MI'), to_char(v_t + interval '10 minutes', 'HH24:MI')),
    format('A10 a kick-off inside the previous game''s changeover is refused (%s)', (select msg from tpe_last)));

  -- ======================================================================================
  -- B. THE BOLTON FESTIVAL'S SHAPE, AND THE OWNER'S OWN EDIT
  -- ======================================================================================
  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                  conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
  values (v_host, (select directory_id from public.clubs where id = v_host), 'union', d, d, 'confirmed', 'TPE Bolton Festival',
          gen_random_uuid(), 'round_robin', 'private', v_venue, '09:00', '13:00')
  returning id into ta;
  insert into public.tournament_age_groups (tournament_id, age_group) values (ta, 'U10'), (ta, 'U12');
  s_uat := pg_temp.side(ta, 'U10', v_host, v_h_u10);
  s_bol := pg_temp.side(ta, 'U10', v_bolton, v_bol_u10);
  s_bla := pg_temp.side(ta, 'U10', v_blackburn, null);
  s_cli := pg_temp.side(ta, 'U10', null, null, pg_temp.directory_only('Clitheroe'));
  s_wig := pg_temp.side(ta, 'U10', null, null, pg_temp.directory_only('Wigan'));
  s_uat12 := pg_temp.side(ta, 'U12', v_host, v_h_u12);
  s_bla12 := pg_temp.side(ta, 'U12', v_blackburn, v_bla_u12);
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
  values (ta, p1, d, '09:00', '13:00', v_ca), (ta, p2, d, '09:00', '13:00', v_ca);

  perform pg_temp.as_user(v_ca);
  a_u10 := public.start_tournament_plan(ta, 'U10');
  perform public.set_tournament_plan_settings(a_u10, p_game_duration_minutes => 20, p_changeover_minutes => 5,
                                              p_day_start_time => '09:00', p_day_end_time => '13:00');
  perform public.generate_tournament_plan_fixtures(a_u10);
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check((select count(*) from public.tournament_games where plan_id = a_u10) = 10,
    'B1 five U10 sides generate ten games');

  -- A DRAFT'S GAMES ARE THE ORGANISER'S on the Tournament Centre: the host's own team manager reads none.
  v_r := pg_temp.json_as(v_tm, format('select public.get_tournament_centre(%L::uuid)', ta));
  perform pg_temp.check(coalesce((select sum(jsonb_array_length(e -> 'games')) from jsonb_array_elements(v_r -> 'entries') e), 0) = 0
    and jsonb_array_length(v_r -> 'entries') >= 1,
    'B2 a draft plan''s games are not on the Tournament Centre for a host team''s manager');

  -- The festival laid out exactly as the live Bolton Festival is, as ONE save of ten moves.
  v_x := jsonb_build_array(
    pg_temp.mv(pg_temp.pair(a_u10, s_bla, s_cli), d, '09:00', p1), pg_temp.mv(pg_temp.pair(a_u10, s_bol, s_uat), d, '09:00', p2),
    pg_temp.mv(pg_temp.pair(a_u10, s_cli, s_uat), d, '09:25', p1), pg_temp.mv(pg_temp.pair(a_u10, s_bla, s_wig), d, '09:25', p2),
    pg_temp.mv(pg_temp.pair(a_u10, s_uat, s_wig), d, '09:50', p1), pg_temp.mv(pg_temp.pair(a_u10, s_cli, s_bol), d, '09:50', p2),
    pg_temp.mv(pg_temp.pair(a_u10, s_wig, s_bol), d, '10:15', p1), pg_temp.mv(pg_temp.pair(a_u10, s_uat, s_bla), d, '10:15', p2),
    pg_temp.mv(pg_temp.pair(a_u10, s_bol, s_bla), d, '10:40', p1), pg_temp.mv(pg_temp.pair(a_u10, s_wig, s_cli), d, '10:40', p2));
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(a_u10, v_x));
  perform pg_temp.check(v_state = 'OK' and (select count(*) from public.tournament_games where plan_id = a_u10 and placed_by_hand) = 10
    and (select start_time from public.tournament_games where id = pg_temp.pair(a_u10, s_cli, s_bol)) = '09:50'
    and (select pitch_id from public.tournament_games where id = pg_temp.pair(a_u10, s_cli, s_bol)) = p2,
    format('B3 ten games rearranged in one save, validated as one arrangement (%s %s)', v_state, (select msg from tpe_last)));
  v_state := pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L::uuid)', a_u10));
  perform pg_temp.check(v_state = 'OK', format('B4 and it publishes: no clash, every game has a time and a pitch (%s %s)', v_state, (select msg from tpe_last)));
  v_r := pg_temp.json_as(v_tm, format('select public.get_tournament_centre(%L::uuid)', ta));
  perform pg_temp.check(coalesce((select sum(jsonb_array_length(e -> 'games')) from jsonb_array_elements(v_r -> 'entries') e), 0) = 4,
    'B5 once published, the host team''s manager reads its four games');

  -- THE OWNER'S EDIT: 09:50 on Pitch 2 to 10:15 on Pitch 1.
  v_g1 := pg_temp.pair(a_u10, s_cli, s_bol);
  v_g2 := pg_temp.pair(a_u10, s_wig, s_bol);
  v_n := pg_temp.told(v_bolton_ca, ta); v_m := pg_temp.told(v_blackburn_ca, ta);
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(a_u10, jsonb_build_array(pg_temp.mv(v_g1, d, '10:15', p1))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_SIDE_CLASH'
    and (select msg from tpe_last) = format('%s %s is scheduled in two games at 10:15.',
                                             internal.tournament_side_summary(s_bol, null) ->> 'clubName',
                                             internal.tournament_side_summary(s_bol, null) ->> 'label')
    and (select msg from tpe_last) like 'TPE Bolton RUFC % is scheduled in two games at 10:15.',
    format('B6 on its own, 09:50 Pitch 2 to 10:15 Pitch 1 is refused: Bolton would be in two games at 10:15 (%s)', (select msg from tpe_last)));
  perform pg_temp.check((select (start_time, pitch_id) = ('09:50'::time, p2) from public.tournament_games where id = v_g1),
    'B7 and nothing moved');
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(a_u10, jsonb_build_array(pg_temp.mv(v_g1, d, '10:15', p1), pg_temp.mv(v_g2, d, '11:05', p1))));
  perform pg_temp.check(v_state = 'OK'
    and (select (start_time, pitch_id) = ('10:15'::time, p1) from public.tournament_games where id = v_g1)
    and (select (start_time, pitch_id) = ('11:05'::time, p1) from public.tournament_games where id = v_g2),
    format('B8 saved with the 10:15 Pitch 1 game moving to 11:05, it is one valid arrangement (%s %s)', v_state, (select msg from tpe_last)));

  -- It persists everywhere it is read.
  v_r := pg_temp.json_as(v_ca, format('select public.get_tournament_plan_schedule(%L::uuid)', a_u10));
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(v_r -> 'games') g
                                 where g ->> 'id' = v_g1::text and g ->> 'startTime' = '10:15' and g ->> 'pitchName' = 'Pitch 1'
                                   and (g ->> 'placedByHand')::boolean)
    and jsonb_array_length(v_r -> 'conflicts') = 0,
    'B9 View Plan reads it at 10:15 on Pitch 1, placed by hand, with no clash');
  v_r := pg_temp.json_as(v_bolton_ca, format('select public.get_tournament_fixture_rows(array[%L::uuid], %L::date, %L::date)', v_bol_u10, d - 1, d + 1));
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(v_r) g
                                 where g ->> 'gameId' = v_g1::text and g ->> 'startTime' = '10:15:00' and g ->> 'pitchName' = 'Pitch 1'),
    'B10 Bolton''s Fixtures read the game at 10:15 on Pitch 1');
  v_r := pg_temp.json_as(v_bolton_ca, format('select public.get_tournament_participant_centre(%L::uuid)', ta));
  perform pg_temp.check(jsonb_path_exists(v_r, format('$.** ? (@.id == "%s" && @.startTime == "10:15:00")', v_g1)::jsonpath),
    'B11 and so does Bolton''s Tournament Centre');

  -- Told once, and only the moved teams.
  perform pg_temp.check(pg_temp.told(v_bolton_ca, ta) = v_n + 1
    and exists (select 1 from public.notifications where user_id = v_bolton_ca and title = 'Tournament games moved'
                 and body = 'Two of your games at TPE Bolton Festival have moved: 10:15 on Pitch 1, 11:05 on Pitch 1. Check your kick-off times and pitches.'),
    'B12 Bolton, in both moved games, is told ONCE, naming both');
  perform pg_temp.check(pg_temp.told(v_blackburn_ca, ta) = v_m and pg_temp.told(v_ca, ta) = 0,
    'B13 Blackburn, in neither, is told nothing, and nor is the organiser who made the change');

  -- Schedule Games keeps what the organiser placed.
  v_n := pg_temp.told(v_bolton_ca, ta);
  v_state := pg_temp.try_as(v_ca, format('select public.schedule_tournament_plan(%L::uuid)', a_u10));
  perform pg_temp.check(v_state = 'OK'
    and (select (start_time, pitch_id) = ('10:15'::time, p1) from public.tournament_games where id = v_g1)
    and pg_temp.told(v_bolton_ca, ta) = v_n,
    format('B14 Schedule Games keeps every game placed by hand where it is, and a pass that moves nothing tells nobody (%s)', v_state));
  v_r := pg_temp.json_as(v_ca, format('select public.tournament_plan_regeneration_cost(%L::uuid)', a_u10));
  perform pg_temp.check((v_r ->> 'handPlacedCount')::int = 10, format('B15 regenerating would discard ten games placed by hand, and says so (%s)', v_r ->> 'handPlacedCount'));

  -- ======================================================================================
  -- C. U10 AND U12 ON THE SAME PITCHES
  -- ======================================================================================
  perform pg_temp.as_user(v_ca);
  a_u12 := public.start_tournament_plan(ta, 'U12');
  perform public.set_tournament_plan_settings(a_u12, p_game_duration_minutes => 20, p_changeover_minutes => 5,
                                              p_day_start_time => '09:00', p_day_end_time => '13:00');
  perform public.generate_tournament_plan_fixtures(a_u12);
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
  v_g := pg_temp.pair(a_u12, s_uat12, s_bla12);
  perform pg_temp.check((select start_time from public.tournament_games where id = v_g) is not null
    and not exists (select 1 from internal.tournament_schedule_conflicts(ta)),
    'C1 the U12 game is placed where the U10 games leave room -- the scheduler sees both competitions');
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(a_u12, jsonb_build_array(pg_temp.mv(v_g, d, '09:00', p1))));
  perform pg_temp.check(v_state = '22023' and (select msg from tpe_last) = 'Pitch 1 has two games at 09:00, but it takes one game at a time.',
    format('C2 a U12 game on the whole pitch a U10 game is using is refused -- the clash spans age groups (%s)', (select msg from tpe_last)));
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(a_u12, jsonb_build_array(pg_temp.mv(v_g, d, '09:00', p2))));
  perform pg_temp.check(v_state = 'OK',
    format('C3 Pitch 2 is marked out as two halves, so a U12 game beside the U10 game on it is accepted (%s %s)', v_state, (select msg from tpe_last)));

  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                  conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
  values (v_host, (select directory_id from public.clubs where id = v_host), 'union', d + 2, d + 3, 'confirmed', 'TPE Two Day Festival',
          gen_random_uuid(), 'round_robin', 'private', v_venue, '09:00', '13:00')
  returning id into tc;
  insert into public.tournament_age_groups (tournament_id, age_group) values (tc, 'U10'), (tc, 'U12');
  for v_n in 1 .. 4 loop perform pg_temp.side(tc, 'U10', null, null, pg_temp.directory_only('Two Day U10 ' || v_n)); end loop;
  perform pg_temp.side(tc, 'U12', null, null, pg_temp.directory_only('Two Day U12 A'));
  perform pg_temp.side(tc, 'U12', v_bolton, v_bol_u12);
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
  values (tc, ph, d + 2, '09:00', '13:00', v_ca), (tc, ph, d + 3, '09:00', '13:00', v_ca), (tc, ps, d + 2, '09:00', '13:00', v_ca);
  perform pg_temp.as_user(v_ca);
  c_u10 := public.start_tournament_plan(tc, 'U10');
  perform public.set_tournament_plan_days(c_u10, array[d + 2, d + 3]);
  perform public.set_tournament_plan_settings(c_u10, p_game_duration_minutes => 20, p_changeover_minutes => 5,
                                              p_day_start_time => '09:00', p_day_end_time => '13:00');
  perform public.generate_tournament_plan_fixtures(c_u10);
  c_u12 := public.start_tournament_plan(tc, 'U12');
  perform public.set_tournament_plan_settings(c_u12, p_game_duration_minutes => 20, p_changeover_minutes => 5,
                                              p_day_start_time => '09:00', p_day_end_time => '13:00');
  perform public.generate_tournament_plan_fixtures(c_u12);
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check((select count(*) from public.tournament_games where plan_id = c_u10 and start_time = '09:00' and game_date = d + 2 and pitch_id = ph) = 2
    and not exists (select 1 from public.tournament_games where pitch_id = ps),
    'C4 two U10 games share Pitch H, marked out as two halves; nothing is put on Pitch S, too small for either grade');
  select id into v_g from public.tournament_games where plan_id = c_u12;
  perform pg_temp.check((select (game_date, start_time) <> (d + 2, '09:00'::time) from public.tournament_games where id = v_g)
    and not exists (select 1 from internal.tournament_schedule_conflicts(tc)),
    'C5 the U12 game is not made the third game on a pitch of two halves');
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(c_u12, jsonb_build_array(pg_temp.mv(v_g, d + 2, '09:00', ph))));
  perform pg_temp.check(v_state = '22023' and (select msg from tpe_last) = 'Pitch H has three games at 09:00, but it is marked out for two.',
    format('C6 and moving it there by hand is refused (%s)', (select msg from tpe_last)));
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(c_u12, jsonb_build_array(pg_temp.mv(v_g, d + 2, '12:00', ps))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PITCH_TOO_SMALL'
    and (select msg from tpe_last) = 'Pitch S is too small for a U12 game. Move it to a bigger pitch.',
    format('C7 a pitch too small for the grade is refused (%s)', (select msg from tpe_last)));
  select id into v_g from public.tournament_games where plan_id = c_u10 order by game_date desc, start_time desc limit 1;
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(c_u10, jsonb_build_array(pg_temp.mv(v_g, d + 3, '11:00', ph))));
  perform pg_temp.check(v_state = 'OK' and (select game_date from public.tournament_games where id = v_g) = d + 3,
    format('C8 a game moves to the festival''s second day (%s %s)', v_state, (select msg from tpe_last)));
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(c_u10, jsonb_build_array(pg_temp.mv(v_g, d + 4, '11:00', ph))));
  perform pg_temp.check(v_state = '22023' and (select msg from tpe_last) = 'That day is not one of this competition''s playing days.',
    'C9 and not to a day the competition does not play');

  -- ======================================================================================
  -- M. THE ORGANISER MARKS A PITCH OUT FOR THE DAY
  -- ======================================================================================
  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                  conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
  values (v_host, (select directory_id from public.clubs where id = v_host), 'union', d + 5, d + 5, 'confirmed', 'TPE Mini Festival',
          gen_random_uuid(), 'round_robin', 'private', v_venue, '09:00', '13:00')
  returning id into te;
  insert into public.tournament_age_groups (tournament_id, age_group) values (te, 'U10'), (te, 'U12'), (te, 'U8');
  for v_n in 1 .. 6 loop perform pg_temp.side(te, 'U10', null, null, pg_temp.directory_only('Mini U10 ' || v_n)); end loop;
  for v_n in 1 .. 2 loop perform pg_temp.side(te, 'U12', null, null, pg_temp.directory_only('Mini U12 ' || v_n)); end loop;
  for v_n in 1 .. 2 loop perform pg_temp.side(te, 'U8', null, null, pg_temp.directory_only('Mini U8 ' || v_n)); end loop;

  v_state := pg_temp.try_as(v_ca, format('select public.reserve_tournament_pitch(%L::uuid, %L::uuid, %L::date, ''09:00'', ''13:00'', 3)', te, pe, d + 5));
  select id into e_res from public.tournament_pitches where tournament_id = te and pitch_id = pe;
  perform pg_temp.check(v_state = 'OK' and (select playing_areas from public.tournament_pitches where id = e_res) = 3
    and (select layout from public.club_pitches where id = pe) = 'full_only' and (select lane_count from public.club_pitches where id = pe) = 1,
    format('M1 the organiser reserves a whole pitch marked out for three games; the club''s own layout is untouched (%s %s)', v_state, (select msg from tpe_last)));

  perform pg_temp.as_user(v_ca);
  e_u10 := public.start_tournament_plan(te, 'U10');
  perform public.set_tournament_plan_settings(e_u10, p_game_duration_minutes => 20, p_changeover_minutes => 5, p_day_start_time => '09:00', p_day_end_time => '13:00');
  perform public.generate_tournament_plan_fixtures(e_u10);
  e_u12 := public.start_tournament_plan(te, 'U12');
  perform public.set_tournament_plan_settings(e_u12, p_game_duration_minutes => 20, p_changeover_minutes => 5, p_day_start_time => '09:00', p_day_end_time => '13:00');
  perform public.generate_tournament_plan_fixtures(e_u12);
  e_u8 := public.start_tournament_plan(te, 'U8');
  perform public.set_tournament_plan_settings(e_u8, p_game_duration_minutes => 10, p_changeover_minutes => 5, p_day_start_time => '09:00', p_day_end_time => '13:00');
  perform public.generate_tournament_plan_fixtures(e_u8);
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);

  perform pg_temp.check((select count(*) from public.tournament_games where plan_id = e_u10 and start_time = '09:00' and pitch_id = pe) = 3
    and (select count(*) from public.tournament_games where plan_id = e_u10 and start_time is not null) = 15
    and not exists (select 1 from internal.tournament_schedule_conflicts(te)),
    'M2 three U10 games kick off together on the one pitch marked out for three, and all fifteen are placed without a clash');
  perform pg_temp.check((select start_time from public.tournament_games where plan_id = e_u12) is null,
    'M3 the U12 game is never given a third of that pitch: its RFU pitch does not fit one, so it waits, unplaced');
  v_g := (select id from public.tournament_games where plan_id = e_u12);
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(e_u12, jsonb_build_array(pg_temp.mv(v_g, d + 5, '09:00', pe))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PITCH_TOO_SMALL'
    and (select msg from tpe_last) = 'Pitch E is marked out for three games at 09:00, and a U12 game needs more room than one of those areas. Mark it out for fewer games, or move this one.',
    format('M4 and placing it there by hand is refused, saying why (%s)', (select msg from tpe_last)));
  v_g := (select id from public.tournament_games where plan_id = e_u8);
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(e_u8, jsonb_build_array(pg_temp.mv(v_g, d + 5, '09:00', pe))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PITCH_CLASH'
    and (select msg from tpe_last) = 'Pitch E has four games at 09:00, but it is marked out for three.',
    format('M5 a fourth game at 09:00 is refused: the pitch is marked out for three (%s)', (select msg from tpe_last)));

  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_pitch_areas(%L::uuid, 2)', e_res));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PITCH_IN_USE'
    and (select msg from tpe_last) = 'Pitch E has three games at 09:00, but it is marked out for two.'
    and (select playing_areas from public.tournament_pitches where id = e_res) = 3,
    format('M6 it cannot be re-marked for two while three games are on it at once -- nothing changes (%s)', (select msg from tpe_last)));
  v_state := pg_temp.try_as(v_bolton_ca, format('select public.set_tournament_pitch_areas(%L::uuid, 4)', e_res));
  perform pg_temp.check(v_state = '42501', 'M7 only the host''s organisers mark a pitch out');
  -- NOR FOR FOUR: a quarter of a full-size pitch is smaller than the RFU U10 pitch, so the three U10
  -- games already on it would not fit one each.
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_pitch_areas(%L::uuid, 4)', e_res));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PITCH_IN_USE'
    and (select msg from tpe_last) = 'Pitch E is marked out for four games at 09:00, and a U10 game needs more room than one of those areas. Mark it out for fewer games, or move this one.'
    and (select playing_areas from public.tournament_pitches where id = e_res) = 3,
    format('M8 nor for four: a quarter of a full-size pitch is smaller than a U10 pitch (%s)', (select msg from tpe_last)));
  perform pg_temp.check((select start_time from public.tournament_games where id = v_g) is not null
    and not exists (select 1 from internal.tournament_schedule_conflicts(te) c where v_g = any (c.unit_ids)),
    'M9 the U8 game was placed by the scheduler where an area is free, with no clash');
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(e_u12, jsonb_build_array(pg_temp.mv((select id from public.tournament_games where plan_id = e_u12), d + 5, '12:00', pe))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PITCH_TOO_SMALL',
    'M10 and a third of the pitch is still too small for a U12 game, whatever else is on it');

  -- ======================================================================================
  -- D. A KNOCKOUT: ROUNDS IN ORDER, AND A PLACE MOVED BEFORE ITS SIDES ARE KNOWN
  -- ======================================================================================
  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                  conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
  values (v_host, (select directory_id from public.clubs where id = v_host), 'union', d + 4, d + 4, 'confirmed', 'TPE Cup',
          gen_random_uuid(), 'knockout', 'private', v_venue, '09:00', '13:00')
  returning id into td;
  insert into public.tournament_age_groups (tournament_id, age_group) values (td, 'U12');
  for v_n in 1 .. 4 loop perform pg_temp.side(td, 'U12', null, null, pg_temp.directory_only('Cup Side ' || v_n)); end loop;
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
  values (td, pk1, d + 4, '09:00', '13:00', v_ca), (td, pk2, d + 4, '09:00', '13:00', v_ca), (td, pk3, d + 4, '09:00', '13:00', v_ca);
  perform pg_temp.as_user(v_ca);
  d_ko := public.start_tournament_plan(td, 'U12');
  perform public.set_tournament_plan_settings(d_ko, p_game_duration_minutes => 20, p_changeover_minutes => 5,
                                              p_day_start_time => '09:00', p_day_end_time => '13:00');
  perform public.randomise_tournament_bracket(d_ko);
  perform public.generate_tournament_knockout_fixtures(d_ko);
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
  select id into v_final from public.tournament_bracket_pairings where plan_id = d_ko and game_id is null and not is_third_place
  order by round_number desc limit 1;
  perform pg_temp.check(v_final is not null and (select start_time from public.tournament_bracket_pairings where id = v_final) >= '09:25',
    'D1 the Final is a place booked after the Semi Finals, before its sides are known');
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(d_ko, jsonb_build_array(jsonb_build_object('placeId', v_final, 'date', d + 4, 'startTime', '09:05', 'pitchId', pk3))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_ROUND_ORDER'
    and (select msg from tpe_last) = 'The Final cannot kick off at 09:05: the last game of the Semi Finals ends at 09:20. A round starts once the round before it has finished.',
    format('D2 the Final cannot start before the Semi Finals have finished (%s)', (select msg from tpe_last)));
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(d_ko, jsonb_build_array(jsonb_build_object('placeId', v_final, 'date', d + 4, 'startTime', '11:30', 'pitchId', pk3))));
  perform pg_temp.check(v_state = 'OK'
    and (select (start_time, pitch_id, placed_by_hand) = ('11:30'::time, pk3, true) from public.tournament_bracket_pairings where id = v_final),
    format('D3 a knockout place not yet paired is moved by hand like a game (%s %s)', v_state, (select msg from tpe_last)));
  v_state := pg_temp.try_as(v_ca, format('select public.schedule_tournament_plan(%L::uuid)', d_ko));
  perform pg_temp.check(v_state = 'OK' and (select start_time from public.tournament_bracket_pairings where id = v_final) = '11:30',
    'D4 and Schedule Games leaves it where the organiser put it');

  -- ======================================================================================
  -- E. PUBLICATION WAITS FOR A SCHEDULE WITH NO CLASH AND NO GAME WITHOUT A PITCH
  -- ======================================================================================
  -- An older arrangement made when pitches were not held to their layout: three games on two halves.
  select id into v_g from public.tournament_games where plan_id = c_u10 and not (game_date = d + 2 and start_time = '09:00') order by game_date, start_time limit 1;
  select start_time, pitch_id into v_t, v_who from public.tournament_games where id = v_g;
  update public.tournament_games set game_date = d + 2, start_time = '09:00', pitch_id = ph where id = v_g;
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(internal.tournament_plan_readiness(c_u10) -> 'blockers') b
                                where b ->> 'code' = 'CLASH' and b ->> 'action' = 'edit_schedule'),
    'E1 a clash is a publication blocker that leads to Edit Plan');
  v_state := pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L::uuid)', c_u10));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PLAN_CLASH',
    format('E2 and publishing refuses with it (%s)', (select msg from tpe_last)));
  update public.tournament_games set start_time = v_t, pitch_id = null where id = v_g;
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(internal.tournament_plan_readiness(c_u10) -> 'blockers') b
                                where b ->> 'code' = 'NO_PITCH' and b ->> 'message' = '1 game has a kick-off time but no pitch. Give it a pitch.'),
    'E3 a kick-off with no pitch is a blocker, not a warning');
  v_state := pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L::uuid)', c_u10));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PLAN_NO_PITCH',
    format('E4 and publishing refuses with it (%s)', (select msg from tpe_last)));
  update public.tournament_games set pitch_id = ph where id = v_g;

  -- ======================================================================================
  -- F. A PUBLISHED PLAN'S TABLES DO NOT CHANGE UNDERNEATH ITS GAMES
  -- ======================================================================================
  v_state := pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L::uuid)', b_u12));
  perform pg_temp.check(v_state = 'OK', format('F0 the four-pitch plan publishes (%s %s)', v_state, (select msg from tpe_last)));
  select array_agg(participant_id order by position) into v_sides from public.tournament_plan_table_sides where plan_id = b_u12;
  v_x := jsonb_build_array(jsonb_build_object('name', 'Table A', 'sides', to_jsonb(v_sides[1:4])),
                           jsonb_build_object('name', 'Table B', 'sides', to_jsonb(v_sides[5:8])));
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_plan_tables(%L::uuid, %L::jsonb)', b_u12, v_x));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_TABLES_REPLACE_GAMES'
    and (select count(*) from public.tournament_plan_tables where plan_id = b_u12) = 1
    and (select count(*) from public.tournament_games where plan_id = b_u12) = 28,
    format('F1 changing a published plan''s tables is refused until the organiser confirms it replaces the games -- nothing changed (%s)', (select msg from tpe_last)));
  v_n := (select count(*) from public.notifications where user_id = v_bolton_ca and type = 'tournament_schedule_changed' and data ->> 'tournament_id' = tb::text);
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_plan_tables(%L::uuid, %L::jsonb, true)', b_u12, v_x));
  perform pg_temp.check(v_state = 'OK'
    and (select count(*) from public.tournament_plan_tables where plan_id = b_u12) = 2
    and (select count(*) from public.tournament_games where plan_id = b_u12) = 12
    and not exists (select 1 from public.tournament_games g where g.plan_id = b_u12
                     and (select s.table_id from public.tournament_plan_table_sides s where s.participant_id = g.side_a_id)
                         is distinct from (select s.table_id from public.tournament_plan_table_sides s where s.participant_id = g.side_b_id))
    and (select publication_state from public.tournament_plans where id = b_u12) = 'PUBLISHED',
    format('F2 confirmed, the games are generated again from the new tables -- 2 x 6, none across tables -- and the plan stays published (%s %s)', v_state, (select msg from tpe_last)));
  perform pg_temp.check((select count(*) from public.notifications where user_id = v_bolton_ca and type = 'tournament_schedule_changed' and data ->> 'tournament_id' = tb::text) = v_n + 1,
    'F3 and every team is told the schedule was regenerated, once');

  -- ======================================================================================
  -- G. DELETE PLAN
  -- ======================================================================================
  v_n := (select count(*) from public.tournament_participants where tournament_id = tc and age_group = 'U12');
  v_state := pg_temp.try_as(v_ca, format('select public.delete_tournament_plan(%L::uuid)', c_u12));
  perform pg_temp.check(v_state = 'OK'
    and not exists (select 1 from public.tournament_plans where id = c_u12)
    and not exists (select 1 from public.tournament_games where tournament_id = tc and age_group = 'U12')
    and (select count(*) from public.tournament_participants where tournament_id = tc and age_group = 'U12') = v_n
    and exists (select 1 from public.tournament_pitches where tournament_id = tc and pitch_id = ph),
    format('G1 a draft plan is deleted: its games go, its teams stay entered and the pitches stay reserved (%s %s)', v_state, (select msg from tpe_last)));
  v_r := pg_temp.json_as(v_ca, format('select public.get_tournament_plan_summaries(%L::uuid)', tc));
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(v_r) s where s ->> 'ageGroup' = 'U12' and s -> 'planId' = 'null'::jsonb)
    and exists (select 1 from jsonb_array_elements(v_r) s where s ->> 'ageGroup' = 'U10' and s ->> 'publicationState' = 'DRAFT'),
    'G2 and the Planning tab reads that competition as not planned, the other as a draft');
  perform pg_temp.check(not exists (select 1 from public.tournament_plans where tournament_id = tc and age_group = 'U12'),
    'G3 reading the Planning tab created nothing');

  v_n := (select count(*) from public.notifications where user_id = v_bolton_ca and data ->> 'tournament_id' = tb::text and title = 'Tournament schedule withdrawn');
  v_state := pg_temp.try_as(v_ca, format('select public.delete_tournament_plan(%L::uuid)', b_u12));
  perform pg_temp.check(v_state = 'OK' and not exists (select 1 from public.tournament_games where tournament_id = tb)
    and (select count(*) from public.notifications where user_id = v_bolton_ca and data ->> 'tournament_id' = tb::text and title = 'Tournament schedule withdrawn') = v_n + 1,
    format('G4 a published plan with no result is deleted, and its teams are told the schedule was withdrawn (%s %s)', v_state, (select msg from tpe_last)));

  -- A result is sporting history.
  v_res := pg_temp.pair(a_u10, s_bla, s_cli);
  -- The festival is in the future, so the result workflow itself would refuse ("This game has not kicked
  -- off yet"); the result is written as the workflow would leave it.
  update public.tournament_games set result_status = 'final', side_a_score = 10, side_b_score = 5, status = 'PLAYED' where id = v_res;
  perform pg_temp.check(internal.tournament_game_is_history(v_res), 'G5 a game with a recorded result is history');
  v_state := pg_temp.try_as(v_ca, format('select public.delete_tournament_plan(%L::uuid)', a_u10));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PLAN_HAS_RESULTS'
    and (select count(*) from public.tournament_games where plan_id = a_u10) = 10,
    format('G6 and Delete Plan is refused while any game has a result -- nothing is deleted (%s)', (select msg from tpe_last)));

  -- ======================================================================================
  -- H. RESULTS ARE HISTORY
  -- ======================================================================================
  v_state := pg_temp.try_as(v_ca, pg_temp.save_sql(a_u10, jsonb_build_array(pg_temp.mv(v_res, d, '12:00', p1))));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_GAME_HAS_RESULT',
    'H1 a game with a result is not moved');
  v_state := pg_temp.try_as(v_ca, format('select public.schedule_tournament_plan(%L::uuid, false)', a_u10));
  perform pg_temp.check(v_state = 'OK' and (select (start_time, pitch_id) = ('09:00'::time, p1) from public.tournament_games where id = v_res)
    and not exists (select 1 from internal.tournament_schedule_conflicts(ta)),
    format('H2 placing every game afresh leaves the played game where it was, and makes no clash around it (%s %s)', v_state, (select msg from tpe_last)));
  perform pg_temp.check(not exists (select 1 from public.tournament_games where plan_id = a_u10 and placed_by_hand and not internal.tournament_game_is_history(id)),
    'H3 and every other game is the scheduler''s again');
  v_state := pg_temp.try_as(v_ca, format('select public.save_tournament_game(%L::uuid, %L::uuid, %L::uuid, ''U10'', %L::date, %L::uuid, ''12:00'', 20, %L::uuid)',
                                         ta, s_bla, s_cli, d, v_res, p1));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_GAME_IN_PLAN',
    'H4 the older hand-made writer cannot rewrite a planned game');
  v_state := pg_temp.try_as(v_ca, format('select public.delete_tournament_game(%L::uuid)', v_res));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_GAME_IN_PLAN',
    'H5 nor delete one');
  perform pg_temp.as_user(v_ca);
  v_hand := public.save_tournament_game(ta, s_uat12, s_bla12, 'U12', d, null, '12:30', 20, p1);
  perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
  update public.tournament_games set result_status = 'final', side_a_score = 5, side_b_score = 5 where id = v_hand;
  v_state := pg_temp.try_as(v_ca, format('select public.delete_tournament_game(%L::uuid)', v_hand));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_GAME_HAS_RESULT',
    'H6 a hand-made game with a result is not deleted');
  v_state := pg_temp.try_as(v_ca, format('select public.save_tournament_game(%L::uuid, %L::uuid, %L::uuid, ''U12'', %L::date, null, %L, 20, %L::uuid)',
                                         ta, s_uat12, s_bla12, d, (select to_char(start_time, 'HH24:MI') from public.tournament_games where id = pg_temp.pair(a_u12, s_uat12, s_bla12)), p2));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_SIDE_CLASH',
    'H7 and a hand-made game is held to the same clashes as the plan');
  v_state := pg_temp.try_as(v_ca, format('select public.release_tournament_pitch(%L::uuid)',
                                         (select id from public.tournament_pitches where tournament_id = ta and pitch_id = p1)));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PITCH_IN_USE'
    and exists (select 1 from public.tournament_pitches where tournament_id = ta and pitch_id = p1),
    format('H8 a reservation games are played in is not released from under them (%s)', (select msg from tpe_last)));
  v_state := pg_temp.try_as(v_ca, format('select public.reserve_tournament_pitch(%L::uuid, %L::uuid, %L::date, ''09:00'', ''10:00'')', ta, p1, d));
  perform pg_temp.check(v_state = '22023' and (select hint from tpe_last) = 'TOURNAMENT_PITCH_IN_USE'
    and (select end_time from public.tournament_pitches where tournament_id = ta and pitch_id = p1) = '13:00',
    'H9 nor shortened under them');

  -- No game was duplicated or lost along the way.
  perform pg_temp.check((select count(*) from public.tournament_games where plan_id = a_u10) = 10
    and (select count(distinct least(side_a_id::text, side_b_id::text) || greatest(side_a_id::text, side_b_id::text))
         from public.tournament_games where plan_id = a_u10) = 10,
    'H10 every edit left exactly the ten games, each pair once');

  -- ======================================================================================
  -- I. ONLY THE HOST'S ORGANISERS
  -- ======================================================================================
  v_g := pg_temp.pair(a_u10, s_uat, s_wig);
  v_x := jsonb_build_array((select pg_temp.mv(id, game_date, to_char(start_time, 'HH24:MI'), pitch_id) from public.tournament_games where id = v_g));
  foreach v_who in array array[v_ca, v_fs] loop
    perform pg_temp.check(pg_temp.try_as(v_who, format('select public.get_tournament_plan_schedule(%L::uuid)', a_u10)) = 'OK'
      and pg_temp.try_as(v_who, format('select public.get_tournament_plan_summaries(%L::uuid)', ta)) = 'OK'
      and pg_temp.try_as(v_who, pg_temp.save_sql(a_u10, v_x)) = 'OK',
      format('I1 the host''s %s reads and edits the plan', case when v_who = v_ca then 'Club Admin' else 'Fixtures Secretary' end));
  end loop;
  foreach v_who in array array[v_bolton_ca, v_tm, v_coach, v_parent, v_player_user, v_unrelated_ca] loop
    v_label := case v_who when v_bolton_ca then 'participating club''s Club Admin' when v_tm then 'host team''s manager'
                          when v_coach then 'host team''s coach' when v_parent then 'parent' when v_player_user then 'player'
                          else 'unrelated club''s admin' end;
    perform pg_temp.check(pg_temp.try_as(v_who, format('select public.get_tournament_plan_schedule(%L::uuid)', a_u10)) = '42501'
      and pg_temp.try_as(v_who, format('select public.get_tournament_plan_summaries(%L::uuid)', ta)) = '42501'
      and pg_temp.try_as(v_who, pg_temp.save_sql(a_u10, v_x)) = '42501'
      and pg_temp.try_as(v_who, format('select public.schedule_tournament_plan(%L::uuid)', a_u10)) = '42501'
      and pg_temp.try_as(v_who, format('select public.delete_tournament_plan(%L::uuid)', a_u12)) = '42501',
      format('I2 the %s can neither read nor change the plan', v_label));
  end loop;
  perform pg_temp.check(pg_temp.try_as(null, format('select public.get_tournament_plan_schedule(%L::uuid)', a_u10)) = '42501'
    and pg_temp.try_as(null, pg_temp.save_sql(a_u10, v_x)) = '42501'
    and pg_temp.try_as(null, format('select public.delete_tournament_plan(%L::uuid)', a_u12)) = '42501',
    'I3 nor can anybody signed out');
  perform pg_temp.check(exists (select 1 from public.tournament_plans where id = a_u12),
    'I4 and the plan they tried to delete is still there');
end $$;

rollback;
