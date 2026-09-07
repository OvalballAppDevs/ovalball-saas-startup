-- Referral reward semantics: the free month, and its accounting.
--
-- Ovalball's published Referral Terms promise: "one month of the referring
-- club's own plan, at the price that plan cost at the moment the reward was
-- earned. That value is recorded then and is not recalculated afterwards."
--
-- Everything below pins that ONE programme end to end, because the Site
-- Admin Dashboard reports it and a dashboard that disagrees with the terms
-- is a commercial integrity defect, not a display bug.
--
-- The specific failure that motivated this file: a reward credit existed
-- holding GBP 29.00 against the Standard plan, whose real price is GBP
-- 15.00, with no snapshot recorded at all. Nothing in the schema forbade
-- it, and the dashboard reported it as real earned money.
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Referral reward semantics: the free month and its accounting ==='

begin;

do $$
declare
  v_site uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_dir_ref uuid; v_dir_new uuid;
  v_club_ref uuid; v_club_new uuid;
  v_inv uuid;
  v_referral uuid;
  v_sub uuid;
  v_payment uuid;
  v_payment2 uuid;
  v_credit uuid;
  v_plan_price int;
  v_count int;
  v_amount int;
  v_months int;
begin
  select price_pence into v_plan_price from public.platform_plans where code = 'standard';

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_site, 'rrs-site-' || v_site::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_admin, 'rrs-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_site, 'RRS', 'Site', 'rrs-site-' || v_site::text || '@ovalball.test'),
    (v_admin, 'RRS', 'Admin', 'rrs-admin-' || v_admin::text || '@ovalball.test');
  insert into public.site_admins (user_id, status, admin_role) values (v_site, 'active', 'full');

  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'RRS Referrer RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'rrs-referrer-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_dir_ref;
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'RRS Referred RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'rrs-referred-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_dir_new;

  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_dir_ref, 'rrs-referrer-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club_ref;
  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_dir_new, 'rrs-referred-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club_new;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_ref, v_admin, 'CLUB_ADMIN', 'active');

  -- The referring club must be ON a plan to earn anything (terms: "A club
  -- that is not on a plan when a referral qualifies does not earn a reward").
  insert into public.platform_club_subscriptions (club_id, plan_code, plan_price_pence, plan_price_version, status, started_at, provider_mandate_id)
  select v_club_ref, 'standard', p.price_pence, p.price_version, 'active', now(), 'MD_RRS_REF' from public.platform_plans p where p.code = 'standard';

  insert into public.club_ovalball_invitations (id, inviting_club_id, club_directory_id, contact_name, contact_email, invited_by, status, accepted_at)
  values (gen_random_uuid(), v_club_ref, v_dir_new, 'RRS Contact', 'rrs@ovalball.test', v_admin, 'accepted', now())
  returning id into v_inv;
  insert into public.platform_referrals (id, invitation_id, referring_club_id, referred_club_id, status, attribution_source, created_by)
  values (gen_random_uuid(), v_inv, v_club_ref, v_club_new, 'registered', 'invitation', v_admin)
  returning id into v_referral;

  -- =================================================================
  -- A. Nothing is earned before a payment is actually collected
  -- =================================================================
  select count(*) into v_count from public.platform_credits where club_id = v_club_ref and source = 'referral_reward';
  if v_count = 0 then
    raise notice 'PASS 1 (A): a registered referral with no collected payment has earned no free month';
  else
    raise exception 'FAIL 1 (A): a reward existed before any payment was collected';
  end if;

  -- A submitted-but-not-confirmed payment must earn nothing (terms list this
  -- explicitly as a non-qualifying event).
  insert into public.platform_club_subscriptions (club_id, plan_code, plan_price_pence, plan_price_version, status, started_at, provider_mandate_id)
  select v_club_new, 'standard', p.price_pence, p.price_version, 'active', now(), 'MD_RRS_NEW' from public.platform_plans p where p.code = 'standard'
  returning id into v_sub;
  insert into public.platform_payments (id, club_id, subscription_id, gross_pence, net_pence, status, charge_date, idempotency_key)
  values (gen_random_uuid(), v_club_new, v_sub, v_plan_price, v_plan_price, 'submitted', current_date, 'rrs-p1-' || substr(gen_random_uuid()::text,1,12))
  returning id into v_payment;

  perform internal.qualify_referral_for_payment(v_payment);
  select count(*) into v_count from public.platform_credits where club_id = v_club_ref and source = 'referral_reward';
  if v_count = 0 then
    raise notice 'PASS 2 (A): a submitted-but-uncollected payment earns no free month';
  else
    raise exception 'FAIL 2 (A): an uncollected payment earned a reward';
  end if;

  -- =================================================================
  -- B. A collected first payment earns exactly ONE month, priced from
  --    the referring club's OWN plan, snapshotted
  -- =================================================================
  update public.platform_payments set status = 'confirmed', confirmed_at = now() where id = v_payment;
  select internal.qualify_referral_for_payment(v_payment) into v_credit;

  if v_credit is not null then
    raise notice 'PASS 3 (B): a collected first payment earns a reward';
  else
    raise exception 'FAIL 3 (B): a confirmed first payment earned nothing';
  end if;

  select count(*) into v_count from public.platform_credits where club_id = v_club_ref and source = 'referral_reward';
  if v_count = 1 then
    raise notice 'PASS 4 (B): exactly ONE reward credit -- one qualifying referral is one free month';
  else
    raise exception 'FAIL 4 (B): expected 1 reward credit, found %', v_count;
  end if;

  select amount_pence into v_amount from public.platform_credits where id = v_credit;
  if v_amount = v_plan_price then
    raise notice 'PASS 5 (B): the reward is worth one month of the referring club''s own plan (%p)', v_plan_price;
  else
    raise exception 'FAIL 5 (B): reward is % but the club''s plan month costs %', v_amount, v_plan_price;
  end if;

  select count(*) into v_count from public.platform_credits
  where id = v_credit and snapshot_plan_code is not null
    and snapshot_price_pence = amount_pence and snapshot_price_version is not null;
  if v_count = 1 then
    raise notice 'PASS 6 (B): the price is SNAPSHOTTED on the credit, so it is never recalculated later';
  else
    raise exception 'FAIL 6 (B): the reward credit did not record the plan/price it was valued from';
  end if;

  -- =================================================================
  -- C. A later price change does not alter a reward already earned
  -- =================================================================
  -- The published terms say exactly this. Proven by changing the plan price
  -- and re-reading the credit.
  update public.platform_plans set price_pence = price_pence + 1000, price_version = price_version + 1 where code = 'standard';
  select amount_pence into v_amount from public.platform_credits where id = v_credit;
  if v_amount = v_plan_price then
    raise notice 'PASS 7 (C): raising the plan price left the earned reward at its snapshotted value -- matches the published terms';
  else
    raise exception 'FAIL 7 (C): a price change altered an already-earned reward (% -> %)', v_plan_price, v_amount;
  end if;

  -- =================================================================
  -- D. One referral cannot earn two months (idempotency)
  -- =================================================================
  perform internal.qualify_referral_for_payment(v_payment);
  select count(*) into v_count from public.platform_credits where club_id = v_club_ref and source = 'referral_reward';
  if v_count = 1 then
    raise notice 'PASS 8 (D): re-running qualification on the same payment does not mint a second month';
  else
    raise exception 'FAIL 8 (D): duplicate reward created (% credits)', v_count;
  end if;

  -- A SECOND confirmed payment from the same club is not a first payment.
  insert into public.platform_payments (id, club_id, subscription_id, gross_pence, net_pence, status, charge_date, confirmed_at, idempotency_key)
  values (gen_random_uuid(), v_club_new, v_sub, v_plan_price, v_plan_price, 'confirmed', current_date + 30, now(), 'rrs-p2-' || substr(gen_random_uuid()::text,1,12))
  returning id into v_payment2;
  perform internal.qualify_referral_for_payment(v_payment2);
  select count(*) into v_count from public.platform_credits where club_id = v_club_ref and source = 'referral_reward';
  if v_count = 1 then
    raise notice 'PASS 9 (D): a second collected payment from the same club earns no further month';
  else
    raise exception 'FAIL 9 (D): a repeat payment earned another reward (% credits)', v_count;
  end if;

  -- =================================================================
  -- E. The entitlement belongs to the referring CLUB, not a person
  -- =================================================================
  select count(*) into v_count from public.platform_credits where id = v_credit and club_id = v_club_ref;
  if v_count = 1 then
    raise notice 'PASS 10 (E): the reward is held by the referring club';
  else
    raise exception 'FAIL 10 (E): the reward is not attached to the referring club';
  end if;

  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'platform_credits'
    and column_name in ('user_id', 'person_id', 'profile_id');
  if v_count = 0 then
    raise notice 'PASS 11 (E): the credit ledger has no person column at all -- a reward cannot be owned by an individual';
  else
    raise exception 'FAIL 11 (E): a person-level owner column appeared on the reward ledger';
  end if;

  -- The earned month stays connected to the referral that earned it.
  select count(*) into v_count from public.platform_referrals where id = v_referral and reward_credit_id = v_credit;
  if v_count = 1 then
    raise notice 'PASS 12 (E): the earned month remains linked to the referral that produced it';
  else
    raise exception 'FAIL 12 (E): the reward lost its link to its source referral';
  end if;

  -- =================================================================
  -- F. Months are COUNTED, never divided out of a balance
  -- =================================================================
  -- The dashboard's "free months earned" is count(qualified). Prove that is
  -- exact and independent of any price, by checking it still holds after the
  -- price change made in C.
  select count(*) into v_months from public.platform_referrals
  where referring_club_id = v_club_ref and status = 'qualified';
  if v_months = 1 then
    raise notice 'PASS 13 (F): free months earned = count of qualified referrals = 1, unaffected by the price change';
  else
    raise exception 'FAIL 13 (F): month count is %', v_months;
  end if;

  -- Dividing the balance by the CURRENT price would now give the wrong
  -- answer -- which is exactly why the dashboard must not do it.
  select price_pence into v_amount from public.platform_plans where code = 'standard';
  if (v_plan_price::numeric / v_amount) <> 1 then
    raise notice 'PASS 14 (F): balance/current-price would now yield %, not 1 -- confirming division is unsafe', round(v_plan_price::numeric / v_amount, 3);
  else
    raise exception 'FAIL 14 (F): the price change did not take effect, so this check proves nothing';
  end if;

  -- =================================================================
  -- G. Reversal withdraws the month but keeps the history
  -- =================================================================
  perform internal.reverse_referral_for_payment(v_payment);

  select count(*) into v_count from public.platform_referrals where id = v_referral and status = 'reversed';
  if v_count = 1 then
    raise notice 'PASS 15 (G): a reversed qualifying payment moves the referral to reversed';
  else
    raise exception 'FAIL 15 (G): the referral was not marked reversed';
  end if;

  select count(*) into v_count from public.platform_credits where reverses_credit_id = v_credit;
  if v_count = 1 then
    raise notice 'PASS 16 (G): the withdrawal is a compensating entry, not a deletion';
  else
    raise exception 'FAIL 16 (G): expected exactly one reversing credit, found %', v_count;
  end if;

  select count(*) into v_count from public.platform_credits where id = v_credit;
  if v_count = 1 then
    raise notice 'PASS 17 (G): the original earning entry still exists -- history shows both earned and taken back';
  else
    raise exception 'FAIL 17 (G): the original reward row was destroyed';
  end if;

  -- Net entitlement is zero, and the ledger balance agrees.
  select coalesce(sum(amount_pence), 0) into v_amount from public.platform_credits where club_id = v_club_ref;
  if v_amount = 0 then
    raise notice 'PASS 18 (G): after withdrawal the club''s credit balance is back to zero';
  else
    raise exception 'FAIL 18 (G): balance after reversal is %', v_amount;
  end if;

  -- =================================================================
  -- H. A reward cannot be worth something its snapshot does not support
  -- =================================================================
  begin
    insert into public.platform_credits (club_id, amount_pence, currency, source, reason, snapshot_plan_code)
    values (v_club_ref, 9900, 'GBP', 'referral_reward', 'fabricated', 'standard');
    raise exception 'FAIL 19 (H): a reward credit with no snapshotted price was accepted';
  exception when check_violation then
    raise notice 'PASS 19 (H): a reward credit with no snapshotted price is refused';
  end;

  begin
    insert into public.platform_credits (club_id, amount_pence, currency, source, reason, snapshot_plan_code, snapshot_price_pence, snapshot_price_version)
    values (v_club_ref, 9900, 'GBP', 'referral_reward', 'fabricated', 'standard', 1500, 1);
    raise exception 'FAIL 20 (H): a reward worth more than the price it snapshotted was accepted';
  exception when check_violation then
    raise notice 'PASS 20 (H): a reward whose amount contradicts its own snapshot is refused';
  end;

  -- =================================================================
  -- I. The detector reports what the constraint cannot retrofit
  -- =================================================================
  -- platform_credits is append-only, so pre-existing wrong rows can never be
  -- corrected in place. The detector is how they stay visible.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.referral_reward_integrity_detail();
  raise notice 'PASS 21 (I): the reward integrity detector is callable by a Site Admin (% finding(s) in this database)', v_count;
  reset role;

  -- And is refused to a club admin.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  begin
    perform * from public.referral_reward_integrity_detail();
    raise exception 'FAIL 22 (I): a Club Admin read the reward integrity detector';
  exception when insufficient_privilege then
    raise notice 'PASS 22 (I): the reward integrity detector is Site-Admin-only';
  end;
  reset role;

  raise notice 'Referral reward semantics complete.';
end $$;

rollback;
