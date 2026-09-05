-- Manual verification for 20260924830000_fixture_player_call_up.sql:
-- request_player_call_up()/decide_player_call_up(), the structural
-- validation trigger (forged source_team_id, cross-club target, target
-- not actually playing the fixture, playing DOWN an age grade), and
-- the one-player-one-physical-fixture-commitment invariant enforced at
-- approval.
--
-- Transaction-scoped (like season_transitions.sql and senior_cohort_
-- graduation.sql): genuinely inserts real fixtures/player_team_
-- memberships rows, so the whole file rolls back at the end.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_player_call_up.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0006', 'Call-Up Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'call-up-test-club-9d000000'),
  ('9d000000-0000-0000-0000-0000000d0007', 'Call-Up Test Club B', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'call-up-test-club-b-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c0006', '9d000000-0000-0000-0000-0000000d0006', 'call-up-test-club-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000c0007', '9d000000-0000-0000-0000-0000000d0007', 'call-up-test-club-b-9d000000', 'active');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000600006', '9d000000-0000-0000-0000-0000000c0006', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
  ('9d000000-0000-0000-0000-000000600007', '9d000000-0000-0000-0000-0000000c0007', '00000000-0000-0000-0000-000000000003', 'CLUB_ADMIN', 'active');
-- U12 (source, the player's real team), U13 (target -- one age up,
-- valid), U11 (a decoy at the same club not playing the fixture and
-- also the wrong direction), plus one team at the OTHER club (foreign).
-- b6 is a SECOND one-age-up team (U13 B, not U14) -- deliberately
-- still an ordinary team_approval_only progression from U12, so PASS
-- 8/9 below exercise the same-day-conflict rule in isolation, not the
-- separate (and separately tested) eligibility-resolver gate a genuine
-- U12->U14 two-grade skip would now correctly trigger.
insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-0000000000b1', '9d000000-0000-0000-0000-0000000c0006', 'union', 'youth', 'U12', null, 'U12', 'cu-u12', true),
  ('9d000000-0000-0000-0000-0000000000b2', '9d000000-0000-0000-0000-0000000c0006', 'union', 'youth', 'U13', null, 'U13', 'cu-u13', true),
  ('9d000000-0000-0000-0000-0000000000b3', '9d000000-0000-0000-0000-0000000c0006', 'union', 'youth', 'U11', null, 'U11', 'cu-u11', true),
  ('9d000000-0000-0000-0000-0000000000b4', '9d000000-0000-0000-0000-0000000c0007', 'union', 'youth', 'U13', null, 'U13', 'cu-foreign-u13', true),
  ('9d000000-0000-0000-0000-0000000000b6', '9d000000-0000-0000-0000-0000000c0006', 'union', 'youth', 'U13', 'B', 'U13 B', 'cu-u14', true);
insert into public.players (id, first_name, surname, active, created_by) values
  ('9d000000-0000-0000-0000-0000000000b5', 'Jamie', 'Callup', true, '00000000-0000-0000-0000-000000000002');
insert into public.player_team_memberships (player_id, team_id, status, created_by) values
  ('9d000000-0000-0000-0000-0000000000b5', '9d000000-0000-0000-0000-0000000000b1', 'active', '00000000-0000-0000-0000-000000000002');
-- Fixture A: U13 (target) plays at home today -- the real call-up target.
insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-0000000000c1', '9d000000-0000-0000-0000-0000000000b2', current_date, 'Home', 'Test Opponent A', 'Booked');
-- Fixture B: U11 plays on the SAME day -- used for the playing-down test.
insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-0000000000c2', '9d000000-0000-0000-0000-0000000000b3', current_date, 'Home', 'Test Opponent B', 'Booked');
-- Fixture C: U13 B also plays on the SAME day -- a second, direction-
-- valid call-up target used purely for the one-commitment test.
insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-0000000000c3', '9d000000-0000-0000-0000-0000000000b6', current_date, 'Home', 'Test Opponent C', 'Booked');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_id uuid;
  v_status text;
begin
  -- PASS 1: a valid call-up (U12 player, up to U13, U13 actually
  -- playing fixture A) can be requested.
  select public.request_player_call_up('9d000000-0000-0000-0000-0000000000c1', '9d000000-0000-0000-0000-0000000000b5', '9d000000-0000-0000-0000-0000000000b1', '9d000000-0000-0000-0000-0000000000b2', 'RFU Regulation 15 -- playing up one age grade') into v_id;
  select status into v_status from public.fixture_player_call_up where id = v_id;
  if v_status = 'requested' then
    raise notice 'PASS 1: a valid call-up (U12 player moving up to U13 for the fixture U13 is actually playing) can be requested';
  else
    raise notice 'FAIL 1: status=%', v_status;
  end if;

  -- PASS 2: the source club's admin approves it.
  perform public.decide_player_call_up(v_id, 'approve');
  select status into v_status from public.fixture_player_call_up where id = v_id;
  if v_status = 'approved' then
    raise notice 'PASS 2: the source team''s own club admin can approve the call-up';
  else
    raise notice 'FAIL 2: status=%', v_status;
  end if;

  -- PASS 3: canonical membership was NEVER touched.
  if exists (select 1 from public.player_team_memberships where player_id = '9d000000-0000-0000-0000-0000000000b5' and team_id = '9d000000-0000-0000-0000-0000000000b2') then
    raise notice 'FAIL 3: the call-up created a real player_team_memberships row on the target team';
  else
    raise notice 'PASS 3: canonical team membership was never mutated -- the player is still only a real member of U12';
  end if;
end $$;

-- Reject: forged source_team_id (player is not actually a member of U11).
do $$
begin
  perform public.request_player_call_up('9d000000-0000-0000-0000-0000000000c1', '9d000000-0000-0000-0000-0000000000b5', '9d000000-0000-0000-0000-0000000000b3', '9d000000-0000-0000-0000-0000000000b2', 'test');
  raise notice 'FAIL 4: a forged source_team_id (player not actually a member) was accepted';
exception when others then
  raise notice 'PASS 4: a forged source_team_id is rejected (%)', sqlerrm;
end $$;

-- Reject: target not actually playing the stated fixture.
do $$
begin
  perform public.request_player_call_up('9d000000-0000-0000-0000-0000000000c2', '9d000000-0000-0000-0000-0000000000b5', '9d000000-0000-0000-0000-0000000000b1', '9d000000-0000-0000-0000-0000000000b2', 'test');
  raise notice 'FAIL 5: called up onto a team that is not actually playing the stated fixture';
exception when others then
  raise notice 'PASS 5: target_team_id not playing the stated fixture is rejected (%)', sqlerrm;
end $$;

-- Reject: playing DOWN an age grade (U12 player "called up" to U11,
-- who are genuinely playing fixture B).
do $$
begin
  perform public.request_player_call_up('9d000000-0000-0000-0000-0000000000c2', '9d000000-0000-0000-0000-0000000000b5', '9d000000-0000-0000-0000-0000000000b1', '9d000000-0000-0000-0000-0000000000b3', 'test');
  raise notice 'FAIL 6: a call-up moving a player DOWN an age grade was accepted';
exception when others then
  raise notice 'PASS 6: moving a player down an age grade is rejected (%)', sqlerrm;
end $$;

-- Reject: cross-club (foreign) target team.
do $$
begin
  perform public.request_player_call_up('9d000000-0000-0000-0000-0000000000c1', '9d000000-0000-0000-0000-0000000000b5', '9d000000-0000-0000-0000-0000000000b1', '9d000000-0000-0000-0000-0000000000b4', 'test');
  raise notice 'FAIL 7: a cross-club call-up target was accepted';
exception when others then
  raise notice 'PASS 7: a cross-club target is rejected (%)', sqlerrm;
end $$;

-- One-player-one-physical-fixture-commitment: the U12 player already
-- holds an APPROVED call-up to fixture A today (from the first block
-- above). A second, direction-valid call-up to fixture C (U13 B, also
-- today) can still be REQUESTED (harmless while merely pending) but
-- must be REJECTED the moment anyone tries to approve it.
do $$
declare
  v_id2 uuid;
  v_status2 text;
begin
  select public.request_player_call_up('9d000000-0000-0000-0000-0000000000c3', '9d000000-0000-0000-0000-0000000000b5', '9d000000-0000-0000-0000-0000000000b1', '9d000000-0000-0000-0000-0000000000b6', 'test') into v_id2;
  select status into v_status2 from public.fixture_player_call_up where id = v_id2;
  if v_status2 = 'requested' then
    raise notice 'PASS 8: a second, direction-valid call-up for the same player on the same day can still be REQUESTED (merely speculative until approved)';
  else
    raise notice 'FAIL 8: unexpected status=%', v_status2;
  end if;

  begin
    perform public.decide_player_call_up(v_id2, 'approve');
    raise notice 'FAIL 9: a second same-day call-up was approved despite the player already holding an approved commitment for that date';
  exception when others then
    raise notice 'PASS 9: approving a second same-day commitment is rejected -- a player may hold only one physical fixture commitment per day (%)', sqlerrm;
  end;
end $$;

reset role;
rollback;
