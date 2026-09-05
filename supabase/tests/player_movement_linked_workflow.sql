-- Manual verification for 20260925090000/20260925100000: the LINKED
-- call-up <-> dispensation workflow end to end. Two records, never
-- flattened: a fixture_player_call_up that cannot become playable
-- while its eligibility_requirement_id points at anything but an
-- approved player_team_dispensation, and a dispensation that carries
-- its own full staged chain regardless of whether a call-up triggered it.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/player_movement_linked_workflow.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0040', 'Linked Workflow Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'linked-workflow-test-club-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c0040', '9d000000-0000-0000-0000-0000000d0040', 'linked-workflow-test-club-9d000000', 'active');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000600040', '9d000000-0000-0000-0000-0000000c0040', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-000000000f01', '9d000000-0000-0000-0000-0000000c0040', 'union', 'colts', 'SeniorColts', null, null, 'Senior Colts', 'lwt-sc', true),
  ('9d000000-0000-0000-0000-000000000f02', '9d000000-0000-0000-0000-0000000c0040', 'union', 'senior', null, 'mens', '2nd', 'Men''s 2nd', 'lwt-mens2', true);
insert into public.players (id, first_name, surname, date_of_birth, active, created_by) values
  ('9d000000-0000-0000-0000-000000000f10', 'Robin', 'Seventeen', (current_date - interval '17 years')::date, true, '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-000000000f11', 'Sam', 'Sixteen', (current_date - interval '16 years')::date, true, '00000000-0000-0000-0000-000000000002');
insert into public.player_team_memberships (player_id, team_id, status, created_by) values
  ('9d000000-0000-0000-0000-000000000f10', '9d000000-0000-0000-0000-000000000f01', 'active', '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-000000000f11', '9d000000-0000-0000-0000-000000000f01', 'active', '00000000-0000-0000-0000-000000000002');
insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-000000000f20', '9d000000-0000-0000-0000-000000000f02', current_date, 'Home', 'Test Opponent', 'Booked');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_call_up_id uuid;
  v_disp_id uuid;
  v_status text;
  v_disp_status text;
begin
  -- D. 17-year-old -> adult without approval: request itself succeeds
  -- (drafted, not rejected outright) but lands blocked, linked to a
  -- freshly auto-created dispensation.
  select public.request_player_call_up('9d000000-0000-0000-0000-000000000f20', '9d000000-0000-0000-0000-000000000f10', '9d000000-0000-0000-0000-000000000f01', '9d000000-0000-0000-0000-000000000f02', 'RFU Regulation 15') into v_call_up_id;
  select status, eligibility_requirement_id into v_status, v_disp_id from public.fixture_player_call_up where id = v_call_up_id;
  if v_status = 'awaiting_eligibility' and v_disp_id is not null then
    raise notice 'PASS 1: a 17yo->adult call-up is drafted but blocked, linked to an auto-created dispensation';
  else
    raise notice 'FAIL 1: status=% disp_id=%', v_status, v_disp_id;
  end if;

  select status into v_disp_status from public.player_team_dispensation where id = v_disp_id;
  if v_disp_status = 'requested' then
    raise notice 'PASS 2: the linked dispensation starts at requested, exactly like a manually-requested one';
  else
    raise notice 'FAIL 2: disp_status=%', v_disp_status;
  end if;

  -- Hard block: approving the call-up while awaiting_eligibility must fail.
  begin
    perform public.decide_player_call_up(v_call_up_id, 'approve');
    raise notice 'FAIL 3: a call-up was approved while its eligibility was still pending';
  exception when others then
    if sqlerrm like '%cannot be approved until%' then
      raise notice 'PASS 3: approving a call-up while eligibility is pending is hard-blocked (%)', sqlerrm;
    else
      raise notice 'FAIL 3: blocked for unexpected reason: %', sqlerrm;
    end if;
  end;

  -- Walk the real chain: source team -> club -> governing body.
  perform public.decide_player_dispensation(v_disp_id, 'source_team', true, null, null);
  perform public.decide_player_dispensation(v_disp_id, 'club', true, null, null);
  perform public.decide_player_dispensation(v_disp_id, 'governing_body', true, 'RFU-DISP-2027-9001', null);

  select status into v_disp_status from public.player_team_dispensation where id = v_disp_id;
  select status into v_status from public.fixture_player_call_up where id = v_call_up_id;
  if v_disp_status = 'approved' and v_status = 'requested' then
    raise notice 'PASS 4: once the dispensation is fully approved, the linked call-up automatically unblocks back to requested';
  else
    raise notice 'FAIL 4: disp_status=% call_up_status=%', v_disp_status, v_status;
  end if;

  -- Now the source team can genuinely decide it.
  perform public.decide_player_call_up(v_call_up_id, 'approve');
  select status into v_status from public.fixture_player_call_up where id = v_call_up_id;
  if v_status = 'approved' then
    raise notice 'PASS 5: with eligibility now approved, the source team''s own approval succeeds for real';
  else
    raise notice 'FAIL 5: status=%', v_status;
  end if;

  -- E/reuse: a SECOND fixture for the SAME player+target+season reuses
  -- the already-approved dispensation instead of creating a duplicate
  -- (which would violate the real unique constraint) and is
  -- immediately requestable, no second eligibility wait.
  insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
    ('9d000000-0000-0000-0000-000000000f21', '9d000000-0000-0000-0000-000000000f02', current_date + 7, 'Home', 'Test Opponent 2', 'Booked');
  declare
    v_call_up_id2 uuid;
    v_status2 text;
    v_disp_id2 uuid;
  begin
    select public.request_player_call_up('9d000000-0000-0000-0000-000000000f21', '9d000000-0000-0000-0000-000000000f10', '9d000000-0000-0000-0000-000000000f01', '9d000000-0000-0000-0000-000000000f02', 'RFU Regulation 15') into v_call_up_id2;
    select status, eligibility_requirement_id into v_status2, v_disp_id2 from public.fixture_player_call_up where id = v_call_up_id2;
    if v_status2 = 'requested' and v_disp_id2 = v_disp_id then
      raise notice 'PASS 6: a second fixture for the same already-approved player/team/season reuses the SAME dispensation and starts requestable immediately';
    else
      raise notice 'FAIL 6: status=% disp_id=% (expected %)', v_status2, v_disp_id2, v_disp_id;
    end if;
  end;
end $$;

-- C/D counterpart: a 16-year-old requesting the SAME adult team is
-- hard-blocked outright, no call-up or dispensation record created at all.
do $$
declare
  v_before_calls integer; v_before_disps integer; v_after_calls integer; v_after_disps integer;
begin
  select count(*) into v_before_calls from public.fixture_player_call_up where player_id = '9d000000-0000-0000-0000-000000000f11';
  select count(*) into v_before_disps from public.player_team_dispensation where player_id = '9d000000-0000-0000-0000-000000000f11';
  begin
    perform public.request_player_call_up('9d000000-0000-0000-0000-000000000f20', '9d000000-0000-0000-0000-000000000f11', '9d000000-0000-0000-0000-000000000f01', '9d000000-0000-0000-0000-000000000f02', 'test');
    raise notice 'FAIL 7: a 16-year-old was allowed to request a call-up onto an adult team';
  exception when others then
    if sqlerrm like '%at least 17%' then
      raise notice 'PASS 7: a 16-year-old is hard-blocked from an adult-team call-up outright (%)', sqlerrm;
    else
      raise notice 'FAIL 7: blocked for unexpected reason: %', sqlerrm;
    end if;
  end;
  select count(*) into v_after_calls from public.fixture_player_call_up where player_id = '9d000000-0000-0000-0000-000000000f11';
  select count(*) into v_after_disps from public.player_team_dispensation where player_id = '9d000000-0000-0000-0000-000000000f11';
  if v_after_calls = v_before_calls and v_after_disps = v_before_disps then
    raise notice 'PASS 8: the hard-blocked attempt created NEITHER a call-up NOR a dispensation record';
  else
    raise notice 'FAIL 8: call_up count %->% disp count %->%', v_before_calls, v_after_calls, v_before_disps, v_after_disps;
  end if;
end $$;

reset role;
rollback;
