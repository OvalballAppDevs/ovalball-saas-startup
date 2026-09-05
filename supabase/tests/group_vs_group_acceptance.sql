-- GROUP-VS-GROUP: request/acceptance architecture (Section 12/69) --
-- proves accept_fixture_request preserves a target_scheduling_group_id
-- as a genuine opponent_scheduling_group_id (rather than collapsing it
-- to one team, as it did before this pass) while still producing
-- exactly ONE canonical fixtures row, and that the pre-existing
-- request-locking state machine (which is what actually provides
-- concurrency safety -- unchanged by this pass) still rejects a second
-- accept attempt on an already-decided request.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/group_vs_group_acceptance.sql

\set ON_ERROR_STOP off
\pset pager off
begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000000ea', 'GvG Accept Club A', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'gvg-accept-club-a-9d000000'),
  ('9d000000-0000-0000-0000-0000000000eb', 'GvG Accept Club B', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'gvg-accept-club-b-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000000cd', '9d000000-0000-0000-0000-0000000000ea', 'gvg-accept-club-a-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000000ce', '9d000000-0000-0000-0000-0000000000eb', 'gvg-accept-club-b-9d000000', 'active');

insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-000000000ea9', 'GvG Accept Test Season', current_date - 100, current_date + 100, current_date - 110, 'union', 2195, true);

insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-00000000d601', '9d000000-0000-0000-0000-0000000000cd', 'union', 'youth', 'U6', null, null, 'Accept A U6', 'accept-a-u6', true),
  ('9d000000-0000-0000-0000-00000000d701', '9d000000-0000-0000-0000-0000000000cd', 'union', 'youth', 'U7', null, null, 'Accept A U7', 'accept-a-u7', true),
  ('9d000000-0000-0000-0000-00000000d602', '9d000000-0000-0000-0000-0000000000ce', 'union', 'youth', 'U6', null, null, 'Accept B U6', 'accept-b-u6', true),
  ('9d000000-0000-0000-0000-00000000d702', '9d000000-0000-0000-0000-0000000000ce', 'union', 'youth', 'U7', null, null, 'Accept B U7', 'accept-b-u7', true),
  ('9d000000-0000-0000-0000-00000000d703', '9d000000-0000-0000-0000-0000000000ce', 'union', 'youth', 'U7', null, 'B', 'Accept B U7 solo', 'accept-b-u7-solo', true);

insert into public.scheduling_groups (id, club_id, display_tag, active, season_id) values
  ('9d000000-0000-0000-0000-000000000da1', '9d000000-0000-0000-0000-0000000000cd', 'U6/U7', true, '9d000000-0000-0000-0000-000000000ea9'),
  ('9d000000-0000-0000-0000-000000000db1', '9d000000-0000-0000-0000-0000000000ce', 'U6/U7', true, '9d000000-0000-0000-0000-000000000ea9');
insert into public.scheduling_group_members (group_id, team_id) values
  ('9d000000-0000-0000-0000-000000000da1', '9d000000-0000-0000-0000-00000000d601'),
  ('9d000000-0000-0000-0000-000000000da1', '9d000000-0000-0000-0000-00000000d701'),
  ('9d000000-0000-0000-0000-000000000db1', '9d000000-0000-0000-0000-00000000d602'),
  ('9d000000-0000-0000-0000-000000000db1', '9d000000-0000-0000-0000-00000000d702');

insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-0000000ea0a1', '9d000000-0000-0000-0000-0000000000cd', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
  ('9d000000-0000-0000-0000-0000000ea0a2', '9d000000-0000-0000-0000-0000000000ce', '00000000-0000-0000-0000-000000000003', 'CLUB_ADMIN', 'active');

-- === S. Accept against a target GROUP with multiple age-eligible
-- members, no explicit team pinned -- must preserve the whole group as
-- opponent_scheduling_group_id, producing exactly one GROUP vs GROUP
-- fixture (this is the behavior this pass adds -- previously this exact
-- shape raised "select the real team before accepting"). ===
insert into public.fixture_request_groups (id, requesting_club_id, raw_opponent_text, opponent_club_id, proposed_date, created_by) values
  ('9d000000-0000-0000-0000-00000000fa01', '9d000000-0000-0000-0000-0000000000cd', 'Accept B U6/U7', '9d000000-0000-0000-0000-0000000000ce', current_date + 30, '00000000-0000-0000-0000-000000000002');
insert into public.fixture_requests (id, group_id, requesting_scheduling_group_id, requesting_team_id, target_scheduling_group_id, venue_preference, status, created_by) values
  ('9d000000-0000-0000-0000-00000000fb01', '9d000000-0000-0000-0000-00000000fa01', '9d000000-0000-0000-0000-000000000da1', '9d000000-0000-0000-0000-00000000d601', '9d000000-0000-0000-0000-000000000db1', 'home', 'sent', '00000000-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare v_fixture_id uuid; f public.fixtures;
begin
  v_fixture_id := public.accept_fixture_request('9d000000-0000-0000-0000-00000000fb01');
  select * into f from public.fixtures where id = v_fixture_id;
  if f.owning_scheduling_group_id = '9d000000-0000-0000-0000-000000000da1' and f.opponent_scheduling_group_id = '9d000000-0000-0000-0000-000000000db1' then
    raise notice 'PASS S: accepting a group-targeted request with no team pinned preserves the WHOLE opponent group -- one genuine GROUP vs GROUP fixture, not a collapsed single-team match';
  else
    raise notice 'FAIL S: owning_group=% opponent_group=%', f.owning_scheduling_group_id, f.opponent_scheduling_group_id;
  end if;
end $$;
reset role;

-- === T. Explicit p_target_team_id still pins ONE specific team --
-- opponent_scheduling_group_id stays null, exactly the pre-existing
-- "accept one named member, not the whole shared calendar" behavior. ===
insert into public.fixture_request_groups (id, requesting_club_id, raw_opponent_text, opponent_club_id, proposed_date, created_by) values
  ('9d000000-0000-0000-0000-00000000fa02', '9d000000-0000-0000-0000-0000000000cd', 'Accept B U7 (pinned)', '9d000000-0000-0000-0000-0000000000ce', current_date + 31, '00000000-0000-0000-0000-000000000002');
insert into public.fixture_requests (id, group_id, requesting_team_id, target_scheduling_group_id, venue_preference, status, created_by) values
  ('9d000000-0000-0000-0000-00000000fb02', '9d000000-0000-0000-0000-00000000fa02', '9d000000-0000-0000-0000-00000000d601', '9d000000-0000-0000-0000-000000000db1', 'home', 'sent', '00000000-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare v_fixture_id uuid; f public.fixtures;
begin
  v_fixture_id := public.accept_fixture_request('9d000000-0000-0000-0000-00000000fb02', '9d000000-0000-0000-0000-00000000d702');
  select * into f from public.fixtures where id = v_fixture_id;
  if f.opponent_team_id = '9d000000-0000-0000-0000-00000000d702' and f.opponent_scheduling_group_id is null then
    raise notice 'PASS T: an explicitly pinned p_target_team_id still accepts against exactly that ONE team -- opponent_scheduling_group_id stays null, unchanged from before this pass';
  else
    raise notice 'FAIL T: opponent_team=% opponent_group=%', f.opponent_team_id, f.opponent_scheduling_group_id;
  end if;
end $$;
reset role;

-- === U. Re-accepting an already-decided request is rejected -- the
-- pre-existing "select ... for update" + status-check state machine
-- (unchanged by this pass) is what makes concurrent double-acceptance
-- impossible: a second call always finds status <> 'sent' and raises,
-- rather than creating a second fixture for the same request. ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  begin
    perform public.accept_fixture_request('9d000000-0000-0000-0000-00000000fb01');
    raise notice 'FAIL U: an already-accepted request was accepted a second time -- would have created a duplicate fixture';
  exception when others then
    raise notice 'PASS U: re-accepting an already-decided request is rejected by the pre-existing status guard (%) -- the mechanism that makes concurrent double-acceptance safe', sqlerrm;
  end;
end $$;
reset role;

-- === V. Confirm exactly ONE fixture row exists per accepted request --
-- no mirrored/duplicate row was created for either acceptance above. ===
do $$
declare v_count_s integer; v_count_t integer;
begin
  select count(*) into v_count_s from public.fixtures where owning_scheduling_group_id = '9d000000-0000-0000-0000-000000000da1' and opponent_scheduling_group_id = '9d000000-0000-0000-0000-000000000db1';
  select count(*) into v_count_t from public.fixtures where owning_team_id = '9d000000-0000-0000-0000-00000000d601' and opponent_team_id = '9d000000-0000-0000-0000-00000000d702';
  if v_count_s = 1 and v_count_t = 1 then
    raise notice 'PASS V: exactly ONE fixtures row exists for each accepted request -- no mirrored/duplicate row for either the group-vs-group or the pinned-team acceptance';
  else
    raise notice 'FAIL V: group-vs-group row count=%, pinned-team row count=%', v_count_s, v_count_t;
  end if;
end $$;

rollback;
