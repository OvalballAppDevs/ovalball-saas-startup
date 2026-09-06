-- Phase E -- plans and entitlements.
--
-- The invariants: Pro cannot be sold while it is Coming Soon; essential
-- safety entitlements can never be put behind a plan; entitlements are
-- resolved on the server from one function; and a price change cannot
-- rewrite what a club was historically charged.

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_club_admin uuid := gen_random_uuid();
  v_dir uuid;
  v_club uuid;
  v_version int;
  v_count int;
  v_err text;
  v_ok boolean;
  v_plan text;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_owner,      'planowner@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_club_admin, 'planadmin@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.site_admins (user_id, admin_role, status) values (v_owner, 'full', 'active');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Plan Test Club', 'union', 'England', 'England', 'manual', 'verified', 'plan-test-club')
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status)
  values (v_dir, 'plan-test-club', 'active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club, v_club_admin, 'CLUB_ADMIN', 'active');

  -- ---------- 1. the two plans exist at the intended prices ----------
  select count(*) into v_count from public.platform_plans
  where (code = 'standard' and price_pence = 1500 and currency = 'GBP' and billing_interval = 'month')
     or (code = 'pro' and price_pence = 2500 and currency = 'GBP' and billing_interval = 'month');
  if v_count = 2 then
    raise notice 'PASS 1: Standard is GBP 15 a month and Pro is GBP 25 a month';
  else
    raise notice 'FAIL 1: expected two plans at the intended prices, found %', v_count;
  end if;

  -- ---------- 2. Pro is Coming Soon and cannot be bought ----------
  select status = 'coming_soon' and purchasable = false into v_ok
  from public.platform_plans where code = 'pro';
  if v_ok then
    raise notice 'PASS 2: Pro is Coming Soon and not purchasable';
  else
    raise notice 'FAIL 2: Pro is exposed for sale without a premium feature to sell';
  end if;

  -- ---------- 3. a Coming Soon plan cannot be made buyable ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin
    perform public.set_platform_plan_terms('pro', null, null, true);
    raise notice 'FAIL 3: a Coming Soon plan was made purchasable';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%purchasable_only_when_available%' then
      raise notice 'PASS 3: a plan cannot be sold without also being made available';
    else
      raise notice 'FAIL 3: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 4. opening Pro properly works ----------
  perform public.set_platform_plan_terms('pro', null, 'available', true);
  select purchasable into v_ok from public.platform_plans where code = 'pro';
  if v_ok then
    raise notice 'PASS 4: Pro can be opened when its status is changed with it';
  else
    raise notice 'FAIL 4: Pro did not open';
  end if;
  perform public.set_platform_plan_terms('pro', null, 'coming_soon', false);

  -- ---------- 5. a price change bumps the version ----------
  select price_version into v_count from public.platform_plans where code = 'standard';
  v_version := public.set_platform_plan_terms('standard', 1600);
  if v_version = v_count + 1 then
    raise notice 'PASS 5: changing a price bumps price_version, so historical snapshots stay findable';
  else
    raise notice 'FAIL 5: price_version went % -> %', v_count, v_version;
  end if;

  -- A change that is not a price change must not bump it.
  v_version := public.set_platform_plan_terms('standard', 1600);
  if v_version = v_count + 1 then
    raise notice 'PASS 6: rewriting the same price does not bump the version';
  else
    raise notice 'FAIL 6: version bumped on a no-op price write';
  end if;
  perform public.set_platform_plan_terms('standard', 1500);

  -- ---------- 7. only site.commercial.manage may change terms ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.set_platform_plan_terms('standard', 1);
    raise notice 'FAIL 7: a Club Admin rewrote Ovalball''s own pricing';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%Not authorized%' then
      raise notice 'PASS 7: a Club Admin cannot change Ovalball plan terms';
    else
      raise notice 'FAIL 7: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 8. essential entitlements cannot be put behind a plan ----------
  begin
    insert into public.platform_plan_entitlements (plan_code, entitlement_key)
    values ('pro', 'safety.safeguarding');
    raise notice 'FAIL 8: safeguarding was attached to a paid plan';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%essential%' then
      raise notice 'PASS 8: an essential entitlement cannot be attached to a plan';
    else
      raise notice 'FAIL 8: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 9. a club with no trial and no subscription has no plan ----------
  if internal.club_effective_plan(v_club) is null then
    raise notice 'PASS 9: a club with neither trial nor subscription is on no plan';
  else
    raise notice 'FAIL 9: a club was given a plan it never took';
  end if;

  -- ---------- 10. but still has every essential entitlement ----------
  select count(*) into v_count from public.club_entitlements(v_club) where source = 'essential';
  if v_count = (select count(*) from public.platform_entitlements where not gateable) and v_count > 0 then
    raise notice 'PASS 10: safety entitlements reach a club on no plan at all -- % of them', v_count;
  else
    raise notice 'FAIL 10: % essential entitlements resolved', v_count;
  end if;

  if public.club_has_entitlement(v_club, 'safety.safeguarding')
     and not public.club_has_entitlement(v_club, 'core.fixtures') then
    raise notice 'PASS 11: safeguarding is granted and a paid feature is not';
  else
    raise notice 'FAIL 11: entitlement resolution is wrong for a club on no plan';
  end if;

  -- ---------- 12. a trial resolves to the Standard product ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_platform_mode('live', 'Phase E test setup');
  perform public.start_club_trial(v_club);

  v_plan := internal.club_effective_plan(v_club);
  if v_plan = 'standard' then
    raise notice 'PASS 12: a club on trial has the Standard product';
  else
    raise notice 'FAIL 12: a club on trial resolved to %', coalesce(v_plan, '<null>');
  end if;

  if public.club_has_entitlement(v_club, 'core.fixtures')
     and public.club_has_entitlement(v_club, 'core.messaging')
     and public.club_has_entitlement(v_club, 'safety.audit') then
    raise notice 'PASS 13: the trial grants the core product and the essentials together';
  else
    raise notice 'FAIL 13: the trial did not grant the expected entitlements';
  end if;

  -- ---------- 14. a paused trial still resolves ----------
  perform public.pause_club_trial(v_club, 'admin');
  if internal.club_effective_plan(v_club) = 'standard' then
    raise notice 'PASS 14: pausing a trial does not switch the product off';
  else
    raise notice 'FAIL 14: a paused trial lost its plan';
  end if;

  -- ---------- 15. no unknown entitlement is ever granted ----------
  if not public.club_has_entitlement(v_club, 'pro.advanced_analytics') then
    raise notice 'PASS 15: an entitlement that does not exist is never granted';
  else
    raise notice 'FAIL 15: an unregistered entitlement key resolved as granted';
  end if;

  -- ---------- 16. Pro grants nothing Standard does not ----------
  select not exists (
    select entitlement_key from public.platform_plan_entitlements where plan_code = 'pro'
    except
    select entitlement_key from public.platform_plan_entitlements where plan_code = 'standard'
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 16: Pro includes nothing Standard does not -- which is why it is not for sale';
  else
    raise notice 'FAIL 16: Pro has entitlements Standard lacks, so its Coming Soon status is now wrong';
  end if;

  -- ---------- 17. no plan gating leaks into the club-charges-members domain ----------
  select not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.prokind = 'f'
      and (p.proname like '%entitlement%' or p.proname like '%effective_plan%' or p.proname like '%platform_plan%')
      and (pg_get_functiondef(p.oid) like '%gocardless%'
        or pg_get_functiondef(p.oid) like '%club_subscription_pricing%'
        or pg_get_functiondef(p.oid) like '%club_subscription_programmes%'
        or pg_get_functiondef(p.oid) like '%club_subscription_sibling_rules%'
        or pg_get_functiondef(p.oid) like '%payer_subscriptions%'
        or pg_get_functiondef(p.oid) like '%player_subscription_payers%'
        or pg_get_functiondef(p.oid) like '%membership_obligations%'
        or pg_get_functiondef(p.oid) like '%calculate_member_price%')
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 17: the entitlement resolver never reads the club-charges-members domain';
  else
    raise notice 'FAIL 17: plan resolution reaches into the club-charges-members domain';
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
