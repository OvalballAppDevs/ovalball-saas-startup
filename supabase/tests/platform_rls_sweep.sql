-- Phase M -- a role-switched sweep across every commercial table.
--
-- Phase H recorded a test bug worth generalising: an access assertion run
-- from this project's own psql session proves nothing, because that session
-- is `postgres`, which BYPASSES row-level security entirely. Several
-- earlier assertions were safe only because they went through a
-- SECURITY DEFINER function with its own capability check.
--
-- This suite makes no such assumption. Every read below runs as the
-- `authenticated` role, which is what a browser session actually is.

begin;

do $$
declare
  v_outsider uuid := gen_random_uuid();
  v_club_admin uuid := gen_random_uuid();
  v_dir uuid;
  v_club uuid;
  v_sub uuid;
  v_payment uuid;
  v_count int;
  v_leaks text[] := array[]::text[];
  v_table text;
  v_ok boolean;
begin
  -- ---------- fixtures: one club with a full commercial history ----------
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_outsider,   'sweepoutsider@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_club_admin, 'sweepadmin@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Sweep Test RUFC', 'union', 'England', 'England', 'manual', 'verified', 'sweep-test-rufc')
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status)
  values (v_dir, 'sweep-test-rufc', 'active') returning id into v_club;
  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club, v_club_admin, 'CLUB_ADMIN', 'active');

  insert into public.platform_trials (club_id, accruing_since, status) values (v_club, now(), 'active');

  insert into public.platform_club_subscriptions
    (club_id, plan_code, plan_price_pence, plan_currency, plan_price_version, status,
     provider, provider_environment, provider_mandate_id, mandate_status)
  values (v_club, 'standard', 1500, 'GBP', 1, 'active', 'gocardless', 'sandbox', 'MD_SWEEP', 'active')
  returning id into v_sub;

  insert into public.platform_subscription_events (club_id, subscription_id, event_type, new_status)
  values (v_club, v_sub, 'plan_selected', 'pending_setup');

  insert into public.platform_payments (club_id, subscription_id, gross_pence, credit_applied_pence, net_pence, idempotency_key)
  values (v_club, v_sub, 1500, 0, 1500, 'sweep-cycle-1') returning id into v_payment;

  insert into public.platform_credits (club_id, amount_pence, source, reason, snapshot_plan_code, snapshot_price_pence, snapshot_price_version)
  values (v_club, 1500, 'goodwill', 'Sweep fixture', 'standard', 1500, 1);

  insert into public.platform_provider_events (provider_event_id, resource_type, action, payload)
  values ('EV_SWEEP_1', 'payments', 'confirmed', '{"id":"EV_SWEEP_1"}'::jsonb);

  -- ---------- 1. every commercial table has RLS enabled ----------
  select array_agg(c.relname order by c.relname) into v_leaks
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname like 'platform\_%'
    and not c.relrowsecurity;

  if v_leaks is null then
    raise notice 'PASS 1: row-level security is enabled on every platform_ table';
  else
    raise notice 'FAIL 1: RLS is off for %', array_to_string(v_leaks, ', ');
  end if;

  -- ---------- 2. none of them takes a direct write from a browser role ----------
  select array_agg(distinct c.relname order by c.relname) into v_leaks
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'platform_trials', 'platform_club_subscriptions', 'platform_payments',
      'platform_credits', 'platform_subscription_events', 'platform_referrals',
      'platform_mode_events', 'platform_provider_events'
    )
    and p.polcmd in ('a', 'w', 'd');

  if v_leaks is null then
    raise notice 'PASS 2: no money table accepts a direct INSERT, UPDATE or DELETE -- every transition is a function';
  else
    raise notice 'FAIL 2: direct-write policies exist on %', array_to_string(v_leaks, ', ');
  end if;

  -- ---------- 3. an unrelated signed-in account reads nothing ----------
  -- This is the assertion that needs the role switch: as postgres it would
  -- pass whatever the policies said.
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select
      (select count(*) from public.platform_trials)
    + (select count(*) from public.platform_club_subscriptions)
    + (select count(*) from public.platform_payments)
    + (select count(*) from public.platform_credits)
    + (select count(*) from public.platform_subscription_events)
    + (select count(*) from public.platform_referrals)
    + (select count(*) from public.platform_mode_events)
    + (select count(*) from public.platform_provider_events)
  into v_count;

  perform set_config('role', 'postgres', true);

  if v_count = 0 then
    raise notice 'PASS 3: an unrelated signed-in account sees no commercial row of any kind';
  else
    raise notice 'FAIL 3: an outsider could read % commercial rows', v_count;
  end if;

  -- ---------- 4. the club's own admin sees its own rows ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select
      (select count(*) from public.platform_trials)
    + (select count(*) from public.platform_club_subscriptions)
    + (select count(*) from public.platform_payments)
    + (select count(*) from public.platform_credits)
  into v_count;

  perform set_config('role', 'postgres', true);

  if v_count = 4 then
    raise notice 'PASS 4: the club''s own admin sees exactly its own four commercial rows';
  else
    raise notice 'FAIL 4: the club admin saw % rows, expected 4', v_count;
  end if;

  -- ---------- 5. even its own admin cannot read raw provider payloads ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v_count from public.platform_provider_events;
  perform set_config('role', 'postgres', true);

  if v_count = 0 then
    raise notice 'PASS 5: provider payloads are Site Admin only, even for the club they concern';
  else
    raise notice 'FAIL 5: a Club Admin read % raw provider events', v_count;
  end if;

  -- ---------- 6. plans and entitlements are public, deliberately ----------
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  select (select count(*) from public.platform_plans) + (select count(*) from public.platform_entitlements)
  into v_count;
  perform set_config('role', 'postgres', true);

  if v_count > 0 then
    raise notice 'PASS 6: a signed-out visitor can read plans and what they include -- a pricing page needs no session';
  else
    raise notice 'FAIL 6: plans are not publicly readable, so a pricing page cannot render';
  end if;

  -- ---------- 7. but a signed-out visitor reads no club's money ----------
  perform set_config('role', 'anon', true);
  select
      (select count(*) from public.platform_trials)
    + (select count(*) from public.platform_club_subscriptions)
    + (select count(*) from public.platform_payments)
    + (select count(*) from public.platform_credits)
    + (select count(*) from public.platform_referrals)
  into v_count;
  perform set_config('role', 'postgres', true);

  if v_count = 0 then
    raise notice 'PASS 7: a signed-out visitor sees no club''s commercial data';
  else
    raise notice 'FAIL 7: anon could read % commercial rows', v_count;
  end if;

  -- ---------- 8. every commercial table is audited ----------
  v_leaks := array[]::text[];
  foreach v_table in array array[
    'platform_trials', 'platform_club_subscriptions', 'platform_payments',
    'platform_credits', 'platform_subscription_events', 'platform_referrals',
    'platform_mode_events', 'platform_releases', 'platform_plans',
    'platform_entitlements', 'platform_plan_entitlements', 'platform_provider_events'
  ] loop
    if not exists (
      select 1 from pg_trigger t
      where t.tgrelid = ('public.' || v_table)::regclass
        and not t.tgisinternal
        and t.tgfoid = 'internal.audit_row_change'::regproc
    ) then
      v_leaks := v_leaks || v_table;
    end if;
  end loop;

  if array_length(v_leaks, 1) is null then
    raise notice 'PASS 8: every commercial table writes to the audit log';
  else
    raise notice 'FAIL 8: no audit trigger on %', array_to_string(v_leaks, ', ');
  end if;

  -- ---------- 9. the append-only tables really are ----------
  v_leaks := array[]::text[];
  foreach v_table in array array['platform_mode_events', 'platform_credits', 'platform_subscription_events'] loop
    if not exists (
      select 1 from pg_trigger t
      where t.tgrelid = ('public.' || v_table)::regclass
        and not t.tgisinternal
        and (t.tgtype & 16) <> 0   -- UPDATE
        and (t.tgtype & 8) <> 0    -- DELETE
    ) then
      v_leaks := v_leaks || v_table;
    end if;
  end loop;

  if array_length(v_leaks, 1) is null then
    raise notice 'PASS 9: every append-only table blocks UPDATE and DELETE with a trigger, not just a missing policy';
  else
    raise notice 'FAIL 9: % can be altered by anything that bypasses RLS', array_to_string(v_leaks, ', ');
  end if;

  -- ---------- 10. the wall between the two payment domains ----------
  select not exists (
    select 1
    from pg_constraint c
    join pg_class src on src.oid = c.conrelid
    join pg_class tgt on tgt.oid = c.confrelid
    where c.contype = 'f'
      and (
        (src.relname like 'platform\_%' and (tgt.relname like 'gocardless\_%' or tgt.relname like 'club\_subscription\_%' or tgt.relname in ('membership_obligations', 'payer_subscriptions', 'player_subscription_payers')))
        or
        (tgt.relname like 'platform\_%' and (src.relname like 'gocardless\_%' or src.relname like 'club\_subscription\_%' or src.relname in ('membership_obligations', 'payer_subscriptions', 'player_subscription_payers')))
      )
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 10: no foreign key joins Ovalball-charges-clubs to club-charges-members';
  else
    raise notice 'FAIL 10: a foreign key crosses between the two payment domains';
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
