-- FIND A FIXTURE -- GAME WEEK: find_fixture_candidate_game_week_batch (20270563000000).
--
-- Proves the Monday-Sunday boundary is exact in both directions, that only real fixtures/competition
-- matches count (never training, club events or pending requests -- Section A9's own source-narrowing),
-- that a cancelled fixture never counts, and that authority is checked per team with no widening,
-- exactly like every other batched Find a Fixture RPC.
--
-- Self-seeding and rolled back. No persistent review identity is touched.
\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_a_coach uuid := gen_random_uuid();
  v_a_u12_only uuid := gen_random_uuid();
  v_c_coach uuid := gen_random_uuid();
  v_person uuid;
  v_dir_a uuid; v_dir_b uuid; v_dir_c uuid;
  v_club_a uuid; v_club_b uuid; v_club_c uuid;
  v_mem_a_full uuid; v_mem_a_u12 uuid; v_mem_c_coach uuid;
  v_team_a_u12 uuid; v_team_a_u16 uuid;
  v_team_b_u12 uuid;
  v_team_c_u12 uuid;
  v_type_union_u12 uuid; v_type_union_u16 uuid; v_type_league_u12 uuid;
  -- The requested Sunday, its enclosing Monday-Sunday week's Friday (same week), the PRECEDING Sunday
  -- (a different week entirely) and the FOLLOWING Monday (also a different week).
  v_sunday date := date_trunc('week', current_date + 30)::date + 6;
  v_friday_same_week date;
  v_preceding_sunday date;
  v_following_monday date;
  v_n int;
begin
  v_friday_same_week := v_sunday - 2;
  v_preceding_sunday := v_sunday - 7;
  v_following_monday := v_sunday + 1;

  foreach v_person in array array[v_a_coach, v_a_u12_only, v_c_coach] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'ffgw-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Find', 'Fixture', 'ffgw-' || v_person::text || '@ovalball.test', (current_date - interval '40 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FFGW A RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ffgw-a-' || v_tag)
  returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FFGW B RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ffgw-b-' || v_tag)
  returning id into v_dir_b;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FFGW C RL ' || v_tag, 'T', 'T', 'league', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ffgw-c-' || v_tag)
  returning id into v_dir_c;

  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'ffgw-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'ffgw-b-' || v_tag, 'active') returning id into v_club_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c, 'ffgw-c-' || v_tag, 'active') returning id into v_club_c;

  select id into v_type_union_u12 from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  select id into v_type_union_u16 from public.canonical_team_types_by_code where rugby_code='union' and key='u16' and is_offered limit 1;
  select id into v_type_league_u12 from public.canonical_team_types_by_code where rugby_code='league' and key='u12' and is_offered limit 1;

  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_a, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_union_u12, true) returning id into v_team_a_u12;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_a, 'Under 16 Boys', 'youth', 'U16', 'union', 'boys', v_type_union_u16, true) returning id into v_team_a_u16;

  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_b, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_union_u12, true) returning id into v_team_b_u12;

  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_c, 'Under 12s', 'youth', 'U12', 'league', 'boys', v_type_league_u12, true) returning id into v_team_c_u12;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_coach, 'BASIC_USER', 'active') returning id into v_mem_a_full;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_u12_only, 'BASIC_USER', 'active') returning id into v_mem_a_u12;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_c, v_c_coach, 'BASIC_USER', 'active') returning id into v_mem_c_coach;

  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_a_full, v_team_a_u12, 'coach');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_a_full, v_team_a_u16, 'coach');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_a_u12, v_team_a_u12, 'coach');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_c_coach, v_team_c_u12, 'coach');

  -- Club A <-> Club B: ACTIVE partnership (find_fixture_candidate_game_week_batch requires it, same as
  -- the exact-date function).
  insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by)
  values (v_club_a, v_club_b, 'active', v_a_coach);

  -- Club B's U12 team: a real Friday fixture in the SAME week as the requested Sunday (must count), a
  -- fixture the PRECEDING Sunday (a different week, must not count), a fixture the FOLLOWING Monday (a
  -- different week, must not count), and a CANCELLED fixture ON the requested Sunday itself (must not
  -- count -- proving cancellation is honoured even inside the widened range).
  insert into public.fixtures (owning_team_id, kickoff_date, status, home_away, raw_opposition_text)
  values
    (v_team_b_u12, v_friday_same_week, 'Booked', 'Home', 'Friday night fixture'),
    (v_team_b_u12, v_preceding_sunday, 'Booked', 'Away', 'Previous week fixture'),
    (v_team_b_u12, v_following_monday, 'Booked', 'Home', 'Next week fixture'),
    (v_team_b_u12, v_sunday, 'Cancelled', 'Home', 'Cancelled fixture on the requested day itself');

  -- A training session for Club B's U12 team, also in the same week -- must NEVER count (Section A9:
  -- training is not "the team already has a game this week").
  insert into public.training_sessions (club_id, team_id, session_date)
  values (v_club_b, v_team_b_u12, v_friday_same_week + 1);

  -- =====================================================================
  -- THE REAL SEARCH, as Club A's fully-authorised coach, requesting only the Sunday.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_coach);

  select count(*) into v_n from public.find_fixture_candidate_game_week_batch(array[v_team_a_u12], array[v_sunday])
    where opponent_team_id = v_team_b_u12 and commitment_date = v_friday_same_week;
  perform pg_temp.check(v_n = 1, 'W1 a real fixture on the Friday of the SAME Monday-Sunday week as the requested Sunday is surfaced');

  select count(*) into v_n from public.find_fixture_candidate_game_week_batch(array[v_team_a_u12], array[v_sunday])
    where opponent_team_id = v_team_b_u12 and commitment_date = v_preceding_sunday;
  perform pg_temp.check(v_n = 0, 'W2 a fixture on the PRECEDING Sunday (a different game week) is never surfaced');

  select count(*) into v_n from public.find_fixture_candidate_game_week_batch(array[v_team_a_u12], array[v_sunday])
    where opponent_team_id = v_team_b_u12 and commitment_date = v_following_monday;
  perform pg_temp.check(v_n = 0, 'W3 a fixture on the FOLLOWING Monday (a different game week) is never surfaced');

  select count(*) into v_n from public.find_fixture_candidate_game_week_batch(array[v_team_a_u12], array[v_sunday])
    where opponent_team_id = v_team_b_u12 and commitment_date = v_sunday;
  perform pg_temp.check(v_n = 0, 'W4 a CANCELLED fixture never counts, even on the exact requested day, even inside the widened range');

  select count(*) into v_n from public.find_fixture_candidate_game_week_batch(array[v_team_a_u12], array[v_sunday])
    where opponent_team_id = v_team_b_u12 and commitment_date = v_friday_same_week + 1;
  perform pg_temp.check(v_n = 0, 'W5 a training session in the same week is never surfaced -- only real fixtures/competition matches count (source narrowing)');

  -- Selecting the MONDAY of the same week must find the identical Friday commitment (proves the range
  -- is the whole week, not merely "backwards from the selected day").
  select count(*) into v_n from public.find_fixture_candidate_game_week_batch(array[v_team_a_u12], array[v_sunday - 6])
    where opponent_team_id = v_team_b_u12 and commitment_date = v_friday_same_week;
  perform pg_temp.check(v_n = 1, 'W6 selecting the MONDAY of the same week finds the identical Friday commitment');

  select count(*) into v_n from public.find_fixture_candidate_game_week_batch(array[v_team_a_u12], array[v_sunday])
    where opponent_team_id = v_team_c_u12;
  perform pg_temp.check(v_n = 0, 'W7 Club C''s League team never appears -- Union/League isolation holds here too');

  -- =====================================================================
  -- NO AUTHORITY WIDENING, same rule as every other batched RPC.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_u12_only);
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_game_week_batch(array[%L, %L]::uuid[], array[%L]::date[])', v_team_a_u12, v_team_a_u16, v_sunday)) = '42501',
    'A1 a coach authorised on the U12 team only is refused for a batch that also names the U16 team');
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_game_week_batch(array[%L]::uuid[], array[%L]::date[])', v_team_a_u12, v_sunday)) = 'OK',
    'A2 the same coach succeeds for a batch naming only the team they hold authority over');

  perform pg_temp.act('authenticated', v_c_coach);
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_game_week_batch(array[%L]::uuid[], array[%L]::date[])', v_team_a_u12, v_sunday)) = '42501',
    'X1 Club C''s own coach cannot search on Club A''s team''s behalf by naming its id');

  perform pg_temp.check(
    (select array_to_string(proargnames, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'find_fixture_candidate_game_week_batch')
      = 'p_team_ids,p_dates,my_team_id,opponent_team_id,commitment_date',
    'P1 find_fixture_candidate_game_week_batch returns exactly my_team_id, opponent_team_id, commitment_date');

  perform pg_temp.act_postgres();
end $$;

rollback;
