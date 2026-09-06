-- Phase D -- the trial engine.
--
-- The invariant that matters most: a trial is thirty USABLE days. Beta
-- stops the clock and never costs a club a single day, and no transition
-- may double-count time however many times it is retried.
--
-- Elapsed time is simulated by moving `accruing_since` backwards directly,
-- which only this test harness can do -- the table has no INSERT or UPDATE
-- policy, and assertion 15 proves it.

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();       -- Full Site Admin
  v_viewer uuid := gen_random_uuid();      -- Site Admin with view_commercial only
  v_club_admin uuid := gen_random_uuid();  -- Club Admin of club A
  v_outsider uuid := gen_random_uuid();
  v_dir_a uuid;
  v_dir_b uuid;
  v_club_a uuid;
  v_club_b uuid;
  v_trial uuid;
  v_trial2 uuid;
  v_status text;
  v_reason text;
  v_remaining bigint;
  v_before bigint;
  v_after bigint;
  v_consumed bigint;
  v_count int;
  v_err text;
  v_ok boolean;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_owner,      'owner@ovalball-test.invalid',    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_viewer,     'viewer@ovalball-test.invalid',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_club_admin, 'clubadm@ovalball-test.invalid',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_outsider,   'outsider@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.site_admins (user_id, admin_role, status, view_commercial)
  values (v_owner, 'full', 'active', false),
         (v_viewer, 'read_only', 'active', true);

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Trial Test Club A', 'union', 'England', 'England', 'manual', 'verified', 'trial-test-club-a')
  returning id into v_dir_a;
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Trial Test Club B', 'union', 'England', 'England', 'manual', 'verified', 'trial-test-club-b')
  returning id into v_dir_b;

  insert into public.clubs (directory_id, slug, status)
  values (v_dir_a, 'trial-test-club-a', 'active') returning id into v_club_a;
  insert into public.clubs (directory_id, slug, status)
  values (v_dir_b, 'trial-test-club-b', 'active') returning id into v_club_b;

  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club_a, v_club_admin, 'CLUB_ADMIN', 'active');

  -- The platform starts in Beta (the genesis event). Go Live so trials run.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_platform_mode('live', 'Phase D test setup');

  -- ---------- 1. a trial started while Live runs ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  v_trial := public.start_club_trial(v_club_a);
  select status into v_status from public.platform_trials where id = v_trial;
  select remaining_seconds into v_remaining from public.club_trial_state(v_club_a);
  if v_status = 'active' and v_remaining between 2591990 and 2592000 then
    raise notice 'PASS 1: a trial started while Live is active with thirty days remaining';
  else
    raise notice 'FAIL 1: status=%, remaining=%', v_status, v_remaining;
  end if;

  -- ---------- 2. starting again is idempotent ----------
  v_trial2 := public.start_club_trial(v_club_a);
  select count(*) into v_count from public.platform_trials where club_id = v_club_a;
  if v_trial2 = v_trial and v_count = 1 then
    raise notice 'PASS 2: starting an existing trial returns it rather than restarting it';
  else
    raise notice 'FAIL 2: id changed or a second trial row was created (% rows)', v_count;
  end if;

  -- ---------- 3. Beta costs a club nothing ----------
  -- Simulate twelve days already used, leaving eighteen.
  update public.platform_trials set accruing_since = now() - interval '12 days' where club_id = v_club_a;
  select remaining_seconds into v_before from public.club_trial_state(v_club_a);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_platform_mode('beta', 'Phase D test: entering Beta');

  select status, pause_reason, consumed_seconds into v_status, v_reason, v_consumed
  from public.platform_trials where club_id = v_club_a;

  if v_status = 'paused' and v_reason = 'beta' and v_consumed between 1036790 and 1036800 then
    raise notice 'PASS 3: entering Beta paused the trial and folded twelve days into consumed time';
  else
    raise notice 'FAIL 3: status=%, reason=%, consumed=%', v_status, coalesce(v_reason, '<null>'), v_consumed;
  end if;

  -- Ten days of Beta pass. Nothing accrues, because nothing is accruing.
  update public.platform_trials
  set started_at = started_at - interval '10 days'
  where club_id = v_club_a;

  perform public.set_platform_mode('live', 'Phase D test: leaving Beta');
  select status, remaining_seconds into v_status, v_after from public.club_trial_state(v_club_a);

  if v_status = 'active' and abs(v_after - v_before) <= 5 then
    raise notice 'PASS 4: ten days of Beta cost the club nothing -- % seconds before, % after', v_before, v_after;
  else
    raise notice 'FAIL 4: status=%, before=%, after=%', v_status, v_before, v_after;
  end if;

  -- ---------- 5. pausing twice does not double-count ----------
  update public.platform_trials set accruing_since = now() - interval '1 day' where club_id = v_club_a;
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  perform public.pause_club_trial(v_club_a, 'club_request');
  select consumed_seconds into v_consumed from public.platform_trials where club_id = v_club_a;
  perform public.pause_club_trial(v_club_a, 'club_request');
  select consumed_seconds into v_before from public.platform_trials where club_id = v_club_a;
  if v_before = v_consumed then
    raise notice 'PASS 5: pausing an already-paused trial folds in nothing further';
  else
    raise notice 'FAIL 5: consumed went from % to % on a repeated pause', v_consumed, v_before;
  end if;

  -- ---------- 6. Beta does not resume a club's own pause ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_platform_mode('beta', 'Phase D test');
  perform public.set_platform_mode('live', 'Phase D test');
  select status, pause_reason into v_status, v_reason from public.platform_trials where club_id = v_club_a;
  if v_status = 'paused' and v_reason = 'club_request' then
    raise notice 'PASS 6: leaving Beta does not resume a trial the club paused itself';
  else
    raise notice 'FAIL 6: status=%, reason=%', v_status, coalesce(v_reason, '<null>');
  end if;

  -- ---------- 7. a club cannot resume out of a Beta pause ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  perform public.resume_club_trial(v_club_a);  -- back to running
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_platform_mode('beta', 'Phase D test');
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.resume_club_trial(v_club_a);
    raise notice 'FAIL 7: a club resumed itself out of a Beta pause';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%Beta%' then
      raise notice 'PASS 7: a club cannot resume out of a Beta pause';
    else
      raise notice 'FAIL 7: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 8. a trial started during Beta starts paused ----------
  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club_b, v_club_admin, 'CLUB_ADMIN', 'active');
  v_trial2 := public.start_club_trial(v_club_b);
  select status, pause_reason into v_status, v_reason from public.platform_trials where id = v_trial2;
  if v_status = 'paused' and v_reason = 'beta' then
    raise notice 'PASS 8: a trial started during Beta starts paused, burning no days';
  else
    raise notice 'FAIL 8: status=%, reason=%', v_status, coalesce(v_reason, '<null>');
  end if;

  -- ---------- 9. an exhausted trial completes rather than resuming ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_platform_mode('live', 'Phase D test');
  update public.platform_trials
  set consumed_seconds = entitlement_seconds
  where club_id = v_club_b and status = 'paused';
  -- club_b was resumed by leaving Beta; pin it back to a paused, exhausted state
  update public.platform_trials
  set accruing_since = null, pause_reason = 'admin', status = 'paused', consumed_seconds = entitlement_seconds
  where club_id = v_club_b;

  perform internal.resume_trial_row(v_club_b, null);
  select status into v_status from public.platform_trials where club_id = v_club_b;
  if v_status = 'completed' then
    raise notice 'PASS 9: an exhausted trial completes instead of resuming';
  else
    raise notice 'FAIL 9: exhausted trial resumed as %', v_status;
  end if;

  -- ---------- 10. the expiry engine completes and notifies ----------
  update public.platform_trials
  set status = 'active', accruing_since = now() - interval '40 days', pause_reason = null,
      completed_at = null, consumed_seconds = 0, notified_thresholds = '{}'
  where club_id = v_club_a;

  select count(*) into v_count from public.notifications
  where user_id = v_club_admin and type = 'platform_trial_ended';

  if internal.process_due_trials() >= 1 then
    select status into v_status from public.platform_trials where club_id = v_club_a;
    select count(*) into v_before from public.notifications
    where user_id = v_club_admin and type = 'platform_trial_ended';
    if v_status = 'completed' and v_before = v_count + 1 then
      raise notice 'PASS 10: the expiry engine completed the trial and told the Club Admin';
    else
      raise notice 'FAIL 10: status=%, notifications %->%', v_status, v_count, v_before;
    end if;
  else
    raise notice 'FAIL 10: the expiry engine completed nothing';
  end if;

  -- ---------- 11. the expiry engine is idempotent ----------
  if internal.process_due_trials() = 0 then
    raise notice 'PASS 11: a second expiry run completes nothing and sends nothing';
  else
    raise notice 'FAIL 11: the expiry engine completed an already-completed trial';
  end if;

  -- ---------- 12. warnings fire once per threshold ----------
  update public.platform_trials
  set status = 'active', accruing_since = now() - interval '24 days', pause_reason = null,
      completed_at = null, consumed_seconds = 0, notified_thresholds = '{}'
  where club_id = v_club_a;  -- six days left, so the 7-day threshold is due

  perform internal.process_due_trials();
  perform internal.process_due_trials();
  select count(*) into v_count from public.notifications
  where user_id = v_club_admin and type = 'platform_trial_ending_soon' and (data->>'days_remaining')::int = 7;
  if v_count = 1 then
    raise notice 'PASS 12: a threshold warning is sent once, not on every run';
  else
    raise notice 'FAIL 12: % warnings sent for the 7-day threshold', v_count;
  end if;

  -- ---------- 13. extending is Full Site Admin only ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  begin
    perform public.extend_club_trial(v_club_a, 7, 'should not work');
    raise notice 'FAIL 13: a read-only commercial admin extended a trial';
  exception when others then
    get stacked diagnostics v_err = MESSAGE_TEXT;
    if v_err like '%Not authorized%' then
      raise notice 'PASS 13: viewing commercial data does not permit changing it';
    else
      raise notice 'FAIL 13: rejected for the wrong reason -- %', v_err;
    end if;
  end;

  -- ---------- 14. extending revives a completed trial ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  update public.platform_trials
  set status = 'completed', accruing_since = null, pause_reason = null,
      completed_at = now(), consumed_seconds = entitlement_seconds
  where club_id = v_club_a;

  perform public.extend_club_trial(v_club_a, 7, 'Phase D test extension');
  select status, completed_at is null into v_status, v_ok from public.platform_trials where club_id = v_club_a;
  select remaining_seconds into v_remaining from public.club_trial_state(v_club_a);
  if v_status = 'paused' and v_ok and v_remaining = 604800 then
    raise notice 'PASS 14: an extension revives a completed trial with exactly the extra time';
  else
    raise notice 'FAIL 14: status=%, cleared=%, remaining=%', v_status, v_ok, v_remaining;
  end if;

  -- ---------- 15. the table takes no direct writes ----------
  select not exists (
    select 1 from pg_policy
    where polrelid = 'public.platform_trials'::regclass
      and polcmd in ('a', 'w', 'd')
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 15: platform_trials has no INSERT, UPDATE or DELETE policy -- every transition goes through a function';
  else
    raise notice 'FAIL 15: a direct-write policy exists on platform_trials';
  end if;

  -- ---------- 16. an outsider cannot read another club's trial ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.club_trial_state(v_club_a);
  if v_count = 0 then
    raise notice 'PASS 16: an unrelated account reads nothing about a club''s trial';
  else
    raise notice 'FAIL 16: an outsider read a club trial';
  end if;

  -- ---------- 17. the trial engine never touches the other payment domain ----------
  select not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.prokind = 'f'
      and (p.proname like '%trial%' or p.proname like '%platform_mode%')
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
    raise notice 'PASS 17: no trial or mode function reads the club-charges-members domain';
  else
    raise notice 'FAIL 17: the trial engine reaches into the club-charges-members domain';
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
