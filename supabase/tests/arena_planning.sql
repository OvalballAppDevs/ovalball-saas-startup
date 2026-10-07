-- ARENA PLANS THE ESTATE (20270737, 20270738).
--
-- WHAT THIS GUARDS
--
-- One physical estate, one occupancy, one conflict engine; Arena reads it and plans through the
-- canonical writers. The owner's Arena brief, sections 67-72, as permanent cases against one club with
-- two grounds:
--
--   R. ONE PITCH-FIT RESOLVER: every grade's size comes from Ovalball's verified Regulation 15 register
--      (U9 60m x 30m, U11 60m x 43m); only a grade the register has no size for falls back to its
--      category, and says so; no copy is left on the scheduling rules.
--   A-Z. AUTOMATIC ALLOCATION: a single fixture; several; at the same time; warm-up and clearing the
--      pitch and a room's turnaround each making a clash; a pitch that takes two matches; preferences --
--      first, second, none available, a valid fallback, nothing valid; a preferred room pair and a room
--      clash; locks on a pitch and a room; a person's allocation kept; two grounds; training, a
--      tournament and an event holding a pitch; an away fixture using none of the club's facilities;
--      catering that cannot be counted never shown as zero; the same day planned twice gives the same
--      plan; and another club's administrator refused everywhere.
--   T. TOURNAMENTS ON THE ESTATE: a reservation over a fixture or a session is refused; two tournaments
--      share a pitch only marked out one way, and then count each other's games; Arena sees a
--      tournament's reservations as its organiser marked them, and the club's own layout never changes.
--   X. CROSS-DOMAIN: training against a fixture, a fixture against a tournament, an event against a
--      fixture and against training -- only an explicit reservation holds a pitch.
--   P. THE WHAT-IF FORM AGREES WITH THE ENGINE: a placement it calls blocked is exactly one the engine
--      then reports.
--   N. NOTICES: a preview tells nobody; an applied plan tells each person once per fixture, never the
--      person who applied it.
--   TR. TRAINING ROOMS, SHARED PITCHES AND TIME (the owner's rules of 2026-10-04): training shares a pitch
--      without limit; only a session whose plan or own answer asks for a changing room needs one; one
--      team per room; a session's room and time are stored on the session through the canonical writers;
--      automatic allocation never moves a lock or a time; each activity says who owns its time.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'arena-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Arena', p_label, 'arena-' || v::text || '@ovalball.test', (current_date - interval '40 years')::date)
  on conflict (id) do update set first_name = excluded.first_name;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Arena ' || p_label || ' RUFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'arena-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'arena-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.directory_only(p_label text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Arena ' || p_label || ' RFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual',
          'arena-d-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  -- U11 and below are mixed in the Team Directory; older grades here are boys' sides.
  values (p_club, 'Under ' || substr(p_age, 2) || case when substr(p_age, 2)::int <= 11 then ' Mixed' else ' Boys' end,
          'arena-' || lower(p_age) || '-' || substr(gen_random_uuid()::text, 1, 8),
          'youth', p_age, case when substr(p_age, 2)::int <= 11 then 'mixed' else 'boys' end, 'union', true)
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.venue(p_club uuid, p_name text, p_default boolean default false) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country, is_default_home, changing_rooms_available)
  values (p_club, p_name, 'arena-v-' || substr(gen_random_uuid()::text, 1, 8), '1 Lane', 'Town', 'AR1 1NA', 'United Kingdom', p_default, true)
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.pitch(p_club uuid, p_venue uuid, p_name text, p_sort int, p_layout text default 'full_only',
                                         p_size text default 'full', p_len numeric default null, p_wid numeric default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order, physical_size_category, layout, custom_length_m, custom_width_m)
  values (p_club, p_venue, p_name, true, p_sort, p_size, p_layout, p_len, p_wid) returning id into v;
  return v;
end $$;

create or replace function pg_temp.room(p_club uuid, p_venue uuid, p_name text, p_sort int, p_type text default 'full_size') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.venue_changing_rooms (club_id, venue_id, display_name, room_type, active, sort_order)
  values (p_club, p_venue, p_name, p_type, true, p_sort) returning id into v;
  return v;
end $$;

-- A home fixture against a club Ovalball only knows from the directory (so the visitors' attendance is
-- not countable), at a time, optionally on a pitch.
create or replace function pg_temp.home(p_team uuid, p_day date, p_time text, p_venue uuid, p_pitch uuid default null, p_opp text default 'Visitors')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.fixtures (owning_team_id, opponent_directory_id, home_away, raw_opposition_text, kickoff_date, kickoff_time,
                               status, source, venue_id, pitch_id, pitch_allocation)
  values (p_team, pg_temp.directory_only(p_opp), 'Home', 'Arena ' || p_opp || ' RFC', p_day, p_time::time, 'Planned', 'club_created',
          p_venue, p_pitch, (select display_name from public.club_pitches where id = p_pitch))
  returning id into v;
  return v;
end $$;

create temp table arena_last (msg text, hint text);
grant all on arena_last to authenticated, anon;

create or replace function pg_temp.try_as(p_user uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text; v_hint text;
begin
  delete from arena_last where true;   -- the API's safeupdate contract (api_safeupdate_contract.sql) holds here too
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    insert into arena_last values (v_msg, v_hint);
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

create or replace function pg_temp.last_msg() returns text language sql as $$ select msg from arena_last limit 1 $$;
create or replace function pg_temp.last_hint() returns text language sql as $$ select hint from arena_last limit 1 $$;

-- One item of a preview, by activity.
create or replace function pg_temp.item(p_preview jsonb, p_id uuid) returns jsonb language sql as $$
  select i from jsonb_array_elements(p_preview -> 'items') i where i ->> 'id' = p_id::text;
$$;

-- An applied preview: every item that changes something, as Apply expects it.
create or replace function pg_temp.changes_of(p_preview jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', i ->> 'kind', 'id', i ->> 'id', 'expected', i -> 'current', 'set', i -> 'proposed')), '[]'::jsonb)
  from jsonb_array_elements(p_preview -> 'items') i
  where jsonb_array_length(i -> 'changes') > 0;
$$;

create or replace function pg_temp.has_conflict(p_club uuid, p_day date, p_code text, p_id uuid) returns boolean language sql as $$
  select exists (select 1 from internal.arena_conflicts(p_club, p_day, p_day) c where c.code = p_code and p_id = any (c.activity_ids));
$$;

do $$
declare
  d date := current_date + 40;
  v_club uuid; v_other uuid;
  v_ca uuid; v_fs uuid; v_xa uuid; v_parent uuid; v_parent2 uuid; v_member uuid;
  v_main uuid; v_train uuid; v_xvenue uuid;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; asm uuid; b1 uuid; x1 uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; ro uuid; rb uuid; rx uuid;
  t_u9 uuid; t_u10 uuid; t_u11 uuid; t_u12 uuid; t_u14 uuid; t_u16 uuid; x_u12 uuid;
  f1 uuid; f2 uuid; f3 uuid; f4 uuid; f5 uuid; f6 uuid; f7 uuid; f8 uuid; f_away uuid;
  s1 uuid; s2 uuid; s3 uuid;
  v_t1 uuid; v_t2 uuid; v_res uuid; v_res2 uuid; v_ev uuid; v_ev2 uuid;
  v_child uuid; v_child2 uuid;
  v_p jsonb; v_p2 jsonb; v_i jsonb; v_r jsonb; v_x jsonb; v_state text; v_n int; v_m int; v_g uuid; v_plan uuid;
  v_before int;
  tp1 uuid; ts1 uuid; ts2 uuid; ts3 uuid; ts4 uuid; fx uuid;
begin
  -- ============ the club, its two grounds and its people ============
  v_club := pg_temp.club('Estate');
  v_other := pg_temp.club('Elsewhere');
  t_u9 := pg_temp.team(v_club, 'U9'); t_u10 := pg_temp.team(v_club, 'U10'); t_u11 := pg_temp.team(v_club, 'U11');
  t_u12 := pg_temp.team(v_club, 'U12'); t_u14 := pg_temp.team(v_club, 'U14'); t_u16 := pg_temp.team(v_club, 'U16');
  x_u12 := pg_temp.team(v_other, 'U12');
  v_ca := pg_temp.person('ClubAdmin'); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_fs := pg_temp.person('FixtureSecretary'); perform pg_temp.member(v_club, v_fs, 'FIXTURE_SECRETARY');
  v_member := pg_temp.person('Member'); perform pg_temp.member(v_club, v_member);
  v_xa := pg_temp.person('OtherAdmin'); perform pg_temp.member(v_other, v_xa, 'CLUB_ADMIN');

  v_main := pg_temp.venue(v_club, 'Arena Main Ground', true);
  v_train := pg_temp.venue(v_club, 'Arena Training Ground');
  v_xvenue := pg_temp.venue(v_other, 'Elsewhere Ground', true);
  a1 := pg_temp.pitch(v_club, v_main, 'A1', 1);
  a2 := pg_temp.pitch(v_club, v_main, 'A2', 2, 'two_halves');
  a3 := pg_temp.pitch(v_club, v_main, 'A3', 3);
  a4 := pg_temp.pitch(v_club, v_main, 'A4', 4);
  a5 := pg_temp.pitch(v_club, v_main, 'A5', 5);
  asm := pg_temp.pitch(v_club, v_main, 'A Small', 6, 'full_only', 'custom', 30, 20);
  b1 := pg_temp.pitch(v_club, v_train, 'B1', 7);
  x1 := pg_temp.pitch(v_other, v_xvenue, 'X1', 1);
  r1 := pg_temp.room(v_club, v_main, 'Room 1', 1); r2 := pg_temp.room(v_club, v_main, 'Room 2', 2);
  r3 := pg_temp.room(v_club, v_main, 'Room 3', 3); r4 := pg_temp.room(v_club, v_main, 'Room 4', 4);
  ro := pg_temp.room(v_club, v_main, 'Officials Room', 5, 'match_officials');
  rb := pg_temp.room(v_club, v_train, 'Training Room', 1);
  rx := pg_temp.room(v_other, v_xvenue, 'Elsewhere Room', 1);

  -- A family on the U12 side and one on the U14 side, for the notices.
  v_parent := pg_temp.person('ParentU12');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Twelve', 'Arena', internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE')
  returning id into v_child;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child, t_u12, 'active');
  insert into public.guardians (guardian_user_id, player_id, status, state) values (v_parent, v_child, 'active', 'ACTIVE');
  v_parent2 := pg_temp.person('ParentU14');
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Fourteen', 'Arena', internal.date_of_birth_in_age_grade('union', 'U14'), 'MALE')
  returning id into v_child2;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child2, t_u14, 'active');
  insert into public.guardians (guardian_user_id, player_id, status, state) values (v_parent2, v_child2, 'active', 'ACTIVE');

  -- ======================================================================================
  -- R. ONE PITCH-FIT RESOLVER
  -- ======================================================================================
  perform pg_temp.check((select basis = 'REGULATION' and length_m = 60 and width_m = 30 and footprint = 'half'
                         from internal.age_grade_pitch_fit('union', 'U9', d)), 'R1 U9 is 60m x 30m from the verified Regulation 15 register (Appendix 3)');
  perform pg_temp.check((select basis = 'REGULATION' and length_m = 60 and width_m = 43 and footprint = 'half'
                         from internal.age_grade_pitch_fit('union', 'U11', d)), 'R2 U11 is 60m x 43m from the register (Appendix 5)');
  perform pg_temp.check((select basis = 'REGULATION' and area_m2 = 2100 from internal.age_grade_pitch_fit('union', 'U10', d))
                        and (select basis = 'REGULATION' and footprint = 'quarter' from internal.age_grade_pitch_fit('union', 'U8', d))
                        and (select basis = 'REGULATION' and footprint = 'full' from internal.age_grade_pitch_fit('union', 'U13', d)),
                        'R3 U8 (a quarter), U10 (2,100 m2) and U13 (the whole pitch) come from the register');
  perform pg_temp.check((select basis = 'CATEGORY' and footprint = 'quarter' and area_m2 = 1750 and source like 'No verified pitch size%'
                         from internal.age_grade_pitch_fit('union', 'U6', d)),
                        'R4 a grade the register has no size for (U6) falls back to its category, and says so');
  perform pg_temp.check((select basis = 'UNKNOWN' and area_m2 is null and footprint is null from internal.age_grade_pitch_fit('league', 'U14', d)),
                        'R5 a code with no rule is UNKNOWN: no size invented');
  perform pg_temp.check(internal.tournament_game_area_m2((select null::uuid), 'U9') = 1800
                        and internal.tournament_game_area_m2((select null::uuid), 'U11') = 2580,
                        'R6 the tournament planner reads the same resolver (U9 1,800 m2, U11 2,580 m2)');
  perform pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'public'
                                    and table_name = 'fixture_scheduling_rules' and column_name like 'max_pitch_%'),
                        'R7 no copy of the Regulation 15 sizes is left on the scheduling rules');
  perform pg_temp.check((select count(*) from public.age_grade_pitch_fits('union') where age_group in ('U9', 'U11') and basis = 'REGULATION') = 2,
                        'R8 the client read of every grade carries the register sizes');

  -- ======================================================================================
  -- A-C. SINGLE, SEVERAL AND SIMULTANEOUS HOME FIXTURES
  -- ======================================================================================
  f1 := pg_temp.home(t_u12, d, '10:00', v_main, null, 'Single');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d));
  v_i := pg_temp.item(v_p, f1);
  perform pg_temp.check(v_i ->> 'outcome' = 'NO_PREFERENCE' and v_i -> 'proposed' ->> 'pitchId' = a1::text
                        and v_i -> 'proposed' ->> 'homeRoomId' = r1::text and v_i -> 'proposed' ->> 'awayRoomId' = r2::text,
                        'A1 a single home fixture is proposed the first suitable pitch and a pair of adjacent rooms');
  perform pg_temp.check((select pitch_id is null and home_changing_room_id is null from public.fixtures where id = f1),
                        'A2 a preview writes nothing');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''AUTO'')', v_club, d, pg_temp.changes_of(v_p)));
  perform pg_temp.check(v_state = 'OK' and (select pitch_id = a1 and home_changing_room_id = r1 and away_changing_room_id = r2
                                                   and allocation_auto = array['away_room', 'home_room', 'pitch'] and status = 'Booked'
                                            from public.fixtures where id = f1),
                        'A3 Apply allocates the pitch and both rooms through the canonical writers, marked AUTO');
  perform pg_temp.check(not exists (select 1 from internal.arena_conflicts(v_club, d, d) where severity = 'hard'), 'A4 the day has no clash');

  f2 := pg_temp.home(t_u14, d, '13:00', v_main, null, 'Several A');
  f3 := pg_temp.home(t_u16, d, '15:00', v_main, null, 'Several B');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d));
  perform pg_temp.check(pg_temp.item(v_p, f2) -> 'changes' ? 'PITCH' and pg_temp.item(v_p, f3) -> 'changes' ? 'PITCH'
                        and pg_temp.item(v_p, f1) ->> 'outcome' = 'UNCHANGED' and (v_p -> 'summary' ->> 'unchanged')::int = 1,
                        'B1 several fixtures: the two without a pitch are planned; the allocated one is listed unchanged');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''AUTO'')', v_club, d, pg_temp.changes_of(v_p)));
  perform pg_temp.check(v_state = 'OK' and (select count(*) from public.fixtures where id in (f2, f3) and pitch_id is not null) = 2
                        and not exists (select 1 from internal.arena_conflicts(v_club, d, d) where severity = 'hard'),
                        'B2 both are allocated with no clash');

  -- A U11 and a U12 match at the same moment: two halves of A2 fit both, a whole pitch only one.
  f4 := pg_temp.home(t_u11, d + 1, '11:00', v_main, null, 'Same Time A');
  f5 := pg_temp.home(t_u12, d + 1, '11:00', v_main, null, 'Same Time B');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 1));
  perform pg_temp.check(pg_temp.item(v_p, f4) -> 'proposed' ->> 'pitchId' is distinct from pg_temp.item(v_p, f5) -> 'proposed' ->> 'pitchId'
                        or pg_temp.item(v_p, f4) -> 'proposed' ->> 'pitchId' = a2::text,
                        'C1 simultaneous fixtures never share a whole-pitch-only pitch');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''AUTO'')', v_club, d + 1, pg_temp.changes_of(v_p)));
  perform pg_temp.check(v_state = 'OK' and not exists (select 1 from internal.arena_conflicts(v_club, d + 1, d + 1) where severity = 'hard'),
                        'C2 applied without a clash');
  perform pg_temp.check((select home_changing_room_id <> (select home_changing_room_id from public.fixtures where id = f5)
                         from public.fixtures where id = f4),
                        'C3 two matches at once never share a changing room');

  -- ======================================================================================
  -- D-F. WARM-UP, CLEARING THE PITCH AND A ROOM'S TURNAROUND
  -- ======================================================================================
  -- U10 training on A3 10:00-11:00; a U12 match on A3 kicking off at 11:00 warms up from 10:45.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  s1 := public.create_training_session(v_club, t_u10, null, d + 2, '10:00', '11:00', a3, null, v_main);
  perform set_config('role', 'none', true);
  f6 := pg_temp.home(t_u12, d + 2, '11:00', v_main, null, 'Warm Up');
  v_state := pg_temp.try_as(v_ca, format('select public.set_fixture_facilities(%L, %L::jsonb)', f6, jsonb_build_object('pitch_id', a3)));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_msg() like '%warm-up needs A3 from 10:45%' and pg_temp.last_hint() = 'ARENA_FACILITY_IN_USE',
                        'D1 a warm-up makes the clash: "' || coalesce(pg_temp.last_msg(), '') || '"');
  perform pg_temp.check((select pitch_id is null from public.fixtures where id = f6), 'D2 the refused allocation changed nothing');
  perform set_config('role', 'none', true);
  delete from public.training_sessions where id = s1;  -- tidy for the next case only (not part of a product path)

  -- A U9 match on A4 from 09:00 (warm-up 08:45, final whistle 09:30, pitch clear at 09:45); U14 training wants
  -- A4 from 09:35.
  f7 := pg_temp.home(t_u9, d + 2, '09:00', v_main, a4, 'Cool Down');
  v_state := pg_temp.try_as(v_ca, format('select public.create_training_session(%L, %L, null, %L, ''09:35'', ''10:35'', %L, null, %L)', v_club, t_u14, d + 2, a4, v_main));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_msg() like '%needs A4 until 09:45 to clear the pitch%',
                        'E1 clearing the pitch makes the clash: "' || coalesce(pg_temp.last_msg(), '') || '"');

  -- Room turnaround: a U12 match from 10:00 keeps Room 3 until 11:10 and it is turned round by 11:25; a U14 match
  -- at 12:20 needs its home room from 11:20.
  f8 := pg_temp.home(t_u12, d + 3, '10:00', v_main, a1, 'Room First');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.set_fixture_facilities(f8, jsonb_build_object('home_room_id', r3, 'away_room_id', r4));
  perform set_config('role', 'none', true);
  v_g := pg_temp.home(t_u14, d + 3, '12:20', v_main, a3, 'Room Second');
  v_state := pg_temp.try_as(v_ca, format('select public.set_fixture_facilities(%L, %L::jsonb)', v_g, jsonb_build_object('home_room_id', r3)));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_msg() like 'Room 3 needs 15 minutes to turn round%',
                        'F1 a room''s turnaround makes the clash: "' || coalesce(pg_temp.last_msg(), '') || '"');
  v_state := pg_temp.try_as(v_ca, format('select public.set_fixture_facilities(%L, %L::jsonb)', v_g, jsonb_build_object('home_room_id', r1)));
  perform pg_temp.check(v_state = 'OK', 'F2 a free room is accepted');

  -- ======================================================================================
  -- G. A PITCH THAT TAKES TWO MATCHES
  -- ======================================================================================
  f1 := pg_temp.home(t_u9, d + 4, '13:00', v_main, null, 'Half One');
  f2 := pg_temp.home(t_u10, d + 4, '13:00', v_main, null, 'Half Two');
  f3 := pg_temp.home(t_u11, d + 4, '13:00', v_main, null, 'Half Three');
  v_state := pg_temp.try_as(v_ca, format('select public.set_fixture_facilities(%L, %L::jsonb)', f1, jsonb_build_object('pitch_id', a2)));
  v_n := (case when v_state = 'OK' then 1 else 0 end);
  v_state := pg_temp.try_as(v_ca, format('select public.set_fixture_facilities(%L, %L::jsonb)', f2, jsonb_build_object('pitch_id', a2)));
  perform pg_temp.check(v_n = 1 and v_state = 'OK', 'G1 a pitch marked out in two halves takes two matches at once (U9 and U10)');
  v_state := pg_temp.try_as(v_ca, format('select public.set_fixture_facilities(%L, %L::jsonb)', f3, jsonb_build_object('pitch_id', a2)));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_msg() like 'A2 takes two matches at a time%',
                        'G2 and refuses a third: "' || coalesce(pg_temp.last_msg(), '') || '"');
  v_state := pg_temp.try_as(v_ca, format('select public.set_fixture_facilities(%L, %L::jsonb)', f3, jsonb_build_object('pitch_id', asm)));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_msg() like 'A Small is too small%', 'G3 a pitch too small for the grade is refused');

  -- ======================================================================================
  -- H-M. PREFERENCES: FIRST, SECOND, NONE AVAILABLE, FALLBACK, NOTHING VALID
  -- ======================================================================================
  v_state := pg_temp.try_as(v_ca, format('select public.save_facility_preferences(%L, null, ''MATCH_PITCH'', %L::uuid[])', v_club, array[a5, a4]));
  perform pg_temp.check(v_state = 'OK', 'H0 the club sets a default match-pitch preference');
  f1 := pg_temp.home(t_u16, d + 5, '14:00', v_main, null, 'Prefer');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 5));
  perform pg_temp.check(pg_temp.item(v_p, f1) -> 'proposed' ->> 'pitchId' = a5::text and pg_temp.item(v_p, f1) ->> 'pitchOutcome' = 'FIRST_PREFERENCE',
                        'H1 the preferred pitch, when free, is proposed as the first preference');

  -- U14's own preference replaces the club's: A3 then A4. Training holds A3 at the time.
  v_state := pg_temp.try_as(v_ca, format('select public.save_facility_preferences(%L, %L, ''MATCH_PITCH'', %L::uuid[])', v_club, t_u14, array[a3, a4]));
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  s2 := public.create_training_session(v_club, t_u9, null, d + 5, '10:00', '11:00', a3, null, v_main);
  perform set_config('role', 'none', true);
  f2 := pg_temp.home(t_u14, d + 5, '11:00', v_main, null, 'Second Choice');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 5));
  v_i := pg_temp.item(v_p, f2);
  perform pg_temp.check(v_i ->> 'pitchOutcome' = 'ALTERNATIVE', 'I1 the first preference is unavailable');
  perform pg_temp.check(v_i -> 'proposed' ->> 'pitchId' = a4::text, 'J1 the second preference is chosen');
  perform pg_temp.check((v_i -> 'explanation' ->> 0) like '%warm-up needs A3 from 10:45%Proposed: A4.%',
                        'I2 and the proposal says why: "' || coalesce(v_i -> 'explanation' ->> 0, '') || '"');

  -- U14 now prefers only A3: unavailable, so any valid pitch.
  perform pg_temp.try_as(v_ca, format('select public.save_facility_preferences(%L, %L, ''MATCH_PITCH'', %L::uuid[])', v_club, t_u14, array[a3]));
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 5));
  v_i := pg_temp.item(v_p, f2);
  perform pg_temp.check(v_i ->> 'pitchOutcome' = 'ALTERNATIVE' and v_i -> 'proposed' ->> 'pitchId' is not null
                        and v_i -> 'proposed' ->> 'pitchId' <> a3::text, 'K1 every preference unavailable');
  perform internal.arena_load_day(v_club, d + 5);
  perform pg_temp.check((select count(*) = 0 from internal.arena_activity('FIXTURE', f2) a
                         cross join lateral internal.arena_blockers('FIXTURE', f2, a.label, 'PITCH', (v_i -> 'proposed' ->> 'pitchId')::uuid,
                                                                    a.pitch_from, a.play_from, a.play_until, a.pitch_until, a.pitch_turn, a.footprint, 0)),
                        'L1 the fallback is a valid pitch');
  -- Nothing valid: only the training ground, and B1 is held by an event's explicit reservation all day.
  insert into public.club_events (club_id, name, starts_on, ends_on, status, location_kind, venue_id, event_type)
  values (v_club, 'Arena Gala', d + 5, d + 5, 'SCHEDULED', 'VENUE', v_train, 'SOCIAL') returning id into v_ev;
  insert into public.club_event_pitches (event_id, pitch_id) values (v_ev, b1);
  f5 := pg_temp.home(t_u12, d + 5, '12:00', v_train, null, 'Nowhere');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L, %L)', v_club, d + 5, v_train));
  v_i := pg_temp.item(v_p, f5);
  perform pg_temp.check(v_i ->> 'outcome' = 'UNRESOLVED' and v_i -> 'proposed' ->> 'pitchId' is null
                        and (v_i -> 'explanation' ->> 0) like 'No pitch is free%B1 is reserved for Arena Gala all day.%',
                        'M1 with no valid pitch nothing is forced, and the proposal says why: "' || coalesce(v_i -> 'explanation' ->> 0, '') || '"');
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(v_p -> 'items') x where x -> 'proposed' ->> 'pitchId' = b1::text),
                        'M2 the reserved pitch is never proposed');
  update public.training_sessions set pitch_id = null, venue_id = null where id = s2;  -- tidy

  -- ======================================================================================
  -- N-O. ROOM PAIRS
  -- ======================================================================================
  perform pg_temp.try_as(v_ca, format('select public.save_facility_preferences(%L, %L, ''HOME_ROOM'', %L::uuid[])', v_club, t_u16, array[r3]));
  perform pg_temp.try_as(v_ca, format('select public.save_facility_preferences(%L, %L, ''AWAY_ROOM'', %L::uuid[])', v_club, t_u16, array[r4]));
  f3 := pg_temp.home(t_u16, d + 6, '14:00', v_main, null, 'Room Pair');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 6));
  v_i := pg_temp.item(v_p, f3);
  perform pg_temp.check(v_i -> 'proposed' ->> 'homeRoomId' = r3::text and v_i -> 'proposed' ->> 'awayRoomId' = r4::text
                        and v_i ->> 'roomsOutcome' = 'FIRST_PREFERENCE', 'N1 the preferred room pair is proposed');
  f4 := pg_temp.home(t_u12, d + 6, '13:30', v_main, a1, 'Room Taken');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.set_fixture_facilities(f4, jsonb_build_object('home_room_id', r3));
  perform set_config('role', 'none', true);
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 6));
  v_i := pg_temp.item(v_p, f3);
  perform pg_temp.check(v_i -> 'proposed' ->> 'homeRoomId' <> r3::text and v_i ->> 'roomsOutcome' = 'ALTERNATIVE'
                        and v_i -> 'proposed' ->> 'homeRoomId' is distinct from v_i -> 'proposed' ->> 'awayRoomId',
                        'O1 a room in use is passed over for another pair');
  perform pg_temp.check(exists (select 1 from jsonb_array_elements_text(v_i -> 'explanation') e
                                where e like '%is in use by%Room Taken%Proposed: %(home)%(away).'),
                        'O2 and the proposal says why the preferred room was passed over, then what it proposes: "'
                        || coalesce((select string_agg(e, ' / ') from jsonb_array_elements_text(v_i -> 'explanation') e), '') || '"');

  -- ======================================================================================
  -- P-R. LOCKS AND A PERSON'S ALLOCATION
  -- ======================================================================================
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 6));
  perform pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''AUTO'')', v_club, d + 6, pg_temp.changes_of(v_p)));
  perform pg_temp.check((select 'pitch' = any (allocation_auto) and pitch_id is not null from public.fixtures where id = f3), 'P0 an automatic allocation is recorded, part by part');
  v_state := pg_temp.try_as(v_ca, format('select public.set_arena_lock(''FIXTURE'', %L, array[''pitch'', ''home_room''])', f3));
  perform pg_temp.check(v_state = 'OK' and (select allocation_locks = array['home_room', 'pitch'] from public.fixtures where id = f3),
                        'P1 a person locks the pitch and the home room');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L, null, true)', v_club, d + 6));
  v_i := pg_temp.item(v_p, f3);
  perform pg_temp.check(v_i -> 'proposed' ->> 'pitchId' = v_i -> 'current' ->> 'pitchId', 'P2 a re-run keeps the locked pitch');
  perform pg_temp.check(v_i -> 'explanation' ->> 0 = 'Locked: the pitch and the home changing room stay as they are.',
                        'P2a and says so first, part by part: "' || coalesce(v_i -> 'explanation' ->> 0, '') || '"');
  perform pg_temp.check(v_i -> 'proposed' ->> 'homeRoomId' = v_i -> 'current' ->> 'homeRoomId', 'Q1 a re-run keeps the locked room');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''AUTO'')', v_club, d + 6,
                    jsonb_build_array(jsonb_build_object('kind', 'FIXTURE', 'id', f3, 'expected', v_i -> 'current',
                                                         'set', jsonb_build_object('pitchId',
                                                           case when v_i -> 'current' ->> 'pitchId' = a4::text then a3 else a4 end)))));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_hint() = 'ARENA_LOCKED', 'P3 automatic allocation cannot move a locked pitch');
  -- One plan can hold a person's changes and automatic ones together (Arena Planning saves them as one
  -- transaction); each change keeps its own rules, so a lock still binds an automatic change inside it.
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''MANUAL'')', v_club, d + 6,
                    jsonb_build_array(jsonb_build_object('kind', 'FIXTURE', 'id', f3, 'source', 'AUTO', 'expected', v_i -> 'current',
                                                         'set', jsonb_build_object('pitchId',
                                                           case when v_i -> 'current' ->> 'pitchId' = a4::text then a3 else a4 end)))));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_hint() = 'ARENA_LOCKED', 'P3b an automatic change inside a person''s plan still cannot move a locked pitch');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''MANUAL'')', v_club, d + 6,
                    jsonb_build_array(jsonb_build_object('kind', 'FIXTURE', 'id', f3, 'source', 'SOMEBODY', 'set', '{}'::jsonb))));
  perform pg_temp.check(v_state = '22023', 'P3c every change says whether it is a person''s or automatic');
  perform pg_temp.check(pg_temp.item(v_p, f4) -> 'proposed' ->> 'pitchId' = a1::text and not (pg_temp.item(v_p, f4) -> 'changes' ? 'PITCH'),
                        'R1 a person''s allocation is not recalculated by a re-run');

  -- A stale plan is refused rather than applied over somebody's change.
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 6));
  f5 := pg_temp.home(t_u9, d + 6, '09:00', v_main, null, 'Stale');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 6));
  update public.fixtures set pitch_id = a5, pitch_allocation = 'A5' where id = f5;
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''AUTO'')', v_club, d + 6, pg_temp.changes_of(v_p)));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_hint() = 'ARENA_STALE', 'R2 a plan made before somebody else''s change is refused, not applied over it');

  -- ======================================================================================
  -- S. TWO GROUNDS
  -- ======================================================================================
  perform pg_temp.try_as(v_ca, format('select public.save_facility_preferences(%L, %L, ''VENUE'', %L::uuid[])', v_club, t_u11, array[v_train]));
  f6 := pg_temp.home(t_u11, d + 7, '10:00', v_main, null, 'Second Ground');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 7));
  v_i := pg_temp.item(v_p, f6);
  perform pg_temp.check(v_i -> 'proposed' ->> 'pitchId' = b1::text and v_i -> 'proposed' ->> 'venueId' = v_train::text
                        and v_i -> 'changes' ? 'VENUE' and v_i -> 'proposed' ->> 'homeRoomId' = rb::text,
                        'S1 a team that prefers the training ground is planned there, with that ground''s room');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''AUTO'')', v_club, d + 7, pg_temp.changes_of(v_p)));
  perform pg_temp.check(v_state = 'OK' and (select venue_id = v_train and pitch_id = b1 and home_changing_room_id = rb from public.fixtures where id = f6),
                        'S2 Apply moves it between grounds in one step');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L, %L)', v_club, d + 7, v_main));
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(v_p -> 'items') x where x -> 'proposed' ->> 'pitchId' = b1::text),
                        'S3 planning one ground proposes only that ground''s pitches');

  -- ======================================================================================
  -- T-V. TRAINING, A TOURNAMENT AND AN EVENT HOLD A PITCH
  -- ======================================================================================
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  s3 := public.create_training_session(v_club, t_u9, null, d + 8, '17:00', '18:00', null, null, v_main);
  perform set_config('role', 'none', true);
  f7 := pg_temp.home(t_u16, d + 8, '16:30', v_main, a1, 'Evening');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 8));
  perform pg_temp.check(pg_temp.item(v_p, s3) -> 'proposed' ->> 'pitchId' is distinct from a1::text
                        and pg_temp.item(v_p, s3) -> 'proposed' ->> 'pitchId' is not null,
                        'T1 training is planned around a fixture, never onto its pitch');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''MANUAL'')', v_club, d + 8,
                    jsonb_build_array(jsonb_build_object('kind', 'TRAINING', 'id', s3,
                                                         'set', jsonb_build_object('pitchId', pg_temp.item(v_p, s3) -> 'proposed' ->> 'pitchId')))));
  perform pg_temp.check(v_state = 'OK' and (select is_overridden and pitch_id is not null from public.training_sessions where id = s3),
                        'T1b a pitch Arena gives a session is that session''s own: editing its training plan later cannot take it away');

  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                  conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
  values (v_club, (select directory_id from public.clubs where id = v_club), 'union', d + 9, d + 9, 'confirmed', 'Arena Cup',
          gen_random_uuid(), 'round_robin', 'private', v_main, '09:00', '14:00')
  returning id into v_t1;
  f8 := pg_temp.home(t_u16, d + 9, '10:00', v_main, a3, 'Reserved');
  v_state := pg_temp.try_as(v_ca, format('select public.reserve_tournament_pitch(%L, %L, %L, ''09:00'', ''14:00'')', v_t1, a3, d + 9));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_msg() like 'A3 is reserved for Arena Cup from 09:00 to 14:00, and%',
                        'U1 a tournament cannot reserve a pitch a fixture is using: "' || coalesce(pg_temp.last_msg(), '') || '"');
  v_state := pg_temp.try_as(v_ca, format('select public.reserve_tournament_pitch(%L, %L, %L, ''09:00'', ''14:00'', 3)', v_t1, a4, d + 9));
  perform pg_temp.check(v_state = 'OK', 'U2 it reserves a free pitch, marked out for three');
  f1 := pg_temp.home(t_u12, d + 9, '11:00', v_main, null, 'Into Tournament');
  v_state := pg_temp.try_as(v_ca, format('select public.set_fixture_facilities(%L, %L::jsonb)', f1, jsonb_build_object('pitch_id', a4)));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_msg() like 'A4 is reserved for Arena Cup%', 'U3 a fixture cannot use a pitch a tournament has reserved');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 9));
  perform pg_temp.check(pg_temp.item(v_p, f1) -> 'proposed' ->> 'pitchId' not in (a4::text, a3::text), 'U4 automatic allocation plans around the tournament');

  -- An event reserving A5 from 18:00 to 22:00.
  insert into public.club_events (club_id, name, starts_on, ends_on, start_time, end_time, status, location_kind, venue_id, event_type)
  values (v_club, 'Arena Fireworks', d + 10, d + 10, '18:00', '22:00', 'SCHEDULED', 'VENUE', v_main, 'SOCIAL') returning id into v_ev2;
  insert into public.club_event_pitches (event_id, pitch_id) values (v_ev2, a5);
  f2 := pg_temp.home(t_u16, d + 10, '19:00', v_main, null, 'Evening Match');
  v_state := pg_temp.try_as(v_ca, format('select public.set_fixture_facilities(%L, %L::jsonb)', f2, jsonb_build_object('pitch_id', a5)));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_msg() like 'A5 is reserved for Arena Fireworks from 18:00 to 22:00%',
                        'V1 an event''s explicit pitch holds against a fixture');
  v_state := pg_temp.try_as(v_ca, format('select public.create_training_session(%L, %L, null, %L, ''19:00'', ''20:00'', %L, null, %L)', v_club, t_u14, d + 10, a5, v_main));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_msg() like 'A5 is reserved for Arena Fireworks%', 'V2 and against training');
  insert into public.club_events (club_id, name, starts_on, ends_on, start_time, end_time, status, location_kind, venue_id, event_type)
  values (v_club, 'Arena Quiz Night', d + 10, d + 10, '18:00', '22:00', 'SCHEDULED', 'VENUE', v_main, 'SOCIAL');
  v_state := pg_temp.try_as(v_ca, format('select public.set_fixture_facilities(%L, %L::jsonb)', f2, jsonb_build_object('pitch_id', a1)));
  perform pg_temp.check(v_state = 'OK', 'V3 an event at the same ground with no pitch reserved blocks no pitch');

  -- ======================================================================================
  -- W-X. AN AWAY FIXTURE, AND CATERING NOBODY CAN COUNT
  -- ======================================================================================
  insert into public.fixtures (owning_team_id, opponent_directory_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (t_u14, pg_temp.directory_only('Hosts'), 'Away', 'Arena Hosts RFC', d + 11, '10:00', 'Planned', 'club_created')
  returning id into f_away;
  perform pg_temp.check(not exists (select 1 from internal.arena_occupancy(v_club, d + 11, d + 11) where activity_id = f_away),
                        'W1 an away fixture claims none of the club''s pitches or rooms');
  v_x := pg_temp.json_as(v_ca, format('select public.get_arena_day(%L, %L)', v_club, d + 11));
  perform pg_temp.check((select (a ->> 'home')::boolean = false and jsonb_array_length(a -> 'needs') = 0
                         from jsonb_array_elements(v_x -> 'activities') a where a ->> 'id' = f_away::text),
                        'W2 the day lists it as away, needing nothing');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 11));
  perform pg_temp.check(pg_temp.item(v_p, f_away) is null, 'W3 automatic allocation never plans it');

  f3 := pg_temp.home(t_u12, d + 12, '10:00', v_main, a1, 'Catering');
  update public.fixtures set catering_required = true where id = f3;
  insert into public.player_fixture_attendance (fixture_id, player_id, status, responded_by_user_id, response_source)
  values (f3, v_child, 'ATTENDING', v_parent, 'guardian');
  v_x := pg_temp.json_as(v_ca, format('select public.get_arena_day(%L, %L)', v_club, d + 12));
  v_i := (select a from jsonb_array_elements(v_x -> 'activities') a where a ->> 'id' = f3::text);
  perform pg_temp.check((v_i -> 'catering' ->> 'total')::int = 1 and v_i -> 'catering' -> 'sidesNotCounted' ? 'away'
                        and (v_i -> 'catering' ->> 'visible')::boolean,
                        'X1 the visitors'' attendance is not counted, never zero: 1 known, away not counted');
  perform pg_temp.check((v_x -> 'readiness' ->> 'cateringIncomplete')::int = 1 and (v_x -> 'readiness' ->> 'cateringKnown')::int = 1,
                        'X2 the day says one catering total is incomplete');
  v_x := pg_temp.json_as(v_ca, format('select public.get_match_centre_attendance(%L)', f3));
  perform pg_temp.check((v_x -> 'catering' ->> 'total')::int = 1 and v_x -> 'catering' -> 'sidesNotCounted' ? 'away',
                        'X3 the Match Centre shows the same count from the same function');

  -- ======================================================================================
  -- Y. THE SAME DAY PLANNED TWICE GIVES THE SAME PLAN
  -- ======================================================================================
  f4 := pg_temp.home(t_u9, d + 13, '09:30', v_main, null, 'Repeat A');
  f5 := pg_temp.home(t_u10, d + 13, '09:30', v_main, null, 'Repeat B');
  f6 := pg_temp.home(t_u14, d + 13, '11:00', v_main, null, 'Repeat C');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 13));
  v_p2 := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 13));
  perform pg_temp.check(v_p = v_p2, 'Y1 identical inputs give an identical proposal');

  -- ======================================================================================
  -- Z. ANOTHER CLUB'S ADMINISTRATOR, AND EVERYONE WITHOUT THE AUTHORITY
  -- ======================================================================================
  perform pg_temp.check(pg_temp.try_as(v_xa, format('select public.get_arena_day(%L, %L)', v_club, d)) = '42501'
                        and pg_temp.try_as(v_xa, format('select public.get_arena_hub(%L)', v_club)) = '42501'
                        and pg_temp.try_as(v_xa, format('select public.preview_arena_allocation(%L, %L)', v_club, d)) = '42501'
                        and pg_temp.try_as(v_xa, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''MANUAL'')', v_club, d + 13,
                              jsonb_build_array(jsonb_build_object('kind', 'FIXTURE', 'id', f4, 'set', jsonb_build_object('pitchId', a1))))) = '42501'
                        and pg_temp.try_as(v_xa, format('select public.save_facility_preferences(%L, null, ''MATCH_PITCH'', %L::uuid[])', v_club, array[a1])) = '42501'
                        and pg_temp.try_as(v_xa, format('select public.set_arena_lock(''FIXTURE'', %L, array[''pitch''])', f3)) = '42501',
                        'Z1 another club''s administrator can read and change nothing of this club''s estate');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''MANUAL'')', v_club, d + 13,
                    jsonb_build_array(jsonb_build_object('kind', 'FIXTURE', 'id', f4, 'set', jsonb_build_object('pitchId', x1)))));
  perform pg_temp.check(v_state = '42501', 'Z2 this club''s administrator cannot put a match on another club''s pitch');
  v_state := pg_temp.try_as(v_ca, format('select public.set_fixture_facilities(%L, %L::jsonb)', f4, jsonb_build_object('home_room_id', rx)));
  perform pg_temp.check(v_state <> 'OK', 'Z3 nor in another club''s changing room');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''MANUAL'')', v_other, d + 13,
                    jsonb_build_array(jsonb_build_object('kind', 'FIXTURE', 'id', f4, 'set', jsonb_build_object('pitchId', a1)))));
  perform pg_temp.check(v_state = '42501', 'Z4 naming another club does not borrow its authority');
  perform pg_temp.check(pg_temp.try_as(v_member, format('select public.get_arena_day(%L, %L)', v_club, d)) = '42501'
                        and pg_temp.try_as(v_parent, format('select public.get_arena_hub(%L)', v_club)) = '42501',
                        'Z5 a member or a parent cannot read Arena');
  perform pg_temp.check(pg_temp.try_as(v_fs, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 13)) = 'OK',
                        'Z6 the Fixtures Secretary plans the estate');
  v_x := pg_temp.json_as(v_ca, format('select public.get_arena_day(%L, %L)', v_club, d + 12));
  perform pg_temp.check(v_x::text not like '%Twelve%', 'Z7 Arena''s day carries counts, never a player''s name');
  -- The preferences themselves, read straight from the table rather than through an RPC: row security keeps
  -- them to this club's own planners (the isolation matrix classifies the table with venues and pitches, 4e).
  perform pg_temp.check(
    (pg_temp.json_as(v_xa, format('select to_jsonb(count(*)) from public.facility_preferences where club_id = %L', v_club)))::int = 0
    and (pg_temp.json_as(v_member, format('select to_jsonb(count(*)) from public.facility_preferences where club_id = %L', v_club)))::int = 0
    and (pg_temp.json_as(v_ca, format('select to_jsonb(count(*)) from public.facility_preferences where club_id = %L', v_club)))::int > 0,
    'Z8 another club''s administrator and a member read none of this club''s facility preferences; its planners do');

  -- ======================================================================================
  -- T. TOURNAMENTS ON THE ESTATE: TWO TOURNAMENTS, ONE PITCH
  -- ======================================================================================
  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                  conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
  values (v_club, (select directory_id from public.clubs where id = v_club), 'union', d + 14, d + 14, 'confirmed', 'Arena Shield',
          gen_random_uuid(), 'round_robin', 'private', v_main, '10:00', '14:00')
  returning id into v_t2;
  update public.tournaments set event_date = d + 14, ends_on = d + 14 where id = v_t1;
  v_state := pg_temp.try_as(v_ca, format('select public.reserve_tournament_pitch(%L, %L, %L, ''10:00'', ''14:00'', 1)', v_t1, a2, d + 14));
  perform pg_temp.check(v_state = 'OK', 'T1 tournament A reserves A2 from 10:00 to 14:00, one game at a time');
  v_state := pg_temp.try_as(v_ca, format('select public.reserve_tournament_pitch(%L, %L, %L, ''11:00'', ''13:00'', 3)', v_t2, a2, d + 14));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_msg() like '%marked out for one game%' and pg_temp.last_msg() like '%marked out for three games%'
                        and pg_temp.last_msg() like '%Arena Shield%' and pg_temp.last_msg() like '%Arena Cup%',
                        'T2 tournament B cannot mark the same pitch out differently at the same time: "' || coalesce(pg_temp.last_msg(), '') || '"');
  v_state := pg_temp.try_as(v_ca, format('select public.reserve_tournament_pitch(%L, %L, %L, ''11:00'', ''13:00'', 1)', v_t2, a2, d + 14));
  perform pg_temp.check(v_state = 'OK', 'T3 marked out the same way, the two may share it');
  v_state := pg_temp.try_as(v_ca, format('select public.reserve_tournament_pitch(%L, %L, %L, ''11:00'', ''13:00'')', v_t2, a5, d + 14));
  perform pg_temp.check(v_state = 'OK', 'T4 a different pitch at the same time is free');
  v_state := pg_temp.try_as(v_ca, format('select public.reserve_tournament_pitch(%L, %L, %L, ''14:00'', ''16:00'', 3)', v_t2, a2, d + 14));
  perform pg_temp.check(v_state = 'OK', 'T5 the same pitch after the other has finished is free, however it is marked');

  -- Tournament A publishes a game on A2 at 11:00; tournament B then puts one there at 11:00 -- one area.
  insert into public.tournament_age_groups (tournament_id, age_group) values (v_t1, 'U12'), (v_t2, 'U12');
  -- A plan-less game counts as published.
  insert into public.tournament_participants (tournament_id, club_directory_id, age_group, status)
  values (v_t1, pg_temp.directory_only('Cup One'), 'U12', 'external_recorded') returning id into v_res;
  insert into public.tournament_participants (tournament_id, club_directory_id, age_group, status)
  values (v_t1, pg_temp.directory_only('Cup Two'), 'U12', 'external_recorded') returning id into v_res2;
  insert into public.tournament_games (tournament_id, age_group, game_date, start_time, duration_minutes, pitch_id, status, side_a_id, side_b_id)
  values (v_t1, 'U12', d + 14, '11:00', 20, a2, 'SCHEDULED', v_res, v_res2)
  returning id into v_g;
  insert into public.tournament_participants (tournament_id, club_directory_id, age_group, status)
  values (v_t2, pg_temp.directory_only('Shield One'), 'U12', 'external_recorded') returning id into v_res;
  insert into public.tournament_participants (tournament_id, club_directory_id, age_group, status)
  values (v_t2, pg_temp.directory_only('Shield Two'), 'U12', 'external_recorded') returning id into v_res2;
  insert into public.tournament_games (tournament_id, age_group, game_date, start_time, duration_minutes, pitch_id, status, side_a_id, side_b_id)
  values (v_t2, 'U12', d + 14, '11:00', 20, a2, 'SCHEDULED', v_res, v_res2);
  perform pg_temp.check(exists (select 1 from internal.tournament_schedule_conflicts(v_t2) c
                                where c.code = 'PITCH_CLASH' and c.message like '%Arena Cup also has a game on it then.%'),
                        'T6 tournament B''s clash engine counts tournament A''s game on the shared pitch, and names it');
  update public.tournament_games set start_time = '11:10' where tournament_id = v_t2;
  perform pg_temp.check(exists (select 1 from internal.tournament_schedule_conflicts(v_t2) c where c.code = 'PITCH_CLASH'),
                        'T7 an overlapping game (11:10 into an 11:00-11:20 game) is a clash too');
  update public.tournament_games set start_time = '11:20' where tournament_id = v_t2;
  perform pg_temp.check(not exists (select 1 from internal.tournament_schedule_conflicts(v_t2) c where c.code in ('PITCH_CLASH', 'PITCH_TURNAROUND')),
                        'T8 after it, the shared pitch is free');
  v_x := pg_temp.json_as(v_ca, format('select public.get_arena_day(%L, %L)', v_club, d + 14));
  perform pg_temp.check((select count(*) from jsonb_array_elements(v_x -> 'occupancy') o
                         where o ->> 'activityType' = 'TOURNAMENT' and o ->> 'resourceId' = a2::text) = 3
                        and exists (select 1 from jsonb_array_elements(v_x -> 'activities') a
                                    where a ->> 'kind' = 'TOURNAMENT' and a ->> 'id' = v_t2::text
                                      and exists (select 1 from jsonb_array_elements(a -> 'reservations') r where (r ->> 'areas')::int = 3)),
                        'T9 Arena sees each reservation as its organiser marked it');
  perform pg_temp.check((select layout = 'two_halves' and lane_count = 2 from public.club_pitches where id = a2),
                        'T10 the club''s own layout is never changed by a tournament');
  -- U9 and U11 on a full pitch marked out for three: a U9 game fits a third, a U11 game does not.
  perform pg_temp.check(internal.tournament_game_area_m2(v_t1, 'U9') <= internal.pitch_area_m2(a4) / 3
                        and internal.tournament_game_area_m2(v_t1, 'U11') > internal.pitch_area_m2(a4) / 3,
                        'T11 by the register: a U9 game fits a third of a full-size pitch, a U11 game does not');

  -- ======================================================================================
  -- P. THE WHAT-IF FORM AGREES WITH THE ENGINE
  -- ======================================================================================
  f1 := pg_temp.home(t_u12, d + 15, '10:00', v_main, a1, 'Parity Held');
  f2 := pg_temp.home(t_u11, d + 15, '10:30', v_main, null, 'Parity Mover');
  perform internal.arena_load_day(v_club, d + 15);
  v_n := (select count(*) from internal.arena_blockers('FIXTURE', f2, null, 'PITCH', a1, 615, 630, 670, 685, 700, 'half', 0));
  update public.fixtures set pitch_id = a1 where id = f2;
  v_m := (select count(*) from internal.arena_conflicts(v_club, d + 15, d + 15) c where f2 = any (c.activity_ids) and c.severity = 'hard');
  perform pg_temp.check(v_n > 0 and v_m > 0, 'P1 a placement the what-if form blocks is one the engine reports');
  update public.fixtures set pitch_id = null where id = f2;
  perform internal.arena_load_day(v_club, d + 15);
  v_n := (select count(*) from internal.arena_blockers('FIXTURE', f2, null, 'PITCH', a3, 615, 630, 670, 685, 700, 'half', 0));
  update public.fixtures set pitch_id = a3 where id = f2;
  v_m := (select count(*) from internal.arena_conflicts(v_club, d + 15, d + 15) c where f2 = any (c.activity_ids) and c.severity = 'hard');
  perform pg_temp.check(v_n = 0 and v_m = 0, 'P2 and one it allows, the engine finds clear');

  -- ======================================================================================
  -- N. NOTICES: ONCE PER PERSON PER FIXTURE, NEVER THE PERSON WHO DID IT
  -- ======================================================================================
  f3 := pg_temp.home(t_u12, d + 16, '10:00', v_main, null, 'Notice One');
  v_before := (select count(*) from public.notifications where user_id in (v_parent, v_ca));
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 16));
  perform pg_temp.check((select count(*) from public.notifications where user_id in (v_parent, v_ca)) = v_before,
                        'N1 a preview tells nobody');
  perform pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''AUTO'')', v_club, d + 16, pg_temp.changes_of(v_p)));
  perform pg_temp.check((select count(*) from public.notifications where user_id = v_parent and data ->> 'fixture_id' = f3::text) = 1,
                        'N2 a family hears once about a fixture whose pitch and rooms were allocated together');
  perform pg_temp.check((select count(*) from public.notifications where user_id = v_ca and data ->> 'fixture_id' = f3::text) = 0,
                        'N3 the person who applied the plan is not told about their own change');
  v_before := (select count(*) from public.notifications where user_id = v_parent);
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L, null, true)', v_club, d + 16));
  perform pg_temp.check(pg_temp.changes_of(v_p) = '[]'::jsonb, 'N4 a re-run that changes nothing has nothing to apply');
  -- A rooms-only change is never announced as a new location -- even on a fixture whose pitch name was
  -- never cached (create_fixture stores the pitch without it; live UAT, 25 October: "is now at ... Pitch 3").
  f4 := pg_temp.home(t_u12, d + 17, '10:00', v_main, a1, 'Notice Rooms');
  update public.fixtures set pitch_allocation = null where id = f4;
  v_before := (select count(*) from public.notifications where user_id = v_parent and data ->> 'fixture_id' = f4::text and type = 'fixture_pitch_changed');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''MANUAL'')', v_club, d + 17,
               jsonb_build_array(jsonb_build_object('kind', 'FIXTURE', 'id', f4,
                                                    'expected', jsonb_build_object('homeRoomId', null, 'awayRoomId', null),
                                                    'set', jsonb_build_object('homeRoomId', r1, 'awayRoomId', r2)))));
  perform pg_temp.check(v_state = 'OK'
                        and (select count(*) from public.notifications where user_id = v_parent and data ->> 'fixture_id' = f4::text and type = 'fixture_pitch_changed') = v_before
                        and (select pitch_allocation = 'A1' and home_changing_room_id = r1 from public.fixtures where id = f4),
                        'N5 a rooms-only change is not announced as a new location, and the pitch''s name is cached now: ' || coalesce(pg_temp.last_msg(), v_state));

  -- ======================================================================================
  -- EC. AN EVENT'S PITCHES FROM THE EVENT CENTRE (save_event): reserved at its own ground, guarded by the
  --    estate engine, and never left behind at a ground the event no longer uses
  -- ======================================================================================
  f5 := pg_temp.home(t_u16, d + 18, '14:00', v_main, a3, 'Event Clash');   -- on the pitch the event will hold
  f6 := pg_temp.home(t_u14, d + 18, '14:00', v_main, a1, 'Event Clash Two');
  v_x := pg_temp.json_as(v_ca, format('select public.save_event(null, %L, %L::jsonb)', v_club, jsonb_build_object(
           'name', 'Arena Gala Two', 'event_type', 'SOCIAL', 'starts_on', d + 18, 'start_time', '10:00', 'end_time', '12:00',
           'location_kind', 'VENUE', 'venue_id', v_main, 'is_club_wide', true, 'team_ids', '[]'::jsonb, 'pitch_ids', jsonb_build_array(a3))));
  v_ev2 := (v_x ->> 'eventId')::uuid;
  perform pg_temp.check((select array_agg(pitch_id) = array[a3] from public.club_event_pitches where event_id = v_ev2)
                        and v_x -> 'pitchIds' = jsonb_build_array(a3),
                        'EC1 the Event Centre reserves a pitch at the event''s own ground');
  perform pg_temp.check(pg_temp.json_as(v_ca, format('select public.get_event_centre(%L)', v_ev2)) -> 'location' -> 'pitches' -> 0 ->> 'name' = 'A3',
                        'EC2 and the Event Centre reads back which pitch it holds');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.save_event(%L, null, %L::jsonb)', v_ev2, jsonb_build_object('pitch_ids', jsonb_build_array(b1)))) = '42501',
                        'EC3 a pitch at another ground is refused');
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.save_event(%L, null, %L::jsonb)', v_ev2,
                          jsonb_build_object('start_time', '13:00', 'end_time', '16:00'))) <> 'OK'
                        and (select start_time = '10:00' from public.club_events where id = v_ev2),
                        'EC4 moving the event onto a fixture''s time on the pitch it holds is refused, in words: ' || coalesce(pg_temp.last_msg(), ''));
  perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.save_event(%L, null, %L::jsonb)', v_ev2,
                          jsonb_build_object('pitch_ids', jsonb_build_array(a1), 'start_time', '13:00', 'end_time', '16:00'))) <> 'OK'
                        and not exists (select 1 from public.club_event_pitches where event_id = v_ev2 and pitch_id = a1),
                        'EC5 and so is reserving the pitch the fixture is on');
  perform pg_temp.try_as(v_ca, format('select public.save_event(%L, null, %L::jsonb)', v_ev2, jsonb_build_object('location_kind', 'VENUE', 'venue_id', v_train)));
  perform pg_temp.check((select venue_id = v_train from public.club_events where id = v_ev2)
                        and not exists (select 1 from public.club_event_pitches where event_id = v_ev2),
                        'EC6 an event moved to another ground leaves the old ground''s pitches, rather than holding them from afar');
  perform pg_temp.try_as(v_ca, format('select public.save_event(%L, null, %L::jsonb)', v_ev2, jsonb_build_object('pitch_ids', jsonb_build_array(b1))));
  perform pg_temp.try_as(v_ca, format('select public.save_event(%L, null, %L::jsonb)', v_ev2,
                          jsonb_build_object('location_kind', 'EXTERNAL', 'external', jsonb_build_object('name', 'The Village Hall'))));
  perform pg_temp.check(not exists (select 1 from public.club_event_pitches where event_id = v_ev2),
                        'EC7 and an event that moves away from the club''s grounds holds no pitch at all');
  perform pg_temp.check(pg_temp.try_as(v_xa, format('select public.save_event(%L, null, %L::jsonb)', v_ev2, jsonb_build_object('pitch_ids', '[]'::jsonb))) = '42501',
                        'EC8 another club''s administrator changes nothing');

  -- ======================================================================================
  -- BA. WHAT IS BOOKED ON A RESOURCE FROM TODAY (said before it is deactivated)
  -- ======================================================================================
  v_x := pg_temp.json_as(v_ca, format('select public.get_resource_bookings_ahead(''PITCH'', %L)', a3));
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(v_x -> 'bookings') b where b ->> 'kind' = 'FIXTURE' and (b ->> 'count')::int >= 1),
                        'BA1 a pitch says what is booked on it from today, by kind: ' || coalesce(v_x::text, 'null'));
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(v_x -> 'bookings') b where b ->> 'kind' not in ('FIXTURE', 'TRAINING', 'TOURNAMENT', 'EVENT'))
                        and not (v_x::text ~ 'Arena [A-Z]'),
                        'BA2 counts and kinds only -- never a name');
  perform pg_temp.check(pg_temp.try_as(v_xa, format('select public.get_resource_bookings_ahead(''PITCH'', %L)', a3)) = '42501'
                        and pg_temp.try_as(v_member, format('select public.get_resource_bookings_ahead(''ROOM'', %L)', r1)) = '42501',
                        'BA3 another club''s administrator and a member see nothing');
  v_x := pg_temp.json_as(v_ca, format('select public.get_resource_bookings_ahead(''VENUE'', %L)', v_main));
  perform pg_temp.check((select coalesce(sum((b ->> 'count')::int), 0) from jsonb_array_elements(v_x -> 'bookings') b)
                        >= (select coalesce(sum((b ->> 'count')::int), 0) from jsonb_array_elements(pg_temp.json_as(v_ca, format('select public.get_resource_bookings_ahead(''PITCH'', %L)', a3)) -> 'bookings') b),
                        'BA4 a whole ground counts everything on any of its pitches and rooms: ' || coalesce(v_x::text, 'null'));

  -- ======================================================================================
  -- SETTINGS, LOCK VALIDATION AND THE DAY'S SHAPE
  -- ======================================================================================
  v_x := pg_temp.json_as(v_ca, format('select public.save_arena_settings(%L, %L::jsonb)', v_club, '{"roomAccessMinutes": 45, "roomReleaseMinutes": 20}'));
  perform pg_temp.check((v_x ->> 'roomAccess')::int = 45 and (v_x ->> 'roomRelease')::int = 20 and v_x ->> 'roomSource' = 'club',
                        'S4 the club sets its own room times');
  v_state := pg_temp.try_as(v_ca, format('select public.save_arena_settings(%L, %L::jsonb)', v_club, '{"roomAccessMinutes": 7}'));
  perform pg_temp.check(v_state = '22023', 'S5 a room time off the 5-minute steps is refused in words');
  -- S6 changed with the owner's rule of 2026-10-04: a session that asked for a changing room holds one (its
  -- team's own, home_room), so it may lock it as it locks its pitch. A match's away or officials room is
  -- still nothing a session has.
  v_state := pg_temp.try_as(v_ca, format('select public.set_arena_lock(''TRAINING'', %L, array[''away_room''])', s3));
  perform pg_temp.check(v_state = '22023', 'S6 a session locks only its pitch and its own changing room, never an away or officials room');
  v_x := pg_temp.json_as(v_ca, format('select public.get_arena_day(%L, %L)', v_club, d + 5));
  perform pg_temp.check(v_x ? 'readiness' and v_x ? 'occupancy' and v_x ? 'conflicts' and jsonb_array_length(v_x -> 'venues') = 2
                        and v_x -> 'policy' ->> 'roomSource' = 'club',
                        'S7 one day is one read: venues, occupancy, conflicts and readiness together');
  v_x := pg_temp.json_as(v_ca, format('select public.get_arena_allocation_options(''FIXTURE'', %L)', f2));
  perform pg_temp.check(jsonb_array_length(v_x -> 'pitches') >= 6
                        and exists (select 1 from jsonb_array_elements(v_x -> 'pitches') p where p ->> 'state' = 'UNSUITABLE' and p ->> 'id' = asm::text)
                        and exists (select 1 from jsonb_array_elements(v_x -> 'pitches') p where p ->> 'state' = 'CURRENT'),
                        'S8 the Allocate sheet shows every pitch with its state, the unsuitable ones with their reason');
  v_x := pg_temp.json_as(v_ca, format('select public.get_arena_preferences(%L)', v_club));
  perform pg_temp.check(v_x -> 'clubDefault' -> 'MATCH_PITCH' = to_jsonb(array[a5, a4])
                        and exists (select 1 from jsonb_array_elements(v_x -> 'teams') t
                                    where t -> 'team' ->> 'id' = t_u14::text and t -> 'preferences' -> 'MATCH_PITCH' = to_jsonb(array[a3])),
                        'S9 the preferences read shows the club default and each team''s override');
  perform pg_temp.try_as(v_ca, format('select public.save_facility_preferences(%L, %L, ''MATCH_PITCH'', ''{}''::uuid[])', v_club, t_u14));
  perform pg_temp.check(internal.facility_preference_ids(v_club, t_u14, 'MATCH_PITCH') = array[a5, a4]
                        and internal.facility_preference_source(v_club, t_u14, 'MATCH_PITCH') = 'CLUB',
                        'S10 clearing a team''s list hands it back to the club default');

  -- ======================================================================================
  -- K. A FIXTURE WITH NO KICK-OFF YET IS PROPOSED ONE; AN AGREED TIME IS NEVER MOVED
  -- ======================================================================================
  v_n := (6 - extract(isodow from d + 20)::int + 7) % 7;   -- the next Saturday from d + 20
  insert into public.fixtures (owning_team_id, opponent_directory_id, home_away, raw_opposition_text, kickoff_date, status, source, venue_id)
  values (t_u9, pg_temp.directory_only('No Time'), 'Home', 'Arena No Time RFC', d + 20 + v_n, 'Planned', 'club_created', v_main)
  returning id into f1;
  f2 := pg_temp.home(t_u14, d + 20 + v_n, '09:00', v_main, null, 'Timed');
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 20 + v_n));
  v_i := pg_temp.item(v_p, f1);
  perform pg_temp.check(v_i -> 'changes' ? 'KICKOFF' and (v_i -> 'proposed' ->> 'kickoff') between '09:00' and '11:45'
                        and v_i -> 'proposed' ->> 'pitchId' is not null and (v_i -> 'explanation' ->> 0) like 'No kick-off time yet: proposed %',
                        'KO1 a youth fixture with no kick-off is proposed a morning slot on a free pitch: "' || coalesce(v_i -> 'explanation' ->> 0, '') || '"');
  perform pg_temp.check(not (pg_temp.item(v_p, f2) -> 'changes' ? 'KICKOFF') and pg_temp.item(v_p, f2) -> 'proposed' ->> 'kickoff' is null,
                        'KO2 a fixture with an agreed kick-off keeps it');
  perform pg_temp.check((v_p -> 'summary' ->> 'kickoffProposals')::int = 1, 'KO3 the summary counts the kick-off proposed');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''AUTO'')', v_club, d + 20 + v_n, pg_temp.changes_of(v_p)));
  perform pg_temp.check(v_state = 'OK' and (select kickoff_time is not null and pitch_id is not null and kickoff_time = (v_i -> 'proposed' ->> 'kickoff')::time
                                            from public.fixtures where id = f1),
                        'KO4 Apply sets the kick-off and the pitch together (the opposition is not on Ovalball, so nothing waits for its agreement)');
  perform pg_temp.check((select kickoff_time = '09:00' from public.fixtures where id = f2), 'KO5 and leaves the agreed time where it was');

  -- ======================================================================================
  -- TR. TRAINING CHANGING ROOMS, SHARED PITCHES AND WHO OWNS A TIME (the owner's rules, 2026-10-04)
  -- ======================================================================================
  -- Four groups train at 18:00 on one evening. U9 and U10 share A1; U11 is on A2; U12 has no pitch yet.
  -- U12's training plan asks for a changing room for every session; U11 asks for this session only; U9
  -- and U10 ask for nothing. The main ground has rooms 1-4 and an officials room.
  insert into public.training_plans (club_id, team_id, schedule_mode, preferred_venue_id, preferred_pitch_id, status, needs_changing_room)
  values (v_club, t_u12, 'CUSTOM', v_main, a3, 'ACTIVE', true) returning id into tp1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  ts1 := public.create_training_session(v_club, t_u9, null, d + 30, '18:00', '19:00', a1, null, v_main);
  ts2 := public.create_training_session(v_club, t_u10, null, d + 30, '18:00', '19:00', a1, null, v_main);
  ts3 := public.create_training_session(v_club, t_u11, null, d + 30, '18:00', '19:00', a2, null, v_main);
  ts4 := public.create_training_session(v_club, t_u12, null, d + 30, '18:00', '19:00', null, null, v_main);
  update public.training_sessions set training_plan_id = tp1 where id = ts4;  -- this session follows U12's plan
  v_state := pg_temp.try_as(v_ca, format('select public.override_training_session(p_session_id => %L, p_needs_changing_room => true)', ts3));
  perform pg_temp.check(v_state = 'OK' and (select needs_changing_room from public.training_sessions where id = ts3),
                        'TR1 one session asks for a changing room through the Training Centre''s own writer');

  perform pg_temp.check(not exists (select 1 from internal.arena_conflicts(v_club, d + 30, d + 30) c where c.resource_type = 'PITCH'),
                        'TR2 two groups training on one pitch at once is no clash: training shares a pitch without limit');
  v_x := pg_temp.json_as(v_ca, format('select public.get_arena_day(%L, %L)', v_club, d + 30));
  perform pg_temp.check((select (a -> 'needsRoom')::boolean and a ->> 'roomRequest' = 'PLAN' and a -> 'needs' ? 'ROOMS' and a -> 'needs' ? 'PITCH'
                         from jsonb_array_elements(v_x -> 'activities') a where a ->> 'id' = ts4::text)
                        and (select (a -> 'needsRoom')::boolean and a ->> 'roomRequest' = 'SESSION' and a -> 'needs' = '["ROOMS"]'::jsonb
                             from jsonb_array_elements(v_x -> 'activities') a where a ->> 'id' = ts3::text)
                        and (select not (a -> 'needsRoom')::boolean and a -> 'needs' = '[]'::jsonb
                             from jsonb_array_elements(v_x -> 'activities') a where a ->> 'id' = ts1::text),
                        'TR3 the day says who asked for a room (the plan, or the session) and only they need one');
  perform pg_temp.check((select (dd ->> 'needsAllocation')::int = 2 from jsonb_array_elements(pg_temp.json_as(v_ca,
                           format('select public.get_arena_range(%L, %L, %L)', v_club, d + 30, d + 30)) -> 'days') dd),
                        'TR4 the week counts a session waiting only for its room as unallocated');

  -- Auto Allocate: rooms only for the two that asked, never the same room twice, U12's preference first.
  perform pg_temp.try_as(v_ca, format('select public.save_facility_preferences(%L, %L, ''HOME_ROOM'', array[%L]::uuid[])', v_club, t_u12, r3));
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 30));
  perform pg_temp.check(pg_temp.item(v_p, ts4) -> 'proposed' ->> 'homeRoomId' = r3::text
                        and pg_temp.item(v_p, ts4) -> 'proposed' ->> 'pitchId' is not null
                        and pg_temp.item(v_p, ts3) -> 'proposed' ->> 'homeRoomId' is not null
                        and pg_temp.item(v_p, ts3) -> 'proposed' ->> 'homeRoomId' <> r3::text
                        and pg_temp.item(v_p, ts1) -> 'proposed' ->> 'homeRoomId' is null
                        and pg_temp.item(v_p, ts2) -> 'proposed' ->> 'homeRoomId' is null,
                        'TR5 Auto Allocate gives a room only to the sessions that asked, its preferred room first, one team per room');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''AUTO'')', v_club, d + 30, pg_temp.changes_of(v_p)));
  perform pg_temp.check(v_state = 'OK' and (select changing_room_id = r3 and changing_room_source = 'AUTO' and is_overridden
                                            from public.training_sessions where id = ts4),
                        'TR6 Apply stores the room on the session, as automatic and as that session''s own');
  perform pg_temp.check(exists (select 1 from internal.arena_occupancy(v_club, d + 30, d + 30) o
                                where o.activity_id = ts4 and o.resource_type = 'ROOM' and o.resource_id = r3 and o.room_role = 'TRAINING'
                                  and o.occupied_from = 18 * 60 and o.occupied_until = 19 * 60
                                  and o.turnaround_until = 19 * 60 + (select p.room_turnaround from internal.arena_policy(v_club) p)),
                        'TR7 the room is held for the session itself, then the club''s room turnaround');

  -- One team per room: a match whose home side would change in U12's room at the same time is a clash,
  -- named as the session (never "(training)").
  fx := pg_temp.home(t_u16, d + 30, '18:30', v_main, null, 'Evening');
  update public.fixtures set home_changing_room_id = r3 where id = fx;
  perform pg_temp.check(exists (select 1 from internal.arena_conflicts(v_club, d + 30, d + 30) c
                                where c.code = 'ROOM_IN_USE' and ts4 = any (c.activity_ids) and fx = any (c.activity_ids)
                                  and c.message like 'Room 3 is in use by % (home) from 17:45 to %, and Under 12 Boys training needs it from 18:00.'),
                        'TR8 one team per room: a match in a session''s room is a clash, the session named as itself: '
                        || coalesce((select string_agg(c.message, ' | ') from internal.arena_conflicts(v_club, d + 30, d + 30) c where c.resource_type = 'ROOM'), 'none'));
  update public.fixtures set home_changing_room_id = null where id = fx;

  -- When every suitable room is taken, the proposal says exactly who needs what.
  update public.venue_changing_rooms set active = false where id in (r1, r2, r4);
  update public.training_sessions set changing_room_id = null, changing_room_source = null where id = ts3;
  v_p := pg_temp.json_as(v_ca, format('select public.preview_arena_allocation(%L, %L)', v_club, d + 30));
  perform pg_temp.check(pg_temp.item(v_p, ts3) ->> 'outcome' = 'UNRESOLVED'
                        and (pg_temp.item(v_p, ts3) -> 'explanation')::text like '%Under 11 Mixed needs a changing room. Every suitable room at Arena Main Ground is taken from 18:00 to 19:00.%',
                        'TR9 an unplaced session says who needs a room and that every suitable room is taken then: '
                        || coalesce((pg_temp.item(v_p, ts3) -> 'explanation')::text, 'null'));
  update public.venue_changing_rooms set active = true where id in (r1, r2, r4);

  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''MANUAL'')', v_club, d + 30,
                    jsonb_build_array(jsonb_build_object('kind', 'TRAINING', 'id', ts1, 'expected', jsonb_build_object('homeRoomId', null),
                                                         'set', jsonb_build_object('homeRoomId', r1)))));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_msg() like '%has not asked for a changing room%',
                        'TR10 a room is never given to a session whose team did not ask for one');

  -- Locks: a session locks its room; automatic allocation then leaves it.
  v_state := pg_temp.try_as(v_ca, format('select public.set_arena_lock(''TRAINING'', %L, array[''pitch'', ''home_room''])', ts4));
  perform pg_temp.check(v_state = 'OK' and (select pitch_locked and changing_room_locked from public.training_sessions where id = ts4),
                        'TR11 a session locks its pitch and its changing room');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''AUTO'')', v_club, d + 30,
                    jsonb_build_array(jsonb_build_object('kind', 'TRAINING', 'id', ts4, 'expected', jsonb_build_object('homeRoomId', r3),
                                                         'set', jsonb_build_object('homeRoomId', r2)))));
  perform pg_temp.check(v_state = '22023' and pg_temp.last_hint() = 'ARENA_LOCKED', 'TR12 automatic allocation never moves a locked room');
  perform pg_temp.try_as(v_ca, format('select public.set_arena_lock(''TRAINING'', %L, ''{}''::text[])', ts4));

  -- TIME: a session's start moves only through the Training Centre's writer, for whoever manages its training.
  perform pg_temp.check((select (a -> 'time' ->> 'editable')::boolean and a -> 'time' ->> 'owner' = 'TRAINING'
                         from jsonb_array_elements(pg_temp.json_as(v_ca, format('select public.get_arena_day(%L, %L)', v_club, d + 30)) -> 'activities') a
                         where a ->> 'id' = ts1::text),
                        'TR13 the club''s administrator may move a session''s time in Arena');
  v_n := (select count(*) from public.notifications where user_id = v_parent);
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''MANUAL'')', v_club, d + 30,
                    jsonb_build_array(jsonb_build_object('kind', 'TRAINING', 'id', ts4, 'expected', jsonb_build_object('kickoff', '18:00'),
                                                         'set', jsonb_build_object('kickoff', '18:15')))));
  perform pg_temp.check(v_state = 'OK' and (select start_time = '18:15' and end_time = '19:15' and is_overridden from public.training_sessions where id = ts4),
                        'TR14 moving a session to 18:15 keeps its length and makes it that session''s own');
  perform pg_temp.check((select count(*) from public.notifications where user_id = v_parent) = v_n + 1,
                        'TR15 the team hears once that its session moved');
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''AUTO'')', v_club, d + 30,
                    jsonb_build_array(jsonb_build_object('kind', 'TRAINING', 'id', ts4, 'expected', jsonb_build_object('kickoff', '18:15'),
                                                         'set', jsonb_build_object('kickoff', '18:30')))));
  perform pg_temp.check(v_state = '22023', 'TR16 automatic allocation never moves a session''s time');
  -- A Fixtures Secretary plans the estate; whether a training time is theirs to move is the Training
  -- Centre's own authority, read here rather than assumed.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_fs, 'role', 'authenticated')::text, true);
  v_m := case when internal.can_manage_training(v_club, t_u12) or internal.can_manage_club_training(v_club) then 1 else 0 end;
  perform set_config('request.jwt.claims', '', true);
  v_x := pg_temp.json_as(v_fs, format('select public.get_arena_day(%L, %L)', v_club, d + 30));
  v_state := pg_temp.try_as(v_fs, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''MANUAL'')', v_club, d + 30,
                    jsonb_build_array(jsonb_build_object('kind', 'TRAINING', 'id', ts4, 'expected', jsonb_build_object('kickoff', '18:15'),
                                                         'set', jsonb_build_object('kickoff', '18:45')))));
  perform pg_temp.check(case when v_m = 1
                          then v_state = 'OK'
                          else v_state = '42501'
                               and (select a -> 'time' = '{"owner": "TRAINING", "reason": "Training times are set in the Training Centre.", "editable": false}'::jsonb
                                    from jsonb_array_elements(v_x -> 'activities') a where a ->> 'id' = ts4::text) end,
                        'TR17 a planner without training authority is told where training times are set, and cannot move one ('
                        || case when v_m = 1 then 'this Fixtures Secretary manages training' else 'refused' end || ')');
  perform pg_temp.check((select a -> 'time' ->> 'owner' = 'TOURNAMENT' and not (a -> 'time' ->> 'editable')::boolean
                         from jsonb_array_elements(pg_temp.json_as(v_ca, format('select public.get_arena_day(%L, %L)', v_club, d + 4)) -> 'activities') a
                         where a ->> 'kind' = 'TOURNAMENT' limit 1) is not false,
                        'TR18 a tournament''s times are its own, never moved in Arena');

  -- The request withdrawn gives the room back; moving to another ground leaves a room behind.
  v_state := pg_temp.try_as(v_ca, format('select public.override_training_session(p_session_id => %L, p_needs_changing_room => false)', ts4));
  perform pg_temp.check(v_state = 'OK' and (select changing_room_id is null and not needs_changing_room from public.training_sessions where id = ts4),
                        'TR19 a session that no longer needs a room gives it back');
  update public.training_sessions set changing_room_id = r2, changing_room_source = 'MANUAL' where id = ts3;
  v_state := pg_temp.try_as(v_ca, format('select public.apply_arena_allocation(%L, %L, %L::jsonb, ''MANUAL'')', v_club, d + 30,
                    jsonb_build_array(jsonb_build_object('kind', 'TRAINING', 'id', ts3, 'expected', jsonb_build_object('pitchId', a2),
                                                         'set', jsonb_build_object('pitchId', b1)))));
  perform pg_temp.check(v_state = 'OK' and (select pitch_id = b1 and venue_id = v_train and changing_room_id is null from public.training_sessions where id = ts3),
                        'TR20 a session moved to another ground leaves its room at the old one');
  v_state := pg_temp.try_as(v_ca, format('select public.save_training_plan(%L, %L, %L, ''CUSTOM'', null, %L, %L, %L::jsonb, 0, 0, null, false)',
                    tp1, v_club, t_u12, v_main, a3,
                    jsonb_build_array(jsonb_build_object('weekday', extract(dow from d + 30)::int, 'starts_on', d + 30, 'ends_on', d + 30,
                                                         'start_time', '18:00', 'duration_minutes', 60))));
  perform pg_temp.check(v_state = 'OK' and not (select needs_changing_room from public.training_plans where id = tp1),
                        'TR21 the team answers for its whole plan through the plan''s own writer');

end $$;

rollback;
