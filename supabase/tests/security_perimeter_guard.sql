-- SECURITY PERIMETER GUARD.
--
-- Structural checks over the catalog, so a later migration cannot quietly
-- reopen what the identity containment closed:
--
--   P1. No NEW SECURITY DEFINER function in public becomes executable by
--       anon. Supabase grants EXECUTE on every new function to anon by
--       default, so a new definer function must revoke it or be added to the
--       inventory below by a deliberate, reviewed change. The inventory is the
--       state at containment; it may only shrink.
--   P2. The functions the containment narrowed stay narrowed.
--   P3. No write policy anywhere in public accepts a row unconditionally.
--   P4. Views that run with their owner's rights are not readable by anon,
--       apart from the deliberately public ones listed.
--   P5. Browser roles keep no write access to children's records, and cannot
--       write the protected columns of profiles or club_memberships.
--   P6. Every public table has row-level security enabled.
--
-- Read-only; wrapped in a transaction for symmetry with the other suites.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_allowed text[] := array[
    'accept_directory_research_proposal(uuid)',
    'accept_fixture_request_with_team_action(uuid, boolean, uuid)',
    'accept_guardian_invitation(text)',
    'accept_invitation(text)',
    'accept_safeguarding_officer_invitation(text)',
    'accept_site_admin_invitation(text)',
    'active_email_logo_path()',
    'add_child_for_guardian(text, text, date, uuid, text, text)',
    'add_fixture_conversation_participant(uuid, uuid, uuid)',
    'add_support_followup(uuid, text)',
    'add_support_internal_note(uuid, text)',
    'admin_get_message_thread_content(uuid, uuid)',
    'admin_message_analytics(date, date, uuid, uuid, text)',
    'apply_season_handover(uuid, integer)',
    'approve_club_claim(uuid, text)',
    'approve_club_join_request(uuid, text)',
    'approve_directory_request(uuid, text, text)',
    'approve_guardian_link_request(uuid)',
    'approve_player_club_join_request(uuid, uuid)',
    'archive_fixture(uuid, text)',
    'archive_player_team_membership(uuid)',
    'archive_season(uuid, boolean)',
    'block_user_from_club_messages(uuid, uuid, text)',
    'cancel_fixture(uuid, text)',
    'cancel_guardian_link_request(uuid)',
    'check_incoming_request_target(uuid)',
    'check_tournament_participant_target(uuid)',
    'claim_club_referral(uuid)',
    'claim_external_fixture_result(uuid, uuid, integer, integer, text)',
    'claim_tournament_host(uuid, uuid)',
    'clear_email_brand_logo(integer)',
    'clear_rollover_player_placement(uuid)',
    'clear_team_alias(uuid)',
    'club_credit_balance_pence(uuid)',
    'club_entitlements(uuid)',
    'club_has_entitlement(uuid, text)',
    'club_platform_billing_state(uuid)',
    'club_platform_next_collection(uuid)',
    'club_referral_summary(uuid)',
    'club_trial_state(uuid)',
    'confirm_mixed_boundary_rollover(uuid, boolean, text, text)',
    'confirm_rollover_team_proposal(uuid, text, text, text, text, text)',
    'correct_club_rugby_code(uuid, text, text)',
    'create_canonical_team_type(text, text, text, text, boolean, text)',
    'create_competition_edition(uuid, uuid)',
    'create_missing_target_team(uuid)',
    'create_missing_tournament_team(uuid)',
    'create_next_season_scheduling_group(uuid, uuid, uuid[], text)',
    'create_own_player_profile(text, text, date, text)',
    'create_partner_invitation(uuid, uuid, text, text)',
    'create_player_for_guardian(uuid, text, text, date, text)',
    'create_scheduling_group(uuid, uuid[], uuid)',
    'create_support_ticket(text, text, text, uuid, uuid, uuid, text)',
    'create_tournament(uuid, date, time without time zone, uuid, uuid, text, text, uuid)',
    'create_training_session(uuid, uuid, uuid, date, time without time zone, time without time zone, uuid, text, uuid)',
    'create_venue(uuid, text, text, text, text, boolean)',
    'current_platform_mode()',
    'deactivate_canonical_team_type(uuid)',
    'deactivate_club(uuid, text)',
    'deactivate_competition(uuid)',
    'deactivate_competition_edition(uuid)',
    'decide_player_call_up(uuid, text, text)',
    'decide_player_dispensation(uuid, text, boolean, text, text)',
    'decline_player_club_join_request(uuid, text)',
    'delete_canonical_club(uuid, text)',
    'delete_club_document(uuid)',
    'delete_fixture(uuid)',
    'delete_fixture_message_attachment(uuid)',
    'delete_permission_group(uuid)',
    'delete_scheduling_group(uuid)',
    'delete_season_safe(uuid)',
    'enter_diagnostic_club(uuid)',
    'exit_diagnostic_club(uuid)',
    'extend_club_trial(uuid, integer, text)',
    'fail_directory_verification_run(uuid, text)',
    'fixture_communication_counts(uuid)',
    'fold_team(uuid, text)',
    'generate_rollover_player_proposals(uuid)',
    'generate_rollover_proposal(uuid, text, uuid)',
    'get_canonical_team_type_impact(uuid)',
    'get_club_member_directory(uuid)',
    'get_conversation_participant_names(uuid[], uuid[])',
    'get_directory_verification_freshness(uuid)',
    'get_directory_verification_next_batch(uuid, integer)',
    'get_first_collection_date(uuid, date)',
    'get_guardian_invitation_preview(text)',
    'get_invitation_preview(text)',
    'get_match_centre_capabilities(uuid)',
    'get_my_attendance_authority(uuid)',
    'get_partner_team_availability(uuid, date, date)',
    'get_player_account_invitation_preview(text)',
    'get_safeguarding_officer_invitation_preview(text)',
    'get_scheduling_group_availability(uuid, date, date)',
    'get_site_admin_invitation_preview(text)',
    'graduate_team(uuid)',
    'guardian_link_requests_for_approval(uuid)',
    'handover_apply_blockers(uuid)',
    'handover_audit(uuid)',
    'handover_consequences(uuid)',
    'handover_state(uuid)',
    'handover_team_labels(uuid)',
    'has_capability(text, text, uuid, uuid)',
    'invite_tournament_participant(uuid, uuid, uuid)',
    'leave_fixture_conversation(uuid, uuid)',
    'lift_club_message_block(uuid, uuid)',
    'link_guardian_to_existing_player(uuid, uuid)',
    'list_directory_verification_runs(integer)',
    'list_fixtures_since_deactivation(uuid)',
    'list_restorable_fixtures(uuid)',
    'mark_graduating_player_left(uuid)',
    'mark_message_report_reviewed(uuid)',
    'moderator_delete_message(uuid)',
    'my_guardian_link_requests()',
    'my_player_context()',
    'pause_club_trial(uuid, text)',
    'place_graduating_player(uuid, uuid)',
    'plan_missing_placement_team(uuid)',
    'platform_commercial_overview()',
    'platform_public_state()',
    'player_team_allocation(uuid, uuid)',
    'preview_directory_verification_scope(text, uuid, jsonb)',
    'preview_my_fixture_contact_card(uuid, uuid)',
    'preview_player_allocation(uuid, date, text, text)',
    'preview_player_movement_eligibility(uuid, uuid, uuid)',
    'propose_tournament_at_host(uuid, uuid, date, time without time zone, text)',
    'reactivate_club(uuid)',
    'reactivate_missing_target_team(uuid)',
    'reactivate_missing_tournament_team(uuid)',
    'reactivate_team(uuid)',
    'reconcile_tournament_participant(uuid)',
    'record_directory_verification_result(uuid, uuid, text, text, directory_verification_proposal_input[])',
    'record_platform_release(text, text, text, text, text, boolean)',
    'regulatory_coverage_report()',
    'reject_club_claim(uuid, text)',
    'reject_club_join_request(uuid, text)',
    'reject_directory_request(uuid, text)',
    'reject_directory_research_proposal(uuid, text)',
    'reject_fixture_kickoff_change(uuid)',
    'reject_guardian_link_request(uuid, text)',
    'rejoin_fixture_conversation(uuid, uuid)',
    'remove_fixture_conversation_participant(uuid, uuid, uuid)',
    'remove_guardian_relationship(uuid, text)',
    'remove_tournament_participant(uuid)',
    'rename_club_pitch(uuid, text)',
    'reorder_club_pitches(uuid, uuid[])',
    'request_additional_guardian(uuid, text)',
    'request_child_link(text, text, date, uuid, text, text)',
    'request_fixture_restoration(uuid)',
    'request_player_call_up(uuid, uuid, uuid, uuid, text)',
    'request_player_dispensation(uuid, uuid, uuid, uuid, text)',
    'request_player_playing_pathway(uuid)',
    'request_to_join_club(uuid, uuid)',
    'resolve_blocking_club_for_fixture(uuid)',
    'resolve_canonical_team_type_id(text, text, text)',
    'resolve_diagnostic_session(uuid)',
    'resolve_fixture_result_dispute(uuid, integer, integer, text)',
    'resolve_message_report(uuid)',
    'resolve_public_source_metadata(text[])',
    'resolve_rollover_group_flag(uuid)',
    'respond_to_attendance(uuid, uuid, text)',
    'respond_to_club_conversation(uuid, boolean)',
    'respond_to_club_partnership(uuid, boolean)',
    'respond_tournament_invitation(uuid, boolean)',
    'respond_tournament_invitation_with_team_action(uuid, boolean, boolean)',
    'restore_club_membership_authority(uuid)',
    'restore_fixture(uuid)',
    'restore_player_team_membership(uuid)',
    'resume_club_trial(uuid)',
    'revoke_club_partnership(uuid)',
    'revoke_player_dispensation(uuid, text)',
    'revoke_site_admin_invitation(uuid)',
    'rollover_placement_options(uuid)',
    'rollover_readiness(uuid)',
    'run_fixture_attendance_invitation_check()',
    'run_fixture_completion_check()',
    'run_season_transition_check()',
    'run_trial_expiry_check()',
    'search_scheduling_groups(uuid)',
    'select_club_plan(uuid, text)',
    'send_fixture_communication(uuid, text, text)',
    'send_fixture_support_message(uuid, text)',
    'send_support_reply(uuid, text)',
    'set_club_pitch_active(uuid, boolean)',
    'set_default_venue(uuid)',
    'set_email_brand_logo(text, integer)',
    'set_fixture_conversation_mute(uuid, uuid, boolean)',
    'set_guardian_player_permission(uuid, text, boolean)',
    'set_platform_mode(text, text, uuid)',
    'set_platform_plan_terms(text, integer, text, boolean)',
    'set_player_avatar(uuid, text)',
    'set_player_playing_pathway(uuid, text)',
    'set_rollover_player_placement(uuid, uuid)',
    'set_rollover_player_planned_placement(uuid, uuid)',
    'set_scheduling_group_active(uuid, boolean)',
    'set_scheduling_group_alias(uuid, text)',
    'set_scheduling_group_members(uuid, uuid[])',
    'set_site_admin_commercial_capability(uuid, boolean)',
    'set_site_admin_competitions_capability(uuid, boolean)',
    'set_site_admin_diagnostic_capability(uuid, boolean)',
    'set_site_admin_fixture_support_capability(uuid, boolean)',
    'set_site_admin_global_lookups_capability(uuid, boolean)',
    'set_site_admin_permissions_capability(uuid, boolean)',
    'set_site_admin_seasons_capability(uuid, boolean)',
    'set_site_admin_system_capability(uuid, boolean)',
    'set_site_admin_team_catalogue_capability(uuid, boolean)',
    'set_team_alias(uuid, text)',
    'set_venue_active(uuid, boolean)',
    'share_fixture_contact_card(uuid, uuid)',
    'share_fixture_document(uuid, uuid, uuid, text)',
    'soft_delete_own_message(uuid)',
    'start_club_trial(uuid)',
    'start_directory_verification_run(text, uuid, jsonb)',
    'start_or_get_club_conversation(uuid, uuid, text)',
    'submit_fixture_result(uuid, integer, integer)',
    'submit_public_support_ticket(text, text, text, text, text, text)',
    'swap_fixture_home_away(uuid)',
    'team_delete_fixture_message(uuid)',
    'team_people(uuid)',
    'touch_last_active()',
    'training_communication_counts(uuid)',
    'undo_rollover_team_decision(uuid)',
    'unplan_handover_team(uuid)',
    'update_club_message_policy(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean)',
    'update_competition(uuid, text, text, boolean, uuid[])',
    'update_fixture_competition(uuid, uuid)',
    'update_fixture_kickoff(uuid, date, time without time zone)',
    'update_fixture_meet_time(uuid, time without time zone)',
    'update_fixture_opposition(uuid, uuid, uuid, text)',
    'update_fixture_owning_team(uuid, uuid)',
    'update_fixture_pitch(uuid, uuid, text)',
    'update_fixture_schedule(uuid, date, time without time zone, uuid, uuid, text, text)',
    'update_fixture_venue(uuid, uuid)',
    'update_global_message_policy(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, integer, text[])',
    'update_support_ticket_category(uuid, text)',
    'update_support_ticket_status(uuid, text, text, text)',
    'update_tournament_venue(uuid, uuid)',
    'update_venue(uuid, text, text, text, text)',
    'withdraw_player_club_join_request(uuid)'
  ];
  v_found text;
  v_bad text[];
begin
  -- P1 ---------------------------------------------------------------
  select array_agg(sig order by sig) into v_bad
  from (
    select p.proname || '(' || oidvectortypes(p.proargtypes) || ')' as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) s
  where sig <> all (v_allowed);
  if v_bad is null then
    raise notice 'PASS P1: no SECURITY DEFINER function outside the reviewed inventory is executable by anonymous callers';
  else
    raise notice 'FAIL P1: new anonymous-executable SECURITY DEFINER function(s): %', array_to_string(v_bad, ', ');
  end if;

  -- P2 ---------------------------------------------------------------
  v_bad := '{}';
  if has_function_privilege('anon', 'public.set_account_status(uuid, text)', 'EXECUTE') then v_bad := v_bad || 'anon: set_account_status'::text; end if;
  if has_function_privilege('anon', 'public.record_session_version(integer)', 'EXECUTE') then v_bad := v_bad || 'anon: record_session_version'::text; end if;
  if has_function_privilege('anon', 'public.list_suspended_club_memberships(uuid)', 'EXECUTE') then v_bad := v_bad || 'anon: list_suspended_club_memberships'::text; end if;
  if has_function_privilege('anon', 'public.accept_fixture_request(uuid, uuid)', 'EXECUTE') then v_bad := v_bad || 'anon: accept_fixture_request'::text; end if;
  if has_function_privilege('anon', 'public.create_competition(text, text, text, boolean, uuid[])', 'EXECUTE') then v_bad := v_bad || 'anon: create_competition'::text; end if;
  if has_function_privilege('anon', 'public.publish_import_row(uuid)', 'EXECUTE') then v_bad := v_bad || 'anon: publish_import_row'::text; end if;
  if has_function_privilege('anon', 'public.reconcile_overdue_fixture_results()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.reconcile_overdue_fixture_results()', 'EXECUTE') then
    v_bad := v_bad || 'browser role: reconcile_overdue_fixture_results'::text;
  end if;
  for v_found in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('get_gocardless_token_for_payer_subscription', 'get_gocardless_token_for_club_admin_action')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    v_bad := v_bad || ('browser role: ' || v_found);
  end loop;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS P2: account status, session version, suspended members, legacy fixture functions, reconciliation and merchant tokens stay out of reach';
  else
    raise notice 'FAIL P2: reopened: %', array_to_string(v_bad, ', ');
  end if;

  -- P3 ---------------------------------------------------------------
  select array_agg(tablename || '.' || policyname) into v_bad
  from pg_policies
  where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and (coalesce(with_check, '') ~* '\mtrue\M' or coalesce(qual, '') ~* '\mtrue\M');
  if v_bad is null then
    raise notice 'PASS P3: no write policy accepts a row unconditionally';
  else
    raise notice 'FAIL P3: write policies with a literal true: %', array_to_string(v_bad, ', ');
  end if;

  -- P4 ---------------------------------------------------------------
  select array_agg(c.relname order by c.relname) into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
    and has_table_privilege('anon', c.oid, 'SELECT')
    and not coalesce((select option_value in ('true', 'on', '1', 'yes')
                      from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), false)
    and c.relname not in ('public_club_fixtures', 'notification_topic_settings');
  if v_bad is null then
    raise notice 'PASS P4: owner-rights views readable by anonymous callers are only the deliberately public ones';
  else
    raise notice 'FAIL P4: owner-rights view(s) readable by anon: %', array_to_string(v_bad, ', ');
  end if;

  -- P5 ---------------------------------------------------------------
  v_bad := '{}';
  select v_bad || coalesce(array_agg(t || ':' || r || ':' || priv), '{}') into v_bad
  from unnest(array['players', 'guardians', 'player_team_memberships']) t,
       unnest(array['anon', 'authenticated']) r,
       unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) priv
  where has_table_privilege(r, ('public.' || t)::regclass, priv);
  select v_bad || coalesce(array_agg(t || ':anon:' || priv), '{}') into v_bad
  from unnest(array['players', 'guardians', 'player_team_memberships', 'profiles', 'club_memberships']) t,
       unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) priv
  where has_table_privilege('anon', ('public.' || t)::regclass, priv);
  select v_bad || coalesce(array_agg('profiles.' || col), '{}') into v_bad
  from unnest(array['account_status', 'email', 'date_of_birth', 'id', 'last_active_at']) col
  where has_column_privilege('authenticated', 'public.profiles', col, 'UPDATE');
  select v_bad || coalesce(array_agg('club_memberships.' || col), '{}') into v_bad
  from unnest(array['user_id', 'club_id', 'authority_suspended', 'authority_suspended_at', 'authority_restored_at', 'authority_restored_by', 'created_by']) col
  where has_column_privilege('authenticated', 'public.club_memberships', col, 'UPDATE');
  if has_table_privilege('authenticated', 'public.profiles', 'DELETE') then v_bad := v_bad || 'profiles:authenticated:DELETE'::text; end if;
  if cardinality(v_bad) = 0 then
    raise notice 'PASS P5: children''s records, account status and membership identity are not writable by browser roles';
  else
    raise notice 'FAIL P5: browser-role write access reopened: %', array_to_string(v_bad, ', ');
  end if;

  -- P6 ---------------------------------------------------------------
  select array_agg(c.relname order by c.relname) into v_bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v_bad is null then
    raise notice 'PASS P6: every public table has row-level security enabled';
  else
    raise notice 'FAIL P6: public table(s) without row-level security: %', array_to_string(v_bad, ', ');
  end if;
end $$;

rollback;
