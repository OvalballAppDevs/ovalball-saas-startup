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
  -- helper, policy ceiling, function-body ceiling (after Slice 4a)
  v_ceilings constant text[][] := array[
    ['has_capability', '98', '125'],
    ['is_site_admin', '125', '160'],
    ['is_full_site_admin', '15', '46'],
    ['is_club_admin', '23', '25'],
    ['can_manage_club_fixtures', '20', '57'],
    ['can_manage_club_fixtures_or_any_team', '2', '0'],
    ['can_manage_fixture_side', '3', '6'],
    ['can_manage_team', '9', '29'],
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
  v_legacy constant text := '\m(can_manage_player|may_complete_player_profile|is_site_admin|is_full_site_admin|is_club_admin|has_capability|is_active_player_guardian|is_own_linked_player|can_manage_team|can_manage_club_fixtures|can_manage_club_fixtures_or_any_team)\(';
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
  v_pg15_ceiling constant int := 140;  -- after Slice 4a (Slice 3: 149); reaches 0 at Slice 7
  v_pg16_ceiling constant int := 159;  -- after Slice 4a (Slice 3: 162)
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
