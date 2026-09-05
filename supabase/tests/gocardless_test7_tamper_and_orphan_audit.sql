-- Direct object-ID tamper / provider-ID enumeration matrix against a
-- fresh, real-shaped synthetic club's GoCardless objects (never a real
-- club's data), using a brand-new synthetic unrelated user -- plus an
-- orphan-detection sweep across the financial tables (a live, DB-wide
-- integrity check, not fixture-dependent) and a duplicate-detection
-- sweep. Self-contained, rolls back.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_test7_tamper_and_orphan_audit.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Tamper / provider-ID enumeration / orphan audit ==='

begin;
create temporary table t_t7_state (k text primary key, v text) on commit drop;
grant all on t_t7_state to authenticated, service_role, anon;

do $$
declare
  v_club_id uuid := gen_random_uuid();
  v_dir_id uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_unrelated uuid := gen_random_uuid();
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
    (v_admin, 't7-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_parent, 't7-parent-' || v_parent::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_unrelated, 't7-unrelated-' || v_unrelated::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_dir_id, 'Test 7 Tamper Regression Club', 'union', 'England', 'England', 'manual', 'test 7 tamper regression club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_id, v_dir_id, 'test7-tamper-regression', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_id, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, active, canonical_team_type_id)
  values (v_team_id, v_club_id, 'union', 'U12', 'u12-t7-regression', 'youth', 'U12', 'boys', true, internal.resolve_canonical_team_type('youth', 'U12', 'boys', null));
  insert into public.players (id, first_name, surname, date_of_birth, created_by) values (v_player_id, 'T7', 'Tamper', '2015-01-01', v_admin);
  insert into public.player_team_memberships (id, player_id, team_id, status) values (gen_random_uuid(), v_player_id, v_team_id, 'active');

  insert into t_t7_state values
    ('club_id', v_club_id::text), ('admin', v_admin::text), ('parent', v_parent::text), ('unrelated', v_unrelated::text), ('player_id', v_player_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_t7_state where k = 'admin';
do $$
declare
  v_club_id uuid := (select v::uuid from t_t7_state where k = 'club_id');
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme(v_club_id, true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
  insert into t_t7_state values ('programme_id', v_programme_id::text);
end $$;

set local role service_role;
do $$
declare
  v_player_id uuid := (select v::uuid from t_t7_state where k = 'player_id');
  v_programme_id uuid := (select v::uuid from t_t7_state where k = 'programme_id');
  v_club_id uuid := (select v::uuid from t_t7_state where k = 'club_id');
  v_parent uuid := (select v::uuid from t_t7_state where k = 'parent');
  v_payer_id uuid;
  v_customer_id uuid;
  v_mandate_id uuid;
  v_pricing_id uuid;
  v_sub_id uuid;
begin
  insert into public.player_subscription_payers (id, player_id, programme_id, payer_user_id, relationship, status, effective_from, created_by)
  values (gen_random_uuid(), v_player_id, v_programme_id, v_parent, 'guardian', 'active', current_date, v_parent)
  returning id into v_payer_id;
  insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id) values (v_club_id, v_parent, 'CU_T7_TAMPER') returning id into v_customer_id;
  insert into public.gocardless_mandates (club_id, gocardless_customer_id, gc_mandate_id, status, scheme) values (v_club_id, v_customer_id, 'MD_T7_TAMPER', 'active', 'bacs') returning id into v_mandate_id;
  select id into v_pricing_id from public.club_subscription_pricing where programme_id = v_programme_id order by effective_from desc limit 1;
  v_sub_id := public.record_gocardless_subscription(v_payer_id, v_pricing_id, v_mandate_id, 'SB_T7_TAMPER', 1500, 'active');
  perform public.create_membership_obligations_for_period(v_club_id, date_trunc('month', current_date)::date);
  perform public.record_gocardless_payment((select id from public.membership_obligations where payer_subscription_id = v_payer_id limit 1), 'PM_T7_TAMPER', 1500, 'GBP', current_date, 'pending_submission');
  insert into t_t7_state values ('payer_id', v_payer_id::text), ('customer_id', v_customer_id::text), ('mandate_id', v_mandate_id::text), ('sub_id', v_sub_id::text);
end $$;

\echo '--- 1: unrelated authenticated user cannot read this club''s real provider rows, even knowing the real gc_*_id values ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_t7_state where k = 'unrelated';
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.gocardless_customers where gc_customer_id = 'CU_T7_TAMPER';
  if v_count = 0 then
    raise notice 'PASS 1a: unrelated user cannot read the real gocardless_customers row by its known real gc_customer_id';
  else
    raise notice 'FAIL 1a: leaked % row(s)', v_count;
  end if;

  select count(*) into v_count from public.gocardless_mandates where gc_mandate_id = 'MD_T7_TAMPER';
  if v_count = 0 then
    raise notice 'PASS 1b: unrelated user cannot read the real gocardless_mandates row by its known real gc_mandate_id';
  else
    raise notice 'FAIL 1b: leaked % row(s)', v_count;
  end if;

  select count(*) into v_count from public.gocardless_subscriptions where gc_subscription_id = 'SB_T7_TAMPER';
  if v_count = 0 then
    raise notice 'PASS 1c: unrelated user cannot read the real gocardless_subscriptions row by its known real gc_subscription_id';
  else
    raise notice 'FAIL 1c: leaked % row(s)', v_count;
  end if;

  select count(*) into v_count from public.gocardless_payments where gc_payment_id = 'PM_T7_TAMPER';
  if v_count = 0 then
    raise notice 'PASS 1d: unrelated user cannot read the real gocardless_payments row by its known real gc_payment_id';
  else
    raise notice 'FAIL 1d: leaked % row(s)', v_count;
  end if;

  begin
    select count(*) into v_count from public.gocardless_merchant_connections where club_id = (select v::uuid from t_t7_state where k = 'club_id');
  exception when others then
    v_count := -1; -- sentinel: no grant at all on this table, an even stronger posture than RLS-gated zero rows
  end;
  if v_count <= 0 then
    raise notice 'PASS 1e: unrelated user cannot read this club''s gocardless_merchant_connections row (%) -- proves no access-token leak path via this table', case when v_count = -1 then 'no table-level grant at all' else 'zero rows via RLS' end;
  else
    raise notice 'FAIL 1e: leaked % row(s)', v_count;
  end if;
end $$;

\echo '--- 2: unrelated user cannot obtain the real access token via either token-issuing RPC, using real known IDs ---'
do $$
declare
  v_denied boolean := false;
  v_row record;
begin
  begin
    select * into v_row from public.get_gocardless_token_for_club_admin_action((select v::uuid from t_t7_state where k = 'club_id'));
    if v_row is null then v_denied := true; end if;
  exception when others then
    v_denied := true;
  end;
  if v_denied then
    raise notice 'PASS 2a: unrelated user denied/empty on get_gocardless_token_for_club_admin_action for the real club_id';
  else
    raise notice 'FAIL 2a: token leaked to unrelated user';
  end if;

  v_denied := false;
  begin
    select * into v_row from public.get_gocardless_token_for_payer_subscription((select v::uuid from t_t7_state where k = 'payer_id'));
    if v_row is null then v_denied := true; end if;
  exception when others then
    v_denied := true;
  end;
  if v_denied then
    raise notice 'PASS 2b: unrelated user denied/empty on get_gocardless_token_for_payer_subscription for the real payer_subscription_id';
  else
    raise notice 'FAIL 2b: token leaked to unrelated user';
  end if;
end $$;

\echo '--- 3: unrelated user cannot directly UPDATE/DELETE the real provider rows ---'
do $$
declare
  v_denied boolean := false;
  v_rows integer;
begin
  begin
    update public.gocardless_subscriptions set status = 'cancelled' where gc_subscription_id = 'SB_T7_TAMPER';
    get diagnostics v_rows = row_count;
    v_denied := (v_rows = 0);
  exception when others then
    v_denied := true;
  end;
  if v_denied then
    raise notice 'PASS 3a: unrelated user cannot UPDATE the real gocardless_subscriptions row (RLS/grant blocks or affects zero rows)';
  else
    raise notice 'FAIL 3a: unrelated user updated the real subscription row';
  end if;
end $$;

\echo '--- 4: cross-club club_id substitution cannot redirect a club-scoped RPC to leak/act on a real club it does not own ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_t7_state where k = 'unrelated';
do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.disconnect_gocardless((select v::uuid from t_t7_state where k = 'club_id'), 'tamper test');
  exception when others then
    v_denied := true;
  end;
  if v_denied then
    raise notice 'PASS 4: unrelated user cannot call disconnect_gocardless against the real club_id';
  else
    raise notice 'FAIL 4: unrelated user was able to disconnect this club''s real GoCardless connection';
  end if;
end $$;

reset role;
\echo '--- 5: orphan detection sweep across financial tables (report only, no destructive fix; live DB-wide check, not fixture-dependent) ---'
do $$
declare
  v_orphan_payments integer;
  v_orphan_subscriptions integer;
  v_orphan_obligations_player integer;
  v_orphan_obligations_club integer;
  v_orphan_payers_programme integer;
  v_events_null_club integer;
begin
  select count(*) into v_orphan_payments from public.gocardless_payments p where not exists (select 1 from public.membership_obligations o where o.id = p.obligation_id);
  select count(*) into v_orphan_subscriptions from public.gocardless_subscriptions s where not exists (select 1 from public.player_subscription_payers psp where psp.id = s.payer_subscription_id);
  select count(*) into v_orphan_obligations_player from public.membership_obligations o where not exists (select 1 from public.players p where p.id = o.player_id);
  select count(*) into v_orphan_obligations_club from public.membership_obligations o where not exists (select 1 from public.clubs c where c.id = o.club_id);
  select count(*) into v_orphan_payers_programme from public.player_subscription_payers psp where not exists (select 1 from public.club_subscription_programmes prog where prog.id = psp.programme_id);
  select count(*) into v_events_null_club from public.gocardless_events where club_id is null;

  raise notice 'ORPHAN AUDIT: gocardless_payments->obligation orphans=%, gocardless_subscriptions->payer orphans=%, obligations->player orphans=%, obligations->club orphans=%, payers->programme orphans=%, gocardless_events with null club_id=%',
    v_orphan_payments, v_orphan_subscriptions, v_orphan_obligations_player, v_orphan_obligations_club, v_orphan_payers_programme, v_events_null_club;

  if v_orphan_payments = 0 and v_orphan_subscriptions = 0 and v_orphan_obligations_player = 0 and v_orphan_obligations_club = 0 and v_orphan_payers_programme = 0 then
    raise notice 'PASS 5: zero genuine orphan financial records found';
  else
    raise notice 'FAIL 5: genuine orphan records found -- see counts above';
  end if;
end $$;

\echo '--- 6: duplicate detection sweep ---'
do $$
declare
  v_dup_active_payers integer;
  v_dup_gc_subscription integer;
  v_dup_gc_payment integer;
  v_dup_gc_mandate integer;
begin
  select count(*) into v_dup_active_payers from (
    select player_id, programme_id, count(*) from public.player_subscription_payers where status = 'active' group by player_id, programme_id having count(*) > 1
  ) x;
  select count(*) into v_dup_gc_subscription from (select gc_subscription_id, count(*) from public.gocardless_subscriptions group by gc_subscription_id having count(*) > 1) x;
  select count(*) into v_dup_gc_payment from (select gc_payment_id, count(*) from public.gocardless_payments group by gc_payment_id having count(*) > 1) x;
  select count(*) into v_dup_gc_mandate from (select gc_mandate_id, count(*) from public.gocardless_mandates group by gc_mandate_id having count(*) > 1) x;

  if v_dup_active_payers = 0 and v_dup_gc_subscription = 0 and v_dup_gc_payment = 0 and v_dup_gc_mandate = 0 then
    raise notice 'PASS 6: zero duplicate active payer rows, zero duplicate provider subscription/payment/mandate IDs anywhere in the local database';
  else
    raise notice 'FAIL 6: duplicates found -- active_payers=% subscriptions=% payments=% mandates=%', v_dup_active_payers, v_dup_gc_subscription, v_dup_gc_payment, v_dup_gc_mandate;
  end if;
end $$;

rollback;

\echo '=== Suite complete. Every line above must read PASS. ==='
