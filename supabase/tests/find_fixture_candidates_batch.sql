-- CLUBHOUSE PROGRAMME -- FIND A FIXTURE FF-1.1/FF-2: find_fixture_candidate_teams_batch /
-- find_fixture_candidate_availability_batch (20270562000000).
--
-- The multi-team batched forms of find_fixture_candidate_teams / find_fixture_candidate_availability,
-- built so a caller with several of their own teams selected gets one round trip per RPC instead of one
-- per selected team. Proves: the same internal.identities_can_play_fixture rule and the same
-- active-partnership-only availability boundary hold with my_team_id threaded through every row; a
-- caller who may arrange fixtures for team A but not team B is refused for the WHOLE call when both are
-- named -- never a partial result that silently drops the team they lack authority over (no authority
-- widening, and no way to discover a missing authority by diffing what came back against what was
-- asked); a compatible-but-not-partnered club appears in the teams search but never in the availability
-- search, proving the two boundaries are genuinely independent, not the same check reused twice.
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
  v_a_full uuid := gen_random_uuid();   -- Club A: Coach on BOTH the U12 and U16 teams
  v_a_u12_only uuid := gen_random_uuid(); -- Club A: Coach on the U12 team ONLY
  v_a_basic uuid := gen_random_uuid();  -- Club A: BASIC_USER, no team_permissions row
  v_c_coach uuid := gen_random_uuid();  -- Club C (League): unrelated to A
  v_person uuid;
  v_dir_a uuid; v_dir_b uuid; v_dir_c uuid; v_dir_d uuid; v_dir_e uuid;
  v_club_a uuid; v_club_b uuid; v_club_c uuid; v_club_d uuid; v_club_e uuid;
  v_mem_a_full uuid; v_mem_a_u12 uuid; v_mem_a_basic uuid; v_mem_c_coach uuid;
  v_team_a_u12 uuid; v_team_a_u16 uuid;
  v_team_b_u12 uuid; v_team_b_u16 uuid;
  v_team_c_u12 uuid;
  v_team_d_folded uuid;
  v_team_e_u12 uuid; -- compatible with A's U12, but NEVER partnered with Club A
  v_type_union_u12 uuid; v_type_union_u16 uuid; v_type_league_u12 uuid;
  v_d1 date := current_date + 14;
  v_d2 date := current_date + 21;
  v_d3 date := current_date + 28;
  v_n int;
  v_status text;
begin
  foreach v_person in array array[v_a_full, v_a_u12_only, v_a_basic, v_c_coach] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'ffcb-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Find', 'Fixture', 'ffcb-' || v_person::text || '@ovalball.test', (current_date - interval '40 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FFCB A RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ffcb-a-' || v_tag)
  returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FFCB B RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ffcb-b-' || v_tag)
  returning id into v_dir_b;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FFCB C RL ' || v_tag, 'T', 'T', 'league', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ffcb-c-' || v_tag)
  returning id into v_dir_c;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FFCB D RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ffcb-d-' || v_tag)
  returning id into v_dir_d;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FFCB E RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ffcb-e-' || v_tag)
  returning id into v_dir_e;

  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'ffcb-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'ffcb-b-' || v_tag, 'active') returning id into v_club_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c, 'ffcb-c-' || v_tag, 'active') returning id into v_club_c;
  insert into public.clubs (directory_id, slug, status) values (v_dir_d, 'ffcb-d-' || v_tag, 'active') returning id into v_club_d;
  insert into public.clubs (directory_id, slug, status) values (v_dir_e, 'ffcb-e-' || v_tag, 'active') returning id into v_club_e;

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
  values (v_club_b, 'Under 16 Boys', 'youth', 'U16', 'union', 'boys', v_type_union_u16, true) returning id into v_team_b_u16;

  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_c, 'Under 12s', 'youth', 'U12', 'league', 'boys', v_type_league_u12, true) returning id into v_team_c_u12;

  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active, folded_at)
  values (v_club_d, 'Under 12 Boys (folded)', 'youth', 'U12', 'union', 'boys', v_type_union_u12, true, now()) returning id into v_team_d_folded;

  -- Club E: compatible age/code with A's U12, but never partnered with Club A.
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_e, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_union_u12, true) returning id into v_team_e_u12;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_full, 'BASIC_USER', 'active') returning id into v_mem_a_full;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_u12_only, 'BASIC_USER', 'active') returning id into v_mem_a_u12;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_basic, 'BASIC_USER', 'active') returning id into v_mem_a_basic;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_c, v_c_coach, 'BASIC_USER', 'active') returning id into v_mem_c_coach;

  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_a_full, v_team_a_u12, 'coach');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_a_full, v_team_a_u16, 'coach');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_a_u12, v_team_a_u12, 'coach');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_c_coach, v_team_c_u12, 'coach');

  -- Club A <-> Club B: ACTIVE partnership (governs availability, never compatibility).
  insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by)
  values (v_club_a, v_club_b, 'active', v_a_full);

  -- Club B's U12 team is busy (a real fixture) on D1; Club B's U16 team has a pending request on D2.
  insert into public.fixtures (owning_team_id, kickoff_date, status, home_away, raw_opposition_text)
  values (v_team_b_u12, v_d1, 'Booked', 'Home', 'FFCB A RUFC ' || v_tag);

  declare
    v_group uuid;
  begin
    insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
    values (v_club_a, v_club_b, 'FFCB B RUFC ' || v_tag, v_d2, v_a_full) returning id into v_group;
    insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
    values (v_group, v_team_a_u16, v_team_b_u16, 'either', 'sent', v_a_full);
  end;

  -- Club E's U12 team is ALSO busy on D1 (same shape as Club B's), but never partnered with Club A --
  -- proves the availability boundary is the partnership, not merely "has a busy row".
  insert into public.fixtures (owning_team_id, kickoff_date, status, home_away, raw_opposition_text)
  values (v_team_e_u12, v_d1, 'Booked', 'Home', 'FFCB A RUFC ' || v_tag);

  -- =====================================================================
  -- TEAMS BATCH: Club A's fully-authorised coach searches both teams in one call.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_full);

  select count(*) into v_n from public.find_fixture_candidate_teams_batch(array[v_team_a_u12, v_team_a_u16])
    where my_team_id = v_team_a_u12 and team_id = v_team_b_u12;
  perform pg_temp.check(v_n = 1, 'T1 U12 my_team_id correctly paired with Club B''s compatible U12 team');

  select count(*) into v_n from public.find_fixture_candidate_teams_batch(array[v_team_a_u12, v_team_a_u16])
    where my_team_id = v_team_a_u12 and team_id = v_team_b_u16;
  perform pg_temp.check(v_n = 0, 'T2 U12 my_team_id is never paired with Club B''s incompatible U16 team');

  select count(*) into v_n from public.find_fixture_candidate_teams_batch(array[v_team_a_u12, v_team_a_u16])
    where my_team_id = v_team_a_u16 and team_id = v_team_b_u16;
  perform pg_temp.check(v_n = 1, 'T3 U16 my_team_id correctly paired with Club B''s compatible U16 team, independent of the U12 row');

  select count(*) into v_n from public.find_fixture_candidate_teams_batch(array[v_team_a_u12, v_team_a_u16])
    where team_id = v_team_c_u12;
  perform pg_temp.check(v_n = 0, 'T4 Club C''s League team is excluded for every selected team -- Union/League isolation holds batched');

  select count(*) into v_n from public.find_fixture_candidate_teams_batch(array[v_team_a_u12, v_team_a_u16])
    where team_id = v_team_d_folded;
  perform pg_temp.check(v_n = 0, 'T5 a folded team is never a candidate, whatever my_team_id asked');

  select count(*) into v_n from public.find_fixture_candidate_teams_batch(array[v_team_a_u12, v_team_a_u16])
    where club_id = v_club_a;
  perform pg_temp.check(v_n = 0, 'T6 the searching club is always excluded from its own batched results');

  select count(*) into v_n from public.find_fixture_candidate_teams_batch(array[v_team_a_u12])
    where my_team_id = v_team_a_u12 and team_id = v_team_e_u12;
  perform pg_temp.check(v_n = 1, 'T7 a compatible club with NO partnership at all still appears in the teams search -- compatibility never requires partnership');

  -- =====================================================================
  -- NO AUTHORITY WIDENING: a coach who may arrange fixtures for the U12 team but not the U16 team is
  -- refused for the WHOLE call when both are named -- never a partial result silently missing the U16 team.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_u12_only);
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_teams_batch(array[%L, %L]::uuid[])', v_team_a_u12, v_team_a_u16)) = '42501',
    'A1 a coach authorised on the U12 team only is refused for a batch that also names the U16 team');
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_teams_batch(array[%L]::uuid[])', v_team_a_u12)) = 'OK',
    'A2 the same coach succeeds for a batch naming only the team they hold authority over');

  perform pg_temp.act('authenticated', v_a_basic);
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_teams_batch(array[%L]::uuid[])', v_team_a_u12)) = '42501',
    'A3 an ordinary club member with no team_permissions row is refused for their own club''s own team');

  perform pg_temp.act('authenticated', v_c_coach);
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_teams_batch(array[%L]::uuid[])', v_team_a_u12)) = '42501',
    'X1 Club C''s own coach cannot search on Club A''s team''s behalf by naming its id -- no fixture authority AT THAT TEAM');

  perform pg_temp.check(
    (select array_to_string(proargnames, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'find_fixture_candidate_teams_batch')
      = 'p_team_ids,my_team_id,team_id,club_id,display_name,age_group,gender',
    'P1 find_fixture_candidate_teams_batch returns exactly my_team_id, team_id, club_id, display_name, age_group, gender');

  -- =====================================================================
  -- AVAILABILITY BATCH: same authorised coach, both teams, three dates.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_full);

  select status into v_status from public.find_fixture_candidate_availability_batch(array[v_team_a_u12, v_team_a_u16], array[v_d1, v_d2, v_d3])
    where my_team_id = v_team_a_u12 and opponent_team_id = v_team_b_u12 and the_date = v_d1;
  perform pg_temp.check(v_status = 'busy', 'AV1 Club B''s U12 team is busy on D1 for the U12 my_team_id row, from a real fixture');

  select count(*) into v_n from public.find_fixture_candidate_availability_batch(array[v_team_a_u12, v_team_a_u16], array[v_d1, v_d2, v_d3])
    where my_team_id = v_team_a_u12 and opponent_team_id = v_team_b_u12 and the_date in (v_d2, v_d3);
  perform pg_temp.check(v_n = 0, 'AV2 no row for D2/D3 for that pairing -- absence means no known clash, never a fabricated status value');

  select status into v_status from public.find_fixture_candidate_availability_batch(array[v_team_a_u12, v_team_a_u16], array[v_d1, v_d2, v_d3])
    where my_team_id = v_team_a_u16 and opponent_team_id = v_team_b_u16 and the_date = v_d2;
  perform pg_temp.check(v_status = 'request_pending', 'AV3 Club B''s U16 team is request_pending on D2 for the U16 my_team_id row, from the pending fixture request');

  select count(*) into v_n from public.find_fixture_candidate_availability_batch(array[v_team_a_u12], array[v_d1])
    where opponent_team_id = v_team_e_u12;
  perform pg_temp.check(v_n = 0, 'AV4 Club E is compatible AND busy on D1, but never partnered with Club A -- excluded from availability entirely, proving the partnership boundary is independent of compatibility');

  perform pg_temp.act('authenticated', v_a_u12_only);
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_availability_batch(array[%L, %L]::uuid[], array[%L]::date[])', v_team_a_u12, v_team_a_u16, v_d1)) = '42501',
    'AV5 the same no-widening rule holds for availability: authorised on U12 only, refused when U16 is also named');

  perform pg_temp.check(
    (select array_to_string(proargnames, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'find_fixture_candidate_availability_batch')
      = 'p_team_ids,p_dates,my_team_id,opponent_team_id,the_date,status',
    'P2 find_fixture_candidate_availability_batch returns exactly my_team_id, opponent_team_id, the_date, status');

  perform pg_temp.act_postgres();
end $$;

rollback;
