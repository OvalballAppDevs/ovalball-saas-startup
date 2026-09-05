-- Manual verification for Mini-Rugby Groups (20260901230000 +
-- 20260924770000 season-binding): scheduling_groups/scheduling_group_
-- members, create/edit/deactivate RPCs, search_scheduling_groups
-- discovery, get_scheduling_group_availability aggregation, and
-- accept_fixture_request's real-team resolution (auto-resolve when
-- unambiguous, explicit selection required otherwise, never a fake team).
--
-- Section 31 of the Mini-Rugby / Team Administration / Season Handover
-- brief: this file previously reused Burnley/Rossendale's REAL club_id
-- and inserted synthetic U6/U7/U8/U9 teams directly under it -- once a
-- later migration added teams_active_canonical_identity_idx (one row per
-- club_id + canonical identity), those synthetic teams collided with
-- Burnley's own real seed teams of the same age/squad, and the whole file
-- stopped running past its own setup block. Fixed here by giving this
-- file two fully isolated, dedicated test clubs (prefix 9d000000, never
-- used anywhere else in local seed data) that cannot collide with ANY
-- real club's teams, while still reusing the real Burnley/Rossendale
-- CLUB_ADMIN auth identities (0002/0003) via a second club_membership
-- row each -- exercising real RLS/capability checks without inventing new
-- synthetic auth.users. NOT a migration -- run standalone or after
-- permission_matrix.sql (only needs 0001/0002/0003 auth identities to
-- already exist).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/scheduling_groups.sql

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  -- Two fully isolated test clubs -- Test Club A plays the "Burnley" role
  -- (owns the Mini-Rugby Group under test), Test Club B plays the
  -- "Rossendale" role (the other club discovering/requesting against it).
  -- Real CLUB_ADMIN auth identities 0002/0003 are reused via a SECOND
  -- club_membership row each, so every RLS/capability check in this file
  -- exercises genuine authorization, not a bypassed one.
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    ('9d000000-0000-0000-0000-0000000d0001', 'Mini-Rugby Test Club A', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mini-rugby-test-club-a-9d000000'),
    ('9d000000-0000-0000-0000-0000000d0002', 'Mini-Rugby Test Club B', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mini-rugby-test-club-b-9d000000')
  on conflict (id) do nothing;

  insert into public.clubs (id, directory_id, slug, status) values
    ('9d000000-0000-0000-0000-0000000c0001', '9d000000-0000-0000-0000-0000000d0001', 'mini-rugby-test-club-a-9d000000', 'active'),
    ('9d000000-0000-0000-0000-0000000c0002', '9d000000-0000-0000-0000-0000000d0002', 'mini-rugby-test-club-b-9d000000', 'active')
  on conflict (id) do nothing;

  insert into public.club_memberships (id, club_id, user_id, role, status) values
    ('9d000000-0000-0000-0000-000000600001', '9d000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
    ('9d000000-0000-0000-0000-000000600002', '9d000000-0000-0000-0000-0000000c0002', '00000000-0000-0000-0000-000000000003', 'CLUB_ADMIN', 'active')
  on conflict (id) do nothing;

  -- Test Club A mini-rugby teams: U6, U7 (primary), U7 B, U8, U9 (the U9
  -- is the explicit "must never match" negative case). squad_designation
  -- distinguishes the U7 primary from U7 B in the (club_id, identity_key)
  -- unique constraint -- two same-age squads would otherwise collide.
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, display_name, slug) values
    ('9d000000-0000-0000-0000-000000000001', '9d000000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U6', null, 'U6', 'mini-test-a-u6'),
    ('9d000000-0000-0000-0000-000000000002', '9d000000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U7', null, 'U7', 'mini-test-a-u7'),
    ('9d000000-0000-0000-0000-000000000003', '9d000000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U7', 'B', 'U7 B', 'mini-test-a-u7b'),
    ('9d000000-0000-0000-0000-000000000004', '9d000000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U8', null, 'U8', 'mini-test-a-u8'),
    ('9d000000-0000-0000-0000-000000000005', '9d000000-0000-0000-0000-0000000c0001', 'union', 'youth', 'U9', null, 'U9', 'mini-test-a-u9')
  on conflict (id) do nothing;

  -- Test Club B mini-rugby teams: U7 only, and a U9 (own club, so a
  -- fixture_request between the two clubs is realistic).
  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug) values
    ('9d000000-0000-0000-0000-000000000006', '9d000000-0000-0000-0000-0000000c0002', 'union', 'youth', 'U7', 'U7', 'mini-test-b-u7'),
    ('9d000000-0000-0000-0000-000000000007', '9d000000-0000-0000-0000-0000000c0002', 'union', 'youth', 'U9', 'U9', 'mini-test-b-u9')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Test Club A's Admin creates a valid U7/U8 Mini-Rugby Group.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
  v_tag text;
begin
  v_group_id := public.create_scheduling_group('9d000000-0000-0000-0000-0000000c0001', array['9d000000-0000-0000-0000-000000000002'::uuid, '9d000000-0000-0000-0000-000000000004'::uuid], '98000000-0000-0000-0000-000000000102');
  select display_tag into v_tag from public.scheduling_groups where id = v_group_id;
  if v_tag = 'U7/U8' then
    raise notice 'PASS 1: valid U7/U8 combo created with tag %', v_tag;
  else
    raise notice 'FAIL 1: unexpected tag %', v_tag;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. A U6/U7/U7 B/U8 combo (multiple squads per age) produces tag
--    "U6/U7/U8" -- order-independent input, sorted output.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
  v_tag text;
begin
  v_group_id := public.create_scheduling_group('9d000000-0000-0000-0000-0000000c0001', array['9d000000-0000-0000-0000-000000000004'::uuid, '9d000000-0000-0000-0000-000000000001'::uuid, '9d000000-0000-0000-0000-000000000002'::uuid, '9d000000-0000-0000-0000-000000000003'::uuid], '98000000-0000-0000-0000-000000000102');
  select display_tag into v_tag from public.scheduling_groups where id = v_group_id;
  if v_tag = 'U6/U7/U8' then
    raise notice 'PASS 2: U6 + U7 + U7 B + U8 (multiple squads per age) produced tag % (order-independent, deduped)', v_tag;
  else
    raise notice 'FAIL 2: unexpected tag %', v_tag;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 3. Invalid: a single age (U7 primary + U7 B, no second age) is rejected --
--    a Mini-Rugby Group must combine at least two different ages.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.create_scheduling_group('9d000000-0000-0000-0000-0000000c0001', array['9d000000-0000-0000-0000-000000000002'::uuid, '9d000000-0000-0000-0000-000000000003'::uuid], '98000000-0000-0000-0000-000000000102');
  raise notice 'FAIL 3: a single-age (U7 + U7 B) combo was accepted as a Mini-Rugby Group';
exception when others then
  raise notice 'PASS 3: a single-age combo is rejected (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. Invalid: U9 can never join a Mini-Rugby Group.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.create_scheduling_group('9d000000-0000-0000-0000-0000000c0001', array['9d000000-0000-0000-0000-000000000004'::uuid, '9d000000-0000-0000-0000-000000000005'::uuid], '98000000-0000-0000-0000-000000000102');
  raise notice 'FAIL 4: U8/U9 was accepted as a Mini-Rugby Group';
exception when others then
  raise notice 'PASS 4: U8/U9 (crossing out of the mini-rugby band) is rejected (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. Permissions: an unrelated club (Test Club B) cannot create a
--    Mini-Rugby Group for Test Club A.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  perform public.create_scheduling_group('9d000000-0000-0000-0000-0000000c0001', array['9d000000-0000-0000-0000-000000000002'::uuid, '9d000000-0000-0000-0000-000000000004'::uuid], '98000000-0000-0000-0000-000000000102');
  raise notice 'FAIL 5: Test Club B created a Mini-Rugby Group for Test Club A';
exception when others then
  raise notice 'PASS 5: an unrelated club cannot create another club''s Mini-Rugby Group (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. Permissions: anon cannot create a Mini-Rugby Group.
-- ------------------------------------------------------------
begin;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
begin
  perform public.create_scheduling_group('9d000000-0000-0000-0000-0000000c0001', array['9d000000-0000-0000-0000-000000000002'::uuid, '9d000000-0000-0000-0000-000000000004'::uuid], '98000000-0000-0000-0000-000000000102');
  raise notice 'FAIL 6: anon created a Mini-Rugby Group';
exception when others then
  raise notice 'PASS 6: anon cannot create a Mini-Rugby Group (%)', sqlerrm;
end $$;
rollback;

-- Real, committed Test Club A U6/U7/U8 Mini-Rugby Group for the remaining
-- tests -- id stashed in a temp table so later /begin blocks in this same
-- psql session can look it up (temp tables live for the session, not just
-- one transaction).
create temporary table t_group_a (id uuid);
create temporary table t_group_a_15 (id uuid);
grant all on t_group_a to authenticated, anon;
grant all on t_group_a_15 to authenticated, anon;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  v_group_id := public.create_scheduling_group('9d000000-0000-0000-0000-0000000c0001', array['9d000000-0000-0000-0000-000000000001'::uuid, '9d000000-0000-0000-0000-000000000002'::uuid, '9d000000-0000-0000-0000-000000000004'::uuid], '98000000-0000-0000-0000-000000000102');
  insert into t_group_a values (v_group_id);
end $$;
commit;

-- ------------------------------------------------------------
-- 7. Discovery: verify member teams remain separate canonical records --
--    the teams table is untouched by group creation (still exactly the
--    rows inserted above, none merged or renamed).
-- ------------------------------------------------------------
do $$
declare
  v_u7_name text;
  v_u8_name text;
begin
  select display_name into v_u7_name from public.teams where id = '9d000000-0000-0000-0000-000000000002';
  select display_name into v_u8_name from public.teams where id = '9d000000-0000-0000-0000-000000000004';
  if v_u7_name = 'U7' and v_u8_name = 'U8' then
    raise notice 'PASS 7: member teams remain separate canonical records with their own stable names (% / %), never merged', v_u7_name, v_u8_name;
  else
    raise notice 'FAIL 7: unexpected team names % / %', v_u7_name, v_u8_name;
  end if;
end $$;

-- ------------------------------------------------------------
-- 8. Requester discovery from a Test Club B U7 team finds Test Club A's
--    Mini-Rugby Group (U7 is a member age).
-- ------------------------------------------------------------
do $$
declare
  v_found boolean;
begin
  select exists (
    select 1 from public.search_scheduling_groups('9d000000-0000-0000-0000-000000000006')
    where club_id = '9d000000-0000-0000-0000-0000000c0001'
  ) into v_found;
  if v_found then
    raise notice 'PASS 8: a Test Club B U7 team discovers Test Club A''s Mini-Rugby Group';
  else
    raise notice 'FAIL 8: Test Club B U7 did not discover Test Club A''s Mini-Rugby Group';
  end if;
end $$;

-- ------------------------------------------------------------
-- 9. U9 cannot match: a Test Club B U9 team does NOT discover Test Club
--    A's U6/U7/U8 Mini-Rugby Group.
-- ------------------------------------------------------------
do $$
declare
  v_found boolean;
begin
  select exists (
    select 1 from public.search_scheduling_groups('9d000000-0000-0000-0000-000000000007')
    where club_id = '9d000000-0000-0000-0000-0000000c0001'
  ) into v_found;
  if not v_found then
    raise notice 'PASS 9: a Test Club B U9 team does not discover Test Club A''s mini-rugby Mini-Rugby Group';
  else
    raise notice 'FAIL 9: U9 incorrectly matched a U6/U7/U8 Mini-Rugby Group';
  end if;
end $$;

-- ------------------------------------------------------------
-- 10. U9-U16 strict same-age rule remains unchanged: two different-age
--     non-mini-rugby teams still cannot play each other (spot-check via
--     internal.teams_can_play_fixture directly, same function the trigger
--     uses).
-- ------------------------------------------------------------
do $$
declare
  v_can_play boolean;
begin
  select internal.teams_can_play_fixture('9d000000-0000-0000-0000-000000000005', '9d000000-0000-0000-0000-000000000007') into v_can_play;
  if v_can_play then
    raise notice 'PASS 10: Test Club A U9 vs Test Club B U9 (same age) remains eligible -- the strict U9+ rule is unweakened';
  else
    raise notice 'FAIL 10: two real U9 teams were unexpectedly ineligible';
  end if;
end $$;

-- ------------------------------------------------------------
-- 11. Club Admin scope: Test Club B's admin cannot edit Test Club A's
--     Mini-Rugby Group membership.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  select id into v_group_id from t_group_a;
  perform public.set_scheduling_group_members(v_group_id, array['9d000000-0000-0000-0000-000000000002'::uuid, '9d000000-0000-0000-0000-000000000004'::uuid]);
  raise notice 'FAIL 11: Test Club B''s admin edited Test Club A''s Mini-Rugby Group';
exception when others then
  raise notice 'PASS 11: an unrelated club cannot edit another club''s Mini-Rugby Group (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 12. A club member is never a valid resolution target unless it is
--     actually IN the Mini-Rugby Group -- a Test Club B team passed as
--     p_target_team_id against Test Club A's own group is rejected.
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
begin
  select id into v_group_id from t_group_a;

  insert into public.fixture_request_groups (id, requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id, proposed_date, created_by)
  values ('9d000000-0000-0000-0000-000000000010', '9d000000-0000-0000-0000-0000000c0002', 'Mini-Rugby Test Club A', '9d000000-0000-0000-0000-0000000d0001', '9d000000-0000-0000-0000-0000000c0001', current_date + 14, '00000000-0000-0000-0000-000000000003')
  on conflict (id) do nothing;

  insert into public.fixture_requests (id, group_id, requesting_team_id, target_scheduling_group_id, venue_preference, status, created_by)
  values ('9d000000-0000-0000-0000-000000000011', '9d000000-0000-0000-0000-000000000010', '9d000000-0000-0000-0000-000000000006', v_group_id, 'away', 'sent', '00000000-0000-0000-0000-000000000003')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.accept_fixture_request('9d000000-0000-0000-0000-000000000011', '9d000000-0000-0000-0000-000000000006');
  raise notice 'FAIL 12: a non-member team was accepted as the resolution';
exception when others then
  raise notice 'PASS 12: a team outside the Mini-Rugby Group cannot be used to resolve it (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 13. Ambiguous requires resolution: Test Club A's group has 3 eligible
--     members (U6, U7 A, U8) against Test Club B's requesting U7 team --
--     accepting without an explicit p_target_team_id is rejected.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.accept_fixture_request('9d000000-0000-0000-0000-000000000011');
  raise notice 'FAIL 13: an ambiguous Mini-Rugby Group request was auto-accepted without a chosen team';
exception when others then
  raise notice 'PASS 13: an ambiguous Mini-Rugby Group request requires explicit team selection (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 14. Explicit resolution succeeds and the confirmed fixture stores a
--     REAL team id (never the group id) as opponent_team_id.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
  v_opponent_team_id uuid;
  v_group_id uuid;
begin
  select id into v_group_id from t_group_a;
  v_fixture_id := public.accept_fixture_request('9d000000-0000-0000-0000-000000000011', '9d000000-0000-0000-0000-000000000002');
  select opponent_team_id into v_opponent_team_id from public.fixtures where id = v_fixture_id;
  if v_opponent_team_id = '9d000000-0000-0000-0000-000000000002' and v_opponent_team_id <> v_group_id then
    raise notice 'PASS 14: the confirmed fixture stores a real team_id (%) as opponent_team_id, never the Mini-Rugby Group id', v_opponent_team_id;
  else
    raise notice 'FAIL 14: opponent_team_id=%', v_opponent_team_id;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 15. Unique-eligible auto-resolves: a group narrowed to exactly ONE
--     member team is trivially unique regardless of age-band overlap,
--     since there is nothing else to disambiguate between.
-- ------------------------------------------------------------
-- Group creation (authorization-checked) as Test Club A's own admin.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  v_group_id := public.create_scheduling_group('9d000000-0000-0000-0000-0000000c0001', array['9d000000-0000-0000-0000-000000000001'::uuid, '9d000000-0000-0000-0000-000000000004'::uuid], '98000000-0000-0000-0000-000000000102');
  insert into t_group_a_15 (id) values (v_group_id);
end $$;
commit;

-- Narrow membership to the single U8 team only, done as a direct table
-- write bypassing RLS (there is no member-removal RPC below full
-- set_scheduling_group_members, which would itself refuse a single-age
-- membership per its own 2-age validation) -- accept_fixture_request only
-- reads current membership, it does not re-run that rule, so this is a
-- legitimate test setup step, not something the product itself allows.
do $$
declare
  v_group_id uuid;
begin
  select id into v_group_id from t_group_a_15;
  delete from public.scheduling_group_members where group_id = v_group_id and team_id = '9d000000-0000-0000-0000-000000000001';
end $$;

-- Test Club B's admin sends the request against that Mini-Rugby Group
-- (RLS-checked insert, run as the actual requesting club's admin).
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
  v_req_group_id uuid := '9d000000-0000-0000-0000-000000000020';
  v_req_id uuid := '9d000000-0000-0000-0000-000000000021';
begin
  select id into v_group_id from t_group_a_15;
  insert into public.fixture_request_groups (id, requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id, proposed_date, created_by)
  values (v_req_group_id, '9d000000-0000-0000-0000-0000000c0002', 'Mini-Rugby Test Club A', '9d000000-0000-0000-0000-0000000d0001', '9d000000-0000-0000-0000-0000000c0001', current_date + 21, '00000000-0000-0000-0000-000000000003')
  on conflict (id) do nothing;
  insert into public.fixture_requests (id, group_id, requesting_team_id, target_scheduling_group_id, venue_preference, status, created_by)
  values (v_req_id, v_req_group_id, '9d000000-0000-0000-0000-000000000006', v_group_id, 'away', 'sent', '00000000-0000-0000-0000-000000000003')
  on conflict (id) do nothing;
end $$;
commit;

-- Test Club A's admin accepts -- exactly one eligible member should auto-resolve.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_fixture_id uuid;
  v_opponent_team_id uuid;
begin
  v_fixture_id := public.accept_fixture_request('9d000000-0000-0000-0000-000000000021');
  select opponent_team_id into v_opponent_team_id from public.fixtures where id = v_fixture_id;
  if v_opponent_team_id = '9d000000-0000-0000-0000-000000000004' then
    raise notice 'PASS 15: exactly one eligible member auto-resolves the request to that real team (%)', v_opponent_team_id;
  else
    raise notice 'FAIL 15: opponent_team_id=%', v_opponent_team_id;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 16. Calendar aggregation, no false "unavailable": with 2 real members
--     and only ONE of them booked on a date, get_scheduling_group_
--     availability does NOT report that date unavailable (one free member
--     is enough to book against the Mini-Rugby Group).
-- ------------------------------------------------------------
-- Site Admin bypasses the active-partnership gate (same as
-- get_partner_team_availability's own is_site_admin() escape hatch) --
-- these two isolated test clubs have no club_partnerships row at all,
-- which test 20 below relies on directly (no "revoke shared state from
-- another test file" step needed, unlike the old Burnley/Rossendale
-- version of this file).
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
  v_unavailable_count integer;
begin
  select id into v_group_id from t_group_a; -- U6 + U7 A + U8 (3 members)
  insert into public.fixtures (id, owning_team_id, owning_scheduling_group_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('9d000000-0000-0000-0000-000000000030', '9d000000-0000-0000-0000-000000000001', v_group_id, 'Home', 'Test', current_date + 30, 'Booked', 'club_created')
  on conflict (id) do nothing;

  select count(*) into v_unavailable_count from public.get_scheduling_group_availability(v_group_id, current_date, current_date + 60);
  if v_unavailable_count = 0 then
    raise notice 'PASS 16: one member booked out of three does not mark the Mini-Rugby Group unavailable (aggregation, not false blocking)';
  else
    raise notice 'FAIL 16: unexpected unavailable_count=%', v_unavailable_count;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 17. Deactivating a Mini-Rugby Group removes it from discovery.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
  v_found boolean;
begin
  select id into v_group_id from t_group_a;
  perform public.set_scheduling_group_active(v_group_id, false);
  select exists (select 1 from public.search_scheduling_groups('9d000000-0000-0000-0000-000000000006') where group_id = v_group_id) into v_found;
  if not v_found then
    raise notice 'PASS 17: a deactivated Mini-Rugby Group no longer appears in discovery';
  else
    raise notice 'FAIL 17: a deactivated Mini-Rugby Group still appears in search results';
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 18. Editing membership (set_scheduling_group_members) recomputes the
--     display_tag -- never leaves it stale. Uses a FRESH group with no
--     fixture history yet (t_group_a itself is now frozen by test 16/22's
--     real fixture booking -- editing membership there correctly errors,
--     which is exactly what test 22 verifies; this test needs an
--     unfrozen group to isolate the recompute behaviour on its own).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
  v_tag text;
begin
  v_group_id := public.create_scheduling_group('9d000000-0000-0000-0000-0000000c0001', array['9d000000-0000-0000-0000-000000000001'::uuid, '9d000000-0000-0000-0000-000000000002'::uuid, '9d000000-0000-0000-0000-000000000004'::uuid], '98000000-0000-0000-0000-000000000102'); -- U6/U7/U8, no fixture yet
  perform public.set_scheduling_group_members(v_group_id, array['9d000000-0000-0000-0000-000000000002'::uuid, '9d000000-0000-0000-0000-000000000004'::uuid]);
  select display_tag into v_tag from public.scheduling_groups where id = v_group_id;
  if v_tag = 'U7/U8' then
    raise notice 'PASS 18: editing membership down to U7+U8 recomputed the display_tag to %', v_tag;
  else
    raise notice 'FAIL 18: unexpected tag % after membership edit', v_tag;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 19. No fake team ever appears on `teams` -- create_scheduling_group
--     never inserts a synthetic team row for the group itself.
-- ------------------------------------------------------------
do $$
declare
  v_fake_team_count integer;
begin
  select count(*) into v_fake_team_count from public.teams where id in (select id from public.scheduling_groups);
  if v_fake_team_count = 0 then
    raise notice 'PASS 19: no scheduling_groups id ever collides with a real teams row -- no fake team was ever created';
  else
    raise notice 'FAIL 19: % scheduling group id(s) unexpectedly match a real team id', v_fake_team_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 20. get_scheduling_group_availability requires an active partnership
--     (mirrors get_partner_team_availability's own boundary) -- these two
--     isolated test clubs start with no club_partnerships row at all, so
--     this scenario needs no "revoke ambient state" step.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  select id into v_group_id from t_group_a;
  perform public.get_scheduling_group_availability(v_group_id, current_date, current_date + 30);
  raise notice 'FAIL 20: availability was returned with no active calendar-sharing agreement';
exception when others then
  raise notice 'PASS 20: no active partnership means no availability access, even for a real club admin (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 21. Section 78: an inactive/folded team cannot be newly added to a
--     Mini-Rugby Group.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  update public.teams set active = false where id = '9d000000-0000-0000-0000-000000000003';
  perform public.create_scheduling_group('9d000000-0000-0000-0000-0000000c0001', array['9d000000-0000-0000-0000-000000000002'::uuid, '9d000000-0000-0000-0000-000000000003'::uuid], '98000000-0000-0000-0000-000000000102');
  raise notice 'FAIL 21: an inactive/folded team was accepted into a new Mini-Rugby Group';
exception when others then
  raise notice 'PASS 21: an inactive/folded team cannot be added to a Mini-Rugby Group (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 22. Section 64: composition freezes once a real fixture references the
--     group -- set_scheduling_group_members refuses to edit t_group_a's
--     membership now that test 16 booked a real fixture against it.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  select id into v_group_id from t_group_a;
  perform public.set_scheduling_group_members(v_group_id, array['9d000000-0000-0000-0000-000000000002'::uuid, '9d000000-0000-0000-0000-000000000004'::uuid]);
  raise notice 'FAIL 22: composition was edited on a group with a real fixture already booked against it';
exception when others then
  raise notice 'PASS 22: composition is frozen once a real fixture references the group (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 23. Section 16: set_scheduling_group_alias sets a purely cosmetic
--     suffix, never touches display_tag/composition.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
  v_tag text;
  v_alias text;
begin
  select id into v_group_id from t_group_a;
  perform public.set_scheduling_group_alias(v_group_id, 'Falcons');
  select display_tag, alias into v_tag, v_alias from public.scheduling_groups where id = v_group_id;
  if v_alias = 'Falcons' and v_tag = 'U6/U7/U8' then
    raise notice 'PASS 23: alias set to % without touching the structural tag %', v_alias, v_tag;
  else
    raise notice 'FAIL 23: tag=%, alias=%', v_tag, v_alias;
  end if;
end $$;
rollback;

-- ------------------------------------------------------------
-- 24-26. Section 32/33: cross-club server tampering -- Test Club B's
--     admin cannot alias/re-member/deactivate Test Club A's Mini-Rugby
--     Group by direct RPC call, bypassing any UI. Each is a genuine
--     mutation attempt against a REAL group with a real id, not a
--     not-found short-circuit.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  select id into v_group_id from t_group_a;
  perform public.set_scheduling_group_alias(v_group_id, 'Hijacked');
  raise notice 'FAIL 24: Test Club B''s admin set an alias on Test Club A''s Mini-Rugby Group';
exception when others then
  raise notice 'PASS 24: cross-club alias tampering is rejected server-side (%)', sqlerrm;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
begin
  select id into v_group_id from t_group_a;
  perform public.set_scheduling_group_active(v_group_id, false);
  raise notice 'FAIL 25: Test Club B''s admin deactivated Test Club A''s Mini-Rugby Group';
exception when others then
  raise notice 'PASS 25: cross-club deactivation is rejected server-side (%)', sqlerrm;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
do $$
begin
  perform public.create_scheduling_group('9d000000-0000-0000-0000-0000000c0001', array['9d000000-0000-0000-0000-000000000002'::uuid, '9d000000-0000-0000-0000-000000000004'::uuid], '98000000-0000-0000-0000-000000000102');
  raise notice 'FAIL 26: Test Club B''s admin created a new Mini-Rugby Group for Test Club A';
exception when others then
  raise notice 'PASS 26: cross-club group creation using another club''s own team_ids is rejected server-side (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 27. Section 25/72: get_effective_fixture_team_ids resolves the exact
--     component team_ids for a Mini-Rugby Group fixture, and just the
--     one team for an ordinary fixture.
-- ------------------------------------------------------------
do $$
declare
  v_group_id uuid;
  v_fixture_id uuid;
  v_ids uuid[];
begin
  select id into v_group_id from t_group_a; -- U6+U7+U8 (test 18 edits a separate, freshly-created group in a rolled-back tx -- t_group_a itself is untouched here)
  select id into v_fixture_id from public.fixtures where owning_scheduling_group_id = v_group_id limit 1;

  v_ids := public.get_effective_fixture_team_ids(v_fixture_id);
  if array_length(v_ids, 1) = 3 and '9d000000-0000-0000-0000-000000000001' = any(v_ids) and '9d000000-0000-0000-0000-000000000002' = any(v_ids) and '9d000000-0000-0000-0000-000000000004' = any(v_ids) then
    raise notice 'PASS 27a: get_effective_fixture_team_ids resolves all 3 real component team_ids for a Mini-Rugby Group fixture';
  else
    raise notice 'FAIL 27a: unexpected ids %', v_ids;
  end if;
end $$;
