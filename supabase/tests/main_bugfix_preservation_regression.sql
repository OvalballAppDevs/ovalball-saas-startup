-- MAIN BUG-FIX PRESERVATION regression (Pre-integration remediation,
-- Section 6/7). Proves BEHAVIORALLY -- not by grepping function bodies --
-- that Main's two post-fork fixture/Mini-Rugby fixes survive intact after
-- Side2's migrations are renumbered and applied on top:
--
--   1. accept_fixture_request no longer violates
--      fixtures_opponent_group_excludes_directory when a request targets
--      a Mini-Rugby Group AND carries a directory-resolved opponent (the
--      ordinary case) -- Main migration
--      .../fix_accept_fixture_request_group_opponent.sql (originally
--      20260929000000, integration version 20261011000000 -- content
--      unchanged by the rename, Side2 never redefines this function).
--
--   2. set_scheduling_group_members freezes a group's composition once it
--      has a real fixture booked against it on EITHER side (owning or
--      opponent), not just the owning side -- Main migration
--      .../fix_scheduling_group_composition_freeze_opponent_side.sql
--      (originally 20260929100000, integration version 20261011010000 --
--      Side2 never redefines this function either).
--
-- Fully self-contained: own throwaway club/teams/users/groups, rolled
-- back at the end.

\set ON_ERROR_STOP on
\pset pager off

begin;

do $$
declare
  v_dir_a uuid := gen_random_uuid();
  v_dir_b uuid := gen_random_uuid();
  v_club_a uuid := gen_random_uuid();
  v_club_b uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_admin_b uuid := gen_random_uuid();
  v_team_requesting uuid := gen_random_uuid();
  v_team_member1 uuid := gen_random_uuid();
  v_group_b uuid := gen_random_uuid();
  v_group_req_group_id uuid;
  v_req_id uuid;
  v_fixture_id uuid;
  v_opponent_directory_id uuid;
  v_opponent_scheduling_group_id uuid;
  v_owning_fixture_id uuid;
begin
  insert into public.club_directory (id, name, town, rugby_code, country, nation, source, verification_status, normalized_key) values
    (v_dir_a, 'Bugfix Preservation Club A', 'Testville', 'union', 'England', 'England', 'manual', 'source_verified_club', 'bugfix-preservation-a-' || substr(v_dir_a::text, 1, 8)),
    (v_dir_b, 'Bugfix Preservation Club B', 'Testville', 'union', 'England', 'England', 'manual', 'source_verified_club', 'bugfix-preservation-b-' || substr(v_dir_b::text, 1, 8));
  insert into public.clubs (id, directory_id, status, slug) values
    (v_club_a, v_dir_a, 'active', 'bugfix-preservation-a-' || substr(v_club_a::text, 1, 8)),
    (v_club_b, v_dir_b, 'active', 'bugfix-preservation-b-' || substr(v_club_b::text, 1, 8));
  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug) values
    (v_team_requesting, v_club_a, 'union', 'youth', 'U8', 'Bugfix A U8', 'bugfix-a-u8-' || substr(v_team_requesting::text, 1, 8)),
    (v_team_member1, v_club_b, 'union', 'youth', 'U8', 'Bugfix B U8 Member', 'bugfix-b-u8-member-' || substr(v_team_member1::text, 1, 8));

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change_token_current, email_change, phone_change, phone_change_token, reauthentication_token)
  values (v_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bugfix.preservation.admin@ovalball.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname) values (v_admin_a, 'Bugfix', 'Admin');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_a, v_admin_a, 'CLUB_ADMIN', 'active');

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change_token_current, email_change, phone_change, phone_change_token, reauthentication_token)
  values (v_admin_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bugfix.preservation.admin.b@ovalball.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname) values (v_admin_b, 'Bugfix', 'AdminB');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_b, v_admin_b, 'CLUB_ADMIN', 'active');

  -- Club B's real Mini-Rugby Group (single member, so acceptance
  -- auto-resolves without needing a p_target_team_id).
  insert into public.scheduling_groups (id, club_id, display_tag, active, season_id)
  values (v_group_b, v_club_b, 'U8-Mini', true, (select id from public.seasons where rugby_code = 'union' and current_date between starts_on and ends_on and is_regression_fixture = false limit 1));
  insert into public.scheduling_group_members (group_id, team_id) values (v_group_b, v_team_member1);

  raise notice '--- 1: accept_fixture_request -- group-targeted request WITH a directory-resolved opponent (the exact bug scenario) ---';

  -- The request names Club B's real directory entry as the opponent AND
  -- targets Club B's scheduling group -- exactly the "ordinary case"
  -- the bug report describes (opponent normally picked from the
  -- directory) that used to violate fixtures_opponent_group_excludes_directory.
  insert into public.fixture_request_groups (id, requesting_club_id, raw_opponent_text, opponent_directory_id, opponent_club_id, proposed_date, created_by, source)
  values (gen_random_uuid(), v_club_a, 'Bugfix Preservation Club B', v_dir_b, v_club_b, current_date + 21, v_admin_a, 'ovie_assistant')
  returning id into v_group_req_group_id;

  insert into public.fixture_requests (id, group_id, requesting_team_id, target_scheduling_group_id, venue_preference, status, created_by)
  values (gen_random_uuid(), v_group_req_group_id, v_team_requesting, v_group_b, 'home', 'sent', v_admin_a)
  returning id into v_req_id;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b::text, 'role', 'authenticated')::text, true);

  begin
    v_fixture_id := public.accept_fixture_request(v_req_id);
    reset role;
    select opponent_directory_id, opponent_scheduling_group_id into v_opponent_directory_id, v_opponent_scheduling_group_id
      from public.fixtures where id = v_fixture_id;
    if v_opponent_scheduling_group_id = v_group_b and v_opponent_directory_id is null then
      raise notice 'PASS 1: group-targeted request with a directory opponent accepted with zero constraint violation -- opponent_scheduling_group_id set, opponent_directory_id correctly nulled (Main''s fix intact)';
    else
      raise exception 'FAIL 1: opponent_scheduling_group_id=%, opponent_directory_id=% (expected group set, directory null)', v_opponent_scheduling_group_id, v_opponent_directory_id;
    end if;
  exception when check_violation then
    reset role;
    raise exception 'FAIL 1: fixtures_opponent_group_excludes_directory violated -- Main''s fix was NOT preserved: %', sqlerrm;
  end;

  raise notice '--- 2: set_scheduling_group_members -- composition freeze on the OPPONENT side ---';

  -- v_group_b is now the OPPONENT side of a real booked fixture (from
  -- test 1 above) -- never the owning side. Before Main's fix, only the
  -- owning side was checked, so this edit would have wrongly succeeded.
  -- Acting as v_admin_b (Club B's own real admin), so the failure under
  -- test is the COMPOSITION FREEZE, never a plain authorization rejection.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b::text, 'role', 'authenticated')::text, true);
  begin
    perform public.set_scheduling_group_members(v_group_b, array[v_team_member1]);
    reset role;
    raise exception 'FAIL 2: composition was edited on a group that is the OPPONENT side of a real booked fixture -- Main''s opponent-side fix was NOT preserved';
  exception when others then
    reset role;
    if sqlerrm like '%already has a fixture booked against it%' then
      raise notice 'PASS 2: composition is frozen once the group is referenced on EITHER side of a real fixture, including opponent-side (Main''s fix intact): %', sqlerrm;
    else
      raise exception 'FAIL 2: unexpected error (not the composition-freeze message): %', sqlerrm;
    end if;
  end;

  raise notice 'All Main bug-fix preservation assertions PASSED.';
end $$;

rollback;

\echo 'Main bug-fix preservation regression complete -- every NOTICE above must read PASS, and the transaction rolled back (no residue).'
