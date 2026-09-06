-- Phase G -- the provider side of Ovalball's own billing.
--
-- No provider is called here. These assertions cover the state machine the
-- provider reports into: replayed webhooks, terminal statuses, environment
-- binding, Beta, and the reach of the two payment domains.

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_club_admin uuid := gen_random_uuid();
  v_dir uuid;
  v_club uuid;
  v_sub uuid;
  v_event uuid;
  v_event2 uuid;
  v_payment uuid;
  v_count int;
  v_int int;
  v_bool boolean;
  v_text text;
  v_err text;
  v_ok boolean;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_owner,      'gcowner@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_club_admin, 'gcadmin@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.site_admins (user_id, admin_role, status) values (v_owner, 'full', 'active');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('GC Test Club', 'union', 'England', 'England', 'manual', 'verified', 'gc-test-club')
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status)
  values (v_dir, 'gc-test-club', 'active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club, v_club_admin, 'CLUB_ADMIN', 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  v_sub := public.select_club_plan(v_club, 'standard');

  -- ---------- 1. no mandate, no live subscription ----------
  begin
    update public.platform_club_subscriptions set status = 'active' where id = v_sub;
    raise notice 'FAIL 1: a subscription went live with nothing to collect against';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%live_needs_mandate%' then
      raise notice 'PASS 1: a subscription cannot be active without a mandate';
    else
      raise notice 'FAIL 1: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 2. a redelivered webhook is recorded once ----------
  v_event := public.record_platform_provider_event('EV_TEST_001', 'payments', 'confirmed', '{"id":"EV_TEST_001"}'::jsonb);
  v_event2 := public.record_platform_provider_event('EV_TEST_001', 'payments', 'confirmed', '{"id":"EV_TEST_001"}'::jsonb);
  select count(*) into v_count from public.platform_provider_events where provider_event_id = 'EV_TEST_001';
  if v_event is not null and v_event2 is null and v_count = 1 then
    raise notice 'PASS 2: a redelivered provider event is recorded once and reported as a duplicate';
  else
    raise notice 'FAIL 2: first=%, second=%, rows=%', v_event, v_event2, v_count;
  end if;

  -- ---------- 3. an active mandate completes setup ----------
  update public.platform_club_subscriptions
  set provider_billing_request_id = 'BRQ_TEST_001' where id = v_sub;

  perform public.attach_platform_subscription_provider(
    v_club, 'sandbox', 'CU_TEST_001', 'MD_TEST_001', null, 'BRQ_TEST_001', 'active'
  );

  select status into v_text from public.platform_club_subscriptions where id = v_sub;
  select count(*) into v_count from public.platform_subscription_events
  where club_id = v_club and event_type = 'setup_completed';

  if v_text = 'scheduled' and v_count = 1 then
    raise notice 'PASS 3: a confirmed mandate moves the subscription out of setup, once';
  else
    raise notice 'FAIL 3: status=%, setup_completed events=%', v_text, v_count;
  end if;

  -- ---------- 4. the environment binding cannot be crossed ----------
  begin
    perform public.attach_platform_subscription_provider(v_club, 'production', null, 'MD_TEST_001', null, null, 'active');
    raise notice 'FAIL 4: a sandbox subscription was re-attached to production';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%bound to the sandbox environment%' then
      raise notice 'PASS 4: a sandbox mandate cannot be promoted to production';
    else
      raise notice 'FAIL 4: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 5. Beta collects nothing ----------
  begin
    perform public.open_platform_billing_cycle(v_club, current_date, 'gc-test-cycle-beta');
    raise notice 'FAIL 5: a billing cycle opened while Ovalball was in Beta';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%Beta%' then
      raise notice 'PASS 5: no cycle can open while Ovalball is in Beta';
    else
      raise notice 'FAIL 5: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_platform_mode('live', 'Phase G test setup');

  -- ---------- 6. a cycle opens once per key ----------
  select payment_id, net_pence, skipped into v_payment, v_int, v_bool
  from public.open_platform_billing_cycle(v_club, current_date, 'gc-test-cycle-1');

  if v_payment is not null and v_int = 1500 and not v_bool then
    raise notice 'PASS 6: a cycle opens a GBP 15 collection';
  else
    raise notice 'FAIL 6: payment=%, net=%, skipped=%', v_payment, v_int, v_bool;
  end if;

  select count(*) into v_count from public.platform_payments where club_id = v_club;
  perform public.open_platform_billing_cycle(v_club, current_date, 'gc-test-cycle-1');
  if (select count(*) from public.platform_payments where club_id = v_club) = v_count then
    raise notice 'PASS 7: re-running the same cycle returns the existing payment rather than collecting twice';
  else
    raise notice 'FAIL 7: a second payment row was created for the same cycle';
  end if;

  -- ---------- 8. confirmation activates the subscription, once ----------
  if public.apply_platform_payment_status(v_payment, 'confirmed', 'PM_TEST_001') then
    select status into v_text from public.platform_club_subscriptions where id = v_sub;
    select count(*) into v_count from public.platform_subscription_events
    where club_id = v_club and event_type = 'activated';
    if v_text = 'active' and v_count = 1 then
      raise notice 'PASS 8: the first confirmed collection activates the subscription';
    else
      raise notice 'FAIL 8: status=%, activated events=%', v_text, v_count;
    end if;
  else
    raise notice 'FAIL 8: confirmation was refused';
  end if;

  -- ---------- 9. a replayed confirmation changes nothing ----------
  select count(*) into v_count from public.platform_subscription_events where club_id = v_club;
  if not public.apply_platform_payment_status(v_payment, 'confirmed', 'PM_TEST_001') then
    if (select count(*) from public.platform_subscription_events where club_id = v_club) = v_count then
      raise notice 'PASS 9: confirming an already-confirmed payment records nothing further';
    else
      raise notice 'FAIL 9: a replayed confirmation wrote more events';
    end if;
  else
    raise notice 'FAIL 9: a replayed confirmation was treated as new';
  end if;

  -- ---------- 10. a terminal payment cannot be walked backwards ----------
  if not public.apply_platform_payment_status(v_payment, 'pending') then
    select status into v_text from public.platform_payments where id = v_payment;
    if v_text = 'confirmed' then
      raise notice 'PASS 10: a confirmed payment cannot be moved back to pending';
    else
      raise notice 'FAIL 10: the payment status became %', v_text;
    end if;
  else
    raise notice 'FAIL 10: a terminal payment was reopened';
  end if;

  -- ---------- 11. a failed collection returns the credit it consumed ----------
  insert into public.platform_credits (club_id, amount_pence, source, reason, snapshot_plan_code, snapshot_price_pence, snapshot_price_version)
  values (v_club, 500, 'goodwill', 'Phase G test credit', 'standard', 1500, 1);

  select payment_id into v_payment
  from public.open_platform_billing_cycle(v_club, current_date, 'gc-test-cycle-2');

  if public.club_credit_balance_pence(v_club) = 0 then
    raise notice 'PASS 11: opening a cycle consumes the available credit';
  else
    raise notice 'FAIL 11: balance after applying credit is %', public.club_credit_balance_pence(v_club);
  end if;

  perform public.apply_platform_payment_status(v_payment, 'failed', 'PM_TEST_002', 'insufficient_funds');

  select status into v_text from public.platform_club_subscriptions where id = v_sub;
  if v_text = 'past_due' and public.club_credit_balance_pence(v_club) = 500 then
    raise notice 'PASS 12: a failed collection marks the subscription past due and gives the credit back';
  else
    raise notice 'FAIL 12: status=%, balance=%', v_text, public.club_credit_balance_pence(v_club);
  end if;

  -- ---------- 13. the reversal is recorded, not the application deleted ----------
  select count(*) into v_count from public.platform_credits
  where club_id = v_club and source = 'application' and applied_to_payment_id = v_payment;
  select count(*) into v_int from public.platform_credits where club_id = v_club and source = 'reversal';
  if v_count = 1 and v_int = 1 then
    raise notice 'PASS 13: the ledger keeps both the application and its reversal';
  else
    raise notice 'FAIL 13: applications=%, reversals=%', v_count, v_int;
  end if;

  -- ---------- 14. a cycle covered by credit is skipped, not sent ----------
  insert into public.platform_credits (club_id, amount_pence, source, reason, snapshot_plan_code, snapshot_price_pence, snapshot_price_version)
  values (v_club, 1000, 'goodwill', 'Phase G test top-up', 'standard', 1500, 1);

  select payment_id, skipped into v_payment, v_bool
  from public.open_platform_billing_cycle(v_club, current_date, 'gc-test-cycle-3');

  select status, net_pence into v_text, v_int from public.platform_payments where id = v_payment;
  if v_bool and v_text = 'skipped' and v_int = 0 then
    raise notice 'PASS 14: a fully-credited cycle is recorded as skipped, never sent as a zero collection';
  else
    raise notice 'FAIL 14: skipped=%, status=%, net=%', v_bool, v_text, v_int;
  end if;

  -- ---------- 15. no browser session can reach the money functions ----------
  select not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'record_platform_provider_event', 'mark_platform_provider_event_processed',
        'attach_platform_subscription_provider', 'open_platform_billing_cycle',
        'apply_platform_payment_status'
      )
      and (
        p.proacl is null  -- null ACL means the default: execute to PUBLIC
        or exists (
          select 1 from aclexplode(p.proacl) a
          join pg_roles r on r.oid = a.grantee
          where r.rolname in ('authenticated', 'anon') and a.privilege_type = 'EXECUTE'
        )
        or exists (
          select 1 from aclexplode(p.proacl) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'  -- grantee 0 is PUBLIC
        )
      )
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 15: none of the provider state functions is reachable from a browser session';
  else
    raise notice 'FAIL 15: a provider state function is executable by authenticated, anon or PUBLIC';
  end if;

  -- ---------- 16. the two domains have separate webhook inboxes ----------
  select count(*) into v_count from information_schema.tables
  where table_schema = 'public' and table_name in ('platform_provider_events', 'gocardless_events');
  select not exists (
    select 1 from public.platform_provider_events e
    join public.gocardless_events g on g.gc_event_id = e.provider_event_id
  ) into v_ok;
  if v_count = 2 and v_ok then
    raise notice 'PASS 16: Ovalball billing and club-member billing have separate, non-overlapping event inboxes';
  else
    raise notice 'FAIL 16: inbox tables=%, overlap-free=%', v_count, v_ok;
  end if;

  -- ---------- 17. and still no foreign key between the domains ----------
  select not exists (
    select 1
    from pg_constraint c
    join pg_class src on src.oid = c.conrelid
    join pg_class tgt on tgt.oid = c.confrelid
    where c.contype = 'f'
      and (
        (src.relname like 'platform\_%' and (tgt.relname like 'gocardless\_%' or tgt.relname like 'club\_subscription\_%' or tgt.relname in ('membership_obligations', 'payer_subscriptions')))
        or
        (tgt.relname like 'platform\_%' and (src.relname like 'gocardless\_%' or src.relname like 'club\_subscription\_%' or src.relname in ('membership_obligations', 'payer_subscriptions')))
      )
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 17: no foreign key joins the two payment domains';
  else
    raise notice 'FAIL 17: a foreign key crosses between the two payment domains';
  end if;
  -- ---------- 18. the internal state helpers are locked too ----------
  select not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal'
      and p.proname in (
        'pause_trial_row', 'resume_trial_row', 'apply_platform_mode_to_trials',
        'process_due_trials', 'record_subscription_event', 'notify_club_platform_billing'
      )
      and (
        p.proacl is null
        or exists (
          select 1 from aclexplode(p.proacl) a
          join pg_roles r on r.oid = a.grantee
          where r.rolname in ('authenticated', 'anon') and a.privilege_type = 'EXECUTE'
        )
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
      )
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 18: the internal commercial helpers carry no grant to a browser role';
  else
    raise notice 'FAIL 18: an internal commercial helper is executable by authenticated, anon or PUBLIC';
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
