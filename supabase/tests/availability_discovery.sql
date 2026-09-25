-- CLUBHOUSE PROGRAMME SECTION 7 -- AVAILABILITY DISCOVERY: team_scheduling_availability (corrected)
-- and find_fixture_candidate_availability (new), both from 20270558000000.
--
-- Proves: a team's OWN calendar is completely unchanged (specific categories); an incompatible team is
-- refused even before partnership is checked; a compatible but NON-partner team is refused (the "partners
-- only" boundary is not silently broadened); a compatible PARTNER team's day is coarsened to a single
-- 'busy' value, never the specific category, for every source (fixture, training -- including a
-- MANUAL session with no occurrence_date, a real committed competition match with no Fixture projected
-- yet, and a club-wide event); a pending request is 'request_pending', distinct from 'busy'; the batched
-- candidate search never returns a non-partner club even though it is compatible, never returns an
-- incompatible partner club, and returns exactly the blocked dates for a real compatible partner.
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
  v_a_coach uuid := gen_random_uuid();   -- Club A: team-scoped Coach on A-U12, no club role
  v_a_admin uuid := gen_random_uuid();   -- Club A: CLUB_ADMIN, sets up partnerships
  v_a_basic uuid := gen_random_uuid();   -- Club A: BASIC_USER, no team_permissions row at all
  v_b_admin uuid := gen_random_uuid();   -- Club B: CLUB_ADMIN, accepts the A<->B partnership
  v_d_admin uuid := gen_random_uuid();   -- Club D: CLUB_ADMIN, accepts the A<->D partnership
  v_person uuid;
  v_dir_a uuid; v_dir_b uuid; v_dir_c uuid; v_dir_d uuid;
  v_club_a uuid; v_club_b uuid; v_club_c uuid; v_club_d uuid;
  v_mem_a_coach uuid;
  v_team_a_u12 uuid; v_team_b_u12 uuid; v_team_c_u12 uuid; v_team_d_u16 uuid;
  v_type_u12 uuid; v_type_u16 uuid;
  v_partnership_ab uuid; v_partnership_ad uuid;
  v_season uuid;
  v_competition uuid; v_edition uuid; v_stage uuid; v_home_p uuid; v_away_p uuid; v_match uuid;
  v_group uuid; v_request uuid;
  d1 date := current_date + 7;   -- accepted fixture (B)
  d2 date := current_date + 14;  -- manual training session, occurrence_date null (B)
  d3 date := current_date + 21;  -- pending sent fixture_request, A -> B (B)
  d4 date := current_date + 28;  -- genuinely clear (B)
  d5 date := current_date + 35;  -- competition match, verification still awaiting, no Fixture yet (B)
  v_n int;
  v_status text;
begin
  foreach v_person in array array[v_a_coach, v_a_admin, v_a_basic, v_b_admin, v_d_admin] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'avail-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Avail', 'Discovery', 'avail-' || v_person::text || '@ovalball.test', (current_date - interval '40 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('AVL A RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'avl-a-' || v_tag) returning id into v_dir_a;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('AVL B RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'avl-b-' || v_tag) returning id into v_dir_b;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('AVL C RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'avl-c-' || v_tag) returning id into v_dir_c;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('AVL D RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'avl-d-' || v_tag) returning id into v_dir_d;

  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'avl-a-' || v_tag, 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'avl-b-' || v_tag, 'active') returning id into v_club_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c, 'avl-c-' || v_tag, 'active') returning id into v_club_c;
  insert into public.clubs (directory_id, slug, status) values (v_dir_d, 'avl-d-' || v_tag, 'active') returning id into v_club_d;

  select id into v_type_u12 from public.canonical_team_types_by_code where rugby_code='union' and key='u12' and is_offered limit 1;
  select id into v_type_u16 from public.canonical_team_types_by_code where rugby_code='union' and key='u16' and is_offered limit 1;

  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_a, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_u12, true) returning id into v_team_a_u12;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_b, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_u12, true) returning id into v_team_b_u12;
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_c, 'Under 12 Boys', 'youth', 'U12', 'union', 'boys', v_type_u12, true) returning id into v_team_c_u12;
  -- Club D is a PARTNER of A but its only team is an incompatible age band -- must never appear anywhere.
  insert into public.teams (club_id, display_name, category, age_group, rugby_code, gender, canonical_team_type_id, active)
  values (v_club_d, 'Under 16 Boys', 'youth', 'U16', 'union', 'boys', v_type_u16, true) returning id into v_team_d_u16;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_coach, 'BASIC_USER', 'active') returning id into v_mem_a_coach;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_a, v_a_basic, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_b_admin, 'CLUB_ADMIN', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_d, v_d_admin, 'CLUB_ADMIN', 'active');

  insert into public.team_permissions (membership_id, team_id, permission) values (v_mem_a_coach, v_team_a_u12, 'coach');

  -- A <-> B: active partnership. A <-> D: active partnership (but D's only team is incompatible).
  perform pg_temp.act('authenticated', v_a_admin);
  insert into public.club_partnerships (requesting_club_id, partner_club_id, requested_by) values (v_club_a, v_club_b, v_a_admin) returning id into v_partnership_ab;
  insert into public.club_partnerships (requesting_club_id, partner_club_id, requested_by) values (v_club_a, v_club_d, v_a_admin) returning id into v_partnership_ad;
  perform pg_temp.act('authenticated', v_b_admin);
  perform public.respond_to_club_partnership(v_partnership_ab, true);
  perform pg_temp.act('authenticated', v_d_admin);
  perform public.respond_to_club_partnership(v_partnership_ad, true);
  -- Club C is compatible with A but deliberately NOT partnered -- proves "partners only" holds.

  -- D1: an accepted, active fixture for B.
  perform pg_temp.act_postgres();
  insert into public.fixtures (owning_team_id, home_away, opponent_directory_id, raw_opposition_text, kickoff_date, status, source)
  values (v_team_b_u12, 'Home', v_dir_c, 'A friendly', d1, 'Booked', 'club_created');

  -- D2: a MANUAL training session for B -- session_date set, occurrence_date left null (the real shape
  -- every manual session in the live local database has).
  insert into public.training_sessions (club_id, team_id, session_date, status, source)
  values (v_club_b, v_team_b_u12, d2, 'PLANNED', 'MANUAL');

  -- D5: a real competition match involving A and B, issued but verification still awaiting -- by
  -- internal.project_competition_match's own rule, NO Fixture is projected for this yet.
  select id into v_season from public.seasons order by starts_on desc limit 1;
  insert into public.competitions (name, slug, normalized_key, rugby_code) values ('AVL Cup ' || v_tag, 'avl-cup-' || v_tag, 'avl-cup-' || v_tag, 'union') returning id into v_competition;
  insert into public.competition_editions (competition_id, season_id, rugby_code) values (v_competition, v_season, 'union') returning id into v_edition;
  insert into public.competition_stages (edition_id, kind, name) values (v_edition, 'league', 'League') returning id into v_stage;
  insert into public.competition_participants (edition_id, slot, club_directory_id, club_id, team_id, canonical_team_type_id)
  values (v_edition, 1, v_dir_a, v_club_a, v_team_a_u12, v_type_u12) returning id into v_home_p;
  insert into public.competition_participants (edition_id, slot, club_directory_id, club_id, team_id, canonical_team_type_id)
  values (v_edition, 2, v_dir_b, v_club_b, v_team_b_u12, v_type_u12) returning id into v_away_p;
  insert into public.competition_matches (edition_id, stage_id, home_participant_id, away_participant_id, match_date, status, verification_state)
  values (v_edition, v_stage, v_home_p, v_away_p, d5, 'issued', 'awaiting') returning id into v_match;
  perform pg_temp.check(not exists (select 1 from public.competition_match_fixtures where match_id = v_match),
    'SETUP the competition match genuinely has no projected Fixture yet -- the real gap this section closes');

  -- D3: a pending (sent) fixture request from A to B.
  perform pg_temp.act('authenticated', v_a_coach);
  insert into public.fixture_request_groups (requesting_club_id, opponent_directory_id, opponent_club_id, raw_opponent_text, proposed_date, created_by)
  values (v_club_a, v_dir_b, v_club_b, 'AVL B RUFC', d3, v_a_coach) returning id into v_group;
  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
  values (v_group, v_team_a_u12, v_team_b_u12, 'either', 'sent', v_a_coach) returning id into v_request;

  -- =====================================================================
  -- OWN TEAM: team_scheduling_availability is completely unchanged for a team's own calendar.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_coach);
  select status into v_status from public.team_scheduling_availability(v_team_a_u12, v_team_a_u12, d3, d3) where the_date = d3;
  perform pg_temp.check(v_status = 'request_pending', 'OWN1 our own pending request still reads request_pending, unchanged');

  select status into v_status from public.team_scheduling_availability(v_team_a_u12, v_team_a_u12, d4, d4) where the_date = d4;
  perform pg_temp.check(v_status = 'available', 'OWN2 our own genuinely clear date truthfully reads available -- a team may say this about itself');

  -- =====================================================================
  -- CROSS-TEAM AUTHORITY: incompatible, then non-partner, both refused before any data is read.
  -- =====================================================================
  perform pg_temp.check(pg_temp.try(format('select * from public.team_scheduling_availability(%L,%L,%L,%L)', v_team_a_u12, v_team_d_u16, d1, d5)) = '42501',
    'X1 an incompatible team is refused even though Club D IS a partner');
  perform pg_temp.check(pg_temp.try(format('select * from public.team_scheduling_availability(%L,%L,%L,%L)', v_team_a_u12, v_team_c_u12, d1, d5)) = '42501',
    'X2 a compatible but NON-partner team is refused -- the partners-only boundary is not broadened');

  -- =====================================================================
  -- CROSS-TEAM, PARTNER, COMPATIBLE: every source coarsens to exactly "busy", never the specific kind.
  -- =====================================================================
  select status into v_status from public.team_scheduling_availability(v_team_a_u12, v_team_b_u12, d1, d1) where the_date = d1;
  perform pg_temp.check(v_status = 'busy', 'C1 an accepted fixture coarsens to busy, never "fixture"');

  select status into v_status from public.team_scheduling_availability(v_team_a_u12, v_team_b_u12, d2, d2) where the_date = d2;
  perform pg_temp.check(v_status = 'busy', 'C2 a MANUAL training session (session_date only, occurrence_date null) is correctly detected and coarsens to busy');

  select status into v_status from public.team_scheduling_availability(v_team_a_u12, v_team_b_u12, d3, d3) where the_date = d3;
  perform pg_temp.check(v_status = 'request_pending', 'C3 a pending request stays request_pending for the opponent side too -- distinct from busy, never coarsened away');

  select status into v_status from public.team_scheduling_availability(v_team_a_u12, v_team_b_u12, d4, d4) where the_date = d4;
  perform pg_temp.check(v_status = 'no_known_clash', 'C4 a genuinely clear date on the OPPONENT side reads no_known_clash, never the fabricated claim "available"');

  select status into v_status from public.team_scheduling_availability(v_team_a_u12, v_team_b_u12, d5, d5) where the_date = d5;
  perform pg_temp.check(v_status = 'busy', 'C5 a real competition match with NO Fixture projected yet is still detected as busy -- the exact gap this section closes');

  -- =====================================================================
  -- THE BATCHED SEARCH: find_fixture_candidate_availability.
  -- =====================================================================
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_availability(%L, array[%L]::date[])', v_team_a_u12, d1)) = 'OK',
    'B1 the authorised asking team can run the batched search at all');

  select count(*) into v_n from public.find_fixture_candidate_availability(v_team_a_u12, array[d1,d2,d3,d4,d5]::date[]) where opponent_team_id = v_team_c_u12;
  perform pg_temp.check(v_n = 0, 'B2 Club C (compatible, NOT a partner) never appears in the batched result at all, on any date');

  select count(*) into v_n from public.find_fixture_candidate_availability(v_team_a_u12, array[d1,d2,d3,d4,d5]::date[]) where opponent_team_id = v_team_d_u16;
  perform pg_temp.check(v_n = 0, 'B3 Club D (a partner, but incompatible age band) never appears in the batched result at all');

  select count(*) into v_n from public.find_fixture_candidate_availability(v_team_a_u12, array[d1,d2,d3,d4,d5]::date[]) where opponent_team_id = v_team_b_u12 and the_date = d4;
  perform pg_temp.check(v_n = 0, 'B4 Club B''s genuinely clear date is simply absent, never returned as a fabricated "available" row');

  select status into v_status from public.find_fixture_candidate_availability(v_team_a_u12, array[d1,d2,d3,d4,d5]::date[]) where opponent_team_id = v_team_b_u12 and the_date = d1;
  perform pg_temp.check(v_status = 'busy', 'B5 Club B''s accepted-fixture date is returned as busy');
  select status into v_status from public.find_fixture_candidate_availability(v_team_a_u12, array[d1,d2,d3,d4,d5]::date[]) where opponent_team_id = v_team_b_u12 and the_date = d3;
  perform pg_temp.check(v_status = 'request_pending', 'B6 Club B''s pending-request date is returned as request_pending, distinct from busy');
  select status into v_status from public.find_fixture_candidate_availability(v_team_a_u12, array[d1,d2,d3,d4,d5]::date[]) where opponent_team_id = v_team_b_u12 and the_date = d5;
  perform pg_temp.check(v_status = 'busy', 'B7 Club B''s not-yet-projected competition match date is returned as busy');

  -- =====================================================================
  -- AUTHORITY: no fixture authority at all is refused; bounds are enforced.
  -- =====================================================================
  perform pg_temp.act('authenticated', v_a_basic);
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_availability(%L, array[%L]::date[])', v_team_a_u12, d1)) = '42501',
    'A1 an ordinary BASIC_USER club member with no team_permissions row and no club-wide fixture authority is refused for the team''s own club''s own team');
  perform pg_temp.act('authenticated', v_a_admin);
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_availability(%L, array[%L]::date[])', v_team_a_u12, d1)) = 'OK',
    'A1b a genuine CLUB_ADMIN''s club-wide fixture authority DOES reach the club''s own team -- club-wide authority is real, not merely the absence of a refusal');
  perform pg_temp.act('authenticated', v_a_coach);
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_availability(%L, array[]::date[])', v_team_a_u12)) <> 'OK',
    'A2 zero dates is refused');
  perform pg_temp.check(pg_temp.try(format('select * from public.find_fixture_candidate_availability(%L, array[%L,%L,%L,%L,%L,%L,%L]::date[])', v_team_a_u12, d1,d2,d3,d4,d5,d1+1,d1+2)) <> 'OK',
    'A3 more than six dates is refused');

  -- =====================================================================
  -- MINIMAL PAYLOAD.
  -- =====================================================================
  perform pg_temp.check(
    (select array_to_string(proargnames, ',') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'find_fixture_candidate_availability')
      = 'p_team_id,p_dates,opponent_team_id,the_date,status',
    'P1 the batched search return shape is exactly opponent_team_id, the_date, status -- no event detail, no roster');

  perform pg_temp.act_postgres();
end $$;

rollback;
