-- COMPETITION MATCHES (20270305000000 - 20270307000000).
--
-- The competition's canonical schedule and results, and their projection into
-- club fixtures. Proves, as the people involved:
--
--   1. Ovalball v Ovalball  -- the match persists; once both clubs confirm, ONE
--      linked fixture exists (the one-row inter-club model).
--   2. Ovalball v external  -- the match persists; one fixture owned by the
--      Ovalball team, with the external club as its directory opponent.
--   3. external v external  -- the match persists; ZERO fixtures; the organiser
--      edits it; the public reads it; its result decides a knockout place.
--   4. editing a match synchronises its linked fixture.
--   5. cancelling a match cancels its linked fixture; a linked match cannot be
--      deleted, so no fixture is orphaned.
--   6. the public schedule includes external v external matches, not drafts.
--   8. knockout progression works when the previous round was external.
--   9. an organiser cannot touch an unrelated club's fixture, cannot answer for
--      a club, and a Site Admin issuing a competition does not confirm on any
--      club's behalf.
--   plus: a linked fixture's competition-controlled fields refuse direct change;
--   a final fixture result reaches the match; anon cannot call the operations.
--
-- (Case 7, league standings including external results, is proved in
-- supabase/tests/js/competition_engine.test.mts, where the standings are
-- computed from these match records.)
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_site uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_admin_b uuid := gen_random_uuid();
  v_admin_e uuid := gen_random_uuid();
  v_person uuid;
  v_dir_a uuid; v_dir_b uuid; v_dir_c uuid; v_dir_d uuid; v_dir_e uuid;
  v_club_a uuid; v_club_b uuid; v_club_e uuid;
  v_team_a uuid; v_team_b uuid; v_team_e uuid;
  v_venue_a uuid; v_pitch_a uuid;
  v_season uuid;
  v_comp uuid; v_edition uuid;
  v_p_a uuid := gen_random_uuid(); v_p_b uuid := gen_random_uuid(); v_p_c uuid := gen_random_uuid(); v_p_d uuid := gen_random_uuid();
  v_stage uuid; v_ko uuid;
  v_m1 uuid := gen_random_uuid(); v_m2 uuid := gen_random_uuid(); v_m3 uuid := gen_random_uuid();
  v_sf1 uuid := gen_random_uuid(); v_sf2 uuid := gen_random_uuid(); v_final uuid := gen_random_uuid();
  v_ver uuid;
  v_fixture uuid;
  n integer;
  v_text text;
  v_club_comp uuid; v_club_edition uuid;
  v_club_p1 uuid := gen_random_uuid(); v_club_p2 uuid := gen_random_uuid(); v_club_stage uuid; v_club_match uuid := gen_random_uuid();
  v_result record;
  v_day date := current_date + 21;
begin
  -- ---------------------------------------------------------------
  -- SEED
  -- ---------------------------------------------------------------
  foreach v_person in array array[v_site, v_admin_a, v_admin_b, v_admin_e] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cm-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_person, 'Cm', 'Tester', 'cm-' || v_person::text || '@ovalball.test') on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role) values (v_site, 'active', 'full');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CM Alpha RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cm-a-' || v_tag) returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CM Bravo RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cm-b-' || v_tag) returning id into v_dir_b;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CM Charlie RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cm-c-' || v_tag) returning id into v_dir_c;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CM Delta RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cm-d-' || v_tag) returning id into v_dir_d;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CM Echo RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'cm-e-' || v_tag) returning id into v_dir_e;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'cm-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'cm-b-' || v_tag, 'active') returning id into v_club_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_e, 'cm-e-' || v_tag, 'active') returning id into v_club_e;

  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('CM Union ' || v_tag, current_date - 30, current_date + 300, 'union', (select greatest(2100, coalesce(max(s.season_year_start), 2099) + 1) from public.seasons s where s.season_year_start >= 2100), 'cm-' || v_tag) returning id into v_season;
  end if;

  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active) values (v_club_a, 'Under 12 Boys', 'cm-a-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_a;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active) values (v_club_b, 'Under 12 Boys', 'cm-b-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_b;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active) values (v_club_e, 'Under 12 Boys', 'cm-e-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_e;
  insert into public.venues (club_id, name, slug, active) values (v_club_a, 'CM Alpha Ground ' || v_tag, 'cm-alpha-ground-' || v_tag, true) returning id into v_venue_a;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_admin_a, 'CLUB_ADMIN', 'active'), (v_club_b, v_admin_b, 'CLUB_ADMIN', 'active'), (v_club_e, v_admin_e, 'CLUB_ADMIN', 'active');

  -- ---------------------------------------------------------------
  -- The competition, by name, as a Full Site Admin.
  -- ---------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  select * into v_result from public.quick_create_competition('CM Lancashire U12 Cup ' || v_tag, 'union');
  v_comp := v_result.competition_id;
  v_edition := v_result.edition_id;
  if v_edition is not null then
    raise notice 'PASS 0: a competition created with only a name and a code has a season edition, so selectors can offer it';
  else
    raise notice 'FAIL 0: quick create produced no edition (%)', v_result.needs_attention;
  end if;

  perform public.save_competition_participants(v_edition, jsonb_build_array(
    jsonb_build_object('id', v_p_a, 'slot', 1, 'club_directory_id', v_dir_a, 'club_id', v_club_a, 'team_id', v_team_a),
    jsonb_build_object('id', v_p_b, 'slot', 2, 'club_directory_id', v_dir_b, 'club_id', v_club_b, 'team_id', v_team_b),
    jsonb_build_object('id', v_p_c, 'slot', 3, 'club_directory_id', v_dir_c),
    jsonb_build_object('id', v_p_d, 'slot', 4, 'club_directory_id', v_dir_d)
  ));
  begin
    perform public.save_competition_participants(v_edition, jsonb_build_array(
      jsonb_build_object('id', v_p_a, 'slot', 1, 'club_directory_id', v_dir_a, 'club_id', v_club_a, 'team_id', v_team_a),
      jsonb_build_object('slot', 2, 'club_directory_id', v_dir_a, 'club_id', v_club_a, 'team_id', v_team_a)
    ));
    raise notice 'FAIL P: the same team was entered twice';
  exception when unique_violation then
    raise notice 'PASS P: entering the same team twice is refused as a duplicate';
  end;

  v_stage := public.save_competition_stage(v_edition, null, 'league', 'League', 1, '{"matches":"single"}'::jsonb, null);
  perform public.replace_competition_draft_matches(v_stage, jsonb_build_array(
    jsonb_build_object('id', v_m1, 'round_number', 1, 'home_participant_id', v_p_a, 'away_participant_id', v_p_b, 'match_date', v_day, 'kickoff_time', '10:30', 'venue_id', v_venue_a),
    jsonb_build_object('id', v_m2, 'round_number', 2, 'home_participant_id', v_p_a, 'away_participant_id', v_p_c, 'match_date', v_day + 7, 'kickoff_time', '11:00'),
    jsonb_build_object('id', v_m3, 'round_number', 1, 'home_participant_id', v_p_c, 'away_participant_id', v_p_d, 'match_date', v_day, 'kickoff_time', '12:00', 'venue_text', 'Charlie Park')
  ), null, null);

  begin
    perform public.replace_competition_draft_matches(v_stage, jsonb_build_array(
      jsonb_build_object('round_number', 3, 'home_participant_id', v_p_c, 'away_participant_id', v_p_c)), null, 3);
    raise notice 'FAIL S: a team was drawn against itself';
  exception when check_violation then
    raise notice 'PASS S: a team cannot be drawn against itself';
  end;

  -- ---------------------------------------------------------------
  -- Issue as the Site Admin: no club is answered for.
  -- ---------------------------------------------------------------
  perform public.issue_competition_matches(v_edition, null);
  reset role;

  select count(*) into n from public.competition_match_verifications where match_id in (v_m1, v_m2) and status = 'awaiting';
  if n = 3 and (select status from public.competition_matches where id = v_m1) = 'issued'
     and not exists (select 1 from public.competition_match_fixtures where match_id in (v_m1, v_m2)) then
    raise notice 'PASS 9a: a Site Admin issuing the competition confirms nothing on any club''s behalf -- three clubs are asked, no fixture exists yet';
  else
    raise notice 'FAIL 9a: awaiting verifications=% -- the issue answered for a club or projected early', n;
  end if;
  if exists (select 1 from public.notifications where type = 'competition_match_verification_requested' and user_id = v_admin_b and data->>'competition_match_id' = v_m1::text) then
    raise notice 'PASS 9b: the Bravo club administrator is notified to confirm';
  else
    raise notice 'FAIL 9b: Bravo was not notified';
  end if;

  -- ---------------------------------------------------------------
  -- 1. Ovalball v Ovalball
  -- ---------------------------------------------------------------
  select id into v_ver from public.competition_match_verifications where match_id = v_m1 and club_id = v_club_a;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_e::text, 'role', 'authenticated')::text, true);
  begin
    perform public.respond_competition_match(v_ver, 'confirmed');
    raise notice 'FAIL 9c: another club confirmed Alpha''s match';
  exception when insufficient_privilege then
    raise notice 'PASS 9c: another club cannot answer a match for Alpha';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  perform public.respond_competition_match(v_ver, 'confirmed');
  reset role;
  if not exists (select 1 from public.competition_match_fixtures where match_id = v_m1) then
    raise notice 'PASS 1a: one confirmation is not enough -- no fixture while Bravo has not answered';
  else
    raise notice 'FAIL 1a: a fixture appeared before both clubs confirmed';
  end if;
  select id into v_ver from public.competition_match_verifications where match_id = v_m1 and club_id = v_club_b;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b::text, 'role', 'authenticated')::text, true);
  perform public.respond_competition_match(v_ver, 'confirmed');
  reset role;
  select count(*) into n from public.competition_match_fixtures l join public.fixtures f on f.id = l.fixture_id
  where l.match_id = v_m1 and f.owning_team_id = v_team_a and f.opponent_team_id = v_team_b and f.home_away = 'Home'
    and f.kickoff_date = v_day and f.competition_edition_id = v_edition and f.venue_id = v_venue_a;
  if n = 1 and (select status from public.competition_matches where id = v_m1) = 'confirmed' then
    raise notice 'PASS 1: Ovalball v Ovalball -- the match persists and exactly one linked fixture exists once both clubs confirm';
  else
    raise notice 'FAIL 1: linked fixtures matching = %', n;
  end if;

  -- ---------------------------------------------------------------
  -- 2. Ovalball v external
  -- ---------------------------------------------------------------
  select id into v_ver from public.competition_match_verifications where match_id = v_m2 and club_id = v_club_a;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  perform public.respond_competition_match(v_ver, 'confirmed');
  reset role;
  select count(*) into n from public.competition_match_fixtures l join public.fixtures f on f.id = l.fixture_id
  where l.match_id = v_m2 and f.owning_team_id = v_team_a and f.opponent_team_id is null and f.opponent_directory_id = v_dir_c;
  if n = 1 then
    raise notice 'PASS 2: Ovalball v external -- one fixture owned by the Ovalball team, the external club as its directory opponent';
  else
    raise notice 'FAIL 2: owning-team fixtures = %', n;
  end if;

  -- ---------------------------------------------------------------
  -- 3 + 6. external v external
  -- ---------------------------------------------------------------
  if exists (select 1 from public.competition_matches where id = v_m3 and status = 'scheduled' and verification_state = 'not_required')
     and not exists (select 1 from public.competition_match_fixtures where match_id = v_m3) then
    raise notice 'PASS 3a: external v external -- the match is scheduled with no verification and zero fixture rows';
  else
    raise notice 'FAIL 3a: external v external state is wrong';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  perform public.update_competition_match(v_m3, jsonb_build_object('match_date', v_day + 1, 'kickoff_time', '13:30'));
  reset role;
  if exists (select 1 from public.competition_matches where id = v_m3 and match_date = v_day + 1 and kickoff_time = '13:30') then
    raise notice 'PASS 3b: the organiser edits an external v external match';
  else
    raise notice 'FAIL 3b: the edit did not land';
  end if;

  -- A genuinely anonymous reader: no claims left over from an earlier step.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  select count(*) into n from public.competition_matches where id = v_m3;
  reset role;
  if n = 1 then
    raise notice 'PASS 6a: the public schedule includes the external v external match';
  else
    raise notice 'FAIL 6a: anon cannot see the external v external match';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  perform public.replace_competition_draft_matches(v_stage, jsonb_build_array(
    jsonb_build_object('round_number', 5, 'home_participant_id', v_p_d, 'away_participant_id', v_p_c)), null, 5);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  select count(*) into n from public.competition_matches where stage_id = v_stage and round_number = 5;
  reset role;
  if n = 0 then
    raise notice 'PASS 6b: a draft match is the organiser''s working copy, invisible to the public';
  else
    raise notice 'FAIL 6b: anon can see a draft match';
  end if;

  -- ---------------------------------------------------------------
  -- 4. Editing a match synchronises its fixture
  -- ---------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  perform public.update_competition_match(v_m1, jsonb_build_object('match_date', v_day + 2, 'kickoff_time', '14:00'));
  reset role;
  select l.fixture_id into v_fixture from public.competition_match_fixtures l where l.match_id = v_m1;
  if exists (select 1 from public.fixtures where id = v_fixture and kickoff_date = v_day + 2 and kickoff_time = '14:00') then
    raise notice 'PASS 4: changing the match date and kick-off moves its linked fixture, through the sync service';
  else
    raise notice 'FAIL 4: the linked fixture did not follow the match';
  end if;
  if exists (select 1 from public.notifications where type = 'competition_match_changed' and user_id = v_admin_b and data->>'competition_match_id' = v_m1::text) then
    raise notice 'PASS 4b: the clubs are told the match changed';
  else
    raise notice 'FAIL 4b: no change notification';
  end if;

  -- Drift guard: the club cannot move a competition-controlled field itself.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  begin
    update public.fixtures set kickoff_date = v_day + 30 where id = v_fixture;
    raise notice 'FAIL D: a club moved a competition fixture''s date directly';
  exception when insufficient_privilege then
    get stacked diagnostics v_text = message_text;
    if v_text like '%scheduled by the competition%' then
      raise notice 'PASS D: a club changing a competition fixture''s date directly is refused, naming the competition';
    else
      raise notice 'FAIL D: refused with an unexpected message: %', v_text;
    end if;
  end;
  begin
    update public.fixtures set meet_time = '13:15' where id = v_fixture;
    raise notice 'PASS D2: the club still owns operational fields such as the meet time';
  exception when others then
    raise notice 'FAIL D2: a club could not set its own meet time: %', sqlerrm;
  end;
  reset role;

  -- ---------------------------------------------------------------
  -- 5. Cancelling does not orphan the fixture
  -- ---------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  begin
    perform public.delete_competition_draft_match(v_m2);
    raise notice 'FAIL 5a: an issued match with a club fixture was deleted';
  exception when check_violation then
    raise notice 'PASS 5a: an issued match with a linked fixture cannot be deleted';
  end;
  perform public.cancel_competition_match(v_m2, 'cancelled', 'Pitch unavailable');
  reset role;
  if exists (
    select 1 from public.competition_match_fixtures l join public.fixtures f on f.id = l.fixture_id
    where l.match_id = v_m2 and f.status = 'Cancelled'
  ) then
    raise notice 'PASS 5b: cancelling the match cancels its linked fixture, and the link remains';
  else
    raise notice 'FAIL 5b: the linked fixture was not cancelled with the match';
  end if;

  -- ---------------------------------------------------------------
  -- 8. Knockout progression through an external match
  -- ---------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  v_ko := public.save_competition_stage(v_edition, null, 'knockout', 'Cup', 2, '{"seeding":"manual"}'::jsonb, null);
  perform public.replace_competition_draft_matches(v_ko, jsonb_build_array(
    jsonb_build_object('id', v_sf1, 'round_number', 1, 'bracket_slot', 1, 'home_participant_id', v_p_c, 'away_participant_id', v_p_d),
    jsonb_build_object('id', v_sf2, 'round_number', 1, 'bracket_slot', 2, 'home_participant_id', v_p_b, 'away_participant_id', v_p_a),
    jsonb_build_object('id', v_final, 'round_number', 2, 'bracket_slot', 1,
      'home_source', jsonb_build_object('winner_of', v_sf1), 'away_source', jsonb_build_object('winner_of', v_sf2))
  ), null, null);
  perform public.issue_competition_matches(v_edition, array[v_sf1]);
  begin
    perform public.record_competition_match_result(v_sf1, 10, 10, null);
    raise notice 'FAIL 8a: a drawn knockout match was completed without a winner';
  exception when check_violation then
    raise notice 'PASS 8a: a drawn knockout match needs a winner to be chosen';
  end;
  perform public.record_competition_match_result(v_sf1, 24, 12, null);
  reset role;
  if (select home_participant_id from public.competition_matches where id = v_final) = v_p_c then
    raise notice 'PASS 8: the external winner of an external v external semi-final takes their place in the final';
  else
    raise notice 'FAIL 8: the final did not receive the external semi-final winner';
  end if;
  if (select winner_participant_id from public.competition_matches where id = v_m3) is null
     and (select status from public.competition_matches where id = v_sf1) = 'completed' then
    raise notice 'PASS 3c: an external v external result is recorded on the competition match';
  else
    raise notice 'FAIL 3c: the external result was not recorded';
  end if;

  -- ---------------------------------------------------------------
  -- A final fixture result reaches its match
  -- ---------------------------------------------------------------
  update public.fixtures set home_score = 31, away_score = 17, result_status = 'final' where id = v_fixture;
  if exists (select 1 from public.competition_matches where id = v_m1 and home_score = 31 and away_score = 17 and result_source = 'fixture' and winner_participant_id = v_p_a) then
    raise notice 'PASS R: a final result on the linked fixture becomes the competition match result, oriented correctly';
  else
    raise notice 'FAIL R: the fixture result did not reach the match';
  end if;

  -- ---------------------------------------------------------------
  -- 9. A club organiser has authority over its competition only
  -- ---------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_e::text, 'role', 'authenticated')::text, true);
  select * into v_result from public.create_club_competition('CM Echo Festival League ' || v_tag, 'union', v_club_e);
  v_club_comp := v_result.competition_id;
  v_club_edition := v_result.edition_id;
  if public.can_organise_competition(v_club_comp) and not public.can_organise_competition(v_comp) then
    raise notice 'PASS 9d: a club administrator organises their club''s own competition and not somebody else''s';
  else
    raise notice 'FAIL 9d: club organiser authority is wrong';
  end if;
  begin
    perform public.update_competition_match(v_m1, jsonb_build_object('notes', 'not mine'));
    raise notice 'FAIL 9e: a club organiser edited another competition''s match';
  exception when insufficient_privilege then
    raise notice 'PASS 9e: a club organiser cannot edit another competition''s match';
  end;
  update public.fixtures set notes = 'echo was here' where id = v_fixture;
  get diagnostics n = row_count;
  if n = 0 then
    raise notice 'PASS 9f: running a competition gives no edit rights over an unrelated club''s fixture';
  else
    raise notice 'FAIL 9f: a competition organiser edited an unrelated club''s fixture';
  end if;
  perform public.save_competition_participants(v_club_edition, jsonb_build_array(
    jsonb_build_object('id', v_club_p1, 'slot', 1, 'club_directory_id', v_dir_e, 'club_id', v_club_e, 'team_id', v_team_e),
    jsonb_build_object('id', v_club_p2, 'slot', 2, 'club_directory_id', v_dir_b, 'club_id', v_club_b, 'team_id', v_team_b)
  ));
  v_club_stage := public.save_competition_stage(v_club_edition, null, 'league', 'League', 1, '{}'::jsonb, null);
  perform public.replace_competition_draft_matches(v_club_stage, jsonb_build_array(
    jsonb_build_object('id', v_club_match, 'round_number', 1, 'home_participant_id', v_club_p1, 'away_participant_id', v_club_p2, 'match_date', v_day + 40, 'kickoff_time', '10:00')), null, null);
  perform public.issue_competition_matches(v_club_edition, null);
  reset role;
  if (select status from public.competition_match_verifications where match_id = v_club_match and club_id = v_club_e) = 'confirmed'
     and (select status from public.competition_match_verifications where match_id = v_club_match and club_id = v_club_b) = 'awaiting' then
    raise notice 'PASS 9g: the organising club''s own side is confirmed by its administrator; the other club is still asked';
  else
    raise notice 'FAIL 9g: club-organised issue answered wrongly';
  end if;

  -- ---------------------------------------------------------------
  -- Privilege layer
  -- ---------------------------------------------------------------
  if not has_function_privilege('anon', 'public.issue_competition_matches(uuid, uuid[])', 'EXECUTE')
     and not has_function_privilege('anon', 'public.update_competition_match(uuid, jsonb)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.respond_competition_match(uuid, text, text, date, time, uuid, uuid)', 'EXECUTE') then
    raise notice 'PASS G: anon cannot call any competition operation';
  else
    raise notice 'FAIL G: an operation is executable by anon';
  end if;
end $$;

rollback;
