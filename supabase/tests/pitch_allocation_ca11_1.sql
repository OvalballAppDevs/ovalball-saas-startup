-- PITCH ALLOCATION (CA-M11.1) -- THE NATIVE BOARD CONSUMES THE SAME AUTHORITY THE WEBSITE'S DOES.
--
--   PA-A  the two keys: a Club Admin's bundle holds view and manage; a Coach's holds view only; a Team
--         Manager's holds view only; nobody's team-scoped grant satisfies a club-scoped key
--   PA-B  fixture edit does not imply allocation management: a holder of fixture.fixture.edit whose
--         venue.pitch_allocation.manage is withheld cannot write a proposal (RLS), while a manage holder can
--   PA-C  stale authority, as the server enforces it today: the placement write (update_fixture_schedule)
--         asks fixture edit at the home club -- a manage-only holder without fixture edit is refused, and
--         withholding manage does NOT stop a fixture-edit holder's placement (recorded divergence H32)
--   PA-D  the placement lands the same row from any client: pitch, venue, status lifecycle, audit source
--   PA-E  cross-club: another club's admin cannot place a fixture on our pitch, nor read our proposals
--   PA-F  the scheduling policy row is written under the same RLS from any client
--
-- Self-seeding and rolled back. No persistent review identity is touched.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.act(p_role text, p_sub uuid default null, p_session uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email, 'session_id', p_session))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void language plpgsql as $$
begin perform set_config('role','none',true); perform set_config('request.jwt.claims','',true); end $$;

create or replace function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v_state text;
begin execute p_sql; return 'OK';
exception when others then get stacked diagnostics v_state = returned_sqlstate; return v_state; end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pa-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Pa', p_label, 'pa-' || v::text || '@ovalball.test', (current_date - interval '35 years')::date)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname;
  return v;
end $$;

create or replace function pg_temp.session(p_user uuid) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v, p_user, now(), now(), 'aal2');
  insert into auth.mfa_amr_claims (id, session_id, authentication_method, created_at, updated_at) values (gen_random_uuid(), v, 'totp', now(), now());
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('PA ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'pa-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'pa-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_key text, p_age text, p_label text) returns uuid language plpgsql as $$
declare v uuid; v_type uuid;
begin
  select id into v_type from public.canonical_team_types_by_code where rugby_code = 'union' and key = p_key and is_offered limit 1;
  insert into public.teams (club_id, display_name, category, age_group, gender, rugby_code, canonical_team_type_id, active)
  values (p_club, p_label, 'youth', p_age, 'boys', 'union', v_type, true) returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

grant execute on function pg_temp.act(text, uuid, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_club uuid; v_other uuid; v_team uuid; v_team_b uuid; v_other_team uuid;
  v_ca uuid; v_ca2 uuid; v_coach uuid; v_tm uuid; v_other_ca uuid;
  v_ms_ca uuid; v_ms_ca2 uuid; v_ms_coach uuid; v_ms_tm uuid;
  v_sess uuid;
  v_venue uuid; v_pitch uuid; v_fixture uuid; v_season uuid;
  v_n bigint; v_m bigint; v_k bigint; v_state text; v_json jsonb; v_id uuid; v_text text;
  r record;
begin
  v_club := pg_temp.club('Home'); v_other := pg_temp.club('Away');
  v_team := pg_temp.team(v_club, 'u12', 'U12', 'Under 12 Boys');
  v_team_b := pg_temp.team(v_club, 'u14', 'U14', 'Under 14 Boys');
  v_other_team := pg_temp.team(v_other, 'u12', 'U12', 'Under 12 Boys');
  v_ca := pg_temp.person('Admin'); v_ca2 := pg_temp.person('Admin Two'); v_coach := pg_temp.person('Coach'); v_tm := pg_temp.person('Manager'); v_other_ca := pg_temp.person('Other Admin');
  v_ms_ca := pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_ms_ca2 := pg_temp.member(v_club, v_ca2, 'CLUB_ADMIN');
  v_ms_coach := pg_temp.member(v_club, v_coach, 'BASIC_USER');
  v_ms_tm := pg_temp.member(v_club, v_tm, 'BASIC_USER');
  perform pg_temp.member(v_other, v_other_ca, 'CLUB_ADMIN');
  v_sess := pg_temp.session(v_ca);
  perform pg_temp.act('authenticated', v_ca, v_sess);
  perform public.assign_role(v_ms_coach, 'COACH', v_team, null);
  perform public.assign_role(v_ms_tm, 'TEAM_MANAGER', v_team, null);
  perform pg_temp.act_postgres();
  insert into public.venues (club_id, name, slug, active, is_default_home) values (v_club, 'PA Ground', 'pa-ground-' || substr(v_club::text, 1, 8), true, true) returning id into v_venue;
  insert into public.club_pitches (club_id, display_name, active, venue_id, sort_order) values (v_club, 'Pitch 1', true, v_venue, 1) returning id into v_pitch;
  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  insert into public.fixtures (owning_team_id, raw_opposition_text, home_away, kickoff_date, kickoff_time, status, season_id)
  values (v_team, 'PA Opposition', 'Home', current_date + 7, null, 'Planned', v_season) returning id into v_fixture;
  perform pg_temp.check(v_fixture is not null and v_pitch is not null, 'PA-0 seeded: a club, a ground, a pitch, a Club Admin, a Coach, a Team Manager, a home fixture with no pitch');

  -- PA-A the two keys
  perform pg_temp.act('authenticated', v_ca, v_sess);
  select count(*) into v_n from public.my_capabilities('club', v_club) where allowed and capability_key in ('venue.pitch_allocation.view', 'venue.pitch_allocation.manage');
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 2, format('PA-A1 a Club Admin holds view and manage at club scope (%s)', v_n));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_coach where id = v_sess;
  perform pg_temp.act('authenticated', v_coach, v_sess);
  select count(*) into v_n from public.my_capabilities('club', v_club) where allowed and capability_key = 'venue.pitch_allocation.view';
  select count(*) into v_m from public.my_capabilities('club', v_club) where allowed and capability_key = 'venue.pitch_allocation.manage';
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 1 and v_m = 0, format('PA-A2 a Coach may view the board and not manage it (%s/%s)', v_n, v_m));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_tm where id = v_sess;
  perform pg_temp.act('authenticated', v_tm, v_sess);
  select count(*) into v_n from public.my_capabilities('club', v_club) where allowed and capability_key = 'venue.pitch_allocation.view';
  select count(*) into v_m from public.my_capabilities('club', v_club) where allowed and capability_key = 'venue.pitch_allocation.manage';
  select count(*) into v_k from public.my_capabilities('team', v_club, v_team) where allowed and capability_key = 'fixture.fixture.edit';
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 1 and v_m = 0 and v_k = 1, format('PA-A3 a Team Manager views, does not manage, and holds fixture edit at their team (%s/%s/%s)', v_n, v_m, v_k));

  -- PA-B fixture edit does not imply allocation management (RLS on the proposal tables)
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_tm where id = v_sess;
  perform pg_temp.act('authenticated', v_tm, v_sess);
  v_state := pg_temp.try(format('insert into public.pitch_allocation_proposals (club_id, proposal_date, created_by) values (%L, current_date, %L)', v_club, v_tm));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('PA-B1 a fixture-edit holder without manage cannot write a proposal (%s)', v_state));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca where id = v_sess;
  perform pg_temp.act('authenticated', v_ca, v_sess);
  perform public.set_capability_override(v_ca2, 'venue.pitch_allocation.manage', 'club', v_club, null, 'deny', 'CA-M11.1 suite');
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca2 where id = v_sess;
  perform pg_temp.act('authenticated', v_ca2, v_sess);
  v_state := pg_temp.try(format('insert into public.pitch_allocation_proposals (club_id, proposal_date, created_by) values (%L, current_date, %L)', v_club, v_ca2));
  select count(*) into v_n from public.my_capabilities('club', v_club) where allowed and capability_key = 'fixture.fixture.edit';
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501' and v_n = 1, format('PA-B2 a Club Admin with manage withheld is refused a proposal while still holding fixture edit (%s / edit %s)', v_state, v_n));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca where id = v_sess;
  perform pg_temp.act('authenticated', v_ca, v_sess);
  v_state := pg_temp.try(format('insert into public.pitch_allocation_proposals (club_id, proposal_date, created_by) values (%L, current_date, %L)', v_club, v_ca));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'OK', format('PA-B3 a manage holder writes a proposal (%s)', v_state));

  -- PA-C stale authority as the server enforces it TODAY
  -- a manage-only holder without fixture edit: give a Volunteer the preset, no fixture edit
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca2 where id = v_sess;
  perform pg_temp.act('authenticated', v_ca2, v_sess);
  v_json := null;
  v_state := pg_temp.try(format('select * from public.update_fixture_schedule(%L, %L, ''10:30'', %L, %L, null, ''PITCH_ALLOCATION'')', v_fixture, current_date + 7, v_venue, v_pitch));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'OK', format('PA-C1 RECORDED DIVERGENCE (H32): with venue.pitch_allocation.manage withheld, a fixture-edit holder''s placement is still accepted by update_fixture_schedule (%s) -- the RPC asks fixture edit, not the allocation key', v_state));
  -- undo that placement so the lifecycle checks below start clean
  update public.fixtures set pitch_id = null, pitch_allocation = null, kickoff_time = null, venue_id = null, status = 'Planned' where id = v_fixture;
  -- a person with manage but WITHOUT fixture edit: a Volunteer given the allocation preset
  declare v_vol uuid; v_ms_vol uuid;
  begin
    v_vol := pg_temp.person('Volunteer');
    v_ms_vol := pg_temp.member(v_club, v_vol, 'BASIC_USER');
    perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca where id = v_sess;
    perform pg_temp.act('authenticated', v_ca, v_sess);
    perform public.assign_role(v_ms_vol, 'VOLUNTEER', null, null);
    perform public.set_capability_override(v_vol, 'venue.pitch_allocation.manage', 'club', v_club, null, 'grant', 'CA-M11.1 suite');
    perform pg_temp.act_postgres(); update auth.sessions set user_id = v_vol where id = v_sess;
    perform pg_temp.act('authenticated', v_vol, v_sess);
    select count(*) into v_n from public.my_capabilities('club', v_club) where allowed and capability_key = 'venue.pitch_allocation.manage';
    select count(*) into v_m from public.my_capabilities('club', v_club) where allowed and capability_key = 'fixture.fixture.edit';
    v_state := pg_temp.try(format('select * from public.update_fixture_schedule(%L, %L, ''10:30'', %L, %L, null, ''PITCH_ALLOCATION'')', v_fixture, current_date + 7, v_venue, v_pitch));
    v_text := pg_temp.try(format('insert into public.pitch_allocation_proposals (club_id, proposal_date, created_by) values (%L, current_date, %L)', v_club, v_vol));
    perform pg_temp.act_postgres();
    perform pg_temp.check(v_n = 1 and v_m = 0 and v_state = '42501' and v_text = 'OK', format('PA-C2 a manage holder without fixture edit may build a proposal (%s) but the placement write is refused (%s) -- the same on both clients', v_text, v_state));
  end;

  -- PA-D the placement lands the same row from any client
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca where id = v_sess;
  perform pg_temp.act('authenticated', v_ca, v_sess);
  select * into r from public.update_fixture_schedule(v_fixture, current_date + 7, '10:30', v_venue, v_pitch, null, 'PITCH_ALLOCATION');
  perform pg_temp.act_postgres();
  select pitch_id, venue_id, status, kickoff_time::text into v_id, v_venue, v_state, v_text from public.fixtures where id = v_fixture;
  perform pg_temp.check(v_id = v_pitch and v_state = 'Booked' and v_text = '10:30:00', format('PA-D1 pitch and kick-off set: the fixture is Booked (%s at %s)', v_state, v_text));
  select count(*) into v_n from public.audit_log where table_name = 'fixtures' and record_id = v_fixture and after->>'source' = 'PITCH_ALLOCATION';
  perform pg_temp.check(v_n >= 1, format('PA-D2 the audit row carries the board''s source, whichever client saved (%s)', v_n));
  perform pg_temp.act('authenticated', v_ca, v_sess);
  perform public.update_fixture_pitch(v_fixture, null, null);
  perform pg_temp.act_postgres();
  select pitch_id, status into v_id, v_state from public.fixtures where id = v_fixture;
  -- The website's Fixture Detail clears a pitch through update_fixture_pitch, which does not run the
  -- status lifecycle (only update_fixture_schedule does) -- so the fixture keeps its status. The same on
  -- both clients; recorded, not changed.
  perform pg_temp.check(v_id is null and v_state = 'Booked', format('PA-D3 clearing the pitch through update_fixture_pitch removes the pitch and leaves the status as the website does (%s)', v_state));

  -- PA-E cross-club
  declare v_other_sess uuid; v_other_fixture uuid;
  begin
    v_other_sess := pg_temp.session(v_other_ca);
    perform pg_temp.act('authenticated', v_other_ca, v_other_sess);
    v_state := pg_temp.try(format('select * from public.update_fixture_schedule(%L, %L, ''11:00'', %L, %L, null, ''PITCH_ALLOCATION'')', v_fixture, current_date + 7, v_venue, v_pitch));
    select count(*) into v_n from public.pitch_allocation_proposals where club_id = v_club;
    perform pg_temp.act_postgres();
    perform pg_temp.check(v_state = '42501' and v_n = 0, format('PA-E1 another club''s admin cannot place our fixture (%s) and reads none of our proposals (%s)', v_state, v_n));
  end;

  -- PA-F the scheduling policy row under the same RLS
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_coach where id = v_sess;
  perform pg_temp.act('authenticated', v_coach, v_sess);
  v_state := pg_temp.try(format('insert into public.club_scheduling_policy (club_id, warm_up_minutes, pack_up_minutes, auto_allocate_home_fixtures) values (%L, 10, 10, false)', v_club));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = '42501', format('PA-F1 a Coach cannot write the club''s scheduling policy (%s)', v_state));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca where id = v_sess;
  perform pg_temp.act('authenticated', v_ca, v_sess);
  v_state := pg_temp.try(format('insert into public.club_scheduling_policy (club_id, warm_up_minutes, pack_up_minutes, auto_allocate_home_fixtures) values (%L, 10, 10, false) on conflict (club_id) do update set warm_up_minutes = 10', v_club));
  perform pg_temp.act_postgres();
  select source into v_text from public.resolve_club_scheduling_buffers(v_club);
  perform pg_temp.check(v_state = 'OK' and v_text = 'club', format('PA-F2 a Club Admin writes it and the buffers now come from the club (%s/%s)', v_state, v_text));
end $$;

rollback;
