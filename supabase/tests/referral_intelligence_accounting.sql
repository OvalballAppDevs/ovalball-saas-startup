-- Commercial Cards + F1 Referral Intelligence: the accounting invariants.
--
-- These are not UI tests. They pin the SCHEMA FACTS the dashboard's referral
-- money figures are derived from, because each one was, at some point,
-- assumed rather than checked -- and each wrong assumption produced a
-- confident, wrong number on a Site Admin's screen:
--
--   * "reversed" is a terminal status of its own, so a reward clawback is
--     NOT inside the 'qualified' set. Code that summed reversals by
--     filtering `qualified` reported £0 reversed however much was clawed
--     back, overstating net reward.
--   * An invitation is a different entity from a referral. An invitation
--     nobody accepted produces no platform_referrals row at all, so
--     counting referral rows and labelling them "invitations sent" deletes
--     the top of the funnel -- the one stage the funnel exists to show.
--   * admin_referral_overview must keep exposing reward_credit_id and
--     reward_reversed; the reward split is computed from them.
--   * clubs.directory_id must stay NOT NULL, because the view inner-joins
--     club_directory. If it ever became nullable, referrals would silently
--     vanish from the Site Admin's list rather than error.
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Referral intelligence: accounting invariants ==='

begin;

do $$
declare
  v_site_admin uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_dir_ref uuid; v_dir_a uuid; v_dir_b uuid;
  v_club_ref uuid; v_club_a uuid; v_club_b uuid;
  v_inv_accepted uuid; v_inv_pending uuid;
  v_credit uuid;
  v_referral uuid;
  v_count int;
  v_earned bigint; v_reversed bigint; v_reward_price int;
  v_nullable text;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_site_admin, 'ria-site-' || v_site_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_admin, 'ria-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname, email) values
    (v_site_admin, 'RIA', 'Site', 'ria-site-' || v_site_admin::text || '@ovalball.test'),
    (v_admin, 'RIA', 'Admin', 'ria-admin-' || v_admin::text || '@ovalball.test');
  insert into public.site_admins (user_id, status, admin_role) values (v_site_admin, 'active', 'full');

  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'RIA Referrer RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ria-referrer-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_dir_ref;
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'RIA Referred A RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ria-referred-a-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_dir_a;
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (gen_random_uuid(), 'RIA Referred B RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ria-referred-b-' || substr(gen_random_uuid()::text,1,8))
  returning id into v_dir_b;

  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_dir_ref, 'ria-referrer-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club_ref;
  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_dir_a, 'ria-referred-a-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club_a;
  insert into public.clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_dir_b, 'ria-referred-b-' || substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club_b;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_ref, v_admin, 'CLUB_ADMIN', 'active');

  -- =================================================================
  -- A. An invitation is NOT a referral. Two invitations, one accepted.
  -- =================================================================
  insert into public.club_ovalball_invitations (id, inviting_club_id, club_directory_id, contact_name, contact_email, invited_by, status, accepted_at) values
    (gen_random_uuid(), v_club_ref, v_dir_a, 'RIA Contact A', 'ria-a@ovalball.test', v_admin, 'accepted', now())
  returning id into v_inv_accepted;
  insert into public.club_ovalball_invitations (id, inviting_club_id, club_directory_id, contact_name, contact_email, invited_by, status) values
    (gen_random_uuid(), v_club_ref, v_dir_b, 'RIA Contact B', 'ria-b@ovalball.test', v_admin, 'pending')
  returning id into v_inv_pending;

  insert into public.platform_referrals (id, invitation_id, referring_club_id, referred_club_id, status, attribution_source, created_by) values
    (gen_random_uuid(), v_inv_accepted, v_club_ref, v_club_a, 'registered', 'invitation', v_admin)
  returning id into v_referral;

  select count(*) into v_count from public.club_ovalball_invitations where inviting_club_id = v_club_ref;
  if v_count <> 2 then
    raise exception 'FAIL A setup: expected 2 invitations, found %', v_count;
  end if;

  select count(*) into v_count from public.platform_referrals where referring_club_id = v_club_ref;
  if v_count = 1 then
    raise notice 'PASS 1 (A): 2 invitations sent produced only 1 referral row -- referral rows CANNOT be counted as "invitations sent"';
  else
    raise exception 'FAIL 1 (A): expected 1 referral row for 2 invitations, found %', v_count;
  end if;

  select count(*) into v_count from public.platform_referrals where invitation_id = v_inv_pending;
  if v_count = 0 then
    raise notice 'PASS 2 (A): an unaccepted invitation has no referral row, so the top of the funnel exists only in club_ovalball_invitations';
  else
    raise exception 'FAIL 2 (A): a pending invitation produced a referral row';
  end if;

  -- =================================================================
  -- B. "reversed" is a terminal status OUTSIDE "qualified"
  -- =================================================================
  select count(*) into v_count
  from pg_constraint
  where conrelid = 'public.platform_referrals'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%reversed%'
    and pg_get_constraintdef(oid) like '%qualified%';
  if v_count >= 1 then
    raise notice 'PASS 3 (B): reversed and qualified are distinct values of the same status domain';
  else
    raise exception 'FAIL 3 (B): the referral status domain no longer distinguishes reversed from qualified';
  end if;

  -- A reward credit, then its reversal, on a referral that has moved to
  -- the 'reversed' terminal status -- the exact real-world shape that the
  -- old "sum reversals inside the qualified set" logic reported as zero.
  -- Priced from a REAL plan and carrying its snapshot, because
  -- platform_credits_reward_matches_snapshot now requires a reward to be
  -- worth exactly the price it recorded. A fixture that mints an arbitrary
  -- amount is the very defect that constraint exists to stop.
  insert into public.platform_credits (id, club_id, amount_pence, currency, source, reason, created_by,
                                       snapshot_plan_code, snapshot_price_pence, snapshot_price_version)
  select gen_random_uuid(), v_club_ref, p.price_pence, 'GBP', 'referral_reward', 'RIA test reward', v_site_admin,
         p.code, p.price_pence, p.price_version
  from public.platform_plans p where p.code = 'pro'
  returning id into v_credit;

  select amount_pence into v_reward_price from public.platform_credits where id = v_credit;
  insert into public.platform_credits (id, club_id, amount_pence, currency, source, reason, reverses_credit_id, created_by)
  values (gen_random_uuid(), v_club_ref, -v_reward_price, 'GBP', 'reversal', 'RIA test reversal', v_credit, v_site_admin);

  update public.platform_referrals
  set status = 'reversed',
      reward_credit_id = v_credit,
      reward_amount_pence = v_reward_price,
      reversed_at = now()
  where id = v_referral;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site_admin::text, 'role', 'authenticated')::text, true);

  -- The defect, reproduced: reward money counted only across 'qualified'.
  select coalesce(sum(reward_amount_pence), 0) into v_reversed
  from public.admin_referral_overview
  where referral_id = v_referral and status = 'qualified' and reward_reversed;
  if v_reversed = 0 then
    raise notice 'PASS 4 (B): summing reversals inside the qualified set reports 0 -- confirming that logic hides a real clawback';
  else
    raise exception 'FAIL 4 (B): expected the old qualified-only logic to report 0, got %', v_reversed;
  end if;

  -- The fix: reward money counted across every row that produced a credit.
  select coalesce(sum(reward_amount_pence), 0) into v_reversed
  from public.admin_referral_overview
  where referral_id = v_referral and reward_credit_id is not null and reward_reversed;
  if v_reversed = v_reward_price then
    raise notice 'PASS 5 (B): counting by reward_credit_id surfaces the full % pence reversal', v_reward_price;
  else
    raise exception 'FAIL 5 (B): expected % reversed, got %', v_reward_price, v_reversed;
  end if;

  select coalesce(sum(reward_amount_pence), 0) into v_earned
  from public.admin_referral_overview
  where referral_id = v_referral and reward_credit_id is not null and not reward_reversed;
  if v_earned = 0 then
    raise notice 'PASS 6 (B): a reversed reward contributes nothing to earned -- earned and reversed never double-count';
  else
    raise exception 'FAIL 6 (B): a reversed reward still counted as earned (%)', v_earned;
  end if;
  reset role;

  -- =================================================================
  -- C. The view keeps exposing what the reward split is computed from
  -- =================================================================
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'admin_referral_overview'
    and column_name in ('reward_credit_id', 'reward_reversed', 'reward_amount_pence', 'status');
  if v_count = 4 then
    raise notice 'PASS 7 (C): admin_referral_overview still exposes status, reward_credit_id, reward_reversed and reward_amount_pence';
  else
    raise exception 'FAIL 7 (C): the reward split columns are no longer all present (found % of 4)', v_count;
  end if;

  -- =================================================================
  -- D. The view's inner join can never silently drop a referral
  -- =================================================================
  select is_nullable into v_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'clubs' and column_name = 'directory_id';
  if v_nullable = 'NO' then
    raise notice 'PASS 8 (D): clubs.directory_id is NOT NULL, so admin_referral_overview''s inner join to club_directory cannot drop a referral';
  else
    raise exception 'FAIL 8 (D): clubs.directory_id became nullable -- referrals for a club with no directory row would now vanish from the Site Admin list instead of erroring';
  end if;

  -- =================================================================
  -- E. The two money domains stay separate, and the credential table
  --    stays unreadable from a user session
  -- =================================================================
  -- Domain A (a club pays Ovalball) is platform_payments, gated on
  -- club.platform_billing.view. Domain B (a club's members pay the club) is
  -- gocardless_payments. A commercial card that sums platform_payments and
  -- labels it "club member payments" mixes the two, which the dashboard
  -- explicitly promises never to do.
  select count(*) into v_count
  from pg_policies
  where tablename = 'platform_payments' and qual like '%platform_billing%';
  if v_count >= 1 then
    raise notice 'PASS 9 (E): platform_payments is gated on platform billing -- it is Domain A, what a club pays Ovalball';
  else
    raise exception 'FAIL 9 (E): platform_payments is no longer identifiable as the Ovalball-billing domain';
  end if;

  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name = 'gocardless_payments'
    and column_name in ('net_amount_minor', 'status', 'charge_date', 'club_id');
  if v_count = 4 then
    raise notice 'PASS 10 (E): gocardless_payments still carries the Domain B columns the member-payments card sums';
  else
    raise exception 'FAIL 10 (E): the Domain B payment columns changed (found % of 4)', v_count;
  end if;

  -- The merchant-connection table holds provider access tokens. It must stay
  -- unreadable from any user session: a card that queries it gets 42501 for
  -- everyone, and the old code rendered that denial as "0 clubs connected".
  select count(*) into v_count
  from information_schema.role_table_grants
  where table_name = 'gocardless_merchant_connections' and grantee in ('authenticated', 'anon');
  if v_count = 0 then
    raise notice 'PASS 11 (E): gocardless_merchant_connections grants nothing to authenticated/anon -- no dashboard read may source "clubs connected" from it';
  else
    raise exception 'FAIL 11 (E): the merchant credential table became readable from a user session (% grants)', v_count;
  end if;

  raise notice 'Referral intelligence accounting invariants complete.';
end $$;

rollback;
