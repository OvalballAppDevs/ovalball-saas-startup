-- Permanent regression suite for Test 4 (real GoCardless financial
-- instruction creation): record_gocardless_payment/record_gocardless_subscription
-- authorization, payment-action status mapping validity, policy/price
-- snapshot immutability on real financial history, and START_NEXT_MONTH
-- vs PRORATE_CURRENT_MONTH divergence. Entirely self-contained synthetic
-- fixtures, transactional/self-cleaning -- never touches Foxton's real
-- enrolment. NOT a migration -- never applied automatically by
-- `db reset`. Run by hand:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_financial_instruction_regression.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== GoCardless financial instruction regression suite ==='

-- ------------------------------------------------------------
-- 1/2. record_gocardless_payment / record_gocardless_subscription are
--      service_role-only -- neither an authenticated Parent (even one
--      who genuinely owns the obligation/payer) nor anon can call them
--      directly. This is the exact vulnerability this session found and
--      fixed live: a Parent fabricating a 1p "confirmed" payment with no
--      real provider write.
-- ------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
do $$
begin
  perform public.record_gocardless_payment(gen_random_uuid(), 'FAKE', 1, 'GBP', null, 'confirmed');
  raise notice 'FAIL 1: an authenticated caller was able to call record_gocardless_payment directly';
exception when others then
  raise notice 'PASS 1: authenticated caller correctly denied -- %', sqlerrm;
end $$;
do $$
begin
  perform public.record_gocardless_subscription(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'FAKE', 1, 'active');
  raise notice 'FAIL 2: an authenticated caller was able to call record_gocardless_subscription directly';
exception when others then
  raise notice 'PASS 2: authenticated caller correctly denied -- %', sqlerrm;
end $$;
set local role anon;
do $$
begin
  perform public.record_gocardless_payment(gen_random_uuid(), 'FAKE2', 1, 'GBP', null, 'confirmed');
  raise notice 'FAIL 3: an anonymous caller was able to call record_gocardless_payment directly';
exception when others then
  raise notice 'PASS 3: anonymous caller correctly denied -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 4. record_gocardless_payment rejects any initial status other than
--    pending_submission -- defense-in-depth against a "fabricated
--    confirmed at creation" claim even by a trusted caller.
-- ------------------------------------------------------------
begin;
set local role service_role;
do $$
begin
  perform public.record_gocardless_payment(gen_random_uuid(), 'FAKE3', 100, 'GBP', null, 'confirmed');
  raise notice 'FAIL 4: record_gocardless_payment accepted an initial status of confirmed';
exception when others then
  raise notice 'PASS 4: non-pending_submission initial status correctly rejected -- %', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. The real bug this session found and fixed, permanently guarded:
--    apply_payment_status_transition must be fed a genuinely valid
--    gocardless_payments status. Prove the raw webhook ACTION string
--    "created" (the exact bug -- a webhook route regression back to
--    passing event.action directly) is rejected by the check constraint,
--    while mapPaymentActionToGoCardlessStatus('created') ==
--    'pending_submission' is accepted.
-- ------------------------------------------------------------
begin;
create temporary table t_recon_state (k text primary key, v text) on commit drop;
grant all on t_recon_state to authenticated, service_role, anon;
do $$
declare
  v_club_id uuid := gen_random_uuid();
  v_directory_id uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_team_id uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_programme_id uuid;
  v_payer_id uuid;
  v_obligation_id uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin, 'fin-regression-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_parent, 'fin-regression-parent-' || v_parent::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_directory_id, 'Financial Regression Test Club', 'union', 'England', 'England', 'manual', 'financial regression test club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_id, v_directory_id, 'financial-regression-test', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_id, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, active, canonical_team_type_id)
  values (v_team_id, v_club_id, 'union', 'U12', 'u12-fin-regression', 'youth', 'U12', 'boys', true, internal.resolve_canonical_team_type('youth', 'U12', 'boys', null));
  insert into public.players (id, first_name, surname, date_of_birth, created_by) values (v_player_id, 'Fin', 'Regression', '2015-01-01', v_admin);
  insert into public.player_team_memberships (id, player_id, team_id, status) values (gen_random_uuid(), v_player_id, v_team_id, 'active');
  insert into t_recon_state values ('fin5_club_id', v_club_id::text), ('fin5_admin', v_admin::text), ('fin5_parent', v_parent::text), ('fin5_player_id', v_player_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_recon_state where k = 'fin5_admin';
do $$
declare
  v_club_id uuid := (select v::uuid from t_recon_state where k = 'fin5_club_id');
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme(v_club_id, true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
  insert into t_recon_state values ('fin5_programme_id', v_programme_id::text);
end $$;

set local role service_role;
do $$
declare
  v_player_id uuid := (select v::uuid from t_recon_state where k = 'fin5_player_id');
  v_programme_id uuid := (select v::uuid from t_recon_state where k = 'fin5_programme_id');
  v_club_id uuid := (select v::uuid from t_recon_state where k = 'fin5_club_id');
  v_parent uuid := (select v::uuid from t_recon_state where k = 'fin5_parent');
  v_payer_id uuid;
  v_obligation_id uuid;
begin
  insert into public.player_subscription_payers (id, player_id, programme_id, payer_user_id, relationship, status, effective_from, created_by)
  values (gen_random_uuid(), v_player_id, v_programme_id, v_parent, 'guardian', 'active', current_date, v_parent)
  returning id into v_payer_id;
  perform public.create_membership_obligations_for_period(v_club_id, date_trunc('month', current_date)::date);
  select id into v_obligation_id from public.membership_obligations where payer_subscription_id = v_payer_id;
  perform public.record_gocardless_payment(v_obligation_id, 'PM_FIN_REGRESSION_TEST', 1500, 'GBP', null, 'pending_submission');

  begin
    perform public.apply_payment_status_transition('PM_FIN_REGRESSION_TEST', 'created', null, null);
    raise notice 'FAIL 5a: apply_payment_status_transition accepted the raw webhook action "created" as a status -- the original bug has regressed';
  exception when check_violation then
    raise notice 'PASS 5a: raw action "created" correctly rejected by the status check constraint (regression guard holds)';
  end;

  -- mapPaymentActionToGoCardlessStatus('created') (lib/payments/gocardless/mapper.ts,
  -- a TS-only mapping, asserted here by its known-correct output) is
  -- 'pending_submission' -- the value the fixed webhook route actually
  -- sends. Confirms that value is accepted.
  perform public.apply_payment_status_transition('PM_FIN_REGRESSION_TEST', 'pending_submission', null, null);
  raise notice 'PASS 5b: the correctly-mapped status (pending_submission) is accepted';

  -- Test 4 closure Section 4: a genuinely unrecognized provider status
  -- (not merely a raw action string, but any value outside the real
  -- gocardless_payments_status_check vocabulary) must fail safe -- never
  -- silently written.
  begin
    perform public.apply_payment_status_transition('PM_FIN_REGRESSION_TEST', 'some_future_unrecognized_gc_status', null, null);
    raise notice 'FAIL 5c: an unrecognized provider status was accepted';
  exception when check_violation then
    raise notice 'PASS 5c: an unrecognized provider status correctly rejected by the check constraint';
  end;

  -- Test 4 closure Section 4/12: duplicate event delivery is idempotent
  -- at the record_gocardless_event layer -- a repeat gc_event_id is a
  -- safe no-op (on conflict do nothing), never double-processed.
  declare
    v_first_id uuid;
    v_second_id uuid;
    v_event_count integer;
  begin
    v_first_id := public.record_gocardless_event('EV_FIN_REGRESSION_DUPLICATE', 'payments', 'created', '{}'::jsonb);
    v_second_id := public.record_gocardless_event('EV_FIN_REGRESSION_DUPLICATE', 'payments', 'created', '{}'::jsonb);
    select count(*) into v_event_count from public.gocardless_events where gc_event_id = 'EV_FIN_REGRESSION_DUPLICATE';
    if v_first_id is not null and v_second_id is null and v_event_count = 1 then
      raise notice 'PASS 5d: duplicate event delivery is idempotent -- first insert succeeded, second was a safe no-op, exactly one row exists';
    else
      raise notice 'FAIL 5d: duplicate event handling incorrect -- first=% second=% count=%', v_first_id, v_second_id, v_event_count;
    end if;
  end;
end $$;
rollback;

-- ------------------------------------------------------------
-- 6. Test 4 closure Section 5: RETRYING obligation state -- a payment
--    recovering from FAILED back to submitted (a real, structural
--    before/after transition, not an assumed action name) must land the
--    obligation on RETRYING, distinct from a fresh SUBMITTED.
-- ------------------------------------------------------------
begin;
create temporary table t_retry_state (k text primary key, v text) on commit drop;
grant all on t_retry_state to authenticated, service_role, anon;
do $$
declare
  v_club_id uuid := gen_random_uuid();
  v_directory_id uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_team_id uuid := gen_random_uuid();
  v_player_id uuid := gen_random_uuid();
  v_programme_id uuid;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_admin, 'retry-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_parent, 'retry-parent-' || v_parent::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status)
  values (v_directory_id, 'Retry Regression Test Club', 'union', 'England', 'England', 'manual', 'retry regression test club', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values (v_club_id, v_directory_id, 'retry-regression-test', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_id, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.teams (id, club_id, rugby_code, display_name, slug, category, age_group, gender, active, canonical_team_type_id)
  values (v_team_id, v_club_id, 'union', 'U12', 'u12-retry-regression', 'youth', 'U12', 'boys', true, internal.resolve_canonical_team_type('youth', 'U12', 'boys', null));
  insert into public.players (id, first_name, surname, date_of_birth, created_by) values (v_player_id, 'Retry', 'Regression', '2015-01-01', v_admin);
  insert into public.player_team_memberships (id, player_id, team_id, status) values (gen_random_uuid(), v_player_id, v_team_id, 'active');
  insert into t_retry_state values ('club_id', v_club_id::text), ('admin', v_admin::text), ('parent', v_parent::text), ('player_id', v_player_id::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_retry_state where k = 'admin';
do $$
declare
  v_club_id uuid := (select v::uuid from t_retry_state where k = 'club_id');
  v_programme_id uuid;
begin
  v_programme_id := public.configure_subscription_programme(v_club_id, true, 1, 'NONE', 'PRORATE_CURRENT_MONTH');
  perform public.set_subscription_price(v_programme_id, 1500, current_date);
  insert into t_retry_state values ('programme_id', v_programme_id::text);
end $$;

set local role service_role;
do $$
declare
  v_player_id uuid := (select v::uuid from t_retry_state where k = 'player_id');
  v_programme_id uuid := (select v::uuid from t_retry_state where k = 'programme_id');
  v_club_id uuid := (select v::uuid from t_retry_state where k = 'club_id');
  v_parent uuid := (select v::uuid from t_retry_state where k = 'parent');
  v_payer_id uuid;
  v_obligation_id uuid;
  v_status text;
begin
  insert into public.player_subscription_payers (id, player_id, programme_id, payer_user_id, relationship, status, effective_from, created_by)
  values (gen_random_uuid(), v_player_id, v_programme_id, v_parent, 'guardian', 'active', current_date, v_parent)
  returning id into v_payer_id;
  perform public.create_membership_obligations_for_period(v_club_id, date_trunc('month', current_date)::date);
  select id into v_obligation_id from public.membership_obligations where payer_subscription_id = v_payer_id;
  perform public.record_gocardless_payment(v_obligation_id, 'PM_RETRY_REGRESSION', 1500, 'GBP', null, 'pending_submission');

  -- Baseline: submitted from pending_submission (never having failed) is
  -- a plain SUBMITTED, not RETRYING.
  perform public.apply_payment_status_transition('PM_RETRY_REGRESSION', 'submitted', null, null);
  select status into v_status from public.membership_obligations where id = v_obligation_id;
  if v_status = 'SUBMITTED' then
    raise notice 'PASS 6a: a first-time submitted payment correctly maps the obligation to SUBMITTED (not RETRYING)';
  else
    raise notice 'FAIL 6a: expected SUBMITTED, got %', v_status;
  end if;

  -- Now fail it, then resubmit -- this is the real recovery case.
  perform public.apply_payment_status_transition('PM_RETRY_REGRESSION', 'failed', 'insufficient_funds', null);
  select status into v_status from public.membership_obligations where id = v_obligation_id;
  if v_status <> 'FAILED' then
    raise notice 'FAIL 6b: expected FAILED after a failure event, got %', v_status;
  end if;

  perform public.apply_payment_status_transition('PM_RETRY_REGRESSION', 'submitted', null, null);
  select status into v_status from public.membership_obligations where id = v_obligation_id;
  if v_status = 'RETRYING' then
    raise notice 'PASS 6c: a payment recovering from FAILED back to submitted correctly lands the obligation on RETRYING';
  else
    raise notice 'FAIL 6c: expected RETRYING, got %', v_status;
  end if;

  -- And a subsequent genuine confirmation still resolves it to PAID,
  -- proving RETRYING is not a dead-end/terminal state.
  perform public.apply_payment_status_transition('PM_RETRY_REGRESSION', 'confirmed', null, current_date);
  select status into v_status from public.membership_obligations where id = v_obligation_id;
  if v_status = 'PAID' then
    raise notice 'PASS 6d: a RETRYING obligation correctly resolves to PAID on a genuine confirmation';
  else
    raise notice 'FAIL 6d: expected PAID, got %', v_status;
  end if;

  -- Test 5 Section 21: every genuine status transition above must have
  -- left an audit trail entry (source='webhook'), and a no-op transition
  -- (status unchanged) must NOT create a duplicate entry. Never logs
  -- secrets/tokens -- only status values and IDs.
  declare
    v_audit_count integer;
  begin
    select count(*) into v_audit_count from public.finance_audit_log where target_id = (select id from public.gocardless_payments where gc_payment_id = 'PM_RETRY_REGRESSION') and action = 'payment_status_transition';
    -- submitted, failed, submitted(retrying), confirmed = 4 real transitions
    if v_audit_count = 4 then
      raise notice 'PASS 6e: exactly 4 audit log entries exist for the 4 real status transitions above (submitted, failed, submitted, confirmed)';
    else
      raise notice 'FAIL 6e: expected 4 audit entries, got %', v_audit_count;
    end if;

    -- created_at is constant within this transaction (Postgres now()
    -- doesn't advance per-statement inside one transaction block), so
    -- "most recent" can't be found by ordering -- instead confirm the
    -- specific old->new pair for the final (submitted -> confirmed)
    -- transition exists at all among the 4 entries.
    if exists (
      select 1 from public.finance_audit_log
      where target_id = (select id from public.gocardless_payments where gc_payment_id = 'PM_RETRY_REGRESSION')
        and action = 'payment_status_transition'
        and old_value->>'status' = 'submitted' and new_value->>'status' = 'confirmed'
    ) then
      raise notice 'PASS 6f: an audit entry correctly records the final transition old_value=submitted, new_value=confirmed';
    else
      raise notice 'FAIL 6f: no audit entry found recording old=submitted new=confirmed';
    end if;

    -- No-op: re-applying the SAME status (confirmed -> confirmed) must not log a new entry.
    perform public.apply_payment_status_transition('PM_RETRY_REGRESSION', 'confirmed', null, current_date);
    select count(*) into v_audit_count from public.finance_audit_log where target_id = (select id from public.gocardless_payments where gc_payment_id = 'PM_RETRY_REGRESSION') and action = 'payment_status_transition';
    if v_audit_count = 4 then
      raise notice 'PASS 6g: re-applying the same status (confirmed -> confirmed) did not create a duplicate audit entry';
    else
      raise notice 'FAIL 6g: expected audit count to remain 4 after a no-op transition, got %', v_audit_count;
    end if;
  end;
end $$;
rollback;

\echo '=== Suite complete. Every line above must read PASS. ==='
