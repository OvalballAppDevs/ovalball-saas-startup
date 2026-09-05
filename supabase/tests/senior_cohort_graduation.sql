-- Manual verification for 20260924890000_senior_cohort_graduation.sql:
-- graduate_team() (archival, never a silent "become Men's 1st"),
-- player_graduation_queue (the GRADUATING PLAYERS holding workflow
-- state), place_graduating_player(), and mark_graduating_player_left().
--
-- Transaction-scoped like season_transitions.sql: this genuinely
-- mutates teams.active/display_name and inserts real player_team_
-- memberships rows, so the whole file rolls back at the end rather
-- than relying on isolated-club containment alone.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/senior_cohort_graduation.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0005', 'Graduation Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'graduation-test-club-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c0005', '9d000000-0000-0000-0000-0000000d0005', 'graduation-test-club-9d000000', 'active');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000600005', '9d000000-0000-0000-0000-0000000c0005', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug, active) values
  ('9d000000-0000-0000-0000-0000000000f1', '9d000000-0000-0000-0000-0000000c0005', 'union', 'colts', 'SeniorColts', null, 'Senior Colts', 'gt-senior-colts', true),
  ('9d000000-0000-0000-0000-0000000000f2', '9d000000-0000-0000-0000-0000000c0005', 'union', 'youth', 'U10', null, 'U10', 'gt-u10-ordinary', true),
  ('9d000000-0000-0000-0000-0000000000f3', '9d000000-0000-0000-0000-0000000c0005', 'union', 'senior', null, 'mens', 'Men''s 1st', 'gt-mens-1st', true);

-- Alex is a real adult (19) so PASS 6 below exercises the ordinary,
-- no-extra-gate placement path. Sam has no recorded DOB and is only
-- ever recorded as "left the club" (mark_graduating_player_left), never
-- placed, so their missing DOB is never exercised.
insert into public.players (id, first_name, surname, date_of_birth, active, created_by) values
  ('9d000000-0000-0000-0000-0000000000a1', 'Alex', 'Graduate', (current_date - interval '19 years')::date, true, '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-0000000000a2', 'Sam', 'Graduate', null, true, '00000000-0000-0000-0000-000000000002');
insert into public.player_team_memberships (player_id, team_id, status, created_by) values
  ('9d000000-0000-0000-0000-0000000000a1', '9d000000-0000-0000-0000-0000000000f1', 'active', '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-0000000000a2', '9d000000-0000-0000-0000-0000000000f1', 'active', '00000000-0000-0000-0000-000000000002');
insert into public.team_permissions (membership_id, team_id, permission, created_by) values
  ((select id from public.club_memberships where id = '9d000000-0000-0000-0000-000000600005'), '9d000000-0000-0000-0000-0000000000f1', 'coach', '00000000-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_queued_count integer;
  v_team record;
  v_queue_count integer;
  v_pending_count integer;
begin
  select public.graduate_team('9d000000-0000-0000-0000-0000000000f1') into v_queued_count;

  select * into v_team from public.teams where id = '9d000000-0000-0000-0000-0000000000f1';
  if not v_team.active and v_team.archived_at is not null and v_team.display_name like 'Senior Colts%Archive' then
    raise notice 'PASS 1: the Senior Colts team is archived (inactive, archived_at set, display_name tagged "...Archive"), never mutated into an adult team identity';
  else
    raise notice 'FAIL 1: active=% archived_at=% display_name=%', v_team.active, v_team.archived_at, v_team.display_name;
  end if;

  if v_queued_count = 2 then
    raise notice 'PASS 2: both of the cohort''s active players were queued for graduation';
  else
    raise notice 'FAIL 2: graduate_team returned %, expected 2', v_queued_count;
  end if;

  select count(*) into v_pending_count from public.player_graduation_queue
  where source_team_id = '9d000000-0000-0000-0000-0000000000f1' and status = 'pending_placement';
  if v_pending_count = 2 then
    raise notice 'PASS 3: both players sit in pending_placement -- neither was auto-assigned to any adult team';
  else
    raise notice 'FAIL 3: found % pending_placement rows, expected 2', v_pending_count;
  end if;

  if not exists (select 1 from public.team_permissions where membership_id = (select id from public.club_memberships where id = '9d000000-0000-0000-0000-000000600005') and team_id = '9d000000-0000-0000-0000-0000000000f3') then
    raise notice 'PASS 4: the graduating team''s coach permission was NOT copied onto Men''s 1st -- staff never auto-follow graduating players';
  else
    raise notice 'FAIL 4: a team_permissions row for Men''s 1st was unexpectedly created';
  end if;
end $$;

-- Reject: an ordinary U10 team cannot be "graduated" this way.
do $$
begin
  perform public.graduate_team('9d000000-0000-0000-0000-0000000000f2');
  raise notice 'FAIL 5: an ordinary U10 team was accepted by graduate_team';
exception when others then
  raise notice 'PASS 5: an ordinary (non-terminal) youth team is rejected by graduate_team (%)', sqlerrm;
end $$;

-- One human places one graduate onto Men's 1st; the other is recorded
-- as having left the club -- both explicit, per-player decisions.
do $$
declare
  v_queue_a1 uuid; v_queue_a2 uuid;
  v_membership record;
  v_status_a1 text; v_status_a2 text;
begin
  select id into v_queue_a1 from public.player_graduation_queue where player_id = '9d000000-0000-0000-0000-0000000000a1';
  select id into v_queue_a2 from public.player_graduation_queue where player_id = '9d000000-0000-0000-0000-0000000000a2';

  perform public.place_graduating_player(v_queue_a1, '9d000000-0000-0000-0000-0000000000f3');
  select * into v_membership from public.player_team_memberships where player_id = '9d000000-0000-0000-0000-0000000000a1' and team_id = '9d000000-0000-0000-0000-0000000000f3';
  select status into v_status_a1 from public.player_graduation_queue where id = v_queue_a1;
  if v_membership.status = 'active' and v_status_a1 = 'placed' then
    raise notice 'PASS 6: placing a graduate creates a real, ordinary player_team_memberships row on the chosen adult team and marks the queue entry placed';
  else
    raise notice 'FAIL 6: membership_status=% queue_status=%', v_membership.status, v_status_a1;
  end if;

  perform public.mark_graduating_player_left(v_queue_a2);
  select status into v_status_a2 from public.player_graduation_queue where id = v_queue_a2;
  if v_status_a2 = 'left_club' then
    raise notice 'PASS 7: the other graduate can be explicitly recorded as not continuing at this club, never silently left dangling or auto-placed';
  else
    raise notice 'FAIL 7: queue status=%, expected left_club', v_status_a2;
  end if;
end $$;

-- RESUME SEASON HANDOVER Section 28: a genuinely under-18 graduate
-- (17) must never be placeable onto a senior team on Senior-Colts
-- membership alone -- an approved, governing-body-referenced
-- dispensation for that exact player and target team must exist first.
-- A missing-DOB graduate must be blocked outright from adult placement.
reset role;
insert into public.players (id, first_name, surname, date_of_birth, active, created_by) values
  ('9d000000-0000-0000-0000-0000000000a3', 'Jordan', 'Underage', (current_date - interval '17 years')::date, true, '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-0000000000a4', 'Casey', 'Nodob', null, true, '00000000-0000-0000-0000-000000000002');
insert into public.player_team_memberships (player_id, team_id, status, created_by) values
  ('9d000000-0000-0000-0000-0000000000a3', '9d000000-0000-0000-0000-0000000000f1', 'active', '00000000-0000-0000-0000-000000000002'),
  ('9d000000-0000-0000-0000-0000000000a4', '9d000000-0000-0000-0000-0000000000f1', 'active', '00000000-0000-0000-0000-000000000002');
insert into public.player_graduation_queue (player_id, source_team_id, club_id) values
  ('9d000000-0000-0000-0000-0000000000a3', '9d000000-0000-0000-0000-0000000000f1', '9d000000-0000-0000-0000-0000000c0005'),
  ('9d000000-0000-0000-0000-0000000000a4', '9d000000-0000-0000-0000-0000000000f1', '9d000000-0000-0000-0000-0000000c0005');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_queue_a3 uuid;
  v_disp_id uuid;
begin
  select id into v_queue_a3 from public.player_graduation_queue where player_id = '9d000000-0000-0000-0000-0000000000a3';

  begin
    perform public.place_graduating_player(v_queue_a3, '9d000000-0000-0000-0000-0000000000f3');
    raise notice 'FAIL 8: a 17-year-old was placed onto a senior team with no dispensation on file';
  exception when others then
    if sqlerrm like '%approved governing-body dispensation%' then
      raise notice 'PASS 8: a 17-year-old graduate is blocked from senior-team placement without an approved, governing-body-referenced dispensation';
    else
      raise notice 'FAIL 8: blocked for an unexpected reason: %', sqlerrm;
    end if;
  end;

  begin
    perform public.place_graduating_player(
      (select id from public.player_graduation_queue where player_id = '9d000000-0000-0000-0000-0000000000a4'),
      '9d000000-0000-0000-0000-0000000000f3'
    );
    raise notice 'FAIL 9: a player with no recorded date of birth was placed onto a senior team';
  exception when others then
    if sqlerrm like '%no recorded date of birth%' then
      raise notice 'PASS 9: a player with no recorded date of birth is blocked from senior-team placement outright (never assumed to be an adult)';
    else
      raise notice 'FAIL 9: blocked for an unexpected reason: %', sqlerrm;
    end if;
  end;

  -- The real dispensation chain -- source team, then club, then
  -- governing-body reference -- is walked for real, exactly as a real
  -- club would use it, rather than inserting a pre-approved row directly.
  v_disp_id := public.request_player_dispensation(
    '9d000000-0000-0000-0000-0000000000a3', '9d000000-0000-0000-0000-0000000000f1', '9d000000-0000-0000-0000-0000000000f3',
    (select id from public.seasons where rugby_code = 'union' and is_regression_fixture = false order by starts_on desc limit 1),
    'RFU age-grade continuum dispensation'
  );
  perform public.decide_player_dispensation(v_disp_id, 'source_team', true);
  perform public.decide_player_dispensation(v_disp_id, 'club', true);
  perform public.decide_player_dispensation(v_disp_id, 'governing_body', true, 'RFU-DISP-2027-0042');

  perform public.place_graduating_player(v_queue_a3, '9d000000-0000-0000-0000-0000000000f3');
  if exists (select 1 from public.player_team_memberships where player_id = '9d000000-0000-0000-0000-0000000000a3' and team_id = '9d000000-0000-0000-0000-0000000000f3' and status = 'active') then
    raise notice 'PASS 10: with a real, fully-approved governing-body-referenced dispensation on file, the same 17-year-old is placed successfully';
  else
    raise notice 'FAIL 10: placement did not create the expected active membership after an approved dispensation';
  end if;
end $$;

reset role;
rollback;
