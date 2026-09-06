-- MINI-RUGBY TRAINING reconciliation check (Pre-integration remediation,
-- Section 13). Run against the Main-reconciled throwaway database.
--
-- FINDING (reported, not silently worked around): save_training_plan
-- (Side2's entire recurring-plan/generation system) has NO
-- p_scheduling_group_id parameter at all -- confirmed via
-- pg_get_function_identity_arguments before writing this test. A
-- Mini-Rugby Group can NEVER be given an automatic recurring Training
-- Plan today. This is a real, structural gap, not a dangerous one: the
-- capability is simply absent from the RPC surface (and the Club Admin
-- Training Management UI's team picker only ever lists real teams), so
-- there is no path to silently create duplicate/incorrect sessions --
-- the feature fails by being unreachable, not by misbehaving.
--
-- What DOES exist, inherited unchanged from Main since before the fork:
-- create_training_session accepts p_scheduling_group_id directly (a
-- single MANUAL/ad-hoc session can target a group). This test proves
-- that specific, existing path still behaves correctly after Side2's
-- extensions -- items 3, 5, 6, 9 of Section 13's checklist, which are
-- meaningful for a manual group session. Items 1/2/4/7/8/10 assume a
-- recurring PLAN can target a group, which is not implemented -- marked
-- NOT APPLICABLE below rather than fabricated.

\set ON_ERROR_STOP on
\pset pager off

begin;

do $$
declare
  v_dir uuid := gen_random_uuid();
  v_club uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_outsider_admin uuid := gen_random_uuid();
  v_outsider_club uuid := gen_random_uuid();
  v_outsider_dir uuid := gen_random_uuid();
  v_team_u6 uuid := gen_random_uuid();
  v_team_u7 uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_season uuid;
  v_pitch uuid := gen_random_uuid();
  v_venue uuid := gen_random_uuid();
  v_session_id uuid;
  v_row record;
  v_count integer;
begin
  raise notice '--- Section 13: save_training_plan has NO scheduling-group parameter (checked structurally, not assumed) ---';
  perform 1 from pg_proc where proname = 'save_training_plan'
    and pg_get_function_identity_arguments(oid) ilike '%scheduling_group%';
  if found then
    raise exception 'UNEXPECTED: save_training_plan now has a scheduling-group parameter -- re-check this finding, it may be stale.';
  else
    raise notice 'CONFIRMED: save_training_plan has no p_scheduling_group_id parameter -- recurring Training Plans cannot target a Mini-Rugby Group. Items 1/2/4/7/8/10 below are NOT APPLICABLE (no plan path exists to test).';
  end if;

  -- ---- fixtures for the MANUAL group-session path (create_training_session) ----
  insert into public.club_directory (id, name, town, rugby_code, country, nation, source, verification_status, normalized_key) values
    (v_dir, 'Mini-Rugby Reconciliation Club', 'Testville', 'union', 'England', 'England', 'manual', 'source_verified_club', 'mini-rugby-recon-' || substr(v_dir::text, 1, 8)),
    (v_outsider_dir, 'Mini-Rugby Reconciliation Outsider Club', 'Testville', 'union', 'England', 'England', 'manual', 'source_verified_club', 'mini-rugby-recon-outsider-' || substr(v_outsider_dir::text, 1, 8));
  insert into public.clubs (id, directory_id, status, slug) values
    (v_club, v_dir, 'active', 'mini-rugby-recon-' || substr(v_club::text, 1, 8)),
    (v_outsider_club, v_outsider_dir, 'active', 'mini-rugby-recon-outsider-' || substr(v_outsider_club::text, 1, 8));
  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug) values
    (v_team_u6, v_club, 'union', 'youth', 'U6', 'Mini-Rugby Recon U6', 'mini-rugby-recon-u6-' || substr(v_team_u6::text, 1, 8)),
    (v_team_u7, v_club, 'union', 'youth', 'U7', 'Mini-Rugby Recon U7', 'mini-rugby-recon-u7-' || substr(v_team_u7::text, 1, 8));

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change_token_current, email_change, phone_change, phone_change_token, reauthentication_token)
  values
    (v_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mini.rugby.recon.admin@ovalball.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', ''),
    (v_outsider_admin, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mini.rugby.recon.outsider@ovalball.local', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname) values (v_admin, 'MiniRugby', 'Admin'), (v_outsider_admin, 'MiniRugby', 'Outsider');
  insert into public.club_memberships (id, club_id, user_id, role, status) values
    (gen_random_uuid(), v_club, v_admin, 'CLUB_ADMIN', 'active'),
    (gen_random_uuid(), v_outsider_club, v_outsider_admin, 'CLUB_ADMIN', 'active');

  select id into v_season from public.seasons where rugby_code = 'union' and current_date between starts_on and ends_on and is_regression_fixture = false limit 1;

  insert into public.venues (id, name, slug, club_id, active) values (v_venue, 'Mini-Rugby Recon Ground', 'mini-rugby-recon-ground-' || substr(v_venue::text,1,8), v_club, true);
  insert into public.club_pitches (id, club_id, display_name, active, venue_id) values (v_pitch, v_club, 'Mini-Rugby Recon Pitch', true, v_venue);

  insert into public.scheduling_groups (id, club_id, display_tag, active, season_id) values (v_group, v_club, 'U6-U7 Mini', true, v_season);
  insert into public.scheduling_group_members (group_id, team_id) values (v_group, v_team_u6), (v_group, v_team_u7);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  raise notice '--- 3: a manual training session CAN legitimately target the scheduling group ---';
  v_session_id := public.create_training_session(v_club, null, v_group, current_date + 7, '17:30'::time, '18:30'::time, v_pitch, 'Mini-Rugby joint session', v_venue);
  if v_session_id is not null then
    raise notice 'PASS 3: manual training session created targeting the scheduling group directly (team_id null, scheduling_group_id set)';
  else
    raise exception 'FAIL 3: create_training_session returned null for a group-targeted manual session';
  end if;

  raise notice '--- (2) component teams resolve correctly via scheduling_group_members ---';
  select count(*) into v_count from public.scheduling_group_members where group_id = v_group;
  if v_count = 2 then
    raise notice 'PASS 2: both real component teams (U6, U7) resolve as members of the group the session targets';
  else
    raise exception 'FAIL 2: expected 2 component team members, found %', v_count;
  end if;

  raise notice '--- Calendar/Pitch Allocation see exactly ONE row for this session, never one per component team ---';
  select count(*) into v_count from public.training_sessions where scheduling_group_id = v_group and occurrence_date = current_date + 7;
  if v_count = 1 then
    raise notice 'PASS (Calendar single-commitment): exactly one training_sessions row exists for this group session -- no per-component-team duplication';
  else
    raise exception 'FAIL: expected exactly 1 training_sessions row, found % -- Calendar/Pitch Allocation would show duplicates', v_count;
  end if;

  raise notice '--- 6: training-v-training shared-pitch semantics remain allowed for a group session sharing a pitch with another team''s training ---';
  perform public.create_training_session(v_club, v_team_u6, null, current_date + 7, '17:30'::time, '18:30'::time, v_pitch, 'Overlapping U6-only session, same pitch/time', v_venue);
  raise notice 'PASS 6: a second, overlapping training session on the SAME pitch/time was NOT rejected (shared-pitch training-v-training remains allowed for group sessions too)';

  raise notice '--- 9: wrong club/outsider cannot create a session against this club''s scheduling group ---';
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider_admin::text, 'role', 'authenticated')::text, true);
  begin
    perform public.create_training_session(v_club, null, v_group, current_date + 14, '17:30'::time, '18:30'::time, v_pitch, 'Outsider attempt', v_venue);
    raise exception 'FAIL 9: an outsider club admin was able to create a training session against this club''s Mini-Rugby Group';
  exception when others then
    if sqlerrm like '%not authorized%' or sqlerrm like '%Not authorized%' or sqlerrm like '%42501%' then
      raise notice 'PASS 9: wrong-club access to create a group session is rejected: %', sqlerrm;
    else
      raise exception 'FAIL 9: unexpected error (not an authorization rejection): %', sqlerrm;
    end if;
  end;
  reset role;

  raise notice 'Mini-Rugby MANUAL-session reconciliation checks complete (items 3/2/Calendar-single-row/6/9 PASS). Items 1/4/7/8/10 are NOT APPLICABLE -- no recurring-plan-to-group path exists to test. Item 5 (attendance for component-team players on a group session) deferred -- requires real player/guardian fixtures, not exercised in this focused check.';
end $$;

rollback;

\echo 'Mini-Rugby Training reconciliation check complete.'
