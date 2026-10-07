-- A RESULT CANNOT BE WRITTEN BEFORE ITS OWN GAME HAS KICKED OFF -- a platform-wide invariant, not a
-- fixtures-only or Tournament-only rule. `fixture_result_eligible` and `tournament_game_result_eligible`
-- were already proven on their own entry points (submit_fixture_result, submit_tournament_game_result).
-- This suite proves the three gaps the recovery audit found: two resolution paths that could settle a
-- result without ever checking whether the game they resolve had kicked off, and Competition Match's
-- record_competition_match_result, which had no kickoff check of any kind.
--
-- Self-contained throughout: creates its own club, tournament, competition edition and fixture, and
-- is wrapped in begin/rollback, so it never reads the persistent review world and leaves no trace.

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

do $outer$
declare
  v_ca uuid := gen_random_uuid();
  v_site uuid := gen_random_uuid();
  v_dir uuid; v_host uuid; v_venue uuid; v_pitch uuid;
  v_t uuid; v_plan uuid; v_s1 uuid; v_s2 uuid; v_g uuid;
  v_person uuid; v_msg text; v_raised boolean;
begin
  foreach v_person in array array[v_ca, v_site] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rkg-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_person, 'RKG', 'Tester', 'rkg-' || v_person::text || '@ovalball.test');
  end loop;
  insert into public.site_admins (user_id, status) values (v_site, 'active');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('RKG Host RUFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'rkg-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'rkg-' || substr(gen_random_uuid()::text, 1, 8), 'active') returning id into v_host;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_host, v_ca, 'CLUB_ADMIN', 'active');

  insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
  values (v_host, 'RKG Ground', 'rkg-g-' || substr(gen_random_uuid()::text, 1, 8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom')
  returning id into v_venue;
  insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order)
  values (v_host, v_venue, 'Pitch 1', true, 1) returning id into v_pitch;

  -- ============ A. TOURNAMENT HOST RESOLUTION -- FUTURE KICK-OFF REFUSED ============

  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
    conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
  values (v_host, v_dir, 'union', current_date + 10, current_date + 10, 'confirmed', 'RKG Future Festival',
    gen_random_uuid(), 'round_robin', 'private', v_venue, '09:00', '17:00')
  returning id into v_t;
  insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
  values (v_t, v_pitch, current_date + 10, '09:00', '17:00', v_ca);

  insert into public.tournament_participants (tournament_id, club_directory_id, age_group, squad_label, status)
  values (v_t, v_dir, 'U12', 'Side 1', 'added') returning id into v_s1;
  insert into public.tournament_participants (tournament_id, club_directory_id, age_group, squad_label, status)
  values (v_t, v_dir, 'U12', 'Side 2', 'added') returning id into v_s2;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_plan := public.start_tournament_plan(v_t, 'U12');
  perform public.set_tournament_plan_days(v_plan, array[(current_date + 10)::date]);
  perform public.set_tournament_plan_tables(v_plan, jsonb_build_array(
    jsonb_build_object('name', 'Table A', 'sides', jsonb_build_array(v_s1, v_s2))));
  perform public.generate_tournament_plan_fixtures(v_plan);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  update public.tournament_plans set publication_state = 'PUBLISHED', published_by = v_ca, published_at = now()
  where id = v_plan;
  select id into v_g from public.tournament_games where plan_id = v_plan limit 1;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_raised := false; v_msg := null;
  begin
    perform public.resolve_tournament_game_result(v_g, 20, 10, 'Recorded early');
  exception when others then
    v_raised := true; v_msg := sqlerrm;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_raised and v_msg like '%not kicked off yet%', format('A (host resolution): the tournament organiser cannot resolve a future game (%s)', v_msg));
  perform pg_temp.check((select result_status from public.tournament_games where id = v_g) = 'none',
    'A2 (host resolution): and no result was recorded by the attempt');

  -- ============ B. SITE ADMIN DISPUTE RESOLUTION -- FUTURE KICK-OFF REFUSED ============

  declare v_fixture uuid := gen_random_uuid(); v_team uuid; v_msg2 text; v_raised2 boolean;
  begin
    insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
    values (v_host, 'RKG U12', 'rkg-u12-' || substr(gen_random_uuid()::text, 1, 8), 'youth', 'U12', 'boys', 'union', true)
    returning id into v_team;
    insert into public.fixtures (id, owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
    values (v_fixture, v_team, 'Home', 'RKG Opposition', current_date + 10, '11:00', 'Booked', 'club_created');

    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_site, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    v_raised2 := false; v_msg2 := null;
    begin
      perform public.resolve_fixture_result_dispute(v_fixture, 12, 24, 'Resolved early');
    exception when others then
      v_raised2 := true; v_msg2 := sqlerrm;
    end;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
    perform pg_temp.check(v_raised2 and v_msg2 like '%not kicked off yet%', format('B (dispute resolution): a Site Admin cannot resolve a future fixture (%s)', v_msg2));
    perform pg_temp.check((select result_status from public.fixtures where id = v_fixture) is distinct from 'final',
      'B2 (dispute resolution): and no result was recorded by the attempt');
  end;

  -- ============ C. COMPETITION MATCH -- NO KICK-OFF, FUTURE, AND PAST ============

  declare
    v_comp uuid; v_edition uuid; v_stage uuid; v_p_a uuid := gen_random_uuid(); v_p_b uuid := gen_random_uuid();
    v_match uuid := gen_random_uuid(); v_result record; v_dir2 uuid;
    v_msg_c1 text; v_msg_c2 text; v_raised_c1 boolean; v_raised_c2 boolean; v_status_after_c2 text; v_status_after_c4 text;
  begin
    insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
    values ('RKG Opponent RUFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'rkg-opp-' || substr(gen_random_uuid()::text, 1, 8))
    returning id into v_dir2;

    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_site, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    select * into v_result from public.quick_create_competition('RKG Cup', 'union');
    v_comp := v_result.competition_id;
    v_edition := v_result.edition_id;

    perform public.save_competition_participants(v_edition, jsonb_build_array(
      jsonb_build_object('id', v_p_a, 'slot', 1, 'club_directory_id', v_dir),
      jsonb_build_object('id', v_p_b, 'slot', 2, 'club_directory_id', v_dir2)
    ));
    v_stage := public.save_competition_stage(v_edition, null, 'league', 'League', 1, '{"matches":"single"}'::jsonb, null);
    perform public.replace_competition_draft_matches(v_stage, jsonb_build_array(
      jsonb_build_object('id', v_match, 'round_number', 1, 'home_participant_id', v_p_a, 'away_participant_id', v_p_b)
    ), null, null);
    perform public.issue_competition_matches(v_edition, array[v_match]);

    -- C1. NO KICK-OFF AT ALL.
    v_raised_c1 := false; v_msg_c1 := null;
    begin
      perform public.record_competition_match_result(v_match, 10, 5, null);
    exception when others then
      v_raised_c1 := true; v_msg_c1 := sqlerrm;
    end;

    -- C2. A FUTURE KICK-OFF.
    perform public.update_competition_match(v_match, jsonb_build_object('match_date', current_date + 10, 'kickoff_time', '10:00'));
    v_raised_c2 := false; v_msg_c2 := null;
    begin
      perform public.record_competition_match_result(v_match, 10, 5, null);
    exception when others then
      v_raised_c2 := true; v_msg_c2 := sqlerrm;
    end;
    select status into v_status_after_c2 from public.competition_matches where id = v_match;

    -- C4. A PAST KICK-OFF IS ALLOWED.
    perform public.update_competition_match(v_match, jsonb_build_object('match_date', current_date - 1, 'kickoff_time', '10:00'));
    perform public.record_competition_match_result(v_match, 10, 5, null);
    select status into v_status_after_c4 from public.competition_matches where id = v_match;

    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);

    perform pg_temp.check(v_raised_c1 and v_msg_c1 like '%kick-off time must be scheduled%', format('C1 (competition match): no kick-off means no result (%s)', v_msg_c1));
    perform pg_temp.check(v_raised_c2 and v_msg_c2 like '%not kicked off yet%', format('C2 (competition match): a future kick-off is refused (%s)', v_msg_c2));
    perform pg_temp.check(v_status_after_c2 <> 'completed', 'C3 (competition match): and no result was recorded by either attempt');
    perform pg_temp.check(v_status_after_c4 = 'completed', 'C4 (competition match): once kicked off, the same call is accepted and the match is completed');
  end;
end $outer$;

rollback;
