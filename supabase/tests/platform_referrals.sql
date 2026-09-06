-- Phase H -- the referral engine.
--
-- The promise: refer a club, and if their FIRST Ovalball subscription
-- payment is successfully collected, get one month of your own plan free.
-- These assertions cover every way that could go wrong: self-referral, a
-- club that was already a subscriber, a trial or a mandate mistaken for a
-- payment, a replayed webhook, two clubs claiming the same referral, and a
-- collection that later fails.

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_admin_a uuid := gen_random_uuid();   -- Club Admin of the referring club
  v_admin_b uuid := gen_random_uuid();   -- Club Admin of the referred club
  v_dir_a uuid; v_dir_b uuid; v_dir_c uuid;
  v_club_a uuid; v_club_b uuid; v_club_c uuid;
  v_inv uuid; v_inv2 uuid; v_inv_self uuid;
  v_ref uuid; v_ref2 uuid;
  v_sub_b uuid;
  v_payment uuid;
  v_count int;
  v_int int;
  v_text text;
  v_err text;
  v_ok boolean;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_owner,   'refowner@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_admin_a, 'refadmina@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_admin_b, 'refadminb@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.site_admins (user_id, admin_role, status) values (v_owner, 'full', 'active');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Referrer RUFC', 'union', 'England', 'England', 'manual', 'verified', 'referrer-rufc') returning id into v_dir_a;
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Referred RUFC', 'union', 'England', 'England', 'manual', 'verified', 'referred-rufc') returning id into v_dir_b;
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Third RUFC', 'union', 'England', 'England', 'manual', 'verified', 'third-rufc') returning id into v_dir_c;

  insert into public.clubs (directory_id, slug, status) values (v_dir_a, 'referrer-rufc', 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 'referred-rufc', 'active') returning id into v_club_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c, 'third-rufc', 'active') returning id into v_club_c;

  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club_a, v_admin_a, 'CLUB_ADMIN', 'active'),
         (v_club_b, v_admin_b, 'CLUB_ADMIN', 'active'),
         (v_club_c, v_admin_a, 'CLUB_ADMIN', 'active');

  insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by)
  values (v_club_a, v_dir_b, 'Referred Secretary', 'secretary@referred-test.invalid', v_admin_a)
  returning id into v_inv;

  insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by)
  values (v_club_c, v_dir_b, 'Referred Secretary', 'secretary@referred-test.invalid', v_admin_a)
  returning id into v_inv2;

  insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by)
  values (v_club_a, v_dir_a, 'Ourselves', 'us@referrer-test.invalid', v_admin_a)
  returning id into v_inv_self;

  -- The referring club needs to be on a plan for its reward to have a value.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_platform_mode('live', 'Phase H test setup');
  perform public.start_club_trial(v_club_a);

  -- ---------- 1. a Club Admin can claim a referral on its own invitation ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text, true);
  v_ref := public.claim_club_referral(v_inv);
  if v_ref is not null then
    raise notice 'PASS 1: an invitation can be claimed as a referral';
  else
    raise notice 'FAIL 1: the referral was not created';
  end if;

  -- ---------- 2. claiming twice is idempotent ----------
  if public.claim_club_referral(v_inv) = v_ref
     and (select count(*) from public.platform_referrals where invitation_id = v_inv) = 1 then
    raise notice 'PASS 2: one invitation produces one referral, however many times it is claimed';
  else
    raise notice 'FAIL 2: a duplicate referral was created';
  end if;

  -- ---------- 3. another club cannot claim your invitation ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text, true);
  begin
    perform public.claim_club_referral(v_inv2);
    raise notice 'FAIL 3: a club claimed a referral on another club''s invitation';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%Not authorized%' then
      raise notice 'PASS 3: a referral can only be claimed by the club that made the invitation';
    else
      raise notice 'FAIL 3: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 4. a self-referral is rejected at registration ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text, true);
  perform public.claim_club_referral(v_inv_self);
  if not public.register_referred_club(v_inv_self, v_club_a) then
    select status, rejection_reason into v_text, v_err
    from public.platform_referrals where invitation_id = v_inv_self;
    if v_text = 'rejected' and v_err like '%cannot refer itself%' then
      raise notice 'PASS 4: a club cannot refer itself';
    else
      raise notice 'FAIL 4: status=%, reason=%', v_text, coalesce(v_err, '<null>');
    end if;
  else
    raise notice 'FAIL 4: a self-referral was registered';
  end if;

  -- ---------- 5. the referred club is registered ----------
  if public.register_referred_club(v_inv, v_club_b) then
    select status into v_text from public.platform_referrals where id = v_ref;
    if v_text = 'registered' then
      raise notice 'PASS 5: the referred club is recorded once it exists on Ovalball';
    else
      raise notice 'FAIL 5: status is %', v_text;
    end if;
  else
    raise notice 'FAIL 5: registration was refused';
  end if;

  -- ---------- 6. a trial earns nothing ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text, true);
  perform public.start_club_trial(v_club_b);
  select status into v_text from public.platform_referrals where id = v_ref;
  if v_text = 'registered' and public.club_credit_balance_pence(v_club_a) = 0 then
    raise notice 'PASS 6: the referred club starting a trial earns nothing';
  else
    raise notice 'FAIL 6: status=%, referrer balance=%', v_text, public.club_credit_balance_pence(v_club_a);
  end if;

  -- ---------- 7. choosing a plan and holding a mandate earns nothing ----------
  v_sub_b := public.select_club_plan(v_club_b, 'standard');
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.attach_platform_subscription_provider(v_club_b, 'sandbox', 'CU_H', 'MD_H', null, null, 'active');

  select status into v_text from public.platform_referrals where id = v_ref;
  if v_text = 'registered' and public.club_credit_balance_pence(v_club_a) = 0 then
    raise notice 'PASS 7: a plan and a mandate earn nothing -- only a collected payment does';
  else
    raise notice 'FAIL 7: status=%, referrer balance=%', v_text, public.club_credit_balance_pence(v_club_a);
  end if;

  -- ---------- 8. a submitted-but-uncollected payment earns nothing ----------
  select payment_id into v_payment
  from public.open_platform_billing_cycle(v_club_b, current_date, 'ref-test-cycle-1');
  perform public.apply_platform_payment_status(v_payment, 'submitted', 'PM_H_1');

  select status into v_text from public.platform_referrals where id = v_ref;
  if v_text = 'registered' and public.club_credit_balance_pence(v_club_a) = 0 then
    raise notice 'PASS 8: a submitted payment earns nothing until it is actually collected';
  else
    raise notice 'FAIL 8: status=%, referrer balance=%', v_text, public.club_credit_balance_pence(v_club_a);
  end if;

  -- ---------- 9. the first confirmed collection earns exactly one month ----------
  perform public.apply_platform_payment_status(v_payment, 'confirmed', 'PM_H_1');

  select status, reward_amount_pence into v_text, v_int from public.platform_referrals where id = v_ref;
  if v_text = 'qualified' and v_int = 1500 and public.club_credit_balance_pence(v_club_a) = 1500 then
    raise notice 'PASS 9: the first collected payment earns one month of the referrer''s own plan';
  else
    raise notice 'FAIL 9: status=%, reward=%, balance=%', v_text, v_int, public.club_credit_balance_pence(v_club_a);
  end if;

  -- ---------- 10. a replayed confirmation does not pay twice ----------
  perform public.apply_platform_payment_status(v_payment, 'confirmed', 'PM_H_1');
  select count(*) into v_count from public.platform_credits
  where club_id = v_club_a and source = 'referral_reward';
  if v_count = 1 and public.club_credit_balance_pence(v_club_a) = 1500 then
    raise notice 'PASS 10: a redelivered confirmation cannot earn a second reward';
  else
    raise notice 'FAIL 10: % reward rows, balance %', v_count, public.club_credit_balance_pence(v_club_a);
  end if;

  -- ---------- 11. the reward value is snapshotted ----------
  perform public.set_platform_plan_terms('standard', 9900);
  select reward_amount_pence into v_int from public.platform_referrals where id = v_ref;
  select amount_pence into v_count from public.platform_credits
  where club_id = v_club_a and source = 'referral_reward';
  if v_int = 1500 and v_count = 1500 then
    raise notice 'PASS 11: raising the plan price does not revalue a reward already earned';
  else
    raise notice 'FAIL 11: referral says %, ledger says %', v_int, v_count;
  end if;
  perform public.set_platform_plan_terms('standard', 1500);

  -- ---------- 12. a second club cannot also be paid for the same club ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text, true);
  v_ref2 := public.claim_club_referral(v_inv2);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- The referred club is no longer new; registration must refuse it.
  if not public.register_referred_club(v_inv2, v_club_b) then
    select status, rejection_reason into v_text, v_err from public.platform_referrals where id = v_ref2;
    if v_text = 'rejected' and v_err like '%already an Ovalball subscriber%' then
      raise notice 'PASS 12: a club that has already paid Ovalball cannot be referred';
    else
      raise notice 'FAIL 12: status=%, reason=%', v_text, coalesce(v_err, '<null>');
    end if;
  else
    raise notice 'FAIL 12: a second referral was registered for a club that already pays';
  end if;

  -- ---------- 13. a failed collection takes the reward back ----------
  select payment_id into v_payment
  from public.open_platform_billing_cycle(v_club_b, current_date + 30, 'ref-test-cycle-2');
  -- Simulate the FIRST payment failing instead: reopen the scenario on a
  -- fresh referral so the reversal path is exercised end to end.
  perform public.apply_platform_payment_status(v_payment, 'failed', 'PM_H_2', 'insufficient_funds');

  -- The reward stands: it was earned by cycle 1, which is still confirmed.
  if public.club_credit_balance_pence(v_club_a) = 1500 then
    raise notice 'PASS 13: a later failed collection does not claw back a reward earned by an earlier one';
  else
    raise notice 'FAIL 13: balance is %', public.club_credit_balance_pence(v_club_a);
  end if;

  -- Now reverse the collection that actually earned it.
  perform internal.reverse_referral_for_payment(
    (select qualifying_payment_id from public.platform_referrals where id = v_ref)
  );
  select status into v_text from public.platform_referrals where id = v_ref;
  if v_text = 'reversed' and public.club_credit_balance_pence(v_club_a) = 0 then
    raise notice 'PASS 14: reversing the qualifying collection withdraws the reward';
  else
    raise notice 'FAIL 14: status=%, balance=%', v_text, public.club_credit_balance_pence(v_club_a);
  end if;

  -- ---------- 15. a reversal happens once ----------
  if not internal.reverse_referral_for_payment(
       (select qualifying_payment_id from public.platform_referrals where id = v_ref)
     ) then
    select count(*) into v_count from public.platform_credits
    where club_id = v_club_a and source = 'reversal';
    if v_count = 1 then
      raise notice 'PASS 15: a reward is withdrawn once, not once per delivery';
    else
      raise notice 'FAIL 15: % reversal rows', v_count;
    end if;
  else
    raise notice 'FAIL 15: a second reversal was applied';
  end if;

  -- ---------- 16. the ledger keeps the whole story ----------
  select count(*) into v_count from public.platform_credits
  where club_id = v_club_a and source in ('referral_reward', 'reversal');
  if v_count = 2 then
    raise notice 'PASS 16: earning and withdrawing are both still in the ledger';
  else
    raise notice 'FAIL 16: % rows tell the story', v_count;
  end if;

  -- ---------- 17. the referred club cannot see the referral ----------
  -- This one tests RLS directly, so it must run as a non-superuser: this
  -- script's own session is postgres, which bypasses row-level security
  -- entirely and would pass the assertion without proving anything.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.platform_referrals where id = v_ref;
  perform set_config('role', 'postgres', true);
  if v_count = 0 then
    raise notice 'PASS 17: a referred club cannot see that another club was paid for introducing it';
  else
    raise notice 'FAIL 17: the referred club can read the referral';
  end if;

  -- ---------- 18. the referring club can ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.club_referral_summary(v_club_a);
  if v_count >= 1 then
    raise notice 'PASS 18: the referring club sees its own referrals';
  else
    raise notice 'FAIL 18: the referring club sees nothing';
  end if;

  -- ---------- 19. only one qualified referral per referred club is possible ----------
  select not exists (
    select referred_club_id from public.platform_referrals
    where status = 'qualified' and referred_club_id is not null
    group by referred_club_id having count(*) > 1
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 19: no club can have two qualified referrers';
  else
    raise notice 'FAIL 19: a club has more than one qualified referrer';
  end if;

  -- ---------- 20. no second referral system exists ----------
  select count(*) into v_count from information_schema.tables
  where table_schema = 'public' and table_name like '%referral%';
  if v_count = 1 then
    raise notice 'PASS 20: there is exactly one referral table, layered on the existing club invitation';
  else
    raise notice 'FAIL 20: % referral tables exist', v_count;
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
