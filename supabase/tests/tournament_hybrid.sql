-- A HYBRID IS GROUPS, THEN A KNOCKOUT (Tournament Planning parity programme, phase 7; 20270724).
--
--   H1-4b   the organiser chooses how many go through (1-4); every table must be bigger than that; the
--           crossover is previewed before Generate from the same seeding rule
--   H5-10   generation is the round robin's groups plus the knockout's bracket, crossed (1st A v 2nd B),
--           the knockout scheduled after the group stage; ready to publish
--   H11-19  a table fills its places only when every game in it is settled; a correction rebuilds an
--           unplayed knockout game and is refused once that game is played; progression is the knockout's
--   H20-23  changing the qualifier count, or the teams, after generating is said before publishing
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


create or replace function pg_temp.settle_table(p_ca uuid, p_table uuid, p_order uuid[], p_skip int default 0) returns int language plpgsql as $$
declare g record; v_n int := 0; v_state text;
begin
  -- the side earlier in p_order wins every game, so the table's finishing order is p_order's
  for g in select * from public.tournament_games where table_id = p_table and result_status = 'none' order by round_number, sort_order offset p_skip loop
    v_state := pg_temp.try_as(p_ca, format('select public.resolve_tournament_game_result(%L, %s, %s, %L)', g.id,
      case when array_position(p_order, g.side_a_id) < array_position(p_order, g.side_b_id) then 20 else 0 end,
      case when array_position(p_order, g.side_a_id) < array_position(p_order, g.side_b_id) then 0 else 20 end, 'Referee''s card'));
    if v_state <> 'OK' then raise notice 'settle failed: % %', v_state, (select msg from pmr_last); end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function pg_temp.slot(p_plan uuid, p_round int, p_pos int) returns uuid language sql as $$
  select participant_id from public.tournament_bracket_slots where plan_id = p_plan and round_number = p_round and position = p_pos and not is_third_place;
$$;

do $$
declare w jsonb; v_ca uuid; v_t uuid; v_plan uuid; v_state text; v_n int; v_s uuid[]; v_labels text[]; v_g uuid; v_day date := current_date - 1;
  v_ta uuid; v_tb uuid; v_ko_start timestamp; v_group_end timestamp; v_r jsonb; v_ok boolean; v_hint text; v_keeps boolean; v_label text;
begin
  -- ============ H1-2. a hybrid needs to know who goes through ============
  w := pg_temp.world('hybrid', 8, true, v_day);
  v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid;
  select array_agg(x::uuid order by o) into v_s from jsonb_array_elements_text(w -> 'sides') with ordinality j(x, o);
  perform pg_temp.as_user(v_ca);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform public.set_tournament_plan_tables(v_plan, jsonb_build_array(
    jsonb_build_object('name', 'Table A', 'sides', to_jsonb(v_s[1:4])),
    jsonb_build_object('name', 'Table B', 'sides', to_jsonb(v_s[5:8]))));
  perform set_config('role', 'none', true);
  -- a playing window the whole competition fits in: 15-minute games, 5-minute changeovers, 09:00-16:00
  update public.tournament_plans set game_duration_minutes = 15, changeover_minutes = 5, day_start_time = '09:00', day_end_time = '16:00' where id = v_plan;
  select id into v_ta from public.tournament_plan_tables where plan_id = v_plan and name = 'Table A';
  select id into v_tb from public.tournament_plan_tables where plan_id = v_plan and name = 'Table B';
  perform pg_temp.check(not pg_temp.has_blocker(v_plan, 'FORMAT_NOT_AVAILABLE') and pg_temp.has_blocker(v_plan, 'HYBRID_QUALIFIERS'),
    'H1 a Hybrid is generated now, once the organiser says how many go through from each table');
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  perform pg_temp.check(v_state = '22023' and (select hint from pmr_last) = 'TOURNAMENT_PLAN_HYBRID_QUALIFIERS',
    format('H2 and Generate refuses with the same blocker (%s)', (select msg from pmr_last)));
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_hybrid_settings(%L, 4)', v_plan));
  perform pg_temp.check(v_state = 'OK' and pg_temp.has_blocker(v_plan, 'HYBRID_QUALIFIERS')
    and exists (select 1 from jsonb_array_elements(pg_temp.readiness(v_plan) -> 'blockers') b where b ->> 'message' like '4 from each table go through, so every table needs at least 5 teams. Table A, Table B do not.'),
    'H3 four through from a table of four is refused before Generate: every table must be bigger than the qualifier count');
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_hybrid_settings(%L, 5)', v_plan));
  perform pg_temp.check(v_state = '22023', 'H4 and 1-4 is the range the organiser can choose from');

  -- ============ H5-10. generate: the round robin's groups, the knockout's bracket ============
  perform pg_temp.try_as(v_ca, format('select public.set_tournament_hybrid_settings(%L, 2)', v_plan));
  perform pg_temp.try_as(v_ca, format('select public.set_tournament_knockout_settings(%L, null, null, null, true)', v_plan));
  perform pg_temp.as_user(v_ca);
  v_r := public.get_hybrid_knockout_preview(v_plan);
  perform set_config('role', 'none', true);
  perform pg_temp.check(v_r ->> 'firstRound' = 'Semi Final' and (v_r ->> 'teams')::int = 4
    and v_r -> 'games' = '[{"bye": false, "game": 1, "sideA": "1st Table A", "sideB": "2nd Table B"}, {"bye": false, "game": 2, "sideA": "1st Table B", "sideB": "2nd Table A"}]'::jsonb,
    format('H4b before anything is generated, the planner previews the crossover from the same seeding rule (%s)', v_r -> 'games'));
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  select count(*) into v_n from public.tournament_games where plan_id = v_plan and table_id is not null;
  perform pg_temp.check(v_state = 'OK' and v_n = 12, format('H5 two tables of four make 2 x 6 group games through the round robin generator (%s, %s)', v_state, v_n));
  select array_agg(internal.bracket_slot_label(id) order by position) into v_labels
  from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and not is_third_place;
  perform pg_temp.check(v_labels = array['1st Table A', '2nd Table B', '1st Table B', '2nd Table A'],
    format('H6 the knockout is crossed -- 1st Table A v 2nd Table B, 1st Table B v 2nd Table A (%s)', v_labels));
  select count(*) into v_n from public.tournament_bracket_pairings where plan_id = v_plan;
  perform pg_temp.check(v_n = 4 and not exists (select 1 from public.tournament_games where plan_id = v_plan and bracket_position is not null),
    format('H7 the knockout stage is two semi-finals, a final and a third-place play-off, with no games until the tables decide them (%s places)', v_n));
  select max(g.game_date + g.start_time + make_interval(mins => g.duration_minutes)) into v_group_end
  from public.tournament_games g where g.plan_id = v_plan and g.table_id is not null;
  select min(bp.game_date + bp.start_time) into v_ko_start from public.tournament_bracket_pairings bp where bp.plan_id = v_plan;
  perform pg_temp.check(v_ko_start is not null and v_ko_start >= v_group_end
    and not exists (select 1 from public.tournament_bracket_pairings where plan_id = v_plan and start_time is null),
    format('H8 every knockout place has a kick-off, and the knockout starts after the last group game ends (%s >= %s)', v_ko_start, v_group_end));
  select internal.tournament_game_stage_label(plan_id, round_number, is_third_place, table_id) into v_label
  from public.tournament_games where plan_id = v_plan and table_id = v_ta and round_number = 1 limit 1;
  perform pg_temp.check(v_label = 'Group Stage · Table A · Round 1' and internal.tournament_plan_has_standings(v_plan),
    format('H9 a group game is named for its stage, and a Hybrid keeps a table (%s)', v_label));
  v_r := pg_temp.readiness(v_plan);
  perform pg_temp.check((v_r ->> 'readyToPublish')::boolean and not ((v_r -> 'consistency') ->> 'fixturesOutOfDate')::boolean,
    format('H10 the generated Hybrid is ready to publish, with nothing out of date (%s)', v_r -> 'blockers'));

  -- ============ H11-16. qualification ============
  v_state := pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L)', v_plan));
  perform pg_temp.settle_table(v_ca, v_ta, v_s, 1);
  perform pg_temp.check(pg_temp.slot(v_plan, 1, 1) is null and internal.bracket_slot_label((select id from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and position = 1)) = '1st Table A',
    'H11 a table with one game left decides nobody: the place still reads 1st Table A');
  perform pg_temp.settle_table(v_ca, v_ta, v_s);
  perform pg_temp.check(pg_temp.slot(v_plan, 1, 1) = v_s[1] and pg_temp.slot(v_plan, 1, 4) = v_s[2]
    and not exists (select 1 from public.tournament_games where plan_id = v_plan and bracket_position is not null),
    'H12 the moment Table A is decided its 1st and 2nd fill their places, from the table''s own standings -- no game until each opponent is known');
  perform pg_temp.settle_table(v_ca, v_tb, v_s[5:8]);
  select count(*) into v_n from public.tournament_games g where g.plan_id = v_plan and g.round_number = 1 and g.bracket_position is not null
    and ((least(g.side_a_id, g.side_b_id), greatest(g.side_a_id, g.side_b_id)) in
         ((least(v_s[1], v_s[6]), greatest(v_s[1], v_s[6])), (least(v_s[5], v_s[2]), greatest(v_s[5], v_s[2]))))
    and g.start_time is not null;
  perform pg_temp.check(v_n = 2, format('H13 both tables decided: the semi-finals are 1st A v 2nd B and 1st B v 2nd A, at their reserved times (%s)', v_n));
  -- only a side with an Ovalball club has anybody to tell: here, the guest club, which won Table A
  select count(*) into v_n from public.notifications n
  where n.user_id = (w ->> 'guest_ca')::uuid and n.type = 'tournament_side_advanced'
    and n.title = 'Through to the knockout stage' and n.body like 'You finished 1st in Table A. Your Semi Final opponent is %';
  perform pg_temp.check(v_n = 1, format('H14 a qualifier is told once that it is through, where it finished and who it plays (%s)', v_n));
  select internal.tournament_game_stage_label(plan_id, round_number, is_third_place, table_id) into v_label
  from public.tournament_games where plan_id = v_plan and bracket_position = 1 and round_number = 1;
  perform pg_temp.check(v_label = 'Semi Final', format('H15 a knockout-stage game is named by the knockout (%s)', v_label));
  perform pg_temp.as_user(v_ca);
  v_r := jsonb_build_object(
    'group', public.get_tournament_game_result((select id from public.tournament_games where plan_id = v_plan and table_id = v_ta order by round_number desc limit 1)),
    'ko', public.get_tournament_game_result((select id from public.tournament_games where plan_id = v_plan and bracket_position = 1 and round_number = 1)));
  perform set_config('role', 'none', true);
  perform pg_temp.check((v_r -> 'group' -> 'roundName') = 'null'::jsonb and v_r -> 'group' ->> 'stageLabel' like 'Group Stage · Table A · Round %'
    and (v_r -> 'group' ->> 'countsToTable')::boolean
    and v_r -> 'ko' ->> 'roundName' = 'Semi Final' and not (v_r -> 'ko' ->> 'countsToTable')::boolean,
    format('H15b a group game has no knockout round name and counts to its table; a knockout game is a Semi Final and does not (%s / %s)',
      v_r -> 'group' ->> 'roundName', v_r -> 'ko' ->> 'roundName'));

  -- a corrected group result that changes who finished where, before the semi-final is played: rebuilt
  select id into v_g from public.tournament_games where table_id = v_ta and v_s[1] in (side_a_id, side_b_id) and v_s[2] in (side_a_id, side_b_id);
  update public.tournament_games set side_a_score = side_b_score, side_b_score = side_a_score where id = v_g;
  perform pg_temp.check(pg_temp.slot(v_plan, 1, 1) = v_s[2] and pg_temp.slot(v_plan, 1, 4) = v_s[1]
    and exists (select 1 from public.tournament_games where plan_id = v_plan and round_number = 1 and bracket_position = 1 and v_s[2] in (side_a_id, side_b_id)),
    'H16 a correction that changes the table before the semi-final is played re-fills the places and rebuilds the game');
  update public.tournament_games set side_a_score = side_b_score, side_b_score = side_a_score where id = v_g;

  -- once the semi-final is played, the same correction is refused rather than silently invalidating it
  select id into v_g from public.tournament_games where plan_id = v_plan and round_number = 1 and bracket_position = 1;
  v_state := pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L, 15, 5, %L)', v_g, 'Referee''s card'));
  select id into v_g from public.tournament_games where table_id = v_ta and v_s[1] in (side_a_id, side_b_id) and v_s[2] in (side_a_id, side_b_id);
  v_ok := false;
  begin
    update public.tournament_games set side_a_score = side_b_score, side_b_score = side_a_score where id = v_g;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_ok := v_hint = 'TOURNAMENT_BRACKET_DOWNSTREAM_ACTIVITY';
  end;
  perform pg_temp.check(v_state = 'OK' and v_ok,
    format('H17 after the semi-final is played, a correction that would change who qualified is refused (%s, %s)', v_state, v_hint));
  select count(*) into v_n from public.tournament_bracket_slots where plan_id = v_plan and round_number = 2 and position = 1 and not is_third_place and participant_id = (select winner_participant_id from public.tournament_games where plan_id = v_plan and round_number = 1 and bracket_position = 1);
  perform pg_temp.check(v_n = 1, 'H18 and the semi-final''s winner goes through to the Final by the knockout''s own progression');
  perform pg_temp.as_user(v_ca);
  v_keeps := public.tournament_keeps_standings(v_t);
  perform set_config('role', 'none', true);
  perform pg_temp.check(v_keeps and (pg_temp.readiness(v_plan) ->> 'stage') = 'IN_PROGRESS', 'H19 a Hybrid under way has a Tables tab and reads In Progress');

  -- ============ H20-23. changes after generation ============
  w := pg_temp.world('hybrid', 6, true, v_day);
  v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid;
  select array_agg(x::uuid order by o) into v_s from jsonb_array_elements_text(w -> 'sides') with ordinality j(x, o);
  perform pg_temp.as_user(v_ca);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform public.set_tournament_plan_tables(v_plan, jsonb_build_array(
    jsonb_build_object('name', 'Table A', 'sides', to_jsonb(v_s[1:3])),
    jsonb_build_object('name', 'Table B', 'sides', to_jsonb(v_s[4:6]))));
  perform public.set_tournament_hybrid_settings(v_plan, 1);
  perform set_config('role', 'none', true);
  update public.tournament_plans set game_duration_minutes = 15, changeover_minutes = 5, day_start_time = '09:00', day_end_time = '16:00' where id = v_plan;
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  select count(*) into v_n from public.tournament_bracket_pairings where plan_id = v_plan;
  perform pg_temp.check(v_state = 'OK' and v_n = 1, format('H20 one from each of two tables is a Final straight away (%s places)', v_n));
  perform pg_temp.try_as(v_ca, format('select public.set_tournament_hybrid_settings(%L, 2)', v_plan));
  perform pg_temp.check(pg_temp.has_blocker(v_plan, 'FIXTURES_OUT_OF_DATE'),
    'H21 changing how many go through after generating makes the fixtures out of date, and says so before publishing');
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  select count(*) into v_n from public.tournament_bracket_pairings where plan_id = v_plan;
  perform pg_temp.check(v_state = 'OK' and v_n = 3 and not pg_temp.has_blocker(v_plan, 'FIXTURES_OUT_OF_DATE'),
    format('H22 and regenerating rebuilds the knockout stage to match (%s places)', v_n));
  perform pg_temp.as_user(v_ca);
  perform public.add_tournament_participant_team(v_t, null, null, null, null, 'U12', 'Pmr Late ' || (w ->> 'tag'));
  perform set_config('role', 'none', true);
  perform pg_temp.check(pg_temp.has_blocker(v_plan, 'FIXTURES_OUT_OF_DATE')
    and (select count(*) from public.tournament_plan_table_sides where plan_id = v_plan) = 7,
    'H23 a team joining after generation is seated in a table and the plan says the fixtures need regenerating');
end $$;

rollback;
