-- Test 4 closure Section 2/3/4: permanent regression coverage for the
-- new canonical Subscription webhook reconciliation RPC
-- (reconcile_gocardless_subscription, see
-- supabase/migrations/20260925150000_reconcile_gocardless_subscription.sql
-- and lib/payments/gocardless/reconcile.ts's reconcileGoCardlessSubscription).
-- Entirely self-contained synthetic fixtures, transactional/self-cleaning
-- -- never touches Foxton's real enrolment. NOT a migration -- never
-- applied automatically by `db reset`. Run by hand:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_subscription_webhook_regression.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== GoCardless subscription webhook reconciliation regression suite ==='

begin;
create temporary table t_subwh_state (k text primary key, v text) on commit drop;
grant all on t_subwh_state to authenticated, service_role, anon;

do $$
declare
  v_club_id uuid := gen_random_uuid();
  v_dir_id uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_team_id uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_programme_id uuid;
  v_payer_id uuid;
  v_customer_id uuid;
  v_mandate_id uuid;
  v_pricing_id uuid;
  v_sub_id uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin, 'subwh-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_parent, 'subwh-parent-' || v_parent::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir_id, 'Subscription Webhook Regression Club', 'union', 'England', 'England', 'manual', 'subscription webhook regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_id, v_dir_id, 'subwh-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_id, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, active, canonical_team_type_id)
  values (v_team_id, v_club_id, 'union', 'U12', 'u12-subwh-regression', 'youth', 'U12', 'boys', true, internal.resolve_canonical_team_type('youth', 'U12', 'boys', null));
  insert into public.players (id, first_name, surname, date_of_birth, created_by) values (v_player_id, 'Subwh', 'Regression', '2015-01-01', v_admin);
  insert into public.player_team_memberships (id, player_id, team_id, status) values (gen_random_uuid(), v_player_id, v_team_id, 'active');
  insert into t_subwh_state values ('club_id', v_club_id::text), ('admin', v_admin::text), ('parent', v_parent::text), ('player_id', v_player_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_subwh_state where k = 'admin';
do $$
declare
  v_club_id uuid := (select v::uuid from t_subwh_state where k = 'club_id');
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme(v_club_id, true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
  insert into t_subwh_state values ('programme_id', v_programme_id::text);
end $$;

set local role service_role;
do $$
declare
  v_player_id uuid := (select v::uuid from t_subwh_state where k = 'player_id');
  v_programme_id uuid := (select v::uuid from t_subwh_state where k = 'programme_id');
  v_club_id uuid := (select v::uuid from t_subwh_state where k = 'club_id');
  v_parent uuid := (select v::uuid from t_subwh_state where k = 'parent');
  v_payer_id uuid;
  v_customer_id uuid;
  v_mandate_id uuid;
  v_pricing_id uuid;
  v_sub_row_id uuid;
begin
  insert into public.player_subscription_payers (id, player_id, programme_id, payer_user_id, relationship, status, effective_from, created_by)
  values (gen_random_uuid(), v_player_id, v_programme_id, v_parent, 'guardian', 'active', current_date, v_parent)
  returning id into v_payer_id;
  insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id) values (v_club_id, v_parent, 'CU_SUBWH_REGRESSION') returning id into v_customer_id;
  insert into public.gocardless_mandates (club_id, gocardless_customer_id, gc_mandate_id, status, scheme) values (v_club_id, v_customer_id, 'MD_SUBWH_REGRESSION', 'active', 'bacs') returning id into v_mandate_id;
  select id into v_pricing_id from public.club_subscription_pricing where programme_id = v_programme_id order by effective_from desc limit 1;
  v_sub_row_id := public.record_gocardless_subscription(v_payer_id, v_pricing_id, v_mandate_id, 'SB_SUBWH_REGRESSION', 1500, 'pending');
  insert into t_subwh_state values ('sub_row_id', v_sub_row_id::text);
end $$;

\echo '--- 1. A genuine status transition (pending -> active) is applied correctly ---'
do $$
declare
  v_status text;
begin
  perform public.reconcile_gocardless_subscription((select v::uuid from t_subwh_state where k = 'sub_row_id'), 'active');
  select status into v_status from public.gocardless_subscriptions where id = (select v::uuid from t_subwh_state where k = 'sub_row_id');
  if v_status = 'active' then
    raise notice 'PASS 1: reconcile_gocardless_subscription correctly applied a genuine active status';
  else
    raise notice 'FAIL 1: expected active, got %', v_status;
  end if;
end $$;

\echo '--- 2. NULL status (the fail-safe signal for an unrecognized provider value, per KNOWN_SUBSCRIPTION_STATUSES in reconcile.ts) is coalesced -- never overwrites the existing known-good status with nothing ---'
do $$
declare
  v_status text;
begin
  perform public.reconcile_gocardless_subscription((select v::uuid from t_subwh_state where k = 'sub_row_id'), null);
  select status into v_status from public.gocardless_subscriptions where id = (select v::uuid from t_subwh_state where k = 'sub_row_id');
  if v_status = 'active' then
    raise notice 'PASS 2: an unrecognized/null provider status left the existing known-good status (active) unchanged -- fail-safe holds';
  else
    raise notice 'FAIL 2: expected active to be preserved, got %', v_status;
  end if;
end $$;

\echo '--- 3. Duplicate reconciliation calls (simulating a duplicate webhook delivery) are idempotent -- no duplicate row, same result ---'
do $$
declare
  v_count integer;
  v_status text;
begin
  perform public.reconcile_gocardless_subscription((select v::uuid from t_subwh_state where k = 'sub_row_id'), 'active');
  perform public.reconcile_gocardless_subscription((select v::uuid from t_subwh_state where k = 'sub_row_id'), 'active');
  select count(*) into v_count from public.gocardless_subscriptions where gc_subscription_id = 'SB_SUBWH_REGRESSION';
  select status into v_status from public.gocardless_subscriptions where id = (select v::uuid from t_subwh_state where k = 'sub_row_id');
  if v_count = 1 and v_status = 'active' then
    raise notice 'PASS 3: duplicate reconciliation calls are idempotent -- exactly one row, status active';
  else
    raise notice 'FAIL 3: expected exactly 1 row with status active, got count=% status=%', v_count, v_status;
  end if;
end $$;

\echo '--- 4. Reconciling a subscription row that does not exist locally fails loudly rather than silently inventing one ---'
do $$
begin
  perform public.reconcile_gocardless_subscription(gen_random_uuid(), 'active');
  raise notice 'FAIL 4: reconcile_gocardless_subscription succeeded against a non-existent local row';
exception when others then
  raise notice 'PASS 4: correctly raised on a non-existent local subscription row -- %', sqlerrm;
end $$;

\echo '--- 5. A genuine terminal transition (active -> cancelled) is applied correctly, and does not get resurrected by a later null/duplicate ---'
do $$
declare
  v_status text;
begin
  perform public.reconcile_gocardless_subscription((select v::uuid from t_subwh_state where k = 'sub_row_id'), 'cancelled');
  perform public.reconcile_gocardless_subscription((select v::uuid from t_subwh_state where k = 'sub_row_id'), null);
  select status into v_status from public.gocardless_subscriptions where id = (select v::uuid from t_subwh_state where k = 'sub_row_id');
  if v_status = 'cancelled' then
    raise notice 'PASS 5: cancelled status correctly applied and preserved against a subsequent unrecognized/null event';
  else
    raise notice 'FAIL 5: expected cancelled, got %', v_status;
  end if;
end $$;

rollback;

\echo '=== Suite complete. Every line above must read PASS. ==='
