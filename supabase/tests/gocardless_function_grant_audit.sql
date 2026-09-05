-- Permanent regression test: no GoCardless/subscription public function
-- may be executable by the `anon` role. Written after finding TWO real
-- instances of the same bug in one sitting (preview_first_payment(),
-- then current_subscription_price()) -- Supabase auto-grants EXECUTE to
-- `anon` on every new function in the public schema via schema-level
-- default privileges, independent of a migration's own
-- `revoke all ... from public`. Every migration in this domain has only
-- ever intended `authenticated` (or, for the trusted system/webhook
-- path, `service_role` alone) -- anon was never the contract for any of
-- them. This test reads live grants from the catalog, not migration
-- source, so it catches the exact class of drift that caused the bug in
-- the first place. NOT a migration -- never applied automatically by
-- `db reset`. Run by hand against local Supabase:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_function_grant_audit.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== GoCardless function anon-grant audit ==='

do $$
declare
  v_fn text;
  v_anon boolean;
  v_failures integer := 0;
  -- Every GoCardless/subscription function that authenticated users (or
  -- more narrowly capability-gated actors) may call -- none of these
  -- should ever be reachable by anon.
  v_authenticated_only text[] := array[
    'current_subscription_price',
    'configure_subscription_programme',
    'set_subscription_price',
    'disconnect_gocardless',
    'get_active_subscription_impact',
    'get_enrolment_eligibility',
    'get_gocardless_connection_status',
    'get_gocardless_token_for_club_admin_action',
    'get_gocardless_token_for_payer_subscription',
    'record_billing_request',
    'set_obligation_exemption',
    'set_responsible_payer',
    'store_gocardless_connection',
    'claim_responsible_payer',
    'preview_first_payment',
    'create_membership_obligations_for_period',
    'end_membership_subscription',
    'get_membership_operational_detail',
    'export_finance_rows',
    'get_finance_action_required',
    'preview_first_payment_illustrative',
    'configure_sibling_discount_rule',
    'get_sibling_discount_rules'
  ];
  -- The trusted system/webhook path -- neither anon NOR authenticated
  -- should be able to call these; service_role only.
  v_service_role_only text[] := array[
    'record_gocardless_event',
    'mark_gocardless_event_processed',
    'confirm_gocardless_refund',
    'update_gocardless_verification_status',
    'reconcile_gocardless_billing_request',
    'reconcile_gocardless_subscription',
    'record_gocardless_payment',
    'record_gocardless_subscription',
    'apply_payment_status_transition'
  ];
begin
  foreach v_fn in array v_authenticated_only loop
    select bool_or(grantee = 'anon') into v_anon
    from information_schema.role_routine_grants
    where routine_name = v_fn and specific_schema = 'public';

    if coalesce(v_anon, false) then
      raise notice 'FAIL: % is executable by anon -- must be authenticated-only', v_fn;
      v_failures := v_failures + 1;
    else
      raise notice 'PASS: % correctly has no anon grant', v_fn;
    end if;
  end loop;

  foreach v_fn in array v_service_role_only loop
    select bool_or(grantee in ('anon', 'authenticated')) into v_anon
    from information_schema.role_routine_grants
    where routine_name = v_fn and specific_schema = 'public';

    if coalesce(v_anon, false) then
      raise notice 'FAIL: % (service_role-only trusted path) is executable by anon or authenticated', v_fn;
      v_failures := v_failures + 1;
    else
      raise notice 'PASS: % correctly restricted to service_role only', v_fn;
    end if;
  end loop;

  if v_failures = 0 then
    raise notice 'ALL PASS: no GoCardless function grants anon access beyond its intended contract.';
  else
    raise notice '% FAILURE(S): a GoCardless function has drifted back to an unintended anon grant.', v_failures;
  end if;
end $$;

\echo '=== Audit complete. Every line above must read PASS. ==='
