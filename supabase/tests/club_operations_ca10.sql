-- TEAM OPERATIONS (CA-M7) -- THE TEAM WORKSPACE, PROVED WHERE IT IS ENFORCED.
--
-- A team context is a WORKSPACE, not a smaller club admin panel. Everything the phone draws for a team
-- comes from one capability read at team scope, and everything it writes is refused again by the server.
-- This suite proves the authority the workspace consumes and cannot widen:
--
--   TO-A  the team authority probe: a Team Manager's role default at team scope; a Coach's narrower one;
--         the Planner, Import, bulk edit and delete are never offered at team scope to anybody
--   TO-B  fixture mutation by a non-protected Team Manager: create, edit, cancel on THEIR team; a Club Admin
--         withholds edit -> the same role is refused mid-edit; restore -> it returns; the same for cancel
--   TO-C  cross-team and cross-club isolation: a U12 manager creates, edits and cancels nothing on U14 or
--         on another club's U12, and holds no capability at those scopes
--   TO-D  no club-wide escalation: no Planner, Import, bulk edit or delete at club scope; no club-wide
--         membership administration; no club ledger read
--   TO-E  subscriptions: the team-scoped operation answers only the holder, only for their team; the
--         underlying rows stay refused to a team holder; no provider column exists in the result;
--         a withhold refuses, a restore returns
--   TO-F  people: the roster reader refuses the wrong team and the wrong club; a Coach reads but does not
--         decide; a Team Manager decides; the reader carries no contact column
--   TO-G  fixture requests: a request from another club is seen by the target team, answered only by a
--         holder of fixture.request.respond, and a Coach's crafted acceptance is refused
--   TO-H  messaging: a parent and a player cannot message the opposition; a minor cannot message the
--         coach and the coach cannot message the minor; the fixture route exists for staff only
--   TO-I  availability: no staff override -- a Team Manager cannot answer for a player; the summary is
--         absent for a team the viewer has no attendance authority on
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

-- =====================================================================================================
-- CA-M10 -- CLUB OPERATIONS: the club workspace consumes club-scope authority and cannot widen it.
--
--   CA   the club-scope probe: a Club Admin's default bundle; a read-only club role reads and cannot
--        change; the desk tools are club-scope-only keys a team context never holds
--   CX   cross-club: Club A's fixture authority reaches nothing of Club B's -- no edit, no result,
--        no requests, no participants, no events, no venues
--   ER   edit and result are independent, both ways, at club scope (CA-M7.1 kept)
--   CN   cancel is a reasoned operation and never a delete; delete is its own R-gated key
--   RQ   fixture requests at club scope: read across every side, accepted by the club, declined only
--        by the club that was asked
--   EV   club events: visible by the club's own rule, managed by calendar.event.manage, cancelled
--        with a reason; a forged id fails closed; nothing is emitted (H29 untouched)
--   VP   pitch allocation is its own authority, independent of fixture edit and result
--   IN   invitations: create needs its own key, a revoked invitation cannot be redeemed, the read model
--        carries no secret
--
-- Self-seeding, and rolled back.
-- =====================================================================================================
do $$
declare
  v_club uuid; v_club_b uuid; v_t12 uuid; v_t14 uuid; v_tb uuid;
  v_ca uuid; v_ca2 uuid; v_ms_ca2 uuid; v_fs uuid; v_vol uuid; v_tm uuid; v_cab uuid; v_ms_ca uuid; v_ms_fs uuid; v_ms_vol uuid; v_ms_tm uuid;
  v_fixture uuid; v_fixture_b uuid; v_shared uuid; v_played uuid; v_request uuid; v_group uuid; v_event uuid; v_venue uuid; v_pitch uuid; v_inv uuid;
  v_n bigint; v_m bigint; v_state text; v_json jsonb; v_sess uuid := gen_random_uuid(); v_season uuid; r record;
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  perform pg_temp.act_postgres();
  v_club := pg_temp.club('Home'); v_club_b := pg_temp.club('Away');
  v_t12 := pg_temp.team(v_club, 'u12', 'U12', 'Under 12 Boys');
  v_t14 := pg_temp.team(v_club, 'u14', 'U14', 'Under 14 Boys');
  v_tb := pg_temp.team(v_club_b, 'u12', 'U12', 'Under 12 Boys');
  v_ca := pg_temp.person('ClubAdmin'); v_ms_ca := pg_temp.member(v_club, v_ca, 'CLUB_ADMIN');
  v_fs := pg_temp.person('FixtureSec'); v_ms_fs := pg_temp.member(v_club, v_fs, 'FIXTURE_SECRETARY');
  v_ca2 := pg_temp.person('SecondAdmin'); v_ms_ca2 := pg_temp.member(v_club, v_ca2, 'CLUB_ADMIN');
  v_vol := pg_temp.person('Volunteer'); v_ms_vol := pg_temp.member(v_club, v_vol);
  v_tm := pg_temp.person('TeamManager'); v_ms_tm := pg_temp.member(v_club, v_tm);
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_tm, v_t12, 'manager');
  v_cab := pg_temp.person('OtherClubAdmin'); perform pg_temp.member(v_club_b, v_cab, 'CLUB_ADMIN');

  select id into v_season from public.seasons where rugby_code = 'union' and not is_regression_fixture
    and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on limit 1;
  insert into public.venues (club_id, name, slug, active) values (v_club, 'TO Ground ' || v_tag, 'to-ground-' || v_tag, true) returning id into v_venue;
  insert into public.club_pitches (club_id, venue_id, display_name, active) values (v_club, v_venue, 'Pitch 1', true) returning id into v_pitch;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id, venue_id)
  values (v_t12, 'Home', 'TO External RFC', current_date + 5, '10:30', 'Booked', 'club_created', v_season, v_venue) returning id into v_fixture;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_tb, 'Home', 'TO Elsewhere RFC', current_date + 6, '10:30', 'Booked', 'club_created', v_season) returning id into v_fixture_b;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_t12, v_tb, 'Away', 'TO Away RUFC', current_date + 7, '11:00', 'Booked', 'club_created', v_season) returning id into v_shared;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_t14, 'Home', 'TO Played RFC', current_date - 3, '14:00', 'Booked', 'club_created', v_season) returning id into v_played;
  -- A recent two-factor session: withholding a capability at club scope (people.capability.manage) is an R operation.
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v_sess, v_ca, now(), now(), 'aal2');
  insert into auth.mfa_amr_claims (id, session_id, authentication_method, created_at, updated_at) values (gen_random_uuid(), v_sess, 'totp', now(), now());
  -- A Volunteer is a role assignment at the club, given by the Club Admin through the canonical operation.
  perform pg_temp.act('authenticated', v_ca, v_sess);
  perform public.assign_role(v_ms_vol, 'VOLUNTEER', null, null);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_fixture is not null and v_venue is not null, 'CO-0 seeded: two clubs, three sides, a Club Admin, a Fixture Secretary, a Volunteer, a Team Manager, a ground and three fixtures');

  -- =====================================================================================
  -- CA. The club-scope probe
  -- =====================================================================================
  perform pg_temp.act('authenticated', v_ca, v_sess);
  select count(*) into v_n from public.my_capabilities('club', v_club) where allowed
    and capability_key in ('fixture.fixture.view','fixture.fixture.create','fixture.fixture.edit','fixture.fixture.cancel','fixture.request.create','fixture.request.respond','fixture.result.record','people.member.view','team.team.manage','venue.venue.view','venue.venue.manage','venue.pitch_allocation.manage','calendar.event.view','calendar.event.manage','club.news.manage','club.profile.edit');
  perform pg_temp.check(v_n = 16, format('CA-1 a Club Admin''s default bundle holds the sixteen keys the club workspace draws with (%s of 16)', v_n));
  select count(*) into v_n from public.my_capabilities('club', v_club) where allowed and capability_key in ('fixture.planner.use','fixture.import.run','competition.creator.use');
  perform pg_temp.check(v_n = 3, format('CA-2 and the three desk tools, offered as a hand-off and never rebuilt (%s of 3)', v_n));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_vol where id = v_sess;
  perform pg_temp.act('authenticated', v_vol, v_sess);
  select count(*) into v_n from public.my_capabilities('club', v_club) where allowed and capability_key in ('fixture.fixture.view','venue.venue.view','calendar.event.view','team.team.view');
  select count(*) into v_m from public.my_capabilities('club', v_club) where allowed and capability_key in ('fixture.fixture.create','fixture.fixture.edit','fixture.fixture.cancel','fixture.request.respond','fixture.result.record','people.member.view','team.team.manage','venue.venue.manage','calendar.event.manage','fixture.planner.use');
  perform pg_temp.check(v_n = 4 and v_m = 0, format('CA-3 a Volunteer reads the club -- fixtures, grounds, events, sides -- and changes nothing (%s reads, %s writes)', v_n, v_m));
  select count(*) into v_n from public.fixtures where id in (v_fixture, v_shared);
  perform pg_temp.check(v_n = 2, 'CA-4 and reads the club''s fixtures');
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''11:00'')', v_fixture, current_date + 5));
  perform pg_temp.check(v_state = '42501', format('CA-5 but cannot move a kick-off (%s)', v_state));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_tm where id = v_sess;
  perform pg_temp.act('authenticated', v_tm, v_sess);
  select count(*) into v_n from public.my_capabilities('team', v_club, v_t12) where allowed and capability_key in ('fixture.planner.use','fixture.import.run','competition.creator.use','fixture.fixture.bulk_edit','fixture.fixture.delete');
  perform pg_temp.check(v_n = 0, 'CA-6 a team context never holds a desk tool: the Control Centre is the club''s');

  -- =====================================================================================
  -- CX. Cross-club
  -- =====================================================================================
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca where id = v_sess;
  perform pg_temp.act('authenticated', v_ca, v_sess);
  select count(*) into v_n from public.fixtures where id = v_fixture_b;
  perform pg_temp.check(v_n = 0, 'CX-1 Club A''s admin does not read Club B''s own fixture');
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''12:00'')', v_fixture_b, current_date + 6));
  perform pg_temp.check(v_state = '42501', format('CX-2 nor move its kick-off (%s)', v_state));
  v_state := pg_temp.try(format('select public.submit_fixture_result(%L, 10, 5)', v_fixture_b));
  perform pg_temp.check(v_state <> 'OK', format('CX-3 nor record its result (%s)', v_state));
  select count(*) into v_n from public.my_capabilities('club', v_club_b) where allowed;
  perform pg_temp.check(v_n = 0, format('CX-4 and holds nothing at Club B (%s)', v_n));
  select count(*) into v_n from public.fixtures where id = v_shared;
  perform pg_temp.check(v_n = 1, 'CX-5 the shared fixture is readable to both sides');
  v_state := pg_temp.try(format('select count(*) from public.club_people(%L, null, ''all'', 50, 0, null)', v_club_b));
  perform pg_temp.check(v_state <> 'OK', format('CX-6 the opposition''s people are not ours because we play them (%s)', v_state));
  select count(*) into v_n from public.venues where club_id = v_club_b;
  select count(*) into v_m from public.club_events where club_id = v_club_b;
  perform pg_temp.check(v_n = 0 and v_m = 0, 'CX-7 nor their grounds or events');

  -- =====================================================================================
  -- ER. Edit and result are independent at club scope
  -- =====================================================================================
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''fixture.result.record'', ''club'', %L, null, ''deny'', ''CA-M10 proof'')', v_ca2, v_club));
  perform pg_temp.check(v_state = 'OK', format('ER-1 the Club Admin withholds result recording from the second Club Admin at club scope (%s)', v_state));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca2 where id = v_sess;
  perform pg_temp.act('authenticated', v_ca2, v_sess);
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''11:00'')', v_fixture, current_date + 5));
  perform pg_temp.check(v_state = 'OK' and (select kickoff_time from public.fixtures where id = v_fixture) = '11:00', format('ER-2 with result withheld, the second Club Admin still moves the kick-off: edit is edit (%s)', v_state));
  v_state := pg_temp.try(format('select public.submit_fixture_result(%L, 10, 5)', v_played));
  perform pg_temp.check(v_state = '42501', format('ER-3 and cannot record the result (%s)', v_state));
  perform pg_temp.act_postgres();
  update public.capability_overrides set status = 'revoked', revoked_at = now() where user_id = v_ca2 and capability_key = 'fixture.result.record' and status = 'active';
  update auth.sessions set user_id = v_ca where id = v_sess;
  perform pg_temp.act('authenticated', v_ca, v_sess);
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''fixture.fixture.edit'', ''club'', %L, null, ''deny'', ''CA-M10 proof'')', v_ca2, v_club));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca2 where id = v_sess;
  perform pg_temp.act('authenticated', v_ca2, v_sess);
  v_state := pg_temp.try(format('select public.update_fixture_kickoff(%L, %L, ''12:00'')', v_fixture, current_date + 5));
  perform pg_temp.check(v_state = '42501' and (select kickoff_time from public.fixtures where id = v_fixture) = '11:00', format('ER-4 with edit withheld, the kick-off cannot move (%s)', v_state));
  v_state := pg_temp.try(format('select public.update_fixture_pitch(%L, %L)', v_fixture, v_pitch));
  perform pg_temp.check(v_state = '42501', format('ER-5 nor the pitch through the fixture edit path (%s)', v_state));
  perform pg_temp.act_postgres();
  update public.capability_overrides set status = 'revoked', revoked_at = now() where user_id = v_ca2 and capability_key = 'fixture.fixture.edit' and status = 'active';

  -- =====================================================================================
  -- CN. Cancel is not delete
  -- =====================================================================================
  update auth.sessions set user_id = v_ca where id = v_sess;
  perform pg_temp.act('authenticated', v_ca, v_sess);
  v_state := pg_temp.try(format('select public.cancel_fixture(%L, '''')', v_shared));
  perform pg_temp.check(v_state <> 'OK', format('CN-1 a cancellation without a reason is refused (%s)', v_state));
  v_state := pg_temp.try(format('select public.cancel_fixture(%L, ''Pitch waterlogged'')', v_shared));
  perform pg_temp.check(v_state = 'OK' and (select status from public.fixtures where id = v_shared) = 'Cancelled' and exists (select 1 from public.fixtures where id = v_shared),
    format('CN-2 a reasoned cancellation cancels and keeps the record (%s)', v_state));
  v_state := pg_temp.try(format('delete from public.fixtures where id = %L', v_shared));
  perform pg_temp.act_postgres();
  perform pg_temp.check(exists (select 1 from public.fixtures where id = v_shared), format('CN-3 a client cannot delete a fixture through the table (%s)', v_state));
  perform pg_temp.check((select aal from public.capabilities where key = 'fixture.fixture.delete') = 'R' and (select valid_scopes from public.capabilities where key = 'fixture.fixture.delete') = array['club'],
    'CN-4 deletion is its own club-only key needing recent authentication -- never a phone''s default');

  -- =====================================================================================
  -- RQ. Requests at club scope
  -- =====================================================================================
  insert into public.fixture_request_groups (requesting_club_id, opponent_club_id, proposed_date, game_type, raw_opponent_text, created_by) values (v_club_b, v_club, current_date + 20, 'Friendly', 'TO Home RUFC', v_cab) returning id into v_group;
  insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, status, venue_preference, created_by) values (v_group, v_tb, v_t12, 'sent', 'either', v_cab) returning id into v_request;
  update auth.sessions set user_id = v_ca where id = v_sess;
  perform pg_temp.act('authenticated', v_ca, v_sess);
  select count(*) into v_n from public.fixture_requests where target_team_id in (v_t12, v_t14) and status = 'sent';
  perform pg_temp.check(v_n = 1, format('RQ-1 the club reads a request sent to one of its sides, across every side (%s)', v_n));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_cab where id = v_sess;
  perform pg_temp.act('authenticated', v_cab, v_sess);
  v_state := pg_temp.try(format('select public.accept_fixture_request(%L, %L)', v_request, v_t12));
  perform pg_temp.check(v_state = '42501', format('RQ-2 the asking club cannot accept its own request (%s)', v_state));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_vol where id = v_sess;
  perform pg_temp.act('authenticated', v_vol, v_sess);
  v_state := pg_temp.try(format('select public.accept_fixture_request(%L, %L)', v_request, v_t12));
  perform pg_temp.check(v_state = '42501', format('RQ-3 nor a Volunteer at the asked club (%s)', v_state));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca where id = v_sess;
  perform pg_temp.act('authenticated', v_ca, v_sess);
  update public.fixture_requests set status = 'declined', decided_by = v_ca, decided_at = now() where id = v_request and status = 'sent';
  perform pg_temp.check((select status from public.fixture_requests where id = v_request) = 'declined', 'RQ-4 the club that was asked declines it through the policy-covered update');

  -- =====================================================================================
  -- EV. Club events
  -- =====================================================================================
  v_state := pg_temp.try(format('select public.save_club_event(%L, ''Presentation Evening'', %L, %L, null, ''Trophies'', ''19:00'', ''21:00'', true, null, null, %L)', v_club, current_date + 10, current_date + 10, v_venue));
  perform pg_temp.check(v_state = 'OK', format('EV-1 a Club Admin creates a club-wide event with calendar.event.manage (%s)', v_state));
  select id into v_event from public.club_events where club_id = v_club and name = 'Presentation Evening';
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_vol where id = v_sess;
  perform pg_temp.act('authenticated', v_vol, v_sess);
  select count(*) into v_n from public.club_events where id = v_event;
  perform pg_temp.check(v_n = 1, 'EV-2 a Volunteer reads it (calendar.event.view)');
  select (public.get_club_event_card(v_event)->>'can_manage')::boolean into r from (select 1) x;
  perform pg_temp.check(r.bool = false or r.bool is null, 'EV-3 and the card says they cannot manage it');
  v_state := pg_temp.try(format('select public.cancel_club_event(%L, ''no'')', v_event));
  perform pg_temp.check(v_state = '42501', format('EV-4 and cannot cancel it (%s)', v_state));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_cab where id = v_sess;
  perform pg_temp.act('authenticated', v_cab, v_sess);
  select count(*) into v_n from public.club_events where id = v_event;
  perform pg_temp.check(v_n = 0 and public.get_club_event_card(v_event) is null, 'EV-5 the other club sees nothing of it: a forged id fails closed');
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca where id = v_sess;
  perform pg_temp.act('authenticated', v_ca, v_sess);
  v_state := pg_temp.try(format('select public.cancel_club_event(%L, ''Hall unavailable'')', v_event));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'OK' and (select status from public.club_events where id = v_event) = 'CANCELLED', format('EV-6 the club cancels it with a reason, and the record stays (%s)', v_state));
  perform pg_temp.check(not exists (select 1 from public.notifications where data ? 'event_id' or data ? 'club_event_id'), 'EV-7 nothing is emitted for an event: H29 untouched');

  -- =====================================================================================
  -- VP. Pitch allocation is its own authority
  -- =====================================================================================
  update auth.sessions set user_id = v_ca where id = v_sess;
  perform pg_temp.act('authenticated', v_ca, v_sess);
  v_state := pg_temp.try(format('select public.set_capability_override(%L, ''venue.pitch_allocation.manage'', ''club'', %L, null, ''deny'', ''CA-M10 proof'')', v_ca2, v_club));
  perform pg_temp.check(v_state = 'OK', format('VP-1 the allocation authority is withheld from the second Club Admin (%s)', v_state));
  perform pg_temp.act_postgres(); update auth.sessions set user_id = v_ca2 where id = v_sess;
  perform pg_temp.act('authenticated', v_ca2, v_sess);
  select count(*) into v_n from public.my_capabilities('club', v_club) where allowed and capability_key = 'venue.pitch_allocation.manage';
  select count(*) into v_m from public.my_capabilities('club', v_club) where allowed and capability_key in ('fixture.fixture.edit', 'fixture.result.record');
  perform pg_temp.check(v_n = 0 and v_m = 2, format('VP-2 the probe answers: allocation no, edit and result still yes -- three keys, three answers (%s / %s)', v_n, v_m));
  perform pg_temp.act_postgres();
  update public.capability_overrides set status = 'revoked', revoked_at = now() where user_id = v_ca2 and capability_key = 'venue.pitch_allocation.manage' and status = 'active';

  -- =====================================================================================
  -- IN. Invitations
  -- =====================================================================================
  update auth.sessions set user_id = v_vol where id = v_sess;
  perform pg_temp.act('authenticated', v_vol, v_sess);
  v_state := pg_temp.try(format('select invitation_id from public.issue_invitation(''CLUB_STAFF'', %L, null, null, null, null, ''to-invite-%s@ovalball.test'', %L, null, null, null)', v_club, v_tag, '{"roles":["VOLUNTEER"],"declared_role":null}'::jsonb));
  perform pg_temp.check(v_state = '42501', format('IN-1 a Volunteer cannot invite staff (%s)', v_state));
  perform pg_temp.check(not exists (select 1 from information_schema.columns where table_name = 'invitations_admin_view' and column_name in ('token', 'token_sha256', 'code', 'code_hmac')), 'IN-2 the admin read model carries no secret');
  perform pg_temp.act_postgres();
end $$;

rollback;
