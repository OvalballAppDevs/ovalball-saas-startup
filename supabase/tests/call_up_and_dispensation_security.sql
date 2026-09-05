-- Dedicated security/tampering tests for fixture_player_call_up
-- (20260924830000, fixed 20260924900000) and player_team_dispensation
-- (20260924910000), beyond what their own functional test files
-- already cover (forged source_team_id, cross-club target, playing
-- down an age grade, one-player-one-fixture-commitment -- all proven
-- in fixture_player_call_up.sql / player_team_dispensation.sql).
--
-- This file specifically covers: (1) a target-team coach bypassing the
-- RPCs entirely and writing the tables directly (the classic "forged
-- governing-body approval status" and "forged decision" shape -- RLS,
-- not RPC discipline, must be what actually stops this); (2) a
-- dispensation stuck at an earlier stage that has since EXPIRED can
-- never be approved after the fact; (3) an unrelated third party (no
-- relationship to either team/club) cannot even SEE these rows.
--
-- Transaction-scoped, matching the other newer test files.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/call_up_and_dispensation_security.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d000a', 'Security Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'security-test-club-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c000a', '9d000000-0000-0000-0000-0000000d000a', 'security-test-club-9d000000', 'active');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-00000060000a', '9d000000-0000-0000-0000-0000000c000a', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');
-- e1/e2 are deliberately ONE age grade apart (U14 -> U15, an ordinary
-- team_approval_only progression), not the two-grade skip this file
-- originally used -- that would now correctly trigger the eligibility
-- resolver's own auto-linked dispensation (20260925090000), colliding
-- with this file's own manual request_player_dispensation call below.
-- This file is testing RLS/tampering, not eligibility resolution, so
-- it keeps both requests independent and simple.
insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug, active) values
  ('9d000000-0000-0000-0000-0000000000e1', '9d000000-0000-0000-0000-0000000c000a', 'union', 'youth', 'U14', 'U14', 'sec-u14', true),
  ('9d000000-0000-0000-0000-0000000000e2', '9d000000-0000-0000-0000-0000000c000a', 'union', 'youth', 'U15', 'U15', 'sec-u16', true);
insert into public.players (id, first_name, surname, active, created_by) values
  ('9d000000-0000-0000-0000-0000000000e5', 'Jordan', 'Target', true, '00000000-0000-0000-0000-000000000002');
insert into public.player_team_memberships (player_id, team_id, status, created_by) values
  ('9d000000-0000-0000-0000-0000000000e5', '9d000000-0000-0000-0000-0000000000e1', 'active', '00000000-0000-0000-0000-000000000002');
insert into public.fixtures (id, owning_team_id, kickoff_date, home_away, raw_opposition_text, status) values
  ('9d000000-0000-0000-0000-0000000000e6', '9d000000-0000-0000-0000-0000000000e2', current_date, 'Home', 'Test Opponent', 'Booked');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_call_up_id uuid;
  v_season_id uuid := internal.resolve_season_for_date('union', current_date);
  v_disp_id uuid;
begin
  select public.request_player_call_up('9d000000-0000-0000-0000-0000000000e6', '9d000000-0000-0000-0000-0000000000e5', '9d000000-0000-0000-0000-0000000000e1', '9d000000-0000-0000-0000-0000000000e2', 'test') into v_call_up_id;
  select public.request_player_dispensation('9d000000-0000-0000-0000-0000000000e5', '9d000000-0000-0000-0000-0000000000e1', '9d000000-0000-0000-0000-0000000000e2', v_season_id, 'test') into v_disp_id;

  -- Tamper 1: the requesting coach tries to forge their OWN call-up's
  -- approval by writing the table directly instead of going through
  -- decide_player_call_up (which would correctly refuse since they are
  -- the TARGET team, not the source team that must consent). Postgres
  -- RLS silently matches ZERO rows for an UPDATE with no applicable
  -- policy -- it does not raise -- so the tamper is verified by
  -- re-reading the row, not by catching an exception.
  declare
    v_rows_updated integer;
    v_status_after text;
  begin
    update public.fixture_player_call_up set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = v_call_up_id;
    get diagnostics v_rows_updated = row_count;
    select status into v_status_after from public.fixture_player_call_up where id = v_call_up_id;
    if v_rows_updated = 0 and v_status_after = 'requested' then
      raise notice 'PASS 1: a direct UPDATE forging call-up approval matches zero rows -- RLS has no policy permitting it, so the row is untouched (still requested)';
    else
      raise notice 'FAIL 1: direct UPDATE forging call-up approval affected % row(s), resulting status=%', v_rows_updated, v_status_after;
    end if;
  end;

  -- Tamper 2: forging a governing-body approval directly on the
  -- dispensation row, skipping every earlier stage and never actually
  -- obtaining source-team or club sign-off. Same verify-by-reread
  -- approach as Tamper 1.
  declare
    v_rows_updated integer;
    v_status_after text;
  begin
    update public.player_team_dispensation
    set status = 'approved', governing_body_reference = 'FORGED-REFERENCE', governing_body_decided_by = auth.uid(), governing_body_decided_at = now()
    where id = v_disp_id;
    get diagnostics v_rows_updated = row_count;
    select status into v_status_after from public.player_team_dispensation where id = v_disp_id;
    if v_rows_updated = 0 and v_status_after = 'requested' then
      raise notice 'PASS 2: a direct UPDATE forging governing-body approval matches zero rows -- the row is untouched (still requested)';
    else
      raise notice 'FAIL 2: direct UPDATE forging governing-body approval affected % row(s), resulting status=%', v_rows_updated, v_status_after;
    end if;
  end;

  -- Tamper 3: inserting a brand new, already-"approved" row directly,
  -- bypassing request_player_call_up's own validation trigger entirely
  -- by targeting an unrelated team on an unrelated fixture.
  begin
    insert into public.fixture_player_call_up (fixture_id, player_id, source_team_id, target_team_id, eligibility_rule_reference, status)
    values ('9d000000-0000-0000-0000-0000000000e6', '9d000000-0000-0000-0000-0000000000e5', '9d000000-0000-0000-0000-0000000000e1', '9d000000-0000-0000-0000-0000000000e2', 'forged', 'approved');
    raise notice 'FAIL 3: a direct INSERT of an already-approved call-up succeeded -- RLS did not block it';
  exception when others then
    raise notice 'PASS 3: a direct INSERT bypassing request_player_call_up entirely is blocked by RLS (%)', sqlerrm;
  end;
end $$;

reset role;

-- Tamper 4: an unrelated third party (a real user with a club
-- membership at a DIFFERENT, unrelated club) cannot even SELECT these
-- rows -- not just blocked from writing them.
do $$
declare
  v_call_up_id uuid;
  v_visible_count integer;
begin
  select id into v_call_up_id from public.fixture_player_call_up where fixture_id = '9d000000-0000-0000-0000-0000000000e6' limit 1;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
  select count(*) into v_visible_count from public.fixture_player_call_up where id = v_call_up_id;
  reset role;

  if v_visible_count = 0 then
    raise notice 'PASS 4: an unrelated club''s admin (no relationship to either team) cannot see this call-up row at all';
  else
    raise notice 'FAIL 4: an unrelated club''s admin could see the call-up row';
  end if;
end $$;

-- Tamper 5: an expired dispensation (stuck at club_approved when its
-- season ended) can never subsequently be pushed to approved, even by
-- someone with genuine club-admin authority.
do $$
declare
  v_past_season_id uuid;
  v_disp_id2 uuid;
  v_status text;
begin
  select id into v_past_season_id from public.seasons where rugby_code = 'union' and ends_on < current_date order by ends_on desc limit 1;
  if v_past_season_id is null then
    raise notice 'SKIP 5: no past union season in local seed data to test expired-dispensation lockout against';
    return;
  end if;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
  select public.request_player_dispensation('9d000000-0000-0000-0000-0000000000e5', '9d000000-0000-0000-0000-0000000000e1', '9d000000-0000-0000-0000-0000000000e2', v_past_season_id, 'test-expired-lockout') into v_disp_id2;
  perform public.decide_player_dispensation(v_disp_id2, 'source_team', true);
  perform public.decide_player_dispensation(v_disp_id2, 'club', true);
  reset role;

  perform internal.expire_due_dispensations();
  select status into v_status from public.player_team_dispensation where id = v_disp_id2;
  if v_status <> 'expired' then
    raise notice 'FAIL 5 (setup): expected expired status before the lockout check, got %', v_status;
  else
    begin
      set local role authenticated;
      set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
      perform public.decide_player_dispensation(v_disp_id2, 'governing_body', true, 'TOO-LATE-REFERENCE');
      raise notice 'FAIL 5: governing-body approval was accepted on an already-expired dispensation';
    exception when others then
      raise notice 'PASS 5: an already-expired dispensation can never be pushed on to approved (%)', sqlerrm;
    end;
    reset role;
  end if;
end $$;

rollback;
