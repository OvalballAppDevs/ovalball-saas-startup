-- =====================================================================================================
-- SLICE 7 (3/n) -- is_site_admin() leaves the function bodies too (Phase 2 Z.4 PG-16, slice row 7d)
--
-- PG-15 took the Site Admin label out of the policies. PG-16 is the other half: sixty SECURITY DEFINER
-- bodies still ask `internal.is_site_admin()`, which is a question about a LABEL. Each one becomes a
-- question about a named capability at SITE scope, so the answer respects the profile.
--
-- The same narrowing applies, and it matters more here than in the policies, because these are the
-- functions that DO things: cancel a fixture, deactivate a club, approve a directory request. Today a
-- Read Only Site Admin passes every one of those checks.
--
-- WHAT THIS DOES NOT DO. It does not retire the legacy helpers themselves. `internal.can_manage_team`,
-- `internal.is_club_admin` and `internal.has_capability` remain, because Phase 2's Slice 10 row owns
-- "legacy helpers" and they still have legitimate consumers. What changes is that none of them asks
-- whether somebody is a Site Admin any more. A helper that survives with a canonical implementation
-- underneath is a compatibility adapter; one that keeps a label-based bypass is a hole.
-- =====================================================================================================

do $$
declare
  r record;
  v_map jsonb;
  v_key text;
  v_src text;
  v_def text;
  v_n int := 0;
  v_bad text;
begin
  -- function -> the site capability that replaces the label. Every one named; no default.
  -- function -> the site capability that replaces the label. Every one named; no default.
  -- Built from a VALUES list rather than jsonb_build_object, which caps at 100 arguments and would
  -- silently have room for only fifty of these pairs.
  select jsonb_object_agg(m.fn, m.cap) into v_map
    from (values
      -- Fixtures: support actions, deletions and the reads around them. Deleting is its own key because
      -- Phase 2 R gives OPS site.fixtures.delete separately from site.fixtures.support.
      ('public.cancel_fixture','site.fixtures.support'),
      ('public.delete_fixture','site.fixtures.delete'),
      ('public.update_fixture_details','site.fixtures.support'),
      ('public.update_fixture_kickoff','site.fixtures.support'),
      ('public.update_fixture_meet_time','site.fixtures.support'),
      ('public.update_fixture_pitch','site.fixtures.support'),
      ('public.update_fixture_schedule','site.fixtures.support'),
      ('public.update_fixture_venue','site.fixtures.support'),
      ('public.swap_fixture_home_away','site.fixtures.support'),
      ('public.reject_fixture_kickoff_change','site.fixtures.support'),
      ('public.list_restorable_fixtures','site.fixtures.view'),
      ('public.publish_import_row','site.fixtures.support'),
      ('public.reconcile_overdue_fixture_results','site.fixtures.support'),
      ('public.resolve_blocking_club_for_fixture','site.fixtures.view'),
      ('public.run_fixture_attendance_invitation_check','site.fixtures.support'),
      ('public.run_fixture_completion_check','site.fixtures.support'),
      ('public.run_season_transition_check','site.seasons.manage'),
      ('public.fixture_communication_counts','site.fixtures.view'),
      ('public.fixture_notification_recipients','site.fixtures.view'),
      ('public.add_fixture_conversation_participant','site.fixtures.support'),
      ('public.remove_fixture_conversation_participant','site.fixtures.support'),
      ('public.team_delete_fixture_message','site.messages.moderate'),
      ('internal.can_manage_club_fixtures','site.fixtures.support'),
      ('internal.can_manage_team','site.team_roles.manage'),
      ('internal.can_review_club_access','site.permissions.manage'),

      -- Directory curation and the clubs register.
      ('public.accept_directory_research_proposal','site.directory.manage'),
      ('public.reject_directory_research_proposal','site.directory.manage'),
      ('public.approve_directory_request','site.directory.manage'),
      ('public.reject_directory_request','site.directory.manage'),
      ('public.get_directory_verification_freshness','site.directory.manage'),
      ('public.list_directory_verification_runs','site.directory.manage'),
      ('public.preview_directory_verification_scope','site.directory.manage'),
      ('public.delete_canonical_club','site.clubs.lifecycle'),
      ('public.deactivate_club','site.clubs.lifecycle'),
      ('public.reactivate_club','site.clubs.lifecycle'),
      ('public.club_setup_requirements','site.clubs.view'),
      ('public.list_suspended_club_memberships','site.memberships.manage'),

      -- Commercial: referrals, trials, audience and the platform dashboards that read them.
      ('public.claim_club_referral','site.commercial.manage'),
      ('public.club_referral_summary','site.commercial.view'),
      ('public.reconcile_referral_attribution','site.commercial.manage'),
      ('public.referral_data_health','site.commercial.view'),
      ('public.referral_data_health_detail','site.commercial.view'),
      ('public.referral_reward_integrity_detail','site.commercial.view'),
      ('public.platform_eligible_audience_summary','site.commercial.view'),
      ('public.run_trial_expiry_check','site.commercial.manage'),
      ('public.site_admin_dashboard_commercial','site.commercial.view'),

      -- Email and messaging.
      ('public.email_delivery_health','site.email.deliveries.view'),
      ('public.email_recent_deliveries','site.email.deliveries.view'),
      ('public.email_usage_summary','site.email.deliveries.view'),
      ('public.admin_message_analytics','site.messages.moderate'),

      -- Support and the remaining read surfaces.
      ('public.enter_diagnostic_club','site.support.view_club'),
      ('public.site_admin_dashboard_platform','site.clubs.view'),
      ('public.site_admin_dashboard_operations','site.clubs.view'),
      ('public.site_admin_dashboard_fixtures_today','site.fixtures.view'),
      ('public.site_admin_dashboard_trends','site.clubs.view'),
      ('public.get_club_event_card','site.clubs.view'),
      ('public.get_club_event_register','site.clubs.view'),
      ('public.get_training_register','site.clubs.view'),
      ('public.get_match_centre_capabilities','site.fixtures.view'),
      ('public.get_conversation_participant_names','site.messages.moderate')
    ) as m(fn, cap);

  -- Nothing may be missed, and nothing may point at a retired key.
  select string_agg(n.nspname||'.'||p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','internal') and p.prosecdef and p.proname <> 'is_site_admin'
     and p.prosrc ~ '\mis_site_admin\(' and not (v_map ? (n.nspname||'.'||p.proname));
  if v_bad is not null then
    raise exception 'Slice 7: no capability mapped for %. Name it rather than defaulting it.', v_bad;
  end if;

  select string_agg(distinct k, ', ') into v_bad
    from (select jsonb_each_text(v_map)) x(e), lateral (select (x.e).value as k) d
   where not exists (select 1 from public.capabilities c where c.key = d.k and c.status = 'ACTIVE');
  if v_bad is not null then
    raise exception 'Slice 7: mapped to a capability that is deprecated or absent: %', v_bad;
  end if;

  for r in
    select n.nspname as sch, p.proname as fn, p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public','internal') and p.prosecdef and p.proname <> 'is_site_admin'
       and p.prosrc ~ '\mis_site_admin\('
     order by 1, 2
  loop
    v_key := v_map ->> (r.sch||'.'||r.fn);
    v_def := pg_get_functiondef(r.oid);
    -- Surgical: only the label check is swapped. Everything else in the body survives.
    v_def := regexp_replace(v_def, '\m(internal\.)?is_site_admin\(\)',
                            format('internal.has_site_capability(%L)', v_key), 'g');
    execute v_def;
    v_n := v_n + 1;
  end loop;

  raise notice 'Slice 7: % function bodies moved from a Site Admin label to a named capability', v_n;
end $$;

do $$
declare v int;
begin
  select count(*) into v from pg_proc f join pg_namespace n on n.oid = f.pronamespace
   where n.nspname in ('public','internal') and f.prosecdef and f.proname <> 'is_site_admin'
     and f.prosrc ~ '\mis_site_admin\(';
  if v <> 0 then
    raise exception 'Slice 7: % SECURITY DEFINER bodies still call is_site_admin() (PG-16 must be 0).', v;
  end if;
  raise notice 'Slice 7: PG-16 = 0. No SECURITY DEFINER body asks whether somebody is a Site Admin.';
end $$;
