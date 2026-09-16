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
  -- helper, policy ceiling, function-body ceiling (after Slice 4I)
  v_ceilings constant text[][] := array[
    ['has_capability', '86', '61'],
    ['is_site_admin', '86', '92'],
    ['is_full_site_admin', '14', '38'],
    -- 4H took every one of the 23 policies AA.3 row 4h names and left 14 bodies. 4I has taken its
    -- 11 -- the rollover, graduation, handover and team-lifecycle RPCs of J.5. The 3 that remain are
    -- named in HR3 below and belong to 4b and 4c; this slice did not take them to flatter the number.
    ['is_club_admin', '0', '3'],
    ['can_manage_club_fixtures', '12', '27'],
    ['can_manage_club_fixtures_or_any_team', '2', '0'],
    ['can_manage_fixture_side', '2', '6'],
    ['can_manage_team', '1', '15'],
    ['can_organise_competition', '0', '2'],
    ['can_organise_edition', '0', '1'],
    -- 4I moved the document library onto club.documents.manage / club.documents.view. No policy asks
    -- either helper now; the two bodies that remain are the storage-path predicate and the delete
    -- RPC, which are the reachable callers the matrix exercises directly (MI-B12..B16).
    ['can_manage_document_library', '0', '2'],
    ['is_active_player_guardian', '7', '14'],
    ['is_own_linked_player', '9', '9']
  ];
  -- retired to zero by: 4a
  v_retired constant text[] := array['can_manage_player', 'may_complete_player_profile',
  -- retired to zero by: 4f. Both are also dropped outright -- a zero-caller raw-role helper is still a
  -- hazard, because the next person needing the answer may find it before they find the canonical one.
  -- messaging_authority_matrix MA-A asserts their non-existence; this only guards the reference count.
                                     'staffs_team', 'is_messaging_staff'];
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
  -- Slice 4d (competitions and tournaments). The gates that decide a competition or a festival,
  -- and the tables they decide over.
  v_4d_functions constant text[] := array[
    'internal.can_organise_competition', 'internal.can_organise_edition',
    'internal.can_answer_competition_match', 'internal.can_manage_tournament',
    'internal.can_manage_tournament_entry', 'internal.organised_edition_ids',
    'public.issue_competition_matches'
  ];
  -- Slice 4e (calendar, venues, pitches, training). The gates that decide a ground, a session or a
  -- club event, and the tables they decide over.
  v_4e_functions constant text[] := array[
    'internal.can_manage_club_event', 'internal.club_event_visible_row', 'internal.can_manage_training',
    'internal.can_manage_club_training', 'internal.training_session_visible_row',
    'internal.can_manage_venue', 'internal.can_manage_pitch', 'internal.can_view_venue'
  ];
  v_4e_tables constant text[] := array['venues', 'club_pitches', 'club_events', 'training_plans',
                                        'training_sessions', 'training_plan_schedule_rules'];
  -- 4e owns the calendar, venue, pitch and training gates. The family branches inside
  -- club_event_visible_row and training_session_visible_row ask Slice 4a's helpers, because "a
  -- player on this team, or their active guardian" is a family question 4a owns -- the same
  -- boundary 4b drew for its roster policies.
  v_legacy_4e constant text := '\m(is_site_admin|is_full_site_admin|is_club_admin|has_capability|can_manage_team|can_manage_club_fixtures)\(';
  v_4d_tables constant text[] := array['competition_matches', 'competition_stages', 'competition_rounds',
                                        'competition_groups', 'competition_group_members',
                                        'competition_participants', 'competition_match_fixtures',
                                        'competition_match_verifications'];
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
  -- Slice 4h (club administration and finance). The ten tables the ledger assigns to this slice, the
  -- finance surface J.13 governs, and the gates that decide a club-administration question.
  v_4h_functions constant text[] := array[
    'internal.club_ids_with', 'public.record_club_export', 'internal.can_address_club_audience',
    'public.get_club_member_directory', 'public.update_message_communication_policy',
    'public.list_fixtures_since_deactivation', 'public.decide_player_dispensation',
    'public.revoke_player_dispensation', 'internal.assert_club_setup_authority',
    'public.export_finance_rows', 'public.record_payment_refund', 'public.set_subscription_price',
    'public.select_club_plan', 'public.store_gocardless_connection', 'public.upsert_club_kit'
  ];
  v_4h_tables constant text[] := array['clubs', 'teams', 'club_memberships', 'role_assignments',
                                        'club_join_requests', 'invitations', 'invitation_teams',
                                        'club_contacts', 'team_contacts', 'club_opponent_notes'];
  v_legacy_4h constant text := '\m(is_site_admin|is_full_site_admin|is_club_admin|has_capability|staffs_team|is_messaging_staff)\(';
  -- Slice 4g (safeguarding and dispensations). The gates that decide an appointment, a safeguarding
  -- thread, a welfare record and a dispensation, and the tables they decide over. The two legacy items
  -- AA.3 row 4g names are the per-officer override dependence -- officer identity read off a table a
  -- Club Admin writes -- and the Site Admin thread read.
  v_4g_functions constant text[] := array[
    'internal.active_safeguarding_officer_ids', 'internal.is_active_safeguarding_officer',
    'internal.enter_safeguarding_nomination', 'internal.can_view_safeguarding_conversation',
    'internal.can_send_safeguarding_conversation', 'internal.notify_club_safeguarding_officers',
    'public.confirm_safeguarding_officer', 'public.nominate_club_safeguarding_officer',
    'public.pending_safeguarding_nominations', 'public.site_safeguarding_review',
    'public.welfare_member_view', 'public.club_safeguarding_contact',
    'public.start_safeguarding_conversation', 'public.get_club_safeguarding_officers',
    'public.update_safeguarding_officer_contact', 'public.deactivate_safeguarding_officer',
    'public.start_or_get_safeguarding_officer_conversation'
  ];
  v_4g_tables constant text[] := array['club_safeguarding_officers', 'club_safeguarding_officer_conversations',
                                        'club_safeguarding_officer_invitations', 'safeguarding_thread_reviews'];
  -- is_club_admin is NOT in this list, and its absence is deliberate: the club stage of a dispensation
  -- needs a Club Admin, which is what that helper says, and AA.3 row 4h owns retiring it.
  v_legacy_4g constant text := '\m(is_site_admin|is_full_site_admin|has_capability|can_manage_team|can_manage_club_fixtures|staffs_team|is_messaging_staff)\(';
  -- Slice 4f (messaging and notifications). The gates that decide who may open, read, write, moderate
  -- or report a conversation, and the tables they decide over. The family branches inside
  -- can_view_team_conversation / can_send_team_conversation still ask Slice 4a's helpers, because
  -- "a player on this team, or their active guardian" is a family question 4a owns.
  v_4f_functions constant text[] := array[
    'internal.can_access_fixture_conversation', 'internal.can_view_team_conversation',
    'internal.can_send_team_conversation', 'internal.can_access_conversation',
    'internal.can_access_any_conversation', 'internal.may_send_as', 'internal.may_direct_message',
    'internal.team_messaging_staff', 'internal.message_report_club',
    'public.report_message', 'public.club_message_reports', 'public.block_user_from_club_messages',
    'public.lift_club_message_block', 'public.update_club_message_policy', 'public.update_global_message_policy',
    'public.start_or_get_club_conversation', 'public.respond_to_club_conversation',
    'public.moderator_delete_message', 'public.admin_get_message_thread_content'
  ];
  v_4f_tables constant text[] := array['team_conversations', 'club_message_blocks', 'message_policies',
                                        'message_reports', 'fixture_messages'];
  v_legacy_4f constant text := '\m(is_site_admin|is_full_site_admin|is_club_admin|has_capability|can_manage_team|can_manage_club_fixtures|staffs_team|is_messaging_staff)\(';
  v_legacy constant text := '\m(can_manage_player|may_complete_player_profile|is_site_admin|is_full_site_admin|is_club_admin|has_capability|is_active_player_guardian|is_own_linked_player|can_manage_team|can_manage_club_fixtures|can_manage_club_fixtures_or_any_team)\(';
  v_legacy_4b constant text := '\m(can_manage_team|is_site_admin|is_full_site_admin|is_club_admin|has_capability|can_manage_club_fixtures|can_manage_club_fixtures_or_any_team|can_manage_player|may_complete_player_profile)\(';
  -- 4c owns the fixture helpers. can_manage_fixture_side and can_manage_club_fixtures_or_any_team are
  -- themselves 4c-owned gates that now resolve canonically, so 4c code calling them is not a legacy
  -- reference; what 4c must be free of is the blanket site/club helpers and the old capability adapter.
  v_legacy_4c constant text := '\m(is_site_admin|is_full_site_admin|is_club_admin|has_capability|can_manage_team|can_manage_club_fixtures|can_manage_player|may_complete_player_profile)\(';
  -- 4d owns the competition and tournament gates. can_bulk_plan_fixtures and can_create_team_fixture
  -- are 4c's CANONICAL gates rather than legacy helpers, so a 4d POLICY may ask them -- the match
  -- verification row asks "may this club plan fixtures", which is a fixture question 4c owns. 4d's own
  -- function bodies must be free of them, because borrowing 4c's Planner gate to answer "do you
  -- organise this competition" is exactly what this slice removed.
  v_legacy_4d_fn constant text := '\m(is_site_admin|is_full_site_admin|is_club_admin|has_capability|can_manage_team|can_manage_club_fixtures|can_bulk_plan_fixtures|is_club_fixture_administrator)\(';
  v_legacy_4d_pol constant text := '\m(is_site_admin|is_full_site_admin|is_club_admin|has_capability|can_manage_team|can_manage_club_fixtures|is_club_fixture_administrator)\(';
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

  -- Slice 4d -----------------------------------------------------------------------------------------------
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname || '.' || f.proname) = any (v_4d_functions) and f.prosrc ~ v_legacy_4d_fn;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4d functions: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4d functions still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  if (select count(*) filter (where n.nspname || '.' || f.proname = any (v_4d_functions)) from pg_proc f join pg_namespace n on n.oid = f.pronamespace)
     = cardinality(v_4d_functions) then
    raise notice 'PASS HR3 every 4d function in the ledger exists (the list is not stale)';
  else
    raise notice 'FAIL HR3 the 4d function list names a function that no longer exists';
  end if;

  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = any (v_4d_tables)
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ v_legacy_4d_pol;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4d table policies: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4d table policies still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  -- AA.3 row 4d retires the TOURNAMENT use of the deprecated calendar.manage key. Other domains keep
  -- it until their own slice: a club event is 4e's question, not this one's.
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname || '.' || f.proname) = any (v_4d_functions) and f.prosrc like '%''calendar.manage''%';
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4d: the deprecated calendar.manage key decides no tournament authority';
  else
    raise notice 'FAIL HR3 4d still decides tournament authority with calendar.manage: %', array_to_string(v_bad, ', ');
  end if;

  -- The raw-role helper is dropped, not merely uncalled: it matched the membership role strings
  -- 'CLUB_ADMIN' and 'FIXTURE_SECRETARY' directly, and a zero-caller raw-role helper is a hazard.
  if not exists (
    select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
    where n.nspname = 'internal' and f.proname = 'is_club_fixture_administrator'
  ) then
    raise notice 'PASS HR3 4d: internal.is_club_fixture_administrator is gone';
  else
    raise notice 'FAIL HR3 4d: internal.is_club_fixture_administrator is still installed';
  end if;

  -- Slice 4e -----------------------------------------------------------------------------------------------
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname || '.' || f.proname) = any (v_4e_functions) and f.prosrc ~ v_legacy_4e;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4e functions: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4e functions still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  if (select count(*) filter (where n.nspname || '.' || f.proname = any (v_4e_functions)) from pg_proc f join pg_namespace n on n.oid = f.pronamespace)
     = cardinality(v_4e_functions) then
    raise notice 'PASS HR3 every 4e function in the ledger exists (the list is not stale)';
  else
    raise notice 'FAIL HR3 the 4e function list names a function that no longer exists';
  end if;

  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = any (v_4e_tables)
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ v_legacy_4e;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4e table policies: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4e table policies still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  -- AA.3 row 4e retires the role-string RPC checks. The venue RPCs asked internal.is_club_admin
  -- while the venue RLS asked a capability -- the U section's "venues RLS/RPC mismatch".
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where n.nspname = 'public'
    and f.proname in ('create_venue', 'update_venue', 'set_venue_active', 'set_default_venue', 'set_venue_address',
                      'create_club_pitch', 'rename_club_pitch', 'reorder_club_pitches', 'set_club_pitch_active', 'set_club_pitch_venue')
    and f.prosrc ~ '\m(is_club_admin|can_manage_club_fixtures|is_site_admin)\(';
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4e: no venue or pitch RPC decides authority by role string';
  else
    raise notice 'FAIL HR3 4e venue/pitch RPCs still use a role-string check: %', array_to_string(v_bad, ', ');
  end if;

  -- The calendar adapter rows are retired, not merely unused (AA.3 row 4e; J.9 lines 496-497).
  if not exists (select 1 from public.capability_key_map where legacy_key in ('calendar.manage', 'calendar.view')) then
    raise notice 'PASS HR3 4e: the calendar.manage / calendar.view adapter rows are gone';
  else
    raise notice 'FAIL HR3 4e: a calendar legacy adapter row is back';
  end if;

  -- "public training plans" (M-2). Slice 1 closed it at the privilege layer; this asserts it stays
  -- closed, and that the one deliberate public projection still serves.
  if not exists (
    select 1 from information_schema.column_privileges
    where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT'
      and table_name in ('training_plans', 'training_sessions', 'training_plan_schedule_rules', 'club_events', 'club_pitches', 'venues')
  ) and has_table_privilege('anon', 'public.public_venues', 'SELECT') then
    raise notice 'PASS HR3 4e: M-2 holds -- anon reads no training, event, pitch or venue table, only public_venues';
  else
    raise notice 'FAIL HR3 4e: the M-2 closure or the public venue projection is broken';
  end if;

  -- Slice 4f -----------------------------------------------------------------------------------------------
  -- internal.may_send_as is excluded here and asserted separately below. It is the one 4f function
  -- with a legacy call left in it, and the exclusion is what keeps that fact visible rather than
  -- quietly widening v_legacy_4f for everybody.
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname || '.' || f.proname) = any (v_4f_functions)
    and n.nspname || '.' || f.proname <> 'internal.may_send_as'
    and f.prosrc ~ v_legacy_4f;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4f functions: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4f functions still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  -- THE SINGLE PERMITTED RESIDUE, pinned so it cannot grow. "May you speak as Ovalball itself" has
  -- no row in J.10 and no key in the catalogue, and AA.3 puts site-side is_site_admin removal in
  -- Slice 7; that one branch therefore waits. The other two site branches DO have a recorded site
  -- master (site.support.act_in_club, J.10 lines 514-515) and were canonicalised in 4f. Asserting
  -- the count is exactly one is what stops either of them quietly reverting to the role string.
  select coalesce(array_agg(x order by x), '{}') into v_bad
  from (
    select case
             when (select count(*) from regexp_matches(f.prosrc, '\mis_full_site_admin\(', 'g')) <> 1
               then 'is_full_site_admin appears ' ||
                    (select count(*) from regexp_matches(f.prosrc, '\mis_full_site_admin\(', 'g'))::text ||
                    ' times, expected exactly 1 (the platform branch)'
           end as x
    from pg_proc f join pg_namespace n on n.oid = f.pronamespace
    where n.nspname = 'internal' and f.proname = 'may_send_as'
    union all
    select case
             when f.prosrc ~ '\m(is_site_admin|is_club_admin|has_capability|can_manage_team|can_manage_club_fixtures|staffs_team|is_messaging_staff)\('
               then 'may_send_as calls a legacy helper other than the permitted is_full_site_admin'
           end
    from pg_proc f join pg_namespace n on n.oid = f.pronamespace
    where n.nspname = 'internal' and f.proname = 'may_send_as'
    union all
    select case
             when f.prosrc !~ 'site\.support\.act_in_club'
               then 'may_send_as no longer asks the J.10 site master site.support.act_in_club'
           end
    from pg_proc f join pg_namespace n on n.oid = f.pronamespace
    where n.nspname = 'internal' and f.proname = 'may_send_as'
  ) q
  where x is not null;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4f may_send_as: exactly one permitted is_full_site_admin branch (platform), the rest canonical';
  else
    raise notice 'FAIL HR3 4f may_send_as: %', array_to_string(v_bad, '; ');
  end if;

  if (select count(*) filter (where n.nspname || '.' || f.proname = any (v_4f_functions)) from pg_proc f join pg_namespace n on n.oid = f.pronamespace)
     = cardinality(v_4f_functions) then
    raise notice 'PASS HR3 every 4f function in the ledger exists (the list is not stale)';
  else
    raise notice 'FAIL HR3 the 4f function list names a function that no longer exists';
  end if;

  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = any (v_4f_tables)
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ v_legacy_4f;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4f table policies: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4f table policies still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  -- AA.3 row 4f retires the team.community.manage adapter rows: retired, not merely unused.
  if not exists (select 1 from public.capability_key_map where legacy_key = 'team.community.manage') then
    raise notice 'PASS HR3 4f: the team.community.manage adapter rows are gone';
  else
    raise notice 'FAIL HR3 4f: a team.community.manage legacy adapter row is back';
  end if;

  -- Slice 4g -----------------------------------------------------------------------------------------------
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname || '.' || f.proname) = any (v_4g_functions) and f.prosrc ~ v_legacy_4g;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4g functions: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4g functions still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  if (select count(*) filter (where n.nspname || '.' || f.proname = any (v_4g_functions)) from pg_proc f join pg_namespace n on n.oid = f.pronamespace)
     = cardinality(v_4g_functions) then
    raise notice 'PASS HR3 every 4g function in the ledger exists (the list is not stale)';
  else
    raise notice 'FAIL HR3 the 4g function list names a function that no longer exists';
  end if;

  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = any (v_4g_tables)
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ v_legacy_4g;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4g table policies: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4g table policies still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  -- AA.3 row 4g retires the transitional club.safeguarding.* keys Slice 3 kept "until 4g".
  if not exists (select 1 from public.capability_key_map where legacy_key like 'club.safeguarding.%') then
    raise notice 'PASS HR3 4g: the transitional club.safeguarding.* adapter rows are gone';
  else
    raise notice 'FAIL HR3 4g: a transitional club.safeguarding adapter row is back';
  end if;

  -- Slice 4h -----------------------------------------------------------------------------------------------
  -- decide_player_dispensation is excluded here and asserted separately below. 4H owns the CLUB and
  -- governing-body stages of that function; the source-team stage beside them asks
  -- approve_player_dispensations, which is a fixtures question and AA.3 row 4c's. The exclusion is
  -- what keeps that fact visible instead of widening v_legacy_4h for everybody.
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname || '.' || f.proname) = any (v_4h_functions)
    and n.nspname || '.' || f.proname <> 'public.decide_player_dispensation'
    and f.prosrc ~ v_legacy_4h;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4h functions: no legacy authority helper';
  else
    raise notice 'FAIL HR3 4h functions still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  if (select count(*) filter (where n.nspname || '.' || f.proname = any (v_4h_functions)) from pg_proc f join pg_namespace n on n.oid = f.pronamespace)
     = cardinality(v_4h_functions) then
    raise notice 'PASS HR3 every 4h function in the ledger exists (the list is not stale)';
  else
    raise notice 'FAIL HR3 the 4h function list names a function that no longer exists';
  end if;

  select coalesce(array_agg(tablename || '.' || policyname order by 1), '{}') into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = any (v_4h_tables)
    and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ v_legacy_4h;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4h table policies: no legacy authority helper on any of the ten tables';
  else
    raise notice 'FAIL HR3 4h table policies still call a legacy helper: %', array_to_string(v_bad, ', ');
  end if;

  -- AA.3 row 4h retires eleven club administration and finance aliases.
  if not exists (select 1 from public.capability_key_map where legacy_key in (
      'club.edit_profile','club.subscription.view_finance','club.subscription.configure',
      'club.subscription.manage_enrolment','club.subscription.manage_payment_actions','club.subscription.export',
      'club.gocardless.connect','club.platform_billing.view','club.platform_billing.manage',
      'club.capabilities.manage','permissions.club_manage')) then
    raise notice 'PASS HR3 4h: the eleven club administration and finance adapter rows are gone';
  else
    raise notice 'FAIL HR3 4h: a club administration or finance adapter row is back';
  end if;

  -- THE ONE PERMITTED RESIDUE, pinned so it cannot grow. 4H's two stages are canonical; the source-team
  -- stage's single has_capability call is 4c's, and the count is asserted so neither of 4H's stages can
  -- quietly revert to one.
  if (select count(*) from regexp_matches(
        (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'decide_player_dispensation'),
        '\mhas_capability\(', 'g')) = 2
     and (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'decide_player_dispensation') !~ '\m(is_club_admin|is_site_admin|is_full_site_admin)\('
  then
    raise notice 'PASS HR3 4h decide_player_dispensation: only the source-team stage is legacy, and no raw role helper remains';
  else
    raise notice 'FAIL HR3 4h decide_player_dispensation: the legacy residue moved';
  end if;

  -- J.13's hard boundary, structurally: no site-admin profile acts on a club's money.
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where n.nspname in ('public','internal')
    and f.prosrc ~ '\mfinance\.(payment\.act|subscription\.(configure|export)|enrolment\.manage|gocardless\.connect)\m'
    and f.prosrc ~ '\m(is_site_admin|is_full_site_admin)\(';
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4h: nothing that acts on a club''s money carries a Site Admin branch (J.13)';
  else
    raise notice 'FAIL HR3 4h: a club-money function has a Site Admin branch: %', array_to_string(v_bad, ', ');
  end if;

  -- And the bodies 4h deliberately did NOT take, so the omission stays visible. 4h left 14 and named
  -- them as 4b's, 4c's and 4i's; 4i has since taken its 11, which leaves 4b's team helper, 4c's
  -- fixtures helper and 4c's restoration RPC. Nothing else may move without a slice claiming it.
  if (select count(*) from pg_proc f join pg_namespace n on n.oid = f.pronamespace
      where n.nspname in ('public','internal') and f.proname <> 'is_club_admin' and f.prosrc ~ '\mis_club_admin\(') = 3 then
    raise notice 'PASS HR3 4h: the 3 remaining is_club_admin bodies are 4b''s and 4c''s, after 4i took its 11';
  else
    raise notice 'FAIL HR3 4h: the remaining is_club_admin body count moved without a slice claiming it';
  end if;

  -- ---- Slice 4I (AA.3 row 4i): documents, partners, referrals and handover ----
  -- The document library's two helpers no longer decide anything by role string, and no policy asks
  -- them at all -- the one reachable caller left is the object-storage predicate.
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where n.nspname = 'internal' and f.proname in ('can_manage_document_library','can_view_document_library')
    and (f.prosrc ~ '\mcm\.role\m' or f.prosrc ~ 'site_admin_role\(');
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4i: neither document helper decides by a membership or site-admin role string';
  else
    raise notice 'FAIL HR3 4i: a document helper still reads a role string: %', array_to_string(v_bad, ', ');
  end if;

  -- Z-12: the club-documents bucket is complete. A bucket that can be written but never cleared is a
  -- retention problem, not a convenience one.
  if (select count(*) from pg_policies where schemaname = 'storage'
      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) like '%club-documents%') = 4 then
    raise notice 'PASS HR3 4i: the club-documents bucket has all four policies, including delete (Z-12)';
  else
    raise notice 'FAIL HR3 4i: the club-documents bucket does not have exactly four policies (Z-12)';
  end if;

  -- Section U, structurally. These are two different keys in two different functions, and a single
  -- function accepting both would be the split undone.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'apply_season_handover') ~ 'team\.handover\.apply'
     and (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'apply_season_handover') !~ 'team\.handover\.prepare'
  then
    raise notice 'PASS HR3 4i: applying a season handover asks team.handover.apply and not the prepare key (U)';
  else
    raise notice 'FAIL HR3 4i: section U is not enforced in apply_season_handover';
  end if;

  -- And the two decisions INSIDE a handover that are not preparation. Folding a side and graduating
  -- a cohort keep their own lifecycle gates, so the preparation route is not a second door to them.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'decide_rollover_team_proposal') ~ 'team\.lifecycle\.manage'
     and (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'decide_rollover_team_proposal') !~ 'team\.handover\.prepare'
  then
    raise notice 'PASS HR3 4i: folding and graduating through a handover still ask team.lifecycle.manage';
  else
    raise notice 'FAIL HR3 4i: a fold or graduate decision inside a handover can be reached with the preparation key';
  end if;

  -- The three adapter rows 4I retires, and the ones it deliberately leaves to their own slices.
  if not exists (select 1 from public.capability_key_map
                 where legacy_key in ('club.season_rollover.manage','club.team_lifecycle.manage','partner.manage'))
     and exists (select 1 from public.capability_key_map where legacy_key = 'club.guardians.manage')
     and exists (select 1 from public.capability_key_map where legacy_key = 'fixture.edit')
  then
    raise notice 'PASS HR3 4i: the three 4i adapter rows are retired and 4a''s and 4c''s are not';
  else
    raise notice 'FAIL HR3 4i: the 4i adapter retirement is wrong, or it consumed another slice''s rows';
  end if;

  -- THE PER-OFFICER OVERRIDE DEPENDENCE, retired. Officer identity used to come from
  -- club_safeguarding_officers.user_id / status; it now comes from an ACTIVE CONFIRMED assignment.
  -- Naming the columns is what makes this a real check rather than a restatement of the one above.
  select coalesce(array_agg(n.nspname || '.' || f.proname order by 1), '{}') into v_bad
  from pg_proc f join pg_namespace n on n.oid = f.pronamespace
  where (n.nspname || '.' || f.proname) in (
      'internal.can_view_safeguarding_conversation', 'internal.can_send_safeguarding_conversation',
      'internal.notify_club_safeguarding_officers')
    and f.prosrc ~ 'club_safeguarding_officers';
  if cardinality(v_bad) = 0 then
    raise notice 'PASS HR3 4g: no safeguarding gate reads officer identity from the contact table';
  else
    raise notice 'FAIL HR3 4g: a safeguarding gate still reads the contact table: %', array_to_string(v_bad, ', ');
  end if;

  -- AN-6, structurally: nothing may enter a Safeguarding Officer assignment already confirmed.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'grant_role') ~ 'PENDING_CONFIRMATION' then
    raise notice 'PASS HR3 4g: a nomination enters PENDING_CONFIRMATION, so AN-6 is reachable';
  else
    raise notice 'FAIL HR3 4g: grant_role no longer enters a Safeguarding Officer pending';
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
  v_pg15_ceiling constant int := 100;  -- after Slice 4H (4g: 124, 4f: 128, 4e: 130, 4d: 130, 4c: 130, 4b: 138, 4a: 140, Slice 3: 149); reaches 0 at Slice 7
  v_pg16_ceiling constant int := 91;   -- after Slice 4H (4g: 121, 4f: 124, 4e: 135, 4d: 143, 4c: 145, 4b: 157, 4a: 159, Slice 3: 162)
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
