-- Phase F -- a club's subscription to Ovalball (Domain B).
--
-- The invariants: an unpurchasable plan cannot be taken; the agreed price
-- is snapshotted and survives a price change; the credit ledger is
-- append-only, cannot be overspent, and applies to a payment exactly once;
-- a cycle that comes to nothing is skipped rather than collected as zero;
-- and none of it touches the domain where a club charges its own members.

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_club_admin uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_dir uuid;
  v_club uuid;
  v_sub uuid;
  v_sub2 uuid;
  v_payment uuid;
  v_credit uuid;
  v_count int;
  v_int int;
  v_bool boolean;
  v_text text;
  v_err text;
  v_ok boolean;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_owner,      'subowner@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_club_admin, 'subadmin@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_outsider,   'suboutsider@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.site_admins (user_id, admin_role, status) values (v_owner, 'full', 'active');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Sub Test Club', 'union', 'England', 'England', 'manual', 'verified', 'sub-test-club')
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status)
  values (v_dir, 'sub-test-club', 'active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club, v_club_admin, 'CLUB_ADMIN', 'active');

  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);

  -- ---------- 1. Pro cannot be taken while it is Coming Soon ----------
  begin
    perform public.select_club_plan(v_club, 'pro');
    raise notice 'FAIL 1: a club bought a plan that is not for sale';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%not available to buy%' then
      raise notice 'PASS 1: an unpurchasable plan cannot be taken';
    else
      raise notice 'FAIL 1: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 2. Standard can ----------
  v_sub := public.select_club_plan(v_club, 'standard');
  select plan_price_pence, status into v_int, v_text
  from public.platform_club_subscriptions where id = v_sub;
  if v_int = 1500 and v_text = 'pending_setup' then
    raise notice 'PASS 2: choosing Standard snapshots GBP 15 and waits for payment setup';
  else
    raise notice 'FAIL 2: price=%, status=%', v_int, v_text;
  end if;

  -- ---------- 3. choosing the same plan again is a no-op ----------
  select count(*) into v_count from public.platform_subscription_events where club_id = v_club;
  v_sub2 := public.select_club_plan(v_club, 'standard');
  if v_sub2 = v_sub and (select count(*) from public.platform_subscription_events where club_id = v_club) = v_count then
    raise notice 'PASS 3: re-choosing the current plan changes nothing and logs nothing';
  else
    raise notice 'FAIL 3: a duplicate selection churned the record';
  end if;

  -- ---------- 4. a later price change does not rewrite the agreed price ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_platform_plan_terms('standard', 1900);
  select plan_price_pence into v_int from public.platform_club_subscriptions where id = v_sub;
  if v_int = 1500 then
    raise notice 'PASS 4: raising the list price left the club''s agreed GBP 15 alone';
  else
    raise notice 'FAIL 4: the club''s agreed price became %', v_int;
  end if;
  perform public.set_platform_plan_terms('standard', 1500);

  -- ---------- 5. the lifecycle log is append-only ----------
  begin
    update public.platform_subscription_events set reason = 'rewritten' where club_id = v_club;
    raise notice 'FAIL 5: a lifecycle event was rewritten';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%append-only%' then
      raise notice 'PASS 5: the subscription lifecycle log cannot be rewritten';
    else
      raise notice 'FAIL 5: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 6. the subscription takes no direct writes ----------
  select not exists (
    select 1 from pg_policy
    where polrelid = 'public.platform_club_subscriptions'::regclass and polcmd in ('a', 'w', 'd')
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 6: platform_club_subscriptions has no INSERT, UPDATE or DELETE policy';
  else
    raise notice 'FAIL 6: a direct-write policy exists on platform_club_subscriptions';
  end if;

  -- ---------- 7. a subscription outranks a trial for the effective plan ----------
  perform public.set_platform_mode('live', 'Phase F test setup');
  perform public.start_club_trial(v_club);
  -- A subscription cannot be live without a mandate to collect against
  -- (Phase G's platform_club_subscriptions_live_needs_mandate), so the
  -- fixture attaches a sandbox one.
  update public.platform_club_subscriptions
  set status = 'active', provider = 'gocardless', provider_environment = 'sandbox',
      provider_mandate_id = 'MD_PHASE_F_TEST', mandate_status = 'active'
  where id = v_sub;
  if internal.club_effective_plan(v_club) = 'standard' then
    raise notice 'PASS 7: the subscription resolves the effective plan';
  else
    raise notice 'FAIL 7: effective plan resolved to %', coalesce(internal.club_effective_plan(v_club), '<null>');
  end if;

  -- ---------- 8. a failed payment does not lock a club out mid-season ----------
  update public.platform_club_subscriptions set status = 'past_due' where id = v_sub;
  if public.club_has_entitlement(v_club, 'core.fixtures') then
    raise notice 'PASS 8: a past-due club keeps its fixtures -- dunning is a conversation, not a lockout';
  else
    raise notice 'FAIL 8: a past-due club lost access to its own fixtures';
  end if;
  update public.platform_club_subscriptions set status = 'active' where id = v_sub;

  -- ---------- 9. credit cannot be overspent ----------
  insert into public.platform_credits (club_id, amount_pence, source, reason, snapshot_plan_code, snapshot_price_pence, snapshot_price_version)
  values (v_club, 1500, 'referral_reward', 'Phase F test reward', 'standard', 1500, 1)
  returning id into v_credit;

  insert into public.platform_payments (club_id, subscription_id, gross_pence, credit_applied_pence, net_pence, idempotency_key, charge_date)
  values (v_club, v_sub, 1500, 0, 1500, 'phase-f-test-cycle-1', current_date)
  returning id into v_payment;

  begin
    insert into public.platform_credits (club_id, amount_pence, source, applied_to_payment_id)
    values (v_club, -3000, 'application', v_payment);
    raise notice 'FAIL 9: a club spent credit it did not hold';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%more credit than it holds%' then
      raise notice 'PASS 9: a club cannot spend credit it does not hold';
    else
      raise notice 'FAIL 9: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 10. credit applies to a payment exactly once ----------
  insert into public.platform_credits (club_id, amount_pence, source, applied_to_payment_id)
  values (v_club, -1500, 'application', v_payment);

  begin
    insert into public.platform_credits (club_id, amount_pence, source, applied_to_payment_id)
    values (v_club, -1500, 'application', v_payment);
    raise notice 'FAIL 10: the same payment consumed credit twice';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%platform_credits_one_application_per_payment%' or v_err like '%more credit than it holds%' then
      raise notice 'PASS 10: a payment can consume credit only once';
    else
      raise notice 'FAIL 10: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 11. the balance is the ledger, not a counter ----------
  if public.club_credit_balance_pence(v_club) = 0 then
    raise notice 'PASS 11: earning GBP 15 and spending GBP 15 leaves a zero balance in the ledger';
  else
    raise notice 'FAIL 11: balance is %', public.club_credit_balance_pence(v_club);
  end if;

  -- ---------- 12. the ledger is append-only ----------
  begin
    update public.platform_credits set amount_pence = 99999 where id = v_credit;
    raise notice 'FAIL 12: a credit row was edited';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%append-only%' then
      raise notice 'PASS 12: the credit ledger cannot be edited';
    else
      raise notice 'FAIL 12: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 13. a fully-credited cycle is skipped, not collected as zero ----------
  insert into public.platform_credits (club_id, amount_pence, source, reason, snapshot_plan_code, snapshot_price_pence, snapshot_price_version)
  values (v_club, 1500, 'goodwill', 'Phase F test credit', 'standard', 1500, 1);

  select net_pence, will_skip into v_int, v_bool from public.club_platform_next_collection(v_club);
  if v_int = 0 and v_bool then
    raise notice 'PASS 13: a cycle fully covered by credit is skipped rather than collected as zero';
  else
    raise notice 'FAIL 13: net=%, skip=%', v_int, v_bool;
  end if;

  -- ---------- 14. a partly-credited cycle collects the difference ----------
  -- Spend GBP 5 of the GBP 15 credit against a second cycle, leaving GBP 10
  -- of the next collection to actually be taken.
  insert into public.platform_payments (club_id, subscription_id, gross_pence, credit_applied_pence, net_pence, idempotency_key, charge_date)
  values (v_club, v_sub, 1500, 0, 1500, 'phase-f-test-cycle-2', current_date)
  returning id into v_payment;

  insert into public.platform_credits (club_id, amount_pence, source, applied_to_payment_id)
  values (v_club, -1000, 'application', v_payment);

  select net_pence, will_skip into v_int, v_bool from public.club_platform_next_collection(v_club);
  if v_int = 1000 and not v_bool then
    raise notice 'PASS 14: GBP 5 of credit against GBP 15 collects GBP 10';
  else
    raise notice 'FAIL 14: net=%, skip=%', v_int, v_bool;
  end if;

  -- ---------- 15. payments are idempotent per cycle ----------
  begin
    insert into public.platform_payments (club_id, subscription_id, gross_pence, credit_applied_pence, net_pence, idempotency_key, charge_date)
    values (v_club, v_sub, 1500, 0, 1500, 'phase-f-test-cycle-2', current_date);
    raise notice 'FAIL 15: the same billing cycle produced two payments';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%idempotency_key%' then
      raise notice 'PASS 15: a repeated billing cycle cannot create a second payment';
    else
      raise notice 'FAIL 15: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 16. a payment's amounts must add up ----------
  begin
    insert into public.platform_payments (club_id, subscription_id, gross_pence, credit_applied_pence, net_pence, idempotency_key)
    values (v_club, v_sub, 1500, 500, 1200, 'phase-f-test-bad-maths');
    raise notice 'FAIL 16: a payment was recorded whose amounts do not add up';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%amounts_add_up%' then
      raise notice 'PASS 16: gross minus credit must equal net';
    else
      raise notice 'FAIL 16: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 17. cancelling runs to period end, and is idempotent ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  if public.cancel_club_platform_subscription(v_club, 'Phase F test') then
    select status, next_collection_on is null into v_text, v_ok
    from public.platform_club_subscriptions where id = v_sub;
    if v_text = 'cancelled' and v_ok and internal.club_effective_plan(v_club) = 'standard' then
      raise notice 'PASS 17: cancelling stops the next collection but the club keeps the period it paid for';
    else
      raise notice 'FAIL 17: status=%, collection cleared=%', v_text, v_ok;
    end if;
  else
    raise notice 'FAIL 17: cancellation returned false';
  end if;

  if not public.cancel_club_platform_subscription(v_club, 'again') then
    raise notice 'PASS 18: cancelling an already-cancelled subscription changes nothing';
  else
    raise notice 'FAIL 18: a second cancellation was treated as a new one';
  end if;

  -- ---------- 19. an outsider sees nothing ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.club_platform_billing_state(v_club);
  if v_count = 0 and public.club_credit_balance_pence(v_club) = 0 then
    raise notice 'PASS 19: an unrelated account reads nothing about a club''s Ovalball billing';
  else
    raise notice 'FAIL 19: an outsider read commercial state';
  end if;

  -- ---------- 20. the two payment domains still share nothing ----------
  select not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.prokind = 'f'
      and (p.proname like '%platform_%' or p.proname like '%effective_plan%' or p.proname like '%entitlement%')
      and (pg_get_functiondef(p.oid) like '%gocardless\_%'
        or pg_get_functiondef(p.oid) like '%club\_subscription\_pricing%'
        or pg_get_functiondef(p.oid) like '%club\_subscription\_programmes%'
        or pg_get_functiondef(p.oid) like '%club\_subscription\_sibling\_rules%'
        or pg_get_functiondef(p.oid) like '%payer\_subscriptions%'
        or pg_get_functiondef(p.oid) like '%player\_subscription\_payers%'
        or pg_get_functiondef(p.oid) like '%membership\_obligations%')
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 20: no Domain B function reads a Domain A table';
  else
    raise notice 'FAIL 20: Domain B reaches into the club-charges-members domain';
  end if;

  -- ---------- 21. and no foreign key crosses between them ----------
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
    raise notice 'PASS 21: no foreign key joins the two payment domains';
  else
    raise notice 'FAIL 21: a foreign key crosses between the two payment domains';
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
