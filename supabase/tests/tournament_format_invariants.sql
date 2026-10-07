-- EVERY FORMAT KEEPS THE SAME PROMISES (Tournament Planning parity programme, phases 9-10; 20270720-20270726).
--
-- One run per format -- Round Robin, Tri-Fixture, Knockout, Hybrid, Swiss -- through the same checks:
--   X1  it generates, and every game it makes has the server's stage label
--   X2  no side is ever in two games at once
--   X3  a DRAFT is the organiser's: a participating club reads none of its games, and the Fixtures
--       list carries none of them
--   X4  a team joining after generation is reported before publishing (fixtures out of date, or the
--       draw needing an update), and Publish refuses until it is dealt with
--   X5  the same team leaving again restores a publishable plan -- nothing is left half-changed
--   X6  published: the participant reads its games, and the Fixtures list carries one row per game,
--       labelled, with no score until one counts
--   X7  a result before kick-off is refused; a result on a published game is accepted
--   X8  once there is a result, the competition's membership is frozen
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


create or replace function pg_temp.run_format(p_format text, p_sides int) returns void language plpgsql as $$
declare w jsonb; v_ca uuid; v_guest uuid; v_t uuid; v_plan uuid; v_state text; v_n int; v_n2 int; v_late uuid; v_team uuid;
  v_guest_side uuid; v_rows jsonb; v_g uuid; v_tag text; v_r jsonb; v_blocked boolean;
begin
  w := pg_temp.world(p_format, p_sides, true, current_date - 1);
  v_ca := (w ->> 'ca')::uuid; v_guest := (w ->> 'guest_ca')::uuid; v_t := (w ->> 't')::uuid; v_tag := w ->> 'tag';
  v_guest_side := ((w -> 'sides') ->> 0)::uuid;
  -- the guest club's side is a real Ovalball team, so the Fixtures list has something of its own to show
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  select tp.club_id, 'Under 12 Boys', 'pmr-inv-' || v_tag, 'youth', 'U12', 'boys', 'union', true
  from public.tournament_participants tp where tp.id = v_guest_side returning id into v_team;
  update public.tournament_participants set team_id = v_team where id = v_guest_side;

  perform pg_temp.as_user(v_ca);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  if p_format = 'hybrid' then
    perform public.set_tournament_plan_tables(v_plan, jsonb_build_array(
      jsonb_build_object('name', 'Table A', 'sides', (select jsonb_agg(x) from (select (w -> 'sides') -> i as x from generate_series(0, p_sides / 2 - 1) i) y)),
      jsonb_build_object('name', 'Table B', 'sides', (select jsonb_agg(x) from (select (w -> 'sides') -> i as x from generate_series(p_sides / 2, p_sides - 1) i) y))));
    perform public.set_tournament_hybrid_settings(v_plan, 1);
  elsif p_format = 'knockout' then
    perform public.set_tournament_plan_days(v_plan, array[current_date - 1]);
    perform public.randomise_tournament_bracket(v_plan);
  end if;
  perform set_config('role', 'none', true);
  update public.tournament_plans set game_duration_minutes = 15, changeover_minutes = 5, day_start_time = '09:00', day_end_time = '16:00' where id = v_plan;

  v_state := pg_temp.try_as(v_ca, format('select public.%s(%L)',
    case when p_format = 'knockout' then 'generate_tournament_knockout_fixtures' else 'generate_tournament_plan_fixtures' end, v_plan));
  select count(*), count(*) filter (where internal.tournament_game_stage_label(plan_id, round_number, is_third_place, table_id) is null)
  into v_n, v_n2 from public.tournament_games where plan_id = v_plan;
  perform pg_temp.check(v_state = 'OK' and v_n > 0 and v_n2 = 0,
    format('X1 %s: generates %s games, every one with a stage label (%s %s)', p_format, v_n, v_state, (select msg from pmr_last)));
  perform pg_temp.check(not exists (
      select 1 from public.tournament_games a join public.tournament_games b on b.plan_id = a.plan_id and b.id <> a.id
      where a.plan_id = v_plan and a.start_time is not null and a.game_date = b.game_date and a.start_time = b.start_time
        and (a.side_a_id in (b.side_a_id, b.side_b_id) or a.side_b_id in (b.side_a_id, b.side_b_id))),
    format('X2 %s: no side is in two games at once', p_format));

  perform pg_temp.as_user(v_guest);
  select count(*) into v_n from public.tournament_games where tournament_id = v_t;
  v_rows := public.get_tournament_fixture_rows(array[v_team], current_date - 7, current_date + 7);
  perform set_config('role', 'none', true);
  perform pg_temp.check(v_n = 0 and jsonb_array_length(v_rows) = 0,
    format('X3 %s: a draft is the organiser''s -- the participant reads no games and its Fixtures list carries none (%s, %s)', p_format, v_n, jsonb_array_length(v_rows)));

  perform pg_temp.as_user(v_ca);
  v_late := public.add_tournament_participant_team(v_t, null, null, null, null, 'U12', 'Pmr Inv Late ' || v_tag);
  perform set_config('role', 'none', true);
  v_r := pg_temp.readiness(v_plan);
  v_blocked := pg_temp.has_blocker(v_plan, 'FIXTURES_OUT_OF_DATE') or pg_temp.has_blocker(v_plan, 'DRAW_MEMBERSHIP')
    or (p_format = 'tri_fixture' and pg_temp.has_blocker(v_plan, 'FIELD_SIZE'));
  v_state := pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L)', v_plan));
  perform pg_temp.check(v_blocked and not (v_r ->> 'readyToPublish')::boolean and v_state = '22023',
    format('X4 %s: a team joining after generation is reported before publishing, and Publish refuses (%s)', p_format, (select msg from pmr_last)));

  v_state := pg_temp.try_as(v_ca, format('select public.remove_tournament_participant(%L)', v_late));
  v_r := pg_temp.readiness(v_plan);
  perform pg_temp.check(v_state = 'OK' and (v_r ->> 'readyToPublish')::boolean,
    format('X5 %s: the same team leaving again restores a publishable plan (%s)', p_format, v_r -> 'blockers'));

  v_state := pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L)', v_plan));
  perform pg_temp.as_user(v_guest);
  select count(*) into v_n from public.tournament_games where tournament_id = v_t and v_guest_side in (side_a_id, side_b_id);
  v_rows := public.get_tournament_fixture_rows(array[v_team], current_date - 7, current_date + 7);
  perform set_config('role', 'none', true);
  perform pg_temp.check(v_state = 'OK' and v_n > 0 and jsonb_array_length(v_rows) = v_n
    and not exists (select 1 from jsonb_array_elements(v_rows) r where r ->> 'stageLabel' is null or r ->> 'ourScore' is not null
                    or (r -> 'opponent') ->> 'clubName' is null),
    format('X6 %s: published -- the participant reads its %s games and the Fixtures list carries one row each, labelled, opponent named, no score yet (%s rows)', p_format, v_n, jsonb_array_length(v_rows)));

  -- X7: a game whose kick-off is still to come refuses a result; one that has kicked off takes it
  select id into v_g from public.tournament_games where plan_id = v_plan order by game_date, start_time, sort_order limit 1;
  update public.tournaments set ends_on = current_date + 1 where id = v_t;
  update public.tournament_games set game_date = current_date + 1 where id = v_g;
  v_state := pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L, 12, 5, %L)', v_g, 'Referee''s card'));
  update public.tournament_games set game_date = current_date - 1 where id = v_g;
  v_n := case when v_state <> 'OK' then 1 else 0 end;
  v_state := pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L, 12, 5, %L)', v_g, 'Referee''s card'));
  perform pg_temp.check(v_n = 1 and v_state = 'OK',
    format('X7 %s: a result before kick-off is refused; after kick-off it is accepted (%s)', p_format, (select msg from pmr_last)));

  perform pg_temp.as_user(v_ca);
  v_state := 'OK';
  begin
    perform public.add_tournament_participant_team(v_t, null, null, null, null, 'U12', 'Pmr Inv Too Late ' || v_tag);
  exception when others then
    v_state := sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform pg_temp.check(v_state <> 'OK', format('X8 %s: once a result exists the competition''s membership is frozen (%s)', p_format, v_state));
end $$;

do $$
begin
  perform pg_temp.run_format('round_robin', 4);
  perform pg_temp.run_format('tri_fixture', 3);
  perform pg_temp.run_format('knockout', 4);
  perform pg_temp.run_format('hybrid', 6);
  perform pg_temp.run_format('swiss', 4);
end $$;

rollback;
