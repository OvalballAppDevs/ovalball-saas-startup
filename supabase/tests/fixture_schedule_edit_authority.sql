-- FIXTURE SCHEDULE EDIT AUTHORITY (CA-M7.1, ledger H24) -- A KICK-OFF CHANGE IS A FIXTURE EDIT.
--
-- Every change to WHEN and WHERE a fixture is played -- kick-off date and time, the whole schedule, the
-- meet time, the pitch, the venue, answering a proposed kick-off change, the free-text ground -- asks
-- fixture.fixture.edit at either side of the fixture, and never fixture.result.record. Recording the
-- result asks fixture.result.record and never fixture.fixture.edit. The two are proved independently.
--
--   SE-A  edit allowed, result not: every scheduling change lands; the result is refused
--   SE-B  result allowed, edit not: every scheduling change is refused; the result lands
--   SE-C  a Team Managers role default; a Club Admins withhold refuses mid-edit, keeps the role, keeps the
--         view, keeps result recording; restore returns the edit; the read model agrees at every step
--   SE-D  team scope: no scheduling change on a sibling team or another club; no club-wide tool
--   SE-E  either side: the opponents fixture staff may propose a kick-off change and answer one
--
-- Self-seeding and rolled back.
--
--
--

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

create or replace function pg_temp.count_of(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin execute p_sql into v; return v;
exception when others then return -1; end $$;

create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '35 years')::date) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'to-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'To', p_label, 'to-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TO ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'to-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'to-' || v_tag, 'active') returning id into v_club;
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

create or replace function pg_temp.player(p_label text, p_years int, p_team uuid, p_user uuid default null, p_state text default 'ACTIVE') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('P', p_label, (current_date - (p_years || ' years')::interval)::date, 'MALE', p_user) returning id into v;
  insert into public.player_team_memberships (player_id, team_id, state) values (v, p_team, p_state);
  return v;
end $$;

grant execute on function pg_temp.act(text, uuid, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.count_of(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_club uuid; v_club_b uuid; v_t12 uuid; v_t14 uuid; v_tb uuid;
  v_ca uuid; v_tm uuid; v_edit_only uuid; v_result_only uuid; v_tmb uuid;
  v_ms_tm uuid; v_ms_edit uuid; v_ms_result uuid; v_ms_tmb uuid;
  v_season uuid; v_fx uuid; v_fx_played uuid; v_fx14 uuid; v_fx_b uuid; v_fx_pair uuid; v_venue uuid; v_pitch uuid;
  v_state text; v_override uuid; v_json jsonb; r record; v_n int;
begin
  perform pg_temp.act_postgres();
  v_club := pg_temp.club('Home'); v_club_b := pg_temp.club('Away');
  v_t12 := pg_temp.team(v_club, 'u12', 'U12', 'Under 12 Boys');
  v_t14 := pg_temp.team(v_club, 'u14', 'U14', 'Under 14 Boys');
  v_tb := pg_temp.team(v_club_b, 'u12', 'U12', 'Under 12 Boys');
  v_ca := pg_temp.person('ClubAdmin'); perform pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_tm := pg_temp.person('TeamManager'); v_ms_tm := pg_temp.member(v_club, v_tm);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_tm, v_t12, 'manager');
  -- Two people with NO team role: each gets exactly one of the two keys by an explicit decision.
  v_edit_only := pg_temp.person('EditOnly'); v_ms_edit := pg_temp.member(v_club, v_edit_only);
  v_result_only := pg_temp.person('ResultOnly'); v_ms_result := pg_temp.member(v_club, v_result_only);
  v_tmb := pg_temp.person('OtherManager'); v_ms_tmb := pg_temp.member(v_club_b, v_tmb);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_tmb, v_tb, 'manager');

  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  insert into public.venues (club_id, name, slug, is_default_home) values (v_club, 'SE Ground', 'se-ground-' || substr(v_club::text, 1, 8), true) returning id into v_venue;
  insert into public.club_pitches (club_id, venue_id, display_name, sort_order) values (v_club, v_venue, 'Pitch 1', 1) returning id into v_pitch;

  -- An external fixture on U12 (scheduling applies directly), one already played (for results), one on U14,
  -- one at club B, and a fixture between U12 and club B's U12 (either-side scheduling).
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_t12, 'Home', 'SE External RFC', current_date + 20, '10:30', 'Booked', 'club_created', v_season) returning id into v_fx;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_t12, 'Home', 'SE Played RFC', current_date - 3, '10:30', 'Booked', 'club_created', v_season) returning id into v_fx_played;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_t14, 'Home', 'SE External RFC', current_date + 21, '10:30', 'Booked', 'club_created', v_season) returning id into v_fx14;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_tb, 'Home', 'SE External RFC', current_date + 22, '10:30', 'Booked', 'club_created', v_season) returning id into v_fx_b;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_t12, v_tb, 'Home', 'SE Away RUFC', current_date + 30, '14:00', 'Booked', 'club_created', v_season) returning id into v_fx_pair;

  -- A team-level decision needs a role on that team (CA-M4 RP-D): both are Volunteers on U12, a role
  -- whose bundle carries neither key, so each key below comes from the decision and nothing else.
  perform pg_temp.act('authenticated', v_ca);
  perform pg_temp.try(format('select public.assign_role(%L, ''VOLUNTEER'', %L, null)', v_ms_edit, v_t12));
  perform pg_temp.try(format('select public.assign_role(%L, ''VOLUNTEER'', %L, null)', v_ms_result, v_t12));
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.edit'', ''team'', %L, %L, ''grant'', ''SE: edit only'')', v_edit_only, v_club, v_t12));
  perform pg_temp.check(v_state = 'OK', format('SE-0a EditOnly is allowed fixture.fixture.edit at U12 by an explicit decision (%s)', v_state));
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''fixture.result.record'', ''team'', %L, %L, ''grant'', ''SE: result only'')', v_result_only, v_club, v_t12));
  perform pg_temp.check(v_state = 'OK', format('SE-0b ResultOnly is allowed fixture.result.record at U12 by an explicit decision (%s)', v_state));

  -- =====================================================================================
  -- SE-A  EDIT ALLOWED, RESULT NOT
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_edit_only);
  perform pg_temp.check(internal.can('fixture.fixture.edit', 'team', v_club, v_t12, null) and not internal.can('fixture.result.record', 'team', v_club, v_t12, null),
    'SE-A0 the engine: edit yes, result no');
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''11:00'')', v_fx, current_date + 20));
  perform pg_temp.check(v_state = 'OK' and (select kickoff_time from public.fixtures where id = v_fx) = '11:00', format('SE-A1 kick-off edit ALLOWED with edit alone (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_meet_time(%L, ''09:45'')', v_fx));
  perform pg_temp.check(v_state = 'OK', format('SE-A2 meet time ALLOWED (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_venue(%L, %L)', v_fx, v_venue));
  perform pg_temp.check(v_state = 'OK', format('SE-A3 venue ALLOWED (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_pitch(%L, %L, null)', v_fx, v_pitch));
  perform pg_temp.check(v_state = 'OK', format('SE-A4 pitch ALLOWED (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_schedule(%L, %L, ''11:30'', %L, %L, null, null)', v_fx, current_date + 20, v_venue, v_pitch));
  perform pg_temp.check(v_state = 'OK' and (select kickoff_time from public.fixtures where id = v_fx) = '11:30', format('SE-A5 the whole schedule ALLOWED (%s)', v_state));
  v_state := pg_temp.try(format('select public.submit_fixture_result(%L, 12, 7)', v_fx_played));
  perform pg_temp.check(v_state = '42501', format('SE-A6 result recording REFUSED: edit does not grant recording (%s)', v_state));
  select * into r from jsonb_to_record(public.fixture_editable_fields(v_fx)) as x(schedule jsonb, result jsonb);
  perform pg_temp.check((r.schedule->>'editable')::boolean, 'SE-A7 the read model says the schedule is editable');
  select * into r from jsonb_to_record(public.fixture_editable_fields(v_fx_played)) as x(schedule jsonb, result jsonb);
  perform pg_temp.check(not (r.result->>'editable')::boolean, 'SE-A8 and that the result is not');

  -- =====================================================================================
  -- SE-B  RESULT ALLOWED, EDIT NOT
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_result_only);
  perform pg_temp.check(internal.can('fixture.result.record', 'team', v_club, v_t12, null) and not internal.can('fixture.fixture.edit', 'team', v_club, v_t12, null),
    'SE-B0 the engine: result yes, edit no');
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''12:00'')', v_fx, current_date + 20));
  perform pg_temp.check(v_state = '42501' and (select kickoff_time from public.fixtures where id = v_fx) = '11:30', format('SE-B1 kick-off edit REFUSED with result alone, and the kick-off did not move (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_meet_time(%L, ''08:00'')', v_fx));
  perform pg_temp.check(v_state = '42501', format('SE-B2 meet time REFUSED (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_venue(%L, null)', v_fx));
  perform pg_temp.check(v_state = '42501', format('SE-B3 venue REFUSED (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_pitch(%L, null, ''Far pitch'')', v_fx));
  perform pg_temp.check(v_state = '42501', format('SE-B4 pitch REFUSED (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_schedule(%L, %L, ''12:00'', null, null, null, null)', v_fx, current_date + 25));
  perform pg_temp.check(v_state = '42501' and (select kickoff_date from public.fixtures where id = v_fx) = current_date + 20, format('SE-B5 the whole schedule REFUSED (%s)', v_state));
  v_state := pg_temp.try(format('select public.reject_fixture_kickoff_change(%L)', v_fx_pair));
  perform pg_temp.check(v_state = '42501', format('SE-B6 answering a kick-off change REFUSED (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_details(%L, %L::jsonb)', v_fx, '{"venue_text":"Somewhere"}'));
  perform pg_temp.check(v_state = '42501', format('SE-B7 the free-text ground REFUSED (%s)', v_state));
  v_state := pg_temp.try(format('select public.submit_fixture_result(%L, 12, 7)', v_fx_played));
  perform pg_temp.check(v_state = 'OK', format('SE-B8 result recording ALLOWED: recording does not need editing (%s)', v_state));
  select * into r from jsonb_to_record(public.fixture_editable_fields(v_fx)) as x(schedule jsonb, result jsonb);
  perform pg_temp.check(not (r.schedule->>'editable')::boolean, 'SE-B9 the read model says the schedule is not editable');

  -- =====================================================================================
  -- SE-C  A TEAM MANAGER: ROLE DEFAULT, WITHHOLD, ROLE REMAINS, VIEW REMAINS, RESULT INDEPENDENT, RESTORE
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''10:00'')', v_fx, current_date + 20));
  perform pg_temp.check(v_state = 'OK' and (select kickoff_time from public.fixtures where id = v_fx) = '10:00', format('SE-C1 role default: a Team Manager moves the kick-off on their own team (%s)', v_state));
  perform pg_temp.act('authenticated', v_ca);
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.edit'', ''team'', %L, %L, ''deny'', ''SE: withheld'')', v_tm, v_club, v_t12));
  perform pg_temp.check(v_state = 'OK', format('SE-C2 the Club Admin withholds fixture.fixture.edit at U12 (%s)', v_state));
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''13:00'')', v_fx, current_date + 20));
  perform pg_temp.check(v_state = '42501' and (select kickoff_time from public.fixtures where id = v_fx) = '10:00', format('SE-C3 STALE AUTHORITY: the kick-off save is refused and the kick-off is unchanged (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_details(%L, %L::jsonb)', v_fx, '{"notes":"probe"}'));
  perform pg_temp.check(v_state = '42501', format('SE-C4 and the details editor refuses the same way (%s)', v_state));
  perform pg_temp.check(exists (select 1 from public.role_assignments where user_id = v_tm and team_id = v_t12 and role_key = 'TEAM_MANAGER' and state = 'ACTIVE'),
    'SE-C5 the person is still a Team Manager');
  perform pg_temp.check(internal.can('fixture.fixture.view', 'team', v_club, v_t12, null) and exists (select 1 from public.fixtures where id = v_fx),
    'SE-C6 the fixture is still viewable');
  perform pg_temp.check(internal.can('fixture.result.record', 'team', v_club, v_t12, null), 'SE-C7 result recording is still theirs: governed by its own key');
  v_state := pg_temp.try(format('select public.submit_fixture_result(%L, 12, 8)', v_fx_played));
  perform pg_temp.check(v_state = 'OK', format('SE-C8 and it still works while editing is withheld (%s)', v_state));
  select * into r from jsonb_to_record(public.fixture_editable_fields(v_fx)) as x(schedule jsonb, result jsonb);
  perform pg_temp.check(not (r.schedule->>'editable')::boolean, 'SE-C9 the read model agrees: schedule not editable while withheld');
  perform pg_temp.act('authenticated', v_ca);
  select override_id into v_override from public.club_person_permissions(v_club, v_tm, 'team', v_t12) where capability_key = 'fixture.fixture.edit';
  v_state := pg_temp.try(format('select public.revoke_capability_override(%L, ''SE: restored'')', v_override));
  perform pg_temp.check(v_state = 'OK' and not exists (select 1 from public.capability_overrides where user_id = v_tm and capability_key = 'fixture.fixture.edit' and status = 'active'),
    format('SE-C10 RESTORE DEFAULT removes the decision (%s)', v_state));
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''13:00'')', v_fx, current_date + 20));
  perform pg_temp.check(v_state = 'OK' and (select kickoff_time from public.fixtures where id = v_fx) = '13:00', format('SE-C11 the role answers again: the kick-off moves (%s)', v_state));
  select * into r from jsonb_to_record(public.fixture_editable_fields(v_fx)) as x(schedule jsonb, result jsonb);
  perform pg_temp.check((r.schedule->>'editable')::boolean, 'SE-C12 and the read model agrees');

  -- =====================================================================================
  -- SE-D  TEAM SCOPE, CROSS-TEAM, CROSS-CLUB, NO CLUB-WIDE TOOL
  -- =====================================================================================
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''13:00'')', v_fx14, current_date + 21));
  perform pg_temp.check(v_state = '42501', format('SE-D1 a U12 manager cannot move U14''s kick-off (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_schedule(%L, %L, ''13:00'', null, null, null, null)', v_fx14, current_date + 21));
  perform pg_temp.check(v_state = '42501', format('SE-D2 nor its schedule (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''13:00'')', v_fx_b, current_date + 22));
  perform pg_temp.check(v_state = '42501', format('SE-D3 nor another club''s kick-off, knowing its id (%s)', v_state));
  perform pg_temp.check(not internal.can('fixture.planner.use', 'club', v_club, null, null) and not internal.can('fixture.fixture.bulk_edit', 'club', v_club, null, null) and not internal.can('fixture.import.run', 'club', v_club, null, null),
    'SE-D4 and no Planner, bulk edit or Import came with any of it');

  -- =====================================================================================
  -- SE-E  EITHER SIDE: the opponent's staff propose and answer a kick-off change with THEIR edit key
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_tmb);
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''15:00'')', v_fx_pair, current_date + 30));
  perform pg_temp.check(v_state = 'OK' and (select kickoff_amendment_proposed_time from public.fixtures where id = v_fx_pair) = '15:00'
                        and (select kickoff_time from public.fixtures where id = v_fx_pair) = '14:00',
    format('SE-E1 the opponent''s Team Manager PROPOSES a change with fixture.fixture.edit on their side; nothing moves until agreed (%s)', v_state));
  perform pg_temp.act('authenticated', v_tm);
  v_state := pg_temp.try(format('select public.reject_fixture_kickoff_change(%L)', v_fx_pair));
  perform pg_temp.check(v_state = 'OK' and (select kickoff_amendment_proposed_time from public.fixtures where id = v_fx_pair) is null,
    format('SE-E2 the owning side answers it with theirs (%s)', v_state));
  perform pg_temp.act('authenticated', v_result_only);
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''16:00'')', v_fx_pair, current_date + 30));
  perform pg_temp.check(v_state = '42501', format('SE-E3 a result-only holder cannot even propose (%s)', v_state));

  perform pg_temp.act_postgres();
end $$;

rollback;
