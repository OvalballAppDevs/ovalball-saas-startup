-- ONE FIXTURE EDITOR (20270308000000).
--
-- What each person may change on one fixture, asked once
-- (public.fixture_editable_fields) and enforced by the writing functions:
--
--   A. a Fixture Secretary with no team permission can edit the fixture's type,
--      status, notes and home/away -- the direct table writes refused them;
--   B. TBD becomes Home or Away; swapping a played fixture swaps its scores;
--   C. the opponent side's coach may change the schedule (a proposal, as today)
--      but not the owning club's details; an unrelated member may change nothing;
--   D. every "editable" answer agrees with what the write actually allows;
--   E. Cancelled is refused here (Cancel Fixture tells people why);
--   F. an Ovalball opponent is told when the side of their fixture changes;
--   G. a competition-scheduled fixture reports its controlled fields as locked,
--      naming the competition;
--   I. an Ovalball opponent is ASKED to confirm their team for an existing
--      fixture, and accepting completes that fixture -- never a second one;
--   J. the result is editable exactly when submit_fixture_result would accept it.
--
-- Self-seeding and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_secretary uuid := gen_random_uuid();
  v_coach_a uuid := gen_random_uuid();
  v_coach_b uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_site uuid := gen_random_uuid();
  v_person uuid;
  v_dir_a uuid; v_dir_b uuid; v_dir_x uuid;
  v_club_a uuid; v_club_b uuid; v_club_x uuid;
  v_team_a uuid; v_team_b uuid;
  v_season uuid;
  v_fixture uuid;
  v_fields jsonb;
  v_ok boolean;
  v_result record;
  v_edition uuid; v_stage uuid; v_pa uuid := gen_random_uuid(); v_pb uuid := gen_random_uuid(); v_match uuid := gen_random_uuid();
  v_linked uuid;
  v_asked uuid;
  v_request uuid;
  v_team_x uuid;
  v_before integer;
begin
  foreach v_person in array array[v_secretary, v_coach_a, v_coach_b, v_outsider, v_site] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fed-' || v_person::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_person, 'Fed', 'Tester', 'fed-' || v_person::text || '@ovalball.test') on conflict (id) do nothing;
  end loop;
  insert into public.site_admins (user_id, status, admin_role) values (v_site, 'active', 'full');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FED Alpha RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'fed-a-' || v_tag) returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FED Bravo RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'fed-b-' || v_tag) returning id into v_dir_b;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FED Xray RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'fed-x-' || v_tag) returning id into v_dir_x;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'fed-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'fed-b-' || v_tag, 'active') returning id into v_club_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_x, 'fed-x-' || v_tag, 'active') returning id into v_club_x;

  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('FED Union ' || v_tag, current_date - 30, current_date + 300, 'union', (select greatest(2100, coalesce(max(s.season_year_start), 2099) + 1) from public.seasons s where s.season_year_start >= 2100), 'fed-' || v_tag) returning id into v_season;
  end if;

  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active) values (v_club_a, 'Under 12 Boys', 'fed-a-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_a;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active) values (v_club_b, 'Under 12 Boys', 'fed-b-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_b;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club_a, v_secretary, 'FIXTURE_SECRETARY', 'active'),
    (v_club_a, v_coach_a, 'BASIC_USER', 'active'),
    (v_club_b, v_coach_b, 'BASIC_USER', 'active'),
    (v_club_x, v_outsider, 'CLUB_ADMIN', 'active');
  insert into public.team_permissions (membership_id, team_id, permission)
  select cm.id, x.team_id, 'coach' from (values (v_coach_a, v_team_a, v_club_a), (v_coach_b, v_team_b, v_club_b)) x(user_id, team_id, club_id)
  join public.club_memberships cm on cm.user_id = x.user_id and cm.club_id = x.club_id;

  insert into public.fixtures (owning_team_id, home_away, opponent_team_id, raw_opposition_text, kickoff_date, kickoff_time, status, source, home_score, away_score)
  values (v_team_a, 'TBD', v_team_b, 'FED Bravo RUFC', current_date + 14, '10:30', 'Planned', 'club_created', null, null)
  returning id into v_fixture;

  -- =================================================================
  -- A + B. The Fixture Secretary edits details and turns TBD into Home
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  v_fields := public.fixture_editable_fields(v_fixture);
  begin
    perform public.update_fixture_details(v_fixture, jsonb_build_object('game_type', 'Friendly', 'status', 'Booked', 'notes', 'Bring both kits', 'home_away', 'Home'));
    v_ok := true;
  exception when others then
    v_ok := false;
    raise notice 'FAIL A: the Fixture Secretary could not edit details: %', sqlerrm;
  end;
  reset role;
  if v_ok and (v_fields->'details'->>'editable')::boolean and (v_fields->'homeAway'->>'editable')::boolean
     and exists (select 1 from public.fixtures where id = v_fixture and game_type = 'Friendly' and status = 'Booked' and notes = 'Bring both kits' and home_away = 'Home') then
    raise notice 'PASS A: a Fixture Secretary with no team permission edits type, status, notes and home/away';
    raise notice 'PASS B1: a TBD fixture becomes Home';
  else
    raise notice 'FAIL A/B1: editable=% saved=%', v_fields->'details', v_ok;
  end if;

  update public.fixtures set home_score = 20, away_score = 5, result_status = 'external_recorded' where id = v_fixture;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  perform public.update_fixture_details(v_fixture, jsonb_build_object('home_away', 'Away'));
  reset role;
  if exists (select 1 from public.fixtures where id = v_fixture and home_away = 'Away' and home_score = 5 and away_score = 20) then
    raise notice 'PASS B2: swapping a played fixture from Home to Away swaps its scores with it';
  else
    raise notice 'FAIL B2: scores did not follow the swap';
  end if;
  update public.fixtures set home_score = null, away_score = null, result_status = 'none' where id = v_fixture;

  if exists (select 1 from public.notifications where type = 'fixture_details_changed' and user_id = v_coach_b and data->>'fixture_id' = v_fixture::text) then
    raise notice 'PASS F: the Ovalball opponent''s coach is told the fixture changed sides';
  else
    raise notice 'FAIL F: no notification reached the opponent';
  end if;
  if exists (select 1 from public.notifications where type = 'fixture_details_changed' and user_id = v_coach_b and data->>'fixture_id' = v_fixture::text and body like '%FED Alpha RUFC%') then
    raise notice 'PASS F2: the opponent''s notification names the club that changed it, not themselves';
  else
    raise notice 'FAIL F2: notification body = %', (select body from public.notifications where type = 'fixture_details_changed' and user_id = v_coach_b limit 1);
  end if;

  -- H. An away ground at a club not on Ovalball is recorded as text; a home fixture cannot take one.
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_a, 'Away', 'Nowhere Vale RFC', current_date + 21, '10:30', 'Planned', 'club_created') returning id into v_linked;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  perform public.update_fixture_details(v_linked, jsonb_build_object('venue_text', 'Vale Park'));
  begin
    perform public.update_fixture_details(v_fixture, jsonb_build_object('home_away', 'Home', 'venue_text', 'Somewhere'));
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  reset role;
  if not v_ok and exists (select 1 from public.fixtures where id = v_linked and venue_address = 'Vale Park') then
    raise notice 'PASS H: an external away ground is kept as text, and a home fixture refuses one';
  else
    raise notice 'FAIL H: ok=% address=%', v_ok, (select venue_address from public.fixtures where id = v_linked);
  end if;
  v_linked := null;

  -- I. Asking an Ovalball opponent to confirm their team.
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active) values (v_club_x, 'Under 12 Boys', 'fed-x-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team_x;
  insert into public.fixtures (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_team_a, 'Home', v_dir_b, 'FED Bravo RUFC', current_date + 30, '10:30', 'Planned', 'club_created') returning id into v_asked;
  select count(*) into v_before from public.fixtures where owning_team_id = v_team_a;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  begin
    perform public.ask_opponent_to_confirm_team(v_asked, v_team_x);
    raise notice 'FAIL I1: a team at a different club was asked for';
  exception when check_violation then
    raise notice 'PASS I1: only a team at the fixture''s own opposition club can be asked for';
  end;
  v_request := public.ask_opponent_to_confirm_team(v_asked, v_team_b);
  begin
    perform public.ask_opponent_to_confirm_team(v_asked, v_team_b);
    raise notice 'FAIL I2: the same fixture was asked about twice';
  exception when unique_violation then
    raise notice 'PASS I2: one open question per fixture';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach_b::text, 'role', 'authenticated')::text, true);
  perform public.accept_fixture_request(v_request, null);
  reset role;
  if exists (select 1 from public.fixtures where id = v_asked and opponent_team_id = v_team_b)
     and (select count(*) from public.fixtures where owning_team_id = v_team_a) = v_before then
    raise notice 'PASS I3: accepting sets their team on the existing fixture, and creates no second fixture';
  else
    raise notice 'FAIL I3: team=% fixtures % -> %', (select opponent_team_id from public.fixtures where id = v_asked), v_before, (select count(*) from public.fixtures where owning_team_id = v_team_a);
  end if;
  if (select resulting_fixture_id from public.fixture_requests where id = v_request) = v_asked then
    raise notice 'PASS I4: the request records the fixture it completed';
  else
    raise notice 'FAIL I4: the request points elsewhere';
  end if;

  -- J. Result authority agrees with submit_fixture_result.
  update public.fixtures set kickoff_date = current_date - 2 where id = v_asked;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  v_fields := public.fixture_editable_fields(v_fixture);
  if not (v_fields->'result'->>'editable')::boolean and (v_fields->'result'->>'reason') like '%kicked off%' then
    raise notice 'PASS J1: a future fixture''s result is locked until kick-off, and says so';
  else
    raise notice 'FAIL J1: future result field = %', v_fields->'result';
  end if;
  v_fields := public.fixture_editable_fields(v_asked);
  begin
    perform public.submit_fixture_result(v_asked, 24, 12);
    v_ok := true;
  exception when others then
    v_ok := false;
  end;
  reset role;
  if (v_fields->'result'->>'editable')::boolean and v_ok then
    raise notice 'PASS J2: a played fixture''s result is editable, and the writer accepts it';
  else
    raise notice 'FAIL J2: result field = %, saved = %', v_fields->'result', v_ok;
  end if;

  -- =================================================================
  -- C + D. The answer agrees with the writers
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach_b::text, 'role', 'authenticated')::text, true);
  v_fields := public.fixture_editable_fields(v_fixture);
  if (v_fields->'schedule'->>'editable')::boolean and not (v_fields->'details'->>'editable')::boolean
     and not (v_fields->'opposition'->>'editable')::boolean and not (v_fields->'competition'->>'editable')::boolean then
    raise notice 'PASS C1: the opponent side''s coach may change the schedule, not the owning club''s details, opposition or competition';
  else
    raise notice 'FAIL C1: opponent coach fields = %', v_fields;
  end if;
  begin
    perform public.update_fixture_details(v_fixture, jsonb_build_object('notes', 'mine now'));
    raise notice 'FAIL D1: the opponent coach wrote details the editor said were locked';
  exception when insufficient_privilege then
    raise notice 'PASS D1: a locked "details" answer is exactly what update_fixture_details enforces';
  end;
  begin
    perform public.update_fixture_meet_time(v_fixture, '09:45');
    raise notice 'PASS D2: an editable "meet time" answer is exactly what update_fixture_meet_time allows';
  exception when others then
    raise notice 'FAIL D2: meet time was reported editable but refused: %', sqlerrm;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider::text, 'role', 'authenticated')::text, true);
  v_fields := public.fixture_editable_fields(v_fixture);
  select bool_or((value->>'editable')::boolean) into v_ok from jsonb_each(v_fields) where jsonb_typeof(value) = 'object';
  begin
    perform public.update_fixture_details(v_fixture, jsonb_build_object('notes', 'x'));
    v_ok := true;
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.update_fixture_meet_time(v_fixture, '09:30');
    v_ok := true;
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  if not coalesce(v_ok, false) then
    raise notice 'PASS C2: an unrelated club administrator may change nothing, and every write agrees';
  else
    raise notice 'FAIL C2: an unrelated person could edit';
  end if;

  -- =================================================================
  -- E. Cancelled is not a status you set here
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach_a::text, 'role', 'authenticated')::text, true);
  begin
    perform public.update_fixture_details(v_fixture, jsonb_build_object('status', 'Cancelled'));
    raise notice 'FAIL E: a fixture was cancelled without a reason through the details editor';
  exception when check_violation then
    raise notice 'PASS E: setting Cancelled is refused; Cancel Fixture is the route that tells people why';
  end;
  reset role;

  -- =================================================================
  -- G. A competition-scheduled fixture
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  select * into v_result from public.quick_create_competition('FED Cup ' || v_tag, 'union');
  v_edition := v_result.edition_id;
  perform public.save_competition_participants(v_edition, jsonb_build_array(
    jsonb_build_object('id', v_pa, 'slot', 1, 'club_directory_id', v_dir_a, 'club_id', v_club_a, 'team_id', v_team_a),
    jsonb_build_object('id', v_pb, 'slot', 2, 'club_directory_id', v_dir_b)));
  v_stage := public.save_competition_stage(v_edition, null, 'league', 'League', 1, '{}'::jsonb, null);
  perform public.replace_competition_draft_matches(v_stage, jsonb_build_array(
    jsonb_build_object('id', v_match, 'round_number', 1, 'home_participant_id', v_pa, 'away_participant_id', v_pb, 'match_date', current_date + 45, 'kickoff_time', '11:00')), null, null);
  perform public.issue_competition_matches(v_edition, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  perform public.respond_competition_match((select id from public.competition_match_verifications where match_id = v_match), 'confirmed');
  select fixture_id into v_linked from public.competition_match_fixtures where match_id = v_match;
  v_fields := public.fixture_editable_fields(v_linked);
  reset role;
  if v_linked is not null and not (v_fields->'schedule'->>'editable')::boolean and (v_fields->'schedule'->>'reason') like '%FED Cup%'
     and (v_fields->'meetTime'->>'editable')::boolean then
    raise notice 'PASS G: a competition fixture locks date and kick-off (naming the competition) and leaves the meet time with the club';
  else
    raise notice 'FAIL G: competition fixture fields = %', v_fields;
  end if;
end $$;

rollback;
