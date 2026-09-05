-- Side Project 1 integration -- table-level grant hardening for the
-- GoCardless/finance domain, caught by running the Side Project's own
-- permanent gocardless_critical_vulnerability_regression.sql regression
-- suite against this (Main) database. Every write path in this domain
-- is already correctly gated by RLS (each of these tables has, at most,
-- a single SELECT-scoped policy -- no INSERT/UPDATE/DELETE policy
-- exists for any of them, so a direct write from `authenticated`/`anon`
-- already silently affects zero rows). But the Side Project's own
-- migration (20260924900000_gocardless_subscriptions_foundation.sql)
-- goes one step further as defense-in-depth: it explicitly revokes the
-- Supabase-default table-level INSERT/UPDATE/DELETE grants themselves
-- from `authenticated`, and ALL privileges from `anon`, so a direct
-- write attempt errors loudly ("permission denied for table ...") at
-- the grant layer rather than silently no-op'ing at the RLS layer. Main
-- never carried that same table-grant narrowing when this domain was
-- ported (20260928300000) -- only the RLS policies and function grants
-- were reconciled, not the underlying table grants, which is why the
-- regression suite's 1d/3d checks (direct UPDATE on gocardless_payments
-- from Parent/anon) came back as a live no-op instead of a permission
-- error, unlike the Side Project's own database.
--
-- Every write to every one of these tables already goes, and continues
-- to go, exclusively through the domain's own SECURITY DEFINER RPCs
-- (each independently re-verified this session) -- this migration
-- changes no application behavior, it only removes a redundant,
-- unused, and unintended direct-write surface.
revoke all on public.gocardless_merchant_connections from authenticated, anon;
revoke all on public.gocardless_customers from anon;
revoke all on public.gocardless_billing_requests from anon;
revoke all on public.gocardless_mandates from anon;
revoke all on public.gocardless_subscriptions from anon;
revoke all on public.gocardless_payments from anon;
revoke all on public.gocardless_events from authenticated, anon;
revoke all on public.gocardless_payouts from anon;
revoke all on public.gocardless_reconciliation_entries from anon;
revoke all on public.payment_refunds from anon;
revoke all on public.finance_audit_log from anon;
revoke insert, update, delete on public.finance_audit_log from authenticated;
revoke insert, update, delete on public.gocardless_customers, public.gocardless_billing_requests, public.gocardless_mandates, public.gocardless_subscriptions, public.gocardless_payments, public.gocardless_payouts, public.gocardless_reconciliation_entries from authenticated;

-- Verification: fail loudly if this regresses on a future `db reset`.
do $$
declare
  v_leaked text;
begin
  select table_name into v_leaked
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in ('gocardless_customers', 'gocardless_billing_requests', 'gocardless_mandates', 'gocardless_subscriptions', 'gocardless_payments', 'gocardless_payouts', 'gocardless_reconciliation_entries')
    and grantee = 'authenticated'
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  limit 1;

  if v_leaked is not null then
    raise exception 'Security regression: % still grants authenticated a direct INSERT/UPDATE/DELETE privilege after the lockdown fix.', v_leaked;
  end if;
end $$;
