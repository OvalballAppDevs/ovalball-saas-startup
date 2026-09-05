-- Real, pre-existing bug found auditing Pitch Allocation for the
-- group-vs-group pass (unrelated to Mini-Rugby groups -- reproduced with
-- a plain ordinary fixture): update_fixture_schedule's venue/pitch
-- sections gated on the OWNING side being literally 'Home', and resolved
-- the "home club" from owning_team_id unconditionally -- so a fixture
-- genuinely hosted by the OPPONENT/accepting side (home_away='Away' from
-- the owning/requesting side's own perspective -- a normal, common real
-- flow, not an edge case) could never have a pitch or venue set at all.
-- Fixed to key off the GENERATED home_team_id column, matching what
-- Pitch Allocation's own read layer (data.ts) already correctly does.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/pitch_venue_home_side_fix.sql

\set ON_ERROR_STOP off
\pset pager off
begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000000ea', 'OppHome Test Club A', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'opphome-test-club-a-9d000000'),
  ('9d000000-0000-0000-0000-0000000000eb', 'OppHome Test Club B', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'opphome-test-club-b-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000000ea', '9d000000-0000-0000-0000-0000000000ea', 'opphome-test-club-a-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000000eb', '9d000000-0000-0000-0000-0000000000eb', 'opphome-test-club-b-9d000000', 'active');
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-000000009a01', '9d000000-0000-0000-0000-0000000000ea', 'union', 'youth', 'U12', 'boys', null, 'OppHome A U12', 'opphome-a-u12', true),
  ('9d000000-0000-0000-0000-000000009b01', '9d000000-0000-0000-0000-0000000000eb', 'union', 'youth', 'U12', 'boys', null, 'OppHome B U12', 'opphome-b-u12', true);
insert into public.club_pitches (id, club_id, display_name, active) values
  ('9d000000-0000-0000-0000-000000009b02', '9d000000-0000-0000-0000-0000000000eb', 'B Pitch 1', true),
  ('9d000000-0000-0000-0000-000000009a02', '9d000000-0000-0000-0000-0000000000ea', 'A Pitch 1', true);
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-0000000009c1', '9d000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-000000000003', 'CLUB_ADMIN', 'active'),
  ('9d000000-0000-0000-0000-0000000009c2', '9d000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');

-- Club A (owning) is genuinely AWAY -- Club B (opponent) is genuinely HOME.
insert into public.fixtures (id, owning_team_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
values ('9d000000-0000-0000-0000-000000009f01', '9d000000-0000-0000-0000-000000009a01', '9d000000-0000-0000-0000-000000009b01', current_date + 30, 'Away', 'Booked', 'OppHome B U12', 'club_created');
-- A fixture with no determined side at all.
insert into public.fixtures (id, owning_team_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text, source)
values ('9d000000-0000-0000-0000-000000009f02', '9d000000-0000-0000-0000-000000009a01', '9d000000-0000-0000-0000-000000009b01', current_date + 31, 'TBD', 'To Be Determined', 'OppHome B U12', 'club_created');

do $$
declare v_home_team_id uuid;
begin
  select home_team_id into v_home_team_id from public.fixtures where id = '9d000000-0000-0000-0000-000000009f01';
  if v_home_team_id = '9d000000-0000-0000-0000-000000009b01' then
    raise notice 'PASS setup: home_team_id correctly resolves to Club B''s team (the genuine host)';
  else
    raise notice 'FAIL setup: home_team_id=%', v_home_team_id;
  end if;
end $$;

-- === A. The genuine host (Club B, the opponent/accepting side) CAN set
-- their own pitch -- the bug this fixes. ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare v_result record;
begin
  select * into v_result from public.update_fixture_schedule(
    p_fixture_id := '9d000000-0000-0000-0000-000000009f01', p_kickoff_date := current_date + 30, p_kickoff_time := '14:00',
    p_venue_id := null, p_pitch_id := '9d000000-0000-0000-0000-000000009b02', p_source := 'PITCH_ALLOCATION'
  );
  if v_result.applied_pitch_id = '9d000000-0000-0000-0000-000000009b02' then
    raise notice 'PASS A: the genuine host (opponent/accepting side) can set their own pitch on a fixture where they are home';
  else
    raise notice 'FAIL A: applied_pitch_id=%', v_result.applied_pitch_id;
  end if;
end $$;
reset role;

-- === B. The AWAY side (owning/requesting club) cannot set Club B's pitch
-- as if it were their own -- the pitch-ownership check still protects
-- against the wrong club's pitch being assigned, regardless of who calls. ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  begin
    perform public.update_fixture_schedule(
      p_fixture_id := '9d000000-0000-0000-0000-000000009f01', p_kickoff_date := current_date + 30, p_kickoff_time := '15:00',
      p_venue_id := null, p_pitch_id := '9d000000-0000-0000-0000-000000009a02', p_source := 'PITCH_ALLOCATION'
    );
    raise notice 'FAIL B: the away/owning club was allowed to set THEIR OWN pitch on a fixture where they are not home';
  exception when others then
    raise notice 'PASS B: the away side cannot set their own pitch on a fixture where the opponent is genuinely home (%)', sqlerrm;
  end;
end $$;
reset role;

-- === C. A genuinely undetermined-side (TBD) fixture still correctly
-- rejects any pitch assignment -- the fix narrows the check to home_team_id
-- IS NULL, it does not remove the "no home side yet" guard entirely. ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  begin
    perform public.update_fixture_schedule(
      p_fixture_id := '9d000000-0000-0000-0000-000000009f02', p_kickoff_date := current_date + 31, p_kickoff_time := '14:00',
      p_venue_id := null, p_pitch_id := '9d000000-0000-0000-0000-000000009b02', p_source := 'PITCH_ALLOCATION'
    );
    raise notice 'FAIL C: a pitch was accepted on a TBD (no determined home side) fixture';
  exception when others then
    raise notice 'PASS C: a TBD fixture (no genuine home side yet) still correctly rejects a pitch assignment (%)', sqlerrm;
  end;
end $$;
reset role;

rollback;
