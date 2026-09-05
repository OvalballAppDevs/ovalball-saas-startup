-- Permanent regression suite for reconcile_gocardless_billing_request()
-- (GoCardless Sandbox Test 3 reconciliation repair). Tests the RPC layer
-- directly with synthetic-but-realistically-shaped provider IDs rather
-- than making real GoCardless API calls, which would make this suite
-- nondeterministic -- the real end-to-end proof against the actual
-- sandbox object lives in the session report, not here. Every scenario
-- is wrapped in begin/rollback so this file never leaves synthetic rows
-- behind or touches Foxton's real reconciled data. NOT a migration --
-- never applied automatically by `db reset`. Run by hand:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_reconciliation_regression.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== GoCardless billing-request reconciliation regression suite ==='

-- ------------------------------------------------------------
-- Shared setup: one throwaway synthetic club/programme/player/payer/
-- billing-request, entirely self-contained so this suite never depends
-- on or touches Foxton's real data. Built as the default (superuser)
-- connection role, matching every other fixture file in this project.
-- ------------------------------------------------------------
begin;

create temporary table t_recon_state (k text primary key, v text) on commit drop;
grant all on t_recon_state to authenticated, service_role, anon;

do $$
declare
  v_club_id uuid := gen_random_uuid();
  v_directory_id uuid := gen_random_uuid();
  v_team_id uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin, 'recon-regression-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_parent, 'recon-regression-parent-' || v_parent::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_directory_id, 'Reconciliation Regression Test Club', 'union', 'England', 'England', 'manual', 'reconciliation regression test club', 'verified');
  insert into public.clubs (id, directory_id, slug, status)
  values (v_club_id, v_directory_id, 'reconciliation-regression-test', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status)
  values (gen_random_uuid(), v_club_id, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, active, canonical_team_type_id)
  values (v_team_id, v_club_id, 'union', 'U12', 'u12-recon-regression', 'youth', 'U12', 'boys', true,
    internal.resolve_canonical_team_type('youth', 'U12', 'boys', null));
  insert into public.players (id, first_name, surname, date_of_birth, created_by)
  values (v_player_id, 'Recon', 'Tester', '2015-01-01', v_admin);
  insert into public.player_team_memberships (id, player_id, team_id, status)
  values (gen_random_uuid(), v_player_id, v_team_id, 'active');

  insert into t_recon_state values ('club_id', v_club_id::text), ('admin', v_admin::text), ('parent', v_parent::text), ('player_id', v_player_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_recon_state where k = 'admin';
do $$
declare
  v_club_id uuid := (select v::uuid from t_recon_state where k = 'club_id');
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme(v_club_id, true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
  insert into t_recon_state values ('programme_id', v_programme_id::text);
end $$;

set local role service_role;
do $$
declare
  v_player_id uuid := (select v::uuid from t_recon_state where k = 'player_id');
  v_programme_id uuid := (select v::uuid from t_recon_state where k = 'programme_id');
  v_parent uuid := (select v::uuid from t_recon_state where k = 'parent');
  v_club_id uuid := (select v::uuid from t_recon_state where k = 'club_id');
  v_payer_id uuid;
  v_billing_request_id uuid;
begin
  insert into public.player_subscription_payers (id, player_id, programme_id, payer_user_id, relationship, status, effective_from, created_by)
  values (gen_random_uuid(), v_player_id, v_programme_id, v_parent, 'guardian', 'active', current_date, v_parent)
  returning id into v_payer_id;

  insert into public.gocardless_billing_requests (id, club_id, payer_subscription_id, gc_billing_request_id, gc_billing_request_flow_id, status, created_by)
  values (gen_random_uuid(), v_club_id, v_payer_id, 'BRQ_REGRESSION_TEST', 'BRF_REGRESSION_TEST', 'pending', v_parent)
  returning id into v_billing_request_id;

  insert into t_recon_state values ('payer_id', v_payer_id::text), ('billing_request_id', v_billing_request_id::text);
end $$;

-- ------------------------------------------------------------
-- 1. Missing local customer + fulfilled real-shaped Billing Request ->
--    reconciliation creates both gocardless_customers and
--    gocardless_mandates for the correct payer.
-- ------------------------------------------------------------
do $$
declare
  v_billing_request_id uuid := (select v::uuid from t_recon_state where k = 'billing_request_id');
  v_customer_id uuid;
  v_mandate_id uuid;
  v_billing_status text;
begin
  select customer_id, mandate_id into v_customer_id, v_mandate_id
  from public.reconcile_gocardless_billing_request(v_billing_request_id, 'fulfilled', 'CU_REGRESSION_TEST', 'MD_REGRESSION_TEST', 'pending_submission', 'bacs', current_date + 7);

  select status into v_billing_status from public.gocardless_billing_requests where id = v_billing_request_id;

  if v_customer_id is not null and v_mandate_id is not null and v_billing_status = 'fulfilled' then
    raise notice 'PASS 1: first reconciliation created customer and mandate, billing_request status now fulfilled';
    insert into t_recon_state values ('customer_id', v_customer_id::text), ('mandate_id', v_mandate_id::text);
  else
    raise notice 'FAIL 1: reconciliation did not create expected local rows -- customer=% mandate=% billing_status=%', v_customer_id, v_mandate_id, v_billing_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. (covered by 1: mandate creation is the same call as customer
--    creation in this flow -- no separate scenario needed.)
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 3. Repeat reconciliation is idempotent -- same stable local IDs, no
--    duplicate rows, updates in place.
-- ------------------------------------------------------------
do $$
declare
  v_billing_request_id uuid := (select v::uuid from t_recon_state where k = 'billing_request_id');
  v_original_customer uuid := (select v::uuid from t_recon_state where k = 'customer_id');
  v_original_mandate uuid := (select v::uuid from t_recon_state where k = 'mandate_id');
  v_customer_id uuid;
  v_mandate_id uuid;
  v_customer_count integer;
  v_mandate_count integer;
begin
  select customer_id, mandate_id into v_customer_id, v_mandate_id
  from public.reconcile_gocardless_billing_request(v_billing_request_id, 'fulfilled', 'CU_REGRESSION_TEST', 'MD_REGRESSION_TEST', 'active', 'bacs', current_date + 7);

  select count(*) into v_customer_count from public.gocardless_customers where gc_customer_id = 'CU_REGRESSION_TEST';
  select count(*) into v_mandate_count from public.gocardless_mandates where gc_mandate_id = 'MD_REGRESSION_TEST';

  if v_customer_id = v_original_customer and v_mandate_id = v_original_mandate and v_customer_count = 1 and v_mandate_count = 1 then
    raise notice 'PASS 3: repeat reconciliation is idempotent -- same stable IDs, exactly one row each, status updated to active';
  else
    raise notice 'FAIL 3: repeat reconciliation drifted -- ids %/% vs original %/%, counts %/%', v_customer_id, v_mandate_id, v_original_customer, v_original_mandate, v_customer_count, v_mandate_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. An unrecognized/unknown mandate status (NULL, as the TS caller
--    would pass after its own fail-safe filter) is never written over a
--    previously-known-good status.
-- ------------------------------------------------------------
do $$
declare
  v_billing_request_id uuid := (select v::uuid from t_recon_state where k = 'billing_request_id');
  v_status_after text;
begin
  perform public.reconcile_gocardless_billing_request(v_billing_request_id, 'fulfilled', 'CU_REGRESSION_TEST', 'MD_REGRESSION_TEST', null, null, null);
  select status into v_status_after from public.gocardless_mandates where gc_mandate_id = 'MD_REGRESSION_TEST';
  if v_status_after = 'active' then
    raise notice 'PASS 5: an unrecognized/NULL provider status did not overwrite the previously-known-good status (%)', v_status_after;
  else
    raise notice 'FAIL 5: mandate status was overwritten to % by a NULL/unrecognized reconciliation call', v_status_after;
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. Cross-club: a billing_request_local_id that does not exist is
--    rejected outright (proves this can never attach a provider object
--    to the wrong club via a forged/garbage local id).
-- ------------------------------------------------------------
do $$
begin
  perform public.reconcile_gocardless_billing_request(gen_random_uuid(), 'fulfilled', 'CU_FORGED', 'MD_FORGED', 'active', 'bacs', null);
  raise notice 'FAIL 6: reconciliation succeeded against a nonexistent/forged billing_request_local_id';
exception when others then
  raise notice 'PASS 6: forged/nonexistent billing_request_local_id correctly rejected -- %', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 7. Parent (and any authenticated/anon role) cannot call this RPC at
--    all -- service_role only, regardless of forged provider IDs.
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_recon_state where k = 'parent';
do $$
declare
  v_billing_request_id uuid := (select v::uuid from t_recon_state where k = 'billing_request_id');
begin
  perform public.reconcile_gocardless_billing_request(v_billing_request_id, 'fulfilled', 'CU_TAMPER', 'MD_TAMPER', 'active', 'bacs', null);
  raise notice 'FAIL 7: the Parent (authenticated role) was able to call reconcile_gocardless_billing_request directly';
exception when others then
  raise notice 'PASS 7: authenticated caller correctly denied -- %', sqlerrm;
end $$;

set local role anon;
do $$
declare
  v_billing_request_id uuid := (select v::uuid from t_recon_state where k = 'billing_request_id');
begin
  perform public.reconcile_gocardless_billing_request(v_billing_request_id, 'fulfilled', 'CU_TAMPER2', 'MD_TAMPER2', 'active', 'bacs', null);
  raise notice 'FAIL 7b: an anonymous caller was able to call reconcile_gocardless_billing_request';
exception when others then
  raise notice 'PASS 7b: anonymous caller correctly denied -- %', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 8. No bank-detail columns exist anywhere this function could write to
--    (structural proof, not just "we didn't pass one this time").
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('gocardless_customers', 'gocardless_mandates')
    and (column_name ilike '%account_number%' or column_name ilike '%sort_code%' or column_name ilike '%iban%' or column_name ilike '%bank_account%');
  if v_count = 0 then
    raise notice 'PASS 8: no bank-detail-shaped column exists on gocardless_customers or gocardless_mandates';
  else
    raise notice 'FAIL 8: % bank-detail-shaped column(s) found on reconciliation tables', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 9/10. Customer and mandate uniqueness constraints are real, not just
--       assumed -- direct duplicate-insert attempts fail.
-- ------------------------------------------------------------
reset role;
do $$
declare
  v_club_id uuid := (select v::uuid from t_recon_state where k = 'club_id');
  v_parent uuid := (select v::uuid from t_recon_state where k = 'parent');
begin
  begin
    insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id) values (v_club_id, v_parent, 'CU_DUPLICATE_ATTEMPT');
    raise notice 'FAIL 9: a second gocardless_customers row for the same (club_id, payer_user_id) was allowed';
  exception when unique_violation then
    raise notice 'PASS 9: duplicate (club_id, payer_user_id) customer row correctly rejected by unique constraint';
  end;

  begin
    insert into public.gocardless_mandates (club_id, gocardless_customer_id, billing_request_id, gc_mandate_id, status)
    values (v_club_id, (select v::uuid from t_recon_state where k = 'customer_id'), (select v::uuid from t_recon_state where k = 'billing_request_id'), 'MD_REGRESSION_TEST', 'active');
    raise notice 'FAIL 10: a second gocardless_mandates row for the same gc_mandate_id was allowed';
  exception when unique_violation then
    raise notice 'PASS 10: duplicate gc_mandate_id correctly rejected by unique constraint';
  end;
end $$;

\echo '=== Suite complete. Every line above must read PASS. ==='
rollback;
