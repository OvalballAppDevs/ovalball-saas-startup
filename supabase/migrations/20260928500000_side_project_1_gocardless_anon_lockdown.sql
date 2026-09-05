-- Side Project 1 integration -- GoCardless/subscription function grant
-- hardening, caught by porting the Side Project's own permanent
-- gocardless_function_grant_audit.sql regression suite against this
-- (Main) database and finding every one of its 32 checked functions
-- reported anon-executable, when none of them should be.
--
-- Root cause: this local Supabase project's pg_default_acl grants
-- EXECUTE on every newly created `public`-schema function DIRECTLY to
-- `anon`, `authenticated`, AND `service_role` (via `ALTER DEFAULT
-- PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO ...`, configured at the
-- platform/project level -- the same behavior the Side Project's own
-- migration history independently discovered and fixed piecemeal across
-- several follow-up migrations, e.g. 20260924960000, 20260925060000,
-- 20260925070000, 20260925090000, 20260925140000). The migrations that
-- ported this domain into Main (20260928300000/20260928400000) only ever
-- wrote `grant execute ... to authenticated`, and NEVER revoked from
-- `public` at all -- Postgres grants EXECUTE to the PUBLIC pseudo-role
-- on every new function by default, and every real role (including
-- anon/authenticated/service_role) implicitly inherits whatever PUBLIC
-- can do. A revoke that names only `anon`/`authenticated` and omits
-- `public` is therefore a no-op: the role still has EXECUTE via its
-- PUBLIC membership regardless. Every revoke below explicitly includes
-- `public`, matching the Side Project's own final cumulative state for
-- these functions (e.g. 20260925320000_preview_first_payment_sibling_aware.sql:
-- `revoke all on function public.preview_first_payment(...) from public, anon;`).
--
-- Fix: explicitly revoke EXECUTE from the roles that were never the
-- intended contract for each function, matching exactly what the Side
-- Project's own cumulative migration history ended up with for the same
-- functions (re-derived here against Main's own current signatures,
-- which differ from the Side Project's fork-point signatures for
-- several functions that evolved further on each side, e.g.
-- preview_first_payment and reconcile_gocardless_subscription both
-- gained extra parameters on Main's side of history).

-- Service-role-only trusted paths (webhook/reconciliation/system) --
-- neither anon NOR authenticated may ever call these directly.
revoke execute on function public.apply_payment_status_transition(p_gc_payment_id text, p_new_status text, p_failure_reason_code text, p_charge_date date, p_gc_event_id text) from public, anon, authenticated;
revoke execute on function public.record_gocardless_event(p_gc_event_id text, p_resource_type text, p_action text, p_payload jsonb, p_club_id uuid) from public, anon, authenticated;
revoke execute on function public.mark_gocardless_event_processed(p_event_id uuid, p_error text) from public, anon, authenticated;
revoke execute on function public.confirm_gocardless_refund(p_payment_gc_id text, p_gc_refund_id text, p_amount_minor integer) from public, anon, authenticated;
revoke execute on function public.update_gocardless_verification_status(p_club_id uuid, p_status text) from public, anon, authenticated;
revoke execute on function public.reconcile_gocardless_billing_request(p_billing_request_local_id uuid, p_gc_billing_request_status text, p_gc_customer_id text, p_gc_mandate_id text, p_mandate_status text, p_mandate_scheme text, p_next_possible_charge_date date) from public, anon, authenticated;
revoke execute on function public.reconcile_gocardless_subscription(p_local_subscription_id uuid, p_gc_status text, p_gc_event_id text, p_source text, p_actor_user_id uuid) from public, anon, authenticated;
revoke execute on function public.record_gocardless_payment(p_obligation_id uuid, p_gc_payment_id text, p_amount_minor integer, p_currency text, p_charge_date date, p_status text, p_gocardless_subscription_id uuid) from public, anon, authenticated;
revoke execute on function public.record_gocardless_subscription(p_payer_subscription_id uuid, p_pricing_id uuid, p_gocardless_mandate_id uuid, p_gc_subscription_id text, p_amount_minor integer, p_status text) from public, anon, authenticated;

-- Authenticated-only (each has its own internal has_capability()/
-- auth.uid()-scoped guard that already correctly rejects anon, but anon
-- was never the intended contract for any of them -- revoked as
-- defense-in-depth, not because a live exploit exists for most of these).
revoke execute on function public.preview_first_payment(p_programme_id uuid, p_player_id uuid, p_membership_start_date date) from public, anon;
revoke execute on function public.current_subscription_price(p_programme_id uuid, p_as_of date) from public, anon;
revoke execute on function public.configure_subscription_programme(p_club_id uuid, p_enabled boolean, p_collection_day integer, p_platform_fee_mode text, p_first_payment_policy text) from public, anon;
revoke execute on function public.set_subscription_price(p_programme_id uuid, p_amount_minor integer, p_effective_from date) from public, anon;
revoke execute on function public.disconnect_gocardless(p_club_id uuid, p_reason text) from public, anon;
revoke execute on function public.get_active_subscription_impact(p_club_id uuid) from public, anon;
revoke execute on function public.get_enrolment_eligibility(p_player_id uuid, p_club_id uuid) from public, anon;
revoke execute on function public.get_gocardless_connection_status(p_club_id uuid) from public, anon;
revoke execute on function public.get_gocardless_token_for_club_admin_action(p_club_id uuid) from public, anon;
revoke execute on function public.get_gocardless_token_for_payer_subscription(p_payer_subscription_id uuid) from public, anon;
revoke execute on function public.record_billing_request(p_payer_subscription_id uuid, p_club_id uuid, p_gc_billing_request_id text, p_gc_billing_request_flow_id text, p_authorisation_url text) from public, anon;
revoke execute on function public.set_obligation_exemption(p_obligation_id uuid, p_status text, p_reason text) from public, anon;
revoke execute on function public.set_responsible_payer(p_player_id uuid, p_programme_id uuid, p_payer_user_id uuid, p_relationship text, p_reason text) from public, anon;
revoke execute on function public.claim_responsible_payer(p_player_id uuid, p_programme_id uuid) from public, anon;
revoke execute on function public.create_membership_obligations_for_period(p_club_id uuid, p_billing_period date) from public, anon;
revoke execute on function public.get_membership_operational_detail(p_payer_subscription_id uuid) from public, anon;
revoke execute on function public.export_finance_rows(p_club_id uuid, p_billing_period date) from public, anon;
revoke execute on function public.get_finance_action_required(p_club_id uuid) from public, anon;
revoke execute on function public.preview_first_payment_illustrative(p_programme_id uuid, p_membership_start_date date) from public, anon;
revoke execute on function public.configure_sibling_discount_rule(p_programme_id uuid, p_ordinal integer, p_discount_type text, p_discount_value integer, p_effective_from date) from public, anon;
revoke execute on function public.get_sibling_discount_rules(p_programme_id uuid) from public, anon;

-- store_gocardless_connection is INTENTIONALLY callable by `authenticated`
-- (called through the connecting user's own session in the OAuth
-- callback route, with its own internal capability check as the real
-- boundary) -- only anon needs revoking.
revoke execute on function public.store_gocardless_connection(p_club_id uuid, p_environment text, p_gc_organisation_id text, p_access_token text, p_scope text) from public, anon;

-- end_membership_subscription is called by cancel-membership.ts via a
-- service-role client, but authenticated retains execute (matching the
-- Side Project's own final state) -- only public/anon are revoked.
revoke execute on function public.end_membership_subscription(p_payer_subscription_id uuid, p_reason text, p_actor_user_id uuid) from public, anon;

-- Verification: fail loudly if this regresses on a future `db reset`.
do $$
declare
  v_leaked text;
begin
  select proname into v_leaked
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in (
      'apply_payment_status_transition', 'record_gocardless_event', 'mark_gocardless_event_processed',
      'confirm_gocardless_refund', 'update_gocardless_verification_status', 'reconcile_gocardless_billing_request',
      'reconcile_gocardless_subscription', 'record_gocardless_payment', 'record_gocardless_subscription'
    )
    and (has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE'))
  limit 1;

  if v_leaked is not null then
    raise exception 'Security regression: % (service-role-only) is still executable by anon or authenticated after the lockdown fix.', v_leaked;
  end if;
end $$;
