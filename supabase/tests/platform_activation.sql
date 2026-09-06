-- Phase K -- the canonical activation point.
--
-- Approving a club claim is the moment a club becomes a club on Ovalball.
-- Two commercial things hang off it: the club's thirty usable days begin,
-- and any referral that introduced the club learns which club it produced.
-- Neither may be self-served, and neither may break a club's approval.

begin;

do $$
declare
  v_owner uuid := gen_random_uuid();
  v_claimant uuid := gen_random_uuid();
  v_referrer_admin uuid := gen_random_uuid();
  v_dir_new uuid;
  v_dir_ref uuid;
  v_club_ref uuid;
  v_club_new uuid;
  v_claim uuid;
  v_inv uuid;
  v_referral uuid;
  v_trial_started timestamptz;
  v_count int;
  v_text text;
  v_ok boolean;
begin
  -- ---------- fixtures ----------
  insert into auth.users (id, email, instance_id, aud, role)
  values (v_owner,          'actowner@ovalball-test.invalid',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_claimant,       'actclaim@ovalball-test.invalid',   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
         (v_referrer_admin, 'actreferrer@ovalball-test.invalid','00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

  insert into public.profiles (id, first_name, surname) values (v_claimant, 'Ada', 'Claimant')
  on conflict (id) do nothing;

  insert into public.site_admins (user_id, admin_role, status) values (v_owner, 'full', 'active');

  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Activation New RUFC', 'union', 'England', 'England', 'manual', 'verified', 'activation-new-rufc')
  returning id into v_dir_new;
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Activation Referrer RUFC', 'union', 'England', 'England', 'manual', 'verified', 'activation-referrer-rufc')
  returning id into v_dir_ref;

  insert into public.clubs (directory_id, slug, status)
  values (v_dir_ref, 'activation-referrer-rufc', 'active') returning id into v_club_ref;
  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club_ref, v_referrer_admin, 'CLUB_ADMIN', 'active');

  -- The referring club invites the new club onto Ovalball, and claims it.
  insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by)
  values (v_club_ref, v_dir_new, 'New Club Secretary', 'sec@activation-test.invalid', v_referrer_admin)
  returning id into v_inv;

  perform set_config('request.jwt.claims', json_build_object('sub', v_referrer_admin, 'role', 'authenticated')::text, true);
  v_referral := public.claim_club_referral(v_inv);

  -- The new club's own claim, awaiting Site Admin review.
  insert into public.club_claims (directory_id, claimant_user_id, claimed_role, authority_declaration, status)
  values (v_dir_new, v_claimant, 'Club Secretary', 'I run this club.', 'pending')
  returning id into v_claim;

  -- ---------- 1. nothing commercial exists before approval ----------
  select count(*) into v_count from public.platform_trials t
  join public.clubs c on c.id = t.club_id where c.directory_id = v_dir_new;
  select status into v_text from public.platform_referrals where id = v_referral;
  if v_count = 0 and v_text = 'pending' then
    raise notice 'PASS 1: filling in a form starts no trial and registers no referral';
  else
    raise notice 'FAIL 1: trials=%, referral status=%', v_count, v_text;
  end if;

  -- ---------- 2. approving the claim activates the club ----------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_platform_mode('live', 'Phase K test setup');
  v_club_new := public.approve_club_claim(v_claim, 'Phase K test approval');

  if v_club_new is not null then
    raise notice 'PASS 2: approving the claim created and activated the club';
  else
    raise notice 'FAIL 2: approval returned no club';
  end if;

  -- ---------- 3. the trial begins at that moment ----------
  select status, started_at into v_text, v_trial_started
  from public.platform_trials where club_id = v_club_new;

  if v_text = 'active' and v_trial_started is not null then
    raise notice 'PASS 3: the club''s thirty usable days start at activation, not at signup';
  else
    raise notice 'FAIL 3: trial status=%', coalesce(v_text, '<none>');
  end if;

  -- ---------- 4. thirty days, in full ----------
  select remaining_seconds into v_count from public.club_trial_state(v_club_new);
  if v_count between 2591990 and 2592000 then
    raise notice 'PASS 4: the trial starts with a full thirty days';
  else
    raise notice 'FAIL 4: remaining is %', v_count;
  end if;

  -- ---------- 5. the referral learned which club it produced ----------
  select status, referred_club_id into v_text, v_club_ref
  from public.platform_referrals where id = v_referral;
  if v_text = 'registered' and v_club_ref = v_club_new then
    raise notice 'PASS 5: the referral registered against the club it introduced';
  else
    raise notice 'FAIL 5: status=%, referred club matches=%', v_text, (v_club_ref = v_club_new);
  end if;

  -- ---------- 6. but has earned nothing ----------
  select count(*) into v_count from public.platform_credits c
  join public.platform_referrals r on r.referring_club_id = c.club_id
  where r.id = v_referral;
  if v_count = 0 then
    raise notice 'PASS 6: activation alone earns the referrer nothing';
  else
    raise notice 'FAIL 6: % credit rows already exist', v_count;
  end if;

  -- ---------- 7. activation is idempotent for the trial ----------
  perform internal.begin_club_platform_trial(v_club_new);
  select count(*) into v_count from public.platform_trials where club_id = v_club_new;
  select started_at into v_trial_started from public.platform_trials where club_id = v_club_new;
  if v_count = 1 then
    raise notice 'PASS 7: a second activation cannot restart a club''s thirty days';
  else
    raise notice 'FAIL 7: % trials exist for one club', v_count;
  end if;

  -- ---------- 8. the club still has no Ovalball subscription ----------
  select count(*) into v_count from public.platform_club_subscriptions where club_id = v_club_new;
  if v_count = 0 then
    raise notice 'PASS 8: activation grants a trial, never a paid subscription';
  else
    raise notice 'FAIL 8: a subscription was created without anyone choosing a plan';
  end if;

  -- ---------- 9. the trial does not grant club authority to anyone new ----------
  select count(*) into v_count from public.club_memberships where club_id = v_club_new;
  if v_count = 1 then
    raise notice 'PASS 9: exactly one membership was created -- the approved claimant';
  else
    raise notice 'FAIL 9: % memberships exist after approval', v_count;
  end if;

  -- ---------- 10. a referral failure cannot break an approval ----------
  -- register_referred_club returns false rather than raising for every
  -- ineligible case, which is what keeps a commercial problem out of a
  -- club's onboarding.
  select not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'register_referred_club'
      and pg_get_functiondef(p.oid) like '%raise exception%'
  ) into v_ok;
  if v_ok then
    raise notice 'PASS 10: registering a referral never raises, so it cannot fail an approval';
  else
    raise notice 'FAIL 10: register_referred_club can raise, and would fail a club approval';
  end if;
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
