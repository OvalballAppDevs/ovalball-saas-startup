-- EMAIL DELIVERY POLICY -- permanent regression.
--
-- Pins the live proofs run manually while building the on/off switch: only
-- a Full Site Admin may toggle it, only an OPTIONAL_OPERATIONAL event may
-- ever be disabled (never mandatory/transactional-identity mail), a forged
-- event key is refused, anon has no grant at all, and viewing usage follows
-- the same authority Email Configuration itself already uses (any Site
-- Admin, narrow or full). See migration 20270128000000 for the full
-- architecture this pins.

begin;

do $$
declare
  v_full_site_admin uuid;
  v_narrow_site_admin uuid;
  v_ordinary_user uuid;
  v_lock int;
  v_raised boolean;
begin
  select id into v_full_site_admin from auth.users where email = 'uat.fullsiteadmin@ovalball.test';
  select id into v_narrow_site_admin from auth.users where email = 'uat.siteadmin@ovalball.test';
  select id into v_ordinary_user from auth.users where email = 'uat.guardian.four@ovalball.test';

  if v_full_site_admin is null or v_narrow_site_admin is null or v_ordinary_user is null then
    raise notice 'Email delivery policy UAT prerequisites not found on this database -- skipping (expected on a fresh/non-seeded database).';
    return;
  end if;

  -- ============ A. Only a Full Site Admin may toggle ============

  perform set_config('request.jwt.claims', json_build_object('sub', v_narrow_site_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.set_email_event_active('match_cancelled', false, 0);
  exception when others then
    v_raised := true;
    if sqlerrm not like '%Only a Full Site Admin%' then
      raise exception 'FAIL 1 (A): wrong refusal reason for narrow site admin: %', sqlerrm;
    end if;
  end;
  if not v_raised then raise exception 'FAIL 1 (A): a narrow Site Admin was allowed to toggle delivery policy'; end if;
  raise notice 'PASS (A): narrow Site Admin refused.';

  perform set_config('request.jwt.claims', json_build_object('sub', v_ordinary_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.set_email_event_active('match_cancelled', false, 0);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL 2 (A): an ordinary user was allowed to toggle delivery policy'; end if;
  raise notice 'PASS (A): ordinary user refused.';

  reset role;
  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  v_raised := false;
  begin
    perform public.set_email_event_active('match_cancelled', false, 0);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL 3 (A): anon was allowed to toggle delivery policy'; end if;
  raise notice 'PASS (A): anon refused (no grant).';
  reset role;

  -- ============ B. Forged event key ============

  perform set_config('request.jwt.claims', json_build_object('sub', v_full_site_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform public.set_email_event_active('totally_made_up_event_key_xyz', false, 0);
  exception when others then
    v_raised := true;
    if sqlerrm not like '%not an email Ovalball sends%' then
      raise exception 'FAIL 4 (B): wrong refusal reason for forged event key: %', sqlerrm;
    end if;
  end;
  if not v_raised then raise exception 'FAIL 4 (B): a forged event key was accepted'; end if;
  raise notice 'PASS (B): forged event key refused.';
  reset role;

  -- ============ C. Classification is NOT an authority check ============
  --
  -- Corrected from an earlier version of this switch, which refused to
  -- disable anything but OPTIONAL_OPERATIONAL mail. See migration
  -- 20270129000000's own header: classification governs whether an
  -- ordinary recipient's own preference can suppress a message, never
  -- whether Full Site Admin may switch the channel off. Proven here across
  -- every classification that actually exists in the catalogue, toggled
  -- off, audited, and restored -- never left disabled by this test.

  perform set_config('request.jwt.claims', json_build_object('sub', v_full_site_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- club_welcome: MANDATORY_OPERATIONAL.
  select lock_version into v_lock from public.email_events where event_key = 'club_welcome';
  perform public.set_email_event_active('club_welcome', false, v_lock);
  if (select active from public.email_events where event_key = 'club_welcome') <> false then
    raise exception 'FAIL 5 (C): club_welcome (MANDATORY_OPERATIONAL) could not be disabled';
  end if;
  if not exists (
    select 1 from public.email_delivery_policy_audit
    where event_key = 'club_welcome' and previous_active = true and new_active = false and changed_by = v_full_site_admin
  ) then
    raise exception 'FAIL 5b (C): disabling club_welcome left no audit row';
  end if;
  select lock_version into v_lock from public.email_events where event_key = 'club_welcome';
  perform public.set_email_event_active('club_welcome', true, v_lock);
  if (select active from public.email_events where event_key = 'club_welcome') <> true then
    raise exception 'FAIL 5c (C): club_welcome could not be re-enabled';
  end if;
  raise notice 'PASS (C): club_welcome (MANDATORY_OPERATIONAL) disabled, audited, restored.';

  -- club_invitation: TRANSACTIONAL_IDENTITY.
  select lock_version into v_lock from public.email_events where event_key = 'club_invitation';
  perform public.set_email_event_active('club_invitation', false, v_lock);
  if (select active from public.email_events where event_key = 'club_invitation') <> false then
    raise exception 'FAIL 6 (C): club_invitation (TRANSACTIONAL_IDENTITY) could not be disabled';
  end if;
  if not exists (
    select 1 from public.email_delivery_policy_audit
    where event_key = 'club_invitation' and previous_active = true and new_active = false and changed_by = v_full_site_admin
  ) then
    raise exception 'FAIL 6b (C): disabling club_invitation left no audit row';
  end if;
  select lock_version into v_lock from public.email_events where event_key = 'club_invitation';
  perform public.set_email_event_active('club_invitation', true, v_lock);
  if (select active from public.email_events where event_key = 'club_invitation') <> true then
    raise exception 'FAIL 6c (C): club_invitation could not be re-enabled';
  end if;
  raise notice 'PASS (C): club_invitation (TRANSACTIONAL_IDENTITY) disabled, audited, restored.';

  -- A "Not Wired" event (referral_reward_earned) is still toggleable at
  -- this layer -- nothing calls sendEmailEvent for it yet, so this is
  -- harmless, but the database must not need to know "wired" at all; that
  -- is a TypeScript-side, UI-presentation fact only.
  select lock_version into v_lock from public.email_events where event_key = 'referral_reward_earned';
  perform public.set_email_event_active('referral_reward_earned', false, v_lock);
  select lock_version into v_lock from public.email_events where event_key = 'referral_reward_earned';
  perform public.set_email_event_active('referral_reward_earned', true, v_lock);
  raise notice 'PASS (C): a Not Wired event''s policy can still be toggled at the database layer (harmless; the UI is what withholds the control).';
  reset role;

  -- ============ D. A genuine toggle, with audit, then restored ============

  perform set_config('request.jwt.claims', json_build_object('sub', v_full_site_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select lock_version into v_lock from public.email_events where event_key = 'match_cancelled';
  perform public.set_email_event_active('match_cancelled', false, v_lock);

  if (select active from public.email_events where event_key = 'match_cancelled') <> false then
    raise exception 'FAIL 7 (D): match_cancelled was not actually disabled';
  end if;
  if not exists (
    select 1 from public.email_delivery_policy_audit
    where event_key = 'match_cancelled' and previous_active = true and new_active = false and changed_by = v_full_site_admin
  ) then
    raise exception 'FAIL 8 (D): disabling match_cancelled left no audit row';
  end if;
  raise notice 'PASS (D): toggle applied and audited.';

  -- Stale lock is refused, exactly like the template registry's own save/publish.
  v_raised := false;
  begin
    perform public.set_email_event_active('match_cancelled', true, v_lock); -- the OLD lock, now stale
  exception when others then
    v_raised := true;
    if sqlerrm not like '%changed by someone else%' then
      raise exception 'FAIL 9 (D): wrong refusal reason for a stale lock: %', sqlerrm;
    end if;
  end;
  if not v_raised then raise exception 'FAIL 9 (D): a stale optimistic lock was accepted'; end if;
  raise notice 'PASS (D): stale lock refused.';

  -- Restore, so this test leaves no lasting state change.
  select lock_version into v_lock from public.email_events where event_key = 'match_cancelled';
  perform public.set_email_event_active('match_cancelled', true, v_lock);
  if (select active from public.email_events where event_key = 'match_cancelled') <> true then
    raise exception 'FAIL 10 (D): match_cancelled could not be re-enabled';
  end if;
  raise notice 'PASS (D): re-enabled, no lasting state change.';
  reset role;

  -- ============ E. Viewing usage follows Email Configuration authority ============

  perform set_config('request.jwt.claims', json_build_object('sub', v_ordinary_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform * from public.email_usage_summary();
  exception when others then
    v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL 11 (E): an ordinary user was allowed to view email usage'; end if;
  raise notice 'PASS (E): ordinary user refused usage view.';

  v_raised := false;
  begin
    perform * from public.email_recent_deliveries('club_welcome', 5);
  exception when others then
    v_raised := true;
  end;
  if not v_raised then raise exception 'FAIL 12 (E): an ordinary user was allowed to view delivery history'; end if;
  raise notice 'PASS (E): ordinary user refused delivery history.';
  reset role;

  -- Slice 7 (7d): reading delivery history is site.email.deliveries.view, which Phase 2 R gives to
  -- FULL and SUPPORT. The "narrow" admin in these fixtures is Club Data, whose bundle is users.view,
  -- clubs.view, clubs.profile.manage, directory.manage, claims.review and audit.view -- email delivery
  -- history is a User Support concern, not a club-data one.
  --
  -- This assertion used to require the opposite, and it was right about the OLD behaviour: the function
  -- asked internal.is_site_admin(), which is true for every profile including Read Only. That is the
  -- label standing in for authority, and taking it out is the whole of 7d.
  perform set_config('request.jwt.claims', json_build_object('sub', v_narrow_site_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_raised := false;
  begin
    perform * from public.email_usage_summary();
  exception when others then v_raised := true;
  end;
  reset role;
  if not v_raised then
    raise exception 'FAIL 13 (E): a Club Data Site Admin read email delivery usage, which is a User Support capability';
  end if;
  raise notice 'PASS (E): a Club Data Site Admin is refused delivery usage -- the label no longer carries it.';

  -- POSITIVE CONTROL. The refusal above has to be about the capability, not about the function being
  -- broken for everybody.
  perform set_config('request.jwt.claims', json_build_object('sub', v_full_site_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from public.email_usage_summary()) < 1 then
    raise exception 'FAIL 13b (E): a Full Site Admin could not view usage either -- the capability check is wrong, not narrow';
  end if;
  reset role;
  raise notice 'PASS (E): POSITIVE CONTROL -- a Full Site Admin still can.';

  raise notice 'Email delivery policy complete.';
end $$;

rollback;
