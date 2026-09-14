-- COMPETITION CREATOR CONFORMANCE (20270311000000).
--
--   Q. Quick-create needs a name and Union or League; the season may be chosen
--      from the register, never one of the other code; Union and League
--      editions never meet in one code's selector.
--   B. Several match changes are one change: a swap between two draft matches
--      is saved together; a batch with one bad change changes nothing; a batch
--      that would put a team in two matches of one round is refused.
--   I. An issued match keeps its teams: a set place is not replaced, an empty
--      knockout place can be filled.
--   V. A club answering a match proposes only its own ground and a pitch at it.
--   R. An organiser's result on an Ovalball v external match reaches the club's
--      linked fixture (one result authority, synchronised one way).
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
  v_person uuid;
  v_dir_a uuid; v_dir_b uuid; v_dir_c uuid; v_dir_d uuid;
  v_club_a uuid; v_club_b uuid;
  v_team_a uuid; v_team_b uuid;
  v_venue_a uuid; v_pitch_a uuid; v_venue_b uuid;
  v_union_season uuid; v_league_season uuid;
  v_result record;
  v_comp uuid; v_edition uuid; v_league_edition uuid;
  v_p_a uuid := gen_random_uuid(); v_p_b uuid := gen_random_uuid(); v_p_c uuid := gen_random_uuid(); v_p_d uuid := gen_random_uuid();
  v_stage uuid; v_group uuid; v_ko uuid;
  v_m1 uuid := gen_random_uuid(); v_m2 uuid := gen_random_uuid(); v_m3 uuid := gen_random_uuid();
  v_k1 uuid := gen_random_uuid();
  v_ver uuid;
  v_fixture uuid;
  v_before text;
  n integer;
  v_day date := current_date + 28;
begin
  foreach v_person in array array[v_site, v_admin_a, v_admin_b] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ccc-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_person, 'Ccc', 'Tester', 'ccc-' || v_person::text || '@ovalball.test') on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role) values (v_site, 'active', 'full');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CCC Alpha RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ccc-a-' || v_tag) returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CCC Bravo RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ccc-b-' || v_tag) returning id into v_dir_b;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CCC Charlie RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ccc-c-' || v_tag) returning id into v_dir_c;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('CCC Delta RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ccc-d-' || v_tag) returning id into v_dir_d;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'ccc-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'ccc-b-' || v_tag, 'active') returning id into v_club_b;

  select id into v_union_season from public.seasons where rugby_code = 'union' and not is_regression_fixture and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_union_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('CCC Union ' || v_tag, current_date - 30, current_date + 300, 'union', (select greatest(2100, coalesce(max(s.season_year_start), 2099) + 1) from public.seasons s where s.season_year_start >= 2100), 'ccc-u-' || v_tag) returning id into v_union_season;
  end if;
  select id into v_league_season from public.seasons where rugby_code = 'league' and not is_regression_fixture order by starts_on desc limit 1;
  if v_league_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('CCC League ' || v_tag, current_date - 30, current_date + 300, 'league', (select greatest(2100, coalesce(max(s.season_year_start), 2099) + 1) from public.seasons s where s.season_year_start >= 2100), 'ccc-l-' || v_tag) returning id into v_league_season;
  end if;

  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active) values (v_club_a, 'Under 12 Boys', 'ccc-a-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_a;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active) values (v_club_b, 'Under 12 Boys', 'ccc-b-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_b;
  insert into public.venues (club_id, name, slug, active, is_default_home) values (v_club_a, 'CCC Alpha Ground ' || v_tag, 'ccc-alpha-ground-' || v_tag, true, true) returning id into v_venue_a;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values (v_club_a, v_venue_a, 'CCC Pitch 1', true) returning id into v_pitch_a;
  insert into public.venues (club_id, name, slug, active) values (v_club_b, 'CCC Bravo Ground ' || v_tag, 'ccc-bravo-ground-' || v_tag, true) returning id into v_venue_b;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_admin_a, 'CLUB_ADMIN', 'active'), (v_club_b, v_admin_b, 'CLUB_ADMIN', 'active');

  -- =================================================================
  -- Q. Quick-create: name, code, and a season of that code
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  select * into v_result from public.quick_create_competition('CCC League Nines ' || v_tag, 'league', v_league_season);
  v_league_edition := v_result.edition_id;
  begin
    perform public.quick_create_competition('CCC Wrong Season ' || v_tag, 'union', v_league_season);
    raise notice 'FAIL Q2: a Union competition was given a League season';
  exception when check_violation then
    raise notice 'PASS Q2: a Union competition cannot be given a League season';
  end;
  begin
    perform public.quick_create_competition('CCC No Code ' || v_tag, null);
    raise notice 'FAIL Q3: a competition was created without Union or League';
  exception when others then
    raise notice 'PASS Q3: a competition cannot be created without choosing Union or League';
  end;
  select * into v_result from public.quick_create_competition('CCC Lancashire U12 Cup ' || v_tag, 'union');
  v_comp := v_result.competition_id;
  v_edition := v_result.edition_id;
  reset role;

  if (select season_id from public.competition_editions where id = v_league_edition) = v_league_season then
    raise notice 'PASS Q1: a League competition is created in the League season chosen from the register';
  else
    raise notice 'FAIL Q1: the chosen season was not used';
  end if;
  if not exists (select 1 from public.competitions where name = 'CCC Wrong Season ' || v_tag) then
    raise notice 'PASS Q2b: a refused season leaves no competition behind';
  else
    raise notice 'FAIL Q2b: a competition was left behind by a refused season';
  end if;
  -- The selectors' query: active editions of one code (lib/fixtures/competitions.ts, planner, editor).
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.competition_editions e join public.competitions c on c.id = e.competition_id where e.rugby_code = 'union' and e.active and c.active and e.id = v_edition)
     and not exists (select 1 from public.competition_editions e where e.rugby_code = 'union' and e.id = v_league_edition)
     and not exists (select 1 from public.competition_editions e where e.rugby_code = 'league' and e.id = v_edition)
     and exists (select 1 from public.competition_editions e where e.rugby_code = 'league' and e.id = v_league_edition) then
    raise notice 'PASS Q4: the Union competition is offered to Union selectors only, and the League one to League selectors only';
  else
    raise notice 'FAIL Q4: a competition crossed into the other code''s selector';
  end if;
  reset role;

  -- =================================================================
  -- Seed a draw: 4 participants (two Ovalball, two external), one group, 2 rounds
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  perform public.save_competition_participants(v_edition, jsonb_build_array(
    jsonb_build_object('id', v_p_a, 'slot', 1, 'club_directory_id', v_dir_a, 'club_id', v_club_a, 'team_id', v_team_a),
    jsonb_build_object('id', v_p_b, 'slot', 2, 'club_directory_id', v_dir_b, 'club_id', v_club_b, 'team_id', v_team_b),
    jsonb_build_object('id', v_p_c, 'slot', 3, 'club_directory_id', v_dir_c),
    jsonb_build_object('id', v_p_d, 'slot', 4, 'club_directory_id', v_dir_d)));
  v_stage := public.save_competition_stage(v_edition, null, 'league', 'Group Stage', 1, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('name', 'Group A', 'members', jsonb_build_array(v_p_a, v_p_b, v_p_c, v_p_d))));
  select id into v_group from public.competition_groups where stage_id = v_stage;
  perform public.replace_competition_draft_matches(v_stage, jsonb_build_array(
    jsonb_build_object('id', v_m1, 'group_id', v_group, 'round_number', 1, 'home_participant_id', v_p_a, 'away_participant_id', v_p_c, 'match_date', v_day),
    jsonb_build_object('id', v_m2, 'group_id', v_group, 'round_number', 1, 'home_participant_id', v_p_b, 'away_participant_id', v_p_d, 'match_date', v_day),
    jsonb_build_object('id', v_m3, 'group_id', v_group, 'round_number', 2, 'home_participant_id', v_p_c, 'away_participant_id', v_p_d, 'match_date', v_day + 7)));
  reset role;

  -- =================================================================
  -- B. Several changes, one change
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  perform public.update_competition_matches(v_edition, jsonb_build_array(
    jsonb_build_object('id', v_m1, 'patch', jsonb_build_object('away_participant_id', v_p_d)),
    jsonb_build_object('id', v_m2, 'patch', jsonb_build_object('away_participant_id', v_p_c))));
  reset role;
  if (select away_participant_id from public.competition_matches where id = v_m1) = v_p_d and (select away_participant_id from public.competition_matches where id = v_m2) = v_p_c then
    raise notice 'PASS B1: two teams swap between two draft matches in one change';
  else
    raise notice 'FAIL B1: the swap did not land on both matches';
  end if;

  v_before := (select string_agg(coalesce(home_participant_id::text, '') || '>' || coalesce(away_participant_id::text, ''), ',' order by id) from public.competition_matches where edition_id = v_edition);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  begin
    perform public.update_competition_matches(v_edition, jsonb_build_array(
      jsonb_build_object('id', v_m1, 'patch', jsonb_build_object('home_participant_id', v_p_b)),
      jsonb_build_object('id', v_m2, 'patch', jsonb_build_object('home_participant_id', gen_random_uuid()))));
    raise notice 'FAIL B2: a batch with an invalid change was accepted';
  exception when check_violation then
    null;
  end;
  begin
    perform public.update_competition_matches(v_edition, jsonb_build_array(
      jsonb_build_object('id', v_m1, 'patch', jsonb_build_object('away_participant_id', v_p_b))));
    raise notice 'FAIL B3: a team was put in two matches of one round';
  exception when check_violation then
    raise notice 'PASS B3: a change that puts a team in two matches of one round is refused';
  end;
  reset role;
  if (select string_agg(coalesce(home_participant_id::text, '') || '>' || coalesce(away_participant_id::text, ''), ',' order by id) from public.competition_matches where edition_id = v_edition) = v_before then
    raise notice 'PASS B2: a batch with one bad change changes nothing -- all or none';
  else
    raise notice 'FAIL B2: part of a failed batch was saved';
  end if;

  -- =================================================================
  -- I. An issued match keeps its teams; an empty place can be filled
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  perform public.issue_competition_matches(v_edition, array[v_m1]);
  begin
    perform public.update_competition_match(v_m1, jsonb_build_object('away_participant_id', v_p_c));
    raise notice 'FAIL I1: an issued match''s team was replaced';
  exception when check_violation then
    raise notice 'PASS I1: an issued match''s teams stay as they are';
  end;
  v_ko := public.save_competition_stage(v_edition, null, 'knockout', 'Knockout', 2, '{}'::jsonb, null);
  perform public.replace_competition_draft_matches(v_ko, jsonb_build_array(
    jsonb_build_object('id', v_k1, 'round_number', 1, 'bracket_slot', 1, 'home_source', jsonb_build_object('qualifier', jsonb_build_object('group_index', 0, 'position', 1), 'label', 'Group A 1st'),
      'away_source', jsonb_build_object('qualifier', jsonb_build_object('group_index', 0, 'position', 2), 'label', 'Group A 2nd'), 'match_date', v_day + 21)));
  perform public.issue_competition_matches(v_edition, array[v_k1]);
  perform public.update_competition_matches(v_edition, jsonb_build_array(jsonb_build_object('id', v_k1, 'patch', jsonb_build_object('home_participant_id', v_p_c, 'away_participant_id', v_p_d))));
  reset role;
  if (select home_participant_id from public.competition_matches where id = v_k1) = v_p_c and (select away_participant_id from public.competition_matches where id = v_k1) = v_p_d then
    raise notice 'PASS I2: an issued knockout match''s empty places are filled from the tables';
  else
    raise notice 'FAIL I2: an empty place could not be filled';
  end if;

  -- =================================================================
  -- V. A club proposes its own ground
  -- =================================================================
  select id into v_ver from public.competition_match_verifications where match_id = v_m1 and club_id = v_club_a;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  begin
    perform public.respond_competition_match(v_ver, 'change_requested', 'Our other ground', null, null, v_venue_b, null);
    raise notice 'FAIL V1: a club proposed another club''s ground';
  exception when check_violation then
    raise notice 'PASS V1: a club cannot propose another club''s ground';
  end;
  perform public.respond_competition_match(v_ver, 'change_requested', 'Pitch 1 please', v_day + 1, '10:30', v_venue_a, v_pitch_a);
  reset role;
  if exists (select 1 from public.competition_match_verifications where id = v_ver and status = 'change_requested' and proposed_venue_id = v_venue_a and proposed_pitch_id = v_pitch_a and proposed_date = v_day + 1) then
    raise notice 'PASS V2: a club proposes its own ground, pitch, date and kick-off';
  else
    raise notice 'FAIL V2: the proposal was not stored';
  end if;

  -- =================================================================
  -- R. The organiser's result reaches the club's fixture
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  perform public.issue_competition_matches(v_edition, array[v_m1]);
  reset role;
  select id into v_ver from public.competition_match_verifications where match_id = v_m1 and club_id = v_club_a;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
  perform public.respond_competition_match(v_ver, 'confirmed');
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  perform public.record_competition_match_result(v_m1, 24, 12);
  reset role;
  select fixture_id into v_fixture from public.competition_match_fixtures where match_id = v_m1;
  if v_fixture is not null and exists (select 1 from public.fixtures where id = v_fixture and home_score = 24 and away_score = 12 and owning_team_id = v_team_a)
     and (select status || '|' || result_source from public.competition_matches where id = v_m1) = 'completed|organiser' then
    raise notice 'PASS R: the organiser''s result is the competition result, and the club''s linked fixture shows it';
  else
    raise notice 'FAIL R: fixture=% -- the result did not reach the linked fixture', v_fixture;
  end if;
end $$;

rollback;
