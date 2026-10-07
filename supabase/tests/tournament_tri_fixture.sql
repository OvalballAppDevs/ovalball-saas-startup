-- A TRI-FIXTURE IS THREE SIDES, ONE ENGINE, AND A TABLE ONLY BY CHOICE (Tournament Planning parity
-- programme, phase 6; 20270666, 20270720, 20270722, 20270723).
--
--   T1-3   exactly three sides, said before Generate and refused by it -- two and four alike
--   T4-7   three games (n(n-1)/2), every pair once, named Game 1-3, scheduled by the shared scheduler
--   T8-13  no table unless asked; the result lifecycle is the canonical one; switching the table on
--          gives a Tables tab and real standings
--
-- Self-seeding and rolled back.

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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pmr-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Pmr', p_label, 'pmr-' || v::text || '@ovalball.test', (current_date - interval '40 years')::date);
  return v;
end $$;

-- One club, one tournament, one competition, n directory sides added by the organiser's own operation.
create or replace function pg_temp.world(p_format text, p_sides int, p_with_pitch boolean, p_day date)
returns jsonb language plpgsql as $$
declare v_ca uuid := pg_temp.person('Organiser'); v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_venue uuid; v_pitch uuid; v_t uuid; v_sides uuid[] := '{}'; i int; v_guest_dir uuid; v_guest uuid; v_guest_ca uuid := pg_temp.person('GuestAdmin');
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Pmr Host RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'pmr-' || v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'pmr-' || v_tag, 'active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_ca, 'CLUB_ADMIN', 'active');
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Pmr Guest RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'pmrg-' || v_tag) returning id into v_guest_dir;
  insert into public.clubs (directory_id, slug, status) values (v_guest_dir, 'pmrg-' || v_tag, 'active') returning id into v_guest;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_guest, v_guest_ca, 'CLUB_ADMIN', 'active');
  insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
  values (v_club, 'Pmr Ground ' || v_tag, 'pmr-g-' || v_tag, '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom') returning id into v_venue;
  insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order)
  values (v_club, v_venue, 'Pitch ' || v_tag, true, 1) returning id into v_pitch;
  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name, conversation_id, format, swiss_rounds, visibility, venue_id, kickoff_time, ends_at)
  values (v_club, v_dir, 'union', p_day, p_day, 'confirmed', 'Pmr ' || p_format, gen_random_uuid(), p_format,
          case when p_format = 'swiss' then 3 end, 'private', v_venue, '09:00', '16:00')
  returning id into v_t;
  insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');
  if p_with_pitch then
    insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
    values (v_t, v_pitch, p_day, '09:00', '16:00', v_ca);
  end if;
  -- the guest club's own side, so a participant viewer exists for the privacy checks
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, status)
  values (v_t, v_guest_dir, v_guest, 'U12', 'added') returning id into v_guest_dir;
  v_sides := v_sides || v_guest_dir;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  for i in 2 .. p_sides loop
    v_sides := v_sides || public.add_tournament_participant_team(v_t, null, null, null, null, 'U12', 'Pmr Side ' || i || ' ' || v_tag);
  end loop;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('ca', v_ca, 'guest_ca', v_guest_ca, 't', v_t, 'pitch', v_pitch, 'sides', to_jsonb(v_sides), 'tag', v_tag);
end $$;

create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Run a statement as a person; return OK or the SQLSTATE, and the message in a temp table.
create temp table pmr_last (msg text, hint text);
grant all on pmr_last to authenticated;
create or replace function pg_temp.try_as(p_user uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text; v_hint text;
begin
  delete from pmr_last;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    insert into pmr_last values (v_msg, v_hint);
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

create or replace function pg_temp.readiness(p_plan uuid) returns jsonb language sql as $$
  select internal.tournament_plan_readiness(p_plan);
$$;
create or replace function pg_temp.has_blocker(p_plan uuid, p_code text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(internal.tournament_plan_readiness(p_plan) -> 'blockers') b where b ->> 'code' = p_code);
$$;
create or replace function pg_temp.has_warning(p_plan uuid, p_code text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(internal.tournament_plan_readiness(p_plan) -> 'warnings') b where b ->> 'code' = p_code);
$$;
create or replace function pg_temp.games_of(p_plan uuid, p_side uuid) returns int language sql as $$
  select count(*)::int from public.tournament_games where plan_id = p_plan and p_side in (side_a_id, side_b_id);
$$;

do $$
declare w jsonb; v_ca uuid; v_t uuid; v_plan uuid; v_state text; v_n int; v_labels text[]; v_g uuid; v_day date := current_date - 1;
  v_keeps boolean; v_counts boolean; v_keeps2 boolean; v_counts2 boolean;
begin
  -- ============ T1. exactly three ============
  w := pg_temp.world('tri_fixture', 2, true, v_day);
  v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid;
  perform pg_temp.as_user(v_ca);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform set_config('role', 'none', true);
  perform pg_temp.check(pg_temp.has_blocker(v_plan, 'FIELD_SIZE'), 'T1 two sides: Planning says a Tri-Fixture is exactly three before Generate');
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  perform pg_temp.check(v_state = '22023' and (select msg from pmr_last) like 'A Tri-Fixture is exactly 3 teams%', format('T2 and Generate refuses with the same sentence (%s)', (select msg from pmr_last)));
  perform pg_temp.as_user(v_ca);
  perform public.add_tournament_participant_team(v_t, null, null, null, null, 'U12', 'Pmr Third ' || (w ->> 'tag'));
  perform public.add_tournament_participant_team(v_t, null, null, null, null, 'U12', 'Pmr Fourth ' || (w ->> 'tag'));
  perform set_config('role', 'none', true);
  perform pg_temp.check(pg_temp.has_blocker(v_plan, 'FIELD_SIZE'), 'T3 four sides is refused too -- a Tri-Fixture is not "up to three"');

  -- ============ T4. three sides, three games, the same engine ============
  w := pg_temp.world('tri_fixture', 3, true, v_day);
  v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid;
  perform pg_temp.as_user(v_ca);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform set_config('role', 'none', true);
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  select count(*) into v_n from public.tournament_games where plan_id = v_plan;
  perform pg_temp.check(v_state = 'OK' and v_n = 3, format('T4 three sides make 3*2/2 = 3 games (%s)', v_n));
  perform pg_temp.check(not exists (select 1 from public.tournament_games where plan_id = v_plan and side_a_id = side_b_id)
    and (select count(distinct (least(side_a_id, side_b_id), greatest(side_a_id, side_b_id))) from public.tournament_games where plan_id = v_plan) = 3,
    'T5 every pair once: A v B, B v C, C v A -- no side plays itself, no pairing twice');
  select array_agg(internal.tournament_game_stage_label(plan_id, round_number, is_third_place, table_id) order by round_number) into v_labels
  from public.tournament_games where plan_id = v_plan;
  perform pg_temp.check(v_labels = array['Tri-Fixture · Game 1', 'Tri-Fixture · Game 2', 'Tri-Fixture · Game 3'],
    format('T6 the games are named Tri-Fixture · Game 1, 2 and 3 (%s)', v_labels));
  perform pg_temp.check(not exists (select 1 from public.tournament_games o join public.tournament_games g on g.plan_id = o.plan_id and g.id <> o.id
                                     where o.plan_id = v_plan and o.start_time = g.start_time
                                       and (o.side_a_id in (g.side_a_id, g.side_b_id) or o.side_b_id in (g.side_a_id, g.side_b_id))),
    'T7 the shared scheduler never puts a side in two games at once');

  -- ============ T8. the table is a choice ============
  perform pg_temp.check(not internal.tournament_plan_has_standings(v_plan), 'T8 a Tri-Fixture keeps no table unless the organiser asks');
  perform pg_temp.as_user(v_ca);
  v_keeps := public.tournament_keeps_standings(v_t);
  perform set_config('role', 'none', true);
  perform pg_temp.check(not v_keeps, 'T9 so the tournament reports no Tables tab');
  perform pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L)', v_plan));
  select id into v_g from public.tournament_games where plan_id = v_plan order by round_number limit 1;
  v_state := pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L, 12, 7, %L)', v_g, 'Referee''s card'));
  perform pg_temp.check(v_state = 'OK' and (select result_status from public.tournament_games where id = v_g) = 'final',
    'T10 a published Tri-Fixture game takes a result through the canonical lifecycle');
  perform pg_temp.as_user(v_ca);
  v_counts := (public.get_tournament_game_result(v_g) ->> 'countsToTable')::boolean;
  perform public.set_tournament_plan_standings(v_plan, true);
  v_keeps2 := public.tournament_keeps_standings(v_t);
  v_counts2 := (public.get_tournament_game_result(v_g) ->> 'countsToTable')::boolean;
  select count(*) into v_n from jsonb_array_elements(public.get_tournament_tables(v_t, 'U12') -> 'tables' -> 0 -> 'rows');
  perform set_config('role', 'none', true);
  perform pg_temp.check(v_counts = false, 'T11 and its result says it counts towards no table');
  perform pg_temp.check(v_keeps2 and v_counts2,
    'T12 switching the table on gives the tournament a Tables tab and the result counts towards it');
  perform pg_temp.check(v_n = 3, format('T13 the table lists all three sides, from the round robin''s own standings (%s)', v_n));
end $$;

rollback;
