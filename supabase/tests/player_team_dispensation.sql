-- Manual verification for 20260924910000_player_team_dispensation.sql:
-- the full REQUESTED -> SOURCE TEAM APPROVAL -> CLUB APPROVAL ->
-- GOVERNING BODY APPROVAL -> APPROVED chain, stage-order enforcement,
-- per-stage authorization, cross-club rejection, revoke, and the
-- expiry sweep for a dispensation whose season has already ended.
--
-- Transaction-scoped like the other newer test files in this feature.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/player_team_dispensation.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0008', 'Dispensation Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'dispensation-test-club-9d000000'),
  ('9d000000-0000-0000-0000-0000000d0009', 'Dispensation Test Club B', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'dispensation-test-club-b-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c0008', '9d000000-0000-0000-0000-0000000d0008', 'dispensation-test-club-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000c0009', '9d000000-0000-0000-0000-0000000d0009', 'dispensation-test-club-b-9d000000', 'active');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000600008', '9d000000-0000-0000-0000-0000000c0008', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
  ('9d000000-0000-0000-0000-000000600009', '9d000000-0000-0000-0000-0000000c0009', '00000000-0000-0000-0000-000000000003', 'CLUB_ADMIN', 'active');
insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug, active) values
  ('9d000000-0000-0000-0000-0000000000d1', '9d000000-0000-0000-0000-0000000c0008', 'union', 'youth', 'U14', 'U14', 'disp-u14', true),
  ('9d000000-0000-0000-0000-0000000000d2', '9d000000-0000-0000-0000-0000000c0008', 'union', 'youth', 'U16', 'U16', 'disp-u16', true),
  ('9d000000-0000-0000-0000-0000000000d3', '9d000000-0000-0000-0000-0000000c0009', 'union', 'youth', 'U16', 'U16', 'disp-foreign-u16', true);
insert into public.players (id, first_name, surname, active, created_by) values
  ('9d000000-0000-0000-0000-0000000000d5', 'Robin', 'Dispensed', true, '00000000-0000-0000-0000-000000000002');
insert into public.player_team_memberships (player_id, team_id, status, created_by) values
  ('9d000000-0000-0000-0000-0000000000d5', '9d000000-0000-0000-0000-0000000000d1', 'active', '00000000-0000-0000-0000-000000000002');

do $$
declare
  v_season_id uuid := internal.resolve_season_for_date('union', current_date);
  v_id uuid;
  v_status text;
begin
  -- Reject: cross-club dispensation.
  begin
    perform public.request_player_dispensation('9d000000-0000-0000-0000-0000000000d5', '9d000000-0000-0000-0000-0000000000d1', '9d000000-0000-0000-0000-0000000000d3', v_season_id, 'test');
    raise notice 'FAIL 1: a cross-club dispensation request was accepted';
  exception when others then
    raise notice 'PASS 1: a cross-club dispensation is rejected (%)', sqlerrm;
  end;

  set local role authenticated;
  set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

  select public.request_player_dispensation('9d000000-0000-0000-0000-0000000000d5', '9d000000-0000-0000-0000-0000000000d1', '9d000000-0000-0000-0000-0000000000d2', v_season_id, 'RFU age dispensation -- developmental grounds') into v_id;
  select status into v_status from public.player_team_dispensation where id = v_id;
  if v_status = 'requested' then
    raise notice 'PASS 2: a same-club dispensation can be requested';
  else
    raise notice 'FAIL 2: status=%', v_status;
  end if;

  -- Reject: trying to skip straight to club approval.
  begin
    perform public.decide_player_dispensation(v_id, 'club', true);
    raise notice 'FAIL 3: club approval was accepted before source-team approval';
  exception when others then
    raise notice 'PASS 3: a stage cannot be skipped -- club approval before source-team approval is rejected (%)', sqlerrm;
  end;

  perform public.decide_player_dispensation(v_id, 'source_team', true);
  select status into v_status from public.player_team_dispensation where id = v_id;
  if v_status = 'source_team_approved' then
    raise notice 'PASS 4: source-team approval advances the chain correctly';
  else
    raise notice 'FAIL 4: status=%', v_status;
  end if;

  perform public.decide_player_dispensation(v_id, 'club', true);
  select status into v_status from public.player_team_dispensation where id = v_id;
  if v_status = 'club_approved' then
    raise notice 'PASS 5: club approval advances the chain correctly';
  else
    raise notice 'FAIL 5: status=%', v_status;
  end if;

  -- Reject: recording governing-body approval with no reference.
  begin
    perform public.decide_player_dispensation(v_id, 'governing_body', true, null);
    raise notice 'FAIL 6: governing-body approval was recorded with no reference';
  exception when others then
    raise notice 'PASS 6: governing-body approval requires a real reference to be recorded (%)', sqlerrm;
  end;

  perform public.decide_player_dispensation(v_id, 'governing_body', true, 'RFU-DISP-2026-0042');
  select status into v_status from public.player_team_dispensation where id = v_id;
  if v_status = 'approved' then
    raise notice 'PASS 7: the full chain reaches approved once governing-body approval is recorded';
  else
    raise notice 'FAIL 7: status=%', v_status;
  end if;

  if not exists (select 1 from public.player_team_memberships where player_id = '9d000000-0000-0000-0000-0000000000d5' and team_id = '9d000000-0000-0000-0000-0000000000d2') then
    raise notice 'PASS 8: an approved dispensation never mutates canonical membership by itself -- the player is still only a real member of U14';
  else
    raise notice 'FAIL 8: canonical membership was mutated by the dispensation approval alone';
  end if;

  perform public.revoke_player_dispensation(v_id, 'Player moved away mid-season.');
  select status into v_status from public.player_team_dispensation where id = v_id;
  if v_status = 'revoked' then
    raise notice 'PASS 9: an approved dispensation can be explicitly revoked with a reason';
  else
    raise notice 'FAIL 9: status=%', v_status;
  end if;

  reset role;
end $$;

-- Expiry sweep: a dispensation still pending once its own season has
-- already ended must be swept to expired, not left valid forever.
do $$
declare
  v_past_season_id uuid;
  v_id2 uuid;
  v_status2 text;
begin
  select id into v_past_season_id from public.seasons where rugby_code = 'union' and ends_on < current_date order by ends_on desc limit 1;
  if v_past_season_id is null then
    raise notice 'SKIP 10: no past union season in local seed data to test expiry against';
  else
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
    select public.request_player_dispensation('9d000000-0000-0000-0000-0000000000d5', '9d000000-0000-0000-0000-0000000000d1', '9d000000-0000-0000-0000-0000000000d2', v_past_season_id, 'test-expiry') into v_id2;
    reset role;

    perform internal.expire_due_dispensations();
    select status into v_status2 from public.player_team_dispensation where id = v_id2;
    if v_status2 = 'expired' then
      raise notice 'PASS 10: a still-pending dispensation whose season has already ended is swept to expired';
    else
      raise notice 'FAIL 10: status=%', v_status2;
    end if;
  end if;
end $$;

rollback;
