-- PLAYER REQUESTS Section 15/18J: tamper and edge-case tests for the
-- linked call-up <-> dispensation workflow specifically (beyond what
-- call_up_and_dispensation_security.sql already covers for the
-- pre-existing domains individually).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/player_movement_tamper_tests.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0042', 'Tamper Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tamper-test-club-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c0042', '9d000000-0000-0000-0000-0000000d0042', 'tamper-test-club-9d000000', 'active');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000600042', '9d000000-0000-0000-0000-0000000c0042', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-000000000f50', '9d000000-0000-0000-0000-0000000c0042', 'union', 'colts', 'SeniorColts', null, null, 'Senior Colts', 'tt-sc', true),
  ('9d000000-0000-0000-0000-000000000f51', '9d000000-0000-0000-0000-0000000c0042', 'union', 'senior', null, 'mens', '2nd', 'Men''s 2nd', 'tt-mens2', true);
insert into public.players (id, first_name, surname, date_of_birth, active, created_by) values
  ('9d000000-0000-0000-0000-000000000f52', 'Drew', 'Seventeen', (current_date - interval '17 years')::date, true, '00000000-0000-0000-0000-000000000002');
insert into public.player_team_memberships (player_id, team_id, status, created_by) values
  ('9d000000-0000-0000-0000-000000000f52', '9d000000-0000-0000-0000-000000000f50', 'active', '00000000-0000-0000-0000-000000000002');
insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-000000000f53', '9d000000-0000-0000-0000-000000000f51', current_date, 'Home', 'Test Opponent', 'Booked');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_call_up_id uuid;
  v_disp_id uuid;
  v_status text;
  v_rows_updated integer;
begin
  select public.request_player_call_up('9d000000-0000-0000-0000-000000000f53', '9d000000-0000-0000-0000-000000000f52', '9d000000-0000-0000-0000-000000000f50', '9d000000-0000-0000-0000-000000000f51', 'RFU Regulation 15') into v_call_up_id;
  select eligibility_requirement_id into v_disp_id from public.fixture_player_call_up where id = v_call_up_id;

  -- Tamper: forge the call-up straight to 'requested'/'approved' via a
  -- direct UPDATE, bypassing decide_player_call_up's own eligibility
  -- gate entirely. RLS has no policy permitting a direct write here at
  -- all (only the SECURITY DEFINER RPCs may write these tables), so
  -- this must match zero rows, not raise -- and the row is unaffected.
  update public.fixture_player_call_up set status = 'approved' where id = v_call_up_id;
  get diagnostics v_rows_updated = row_count;
  select status into v_status from public.fixture_player_call_up where id = v_call_up_id;
  if v_rows_updated = 0 and v_status = 'awaiting_eligibility' then
    raise notice 'PASS 1: a direct UPDATE forging a call-up straight to approved (bypassing the eligibility gate) matches zero rows -- still awaiting_eligibility';
  else
    raise notice 'FAIL 1: rows_updated=% status=%', v_rows_updated, v_status;
  end if;

  -- Reject the linked dispensation at its very first stage and confirm
  -- the call-up auto-cancels rather than being left silently stuck.
  perform public.decide_player_dispensation(v_disp_id, 'source_team', false, null, 'Not comfortable lending for adult rugby yet');
  select status into v_status from public.fixture_player_call_up where id = v_call_up_id;
  if v_status = 'rejected' then
    raise notice 'PASS 2: rejecting the linked dispensation at the source-team stage auto-cancels the call-up rather than leaving it stuck';
  else
    raise notice 'FAIL 2: call-up status=%', v_status;
  end if;

  -- Attempting a brand-new call-up for the same player/target now finds
  -- the existing dispensation REJECTED (not approved) and is blocked,
  -- rather than silently creating an unlinked/duplicate path.
  insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
    ('9d000000-0000-0000-0000-000000000f54', '9d000000-0000-0000-0000-000000000f51', current_date + 7, 'Home', 'Test Opponent 2', 'Booked');
  begin
    perform public.request_player_call_up('9d000000-0000-0000-0000-000000000f54', '9d000000-0000-0000-0000-000000000f52', '9d000000-0000-0000-0000-000000000f50', '9d000000-0000-0000-0000-000000000f51', 'RFU Regulation 15');
    raise notice 'FAIL 3: a new call-up was created despite the linked eligibility having been rejected';
  exception when others then
    if sqlerrm like '%rejected%' then
      raise notice 'PASS 3: a new call-up request correctly finds the existing REJECTED dispensation and is blocked (%)', sqlerrm;
    else
      raise notice 'FAIL 3: blocked for unexpected reason: %', sqlerrm;
    end if;
  end;
end $$;

reset role;

-- An unrelated third party (no relationship to this club at all)
-- cannot see the dispensation record this workflow created, even
-- though it was auto-created by the SYSTEM on the requester's behalf
-- rather than through a manual request_player_dispensation call.
do $$
declare
  v_disp_id uuid;
  v_visible_count integer;
begin
  select eligibility_requirement_id into v_disp_id from public.fixture_player_call_up
  where source_team_id = '9d000000-0000-0000-0000-000000000f50' limit 1;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
  select count(*) into v_visible_count from public.player_team_dispensation where id = v_disp_id;
  if v_visible_count = 0 then
    raise notice 'PASS 4: an unrelated club''s admin cannot see the auto-created dispensation at all';
  else
    raise notice 'FAIL 4: unrelated admin saw % row(s)', v_visible_count;
  end if;
  reset role;
end $$;

-- Revoke AFTER the call-up has already unblocked (status='requested')
-- but BEFORE the source team gives its own final approval: the call-up
-- must not be able to proceed on the strength of an approval that no
-- longer holds. Found live during the closure verification pass --
-- revoke_player_dispensation originally only flipped the dispensation
-- itself and never touched an already-unblocked linked call-up.
do $$
declare
  v_call_up_id uuid;
  v_disp_id uuid;
  v_status text;
begin
  insert into public.players (id, first_name, surname, date_of_birth, active, created_by) values
    ('9d000000-0000-0000-0000-000000000f55', 'Revoke', 'Test', (current_date - interval '17 years')::date, true, '00000000-0000-0000-0000-000000000002');
  insert into public.player_team_memberships (player_id, team_id, status, created_by) values
    ('9d000000-0000-0000-0000-000000000f55', '9d000000-0000-0000-0000-000000000f50', 'active', '00000000-0000-0000-0000-000000000002');
  insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
    ('9d000000-0000-0000-0000-000000000f56', '9d000000-0000-0000-0000-000000000f51', current_date + 14, 'Home', 'Test Opponent 3', 'Booked');

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

  select public.request_player_call_up('9d000000-0000-0000-0000-000000000f56', '9d000000-0000-0000-0000-000000000f55', '9d000000-0000-0000-0000-000000000f50', '9d000000-0000-0000-0000-000000000f51', 'RFU Regulation 15') into v_call_up_id;
  select eligibility_requirement_id into v_disp_id from public.fixture_player_call_up where id = v_call_up_id;

  perform public.decide_player_dispensation(v_disp_id, 'source_team', true, null, null);
  perform public.decide_player_dispensation(v_disp_id, 'club', true, null, null);
  perform public.decide_player_dispensation(v_disp_id, 'governing_body', true, 'RFU-DISP-2027-REVOKE', null);

  select status into v_status from public.fixture_player_call_up where id = v_call_up_id;
  if v_status <> 'requested' then
    raise notice 'FAIL 5: expected the call-up unblocked to requested before testing revoke, got %', v_status;
  end if;

  perform public.revoke_player_dispensation(v_disp_id, 'Revoked for testing');

  select status into v_status from public.fixture_player_call_up where id = v_call_up_id;
  if v_status = 'rejected' then
    raise notice 'PASS 5: revoking an already-approved eligibility record AFTER the linked call-up unblocked correctly re-blocks it (rejected), not left approvable';
  else
    raise notice 'FAIL 5: call-up status after revoke = %', v_status;
  end if;

  begin
    perform public.decide_player_call_up(v_call_up_id, 'approve');
    raise notice 'FAIL 6: a call-up was approved after its linked eligibility was revoked';
  exception when others then
    raise notice 'PASS 6: approving a call-up whose eligibility was revoked is rejected (%)', sqlerrm;
  end;

  reset role;
end $$;

rollback;
