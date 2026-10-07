-- =====================================================================================================
-- ONE DOOR FOR CLAIMS, REQUESTS AND REFERRALS (20270743000000)
--
-- The owner's brief: signup-created claims bypassed the three-a-day limit; an invitation created after a
-- claim could be attributed to it; an invitation could exist with no referral record; and any other path
-- that can leave attribution, membership or guardian state inconsistent was to be fixed and permanently
-- tested. This proves each door from the outside, as the people who use it:
--
--   OD1-OD4   A claim has one door. A person cannot write club_claims (so cannot choose its date or its state);
--             submit_club_claim takes what signup sends -- the proposed teams and the referral link -- and three
--             claims a day is three however they are made.
--   OD5-OD11  A referral counts only if it came first. A named invitation sent after the club had asked is
--             closed with its reason -- never registered, partnered or credited; a link used after the approved
--             claim introduces nobody; a club's own late invitation does not stand in for its earlier link;
--             referral data health stays HEALTHY.
--   OD12-OD14 Every club invitation is a referral. The canonical writer passes the check; an invitation left
--             without its referral is refused when the constraint is checked; CLUB_REFERRAL cannot be issued.
--   OD15-OD20 A partnership request is a request. The direct write that made an ACTIVE partnership in another
--             club's name is refused; request_club_partnership writes pending, from the person asking; only the
--             club's managers may ask; only the other club can make it active.
--   OD21-OD24 A join request is a request. No direct write; request_club_membership writes a pending request and
--             opens the pending membership; asking twice is one request; a member or an inactive club is refused.
--   OD25-OD26 A new-club request's review is the server's when a person writes it; a bulk import keeps its
--             provenance.
--   OD27-OD32 A legacy guardian invitation (the club's replacement link) is used once, for what it was sent
--             for: a removed guardian cannot re-link with it, it never creates a new child, the club's trust
--             ends with the relationship, an invitation makes at most one child, and a sender's lost authority
--             ends it.
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
declare v uuid := gen_random_uuid(); v_email text := 'odr-' || p_label || '-' || v::text || '@ovalball.test';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v, 'Odr', p_label, v_email, (current_date - interval '40 years')::date, 'ACTIVE')
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, account_state = 'ACTIVE';
  return v;
end $$;

create or replace function pg_temp.directory(p_label text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values (gen_random_uuid(), 'ODR ' || p_label || ' RUFC', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true,
          'unverified', 'site_admin_manual', 'odr-' || lower(p_label) || '-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v;
  return v;
end $$;

-- A club on Ovalball, optionally on the Standard plan (a referrer must be on a plan to be credited).
create or replace function pg_temp.club(p_label text, p_status text, p_on_plan boolean) returns uuid language plpgsql as $$
declare v uuid; v_dir uuid := pg_temp.directory(p_label);
begin
  insert into public.clubs (id, directory_id, slug, status)
  values (gen_random_uuid(), v_dir, 'odr-' || lower(p_label) || '-' || substr(gen_random_uuid()::text, 1, 8), p_status)
  returning id into v;
  if p_on_plan then
    insert into public.platform_club_subscriptions (club_id, plan_code, plan_price_pence, plan_price_version, status, started_at, provider_mandate_id)
    select v, 'standard', p.price_pence, p.price_version, 'active', now(), 'MD_ODR_' || substr(v::text, 1, 8)
      from public.platform_plans p where p.code = 'standard';
  end if;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text) returns void language plpgsql as $$
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active');
end $$;

create or replace function pg_temp.as_(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.off() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

-- One statement as a person IN THE BROWSER'S ROLE: OK, or the SQLSTATE and the sentence they would read.
create or replace function pg_temp.say_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  begin execute p_sql; v_state := 'OK'; exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  reset role;
  perform pg_temp.off();
  return v_state || coalesce(': ' || v_msg, '');
end $$;
create or replace function pg_temp.state_as(p_subject uuid, p_sql text) returns text language sql as $$
  select split_part(pg_temp.say_as(p_subject, p_sql), ':', 1) $$;
create or replace function pg_temp.uuid_as(p_subject uuid, p_sql text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform pg_temp.off();
  return v;
end $$;

-- A claim as the database owner would write it, at a chosen moment (the only writer left that can choose one).
create or replace function pg_temp.claim(p_directory uuid, p_claimant uuid, p_referrer uuid, p_at timestamptz) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_claims (directory_id, claimant_user_id, claimed_role, authority_declaration, state, created_at, referred_by_club_id)
  values (p_directory, p_claimant, 'Club Secretary', 'I may act for this club.', 'SUBMITTED', p_at, p_referrer)
  returning id into v;
  return v;
end $$;

-- A club referred by name at a chosen moment: what create_partner_invitation makes, dated.
create or replace function pg_temp.referral_by_name(p_from_club uuid, p_directory uuid, p_inviter uuid, p_at timestamptz) returns uuid language plpgsql as $$
declare v_inv uuid;
begin
  insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by,
                                                status, expires_at, created_at)
  values (p_from_club, p_directory, 'ODR Contact', 'odr-contact@ovalball.test', p_inviter, 'pending', p_at + interval '14 days', p_at)
  returning id into v_inv;
  insert into public.platform_referrals (invitation_id, referring_club_id, created_by, attribution_source, created_at)
  values (v_inv, p_from_club, p_inviter, 'invitation', p_at);
  return v_inv;
end $$;

create or replace function pg_temp.approve(p_claim uuid) returns uuid language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_(pg_temp.id('site'));
  v := public.decide_club_claim(p_claim, 'APPROVED', 'one door suite', '{}'::text[]);
  perform pg_temp.off();
  return (v->>'club_id')::uuid;
end $$;

-- A first collected payment by a club; returns the credit it earned, if any.
create or replace function pg_temp.first_payment(p_club uuid) returns uuid language plpgsql as $$
declare v_sub uuid; v_payment uuid; v_price int;
begin
  select price_pence into v_price from public.platform_plans where code = 'standard';
  insert into public.platform_club_subscriptions (club_id, plan_code, plan_price_pence, plan_price_version, status, started_at, provider_mandate_id)
  select p_club, 'standard', p.price_pence, p.price_version, 'active', now(), 'MD_ODR_PAY_' || substr(p_club::text, 1, 8)
    from public.platform_plans p where p.code = 'standard'
  returning id into v_sub;
  insert into public.platform_payments (id, club_id, subscription_id, gross_pence, net_pence, status, charge_date, confirmed_at, idempotency_key)
  values (gen_random_uuid(), p_club, v_sub, v_price, v_price, 'confirmed', current_date, now(), 'odr-' || substr(gen_random_uuid()::text, 1, 12))
  returning id into v_payment;
  return internal.qualify_referral_for_payment(v_payment);
end $$;

-- -----------------------------------------------------------------------------------------------------
-- Fixtures: a Site Admin; two referring clubs on a plan (A, B) with their administrators; a plain member of
-- A; a third active club (C); a suspended club (S); and the people who claim and ask.
-- -----------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.put('site', pg_temp.person('site'));
  insert into public.site_admins (user_id, profile_key, status) values (pg_temp.id('site'), 'SITE_FULL', 'active');
  perform pg_temp.put('club_a', pg_temp.club('A', 'active', true));
  perform pg_temp.put('club_b', pg_temp.club('B', 'active', true));
  perform pg_temp.put('club_c', pg_temp.club('C', 'active', false));
  perform pg_temp.put('club_s', pg_temp.club('S', 'suspended', false));
  perform pg_temp.put('admin_a', pg_temp.person('admin-a'));
  perform pg_temp.put('admin_b', pg_temp.person('admin-b'));
  perform pg_temp.put('member_a', pg_temp.person('member-a'));
  perform pg_temp.member(pg_temp.id('club_a'), pg_temp.id('admin_a'), 'CLUB_ADMIN');
  perform pg_temp.member(pg_temp.id('club_b'), pg_temp.id('admin_b'), 'CLUB_ADMIN');
  perform pg_temp.member(pg_temp.id('club_a'), pg_temp.id('member_a'), 'BASIC_USER');
  perform pg_temp.put('claimant1', pg_temp.person('claimant-1'));
  perform pg_temp.put('claimant2', pg_temp.person('claimant-2'));
  perform pg_temp.put('claimant3', pg_temp.person('claimant-3'));
  perform pg_temp.put('joiner', pg_temp.person('joiner'));
end $$;

-- =====================================================================================================
-- 1. A CLAIM HAS ONE DOOR
-- =====================================================================================================
do $$
declare v_dir uuid := pg_temp.directory('P'); v_slug text; v_claim uuid; v_row public.club_claims; v text; i int;
begin
  -- What signup used to do, and anybody signed in could: write the claim, choosing its date and its state.
  v := pg_temp.state_as(pg_temp.id('claimant1'), format(
         'insert into public.club_claims (directory_id, claimant_user_id, claimed_role, authority_declaration, state, created_at)
          values (%L, %L, ''Club Secretary'', ''me'', ''APPROVED'', now() - interval ''3 days'')', v_dir, pg_temp.id('claimant1')));
  perform pg_temp.check(v = '42501' and not exists (select 1 from public.club_claims where directory_id = v_dir),
    'OD1 a person cannot write a claim themselves -- so cannot choose its date, its state or its referrer (' || v || ')');

  -- What signup sends now: its role, its declaration, the club''s link, and the teams it proposes.
  select slug into v_slug from public.clubs where id = pg_temp.id('club_a');
  v_claim := pg_temp.uuid_as(pg_temp.id('claimant1'), format(
               'select public.submit_club_claim(%L, ''Club Secretary'', ''I confirm I may act for this club.'', ''{}''::jsonb, %L, %L::jsonb)',
               v_dir, upper(v_slug), '[{"ageGroup":"U12","gender":"boys"},{"ageGroup":"U14","gender":"girls"}]'));
  select * into v_row from public.club_claims where id = v_claim;
  perform pg_temp.check(v_row.state = 'SUBMITTED' and v_row.claimant_user_id = pg_temp.id('claimant1')
                        and v_row.referred_by_club_id = pg_temp.id('club_a')
                        and jsonb_array_length(v_row.proposed_teams) = 2 and v_row.proposed_teams -> 0 ->> 'ageGroup' = 'U12'
                        and v_row.created_at > now() - interval '1 minute'
                        and exists (select 1 from public.security_events where event_type = 'claim.submitted' and metadata ->> 'claim_id' = v_claim::text),
    'OD2 signup''s claim goes through submit_club_claim: its proposed teams and its referral link kept, dated now, recorded as submitted');

  v := pg_temp.state_as(pg_temp.id('claimant1'), format(
         'select public.submit_club_claim(%L, ''Club Secretary'', ''me'', ''{}''::jsonb, null, ''{"teams":1}''::jsonb)', pg_temp.directory('P2')));
  perform pg_temp.check(v = '22023', 'OD3 proposed teams are a list or nothing (' || v || ')');

  -- Three a day is three a day: the limit signup used to skip.
  for i in 1..3 loop
    perform pg_temp.uuid_as(pg_temp.id('claimant2'), format(
      'select public.submit_club_claim(%L, ''Club Secretary'', ''me'', ''{}''::jsonb, null, ''[]''::jsonb)', pg_temp.directory('R' || i)));
  end loop;
  v := pg_temp.say_as(pg_temp.id('claimant2'), format(
         'select public.submit_club_claim(%L, ''Club Secretary'', ''me'', ''{}''::jsonb, null, ''[]''::jsonb)', pg_temp.directory('R4')));
  perform pg_temp.check(v like 'P0001%too many claims today%'
                        and (select count(*) from public.club_claims where claimant_user_id = pg_temp.id('claimant2')) = 3,
    'OD4 a fourth claim in a day is refused, whichever page it is made from (' || v || ')');
end $$;

-- =====================================================================================================
-- 2. A REFERRAL COUNTS ONLY IF IT CAME FIRST
-- =====================================================================================================
do $$
declare v_dir uuid; v_claim uuid; v_club uuid; v_inv uuid; v_ref record; v_credit uuid; v_late uuid;
begin
  -- OD5-OD7: the club asked two days ago; club B sent its invitation yesterday.
  v_dir := pg_temp.directory('Late');
  v_claim := pg_temp.claim(v_dir, pg_temp.id('claimant3'), null, now() - interval '2 days');
  v_inv := pg_temp.referral_by_name(pg_temp.id('club_b'), v_dir, pg_temp.id('admin_b'), now() - interval '1 day');
  v_club := pg_temp.approve(v_claim);
  select * into v_ref from public.platform_referrals where invitation_id = v_inv;
  perform pg_temp.check(v_ref.status = 'rejected'
                        and v_ref.rejection_reason = 'That club had already asked to join Ovalball before this invitation was sent.'
                        and v_ref.referred_club_id is null,
    'OD5 an invitation sent after the club had already asked is not an introduction: its referral is closed with that reason');
  perform pg_temp.check((select status from public.club_ovalball_invitations where id = v_inv) = 'pending'
                        and not exists (select 1 from public.club_partnerships p
                                         where least(p.requesting_club_id, p.partner_club_id) = least(pg_temp.id('club_b'), v_club)
                                           and greatest(p.requesting_club_id, p.partner_club_id) = greatest(pg_temp.id('club_b'), v_club)),
    'OD6 and it is not accepted on the club''s behalf, and sends no partnership request in its name');
  v_credit := pg_temp.first_payment(v_club);
  perform pg_temp.check(v_credit is null and not exists (select 1 from public.platform_credits where club_id = pg_temp.id('club_b') and source = 'referral_reward'),
    'OD7 so the club''s first payment credits nobody for it');

  -- OD8: the control -- the same invitation a day BEFORE they asked registers, partners and is credited.
  v_dir := pg_temp.directory('OnTime');
  v_inv := pg_temp.referral_by_name(pg_temp.id('club_b'), v_dir, pg_temp.id('admin_b'), now() - interval '3 days');
  v_claim := pg_temp.claim(v_dir, pg_temp.id('claimant3'), null, now() - interval '2 days');
  v_club := pg_temp.approve(v_claim);
  v_credit := pg_temp.first_payment(v_club);
  perform pg_temp.check((select status from public.platform_referrals where invitation_id = v_inv) = 'qualified'
                        and (select status from public.club_ovalball_invitations where id = v_inv) = 'accepted'
                        and (select club_id from public.platform_credits where id = v_credit) = pg_temp.id('club_b'),
    'OD8 an invitation sent before the club asked still registers, is accepted and earns the credit');

  -- OD9: a competing claim through club A's link, made AFTER the claim that is approved, introduced nobody.
  v_dir := pg_temp.directory('Compete');
  v_claim := pg_temp.claim(v_dir, pg_temp.id('claimant3'), null, now() - interval '3 days');
  v_late := pg_temp.claim(v_dir, pg_temp.id('claimant1'), pg_temp.id('club_a'), now() - interval '1 day');
  v_club := pg_temp.approve(v_claim);
  perform pg_temp.check(not exists (select 1 from public.club_ovalball_invitations where club_directory_id = v_dir)
                        and not exists (select 1 from public.platform_referrals where referred_club_id = v_club)
                        and (select state from public.club_claims where id = v_late) = 'SUPERSEDED',
    'OD9 a link used after the club had already asked introduces nobody, and its claim is simply superseded');

  -- OD10: club A's link was the claim itself; A's own named invitation came a day later. The later one does
  -- not stand in for the link -- the link is the introduction, and the late invitation is closed.
  v_dir := pg_temp.directory('OwnLate');
  v_claim := pg_temp.claim(v_dir, pg_temp.id('claimant1'), pg_temp.id('club_a'), now() - interval '2 days');
  v_inv := pg_temp.referral_by_name(pg_temp.id('club_a'), v_dir, pg_temp.id('admin_a'), now() - interval '1 day');
  v_club := pg_temp.approve(v_claim);
  v_credit := pg_temp.first_payment(v_club);
  perform pg_temp.check(exists (select 1 from public.club_ovalball_invitations i join public.platform_referrals r on r.invitation_id = i.id
                                 where i.club_directory_id = v_dir and i.source = 'link' and i.inviting_club_id = pg_temp.id('club_a')
                                   and r.status = 'qualified')
                        and (select status from public.platform_referrals where invitation_id = v_inv) = 'rejected'
                        and (select club_id from public.platform_credits where id = v_credit) = pg_temp.id('club_a'),
    'OD10 a club''s own late invitation does not stand in for its earlier link: the link is credited, the invitation closed');
end $$;

do $$
declare v_health record;
begin
  perform pg_temp.as_(pg_temp.id('site'));
  select * into v_health from public.referral_data_health();
  perform pg_temp.off();
  perform pg_temp.check(v_health.status = 'HEALTHY' and v_health.pending_for_activated_club = 0 and v_health.missing_attribution = 0,
    'OD11 referral data health stays HEALTHY: nothing is left pending against a club that exists');
end $$;

-- =====================================================================================================
-- 3. EVERY CLUB INVITATION IS A REFERRAL
-- =====================================================================================================
do $$
declare v_inv uuid; v text;
begin
  -- The canonical writer: the invitation and its referral in one transaction. Asking for the check now
  -- (SET CONSTRAINTS ... IMMEDIATE checks everything this transaction has written so far) passes.
  v_inv := pg_temp.uuid_as(pg_temp.id('admin_a'), format(
             'select public.create_partner_invitation(%L, %L, ''A Contact'', ''odr-invite@ovalball.test'')',
             pg_temp.id('club_a'), pg_temp.directory('Invited')));
  begin
    set constraints club_ovalball_invitation_has_its_referral immediate;
    v := 'OK';
  exception when others then get stacked diagnostics v = returned_sqlstate;
  end;
  perform pg_temp.check(v = 'OK' and exists (select 1 from public.platform_referrals where invitation_id = v_inv),
    'OD12 create_partner_invitation records the invitation and its referral together, and passes the check (' || v || ')');

  -- An invitation written alone -- what a fixture once did, leaving aa9d7850 -- is refused.
  begin
    insert into public.club_ovalball_invitations (inviting_club_id, club_directory_id, contact_name, contact_email, invited_by)
    values (pg_temp.id('club_a'), pg_temp.directory('Orphan'), 'A Contact', 'odr-orphan@ovalball.test', pg_temp.id('admin_a'));
    v := 'OK';
  exception when others then get stacked diagnostics v = returned_sqlstate;
  end;
  set constraints club_ovalball_invitation_has_its_referral deferred;
  perform pg_temp.check(v = '23514', 'OD13 an invitation that would end its transaction without its referral is refused (' || v || ')');

  v := pg_temp.say_as(pg_temp.id('admin_a'), format(
         'select public.issue_invitation(''CLUB_REFERRAL'', %L, null, null, null, null, ''odr-referral@ovalball.test'', ''{}''::jsonb)', pg_temp.id('club_a')));
  perform pg_temp.check(v like '22023%not a people invitation%',
    'OD14 a club referral cannot be issued as a people invitation, which recorded no referral and did nothing (' || left(v, 90) || ')');
end $$;

-- =====================================================================================================
-- 4. A PARTNERSHIP REQUEST IS A REQUEST
-- =====================================================================================================
do $$
declare v text; v_id uuid; v_row public.club_partnerships;
begin
  -- The write that made an ACTIVE partnership with another club, naming somebody else as having accepted it.
  v := pg_temp.state_as(pg_temp.id('admin_a'), format(
         'insert into public.club_partnerships (requesting_club_id, partner_club_id, status, requested_by, responded_by, responded_at)
          values (%L, %L, ''active'', %L, %L, now())', pg_temp.id('club_a'), pg_temp.id('club_b'), pg_temp.id('admin_a'), pg_temp.id('admin_b')));
  perform pg_temp.check(v = '42501' and not exists (select 1 from public.club_partnerships
                                                     where requesting_club_id = pg_temp.id('club_a') and partner_club_id = pg_temp.id('club_b')),
    'OD15 a Club Admin can no longer write a partnership directly -- the write that made one ACTIVE without the other club (' || v || ')');

  v_id := pg_temp.uuid_as(pg_temp.id('admin_a'), format('select public.request_club_partnership(%L, %L)', pg_temp.id('club_a'), pg_temp.id('club_b')));
  select * into v_row from public.club_partnerships where id = v_id;
  perform pg_temp.check(v_row.status = 'pending' and v_row.requested_by = pg_temp.id('admin_a') and v_row.responded_by is null
                        and v_row.responded_at is null and v_row.requested_via is null,
    'OD16 request_club_partnership writes a pending request from the person asking, and nothing more');

  perform pg_temp.check(pg_temp.state_as(pg_temp.id('member_a'), format('select public.request_club_partnership(%L, %L)', pg_temp.id('club_a'), pg_temp.id('club_c'))) = '42501'
                        and pg_temp.state_as(pg_temp.id('admin_b'), format('select public.request_club_partnership(%L, %L)', pg_temp.id('club_a'), pg_temp.id('club_c'))) = '42501',
    'OD17 only the asking club''s managers may ask: not its plain members, not another club''s administrator in its name');

  perform pg_temp.check(pg_temp.say_as(pg_temp.id('admin_a'), format('select public.request_club_partnership(%L, %L)', pg_temp.id('club_a'), pg_temp.id('club_b'))) like '23505%already have a pending or active relationship%'
                        and pg_temp.state_as(pg_temp.id('admin_b'), format('select public.request_club_partnership(%L, %L)', pg_temp.id('club_b'), pg_temp.id('club_a'))) = '23505',
    'OD18 one relationship per pair of clubs, asked from either side');

  perform pg_temp.check(pg_temp.state_as(pg_temp.id('admin_a'), format('select public.request_club_partnership(%L, %L)', pg_temp.id('club_a'), pg_temp.id('club_a'))) = '22023'
                        and pg_temp.state_as(pg_temp.id('admin_a'), format('select public.request_club_partnership(%L, %L)', pg_temp.id('club_a'), pg_temp.id('club_s'))) = 'P0002',
    'OD19 not with itself, and not with a club that is not active on Ovalball');

  v := pg_temp.state_as(pg_temp.id('admin_b'), format('select public.respond_to_club_partnership(%L, true)', v_id));
  select * into v_row from public.club_partnerships where id = v_id;
  perform pg_temp.check(v = 'OK' and v_row.status = 'active' and v_row.responded_by = pg_temp.id('admin_b'),
    'OD20 and only the other club makes it active, as the person who answered');
end $$;

-- =====================================================================================================
-- 5. A JOIN REQUEST IS A REQUEST
-- =====================================================================================================
do $$
declare v text; v_id uuid; v_again uuid; v_row public.club_join_requests;
begin
  v := pg_temp.state_as(pg_temp.id('joiner'), format(
         'insert into public.club_join_requests (club_id, requesting_user_id, requested_role, status, decided_by)
          values (%L, %L, ''Volunteer'', ''approved'', %L)', pg_temp.id('club_a'), pg_temp.id('joiner'), pg_temp.id('admin_a')));
  perform pg_temp.check(v = '42501' and not exists (select 1 from public.club_join_requests where requesting_user_id = pg_temp.id('joiner')),
    'OD21 a person cannot write a join request themselves -- one that said approved, or named its decider (' || v || ')');

  v_id := pg_temp.uuid_as(pg_temp.id('joiner'), format('select public.request_club_membership(%L, ''Volunteer'')', pg_temp.id('club_a')));
  select * into v_row from public.club_join_requests where id = v_id;
  perform pg_temp.check(v_row.status = 'pending' and v_row.requesting_user_id = pg_temp.id('joiner') and v_row.decided_by is null
                        and v_row.source_invitation_id is null and v_row.requested_role = 'Volunteer'
                        and exists (select 1 from public.club_memberships m where m.club_id = pg_temp.id('club_a') and m.user_id = pg_temp.id('joiner')
                                     and m.state = 'PENDING' and m.source = 'JOIN_REQUEST' and m.source_request_id = v_id),
    'OD22 request_club_membership writes a pending request from the person asking and opens their pending membership');

  v_again := pg_temp.uuid_as(pg_temp.id('joiner'), format('select public.request_club_membership(%L, ''Coach'')', pg_temp.id('club_a')));
  perform pg_temp.check(v_again = v_id and (select count(*) from public.club_join_requests where requesting_user_id = pg_temp.id('joiner')) = 1,
    'OD23 asking twice is one request');

  perform pg_temp.check(pg_temp.say_as(pg_temp.id('admin_a'), format('select public.request_club_membership(%L, ''Chair'')', pg_temp.id('club_a'))) like '23505%already a member%'
                        and pg_temp.state_as(pg_temp.id('joiner'), format('select public.request_club_membership(%L, ''Volunteer'')', pg_temp.id('club_s'))) = 'P0002'
                        and pg_temp.state_as(pg_temp.id('joiner'), format('select public.request_club_membership(%L, ''  '')', pg_temp.id('club_c'))) = '22023',
    'OD24 a member is told they are one; an inactive club and a blank role are refused');
end $$;

-- =====================================================================================================
-- 6. A NEW-CLUB REQUEST'S REVIEW IS THE SERVER'S
-- =====================================================================================================
do $$
declare v text; v_row public.directory_requests; v_dir uuid := pg_temp.directory('Existing');
begin
  v := pg_temp.state_as(pg_temp.id('joiner'), format(
         'insert into public.directory_requests (submitted_by, club_name, rugby_code, status, reviewed_by, reviewed_at, review_notes,
                                                 created_directory_id, source)
          values (%L, ''ODR Proposed RUFC'', ''union'', ''approved'', %L, now(), ''looks fine'', %L, ''lancashire_rfu'')',
         pg_temp.id('joiner'), pg_temp.id('site'), v_dir));
  select * into v_row from public.directory_requests where club_name = 'ODR Proposed RUFC';
  perform pg_temp.check(v = 'OK' and v_row.status = 'pending' and v_row.reviewed_by is null and v_row.reviewed_at is null
                        and v_row.review_notes is null and v_row.created_directory_id is null and v_row.source is null
                        and v_row.submitted_by = pg_temp.id('joiner'),
    'OD25 a person''s request for a new club is theirs to ask -- its status, review, outcome and provenance are the server''s');

  insert into public.directory_requests (club_name, rugby_code, status, source) values ('ODR Imported RUFC', 'union', 'pending', 'lancashire_rfu');
  perform pg_temp.check((select source from public.directory_requests where club_name = 'ODR Imported RUFC') = 'lancashire_rfu',
    'OD26 a curated bulk import, written by the server, keeps its provenance');
end $$;

-- =====================================================================================================
-- 7. A LEGACY GUARDIAN INVITATION IS USED ONCE, FOR WHAT IT WAS SENT FOR
-- =====================================================================================================
do $$
declare v_club uuid := pg_temp.club('L', 'active', false); v_team uuid; v_kid uuid; v_inv uuid; v_token text; v_email text;
        v_rel uuid; v text; v_dob date := internal.date_of_birth_in_age_grade('union', 'U12');
begin
  perform pg_temp.put('club_l', v_club);
  perform pg_temp.put('admin_l', pg_temp.person('admin-l'));
  perform pg_temp.member(v_club, pg_temp.id('admin_l'), 'CLUB_ADMIN');
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active, canonical_team_type_id)
  select v_club, 'Under 12 Boys', 'odr-u12-' || substr(gen_random_uuid()::text, 1, 8), 'youth', ct.age_group, ct.gender, 'union', true, ct.id
    from public.canonical_team_types_by_code ct where ct.rugby_code = 'union' and ct.key = 'u12' limit 1
  returning id into v_team;
  perform pg_temp.put('team_l', v_team);
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway) values ('Kit', 'Odr', v_dob, true, 'MALE') returning id into v_kid;
  insert into public.player_team_memberships (player_id, team_id, status, state, source) values (v_kid, v_team, 'active', 'ACTIVE', 'CLUB_CREATED');
  perform pg_temp.put('kid', v_kid);
  perform pg_temp.put('g', pg_temp.person('guardian-g'));
  select email into v_email from auth.users where id = pg_temp.id('g');

  -- The club's replacement link for Kit, accepted and used by the person it was sent to.
  v_inv := pg_temp.uuid_as(pg_temp.id('admin_l'), format('select invitation_id from public.send_replacement_guardian_invitation(%L, %L, %L)', v_kid, v_team, v_email));
  perform pg_temp.put('inv_g', v_inv);
  select token into v_token from public.guardian_invitations where id = v_inv;
  v := pg_temp.say_as(pg_temp.id('g'), format('select * from public.accept_guardian_invitation(%L)', v_token));
  v := v || ' / ' || pg_temp.say_as(pg_temp.id('g'), format('select public.link_guardian_to_existing_player(%L, %L)', v_inv, v_kid));
  select id into v_rel from public.guardians where guardian_user_id = pg_temp.id('g') and player_id = v_kid and state = 'ACTIVE';
  perform pg_temp.check(v = 'OK / OK' and v_rel is not null and (select used_at is not null from public.guardian_invitations where id = v_inv),
    'OD27 the club''s replacement link links the person it was sent to, once, and is spent (' || v || ')');

  -- The club removes them; the link they still hold cannot bring them back.
  v := pg_temp.say_as(pg_temp.id('admin_l'), format('select public.remove_guardian_relationship(%L, ''Club decision'')', v_rel));
  v := v || ' / ' || pg_temp.say_as(pg_temp.id('g'), format('select public.link_guardian_to_existing_player(%L, %L)', v_inv, v_kid));
  perform pg_temp.check(v like 'OK / 42501%already been used%'
                        and not exists (select 1 from public.guardians where guardian_user_id = pg_temp.id('g') and player_id = v_kid and state = 'ACTIVE'),
    'OD28 a guardian the club removed cannot re-link themselves with the invitation they already used (' || left(v, 90) || ')');

  v := pg_temp.say_as(pg_temp.id('g'), format('select * from public.create_player_for_guardian(%L, ''New'', ''Odr'', %L, ''MALE'')', v_inv, v_dob));
  perform pg_temp.check(v like '42501%cannot add a new child%' and not exists (select 1 from public.players where first_name = 'New' and surname = 'Odr'),
    'OD29 a replacement link never creates a new child with a team place (' || left(v, 80) || ')');

  perform pg_temp.as_(pg_temp.id('g'));
  perform pg_temp.check(internal.may_add_child_at_club(v_club) is null,
    'OD30 the club''s trust in a person it invited ends when it ends the relationship that invitation made');
  perform pg_temp.off();
end $$;

do $$
declare v_inv uuid; v_token text; v_email text; v text; v_dob date := internal.date_of_birth_in_age_grade('union', 'U12');
begin
  -- An ordinary legacy invitation (no function makes one any more; older rows exist): one child, once.
  perform pg_temp.put('g3', pg_temp.person('guardian-3'));
  select email into v_email from auth.users where id = pg_temp.id('g3');
  insert into public.guardian_invitations (club_id, team_id, invited_email, invited_by_user_id)
  values (pg_temp.id('club_l'), pg_temp.id('team_l'), v_email, pg_temp.id('admin_l'))
  returning id, token into v_inv, v_token;
  v := pg_temp.say_as(pg_temp.id('g3'), format('select * from public.accept_guardian_invitation(%L)', v_token));
  v := v || ' / ' || pg_temp.say_as(pg_temp.id('g3'), format('select * from public.create_player_for_guardian(%L, ''Ola'', ''Odr'', %L, ''MALE'')', v_inv, v_dob));
  v := v || ' / ' || pg_temp.say_as(pg_temp.id('g3'), format('select * from public.create_player_for_guardian(%L, ''Ola2'', ''Odr'', %L, ''MALE'')', v_inv, v_dob));
  perform pg_temp.check(v like 'OK / OK / 42501%already been used%'
                        and (select count(*) from public.players where surname = 'Odr' and first_name in ('Ola', 'Ola2')) = 1,
    'OD31 an invitation creates at most one child: the second attempt with it is refused (' || left(v, 90) || ')');

  -- One sent by somebody who no longer holds the authority to send it no longer works.
  insert into public.guardian_invitations (club_id, team_id, invited_email, invited_by_user_id, replacement_for_player_id, status, accepted_by, accepted_at)
  values (pg_temp.id('club_l'), pg_temp.id('team_l'), v_email, pg_temp.id('g3'), pg_temp.id('kid'), 'accepted', pg_temp.id('g3'), now())
  returning id into v_inv;
  v := pg_temp.say_as(pg_temp.id('g3'), format('select public.link_guardian_to_existing_player(%L, %L)', v_inv, pg_temp.id('kid')));
  perform pg_temp.check(v like '42501%can no longer be used%'
                        and not exists (select 1 from public.guardians where guardian_user_id = pg_temp.id('g3') and player_id = pg_temp.id('kid')),
    'OD32 an invitation whose sender does not hold the authority to send it links nobody (' || left(v, 80) || ')');
end $$;

rollback;
