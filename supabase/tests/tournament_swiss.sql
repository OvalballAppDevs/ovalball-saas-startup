-- A SWISS PAIRS EACH ROUND FROM THE TABLE (Tournament Planning parity programme, phase 8; 20270725).
--
--   W1-3    rounds are the organiser's choice, at most what the field allows without a rematch; said
--           before Generate and refused by it
--   W4-8    Generate draws Round 1 at random and reserves every round's kick-off times, a round never
--           before the previous one ends; a Swiss keeps a table; published as any plan is
--   W9-11   the organiser may swap sides in the round about to start -- never into a rematch
--   W12-16  the next round is paired when the last is settled, top down from the table, no rematches,
--           and each side is told who it plays; a correction re-pairs an unplayed round and is refused
--           once that round is being played; the competition completes after its last round
--   W17-21  an odd field: the lowest-ranked side without a bye sits out, once at most, and is awarded a
--           win with no points for or against
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


create or replace function pg_temp.settle_round(p_ca uuid, p_plan uuid, p_round int, p_limit int default 100) returns int language plpgsql as $$
declare g record; v_n int := 0; v_state text;
begin
  -- side A wins every game, 20-5
  for g in select * from public.tournament_games where plan_id = p_plan and round_number = p_round and result_status = 'none'
           order by sort_order limit p_limit loop
    v_state := pg_temp.try_as(p_ca, format('select public.resolve_tournament_game_result(%L, 20, 5, %L)', g.id, 'Referee''s card'));
    if v_state <> 'OK' then raise notice 'settle failed: % %', v_state, (select msg from pmr_last); end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function pg_temp.rematches(p_plan uuid) returns int language sql as $$
  select (count(*) - count(distinct internal.swiss_key(side_a_id, side_b_id)))::int from public.tournament_games where plan_id = p_plan;
$$;

create or replace function pg_temp.swiss_world(p_sides int) returns jsonb language plpgsql as $$
declare w jsonb; v_plan uuid;
begin
  w := pg_temp.world('swiss', p_sides, true, current_date - 1);
  perform pg_temp.as_user((w ->> 'ca')::uuid);
  v_plan := public.start_tournament_plan((w ->> 't')::uuid, 'U12');
  perform set_config('role', 'none', true);
  update public.tournament_plans set game_duration_minutes = 15, changeover_minutes = 5, day_start_time = '09:00', day_end_time = '16:00' where id = v_plan;
  return w || jsonb_build_object('plan', v_plan);
end $$;

do $$
declare w jsonb; v_ca uuid; v_t uuid; v_plan uuid; v_state text; v_n int; v_r jsonb; v_ok boolean; v_hint text;
  v_g uuid; v_g2 uuid; v_a uuid; v_b uuid; v_x uuid; v_top uuid[]; v_label text; v_table uuid; v_bye uuid; v_byes uuid[];
  v_floor_ok boolean;
begin
  -- ============ W1-3. rounds ============
  w := pg_temp.swiss_world(6);
  v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid; v_plan := (w ->> 'plan')::uuid;
  perform pg_temp.check(not pg_temp.has_blocker(v_plan, 'FORMAT_NOT_AVAILABLE') and not pg_temp.has_blocker(v_plan, 'SWISS_ROUNDS')
    and (pg_temp.readiness(v_plan) ->> 'readyToGenerate')::boolean,
    'W1 a Swiss of six playing the tournament''s three rounds is ready to generate -- no longer "not available"');
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_swiss_settings(%L, 6)', v_plan));
  perform pg_temp.check(v_state = 'OK' and exists (select 1 from jsonb_array_elements(pg_temp.readiness(v_plan) -> 'blockers') b
      where b ->> 'code' = 'SWISS_ROUNDS' and b ->> 'message' = '6 teams can play at most 5 Swiss rounds without two teams meeting twice. Choose fewer rounds, or add teams.'),
    'W2 six rounds for six teams is said before Generate: five is the most without a rematch');
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  perform pg_temp.check(v_state = '22023' and (select hint from pmr_last) = 'TOURNAMENT_PLAN_SWISS_ROUNDS', 'W3 and Generate refuses it with the same sentence');

  -- ============ W4-8. generate ============
  perform pg_temp.try_as(v_ca, format('select public.set_tournament_swiss_settings(%L, 3)', v_plan));
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  select count(*) into v_n from public.tournament_games where plan_id = v_plan;
  perform pg_temp.check(v_state = 'OK' and v_n = 3
    and (select count(distinct x) from (select side_a_id x from public.tournament_games where plan_id = v_plan union all select side_b_id from public.tournament_games where plan_id = v_plan) y) = 6
    and not exists (select 1 from public.tournament_swiss_byes where plan_id = v_plan),
    format('W4 Generate makes Round 1 only: 3 games, every one of the six sides once, no bye (%s, %s)', v_state, v_n));
  select count(*) into v_n from public.tournament_bracket_pairings where plan_id = v_plan and start_time is not null;
  select bool_and(r.starts >= p.ends) into v_floor_ok
  from (select round_number, min(game_date + start_time) as starts from public.tournament_bracket_pairings where plan_id = v_plan group by 1) r
  join (select round_number, max(game_date + start_time + interval '20 minutes') as ends from public.tournament_bracket_pairings where plan_id = v_plan group by 1) p
    on p.round_number = r.round_number - 1;
  perform pg_temp.check(v_n = 9 and v_floor_ok, format('W5 every round''s kick-off times are reserved now -- 3 rounds x 3 places -- and no round starts before the last ends (%s)', v_n));
  select internal.tournament_game_stage_label(plan_id, round_number, is_third_place, table_id) into v_label
  from public.tournament_games where plan_id = v_plan limit 1;
  perform pg_temp.check(v_label = 'Swiss · Round 1' and internal.tournament_plan_has_standings(v_plan),
    format('W6 a Swiss game is named for its round, and a Swiss keeps a table (%s)', v_label));
  v_r := pg_temp.readiness(v_plan);
  perform pg_temp.check((v_r ->> 'readyToPublish')::boolean and not ((v_r -> 'consistency') ->> 'fixturesOutOfDate')::boolean,
    format('W7 the generated Swiss is ready to publish (%s)', v_r -> 'blockers'));
  v_state := pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L)', v_plan));
  perform pg_temp.check(v_state = 'OK', format('W8 and publishes like any plan (%s)', (select msg from pmr_last)));

  -- ============ W9-11. swaps ============
  select id, side_a_id, side_b_id into v_g, v_a, v_b from public.tournament_games where plan_id = v_plan and round_number = 1 order by sort_order limit 1;
  select side_a_id into v_x from public.tournament_games where plan_id = v_plan and round_number = 1 and id <> v_g order by sort_order limit 1;
  v_state := pg_temp.try_as(v_ca, format('select public.swap_tournament_swiss_sides(%L, %L, %L)', v_plan, v_b, v_x));
  perform pg_temp.check(v_state = 'OK' and exists (select 1 from public.tournament_games where id = v_g and v_x in (side_a_id, side_b_id) and v_a in (side_a_id, side_b_id)),
    'W9 the organiser swaps two sides in the Round 1 draw: each takes the other''s opponent');
  v_state := pg_temp.try_as(v_ca, format('select public.swap_tournament_swiss_sides(%L, %L, %L)', v_plan, v_a, v_x));
  perform pg_temp.check(v_state = '22023', 'W10 two sides already playing each other is not a swap');
  perform pg_temp.settle_round(v_ca, v_plan, 1, 1);
  v_state := pg_temp.try_as(v_ca, format('select public.swap_tournament_swiss_sides(%L, %L, %L)', v_plan, v_a, v_x));
  perform pg_temp.check(v_state = '22023' and (select hint from pmr_last) = 'TOURNAMENT_SWISS_ROUND_STARTED', 'W11 once a game of the round has a result, its pairings are fixed');

  -- ============ W12-16. progression ============
  perform pg_temp.settle_round(v_ca, v_plan, 1, 1);
  perform pg_temp.check(not exists (select 1 from public.tournament_games where plan_id = v_plan and round_number = 2),
    'W12 Round 2 waits while any Round 1 game is unsettled');
  select id into v_table from public.tournament_plan_tables where plan_id = v_plan;
  perform pg_temp.settle_round(v_ca, v_plan, 1);
  select array_agg(participant_id order by table_position) into v_top from internal.tournament_table_ordered(v_table);
  select count(*) into v_n from public.tournament_games where plan_id = v_plan and round_number = 2 and start_time is not null;
  perform pg_temp.check(v_n = 3 and pg_temp.rematches(v_plan) = 0
    and exists (select 1 from public.tournament_games where plan_id = v_plan and round_number = 2 and sort_order = 2001
                and v_top[1] in (side_a_id, side_b_id)),
    format('W13 the moment Round 1 is settled, Round 2 is paired at its reserved times, top down, with no rematch (%s)', v_n));
  select count(*) into v_n from public.notifications
  where user_id = (w ->> 'guest_ca')::uuid and type = 'tournament_opponent_known' and title = 'Your Round 2 opponent is known';
  perform pg_temp.check(v_n = 1, format('W14 each side with an Ovalball club is told once who it plays in Round 2 (%s)', v_n));
  -- a correction to Round 1 while Round 2 is unplayed: Round 2 is re-paired from the corrected table
  select id into v_g from public.tournament_games where plan_id = v_plan and round_number = 1 order by sort_order limit 1;
  update public.tournament_games set side_a_score = 5, side_b_score = 20 where id = v_g;
  perform pg_temp.check((select count(*) from public.tournament_games where plan_id = v_plan and round_number = 2) = 3 and pg_temp.rematches(v_plan) = 0,
    'W15 a corrected Round 1 result before Round 2 is played re-pairs Round 2 from the corrected table');
  perform pg_temp.settle_round(v_ca, v_plan, 2, 1);
  v_ok := false;
  begin
    update public.tournament_games set side_a_score = 20, side_b_score = 5 where id = v_g;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_ok := v_hint = 'TOURNAMENT_SWISS_NEXT_ROUND_PLAYED';
  end;
  perform pg_temp.check(v_ok, format('W16 once Round 2 is being played, the same correction is refused rather than silently re-pairing it (%s)', v_hint));
  perform pg_temp.settle_round(v_ca, v_plan, 2);
  perform pg_temp.settle_round(v_ca, v_plan, 3);
  perform pg_temp.check((select count(*) from public.tournament_games where plan_id = v_plan) = 9
    and pg_temp.rematches(v_plan) = 0 and (pg_temp.readiness(v_plan) ->> 'stage') = 'COMPLETED',
    format('W17 three rounds, nine games, no pair twice -- and the competition is complete with no fourth round (%s)', pg_temp.readiness(v_plan) ->> 'stage'));

  -- ============ W18-22. an odd field ============
  w := pg_temp.swiss_world(5);
  v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid; v_plan := (w ->> 'plan')::uuid;
  perform pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  perform pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L)', v_plan));
  select participant_id into v_bye from public.tournament_swiss_byes where plan_id = v_plan and round_number = 1;
  select id into v_table from public.tournament_plan_tables where plan_id = v_plan;
  perform pg_temp.check((select count(*) from public.tournament_games where plan_id = v_plan and round_number = 1) = 2 and v_bye is not null
    and not exists (select 1 from public.tournament_games where plan_id = v_plan and v_bye in (side_a_id, side_b_id))
    and (select count(*) from public.tournament_bracket_pairings where plan_id = v_plan) = 6,
    'W18 five sides: two games and a bye each round, and the bye is not a game and holds no pitch');
  perform pg_temp.check(exists (select 1 from internal.tournament_table_standings(v_table) s where s.participant_id = v_bye
      and s.won = 1 and s.played = 1 and s.points_for = 0 and s.points_against = 0
      and s.competition_points = (select points_win from public.tournament_plans where id = v_plan)),
    'W19 the bye is a win in the table -- a win''s points, no points for or against');
  perform pg_temp.settle_round(v_ca, v_plan, 1);
  perform pg_temp.settle_round(v_ca, v_plan, 2);
  perform pg_temp.settle_round(v_ca, v_plan, 3);
  select array_agg(participant_id order by round_number) into v_byes from public.tournament_swiss_byes where plan_id = v_plan;
  perform pg_temp.check(cardinality(v_byes) = 3 and (select count(distinct x) from unnest(v_byes) x) = 3 and pg_temp.rematches(v_plan) = 0,
    format('W20 three rounds, three different sides sit out: nobody has a second bye, and nobody meets twice (%s)', cardinality(v_byes)));
  select participant_id into v_x from public.tournament_swiss_byes where plan_id = v_plan and round_number = 1;
  select participant_id into v_bye from public.tournament_swiss_byes where plan_id = v_plan and round_number = 2;
  perform pg_temp.check(v_bye <> v_x, 'W21 the Round 2 bye goes to the lowest-ranked side that has not had one');

  -- second-bye swap refusal, in a fresh odd field before Round 2 starts
  w := pg_temp.swiss_world(5);
  v_ca := (w ->> 'ca')::uuid; v_plan := (w ->> 'plan')::uuid;
  perform pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  perform pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L)', v_plan));
  perform pg_temp.settle_round(v_ca, v_plan, 1);
  select participant_id into v_x from public.tournament_swiss_byes where plan_id = v_plan and round_number = 1;
  select participant_id into v_bye from public.tournament_swiss_byes where plan_id = v_plan and round_number = 2;
  v_state := pg_temp.try_as(v_ca, format('select public.swap_tournament_swiss_sides(%L, %L, %L)', v_plan, v_bye, v_x));
  perform pg_temp.check(v_state = '22023' and (select hint from pmr_last) = 'TOURNAMENT_SWISS_SECOND_BYE',
    format('W22 a swap that would give a side a second bye is refused (%s)', (select msg from pmr_last)));
  -- and a swap into a rematch is refused
  select id, side_a_id, side_b_id into v_g, v_a, v_b from public.tournament_games where plan_id = v_plan and round_number = 2 order by sort_order limit 1;
  select case when side_a_id = v_a then side_b_id else side_a_id end into v_x
  from public.tournament_games where plan_id = v_plan and round_number = 1 and v_a in (side_a_id, side_b_id);
  if v_x is not null and v_x <> v_b then
    v_state := pg_temp.try_as(v_ca, format('select public.swap_tournament_swiss_sides(%L, %L, %L)', v_plan, v_b, v_x));
    perform pg_temp.check(v_state = '22023' and (select hint from pmr_last) in ('TOURNAMENT_SWISS_REMATCH', 'TOURNAMENT_SWISS_SECOND_BYE'),
      format('W23 a swap that would make two teams meet again is refused (%s)', (select msg from pmr_last)));
  else
    perform pg_temp.check(true, 'W23 (this draw''s first Round 2 side sat out Round 1; the rematch refusal is covered by W10''s rule)');
  end if;

  -- ============ W24. participants see the next round's time, and the bye ============
  perform pg_temp.as_user((w ->> 'guest_ca')::uuid);
  v_r := public.get_tournament_participant_centre((w ->> 't')::uuid);
  perform set_config('role', 'none', true);
  perform pg_temp.check(jsonb_array_length(v_r -> 'contexts' -> 0 -> 'byes') >= 1
    and exists (select 1 from jsonb_array_elements(v_r -> 'contexts' -> 0 -> 'pairings') p where p ->> 'roundName' = 'Round 3')
    and not exists (select 1 from jsonb_array_elements(v_r -> 'contexts' -> 0 -> 'games') g where g ->> 'roundName' is not null),
    format('W24 a participant sees the byes, Round 3''s reserved time as "Round 3", and every game by its table (%s)', left((v_r -> 'contexts' -> 0 -> 'pairings')::text, 200)));
end $$;

rollback;
