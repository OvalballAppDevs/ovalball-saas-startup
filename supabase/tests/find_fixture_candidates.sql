-- CLUBHOUSE PROGRAMME SECTION 6 -- FIND A FIXTURE: find_fixture_candidate_teams (20270557000000).
--
-- The batched form of compatible_opponent_teams. Proves the same canonical rule
-- (internal.identities_can_play_fixture) governs the batched search as the single-opponent one: rugby
-- code must match, age-fixture-band must match, own club is always excluded, a folded/archived team is
-- never a candidate, no fixture authority at all is refused, and a crafted call naming another club's
-- team is refused exactly the same way an unrelated team's would be.
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
  v_a_coach uuid := gen_random_uuid();  -- Club A: team-scoped Coach on the U12 team, no club role
  v_a_basic uuid := gen_random_uuid();  -- Club A: BASIC_USER, no team_permissions row
  v_c_coach uuid := gen_random_uuid();  -- Club C (League): team-scoped Coach, unrelated to A
  v_person uuid;
  v_dir_a uuid; v_dir_b uuid; v_dir_c uuid; v_dir_d uuid;
  v_club_a uuid; v_club_b uuid; v_club_c uuid; v_club_d uuid;
  v_mem_a_coach uuid; v_mem_a_basic uuid; v_mem_c_coach uuid;
  v_team_a_u12 uuid; v_team_a_u16 uuid;
  v_team_b_u12 uuid; v_team_b_u16 uuid;
  v_team_c_u12 uuid;
  v_team_d_folded uuid;
  v_type_union_u12 uuid; v_type_union_u16 uuid; v_type_league_u12 uuid;
  v_n int;
begin
  foreach v_person in array array[v_a_coach, v_a_basic, v_c_coach] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'ffc-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Find', 'Fixture', 'ffc-' || v_person::text || '@ovalball.test', (current_date - interval '40 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FFC A RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ffc-a-' || v_tag)
  returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FFC B RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ffc-b-' || v_tag)
  returning id into v_dir_b;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FFC C RL ' || v_tag, 'T', 'T', 'league', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ffc-c-' || v_tag)
  returning id into v_dir_c;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FFC D RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ffc-d-' || v_tag)
  returning id into v_dir_d;

  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'ffc-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'ffc-b-' || v_tag, 'active') returning id into v_club_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c, 'ffc-c-' || v_tag, 'active') returning id into v_club_c;
  insert into public.clubs (directory_id, slug, status) values (v_dir_d, 'ffc-d-' || v_tag, 'active') returning id into v_club_d;

  select id into v_type_union_u12 from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  select id into v_type_union_u16 from public.canonical_team_types_by_code where rugby_code='union' and key='u16' and is_offered limit 1;
  select id into v_type_league_u12 from public.canonical_team_types_by_code where rugby_code='league' and key='u12' and is_offered limit 1;

  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_a, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_union_u12, true) returning id into v_team_a_u12;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_a, 'Under 16 Boys', 'youth', 'U16', 'union', 'boys', v_type_union_u16, true) returning id into v_team_a_u16;

  -- COMPATIBLE: same code, same band.
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_b, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_union_u12, true) returning id into v_team_b_u12;
  -- INCOMPATIBLE AGE BAND: same club, different band -- must never appear for the U12 search either.
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_b, 'Under 16 Boys', 'youth', 'U16', 'union', 'boys', v_type_union_u16, true) returning id into v_team_b_u16;
  -- INCOMPATIBLE RUGBY CODE: League, same nominal age grade -- Union/League isolation must hold.
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_c, 'Under 12s', 'youth', 'U12', 'league', 'boys', v_type_league_u12, true) returning id into v_team_c_u12;
  -- FOLDED: same code, same band, but folded -- never a live candidate.
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active, folded_at)
  values (v_club_d, 'Under 12 Boys (folded)', 'youth', 'U12', 'union', 'boys', v_type_union_u12, true, now()) returning id into v_team_d_folded;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_coach, 'BASIC_USER', 'active') returning id into v_mem_a_coach;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_basic, 'BASIC_USER', 'active') returning id into v_mem_a_basic;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_c, v_c_coach, 'BASIC_USER', 'active') returning id into v_mem_c_coach;

  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_a_coach, v_team_a_u12, 'coach');
  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_c_coach, v_team_c_u12, 'coach');

  -- =====================================================================
  -- THE REAL SEARCH: Club A's U12 Coach finds exactly one compatible candidate team.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_coach);

  select count(*) into v_n from public.find_fixture_candidate_teams(v_team_a_u12) where team_id = v_team_b_u12;
  perform pg_temp.check(v_n = 1, 'C1 Club B''s compatible Under 12 Boys team is included');

  select count(*) into v_n from public.find_fixture_candidate_teams(v_team_a_u12) where team_id = v_team_b_u16;
  perform pg_temp.check(v_n = 0, 'C2 Club B''s incompatible Under 16 team (different age band) is excluded');

  select count(*) into v_n from public.find_fixture_candidate_teams(v_team_a_u12) where team_id = v_team_c_u12;
  perform pg_temp.check(v_n = 0, 'C3 Club C''s League Under 12 team is excluded -- Union/League isolation holds even at the same nominal age grade');

  select count(*) into v_n from public.find_fixture_candidate_teams(v_team_a_u12) where team_id = v_team_d_folded;
  perform pg_temp.check(v_n = 0, 'C4 a folded team is never a candidate, whatever its identity');

  select count(*) into v_n from public.find_fixture_candidate_teams(v_team_a_u12) where club_id = v_club_a;
  perform pg_temp.check(v_n = 0, 'C5 the searching team''s own club is always excluded, including its own Under 16 side');

  -- =====================================================================
  -- REFUSED: no fixture authority at all, even for the caller's own team.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_basic);
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_teams(%L)', v_team_a_u12)) = '42501',
    'A1 an ordinary club member with no team_permissions row is refused for their own club''s own team');

  -- =====================================================================
  -- CRAFTED CROSS-CLUB CALL: Club C's own coach cannot search as Club A's team.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_c_coach);
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_teams(%L)', v_team_a_u12)) = '42501',
    'X1 Club C''s own coach cannot search on Club A''s team''s behalf by naming its id -- they hold no fixture authority AT THAT TEAM');

  -- =====================================================================
  -- MINIMAL PAYLOAD: exactly five columns (the argument plus four result columns), nothing else.
  -- =====================================================================
  perform pg_temp.check(
    (select array_to_string(proargnames, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'find_fixture_candidate_teams')
      = 'p_team_id,team_id,club_id,display_name,age_group,gender',
    'P1 the return shape is exactly team_id, club_id, display_name, age_group, gender -- no roster, no calendar, no fixture history');

  perform pg_temp.act_postgres();
end $$;

rollback;
