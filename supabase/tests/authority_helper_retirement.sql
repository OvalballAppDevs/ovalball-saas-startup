-- LEGACY AUTHORITY HELPER RETIREMENT (Identity/Auth Slice 4; Phase 2 AJ.1 authority_helper_retirement, J.15, Z.4 PG-15/16).
--
-- Slice 4 moves authority domain by domain from the legacy helpers to the canonical capability decision.
-- This suite is the shrink ledger:
--
--   HR1  every legacy helper's reference count (RLS policies and function bodies) is at or below the ceiling
--        recorded when the last domain moved; a new reference fails here before review
--   HR2  helpers a domain has fully retired stay at zero references
--   HR3  the objects of every migrated domain reference no legacy helper and no deprecated capability key
--   HR4  FR-1: family authority in migrated objects reads guardians.state, never the legacy status column
--   PG15 policies referencing is_site_admin(), is_full_site_admin() or is_club_admin() may only decrease
--   PG16 SECURITY DEFINER bodies calling is_site_admin() may only decrease
--
-- When a later sub-slice lowers a count, lower its ceiling here in the same change.
-- Read-only; wrapped in a transaction for symmetry with the other suites.

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.policy_refs(p_helper text) returns int language sql stable as $$
  select count(*)::int from pg_policies p
  where p.schemaname in ('public', 'storage') and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~ ('\m' || p_helper || '\(');
$$;

create or replace function pg_temp.function_refs(p_helper text) returns int language sql stable as $$
  select count(*)::int from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where n.nspname in ('public', 'internal') and f.proname <> p_helper and f.prosrc ~ ('\m' || p_helper || '\(')
    and not exists (select 1 from pg_depend d where d.objid = f.oid and d.deptype = 'e');
$$;

-- HR1 / HR2 --------------------------------------------------------------------------------------------------
do $$
declare
  -- helper, policy ceiling, function-body ceiling (after Slice 4C)
  v_ceilings constant text[][] := array[
    ['has_capability', '98', '123'],
    ['is_site_admin', '115', '146'],
    ['is_full_site_admin', '15', '46'],
    ['is_club_admin', '23', '25'],
    ['can_manage_club_fixtures', '13', '42'],
    ['can_manage_club_fixtures_or_any_team', '2', '0'],
    ['can_manage_fixture_side', '2', '6'],
    ['can_manage_team', '2', '20'],
    ['can_organise_competition', '0', '2'],
    ['can_organise_edition', '8', '1'],
    ['can_manage_document_library', '6', '2'],
    ['staffs_team', '0', '3'],
    ['is_messaging_staff', '0', '0'],
    ['is_active_player_guardian', '7', '14'],
    ['is_own_linked_player', '9', '9']
  ];
  -- retired to zero by: 4a
  v_retired constant text[] := array['can_manage_player', 'may_complete_player_profile'];
  v_helper text;
  i int;
  v_p int; v_f int;
begin
  for i in 1 .. array_length(v_ceilings, 1) loop
    v_p := pg_temp.policy_refs(v_ceilings[i][1]);
    v_f := pg_temp.function_refs(v_ceilings[i][1]);
    if v_p <= v_ceilings[i][2]::int and v_f <= v_ceilings[i][3]::int then
      raise notice 'PASS HR1 %: % policies (ceiling %), % function bodies (ceiling %)', v_ceilings[i][1], v_p, v_ceilings[i][2], v_f, v_ceilings[i][3];
    else
      raise notice 'FAIL HR1 %: % policies (ceiling %), % function bodies (ceiling %) -- a legacy reference was added', v_ceilings[i][1], v_p, v_ceilings[i][2], v_f, v_ceilings[i][3];
    end if;
  end loop;

  foreach v_helper in array v_retired loop
    v_p := pg_temp.policy_refs(v_helper);
    v_f := pg_temp.function_refs(v_helper);
    if v_p = 0 and v_f = 0 then
      raise notice 'PASS HR2 % is retired: no policy or function references it', v_helper;
    else
      raise notice 'FAIL HR2 % was retired but is referenced again (% policies, % functions)', v_helper, v_p, v_f;
    end if;
  end loop;
end $$;

-- HR3 / HR4 --------------------------------------------------------------------------------------------------
do $$
declare
  -- Slice 4a (family and players)
  v_4a_functions constant text[] := array[
    'public.accept_player_account_invitation', 'public.add_child_for_guardian', 'public.approve_guardian_link_request',
    'public.cancel_guardian_link_request', 'public.create_own_player_profile', 'public.create_player_for_guardian',
    'public.get_player_permission_summary', 'public.get_team_guardian_directory', 'public.guardian_link_requests_for_approval',
    'public.invite_player_account', 'public.link_guardian_to_existing_player', 'public.my_guardian_link_requests',
    'public.player_team_allocation', 'public.reject_guardian_link_request', 'public.remove_guardian_relationship',
    'public.request_additional_guardian', 'public.request_child_link', 'public.request_player_playing_pathway',
    'public.resolve_player_duplicate_review_as_existing', 'public.resolve_player_duplicate_review_as_new',
    'public.respond_to_additional_guardian_request', 'public.send_replacement_guardian_invitation',
    'public.set_guardian_player_permission', 'public.set_player_avatar', 'public.set_player_playing_pathway',
    'public.transition_guardian_relationship',
    'internal.administered_guardian_player_ids', 'internal.can_access_player_avatar', 'internal.can_administer_player_guardians', 'internal.can_decide_guardian_link_request',
    'internal.can_edit_player_avatar', 'internal.can_player_as_family', 'internal.can_player_at_club_or_team',
    'internal.can_view_account_avatar', 'internal.close_self_added_child', 'internal.guardian_permission_effective',
    'internal.may_add_child_at_club', 'internal.may_ask_club_allocation', 'internal.may_resolve_duplicate_review',
    'internal.notify_guardian_relationship_change', 'internal.player_staff_rows'
  ];
  v_4a_tables constant text[] := array['players', 'guardians', 'guardian_link_requests', 'guardian_player_permissions',
                                        'player_account_invitations', 'player_duplicate_reviews', 'guardian_invitations'];
  -- Slice 4b (teams and roster). The gates that decide a roster, and the tables they decide over.
  v_4b_functions constant text[] := array[
    'internal.team_people_authority', 'internal.may_resolve_join_request', 'internal.regulatory_context_for_team'
  ];
  v_4b_tables constant text[] := array['player_team_memberships', 'team_season_identity'];
  -- Slice 4c (fixtures). The gates that decide a fixture, and the tables they decide over.
  v_4c_functions constant text[] := array[
    'internal.can_create_team_fixture', 'internal.can_bulk_plan_fixtures', 'internal.can_edit_fixture_details',
    'internal.can_submit_fixture_result', 'internal.can_manage_fixture_side',
    'internal.can_manage_club_fixtures_or_any_team', 'internal.caller_fixture_club_id',
    'internal.fixture_family_visible_row', 'internal.viewable_fixture_clubs', 'internal.viewable_fixture_teams',
    'public.create_fixture', 'public.archive_fixture', 'public.restore_fixture'
  ];
  v_4c_tables constant text[] := array['fixtures', 'fixture_requests', 'fixture_request_groups',
                                        'fixture_result_submissions', 'fixture_player_call_up'];
  v_legacy constant text := '\m(can_manage_player|may_complete_player_profile|is_site_admin|is_full_site_admin|is_club_admin|has_capability|is_active_player_guardian|is_own_linked_player|can_manage_team|can_manage_club_fixtures|can_manage_club_fixtures_or_any_team)\(';
  v_legacy_4b constant text := '\m(can_manage_team|is_site_admin|is_full_site_admin|is_club_admin|has_capability|can_manage_club_fixtures|can_manage_club_fixtures_or_any_team|can_manage_player|may_complete_player_profile)\(';
  -- 4c owns the fixture helpers. can_manage_fixture_side and can_manage_club_fixtures_or_any_team are
  -- themselves 4c-owned gates that now resolve canonically, so 4c code calling them is not a legacy
  -- reference; what 4c must be free of is the blanket site/club helpers and the old capability adapter.
  v_legacy_4c constant text := '\m(is_site_admin|is_full_site_admin|is_club_admin|has_capability|can_manage_team|can_manage_club_fixtures|can_manage_player|may_complete_player_profile)\(';
  v_bad text[];
begin
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname || '.' || f.proname) = any (v_4a_functions) and f.prosrc ~ v_legacy;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4a functions: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4a functions still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  select coalesce(array_agg(distinct n.nspname || '.' || f.proname), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  join public.capabilities c on c.status = 'DEPRECATED'
  where (n.nspname || '.' || f.proname) = any (v_4a_functions) and f.prosrc like '%''' || c.key || '''%';
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4a functions: no deprecated capability key';
  else
    raise notice 'FAIL HR3 4a functions still name a deprecated capability key: %', array_to_string(v_bad, ', ');
  end if;

  if (select count(*) filter (where n.nspname || '.' || f.proname = any (v_4a_functions)) from pg_proc f join pg_namespace n on n.oid = f.pronamespace)
     = cardinality(v_4a_functions) then
    raise notice 'PASS HR3 every 4a function in the ledger exists (the list is not stale)';
  else
    raise notice 'FAIL HR3 the 4a function list names a function that no longer exists';
  end if;

  -- Slice 4b -----------------------------------------------------------------------------------------------
  -- 4b owns the team and roster helpers. It does NOT own is_own_linked_player or
  -- is_active_player_guardian: those are Slice 4a family helpers, still live under their own HR1 ceilings
  -- (9/9 and 7/14) and assigned to a later slice. They appear in a roster policy because a player reads
  -- their own place and a guardian reads their child's, which is family authority answering a family
  -- question. Rewriting them here would be reaching into 4a's domain rather than migrating 4b's, so the
  -- 4b check asserts freedom from the helpers 4b is responsible for.
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname || '.' || f.proname) = any (v_4b_functions) and f.prosrc ~ v_legacy_4b;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4b functions: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4b functions still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  if (select count(*) filter (where n.nspname || '.' || f.proname = any (v_4b_functions)) from pg_proc f join pg_namespace n on n.oid = f.pronamespace)
     = cardinality(v_4b_functions) then
    raise notice 'PASS HR3 every 4b function in the ledger exists (the list is not stale)';
  else
    raise notice 'FAIL HR3 the 4b function list names a function that no longer exists';
  end if;

  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = any (v_4b_tables)
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ v_legacy_4b;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4b table policies: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4b table policies still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  -- Slice 4c -----------------------------------------------------------------------------------------------
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname || '.' || f.proname) = any (v_4c_functions) and f.prosrc ~ v_legacy_4c;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4c functions: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4c functions still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  if (select count(*) filter (where n.nspname || '.' || f.proname = any (v_4c_functions)) from pg_proc f join pg_namespace n on n.oid = f.pronamespace)
     = cardinality(v_4c_functions) then
    raise notice 'PASS HR3 every 4c function in the ledger exists (the list is not stale)';
  else
    raise notice 'FAIL HR3 the 4c function list names a function that no longer exists';
  end if;

  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = any (v_4c_tables)
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ v_legacy_4c;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4c table policies: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4c table policies still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  -- The superseded resolver is dropped, not merely uncalled: while it existed its body double-counted
  -- the Slice 4a family branch against that slice's own retirement ceilings.
  if not exists (
    select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
    where n.nspname = 'internal' and f.proname = 'fixture_visible_row'
  ) then
    raise notice 'PASS HR3 4c: the superseded internal.fixture_visible_row is gone';
  else
    raise notice 'FAIL HR3 4c: internal.fixture_visible_row is still installed';
  end if;

  -- 4c's contract change: creation travels through public.create_fixture, so no browser role may
  -- INSERT a fixture directly. This is the bypass that let a club be booked without being asked.
  if not has_table_privilege('authenticated', 'public.fixtures', 'INSERT')
     and not has_table_privilege('anon', 'public.fixtures', 'INSERT') then
    raise notice 'PASS HR3 4c: no browser role may INSERT a fixture directly';
  else
    raise notice 'FAIL HR3 4c: a browser role still holds INSERT on public.fixtures';
  end if;

  -- The legacy team.view key is retired, not merely unused (Slice 4B, AA.3 row 4b).
  if not exists (select 1 from public.capability_key_map where legacy_key = 'team.view') then
    raise notice 'PASS HR3 4b: the legacy team.view adapter row is gone';
  else
    raise notice 'FAIL HR3 4b: the legacy team.view adapter row is back';
  end if;

  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = any (v_4a_tables)
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ v_legacy;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4a table policies: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4a table policies still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  select coalesce(array_agg(policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname = 'storage' and (policyname like 'player_avatars%' or policyname like 'avatars%')
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ v_legacy;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 picture storage policies: no legacy authority helper';
  else
    raise notice 'FAIL HR3 picture storage policies still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  -- FR-1: only ACTIVE relationships confer family-derived access; the legacy lower-case status column is a
  -- compatibility copy and is never read for authority in migrated code.
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname || '.' || f.proname) = any (v_4a_functions)
    and f.prosrc ~* '\m(g|guardians)\.status\s*=\s*''active''';
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR4 FR-1: 4a functions read guardians.state, not the legacy status column';
  else
    raise notice 'FAIL HR4 FR-1: 4a functions read guardians.status: %', array_to_string(v_bad, ', ');
  end if;
  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = any (v_4a_tables)
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '\mstatus\s*=\s*''active''';
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR4 FR-1: 4a table policies read state, not the legacy status column';
  else
    raise notice 'FAIL HR4 FR-1: 4a table policies read status: %', array_to_string(v_bad, ', ');
  end if;
end $$;

-- PG-15 / PG-16 ----------------------------------------------------------------------------------------------
do $$
declare
  v_pg15_ceiling constant int := 130;  -- after Slice 4C (4b: 138, 4a: 140, Slice 3: 149); reaches 0 at Slice 7
  v_pg16_ceiling constant int := 145;  -- after Slice 4C (4b: 157, 4a: 159, Slice 3: 162)
  v int;
begin
  select count(*) into v from pg_policies p
  where p.schemaname in ('public', 'storage')
    and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~ '\m(is_site_admin|is_full_site_admin|is_club_admin)\(';
  if v <= v_pg15_ceiling then
    raise notice 'PASS PG15 % policies reference is_site_admin/is_full_site_admin/is_club_admin (ceiling %)', v, v_pg15_ceiling;
  else
    raise notice 'FAIL PG15 % policies reference is_site_admin/is_full_site_admin/is_club_admin (ceiling %)', v, v_pg15_ceiling;
  end if;

  select count(*) into v from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where n.nspname in ('public', 'internal') and f.prosecdef and f.proname <> 'is_site_admin' and f.prosrc ~ '\mis_site_admin\(';
  if v <= v_pg16_ceiling then
    raise notice 'PASS PG16 % SECURITY DEFINER bodies call is_site_admin() (ceiling %)', v, v_pg16_ceiling;
  else
    raise notice 'FAIL PG16 % SECURITY DEFINER bodies call is_site_admin() (ceiling %)', v, v_pg16_ceiling;
  end if;
end $$;

rollback;
