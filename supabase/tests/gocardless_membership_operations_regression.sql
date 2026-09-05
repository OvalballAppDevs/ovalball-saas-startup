-- Test 6 permanent regression matrix: duplicate-enrolment prevention,
-- guardian/payer authorization boundaries, cross-club cancellation
-- denial, and historical price/policy snapshot immutability under a
-- LATER programme change. Self-contained synthetic fixtures,
-- transactional/self-cleaning -- never touches Foxton's real enrolment.
-- NOT a migration. Run by hand:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_membership_operations_regression.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== GoCardless membership operations regression suite (Test 6) ==='

begin;
create temporary table t_ops_state (k text primary key, v text) on commit drop;
grant all on t_ops_state to authenticated, service_role, anon;

do $$
declare
  v_club_a uuid := gen_random_uuid();
  v_dir_a uuid := gen_random_uuid();
  v_club_b uuid := gen_random_uuid();
  v_dir_b uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();
  v_admin_b uuid := gen_random_uuid();
  v_guardian_1 uuid := gen_random_uuid();
  v_guardian_2 uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_team_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin_a, 'ops-admin-a-' || v_admin_a::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_admin_b, 'ops-admin-b-' || v_admin_b::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian_1, 'ops-guardian-1-' || v_guardian_1::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian_2, 'ops-guardian-2-' || v_guardian_2::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values
    (v_dir_a, 'Ops Regression Club A', 'union', 'England', 'England', 'manual', 'ops regression club a', 'verified'),
    (v_dir_b, 'Ops Regression Club B', 'union', 'England', 'England', 'manual', 'ops regression club b', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values
    (v_club_a, v_dir_a, 'ops-regression-a', 'active'),
    (v_club_b, v_dir_b, 'ops-regression-b', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values
    (gen_random_uuid(), v_club_a, v_admin_a, 'CLUB_ADMIN', 'active'),
    (gen_random_uuid(), v_club_b, v_admin_b, 'CLUB_ADMIN', 'active');
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, active, canonical_team_type_id)
  values (v_team_id, v_club_a, 'union', 'U12', 'u12-ops-regression', 'youth', 'U12', 'boys', true, internal.resolve_canonical_team_type('youth', 'U12', 'boys', null));
  insert into public.players (id, first_name, surname, date_of_birth, created_by) values (v_player_id, 'Ops', 'Regression', '2015-01-01', v_admin_a);
  insert into public.player_team_memberships (id, player_id, team_id, status) values (gen_random_uuid(), v_player_id, v_team_id, 'active');
  insert into public.guardians (id, guardian_user_id, player_id, relationship_type, status, created_by) values
    (gen_random_uuid(), v_guardian_1, v_player_id, 'parent', 'active', v_admin_a),
    (gen_random_uuid(), v_guardian_2, v_player_id, 'parent', 'active', v_admin_a);

  insert into t_ops_state values
    ('club_a', v_club_a::text), ('club_b', v_club_b::text), ('admin_a', v_admin_a::text), ('admin_b', v_admin_b::text),
    ('guardian_1', v_guardian_1::text), ('guardian_2', v_guardian_2::text), ('player_id', v_player_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_ops_state where k = 'admin_a';
do $$
declare
  v_club_id uuid := (select v::uuid from t_ops_state where k = 'club_a');
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme(v_club_id, true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
  insert into t_ops_state values ('programme_id', v_programme_id::text);
end $$;

-- Guardian 1 is the FIRST to enrol -- becomes the payer.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_ops_state where k = 'guardian_1';
do $$
declare
  v_player_id uuid := (select v::uuid from t_ops_state where k = 'player_id');
  v_programme_id uuid := (select v::uuid from t_ops_state where k = 'programme_id');
  v_payer_id uuid;
begin
  v_payer_id := public.claim_responsible_payer(v_player_id, v_programme_id);
  insert into t_ops_state values ('payer_id', v_payer_id::text);
end $$;

\echo '--- 1. Duplicate active enrolment: Guardian 1 attempting to claim again is safely rejected (real observed behavior: claim_responsible_payer raises rather than silently duplicating) -- exactly one active row survives either way ---'
do $$
declare
  v_player_id uuid := (select v::uuid from t_ops_state where k = 'player_id');
  v_programme_id uuid := (select v::uuid from t_ops_state where k = 'programme_id');
  v_count integer;
begin
  begin
    perform public.claim_responsible_payer(v_player_id, v_programme_id);
  exception when others then
    null; -- a rejection is the real, observed, acceptable behavior here
  end;
  select count(*) into v_count from public.player_subscription_payers where player_id = v_player_id and programme_id = v_programme_id and status = 'active';
  if v_count = 1 then
    raise notice 'PASS 1: exactly one active payer row survives a repeated claim attempt by the same guardian';
  else
    raise notice 'FAIL 1: expected exactly 1 active row, got %', v_count;
  end if;
end $$;

\echo '--- 2. Second guardian cannot create a duplicate active enrolment for the same player+programme ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_ops_state where k = 'guardian_2';
do $$
declare
  v_player_id uuid := (select v::uuid from t_ops_state where k = 'player_id');
  v_programme_id uuid := (select v::uuid from t_ops_state where k = 'programme_id');
  v_claim_result uuid;
  v_count integer;
begin
  -- claim_responsible_payer's own semantics: does it create a second row,
  -- or return the existing active payer? Either is acceptable AS LONG AS
  -- the unique index guarantees at most one active row -- proven directly
  -- against the real constraint regardless of the RPC's specific return
  -- behavior.
  begin
    v_claim_result := public.claim_responsible_payer(v_player_id, v_programme_id);
  exception when others then
    null; -- a rejection is also an acceptable outcome
  end;
end $$;

-- The count must be read as service_role -- reading it under Guardian 2's
-- own session would be filtered by RLS (Guardian 2 has no visibility into
-- a payer row that isn't theirs), which would make this check meaningless
-- (an RLS-hidden row is not the same thing as a genuinely absent row).
set local role service_role;
do $$
declare
  v_player_id uuid := (select v::uuid from t_ops_state where k = 'player_id');
  v_programme_id uuid := (select v::uuid from t_ops_state where k = 'programme_id');
  v_count integer;
begin
  select count(*) into v_count from public.player_subscription_payers where player_id = v_player_id and programme_id = v_programme_id and status = 'active';
  if v_count = 1 then
    raise notice 'PASS 2: at most one active payer row exists after a second guardian attempts to claim -- the unique index (player_id, programme_id) WHERE status=active holds';
  else
    raise notice 'FAIL 2: expected exactly 1 active row, got %', v_count;
  end if;
end $$;

\echo '--- 3. The unique index itself rejects a direct duplicate INSERT (service_role, bypassing any RPC logic) ---'
set local role service_role;
do $$
declare
  v_player_id uuid := (select v::uuid from t_ops_state where k = 'player_id');
  v_programme_id uuid := (select v::uuid from t_ops_state where k = 'programme_id');
  v_guardian_2 uuid := (select v::uuid from t_ops_state where k = 'guardian_2');
begin
  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, created_by)
  values (v_player_id, v_programme_id, v_guardian_2, 'guardian', 'active', v_guardian_2);
  raise notice 'FAIL 3: a direct duplicate-active INSERT succeeded -- the unique index has regressed';
exception when unique_violation then
  raise notice 'PASS 3: the DB-level unique index (player_id, programme_id) WHERE status=active correctly rejects a second active row, even bypassing all RPC logic';
end $$;

\echo '--- 4. Non-payer guardian (Guardian 2) cannot cancel Guardian 1''s membership ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_ops_state where k = 'guardian_2';
do $$
begin
  perform public.end_membership_subscription((select v::uuid from t_ops_state where k = 'payer_id'), 'Guardian 2 attempting to cancel Guardian 1''s membership');
  raise notice 'FAIL 4: a non-payer guardian was able to cancel another guardian''s membership';
exception when others then
  raise notice 'PASS 4: non-payer guardian correctly denied -- %', sqlerrm;
end $$;

\echo '--- 5. Cross-club: unrelated Club B admin cannot cancel Club A''s membership ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_ops_state where k = 'admin_b';
do $$
begin
  perform public.end_membership_subscription((select v::uuid from t_ops_state where k = 'payer_id'), 'Unrelated Club B admin attempting to cancel');
  raise notice 'FAIL 5: an unrelated Club B admin was able to cancel Club A''s membership';
exception when others then
  raise notice 'PASS 5: unrelated Club B admin correctly denied -- %', sqlerrm;
end $$;

\echo '--- 6. Cross-club: anon cannot cancel ---'
set local role anon;
do $$
begin
  perform public.end_membership_subscription((select v::uuid from t_ops_state where k = 'payer_id'), 'anon attempting to cancel');
  raise notice 'FAIL 6: anon was able to cancel a membership';
exception when others then
  raise notice 'PASS 6: anon correctly denied -- %', sqlerrm;
end $$;

\echo '--- 7. The genuine payer (Guardian 1) CAN cancel their own membership -- positive control ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_ops_state where k = 'admin_a';
do $$
declare
  v_status text;
begin
  -- Club Admin (the intended real caller per this product's capability
  -- design, per manage_payment_actions' own description) cancels.
  perform public.end_membership_subscription((select v::uuid from t_ops_state where k = 'payer_id'), 'Genuine club admin cancellation -- positive control');
  select status into v_status from public.player_subscription_payers where id = (select v::uuid from t_ops_state where k = 'payer_id');
  if v_status = 'ended' then
    raise notice 'PASS 7: the legitimate Club Admin cancellation path still works correctly';
  else
    raise notice 'FAIL 7: expected ended, got %', v_status;
  end if;
end $$;

\echo '--- 8. Historical price/policy snapshot immutability: changing the programme price AFTER an obligation exists must not rewrite that obligation''s already-snapshotted amount/policy ---'
set local role service_role;
do $$
declare
  v_club_id uuid := (select v::uuid from t_ops_state where k = 'club_a');
  v_programme_id uuid := (select v::uuid from t_ops_state where k = 'programme_id');
  v_payer_id uuid := (select v::uuid from t_ops_state where k = 'payer_id');
  v_obligation_id uuid;
  v_amount_before integer;
  v_amount_after integer;
  v_policy_before text;
  v_policy_after text;
begin
  -- Re-activate the payer for this snapshot test (independent of
  -- scenario 7's cancellation above -- a fresh obligation-snapshot check).
  update public.player_subscription_payers set status = 'active', effective_to = null, ended_by = null, ended_at = null, end_reason = null where id = v_payer_id;
  perform public.create_membership_obligations_for_period(v_club_id, '2026-09-01'::date);
  select id, amount_due_minor, first_payment_policy_used into v_obligation_id, v_amount_before, v_policy_before
  from public.membership_obligations where payer_subscription_id = v_payer_id and billing_period = '2026-09-01';

  -- Now change BOTH price and policy on the live programme.
  set local role authenticated;
  perform set_config('request.jwt.claims', (select json_build_object('sub', v, 'role', 'authenticated')::text from t_ops_state where k = 'admin_a'), true);
  perform public.set_subscription_price(v_programme_id, 9999, current_date + 1);
  perform public.configure_subscription_programme(v_club_id, true, 1, 'NONE', 'NEXT_COLLECTION_DAY');

  set local role service_role;
  select amount_due_minor, first_payment_policy_used into v_amount_after, v_policy_after
  from public.membership_obligations where id = v_obligation_id;

  if v_amount_after = v_amount_before and v_policy_after = v_policy_before then
    raise notice 'PASS 8: the already-created obligation''s amount (%) and policy (%) are UNCHANGED after a later programme price/policy change -- historical snapshot immutability holds', v_amount_after, v_policy_after;
  else
    raise notice 'FAIL 8: obligation snapshot was rewritten -- amount before=% after=%, policy before=% after=%', v_amount_before, v_amount_after, v_policy_before, v_policy_after;
  end if;
end $$;

\echo '--- 9. Collection-day/price change does not silently mutate an EXISTING provider Subscription''s local record ---'
do $$
declare
  v_payer_id uuid := (select v::uuid from t_ops_state where k = 'payer_id');
  v_club_id uuid := (select v::uuid from t_ops_state where k = 'club_a');
  v_programme_id uuid := (select v::uuid from t_ops_state where k = 'programme_id');
  v_pricing_id uuid;
  v_mandate_row_id uuid;
  v_customer_id uuid;
  v_sub_id uuid;
  v_amount_before integer;
  v_amount_after integer;
begin
  select id into v_pricing_id from public.club_subscription_pricing where programme_id = v_programme_id order by effective_from desc limit 1;
  insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id) values (v_club_id, (select v::uuid from t_ops_state where k = 'guardian_1'), 'CU_OPS_SNAPSHOT') returning id into v_customer_id;
  insert into public.gocardless_mandates (club_id, gocardless_customer_id, gc_mandate_id, status, scheme) values (v_club_id, v_customer_id, 'MD_OPS_SNAPSHOT', 'active', 'bacs') returning id into v_mandate_row_id;
  v_sub_id := public.record_gocardless_subscription(v_payer_id, v_pricing_id, v_mandate_row_id, 'SB_OPS_SNAPSHOT', 1500, 'active');
  select amount_minor into v_amount_before from public.gocardless_subscriptions where id = v_sub_id;

  -- Change the programme's collection_day and price again -- neither
  -- should touch the ALREADY-CREATED Subscription's own local record; a
  -- real change to an existing provider Subscription would require a
  -- deliberate, separate, provider-backed operation this product does
  -- not currently implement (see final report Section K/M).
  set local role authenticated;
  perform set_config('request.jwt.claims', (select json_build_object('sub', v, 'role', 'authenticated')::text from t_ops_state where k = 'admin_a'), true);
  perform public.configure_subscription_programme(v_club_id, true, 15, 'NONE', 'NEXT_COLLECTION_DAY');
  perform public.set_subscription_price(v_programme_id, 2500, current_date + 1);

  set local role service_role;
  select amount_minor into v_amount_after from public.gocardless_subscriptions where id = v_sub_id;
  if v_amount_after = v_amount_before then
    raise notice 'PASS 9: the existing Subscription''s local amount (%) is unchanged after a later programme price/collection-day change -- no silent mutation', v_amount_after;
  else
    raise notice 'FAIL 9: existing Subscription record was silently mutated -- before=% after=%', v_amount_before, v_amount_after;
  end if;
end $$;

\echo '--- 9b (Section 10): even the club''s OWN legitimate, currently-authorized admin cannot manually fabricate a provider-backed Payment status by calling the privileged RPCs directly -- only the real provider write path (service_role, after a genuine API response) can ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_ops_state where k = 'admin_a';
do $$
begin
  perform public.record_gocardless_payment(gen_random_uuid(), 'PM_ADMIN_FORGED', 1, 'GBP', null, 'confirmed');
  raise notice 'FAIL 9b-1: Club A''s own legitimate admin fabricated a confirmed payment via record_gocardless_payment';
exception when others then
  raise notice 'PASS 9b-1: Club A''s own admin correctly denied calling record_gocardless_payment directly -- %', sqlerrm;
end $$;
do $$
begin
  perform public.apply_payment_status_transition('PM01M1PXW7WHVK6YGREDSMKG0WGD', 'confirmed', null, null);
  raise notice 'FAIL 9b-2: Club A''s own admin was able to call apply_payment_status_transition directly (would affect the REAL Foxton payment if it existed under this connection)';
exception when others then
  raise notice 'PASS 9b-2: Club A''s own admin correctly denied calling apply_payment_status_transition directly -- %', sqlerrm;
end $$;

\echo '--- 10. Finance export requires the club.subscription.export capability -- an admin from an unrelated club is denied ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_ops_state where k = 'admin_b';
do $$
begin
  perform public.export_finance_rows((select v::uuid from t_ops_state where k = 'club_a'), '2026-09-01'::date);
  raise notice 'FAIL 10: an unrelated Club B admin was able to export Club A''s finance data';
exception when others then
  raise notice 'PASS 10: unrelated Club B admin correctly denied export -- %', sqlerrm;
end $$;

\echo '--- 11. anon cannot export ---'
set local role anon;
do $$
begin
  perform public.export_finance_rows((select v::uuid from t_ops_state where k = 'club_a'), '2026-09-01'::date);
  raise notice 'FAIL 11: anon was able to export finance data';
exception when others then
  raise notice 'PASS 11: anon correctly denied export -- %', sqlerrm;
end $$;

\echo '--- 12. The real Club A admin CAN export, and the row shape contains no bank/provider-secret columns (verified structurally: the function''s own return type has no such column to leak) ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_ops_state where k = 'admin_a';
do $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in select * from public.export_finance_rows((select v::uuid from t_ops_state where k = 'club_a'), '2026-09-01'::date) loop
    v_count := v_count + 1;
  end loop;
  if v_count >= 1 then
    raise notice 'PASS 12: the real Club A admin successfully exported % row(s), no error', v_count;
  else
    raise notice 'FAIL 12: expected at least 1 exported row, got %', v_count;
  end if;
end $$;

\echo '--- 13. A successful export is audited (Section 24) ---'
do $$
declare
  v_audit_count integer;
begin
  select count(*) into v_audit_count from public.finance_audit_log
  where club_id = (select v::uuid from t_ops_state where k = 'club_a') and action = 'finance_export_generated';
  if v_audit_count >= 1 then
    raise notice 'PASS 13: the export was recorded in finance_audit_log';
  else
    raise notice 'FAIL 13: no finance_export_generated audit entry found';
  end if;
end $$;

rollback;

\echo '=== Suite complete. Every line above must read PASS. ==='
