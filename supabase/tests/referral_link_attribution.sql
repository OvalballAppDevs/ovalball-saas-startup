-- =====================================================================================================
-- ONE REFERRAL LINK PER CLUB (20270740000000) -- the owner's decisions of 2026-10-05
--
-- WHAT THIS GUARDS
--
--   C. CAPTURE: a claim made through a club's link records that club, and only when it may -- an unknown
--      slug, an inactive club, the club itself, or a club already on Ovalball records nothing -- and once
--      written nobody can change it.
--   A. APPROVAL: an approved claim turns the link into an ordinary introduction -- an invitation row with no
--      contact, inviter or token, its referral (attribution 'link') registered against the new club and dated
--      when they signed up, and the partnership request, marked as coming from the link.
--   O. ORDER: between clubs the earliest introduction is first, whichever way it was made; a club's own live
--      introduction stands instead of its link; a superseded claim's link counts while it was live, a lapsed
--      one never leaves a referral pending; a rejected claim records nothing.
--   P. PASS-ON: the earliest referral that can be credited earns the month; one that cannot is closed with its
--      reason and the next is credited.
--   S. SHAPE: a referral by name still needs its contact and inviter, a link row carries no token, a
--      partnership request always says who or what asked, and referral data health stays HEALTHY.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.
-- =====================================================================================================

\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create temp table ctx (k text primary key, v uuid) on commit drop;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ctx where k = p_k $$;
create or replace function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_email text := 'rla-' || p_label || '-' || v::text || '@ovalball.test';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth) values (v, 'RLA', p_label, v_email, (current_date - interval '40 years')::date)
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname;
  return v;
end $$;

create or replace function pg_temp.directory(p_label text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values (gen_random_uuid(), 'RLA ' || p_label || ' RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true,
          'unverified', 'site_admin_manual', 'rla-' || lower(p_label) || '-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v;
  return v;
end $$;

-- A club on Ovalball, optionally on the Standard plan (a referrer must be on a plan to be credited).
create or replace function pg_temp.club(p_label text, p_status text, p_on_plan boolean) returns uuid language plpgsql as $$
declare v uuid; v_dir uuid := pg_temp.directory(p_label);
begin
  insert into public.clubs (id, directory_id, slug, status)
  values (gen_random_uuid(), v_dir, 'rla-' || lower(p_label) || '-' || substr(gen_random_uuid()::text, 1, 8), p_status)
  returning id into v;
  if p_on_plan then
    insert into public.platform_club_subscriptions (club_id, plan_code, plan_price_pence, plan_price_version, status, started_at, provider_mandate_id)
    select v, 'standard', p.price_pence, p.price_version, 'active', now(), 'MD_RLA_' || substr(v::text, 1, 8)
      from public.platform_plans p where p.code = 'standard';
  end if;
  return v;
end $$;

-- A claim as its claimant would make it, at a chosen moment, through a chosen club's link.
create or replace function pg_temp.claim(p_directory uuid, p_claimant uuid, p_referrer uuid, p_at timestamptz) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_claims (directory_id, claimant_user_id, claimed_role, authority_declaration, state, created_at, referred_by_club_id)
  values (p_directory, p_claimant, 'Club Secretary', 'I may act for this club.', 'SUBMITTED', p_at, p_referrer)
  returning id into v;
  return v;
end $$;

-- A club referred by name, at a chosen moment (what create_partner_invitation makes, dated).
create or replace function pg_temp.referral_by_name(p_from_club uuid, p_directory uuid, p_inviter uuid, p_at timestamptz) returns uuid language plpgsql as $$
declare v_inv uuid;
begin
  insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by,
                                                status, expires_at, created_at)
  values (p_from_club, p_directory, 'RLA Contact', 'rla-contact@ovalball.test', p_inviter, 'pending', p_at + interval '14 days', p_at)
  returning id into v_inv;
  insert into public.platform_referrals (invitation_id, referring_club_id, created_by, attribution_source, created_at)
  values (v_inv, p_from_club, p_inviter, 'invitation', p_at);
  return v_inv;
end $$;

create or replace function pg_temp.as_(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.off() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Approve a claim as the Site Admin (no roles, so no club-role capability is needed). Returns the new club.
create or replace function pg_temp.approve(p_claim uuid) returns uuid language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_(pg_temp.id('site'));
  v := public.decide_club_claim(p_claim, 'APPROVED', 'referral link suite', '{}'::text[]);
  perform pg_temp.off();
  return (v->>'club_id')::uuid;
end $$;

-- A first collected payment by a club; returns the credit it earned, if any.
create or replace function pg_temp.first_payment(p_club uuid) returns uuid language plpgsql as $$
declare v_sub uuid; v_payment uuid; v_price int;
begin
  select price_pence into v_price from public.platform_plans where code = 'standard';
  insert into public.platform_club_subscriptions (club_id, plan_code, plan_price_pence, plan_price_version, status, started_at, provider_mandate_id)
  select p_club, 'standard', p.price_pence, p.price_version, 'active', now(), 'MD_RLA_PAY_' || substr(p_club::text, 1, 8)
    from public.platform_plans p where p.code = 'standard'
  returning id into v_sub;
  insert into public.platform_payments (id, club_id, subscription_id, gross_pence, net_pence, status, charge_date, confirmed_at, idempotency_key)
  values (gen_random_uuid(), p_club, v_sub, v_price, v_price, 'confirmed', current_date, now(), 'rla-' || substr(gen_random_uuid()::text, 1, 12))
  returning id into v_payment;
  return internal.qualify_referral_for_payment(v_payment);
end $$;

-- -----------------------------------------------------------------------------------------------------
-- Fixtures: a Site Admin, two referring clubs on a plan (A, B), one active club on no plan (D), one
-- suspended club (C), a club already on Ovalball (E), and the people who claim.
-- -----------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.put('site', pg_temp.person('site'));
  insert into public.site_admins (user_id, profile_key, status) values (pg_temp.id('site'), 'SITE_FULL', 'active');
  perform pg_temp.put('admin_a', pg_temp.person('admin-a'));
  perform pg_temp.put('admin_b', pg_temp.person('admin-b'));
  perform pg_temp.put('admin_d', pg_temp.person('admin-d'));
  perform pg_temp.put('claimant1', pg_temp.person('claimant-1'));
  perform pg_temp.put('claimant2', pg_temp.person('claimant-2'));
  perform pg_temp.put('club_a', pg_temp.club('A', 'active', true));
  perform pg_temp.put('club_b', pg_temp.club('B', 'active', true));
  perform pg_temp.put('club_c', pg_temp.club('C', 'suspended', true));
  perform pg_temp.put('club_d', pg_temp.club('D', 'active', false));
  perform pg_temp.put('club_e', pg_temp.club('E', 'active', false));
end $$;

-- =====================================================================================================
-- C. CAPTURE
-- =====================================================================================================
do $$
declare v_dir uuid := pg_temp.directory('X'); v_slug text; v_claim uuid; v_state text;
begin
  perform pg_temp.put('dir_x', v_dir);
  select slug into v_slug from public.clubs where id = pg_temp.id('club_a');

  perform pg_temp.as_(pg_temp.id('claimant1'));
  v_claim := public.submit_club_claim(v_dir, 'Club Secretary', 'I may act for this club.', '{}'::jsonb, upper(v_slug));
  perform pg_temp.off();
  perform pg_temp.put('claim_x', v_claim);
  perform pg_temp.check((select referred_by_club_id from public.club_claims where id = v_claim) = pg_temp.id('club_a')
                        and (select (metadata->>'through_referral_link')::boolean from public.security_events
                              where event_type = 'claim.submitted' and metadata->>'claim_id' = v_claim::text),
    'C1 a claim made through a club''s link records that club (its slug, in any case)');

  perform pg_temp.as_(pg_temp.id('claimant2'));
  v_claim := public.submit_club_claim(pg_temp.directory('Y'), 'Club Secretary', 'I may act for this club.', '{}'::jsonb, 'no-such-club-anywhere');
  perform pg_temp.off();
  perform pg_temp.check((select referred_by_club_id from public.club_claims where id = v_claim) is null,
    'C2 an unknown link records nothing');

  v_claim := pg_temp.claim(pg_temp.directory('Y2'), pg_temp.id('claimant2'), pg_temp.id('club_c'), now());
  perform pg_temp.check((select referred_by_club_id from public.club_claims where id = v_claim) is null,
    'C3 a suspended club''s link records nothing');

  v_claim := pg_temp.claim((select directory_id from public.clubs where id = pg_temp.id('club_a')), pg_temp.id('claimant2'), pg_temp.id('club_a'), now());
  perform pg_temp.check((select referred_by_club_id from public.club_claims where id = v_claim) is null,
    'C4 a club cannot introduce itself through its own link');

  v_claim := pg_temp.claim((select directory_id from public.clubs where id = pg_temp.id('club_e')), pg_temp.id('claimant2'), pg_temp.id('club_b'), now());
  perform pg_temp.check((select referred_by_club_id from public.club_claims where id = v_claim) is null,
    'C5 a club already on Ovalball cannot be introduced to it');

  update public.club_claims set referred_by_club_id = pg_temp.id('club_b') where id = pg_temp.id('claim_x');
  update public.club_claims set referred_by_club_id = null where id = pg_temp.id('claim_x');
  perform pg_temp.check((select referred_by_club_id from public.club_claims where id = pg_temp.id('claim_x')) = pg_temp.id('club_a'),
    'C6 once written, the referring club cannot be redirected or removed');
end $$;

-- =====================================================================================================
-- A. APPROVAL
-- =====================================================================================================
do $$
declare v_club uuid; v_inv record; v_ref record; v_partner record; v_claim_at timestamptz;
begin
  select created_at into v_claim_at from public.club_claims where id = pg_temp.id('claim_x');
  v_club := pg_temp.approve(pg_temp.id('claim_x'));
  perform pg_temp.put('club_x', v_club);

  select * into v_inv from public.club_ovalball_invitations
   where club_directory_id = pg_temp.id('dir_x') and inviting_club_id = pg_temp.id('club_a');
  perform pg_temp.check(v_inv.source = 'link' and v_inv.claim_id = pg_temp.id('claim_x') and v_inv.token is null
                        and v_inv.contact_name is null and v_inv.contact_email is null and v_inv.invited_by is null
                        and v_inv.status = 'accepted' and v_inv.created_at = v_claim_at,
    'A1 approval turns the link into an introduction: accepted, dated when they signed up, naming nobody, holding no secret');

  select * into v_ref from public.platform_referrals where invitation_id = v_inv.id;
  perform pg_temp.check(v_ref.attribution_source = 'link' and v_ref.status = 'registered' and v_ref.referred_club_id = v_club
                        and v_ref.referring_club_id = pg_temp.id('club_a') and v_ref.created_at = v_claim_at,
    'A2 its referral is registered against the new club, attributed to the link, dated when they signed up');

  select * into v_partner from public.club_partnerships where requesting_club_id = pg_temp.id('club_a') and partner_club_id = v_club;
  perform pg_temp.check(v_partner.status = 'pending' and v_partner.requested_via = 'referral_link' and v_partner.requested_by is null
                        and v_inv.resulting_partnership_id = v_partner.id,
    'A3 the referring club''s partnership request is sent, marked as coming from the link and attributed to nobody');

  perform pg_temp.check((select count(*) from public.club_ovalball_invitations where club_directory_id = pg_temp.id('dir_x')) = 1
                        and (select count(*) from public.platform_referrals r join public.club_ovalball_invitations i on i.id = r.invitation_id
                              where i.club_directory_id = pg_temp.id('dir_x')) = 1,
    'A4 one introduction and one referral, however the claim was reached');
end $$;

-- =====================================================================================================
-- O. ORDER, AND P. PASS-ON
-- =====================================================================================================
do $$
declare v_dir uuid; v_claim uuid; v_club uuid; v_credit uuid; v_rows int;
begin
  -- O1/O2: club B referred Z by name three days ago; then they signed up through club A's link two days ago.
  v_dir := pg_temp.directory('Z');
  perform pg_temp.referral_by_name(pg_temp.id('club_b'), v_dir, pg_temp.id('admin_b'), now() - interval '3 days');
  v_claim := pg_temp.claim(v_dir, pg_temp.id('claimant1'), pg_temp.id('club_a'), now() - interval '2 days');
  v_club := pg_temp.approve(v_claim);
  perform pg_temp.check((select count(*) from public.platform_referrals where referred_club_id = v_club and status = 'registered') = 2,
    'O1 a club referred by name and a link both register, each introduction counted once');
  v_credit := pg_temp.first_payment(v_club);
  perform pg_temp.check((select club_id from public.platform_credits where id = v_credit) = pg_temp.id('club_b')
                        and (select r.status from public.platform_referrals r join public.club_ovalball_invitations i on i.id = r.invitation_id
                              where i.club_directory_id = v_dir and i.inviting_club_id = pg_temp.id('club_a')) = 'registered',
    'O2 the club that introduced them first is credited; the later link stays registered, unpaid');

  -- O3: club A's link two days ago, then club B by name yesterday: the link was first.
  v_dir := pg_temp.directory('V');
  v_claim := pg_temp.claim(v_dir, pg_temp.id('claimant1'), pg_temp.id('club_a'), now() - interval '2 days');
  perform pg_temp.referral_by_name(pg_temp.id('club_b'), v_dir, pg_temp.id('admin_b'), now() - interval '1 day');
  v_club := pg_temp.approve(v_claim);
  v_credit := pg_temp.first_payment(v_club);
  perform pg_temp.check((select club_id from public.platform_credits where id = v_credit) = pg_temp.id('club_a'),
    'O3 a link used before another club''s referral by name is first, and is credited');

  -- O4: club A referred U by name, and then they signed up through club A's own link: one introduction.
  v_dir := pg_temp.directory('U');
  perform pg_temp.referral_by_name(pg_temp.id('club_a'), v_dir, pg_temp.id('admin_a'), now() - interval '3 days');
  v_claim := pg_temp.claim(v_dir, pg_temp.id('claimant1'), pg_temp.id('club_a'), now() - interval '2 days');
  v_club := pg_temp.approve(v_claim);
  perform pg_temp.check((select count(*) from public.club_ovalball_invitations where club_directory_id = v_dir) = 1
                        and not exists (select 1 from public.club_ovalball_invitations where club_directory_id = v_dir and source = 'link'),
    'O4 a club''s own live referral by name stands instead of its link: never two introductions for one pair');

  -- O5: a superseded claim's link counts while it was live.
  v_dir := pg_temp.directory('S');
  perform pg_temp.claim(v_dir, pg_temp.id('claimant1'), pg_temp.id('club_b'), now() - interval '2 days');
  v_claim := pg_temp.claim(v_dir, pg_temp.id('claimant2'), null, now() - interval '1 day');
  v_club := pg_temp.approve(v_claim);
  perform pg_temp.check(exists (select 1 from public.platform_referrals r join public.club_ovalball_invitations i on i.id = r.invitation_id
                                 where i.club_directory_id = v_dir and i.source = 'link' and i.inviting_club_id = pg_temp.id('club_b')
                                   and r.status = 'registered' and r.referred_club_id = v_club),
    'O5 a link carried by a competing claim that is superseded still introduces the club');

  -- O6: a link that had lapsed before the approved claim was made records nothing and leaves nothing pending.
  v_dir := pg_temp.directory('R');
  perform pg_temp.claim(v_dir, pg_temp.id('claimant1'), pg_temp.id('club_b'), now() - interval '30 days');
  v_claim := pg_temp.claim(v_dir, pg_temp.id('claimant2'), null, now() - interval '1 day');
  v_club := pg_temp.approve(v_claim);
  perform pg_temp.check(not exists (select 1 from public.club_ovalball_invitations where club_directory_id = v_dir)
                        and not exists (select 1 from public.platform_referrals where referred_club_id = v_club),
    'O6 a link that had lapsed records no introduction and leaves no referral pending');

  -- O7: a rejected claim made through a link records nothing.
  v_dir := pg_temp.directory('Q');
  v_claim := pg_temp.claim(v_dir, pg_temp.id('claimant1'), pg_temp.id('club_a'), now() - interval '1 day');
  perform pg_temp.as_(pg_temp.id('site'));
  perform public.decide_club_claim(v_claim, 'REJECTED', 'referral link suite', null);
  perform pg_temp.off();
  perform pg_temp.check(not exists (select 1 from public.club_ovalball_invitations where club_directory_id = v_dir),
    'O7 a rejected claim made through a link records nothing');

  -- P1: club D (active, on no plan) referred W first; club A's link came later. D cannot be credited, so A is.
  v_dir := pg_temp.directory('W');
  perform pg_temp.referral_by_name(pg_temp.id('club_d'), v_dir, pg_temp.id('admin_d'), now() - interval '3 days');
  v_claim := pg_temp.claim(v_dir, pg_temp.id('claimant1'), pg_temp.id('club_a'), now() - interval '2 days');
  v_club := pg_temp.approve(v_claim);
  v_credit := pg_temp.first_payment(v_club);
  perform pg_temp.check((select club_id from public.platform_credits where id = v_credit) = pg_temp.id('club_a')
                        and (select r.status || ': ' || r.rejection_reason from public.platform_referrals r
                               join public.club_ovalball_invitations i on i.id = r.invitation_id
                              where i.club_directory_id = v_dir and i.inviting_club_id = pg_temp.id('club_d'))
                            = 'rejected: The referring club is not on an Ovalball plan.',
    'P1 credit passes on: a first referrer on no plan is closed with its reason and the next club is credited');

  -- P2: and only one club is ever credited for one club.
  select count(*) into v_rows from public.platform_referrals where referred_club_id = v_club and status = 'qualified';
  perform pg_temp.check(v_rows = 1, 'P2 exactly one referral qualifies for one club');
end $$;

-- =====================================================================================================
-- S. SHAPE AND HEALTH
-- =====================================================================================================
do $$
declare v_state text; v_health record;
begin
  begin
    insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, status)
    values (pg_temp.id('club_a'), pg_temp.directory('T1'), 'pending');
    v_state := 'OK';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform pg_temp.check(v_state = '23514', 'S1 a club referred by name still needs its contact and the person who sent it');

  begin
    insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, status, source, claim_id)
    values (pg_temp.id('club_a'), pg_temp.directory('T2'), 'pending', 'link', pg_temp.id('claim_x'));
    v_state := 'OK';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform pg_temp.check(v_state = '23514', 'S2 an introduction through a link never carries a token');

  begin
    insert into public.club_partnerships (requesting_club_id, partner_club_id, status)
    values (pg_temp.id('club_a'), pg_temp.id('club_e'), 'pending');
    v_state := 'OK';
  exception when others then get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform pg_temp.check(v_state = '23514', 'S3 a partnership request always says who, or what, asked');

  perform pg_temp.check(not has_function_privilege('authenticated', 'internal.record_link_introductions(uuid,uuid)', 'EXECUTE')
                        and not has_function_privilege('anon', 'public.submit_club_claim(uuid,text,text,jsonb,text,jsonb)', 'EXECUTE')
                        and has_function_privilege('authenticated', 'public.submit_club_claim(uuid,text,text,jsonb,text,jsonb)', 'EXECUTE'),
    'S4 claims are for signed-in people; turning links into introductions is for no caller at all');

  perform pg_temp.as_(pg_temp.id('site'));
  select * into v_health from public.referral_data_health();
  perform pg_temp.off();
  perform pg_temp.check(v_health.status = 'HEALTHY' and v_health.missing_attribution = 0 and v_health.pending_for_activated_club = 0
                        and v_health.ambiguous_referrer = 0 and v_health.duplicate_attribution = 0,
    'S5 referral data health stays HEALTHY with links, competing referrers and a passed-on reward');
end $$;

rollback;
