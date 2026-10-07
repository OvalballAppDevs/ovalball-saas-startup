-- A PLAN ALWAYS KNOWS WHO IS PLAYING, AND WHAT IT NEEDS NEXT (20270720000000).
--
--   M  membership: a side added or removed before results is reconciled into a table-based plan; a
--      knockout draw reports the change and one action brings it up to date; after results nothing moves
--   S  status: an invitation awaiting a reply, or a declined one, is not a side in the plan
--   T  an unchanged table arrangement is not a change (games keep their table)
--   R  readiness: what Generate and Publish need, said before they are pressed, enforced by both
--   C  completing the schedule without re-pairing, and never moving a played game
--   K  the knockout scheduler: inside the playing hours, a round only after its feeders, a length on every game
--   P  a draft is the organiser's until it is published
--   F  a format with no generator of its own does not silently become a round robin
--   G  one game moved by hand: its own refusals, and people told only once the schedule is published
--   D  a draft game has no result; a published schedule changing as a whole is announced
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
  -- A FULL-SIZE PITCH MARKED OUT AS TWO HALVES, as a U12 festival lays it out: two games at once
  -- (20270736 holds a pitch to its own layout; a whole-pitch-only pitch would take one at a time).
  insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order, physical_size_category, layout)
  values (v_club, v_venue, 'Pitch ' || v_tag, true, 1, 'full', 'two_halves') returning id into v_pitch;
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
declare
  w jsonb; v_ca uuid; v_t uuid; v_plan uuid; v_late uuid; v_state text; v_n int; v_sides uuid[];
  v_g uuid; v_tid uuid; v_before uuid; v_pend uuid; v_r jsonb; v_first_slot timestamp; v_last_r1 timestamp;
begin
  -- ============ M. ROUND ROBIN: a side that joins after the tables are set ============
  w := pg_temp.world('round_robin', 3, true, current_date + 10);
  v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid;
  select array_agg(x::uuid) into v_sides from jsonb_array_elements_text(w -> 'sides') x;
  perform pg_temp.as_user(v_ca);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform public.set_tournament_plan_days(v_plan, array[current_date + 10]);
  perform public.set_tournament_plan_tables(v_plan, jsonb_build_array(jsonb_build_object('name', 'Table A', 'sides', to_jsonb(v_sides))));
  perform public.set_tournament_plan_settings(v_plan, 20);
  v_late := public.add_tournament_participant_team(v_t, null, null, null, null, 'U12', 'Pmr Late ' || (w ->> 'tag'));
  perform set_config('role', 'none', true);

  perform pg_temp.check((select count(*) from public.tournament_plan_table_sides where plan_id = v_plan) = 4
    and exists (select 1 from public.tournament_plan_table_sides where plan_id = v_plan and participant_id = v_late),
    'M1 a side added after the tables were set is seated automatically -- no refresh, no stale plan');
  perform pg_temp.check((pg_temp.readiness(v_plan) -> 'consistency' ->> 'newSides')::int = 0
    and (pg_temp.readiness(v_plan) ->> 'readyToGenerate')::boolean,
    'M2 and the plan reports nothing out of date and is ready to generate');

  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  perform pg_temp.check(v_state = 'OK' and (select count(*) from public.tournament_games where plan_id = v_plan) = 6
    and pg_temp.games_of(v_plan, v_late) = 3,
    format('M3 generating gives 4*3/2 = 6 games, three of them the new side''s (state %s)', v_state));

  -- after generation (draft): another side joins
  perform pg_temp.as_user(v_ca);
  v_before := public.add_tournament_participant_team(v_t, null, null, null, null, 'U12', 'Pmr Later ' || (w ->> 'tag'));
  perform set_config('role', 'none', true);
  perform pg_temp.check(pg_temp.has_blocker(v_plan, 'FIXTURES_OUT_OF_DATE')
    and (select b ->> 'action' from jsonb_array_elements(pg_temp.readiness(v_plan) -> 'blockers') b where b ->> 'code' = 'FIXTURES_OUT_OF_DATE') = 'regenerate',
    'M4 a side joining after generation is seated, and the draft says the fixtures are out of date -- Regenerate');
  v_state := pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L)', v_plan));
  perform pg_temp.check(v_state = '22023' and (select hint from pmr_last) = 'TOURNAMENT_PLAN_FIXTURES_OUT_OF_DATE',
    format('M5 publishing an out-of-date plan is refused with that same blocker (%s %s)', v_state, (select hint from pmr_last)));
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  perform pg_temp.check(v_state = 'OK' and (select count(*) from public.tournament_games where plan_id = v_plan) = 10
    and not pg_temp.has_blocker(v_plan, 'FIXTURES_OUT_OF_DATE'),
    'M6 regenerating includes them: 5*4/2 = 10 games, and the blocker clears');

  -- removed after generation, before results
  v_state := pg_temp.try_as(v_ca, format('select public.remove_tournament_participant(%L)', v_before));
  -- Its games go with it, and what remains is exactly the arrangement's own set of pairings (a round
  -- robin minus one side is the round robin of the rest), so nothing is reported out of date.
  perform pg_temp.check(v_state = 'OK'
    and not exists (select 1 from public.tournament_plan_table_sides where participant_id = v_before)
    and pg_temp.games_of(v_plan, v_before) = 0
    and (select count(*) from public.tournament_games where plan_id = v_plan) = 6
    and not pg_temp.has_blocker(v_plan, 'FIXTURES_OUT_OF_DATE'),
    'M7 a side removed after generation (before results) leaves its table and its games; the rest are still exactly 4*3/2');
  perform pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  perform pg_temp.check((select count(*) from public.tournament_games where plan_id = v_plan) = 6, 'M8 regenerating gives 4*3/2 = 6 again');

  -- ============ T. an unchanged arrangement is not a change ============
  select id into v_tid from public.tournament_plan_tables where plan_id = v_plan;
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_plan_tables(%L, %L::jsonb)', v_plan,
    (select jsonb_agg(jsonb_build_object('name', t.name, 'sides', (select jsonb_agg(s.participant_id order by s.position) from public.tournament_plan_table_sides s where s.table_id = t.id)) order by t.sort_order)
     from public.tournament_plan_tables t where t.plan_id = v_plan)));
  perform pg_temp.check(v_state = 'OK' and (select id from public.tournament_plan_tables where plan_id = v_plan) = v_tid
    and not exists (select 1 from public.tournament_games where plan_id = v_plan and table_id is null),
    'T1 saving the same tables again rebuilds nothing: every game keeps its table (it used to lose it, results included)');

  -- ============ R / C. readiness, completing the schedule, publishing ============
  perform pg_temp.check((pg_temp.readiness(v_plan) ->> 'readyToPublish')::boolean,
    format('R1 a generated plan with every game timed is ready to publish (%s)', pg_temp.readiness(v_plan) -> 'blockers'));
  v_state := pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L)', v_plan));
  perform pg_temp.check(v_state = 'OK' and pg_temp.readiness(v_plan) ->> 'stage' = 'PUBLISHED', 'R2 and it publishes; the stage is PUBLISHED');

  -- a result, then membership is frozen
  select id into v_g from public.tournament_games where plan_id = v_plan order by sort_order limit 1;
  update public.tournament_games set result_status = 'final', side_a_score = 10, side_b_score = 5 where id = v_g;
  perform pg_temp.check(pg_temp.readiness(v_plan) ->> 'stage' = 'IN_PROGRESS', 'R3 one result makes it IN_PROGRESS');
  v_state := pg_temp.try_as(v_ca, format('select public.add_tournament_participant_team(%L, null, null, null, null, %L, %L)', v_t, 'U12', 'Pmr Too Late ' || (w ->> 'tag')));
  perform pg_temp.check(v_state = '22023' and (select hint from pmr_last) = 'TOURNAMENT_COMPETITION_HAS_RESULTS',
    format('M9 once the competition has results a team cannot be added (%s)', v_state));
  v_state := pg_temp.try_as(v_ca, format('select public.remove_tournament_participant(%L)', v_late));
  perform pg_temp.check(v_state = '22023' and pg_temp.games_of(v_plan, v_late) = 3,
    'M10 nor removed -- its games and the result already recorded survive');
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_plan_tables(%L, %L::jsonb)', v_plan,
    jsonb_build_array(jsonb_build_object('name', 'Table A', 'sides', to_jsonb(array_remove(internal.tournament_plan_sides(v_plan), null))))));
  perform pg_temp.check(v_state in ('OK', '22023') and (select count(*) from public.tournament_games where plan_id = v_plan and table_id is not null) = 6,
    'M11 and rearranging the tables cannot strip the played games of their table');

  -- rescheduling never moves a played game
  select game_date + start_time into v_first_slot from public.tournament_games where id = v_g;
  update public.tournament_pitches set start_time = '10:00' where tournament_id = v_t;
  v_state := pg_temp.try_as(v_ca, format('select public.schedule_tournament_plan(%L)', v_plan));
  perform pg_temp.check(v_state = 'OK' and (select game_date + start_time from public.tournament_games where id = v_g) = v_first_slot
    and not exists (select 1 from public.tournament_games where plan_id = v_plan and id <> v_g and start_time < '10:00'),
    format('C1 scheduling again moves the unplayed games into the new window and leaves the played one where it was (%s)', v_state));

  -- ============ R. no pitches: pairings, a warning, then a route to times ============
  w := pg_temp.world('round_robin', 4, false, current_date + 12);
  v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid;
  perform pg_temp.as_user(v_ca);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform set_config('role', 'none', true);
  perform pg_temp.check(pg_temp.has_warning(v_plan, 'NO_PITCHES') and (pg_temp.readiness(v_plan) ->> 'readyToGenerate')::boolean,
    'R4 with no pitches reserved Planning warns BEFORE generation that games cannot be given times');
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  perform pg_temp.check(v_state = 'OK' and pg_temp.has_blocker(v_plan, 'UNSCHEDULED')
    and (select b ->> 'action' from jsonb_array_elements(pg_temp.readiness(v_plan) -> 'blockers') b where b ->> 'code' = 'UNSCHEDULED') = 'pitches',
    'R5 generating still pairs the games, and the draft names the blocker -- no kick-off times -- with the route: reserve pitches');
  v_state := pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L)', v_plan));
  perform pg_temp.check(v_state = '22023' and (select msg from pmr_last) like '6 of 6 games have no kick-off time yet.%',
    format('R6 and publishing refuses with exactly that sentence (%s)', (select msg from pmr_last)));
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
  values (v_t, (w ->> 'pitch')::uuid, current_date + 12, '09:00', '16:00', v_ca);
  v_state := pg_temp.try_as(v_ca, format('select public.schedule_tournament_plan(%L)', v_plan));
  perform pg_temp.check(v_state = 'OK' and not exists (select 1 from public.tournament_games where plan_id = v_plan and start_time is null)
    and (pg_temp.readiness(v_plan) ->> 'readyToPublish')::boolean,
    'C2 Complete Scheduling: once a pitch is reserved, scheduling gives every game a time without re-pairing, and readiness turns green');

  -- capacity said before Generate
  update public.tournament_plans set day_end_time = '09:30' where id = v_plan;
  perform pg_temp.check(pg_temp.has_blocker(v_plan, 'CAPACITY'),
    'R7 an arrangement the playing hours cannot hold is a blocker before Generate, not a surprise from it');
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
  perform pg_temp.check(v_state = '22023' and (select hint from pmr_last) = 'TOURNAMENT_PLAN_CAPACITY'
    and (select msg from pmr_last) like '3 rounds need 3 kick-off times%',
    format('R8 and Generate refuses with the same sentence (%s)', (select msg from pmr_last)));

  -- ============ S. pending and declined are not sides ============
  w := pg_temp.world('round_robin', 3, true, current_date + 14);
  v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid;
  perform pg_temp.as_user(v_ca);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform set_config('role', 'none', true);
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Pmr Invited RUFC ' || (w ->> 'tag'), 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'pmri-' || (w ->> 'tag'))
  returning id into v_tid;
  insert into public.tournament_participants (tournament_id, club_directory_id, age_group, status)
  values (v_t, v_tid, 'U12', 'pending')
  returning id into v_pend;
  perform pg_temp.check(not exists (select 1 from public.tournament_plan_table_sides where participant_id = v_pend)
    and pg_temp.has_warning(v_plan, 'AWAITING_REPLY'),
    'S1 an invitation awaiting a reply is not seated; the plan says one team has not replied');
  update public.tournament_participants set status = 'accepted' where id = v_pend;
  perform pg_temp.check(exists (select 1 from public.tournament_plan_table_sides where participant_id = v_pend),
    'S2 accepting seats it');
  update public.tournament_participants set status = 'declined' where id = v_pend;
  perform pg_temp.check(not exists (select 1 from public.tournament_plan_table_sides where participant_id = v_pend)
    and cardinality(internal.tournament_plan_sides(v_plan)) = 3,
    'S3 a declined side leaves its table and does not count');

  -- ============ M. KNOCKOUT: the draw reports, one action updates it ============
  w := pg_temp.world('knockout', 5, true, current_date + 16);
  v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid;
  perform pg_temp.as_user(v_ca);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform public.set_tournament_plan_days(v_plan, array[current_date + 16]);
  perform public.randomise_tournament_bracket(v_plan);
  select array_agg(participant_id order by position) into v_sides from public.tournament_bracket_slots
  where plan_id = v_plan and round_number = 1 and participant_id is not null;
  v_late := public.add_tournament_participant_team(v_t, null, null, null, null, 'U12', 'Pmr KO Late ' || (w ->> 'tag'));
  perform set_config('role', 'none', true);
  perform pg_temp.check(pg_temp.has_blocker(v_plan, 'DRAW_MEMBERSHIP')
    and (select b ->> 'action' from jsonb_array_elements(pg_temp.readiness(v_plan) -> 'blockers') b where b ->> 'code' = 'DRAW_MEMBERSHIP') = 'draw_update',
    'M12 a side joining a knockout is reported -- "1 new team is not in the draw yet" -- with one action, Update the Draw');
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_knockout_fixtures(%L)', v_plan));
  perform pg_temp.check(v_state = '22023', 'M13 and Generate refuses until it is done, rather than leaving the side out');
  v_state := pg_temp.try_as(v_ca, format('select public.update_tournament_draw_membership(%L)', v_plan));
  perform pg_temp.check(v_state = 'OK' and not pg_temp.has_blocker(v_plan, 'DRAW_MEMBERSHIP')
    and exists (select 1 from public.tournament_bracket_slots where plan_id = v_plan and participant_id = v_late)
    and (select array_agg(participant_id order by position) from public.tournament_bracket_slots
          where plan_id = v_plan and round_number = 1 and participant_id is not null and participant_id <> v_late) = v_sides,
    'M14 updating the draw adds the new side as the next seed and every other side keeps its place');
  v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_knockout_fixtures(%L)', v_plan));
  perform pg_temp.check(v_state = 'OK', format('M15 then the knockout generates (%s %s)', v_state, (select msg from pmr_last)));

  -- ============ K. the knockout scheduler ============
  perform pg_temp.check(not exists (select 1 from public.tournament_games where plan_id = v_plan and duration_minutes is null),
    'K1 every knockout game carries its length');
  select max(game_date + start_time + make_interval(mins => (select game_duration_minutes from public.tournament_plans where id = v_plan)))
  into v_last_r1 from public.tournament_bracket_pairings where plan_id = v_plan and round_number = 1 and start_time is not null;
  perform pg_temp.check(not exists (select 1 from public.tournament_bracket_pairings
                                     where plan_id = v_plan and round_number = 2 and start_time is not null
                                       and game_date + start_time < v_last_r1),
    'K2 no round-2 place starts before every round-1 game has finished');
  perform pg_temp.check(not exists (select 1 from public.tournament_bracket_pairings bp
                                     join public.tournament_plans p on p.id = bp.plan_id
                                     where bp.plan_id = v_plan and bp.start_time is not null
                                       and (bp.start_time < p.day_start_time
                                            or bp.start_time + make_interval(mins => p.game_duration_minutes) > p.day_end_time)),
    'K3 every knockout place falls inside the playing hours');

  -- the third-place play-off switched on AFTER the draw (Planning's own order: Draw, then Settings)
  perform pg_temp.as_user(v_ca);
  perform public.set_tournament_knockout_settings(v_plan, p_third_place_playoff => true);
  perform public.generate_tournament_knockout_fixtures(v_plan);
  perform set_config('role', 'none', true);
  perform pg_temp.check((select array_agg(internal.bracket_slot_label(s.id) order by s.position) from public.tournament_bracket_slots s
                          where s.plan_id = v_plan and s.is_third_place) = array['Loser SF1', 'Loser SF2'],
    'K4 a play-off switched on after the draw still names its places: Loser SF1 v Loser SF2, not "To be decided"');

  -- removing a drawn side leaves an empty place the draw reports, not a hole
  perform pg_temp.try_as(v_ca, format('select public.update_tournament_draw_membership(%L)', v_plan));
  v_state := pg_temp.try_as(v_ca, format('select public.remove_tournament_participant(%L)', v_late));
  perform pg_temp.check(v_state = 'OK'
    and (select count(*) from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and not is_third_place) = 8
    and pg_temp.has_blocker(v_plan, 'FIXTURES_OUT_OF_DATE'),
    format('M16 removing a drawn side keeps every place in the draw (8) and the draft reports it (%s)', v_state));

  -- ============ P. a draft is the organiser's ============
  w := pg_temp.world('round_robin', 3, true, current_date + 18);
  v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid;
  perform pg_temp.as_user(v_ca);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform public.generate_tournament_plan_fixtures(v_plan);
  perform set_config('role', 'none', true);
  perform pg_temp.as_user((w ->> 'guest_ca')::uuid);
  select count(*) into v_n from public.tournament_games where tournament_id = v_t;
  perform set_config('role', 'none', true);
  perform pg_temp.check(v_n = 0, format('P1 a participating club reads none of a DRAFT plan''s games over the API (%s)', v_n));
  perform pg_temp.as_user((w ->> 'guest_ca')::uuid);
  select count(*) into v_n from public.tournament_plan_table_sides s join public.tournament_plans p on p.id = s.plan_id where p.tournament_id = v_t;
  perform set_config('role', 'none', true);
  perform pg_temp.check(v_n = 0, 'P2 nor its tables');
  perform pg_temp.as_user(v_ca);
  select count(*) into v_n from public.tournament_games where tournament_id = v_t;
  perform set_config('role', 'none', true);
  perform pg_temp.check(v_n = 3, 'P3 the organiser reads them');
  perform pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L)', v_plan));
  perform pg_temp.as_user((w ->> 'guest_ca')::uuid);
  select count(*) into v_n from public.tournament_games where tournament_id = v_t;
  perform set_config('role', 'none', true);
  perform pg_temp.check(v_n = 3, 'P4 and once published, the participant does');

  -- ============ F. no silent round robin ============
  foreach v_r in array array['"swiss"'::jsonb, '"hybrid"'::jsonb] loop
    w := pg_temp.world(v_r #>> '{}', 4, true, current_date + 20);
    v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid;
    perform pg_temp.as_user(v_ca);
    v_plan := public.start_tournament_plan(v_t, 'U12');
    perform set_config('role', 'none', true);
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'internal' and p.proname = 'tournament_' || (v_r #>> '{}') || '_supported') then
      v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L)', v_plan));
      perform pg_temp.check(v_state = '22023' and not exists (select 1 from public.tournament_games where plan_id = v_plan),
        format('F1 a %s competition is not silently generated as a round robin (%s)', v_r #>> '{}', v_state));
    else
      perform pg_temp.check(true, format('F1 %s has its own generator (covered by its own suite)', v_r #>> '{}'));
    end if;
  end loop;
end $$;


do $$
declare w jsonb; v_ca uuid; v_t uuid; v_plan uuid; v_g uuid; v_other uuid; v_pitch uuid; v_state text; v_n int; v_day date := current_date - 1;
  v_a uuid; v_b uuid;
begin
  -- ============ G. one game moved by hand ============
  w := pg_temp.world('round_robin', 4, true, v_day);
  v_ca := (w ->> 'ca')::uuid; v_t := (w ->> 't')::uuid; v_pitch := (w ->> 'pitch')::uuid;
  perform pg_temp.as_user(v_ca);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform public.generate_tournament_plan_fixtures(v_plan);
  perform set_config('role', 'none', true);
  -- A game of the guest club's side, which has an admin to tell (a directory-only side has nobody).
  select id, side_a_id, side_b_id into v_g, v_a, v_b from public.tournament_games
  where plan_id = v_plan and ((w -> 'sides' ->> 0)::uuid in (side_a_id, side_b_id)) order by sort_order limit 1;
  select id into v_other from public.tournament_games where plan_id = v_plan and id <> v_g
    and (side_a_id in (v_a, v_b) or side_b_id in (v_a, v_b)) order by sort_order limit 1;

  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_game_schedule(%L, %L::date, %L::time, %L)', v_g, v_day + 1, '10:00', v_pitch));
  perform pg_temp.check(v_state = '22023' and (select msg from pmr_last) = 'That day is not one of this competition''s playing days.',
    'G1 a game cannot be moved to a day the competition does not play');
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_game_schedule(%L, %L::date, %L::time, %L)', v_g, v_day, '17:00', v_pitch));
  perform pg_temp.check(v_state = '22023' and (select hint from pmr_last) = 'TOURNAMENT_OUTSIDE_PLAYING_HOURS',
    format('G2 nor outside the competition''s playing hours -- said in words (%s)', (select msg from pmr_last)));
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_game_schedule(%L, %L::date, %L::time, %L)', v_g, v_day,
    (select start_time from public.tournament_games where id = v_other)::text, v_pitch));
  perform pg_temp.check(v_state = '22023' and (select hint from pmr_last) = 'TOURNAMENT_SIDE_CLASH',
    'G3 nor to a time one of its sides is already playing');
  select count(*) into v_n from public.notifications where type = 'tournament_schedule_changed' and data ->> 'tournament_id' = v_t::text;
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_game_schedule(%L, %L::date, %L::time, %L)', v_g, v_day, '12:00', v_pitch));
  perform pg_temp.check(v_state = 'OK' and (select start_time from public.tournament_games where id = v_g) = '12:00'
    and (select count(*) from public.notifications where type = 'tournament_schedule_changed' and data ->> 'tournament_id' = v_t::text) = v_n,
    'G4 a draft game moves, and nobody is told -- a draft is the organiser''s own');

  -- ============ D. a draft game has no result ============
  v_state := pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L, 10, 5, %L)', v_g, 'x'));
  perform pg_temp.check(v_state = '22023' and (select hint from pmr_last) = 'TOURNAMENT_PLAN_NOT_PUBLISHED',
    format('D1 a result cannot be recorded for a game in an unpublished plan, even by the organiser (%s)', (select msg from pmr_last)));

  perform pg_temp.try_as(v_ca, format('select public.publish_tournament_plan(%L)', v_plan));
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_game_schedule(%L, %L::date, %L::time, %L)', v_g, v_day, '12:15', v_pitch));
  perform pg_temp.check(v_state = 'OK'
    and exists (select 1 from public.notifications where type = 'tournament_schedule_changed'
                 and data ->> 'tournament_game_id' = v_g::text and body like '%now kicks off at 12:15%'),
    format('G5 once published, moving a game tells its sides when and where it now kicks off, and links to that game (%s %s)', v_state, (select msg from pmr_last)));
  -- RESCHEDULING A PUBLISHED PLAN TELLS THE SIDES WHOSE GAMES MOVED, once each (20270736 -- it used to
  -- tell every participating side whatever moved). The window opens half an hour later, so every game
  -- the scheduler places moves; the hand-placed one stays where the organiser put it.
  update public.tournament_pitches set start_time = '09:30' where tournament_id = v_t;
  select count(*) into v_n from public.notifications where type = 'tournament_schedule_changed' and data ->> 'tournament_id' = v_t::text;
  v_state := pg_temp.try_as(v_ca, format('select public.schedule_tournament_plan(%L)', v_plan));
  perform pg_temp.check(v_state = 'OK'
    and (select start_time from public.tournament_games where id = v_g) = '12:15'
    and not exists (select 1 from public.tournament_games where plan_id = v_plan and start_time < '09:30'),
    format('D2 a published plan is scheduled again around the game the organiser placed by hand (%s %s)', v_state, (select msg from pmr_last)));
  -- The guest club's side is the one side with somebody to tell (the others are directory-only), and
  -- the organiser who pressed Schedule is not told about their own change.
  perform pg_temp.check((select count(*) from public.notifications where type = 'tournament_schedule_changed' and data ->> 'tournament_id' = v_t::text) = v_n + 1
    and exists (select 1 from public.notifications n
                 where n.type = 'tournament_schedule_changed' and n.data ->> 'tournament_id' = v_t::text
                   and n.user_id = (w ->> 'guest_ca')::uuid and n.title in ('Tournament game moved', 'Tournament games moved')
                   and n.id not in (select x.id from public.notifications x where x.type = 'tournament_schedule_changed'
                                    and x.data ->> 'tournament_id' = v_t::text order by x.created_at, x.id limit v_n)),
    'D2b the side whose games moved is told ONCE for the whole pass, and the organiser who asked is not told');
  select count(*) into v_n from public.notifications where type = 'tournament_schedule_changed' and data ->> 'tournament_id' = v_t::text;
  perform pg_temp.try_as(v_ca, format('select public.schedule_tournament_plan(%L)', v_plan));
  perform pg_temp.check((select count(*) from public.notifications where type = 'tournament_schedule_changed' and data ->> 'tournament_id' = v_t::text) = v_n,
    'D2c and a pass that moves nothing tells nobody');
  v_state := pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L, 10, 5, %L)', v_g, 'Referee''s card'));
  perform pg_temp.check(v_state = 'OK', format('D3 and once published, the organiser records it (%s %s)', v_state, (select msg from pmr_last)));
  v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_game_schedule(%L, %L::date, %L::time, %L)', v_g, v_day, '09:00', v_pitch));
  perform pg_temp.check(v_state = '22023' and (select hint from pmr_last) = 'TOURNAMENT_GAME_HAS_RESULT',
    'G6 a game with a result is history and does not move');
end $$;

rollback;
