-- Publishing a staged fixture row (20270304000000).
--
-- Proved as a Fixture Secretary, on data this suite creates itself:
--   A. an Ovalball opponent is ASKED -- a sent fixture request, no fixture;
--   B. an external opponent is recorded as a fixture, home/away and meet time kept;
--   C. a source reference is recorded (it used to break publishing);
--   D. an 'update' row updates the named fixture instead of inserting one;
--   E. a conflict needs a decision; keep_existing excludes the row;
--   F. replacing a fixture another club owns is refused and cancels nothing;
--   G. a row whose venue belongs to another club is refused;
--   H. an Ovalball club named without one of their teams is refused, not booked;
--   I. an away row's proposed ground travels on the request, and accepting books
--      the fixture there -- the host's venue record when it names one, else the
--      ground as text (20270310000000).
--
-- Self-seeding and rolled back, so it runs on an empty database after a clean boot.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_secretary uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_dir uuid; v_club uuid; v_other_dir uuid; v_other_club uuid; v_ext_dir uuid;
  v_season uuid;
  v_team uuid; v_team_b uuid; v_other_team uuid;
  v_other_venue uuid; v_other_pitch uuid;
  v_batch uuid; v_row uuid; v_result uuid; v_fixture uuid;
  v_existing uuid; v_theirs uuid;
  n integer;
  v_status text;
begin
  for v_row in select unnest(array[v_secretary, v_other_admin]) loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_row, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fpub-' || v_row::text || '@ovalball.test', '',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email) values (v_row, 'Fpub', 'Tester', 'fpub-' || v_row::text || '@ovalball.test') on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FPUB Home RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'fpub-home-' || v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'fpub-home-' || v_tag, 'active') returning id into v_club;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FPUB Ovalball Opp RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'fpub-opp-' || v_tag) returning id into v_other_dir;
  insert into public.clubs (directory_id, slug, status) values (v_other_dir, 'fpub-opp-' || v_tag, 'active') returning id into v_other_club;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FPUB External RFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'fpub-ext-' || v_tag) returning id into v_ext_dir;

  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('FPUB Union ' || v_tag, current_date - 30, current_date + 300, 'union', (select greatest(2100, coalesce(max(s.season_year_start), 2099) + 1) from public.seasons s where s.season_year_start >= 2100), 'fpub-' || v_tag) returning id into v_season;
  end if;

  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'fpub-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 13 Boys', 'fpub-u13-' || v_tag, 'youth', 'U13', 'boys', 'union', true) returning id into v_team_b;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_other_club, 'Under 12 Boys', 'fpub-opp-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_other_team;
  insert into public.venues (club_id, name, slug, active) values (v_other_club, 'FPUB Their Ground ' || v_tag, 'fpub-their-ground-' || v_tag, true) returning id into v_other_venue;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values (v_other_club, v_other_venue, 'FPUB Pitch 3', true) returning id into v_other_pitch;

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club, v_secretary, 'FIXTURE_SECRETARY', 'active'),
    (v_other_club, v_other_admin, 'CLUB_ADMIN', 'active');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
  values (v_secretary, 'fpub suite', 8, 'processing', v_club) returning id into v_batch;

  -- =================================================================
  -- A. Ovalball opponent: asked, not booked
  -- =================================================================
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, errors, resolved_home_team_id, resolved_away_team_id, raw_opposition_text, fixture_date, kickoff_time, home_away, notes)
  values (v_batch, 1, '{}'::jsonb, 'ready', '[]'::jsonb, v_team, v_other_team, 'FPUB Ovalball Opp RUFC', current_date + 20, '10:30', 'Away', 'fpub-A-' || v_tag)
  returning id into v_row;
  v_result := public.publish_import_row(v_row);
  reset role;

  select count(*) into n from public.fixtures where notes = 'fpub-A-' || v_tag;
  if n = 0 and exists (
    select 1 from public.fixture_requests r join public.fixture_request_groups g on g.id = r.group_id
    where r.id = v_result and r.status = 'sent' and r.requesting_team_id = v_team and r.target_team_id = v_other_team
      and r.venue_preference = 'away' and g.opponent_club_id = v_other_club and g.proposed_date = current_date + 20
  ) and (select published_request_id from public.fixture_import_rows where id = v_row) = v_result then
    raise notice 'PASS A: an Ovalball opponent receives a sent fixture request, and no fixture is booked';
  else
    raise notice 'FAIL A: fixtures=% result=% -- the Ovalball opponent was not asked correctly', n, v_result;
  end if;

  -- =================================================================
  -- B + C. External opponent recorded, with a source reference
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, errors, resolved_home_team_id, resolved_away_directory_id, raw_opposition_text, fixture_date, kickoff_time, meet_time, home_away, notes, source_reference)
  values (v_batch, 2, '{}'::jsonb, 'ready', '[]'::jsonb, v_team, v_ext_dir, 'FPUB External RFC', current_date + 27, '11:00', '10:15', 'Away', 'fpub-B-' || v_tag, 'fpub-ref-' || v_tag)
  returning id into v_row;
  begin
    v_result := public.publish_import_row(v_row);
  exception when others then
    v_result := null;
    raise notice 'FAIL B: publishing an external row raised: %', sqlerrm;
  end;
  reset role;
  if exists (select 1 from public.fixtures where id = v_result and home_away = 'Away' and meet_time = '10:15' and opponent_directory_id = v_ext_dir and opponent_team_id is null) then
    raise notice 'PASS B: an external opponent is recorded as a fixture, Away with its meet time';
  else
    raise notice 'FAIL B: the external fixture was not recorded as staged';
  end if;
  if exists (select 1 from public.fixture_source_refs where fixture_id = v_result and source_id = 'fpub-ref-' || v_tag) then
    raise notice 'PASS C: the source reference is recorded instead of breaking publication';
  else
    raise notice 'FAIL C: no source reference row';
  end if;

  -- =================================================================
  -- D. Update path
  -- =================================================================
  v_existing := v_result;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, errors, matched_fixture_id, fixture_date, kickoff_time, notes)
  values (v_batch, 3, '{}'::jsonb, 'update', '[]'::jsonb, v_existing, current_date + 28, '13:00', 'fpub-D-' || v_tag)
  returning id into v_row;
  v_result := public.publish_import_row(v_row);
  reset role;
  select count(*) into n from public.fixtures where notes in ('fpub-B-' || v_tag, 'fpub-D-' || v_tag);
  if v_result = v_existing and n = 1 and exists (select 1 from public.fixtures where id = v_existing and kickoff_date = current_date + 28 and kickoff_time = '13:00') then
    raise notice 'PASS D: an update row changes the named fixture in place and inserts nothing';
  else
    raise notice 'FAIL D: update row result=% rows=%', v_result, n;
  end if;

  -- =================================================================
  -- E. Conflict needs a decision; keep_existing excludes
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, errors, resolved_home_team_id, resolved_away_directory_id, raw_opposition_text, fixture_date, conflicting_fixture_id)
  values (v_batch, 4, '{}'::jsonb, 'conflict', '[]'::jsonb, v_team, v_ext_dir, 'FPUB External RFC', current_date + 28, v_existing)
  returning id into v_row;
  begin
    perform public.publish_import_row(v_row);
    raise notice 'FAIL E1: a conflict published without a decision';
  exception when others then
    raise notice 'PASS E1: a conflict without a decision is refused';
  end;
  update public.fixture_import_rows set conflict_decision = 'keep_existing' where id = v_row;
  v_result := public.publish_import_row(v_row);
  select status into v_status from public.fixture_import_rows where id = v_row;
  reset role;
  if v_result is null and v_status = 'excluded' and (select status from public.fixtures where id = v_existing) <> 'Cancelled' then
    raise notice 'PASS E2: keep_existing excludes the row and leaves the existing fixture alone';
  else
    raise notice 'FAIL E2: keep_existing result=% status=%', v_result, v_status;
  end if;

  -- =================================================================
  -- F. Another club's fixture is never replaced from here
  -- =================================================================
  insert into public.fixtures (owning_team_id, home_away, opponent_team_id, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values (v_other_team, 'Home', v_team, 'FPUB Home RUFC', current_date + 35, '10:00', 'Booked', 'club_created') returning id into v_theirs;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, errors, resolved_home_team_id, resolved_away_directory_id, raw_opposition_text, fixture_date, conflicting_fixture_id, conflict_decision)
  values (v_batch, 5, '{}'::jsonb, 'conflict', '[]'::jsonb, v_team, v_ext_dir, 'FPUB External RFC', current_date + 35, v_theirs, 'replace_and_notify')
  returning id into v_row;
  begin
    perform public.publish_import_row(v_row);
    raise notice 'FAIL F: a replace decision cancelled another club''s fixture';
  exception when insufficient_privilege then
    raise notice 'PASS F: replacing a fixture another club owns is refused';
  end;
  reset role;
  if (select status from public.fixtures where id = v_theirs) = 'Booked' then
    raise notice 'PASS F2: the other club''s fixture is untouched';
  else
    raise notice 'FAIL F2: the other club''s fixture was changed';
  end if;

  -- =================================================================
  -- G. A venue that belongs to another club
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, errors, resolved_home_team_id, resolved_away_directory_id, raw_opposition_text, fixture_date, resolved_venue_id)
  values (v_batch, 6, '{}'::jsonb, 'ready', '[]'::jsonb, v_team, v_ext_dir, 'FPUB External RFC', current_date + 42, v_other_venue)
  returning id into v_row;
  begin
    perform public.publish_import_row(v_row);
    raise notice 'FAIL G: a row with another club''s venue was published';
  exception when check_violation then
    raise notice 'PASS G: a row whose venue belongs to another club is refused';
  end;
  reset role;

  -- =================================================================
  -- H. An Ovalball club named without one of their teams is not booked
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, errors, resolved_home_team_id, resolved_away_directory_id, raw_opposition_text, fixture_date, notes)
  values (v_batch, 7, '{}'::jsonb, 'ready', '[]'::jsonb, v_team, v_other_dir, 'FPUB Ovalball Opp RUFC', current_date + 49, 'fpub-H-' || v_tag)
  returning id into v_row;
  begin
    perform public.publish_import_row(v_row);
    raise notice 'FAIL H: an Ovalball club was booked without being asked';
  exception when check_violation then
    raise notice 'PASS H: an Ovalball club named without a team of theirs is refused, not booked';
  end;
  reset role;
  -- =================================================================
  -- I. An away row's proposed ground is put to the host, then kept
  -- =================================================================
  if exists (select 1 from public.fixture_requests where proposed_ground is null and id = (select published_request_id from public.fixture_import_rows where batch_id = v_batch and row_number = 1)) then
    raise notice 'PASS I1: a row with no ground proposes none';
  else
    raise notice 'FAIL I1: a ground was proposed that nobody chose';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, errors, resolved_home_team_id, resolved_away_team_id, raw_opposition_text, fixture_date, kickoff_time, home_away, resolved_venue_text, resolved_pitch_text, notes)
  values (v_batch, 8, '{}'::jsonb, 'ready', '[]'::jsonb, v_team, v_other_team, 'FPUB Ovalball Opp RUFC', current_date + 56, '10:30', 'Away', upper('FPUB Their Ground ' || v_tag), 'fpub pitch 3', 'fpub-I2-' || v_tag)
  returning id into v_row;
  v_result := public.publish_import_row(v_row);
  reset role;
  if (select proposed_ground || '|' || proposed_pitch from public.fixture_requests where id = v_result) = upper('FPUB Their Ground ' || v_tag) || '|fpub pitch 3' then
    raise notice 'PASS I2: the proposed away ground and pitch travel on the request to the host';
  else
    raise notice 'FAIL I2: the proposed ground was not carried on the request';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_admin::text, 'role', 'authenticated')::text, true);
  v_fixture := public.accept_fixture_request(v_result, null);
  reset role;
  if exists (select 1 from public.fixtures where id = v_fixture and home_away = 'Away' and venue_id = v_other_venue and pitch_id = v_other_pitch and venue_address is null) then
    raise notice 'PASS I3: accepting books the fixture at the host''s own venue and pitch records that the proposal names';
  else
    raise notice 'FAIL I3: the accepted fixture is not at the host''s named venue';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, errors, resolved_home_team_id, resolved_away_team_id, raw_opposition_text, fixture_date, kickoff_time, home_away, resolved_venue_text, resolved_pitch_text, notes)
  values (v_batch, 9, '{}'::jsonb, 'ready', '[]'::jsonb, v_team, v_other_team, 'FPUB Ovalball Opp RUFC', current_date + 63, '10:30', 'Away', '  FPUB Neutral Park ' || v_tag || ' ', 'Back Field', 'fpub-I4-' || v_tag)
  returning id into v_row;
  v_result := public.publish_import_row(v_row);
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_admin::text, 'role', 'authenticated')::text, true);
  v_fixture := public.accept_fixture_request(v_result, null);
  reset role;
  if exists (select 1 from public.fixtures where id = v_fixture and venue_id is null and venue_address = 'FPUB Neutral Park ' || v_tag || ', Back Field') then
    raise notice 'PASS I4: a ground that is not one of the host''s venues is kept as the ground''s text';
  else
    raise notice 'FAIL I4: the proposed ground was lost on acceptance';
  end if;
end $$;

rollback;
