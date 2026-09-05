-- FINAL VERIFICATION CLOSURE Section 2: permanent proof that Union and
-- League player requests can never cross-resolve each other's rules,
-- through the REAL public RPCs a client actually calls (not just the
-- internal resolver directly, which player_movement_eligibility_
-- resolver.sql already covers) -- and the remaining Section 4 tamper
-- vectors not already covered by fixture_player_call_up.sql,
-- call_up_and_dispensation_security.sql, or player_movement_tamper_
-- tests.sql (forged cross-code source, folded source/target team,
-- fixture belonging to an unrelated team).
--
-- Root cause of the ORIGINAL rugby-code bug this closure section
-- responds to (a real, reported Burnley RUFC incident, unrelated to
-- this feature's own code): generate_rollover_proposal() accepted a
-- caller-supplied rugby_code with no check that it matched the calling
-- club's own canonical code (fixed in 20260925070000). The invariant
-- that migration established -- a club's rugby_code is read from
-- club_directory, never taken as a bare parameter -- is the SAME
-- invariant this feature relies on: every function below derives
-- rugby_code from a real team row (teams.rugby_code, itself audited
-- against club_directory.rugby_code with zero mismatches across the
-- whole database), never from caller input. There is no parameter
-- named rugby_code anywhere in request_player_call_up, decide_player_
-- call_up, or preview_player_movement_eligibility for an attacker to
-- substitute in the first place.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/player_movement_rugby_code_isolation.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0070', 'RC Isolation Union Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'rc-isolation-union-9d000000'),
  ('9d000000-0000-0000-0000-0000000d0071', 'RC Isolation League Club', 'Testville', 'Testshire', 'league', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'rc-isolation-league-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c0070', '9d000000-0000-0000-0000-0000000d0070', 'rc-isolation-union-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000c0071', '9d000000-0000-0000-0000-0000000d0071', 'rc-isolation-league-9d000000', 'active');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000600070', '9d000000-0000-0000-0000-0000000c0070', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
  ('9d000000-0000-0000-0000-000000600071', '9d000000-0000-0000-0000-0000000c0071', '00000000-0000-0000-0000-000000000003', 'CLUB_ADMIN', 'active');
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-00000000a001', '9d000000-0000-0000-0000-0000000c0070', 'union', 'colts', 'SeniorColts', null, null, 'Senior Colts', 'rciu-sc', true),
  ('9d000000-0000-0000-0000-00000000a002', '9d000000-0000-0000-0000-0000000c0070', 'union', 'senior', null, 'mens', '2nd', 'Men''s 2nd', 'rciu-mens2', true),
  ('9d000000-0000-0000-0000-00000000a003', '9d000000-0000-0000-0000-0000000c0070', 'union', 'youth', 'U12', 'boys', null, 'U12', 'rciu-u12', false),
  ('9d000000-0000-0000-0000-00000000b001', '9d000000-0000-0000-0000-0000000c0071', 'league', 'colts', 'SeniorColts', null, null, 'Senior Colts L', 'rcil-sc', true),
  ('9d000000-0000-0000-0000-00000000b002', '9d000000-0000-0000-0000-0000000c0071', 'league', 'senior', null, 'mens', '2nd', 'Men''s 2nd L', 'rcil-mens2', true);
-- rciu-u12 is inserted active=false directly to model "folded" without
-- going through fold_team()'s own authorization -- fine here, since
-- this test only cares about the resolver's own reaction to teams.active.
insert into public.players (id, first_name, surname, date_of_birth, active, created_by) values
  ('9d000000-0000-0000-0000-00000000c001', 'Union', 'Player17', (current_date - interval '17 years')::date, true, '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-00000000c002', 'League', 'Player17', (current_date - interval '17 years')::date, true, '00000000-0000-0000-0000-000000000003'),
  ('9d000000-0000-0000-0000-00000000c003', 'Folded', 'SourcePlayer', (current_date - interval '17 years')::date, true, '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-00000000c004', 'Fresh', 'FixtureTest', (current_date - interval '17 years')::date, true, '00000000-0000-0000-0000-000000000002');
insert into public.player_team_memberships (player_id, team_id, status, created_by) values
  ('9d000000-0000-0000-0000-00000000c001', '9d000000-0000-0000-0000-00000000a001', 'active', '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-00000000c002', '9d000000-0000-0000-0000-00000000b001', 'active', '00000000-0000-0000-0000-000000000003'),
  ('9d000000-0000-0000-0000-00000000c003', '9d000000-0000-0000-0000-00000000a003', 'active', '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-00000000c004', '9d000000-0000-0000-0000-00000000a001', 'active', '00000000-0000-0000-0000-000000000002');
insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-00000000d001', '9d000000-0000-0000-0000-00000000a002', current_date, 'Home', 'Union Opponent', 'Booked'),
  ('9d000000-0000-0000-0000-00000000d002', '9d000000-0000-0000-0000-00000000b002', current_date, 'Home', 'League Opponent', 'Booked');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_call_up_id uuid;
  v_status text;
  v_preview record;
begin
  -- 1. Real Union request through the actual RPC resolves RFU rules.
  select public.request_player_call_up('9d000000-0000-0000-0000-00000000d001', '9d000000-0000-0000-0000-00000000c001', '9d000000-0000-0000-0000-00000000a001', '9d000000-0000-0000-0000-00000000a002', 'RFU Regulation 15') into v_call_up_id;
  select status into v_status from public.fixture_player_call_up where id = v_call_up_id;
  if v_status = 'awaiting_eligibility' and exists (
    select 1 from public.player_team_dispensation d join public.fixture_player_call_up c on c.eligibility_requirement_id = d.id
    where c.id = v_call_up_id and d.eligibility_rule_reference like '%RFU%'
  ) then
    raise notice 'PASS 1: a real Union request through request_player_call_up resolves RFU rules end to end';
  else
    raise notice 'FAIL 1: status=%', v_status;
  end if;

  -- 2. preview_player_movement_eligibility (the client-facing RPC) agrees with the internal resolver for Union.
  select * into v_preview from public.preview_player_movement_eligibility('9d000000-0000-0000-0000-00000000c001', '9d000000-0000-0000-0000-00000000a001', '9d000000-0000-0000-0000-00000000a002');
  if v_preview.governing_body = 'RFU' then
    raise notice 'PASS 2: preview_player_movement_eligibility correctly reports RFU for a real Union pairing';
  else
    raise notice 'FAIL 2: governing_body=%', v_preview.governing_body;
  end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare
  v_call_up_id uuid;
  v_preview record;
begin
  -- 3. Real League request through the actual RPC resolves RFL rules, never RFU.
  select public.request_player_call_up('9d000000-0000-0000-0000-00000000d002', '9d000000-0000-0000-0000-00000000c002', '9d000000-0000-0000-0000-00000000b001', '9d000000-0000-0000-0000-00000000b002', 'League dispensation') into v_call_up_id;
  if exists (
    select 1 from public.player_team_dispensation d join public.fixture_player_call_up c on c.eligibility_requirement_id = d.id
    where c.id = v_call_up_id and d.eligibility_rule_reference like '%RFL%' and d.eligibility_rule_reference not like '%RFU%'
  ) then
    raise notice 'PASS 3: a real League request through request_player_call_up resolves RFL rules, with no RFU leakage, end to end';
  else
    raise notice 'FAIL 3: did not find an RFL-only linked dispensation';
  end if;

  select * into v_preview from public.preview_player_movement_eligibility('9d000000-0000-0000-0000-00000000c002', '9d000000-0000-0000-0000-00000000b001', '9d000000-0000-0000-0000-00000000b002');
  if v_preview.governing_body = 'RFL' then
    raise notice 'PASS 4: preview_player_movement_eligibility correctly reports RFL (never RFU) for a real League pairing';
  else
    raise notice 'FAIL 4: governing_body=%', v_preview.governing_body;
  end if;
end $$;

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_before_calls integer;
  v_before_disps integer;
  v_after_calls integer;
  v_after_disps integer;
begin
  -- 5. Forged source_team_id pointing at a DIFFERENT club AND a
  -- different rugby code, where the player is not actually a member --
  -- direct ID tampering cannot switch which governing rules apply,
  -- because it cannot get past the membership check at all.
  select count(*) into v_before_calls from public.fixture_player_call_up where player_id = '9d000000-0000-0000-0000-00000000c001';
  select count(*) into v_before_disps from public.player_team_dispensation where player_id = '9d000000-0000-0000-0000-00000000c001';
  begin
    perform public.request_player_call_up('9d000000-0000-0000-0000-00000000d002', '9d000000-0000-0000-0000-00000000c001', '9d000000-0000-0000-0000-00000000b001', '9d000000-0000-0000-0000-00000000b002', 'test');
    raise notice 'FAIL 5: a Union player was accepted with a forged League source team';
  exception when others then
    raise notice 'PASS 5: a forged cross-club, cross-code source_team_id (player not actually a member) is rejected (%)', sqlerrm;
  end;
  select count(*) into v_after_calls from public.fixture_player_call_up where player_id = '9d000000-0000-0000-0000-00000000c001';
  select count(*) into v_after_disps from public.player_team_dispensation where player_id = '9d000000-0000-0000-0000-00000000c001';
  if v_after_calls = v_before_calls and v_after_disps = v_before_disps then
    raise notice 'PASS 6: the rejected cross-code forgery attempt created ZERO records of either kind';
  else
    raise notice 'FAIL 6: call-ups %->% dispensations %->%', v_before_calls, v_after_calls, v_before_disps, v_after_disps;
  end if;

  -- 7. A folded source team can no longer lend a player, even though
  -- the player's own membership row still reads 'active' (fold_team
  -- deliberately never touches membership history).
  begin
    perform public.request_player_call_up('9d000000-0000-0000-0000-00000000d001', '9d000000-0000-0000-0000-00000000c003', '9d000000-0000-0000-0000-00000000a003', '9d000000-0000-0000-0000-00000000a002', 'test');
    raise notice 'FAIL 7: a call-up was accepted from a folded source team';
  exception when others then
    if sqlerrm like '%folded%' then
      raise notice 'PASS 7: a folded source team cannot lend a player, even with an active membership row (%)', sqlerrm;
    else
      raise notice 'FAIL 7: rejected for unexpected reason: %', sqlerrm;
    end if;
  end;

  -- 8. A fixture belonging to a team entirely unrelated to the stated target.
  begin
    perform public.request_player_call_up('9d000000-0000-0000-0000-00000000d002', '9d000000-0000-0000-0000-00000000c004', '9d000000-0000-0000-0000-00000000a001', '9d000000-0000-0000-0000-00000000a002', 'test');
    raise notice 'FAIL 8: a call-up was accepted for a fixture the stated target is not playing';
  exception when others then
    if sqlerrm like '%not one of the teams actually playing%' then
      raise notice 'PASS 8: a fixture belonging to an unrelated team/club (the League fixture, named against a Union target) is rejected on the fixture-ownership check itself (%)', sqlerrm;
    else
      raise notice 'FAIL 8: rejected for an unexpected reason (expected the fixture-ownership check): %', sqlerrm;
    end if;
  end;
end $$;

reset role;
rollback;
