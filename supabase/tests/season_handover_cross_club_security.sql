-- Season Handover / Mini-Rugby: cross-club + active-context security regression suite.
--
-- Task #37. The pre-existing rollover/graduation/mini-rugby suites
-- (season_rollover.sql, senior_cohort_graduation.sql,
-- mini_rugby_next_season_group.sql) all test the HAPPY PATH only -- none of
-- them contained a single cross-club or unauthorized-caller assertion
-- (verified by grep before this file was written). This suite closes that
-- gap for every one of the seven Season Handover / Mini-Rugby RPCs the
-- Club Admin UI can reach:
--
--   generate_rollover_proposal          internal.has_capability('club.season_rollover.manage','club')
--   confirm_rollover_team_proposal      can_manage_club_fixtures OR is_site_admin
--   confirm_mixed_boundary_rollover     can_manage_club_fixtures OR is_site_admin
--   resolve_rollover_group_flag         can_manage_club_fixtures OR is_site_admin
--   place_graduating_player             has_capability('place_graduating_players', team|club) + same-club constraint
--   mark_graduating_player_left         can_manage_club_fixtures OR is_site_admin
--   create_next_season_scheduling_group has_capability('manage_mini_rugby_groups','club')
--
-- The threat model tested is the real one: an ACTIVE, LEGITIMATE Club Admin
-- of club A passing club B's own object ID. UI-hiding is irrelevant here --
-- every call below goes straight at the RPC as the authenticated role, the
-- way a tampered request would.
--
-- Run:
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/season_handover_cross_club_security.sql
--
-- Safe to re-run: builds its own clearly-named throwaway fixtures under
-- deterministic UUIDs, and rolls nothing into shared data.

\set ON_ERROR_STOP off
\pset pager off

-- =====================================================================
-- FIXTURES: two unrelated clubs, each with its own Club Admin.
-- =====================================================================
do $$
declare
  v_union_dir uuid;
begin
  select id into v_union_dir from public.club_directory where rugby_code = 'union' limit 1;

  -- Two throwaway clubs in the same rugby code (so a cross-club call is
  -- rejected on AUTHORITY, never merely on a rugby-code mismatch -- that
  -- would be a false PASS).
  insert into public.club_directory (id, name, rugby_code, town, county, country, nation, source, verification_status, normalized_key)
  values
    ('5ea50000-0000-0000-0000-0000000000a1', 'SHX Test Club A', 'union', 'Testville', 'Testshire', 'England', 'England', 'manual', 'verified', 'shx-test-club-a'),
    ('5ea50000-0000-0000-0000-0000000000b1', 'SHX Test Club B', 'union', 'Testville', 'Testshire', 'England', 'England', 'manual', 'verified', 'shx-test-club-b')
  on conflict (id) do nothing;

  insert into public.clubs (id, directory_id, slug, status)
  values
    ('5ea50000-0000-0000-0000-00000000000a', '5ea50000-0000-0000-0000-0000000000a1', 'shx-test-club-a', 'active'),
    ('5ea50000-0000-0000-0000-00000000000b', '5ea50000-0000-0000-0000-0000000000b1', 'shx-test-club-b', 'active')
  on conflict (id) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
  values
    ('5ea50000-0000-0000-0000-00000000aaaa', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shx.admin.a@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', ''),
    ('5ea50000-0000-0000-0000-00000000bbbb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'shx.admin.b@ovalball.local', '', now(), now(), '{}', '{}', '', '', '', '')
  on conflict (id) do nothing;

  insert into public.profiles (id, first_name, surname, email)
  values
    ('5ea50000-0000-0000-0000-00000000aaaa', 'SHX', 'AdminA', 'shx.admin.a@ovalball.local'),
    ('5ea50000-0000-0000-0000-00000000bbbb', 'SHX', 'AdminB', 'shx.admin.b@ovalball.local')
  on conflict (id) do nothing;

  -- Each admin is a REAL, ACTIVE, NON-SUSPENDED Club Admin -- of their own club only.
  insert into public.club_memberships (club_id, user_id, role, status, authority_suspended)
  values
    ('5ea50000-0000-0000-0000-00000000000a', '5ea50000-0000-0000-0000-00000000aaaa', 'CLUB_ADMIN', 'active', false),
    ('5ea50000-0000-0000-0000-00000000000b', '5ea50000-0000-0000-0000-00000000bbbb', 'CLUB_ADMIN', 'active', false)
  on conflict do nothing;

  -- One youth team per club.
  insert into public.teams (id, club_id, rugby_code, slug, display_name, category, age_group, gender, active)
  values
    -- gender must be boys/girls at U12 -- teams_gender_category_check only
    -- permits 'mixed' up to U11 (the real Mixed structural boundary).
    ('5ea50000-0000-0000-0000-00000000ee01', '5ea50000-0000-0000-0000-00000000000a', 'union', 'shx-a-u12', 'SHX A U12', 'youth', 'U12', 'boys', true),
    ('5ea50000-0000-0000-0000-00000000ee02', '5ea50000-0000-0000-0000-00000000000b', 'union', 'shx-b-u12', 'SHX B U12', 'youth', 'U12', 'boys', true),
    -- Second Club B team for the Mixed-boundary proposal: one proposal per
    -- (rollover, team) is enforced by a unique constraint, so the mixed
    -- boundary case needs its own team -- and U11 Mixed is exactly the real
    -- shape that boundary applies to.
    ('5ea50000-0000-0000-0000-00000000ee03', '5ea50000-0000-0000-0000-00000000000b', 'union', 'shx-b-u11', 'SHX B U11', 'youth', 'U11', 'mixed', true)
  on conflict (id) do nothing;
exception when others then
  raise notice 'FIXTURE SETUP NOTE: %', sqlerrm;
end $$;

-- Club B's own rollover + proposal + flag + graduation queue entry.
-- These are the objects Club A's admin will try to reach.
do $$
declare
  v_from_season uuid;
  v_to_season uuid;
begin
  select id into v_from_season from public.seasons where rugby_code='union' and is_regression_fixture = false order by starts_on desc limit 1 offset 1;
  select id into v_to_season   from public.seasons where rugby_code='union' and is_regression_fixture = false order by starts_on desc limit 1;

  insert into public.age_grade_rollovers (id, club_id, rugby_code, from_season_id, to_season_id, created_by)
  values ('5ea50000-0000-0000-0000-00000000ee11', '5ea50000-0000-0000-0000-00000000000b', 'union', v_from_season, v_to_season, '5ea50000-0000-0000-0000-00000000bbbb')
  on conflict (id) do nothing;

  insert into public.age_grade_rollover_team_proposals (id, rollover_id, team_id, current_age_group, proposed_age_group, requires_manual_choice, is_mixed_boundary)
  values
    ('5ea50000-0000-0000-0000-00000000ee21', '5ea50000-0000-0000-0000-00000000ee11', '5ea50000-0000-0000-0000-00000000ee02', 'U12', 'U13', false, false),
    ('5ea50000-0000-0000-0000-00000000ee22', '5ea50000-0000-0000-0000-00000000ee11', '5ea50000-0000-0000-0000-00000000ee03', 'U11', 'U12', true,  true)
  on conflict (id) do nothing;

  -- scheduling_group_id is NOT NULL, so Club B needs a real Mini-Rugby
  -- Group first. This same group is also the target of test 7.
  insert into public.scheduling_groups (id, club_id, season_id, display_tag, active)
  values ('5ea50000-0000-0000-0000-00000000ee61', '5ea50000-0000-0000-0000-00000000000b', v_to_season, 'SHX B Group', true)
  on conflict (id) do nothing;

  insert into public.age_grade_rollover_group_flags (id, rollover_id, scheduling_group_id, reason, resolved)
  values ('5ea50000-0000-0000-0000-00000000ee31', '5ea50000-0000-0000-0000-00000000ee11', '5ea50000-0000-0000-0000-00000000ee61', 'SHX test flag', false)
  on conflict (id) do nothing;

  insert into public.players (id, first_name, surname, date_of_birth)
  values ('5ea50000-0000-0000-0000-00000000ee41', 'SHX', 'GradPlayer', '2008-01-01')
  on conflict (id) do nothing;

  insert into public.player_graduation_queue (id, player_id, source_team_id, club_id, status)
  values ('5ea50000-0000-0000-0000-00000000ee51', '5ea50000-0000-0000-0000-00000000ee41', '5ea50000-0000-0000-0000-00000000ee02', '5ea50000-0000-0000-0000-00000000000b', 'pending_placement')
  on conflict (id) do nothing;
exception when others then
  raise notice 'FIXTURE SETUP NOTE (club B objects): %', sqlerrm;
end $$;

\echo '=== Season Handover / Mini-Rugby cross-club + active-context security suite ==='

-- =====================================================================
-- Helper: run one cross-club call as Club A's admin and assert it is
-- rejected. A PASS requires an actual raised exception -- a silent
-- no-op would be a FAIL, because a no-op that returns success is
-- indistinguishable to the caller from a permitted write.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. generate_rollover_proposal -- Club A admin targeting Club B
-- ---------------------------------------------------------------------
do $$
declare
  v_to_season uuid;
  v_ok boolean := false;
begin
  select id into v_to_season from public.seasons where rugby_code='union' and is_regression_fixture = false order by starts_on desc limit 1;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"5ea50000-0000-0000-0000-00000000aaaa","role":"authenticated"}', true);
  begin
    perform public.generate_rollover_proposal('5ea50000-0000-0000-0000-00000000000b', 'union', v_to_season);
    raise notice 'FAIL 1: Club A admin generated a rollover proposal for Club B';
  exception when others then
    if sqlstate = '42501' then
      v_ok := true;
      raise notice 'PASS 1: generate_rollover_proposal cross-club denied (42501) -- %', sqlerrm;
    else
      raise notice 'FAIL 1: denied but with unexpected sqlstate % -- %', sqlstate, sqlerrm;
    end if;
  end;
  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------
-- 2. confirm_rollover_team_proposal -- Club A admin on Club B's proposal
-- ---------------------------------------------------------------------
do $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"5ea50000-0000-0000-0000-00000000aaaa","role":"authenticated"}', true);
  begin
    perform public.confirm_rollover_team_proposal('5ea50000-0000-0000-0000-00000000ee21', 'confirm');
    raise notice 'FAIL 2: Club A admin confirmed Club B''s rollover proposal';
  exception when others then
    if sqlstate = '42501' then
      raise notice 'PASS 2: confirm_rollover_team_proposal cross-club denied (42501) -- %', sqlerrm;
    else
      raise notice 'FAIL 2: denied but with unexpected sqlstate % -- %', sqlstate, sqlerrm;
    end if;
  end;
  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------
-- 3. confirm_mixed_boundary_rollover -- Club A admin on Club B's proposal
-- ---------------------------------------------------------------------
do $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"5ea50000-0000-0000-0000-00000000aaaa","role":"authenticated"}', true);
  begin
    perform public.confirm_mixed_boundary_rollover('5ea50000-0000-0000-0000-00000000ee22', false);
    raise notice 'FAIL 3: Club A admin confirmed Club B''s mixed-boundary rollover';
  exception when others then
    if sqlstate = '42501' then
      raise notice 'PASS 3: confirm_mixed_boundary_rollover cross-club denied (42501) -- %', sqlerrm;
    else
      raise notice 'FAIL 3: denied but with unexpected sqlstate % -- %', sqlstate, sqlerrm;
    end if;
  end;
  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------
-- 4. resolve_rollover_group_flag -- Club A admin on Club B's flag
-- ---------------------------------------------------------------------
do $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"5ea50000-0000-0000-0000-00000000aaaa","role":"authenticated"}', true);
  begin
    perform public.resolve_rollover_group_flag('5ea50000-0000-0000-0000-00000000ee31');
    raise notice 'FAIL 4: Club A admin resolved Club B''s rollover group flag';
  exception when others then
    if sqlstate = '42501' then
      raise notice 'PASS 4: resolve_rollover_group_flag cross-club denied (42501) -- %', sqlerrm;
    else
      raise notice 'FAIL 4: denied but with unexpected sqlstate % -- %', sqlstate, sqlerrm;
    end if;
  end;
  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------
-- 5. place_graduating_player -- Club A admin placing Club B's graduate
--    onto Club A's OWN team. This is the nastiest vector: the target team
--    is legitimately the caller's, so only the queue entry's own club
--    ownership check can stop it.
-- ---------------------------------------------------------------------
do $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"5ea50000-0000-0000-0000-00000000aaaa","role":"authenticated"}', true);
  begin
    perform public.place_graduating_player('5ea50000-0000-0000-0000-00000000ee51', '5ea50000-0000-0000-0000-00000000ee01');
    raise notice 'FAIL 5: Club A admin poached Club B''s graduating player onto a Club A team';
  exception when others then
    -- Either the capability gate (42501) or the same-club constraint
    -- (23514) is a correct rejection -- both are real server-side stops.
    if sqlstate in ('42501','23514') then
      raise notice 'PASS 5: place_graduating_player cross-club denied (%) -- %', sqlstate, sqlerrm;
    else
      raise notice 'FAIL 5: denied but with unexpected sqlstate % -- %', sqlstate, sqlerrm;
    end if;
  end;
  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------
-- 6. mark_graduating_player_left -- Club A admin on Club B's queue entry
-- ---------------------------------------------------------------------
do $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"5ea50000-0000-0000-0000-00000000aaaa","role":"authenticated"}', true);
  begin
    perform public.mark_graduating_player_left('5ea50000-0000-0000-0000-00000000ee51');
    raise notice 'FAIL 6: Club A admin marked Club B''s graduating player as left';
  exception when others then
    if sqlstate = '42501' then
      raise notice 'PASS 6: mark_graduating_player_left cross-club denied (42501) -- %', sqlerrm;
    else
      raise notice 'FAIL 6: denied but with unexpected sqlstate % -- %', sqlstate, sqlerrm;
    end if;
  end;
  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------
-- 7. create_next_season_scheduling_group -- Club A admin on Club B's group
-- ---------------------------------------------------------------------
do $$
declare
  v_group_id uuid;
  v_to_season uuid;
begin
  select id into v_group_id from public.scheduling_groups where club_id = '5ea50000-0000-0000-0000-00000000000b' limit 1;
  select id into v_to_season from public.seasons where rugby_code='union' and is_regression_fixture = false order by starts_on desc limit 1;

  if v_group_id is null then
    -- No Club B group exists; create one so the vector is genuinely testable
    -- rather than silently skipped (a skipped vector must never read as PASS).
    insert into public.scheduling_groups (id, club_id, season_id, display_tag, active)
    values ('5ea50000-0000-0000-0000-00000000ee61', '5ea50000-0000-0000-0000-00000000000b', v_to_season, 'SHX B Group', true)
    on conflict (id) do nothing;
    v_group_id := '5ea50000-0000-0000-0000-00000000ee61';
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"5ea50000-0000-0000-0000-00000000aaaa","role":"authenticated"}', true);
  begin
    perform public.create_next_season_scheduling_group(v_group_id, v_to_season, array['5ea50000-0000-0000-0000-00000000ee02']::uuid[], 'SHX hijack');
    raise notice 'FAIL 7: Club A admin created a next-season group from Club B''s Mini-Rugby Group';
  exception when others then
    if sqlstate = '42501' then
      raise notice 'PASS 7: create_next_season_scheduling_group cross-club denied (42501) -- %', sqlerrm;
    else
      raise notice 'FAIL 7: denied but with unexpected sqlstate % -- %', sqlstate, sqlerrm;
    end if;
  end;
  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------
-- 8. POSITIVE CONTROL -- Club B's OWN admin must still succeed on their
--    own object. Without this, every PASS above could be explained by a
--    broken RPC that rejects everyone, which would be a false negative.
-- ---------------------------------------------------------------------
do $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"5ea50000-0000-0000-0000-00000000bbbb","role":"authenticated"}', true);
  begin
    perform public.resolve_rollover_group_flag('5ea50000-0000-0000-0000-00000000ee31');
    raise notice 'PASS 8 (positive control): Club B''s own admin CAN resolve their own rollover flag -- the deny in test 4 is authority-scoped, not a blanket failure';
  exception when others then
    raise notice 'FAIL 8 (positive control): Club B''s own admin was blocked on their OWN flag (%) -- % ', sqlstate, sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------
-- 9. ANONYMOUS caller must reach none of it.
-- ---------------------------------------------------------------------
do $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform public.mark_graduating_player_left('5ea50000-0000-0000-0000-00000000ee51');
    raise notice 'FAIL 9: anonymous caller reached mark_graduating_player_left';
  exception when others then
    -- Strict: only a genuine authorization/permission rejection counts.
    -- An earlier draft of this suite accepted ANY exception here and
    -- "passed" on a malformed-UUID syntax error (22P02) -- a false pass
    -- that proved nothing about authorization. 42501 is the RPC's own
    -- gate; 42883 is the function not being callable by anon at all.
    if sqlstate in ('42501','42883') then
      raise notice 'PASS 9: anonymous caller denied (%) -- %', sqlstate, sqlerrm;
    else
      raise notice 'FAIL 9: anonymous call failed for a NON-authorization reason (%) -- % (this proves nothing about security)', sqlstate, sqlerrm;
    end if;
  end;
  perform set_config('role', 'postgres', true);
end $$;

\echo '=== Suite complete. Every line above must read PASS. ==='
