-- =====================================================================================================
-- ADMISSION JOURNEYS, END TO END (the overnight programme of 5-6 October 2026, brief section 4)
--
-- Isolated RPC tests prove each door; these prove the ESTATE, by walking one club's life through the
-- canonical doors in order, as the people who use them, and checking after every step that there is still
-- one person, one club relationship and one record of each thing:
--
--   JD  CLUB REFERRAL. An Ovalball club's referral link -> a claim made through it -> Ovalball approves it ->
--       the club exists with its first authorised Club Admin -> the referral is attributed to the referrer,
--       registered and unpaid -> the new club's first payment qualifies it and credits the referrer once.
--   JA  JUNIOR PLAYER. The new club's teams -> its membership product -> a team code -> a parent new to the
--       club asks for a place for a child who is a year young -> refused at the door -> asks again with a
--       dispensation -> the team cannot act -> the Safeguarding Officer approves -> the place is approved ->
--       the membership requirement is now visible to the parent and the club. One child, one guardian link.
--   JB  EXISTING PARENT BECOMES STAFF. That parent is offered a coaching role by a staff invitation, accepts
--       with the same account -> the same person, one club membership, the role, its permission; asking
--       twice is one invitation. An existing member is found by the staff picker and given a role on their
--       own membership row.
--   JC  TEAM SELF-MANAGEMENT. A Team Manager issues their team's code and places an in-grade child; cannot
--       place an out-of-grade child or decide its dispensation; cannot grant outside their authority. A Team
--       Admin gives Volunteer at their own team and nowhere else. A minor cannot join as a club member on
--       their own through any door (20270745000000).
--   JE  DEACTIVATION / REMOVAL. A coach who is also a guardian and the child's responsible payer is
--       deactivated (access stops, roles pause, the money relationship is untouched by rule), reactivated
--       (the same membership and roles return), removed (roles end, history stays, the money relationship
--       is untouched by rule and shows on the club's membership board), and invited back (a new membership
--       row; never a second person, a second payer or a second active enrolment).
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
create temp table secrets (k text primary key, token text) on commit drop;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ctx where k = p_k $$;
create or replace function pg_temp.put(p_k text, p_v uuid) returns uuid language sql as $$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v returning v $$;
create or replace function pg_temp.token(p_k text) returns text language sql as $$ select token from secrets where k = p_k $$;
create or replace function pg_temp.dob(p_age text) returns date language sql as $$
  select internal.date_of_birth_in_age_grade('union', p_age) $$;
create or replace function pg_temp.email(p_label text) returns text language sql as $$
  select 'jrn-' || lower(p_label) || '-' || substr(md5(p_label || txid_current()::text), 1, 8) || '@ovalball.test' $$;

create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '38 years')::date)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_email text := pg_temp.email(p_label);
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v, p_label, 'Journey', v_email, p_dob, 'ACTIVE')
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname,
                                 date_of_birth = excluded.date_of_birth, account_state = 'ACTIVE';
  return v;
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
create or replace function pg_temp.json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform pg_temp.off();
  return v;
end $$;
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
create or replace function pg_temp.can_as(p_subject uuid, p_key text, p_scope text, p_club uuid, p_team uuid) returns boolean
language plpgsql as $$
declare v boolean;
begin
  perform pg_temp.as_(p_subject);
  v := internal.can(p_key, p_scope, p_club, p_team, null);
  perform pg_temp.off();
  return coalesce(v, false);
end $$;

-- The open membership of a person at a club, and how many membership rows (open or closed) they have there.
create or replace function pg_temp.membership(p_club uuid, p_user uuid) returns uuid language sql as $$
  select id from public.club_memberships where club_id = p_club and user_id = p_user and state in ('ACTIVE', 'SUSPENDED', 'PENDING')
  order by created_at desc limit 1 $$;
create or replace function pg_temp.membership_rows(p_club uuid, p_user uuid) returns bigint language sql as $$
  select count(*) from public.club_memberships where club_id = p_club and user_id = p_user $$;
-- Supporting cast only: the journeys' own subjects are admitted through the real doors.
create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;
create or replace function pg_temp.place(p_player uuid, p_team uuid) returns public.player_team_memberships language sql as $$
  select * from public.player_team_memberships where player_id = p_player and team_id = p_team order by created_at desc limit 1 $$;
create or replace function pg_temp.open_roles(p_membership uuid, p_role text, p_team uuid default null) returns bigint language sql as $$
  select count(*) from public.role_assignments
   where membership_id = p_membership and role_key = p_role and team_id is not distinct from p_team and state = 'ACTIVE' $$;

-- =====================================================================================================
-- SEED: Ovalball (a Site Admin), an Ovalball club on a plan that refers others, and the club-to-be.
-- =====================================================================================================
do $$
declare v_tag text := substr(gen_random_uuid()::text, 1, 8); v_dir uuid; v_ref uuid;
begin
  perform pg_temp.put('site', pg_temp.person('Site'));
  insert into public.site_admins (user_id, profile_key, status) values (pg_temp.id('site'), 'SITE_FULL', 'active')
  on conflict (user_id) do update set status = 'active', profile_key = 'SITE_FULL';

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Journey Referrer ' || v_tag || ' RFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'jrn-ref-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'jrn-ref-' || v_tag, 'active') returning id into v_ref;
  insert into public.platform_club_subscriptions (club_id, plan_code, plan_price_pence, plan_price_version, status, started_at, provider_mandate_id)
  select v_ref, 'standard', p.price_pence, p.price_version, 'active', now(), 'MD_JRN_' || v_tag from public.platform_plans p where p.code = 'standard';
  perform pg_temp.put('referrer', v_ref);
  perform pg_temp.put('ref_admin', pg_temp.person('Rhiannon'));
  perform pg_temp.member(v_ref, pg_temp.id('ref_admin'), 'CLUB_ADMIN');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Journey Vale ' || v_tag || ' RFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'jrn-vale-' || v_tag)
  returning id into v_dir;
  perform pg_temp.put('vale_dir', v_dir);

  -- The people of the journeys. Alex claims the club; Pat is a parent new to it; Mo is already a member;
  -- Tom and Tia run the Under 12s; Sue is the club's Safeguarding Officer; Kim is another parent; Ivy is 14
  -- and has her own login.
  perform pg_temp.put('alex', pg_temp.person('Alex'));
  perform pg_temp.put('pat', pg_temp.person('Pat'));
  perform pg_temp.put('mo', pg_temp.person('Mo'));
  perform pg_temp.put('tom', pg_temp.person('Tom'));
  perform pg_temp.put('tia', pg_temp.person('Tia'));
  perform pg_temp.put('sue', pg_temp.person('Sue'));
  perform pg_temp.put('kim', pg_temp.person('Kim'));
  perform pg_temp.put('ivy', pg_temp.person('Ivy', (current_date - interval '14 years 3 months')::date));
end $$;

-- =====================================================================================================
-- JD. CLUB REFERRAL -> CLAIM -> FIRST AUTHORISED CLUB ADMIN -> ATTRIBUTION -> REWARD
-- =====================================================================================================
do $$
declare v_slug text; v_claim uuid; v_res jsonb; v_club uuid; v_ref record; v_credit uuid; v_sub uuid; v_payment uuid; v_price int; v text;
begin
  -- The referrer's own link is its slug (/r/<slug>); the claim made through it carries it.
  select slug into v_slug from public.clubs where id = pg_temp.id('referrer');
  v_claim := pg_temp.uuid_as(pg_temp.id('alex'), format(
               'select public.submit_club_claim(%L, ''Club Secretary'', ''I am the club secretary and may act for the club.'', ''{}''::jsonb, %L, %L::jsonb)',
               pg_temp.id('vale_dir'), v_slug,
               -- What signup sends: each team by its display name, a squad letter where one was ticked.
               '[{"category":"Under 13 Boys","additionalLetters":[]},{"category":"Under 10 Mixed","additionalLetters":[]},{"category":"Under 14 Girls","additionalLetters":["B"]}]'));
  perform pg_temp.put('claim', v_claim);
  perform pg_temp.check((select state from public.club_claims where id = v_claim) = 'SUBMITTED'
                        and (select referred_by_club_id from public.club_claims where id = v_claim) = pg_temp.id('referrer'),
    'JD1 a claim made through another club''s referral link is submitted and remembers who introduced it');

  -- Nobody but Ovalball decides it: not the claimant, not the referring club.
  perform pg_temp.check(pg_temp.state_as(pg_temp.id('alex'), format('select public.decide_club_claim(%L, ''APPROVED'', ''me'', null)', v_claim)) = '42501'
                        and pg_temp.state_as(pg_temp.id('ref_admin'), format('select public.decide_club_claim(%L, ''APPROVED'', ''me'', null)', v_claim)) = '42501',
    'JD2 the claimant cannot approve their own claim, and neither can the club that referred them');

  v_res := pg_temp.json_as(pg_temp.id('site'), format('select public.decide_club_claim(%L, ''APPROVED'', ''Journey: verified with the RFU listing'', null)', v_claim));
  v_club := (v_res ->> 'club_id')::uuid;
  perform pg_temp.put('vale', v_club);
  perform pg_temp.put('alex_ms', pg_temp.membership(v_club, pg_temp.id('alex')));
  perform pg_temp.check(v_club is not null
                        and (select status from public.clubs where id = v_club) = 'active'
                        and (select state from public.club_memberships where id = pg_temp.id('alex_ms')) = 'ACTIVE'
                        and pg_temp.open_roles(pg_temp.id('alex_ms'), 'CLUB_ADMIN') = 1
                        and pg_temp.can_as(pg_temp.id('alex'), 'people.invitation.create', 'club', v_club, null),
    'JD3 approval creates the club with the claimant as its first authorised Club Admin: one membership, one Club Admin role, authority that works');

  -- 20270747000000: the teams signup proposed are seeded at approval -- boys and mixed sides too.
  perform pg_temp.check((select count(*) from public.teams where club_id = v_club and age_group = 'U13' and gender = 'boys' and squad_designation is null) = 1
                        and (select count(*) from public.teams where club_id = v_club and age_group = 'U10' and gender = 'mixed') = 1
                        and (select count(*) from public.teams where club_id = v_club and age_group = 'U14' and gender = 'girls') = 2
                        and (select count(*) from public.teams where club_id = v_club and age_group = 'U14' and gender = 'girls' and squad_designation = 'B') = 1,
    'JD3b approval seeds every team signup proposed, by its display name -- boys and mixed sides as well as girls, with the squad letter');

  select * into v_ref from public.platform_referrals where referring_club_id = pg_temp.id('referrer') and referred_club_id = v_club;
  perform pg_temp.check(v_ref.id is not null and v_ref.status = 'registered' and v_ref.attribution_source = 'link'
                        and v_ref.reward_credit_id is null
                        and not exists (select 1 from public.platform_credits where club_id = pg_temp.id('referrer') and source = 'referral_reward'),
    'JD4 the referral is attributed to the club whose link was used, registered, and not yet rewarded');

  -- The new club's first payment to Ovalball is what earns the reward -- once.
  select price_pence into v_price from public.platform_plans where code = 'standard';
  insert into public.platform_club_subscriptions (club_id, plan_code, plan_price_pence, plan_price_version, status, started_at, provider_mandate_id)
  select v_club, 'standard', p.price_pence, p.price_version, 'active', now(), 'MD_JRN_VALE_' || substr(v_club::text, 1, 8)
    from public.platform_plans p where p.code = 'standard'
  returning id into v_sub;
  insert into public.platform_payments (id, club_id, subscription_id, gross_pence, net_pence, status, charge_date, confirmed_at, idempotency_key)
  values (gen_random_uuid(), v_club, v_sub, v_price, v_price, 'confirmed', current_date, now(), 'jrn-' || substr(gen_random_uuid()::text, 1, 12))
  returning id into v_payment;
  v_credit := internal.qualify_referral_for_payment(v_payment);
  perform pg_temp.check(v_credit is not null
                        and (select status from public.platform_referrals where id = v_ref.id) = 'qualified'
                        and (select club_id from public.platform_credits where id = v_credit) = pg_temp.id('referrer')
                        and internal.qualify_referral_for_payment(v_payment) is null
                        and (select count(*) from public.platform_credits where club_id = pg_temp.id('referrer') and source = 'referral_reward') = 1,
    'JD5 the referred club''s first payment qualifies the referral and credits the referrer exactly once');
end $$;

-- =====================================================================================================
-- JA. JUNIOR PLAYER: teams -> membership product -> team code -> out-of-grade refused -> dispensation ->
--     approval -> placement -> the membership requirement is visible
-- =====================================================================================================
do $$
declare v_club uuid := pg_temp.id('vale'); inv record; v_res jsonb; v_prog uuid; v text; m public.player_team_memberships;
        v_disp uuid; v_elig record;
begin
  -- The club's teams, through the one team door, by canonical identity.
  perform pg_temp.put('u12', pg_temp.uuid_as(pg_temp.id('alex'), format('select public.create_club_team(%L, ''u12'', null)', v_club)));
  perform pg_temp.put('u11', pg_temp.uuid_as(pg_temp.id('alex'), format('select public.create_club_team(%L, ''u11'', null)', v_club)));
  perform pg_temp.check((select age_group || '/' || gender from public.teams where id = pg_temp.id('u12')) = 'U12/boys'
                        and (select age_group || '/' || gender from public.teams where id = pg_temp.id('u11')) = 'U11/mixed',
    'JA1 the Club Admin creates the Under 12 Boys and Under 11 Mixed through the canonical team door');

  -- Its Safeguarding Officer: nominated by the club, confirmed by Ovalball.
  perform pg_temp.member(v_club, pg_temp.id('sue'));
  v_res := pg_temp.json_as(pg_temp.id('alex'), format('select public.nominate_club_safeguarding_officer(%L,%L,''primary'',''Journey: our officer'')',
                                                     v_club, pg_temp.id('sue')));
  perform pg_temp.json_as(pg_temp.id('site'), format('select to_jsonb(public.confirm_safeguarding_officer(%L,''Journey: confirming the officer''))',
                                                    v_res ->> 'assignment_id'));
  perform pg_temp.check(internal.is_active_safeguarding_officer(pg_temp.id('sue'), v_club),
    'JA2 the club''s Safeguarding Officer is nominated by the club and confirmed by Ovalball');

  -- Its membership product: on, collected on the 1st, £16 a month from today. The Club Admin sets it up switched
  -- off, as configure always does now.
  v_prog := pg_temp.uuid_as(pg_temp.id('alex'), format('select public.configure_subscription_programme(%L, false, 1, ''GOCARDLESS_APP_FEE'', ''NEXT_COLLECTION_DAY'')', v_club));
  -- FIXTURE STEP, as postgres (this block's own role): switch it on directly. Only Activate can switch memberships
  -- on, after checking the club's terms, a verified GoCardless account and a priced membership with a team --
  -- none of which this journey is about.
  update public.club_subscription_programmes set enabled = true, activated_at = coalesce(activated_at, now()) where id = v_prog;
  perform pg_temp.put('programme', v_prog);
  perform pg_temp.uuid_as(pg_temp.id('alex'), format('select public.set_subscription_price(%L, 1600, current_date)', v_prog));
  perform pg_temp.check((select enabled from public.club_subscription_programmes where id = v_prog)
                        and (select amount_minor from public.club_subscription_pricing where programme_id = v_prog) = 1600,
    'JA3 the club runs a membership product with a price');

  perform pg_temp.as_(pg_temp.id('alex'));
  select * into inv from public.issue_invitation('TEAM_JOIN_CODE', null, pg_temp.id('u12'), null, null, null, null, '{}'::jsonb, 50);
  perform pg_temp.off();
  insert into secrets values ('u12', inv.token);
  perform pg_temp.check(inv.token is not null, 'JA4 the Under 12s'' team code is issued');

  -- Pat, new to the club, asks for a place for Yan, who is a year young for the Under 12s.
  v_res := pg_temp.json_as(pg_temp.id('pat'), format('select public.redeem_invitation(%L, null, %L::jsonb)', pg_temp.token('u12'),
             jsonb_build_object('for', 'NEW_CHILD', 'first_name', 'Yan', 'surname', 'Journey', 'date_of_birth', pg_temp.dob('U11'), 'playing_pathway', 'MALE')));
  perform pg_temp.check(v_res ->> 'outcome' = 'REFUSED'
                        and not exists (select 1 from public.players where first_name = 'Yan' and surname = 'Journey')
                        and not exists (select 1 from public.player_team_memberships ptm where ptm.team_id = pg_temp.id('u12')),
    'JA5 a child outside the team''s age grade is refused at the door: no player, no place (' || coalesce(v_res ->> 'message', v_res::text) || ')');

  v_res := pg_temp.json_as(pg_temp.id('pat'), format('select public.redeem_invitation(%L, null, %L::jsonb)', pg_temp.token('u12'),
             jsonb_build_object('for', 'NEW_CHILD', 'first_name', 'Yan', 'surname', 'Journey', 'date_of_birth', pg_temp.dob('U11'), 'playing_pathway', 'MALE',
                                'dispensation_reason', 'His older brother plays in this team and he trains with them already')));
  perform pg_temp.put('yan', (select id from public.players where first_name = 'Yan' and surname = 'Journey'));
  m := pg_temp.place(pg_temp.id('yan'), pg_temp.id('u12'));
  v_disp := m.dispensation_id;
  perform pg_temp.put('yan_disp', v_disp);
  perform pg_temp.check(v_res ->> 'outcome' = 'TEAM_PLACE_PENDING' and (v_res ->> 'awaiting_dispensation')::boolean
                        and m.state = 'PENDING' and v_disp is not null
                        and (select status from public.player_team_dispensation where id = v_disp) = 'requested'
                        and (select count(*) from public.guardians where player_id = pg_temp.id('yan') and guardian_user_id = pg_temp.id('pat')
                               and state = 'PENDING_APPROVAL') = 1,
    'JA6 asking again WITH a dispensation creates the child once, links the parent once (pending, like the place), and the place waits on the dispensation');

  -- Asking is not granting: the team (here its Club Admin) cannot place him while it waits.
  v := pg_temp.say_as(pg_temp.id('alex'), format('select public.approve_pending_team_membership(%L)', m.id));
  perform pg_temp.check(v like '23514%' and (pg_temp.place(pg_temp.id('yan'), pg_temp.id('u12'))).state = 'PENDING',
    'JA7 while the dispensation waits nobody can place him (' || v || ')');

  v := pg_temp.say_as(pg_temp.id('sue'), format('select public.decide_dispensation(%L, true, %L, null)', v_disp, 'Journey: playing up with his brother is safe'));
  perform pg_temp.check(v = 'OK' and (select status from public.player_team_dispensation where id = v_disp) = 'approved',
    'JA8 the Safeguarding Officer approves the dispensation (' || v || ')');

  v := pg_temp.say_as(pg_temp.id('alex'), format('select public.approve_pending_team_membership(%L)', m.id));
  perform pg_temp.check(v = 'OK' and (pg_temp.place(pg_temp.id('yan'), pg_temp.id('u12'))).state = 'ACTIVE'
                        and (select state from public.guardians where player_id = pg_temp.id('yan') and guardian_user_id = pg_temp.id('pat')) = 'ACTIVE',
    'JA9 and only then is the place approved, and the parent''s link with it (' || v || ')');

  -- The membership requirement is now visible: the parent may set it up; nothing is set up yet.
  perform pg_temp.as_(pg_temp.id('pat'));
  select * into v_elig from public.get_enrolment_eligibility(pg_temp.id('yan'), v_club);
  perform pg_temp.off();
  perform pg_temp.check(v_elig.programme_enabled and v_elig.has_pricing and v_elig.player_has_active_membership
                        and v_elig.existing_payer_subscription_id is null and v_elig.programme_id = v_prog,
    'JA10 the place makes the club''s membership requirement visible to the parent: a product, a price, and nothing set up yet');
  perform pg_temp.check((select count(*) from public.players where first_name = 'Yan' and surname = 'Journey') = 1
                        and (select count(*) from public.guardians where player_id = pg_temp.id('yan')) = 1
                        and (select count(*) from public.player_team_memberships where player_id = pg_temp.id('yan')) = 1,
    'JA11 one child, one guardian link, one place -- however many times the door was used');
end $$;

-- =====================================================================================================
-- JB. EXISTING PARENT / MEMBER BECOMES STAFF
-- =====================================================================================================
do $$
declare v_club uuid := pg_temp.id('vale'); inv record; v2 record; v_res jsonb; v_ms uuid; v text; v_candidates jsonb; v_rows_before bigint;
begin
  -- Pat (a parent at the club) is asked to coach the Under 11s.
  perform pg_temp.as_(pg_temp.id('alex'));
  select * into inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    (select email from auth.users where id = pg_temp.id('pat')),
    jsonb_build_object('roles', jsonb_build_array('MEMBER'), 'invitee_name', 'Pat Journey'), null, null,
    jsonb_build_array(jsonb_build_object('id', pg_temp.id('u11'), 'roles', jsonb_build_array('COACH'))));
  select * into v2 from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    (select email from auth.users where id = pg_temp.id('pat')),
    jsonb_build_object('roles', jsonb_build_array('MEMBER'), 'invitee_name', 'Pat Journey'), null, null,
    jsonb_build_array(jsonb_build_object('id', pg_temp.id('u11'), 'roles', jsonb_build_array('COACH'))));
  perform pg_temp.off();
  insert into secrets values ('pat_staff', inv.token);
  perform pg_temp.put('pat_staff_inv', inv.invitation_id);
  perform pg_temp.check(inv.invitation_id is not null and v2.already_existed and v2.invitation_id = inv.invitation_id
                        and (select count(*) from public.access_invitations where kind = 'CLUB_STAFF' and club_id = v_club
                               and invited_email_normalised = lower((select email from auth.users where id = pg_temp.id('pat')))) = 1,
    'JB1 offering the parent a coaching role is one staff invitation; asking twice returns the same one');

  v_rows_before := (select count(*) from auth.users) + (select count(*) from public.profiles) + (select count(*) from public.players);
  v_res := pg_temp.json_as(pg_temp.id('pat'), format('select public.redeem_invitation(%L, null, null)', pg_temp.token('pat_staff')));
  v_ms := pg_temp.membership(v_club, pg_temp.id('pat'));
  perform pg_temp.put('pat_ms', v_ms);
  perform pg_temp.check(v_res ->> 'outcome' = 'MEMBERSHIP_ACTIVE'
                        and (select state from public.club_memberships where id = v_ms) = 'ACTIVE'
                        and pg_temp.membership_rows(v_club, pg_temp.id('pat')) = 1
                        and pg_temp.open_roles(v_ms, 'COACH', pg_temp.id('u11')) = 1
                        and (select count(*) from auth.users) + (select count(*) from public.profiles) + (select count(*) from public.players) = v_rows_before,
    'JB2 the parent accepts with the same account: the same person, one club membership, the Coach role -- no new person, profile or player');
  perform pg_temp.check(pg_temp.can_as(pg_temp.id('pat'), 'team.roster.view', 'team', v_club, pg_temp.id('u11'))
                        and not pg_temp.can_as(pg_temp.id('pat'), 'team.roster.view', 'team', v_club, pg_temp.id('u12'))
                        and (select count(*) from public.guardians where guardian_user_id = pg_temp.id('pat') and state = 'ACTIVE') = 1,
    'JB3 the Coach role works at the Under 11s and nowhere else, and they are still Yan''s parent');

  -- Mo is already a member: the staff picker finds them, and the role lands on their own membership row.
  perform pg_temp.put('mo_ms', pg_temp.member(v_club, pg_temp.id('mo')));
  v_candidates := pg_temp.json_as(pg_temp.id('alex'), format('select coalesce(jsonb_agg(c), ''[]''::jsonb) from public.team_staff_candidates(%L, ''Mo'', 20) c', pg_temp.id('u12')));
  perform pg_temp.check(exists (select 1 from jsonb_array_elements(v_candidates) c where (c ->> 'membership_id')::uuid = pg_temp.id('mo_ms')),
    'JB4 an existing member is found by the team''s staff picker');
  v := pg_temp.say_as(pg_temp.id('alex'), format('select public.assign_role(%L, ''COACH'', %L, ''Journey: helping with the Under 12s'')', pg_temp.id('mo_ms'), pg_temp.id('u12')));
  perform pg_temp.check(v = 'OK' and pg_temp.membership_rows(v_club, pg_temp.id('mo')) = 1
                        and pg_temp.open_roles(pg_temp.id('mo_ms'), 'COACH', pg_temp.id('u12')) = 1
                        and pg_temp.can_as(pg_temp.id('mo'), 'team.roster.view', 'team', v_club, pg_temp.id('u12')),
    'JB5 and is made a Coach on their own membership row: no second membership, the permission effective (' || v || ')');
end $$;

-- =====================================================================================================
-- JC. TEAM SELF-MANAGEMENT, AND A MINOR CANNOT JOIN AS A MEMBER ON THEIR OWN
-- =====================================================================================================
do $$
declare v_club uuid := pg_temp.id('vale'); inv record; v_res jsonb; v text; v_code text; v_plain text; m public.player_team_memberships; v_req uuid;
begin
  perform pg_temp.put('tom_ms', pg_temp.member(v_club, pg_temp.id('tom')));
  perform pg_temp.put('tia_ms', pg_temp.member(v_club, pg_temp.id('tia')));
  perform pg_temp.check(pg_temp.state_as(pg_temp.id('alex'), format('select public.assign_role(%L, ''TEAM_MANAGER'', %L, ''Journey'')', pg_temp.id('tom_ms'), pg_temp.id('u12'))) = 'OK'
                        and pg_temp.state_as(pg_temp.id('alex'), format('select public.assign_role(%L, ''COACH'', %L, ''Journey'')', pg_temp.id('tia_ms'), pg_temp.id('u12'))) = 'OK'
                        and pg_temp.state_as(pg_temp.id('alex'), format('select public.assign_role(%L, ''TEAM_ADMINISTRATION'', %L, ''Journey'')', pg_temp.id('tia_ms'), pg_temp.id('u12'))) = 'OK',
    'JC0 the club makes Tom the Under 12s'' Team Manager and Tia their coach and Team Admin');

  -- The Team Manager's own code, and an in-grade child placed by the team itself.
  perform pg_temp.as_(pg_temp.id('tom'));
  select * into inv from public.issue_invitation('TEAM_JOIN_CODE', null, pg_temp.id('u12'), null, null, null, null, '{}'::jsonb, 50);
  perform pg_temp.off();
  insert into secrets values ('u12_tom', inv.token);
  v_res := pg_temp.json_as(pg_temp.id('kim'), format('select public.redeem_invitation(%L, null, %L::jsonb)', coalesce(inv.token, pg_temp.token('u12')),
             jsonb_build_object('for', 'NEW_CHILD', 'first_name', 'Kai', 'surname', 'Journey', 'date_of_birth', pg_temp.dob('U12'), 'playing_pathway', 'MALE')));
  perform pg_temp.put('kai', (select id from public.players where first_name = 'Kai' and surname = 'Journey'));
  m := pg_temp.place(pg_temp.id('kai'), pg_temp.id('u12'));
  v := pg_temp.say_as(pg_temp.id('tom'), format('select public.approve_pending_team_membership(%L)', m.id));
  perform pg_temp.check(inv.token is not null and v_res ->> 'outcome' = 'TEAM_PLACE_PENDING' and v = 'OK'
                        and (pg_temp.place(pg_temp.id('kai'), pg_temp.id('u12'))).state = 'ACTIVE',
    'JC1 the Team Manager issues their team''s code and places a child in the team''s own age grade (' || v || ')');

  -- An out-of-grade child: the request waits on a dispensation the team can neither skip nor decide.
  v_res := pg_temp.json_as(pg_temp.id('kim'), format('select public.redeem_invitation(%L, null, %L::jsonb)', coalesce(inv.token, pg_temp.token('u12')),
             jsonb_build_object('for', 'NEW_CHILD', 'first_name', 'Kit', 'surname', 'Journey', 'date_of_birth', pg_temp.dob('U13'), 'playing_pathway', 'MALE',
                                'dispensation_reason', 'He would like to stay with his friends')));
  perform pg_temp.put('kit', (select id from public.players where first_name = 'Kit' and surname = 'Journey'));
  m := pg_temp.place(pg_temp.id('kit'), pg_temp.id('u12'));
  v_req := m.dispensation_id;
  perform pg_temp.check(m.state = 'PENDING' and v_req is not null
                        and pg_temp.say_as(pg_temp.id('tom'), format('select public.approve_pending_team_membership(%L)', m.id)) like '23514%'
                        and pg_temp.state_as(pg_temp.id('tom'), format('select public.decide_dispensation(%L, true, null, null)', v_req)) = '42501'
                        and pg_temp.state_as(pg_temp.id('tia'), format('select public.decide_dispensation(%L, true, null, null)', v_req)) = '42501',
    'JC2 the team cannot place an out-of-grade child, nor decide the dispensation it waits on');
  perform pg_temp.check(pg_temp.state_as(pg_temp.id('tom'), format(
                          'insert into public.player_team_memberships (player_id, team_id, status, state, source) values (%L, %L, ''active'', ''ACTIVE'', ''CLUB_CREATED'')',
                          pg_temp.id('kit'), pg_temp.id('u12'))) in ('42501', '23514')
                        and (pg_temp.place(pg_temp.id('kit'), pg_temp.id('u12'))).state = 'PENDING',
    'JC3 nor write the place directly, around the doors');

  -- Authority ceilings.
  perform pg_temp.check(pg_temp.state_as(pg_temp.id('tom'), format('select public.assign_role(%L, ''CLUB_ADMIN'', null, ''Journey'')', pg_temp.id('mo_ms'))) = '42501'
                        and pg_temp.state_as(pg_temp.id('tom'), format('select public.assign_role(%L, ''COACH'', %L, ''Journey'')', pg_temp.id('mo_ms'), pg_temp.id('u11'))) = '42501'
                        and pg_temp.state_as(pg_temp.id('tom'), format('select public.assign_role(%L, ''VOLUNTEER'', %L, ''Journey'')', pg_temp.id('mo_ms'), pg_temp.id('u12'))) = '42501',
    'JC4 a Team Manager grants nothing: not Club Admin, not a role at another team, not even Volunteer at their own');
  perform pg_temp.check(pg_temp.state_as(pg_temp.id('tia'), format('select public.assign_role(%L, ''VOLUNTEER'', %L, ''Journey: kit'')', pg_temp.id('mo_ms'), pg_temp.id('u12'))) = 'OK'
                        and pg_temp.state_as(pg_temp.id('tia'), format('select public.assign_role(%L, ''VOLUNTEER'', %L, ''Journey'')', pg_temp.id('mo_ms'), pg_temp.id('u11'))) = '42501'
                        and pg_temp.state_as(pg_temp.id('tia'), format('select public.assign_role(%L, ''TEAM_ADMINISTRATION'', %L, ''Journey'')', pg_temp.id('mo_ms'), pg_temp.id('u12'))) = '42501'
                        and pg_temp.state_as(pg_temp.id('tia'), format('select public.assign_role(%L, ''CLUB_ADMIN'', null, ''Journey'')', pg_temp.id('mo_ms'))) = '42501',
    'JC5 a Team Admin gives Volunteer at their own team; nothing at another team, never Team Admin or Club Admin');

  -- A minor cannot be admitted as a club member on their own: not through a team code, not by asking.
  -- Both with no subject (what an older app sends) and naming "MEMBER": the refusal is the server's, not the screen's.
  v_code := pg_temp.say_as(pg_temp.id('ivy'), format('select public.redeem_invitation(%L, null, %L::jsonb)', pg_temp.token('u12'), '{"for":"MEMBER"}'));
  v_plain := pg_temp.say_as(pg_temp.id('ivy'), format('select public.redeem_invitation(%L, null, null)', pg_temp.token('u12')));
  v := pg_temp.say_as(pg_temp.id('ivy'), format('select public.request_club_membership(%L, ''Player'')', v_club));
  perform pg_temp.check(v_code like '23514%parent or guardian%' and v_plain like '23514%' and v like '23514%'
                        and not exists (select 1 from public.club_join_requests where club_id = v_club and requesting_user_id = pg_temp.id('ivy'))
                        and pg_temp.membership(v_club, pg_temp.id('ivy')) is null,
    'JC6 a 14-year-old cannot ask to join the club as a member on their own, by a team code or by asking (' || v_code || ')');
  perform pg_temp.put('ned', pg_temp.person('Ned'));
  v := pg_temp.say_as(pg_temp.id('ned'), format('select public.request_club_membership(%L, ''Parent'')', v_club));
  perform pg_temp.check(v = 'OK' and exists (select 1 from public.club_join_requests where club_id = v_club and requesting_user_id = pg_temp.id('ned') and status = 'pending'),
    'JC6b while an adult new to the club still can ask (' || v || ')');
end $$;

-- A request a minor made before that was refused cannot be approved into a membership either.
do $$
declare v_club uuid := pg_temp.id('vale'); v_req uuid; v text; v_trigger_on boolean;
begin
  -- Written the way an old request was, before the refusal existed (the table guard is set aside for this one row).
  select exists (select 1 from pg_trigger where tgrelid = 'public.club_join_requests'::regclass and tgname = 'club_join_requests_refuse_minor_member')
    into v_trigger_on;
  if v_trigger_on then alter table public.club_join_requests disable trigger club_join_requests_refuse_minor_member; end if;
  insert into public.club_join_requests (club_id, requesting_user_id, requested_role, status)
  values (v_club, pg_temp.id('ivy'), 'BASIC_USER', 'pending') returning id into v_req;
  if v_trigger_on then alter table public.club_join_requests enable trigger club_join_requests_refuse_minor_member; end if;
  v := pg_temp.say_as(pg_temp.id('alex'), format('select public.decide_club_join_request(%L, ''APPROVE'', null)', v_req));
  perform pg_temp.check(v like '23514%' and (select status from public.club_join_requests where id = v_req) = 'pending'
                        and not exists (select 1 from public.club_memberships where club_id = v_club and user_id = pg_temp.id('ivy') and state = 'ACTIVE'),
    'JC7 a minor''s old member request cannot be approved into a club membership (' || v || ')');
  v := pg_temp.say_as(pg_temp.id('alex'), format('select public.decide_club_join_request(%L, ''DECLINE'', ''Journey: under 18'')', v_req));
  perform pg_temp.check(v = 'OK' and (select status from public.club_join_requests where id = v_req) = 'rejected'
                        and not exists (select 1 from public.club_memberships where club_id = v_club and user_id = pg_temp.id('ivy') and state in ('ACTIVE', 'PENDING')),
    'JC8 but it can still be declined, so it does not wait for ever, and nothing is left open (' || v || ')');
end $$;

-- =====================================================================================================
-- JE. DEACTIVATION / REMOVAL / RETURN of a coach who is also a guardian and the responsible payer
-- =====================================================================================================
do $$
declare v_club uuid := pg_temp.id('vale'); v_payer uuid; v text; v_res jsonb; inv record; v_ms uuid; v_new_ms uuid;
begin
  -- Pat becomes Yan's responsible payer through the one enrolment door.
  v_payer := pg_temp.uuid_as(pg_temp.id('pat'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('yan'), pg_temp.id('programme')));
  perform pg_temp.put('pat_payer', v_payer);
  perform pg_temp.check(v_payer is not null and (select status from public.player_subscription_payers where id = v_payer) = 'active'
                        and (select payer_user_id from public.player_subscription_payers where id = v_payer) = pg_temp.id('pat'),
    'JE0 the parent is the child''s responsible payer -- a person, never the child');

  -- Deactivate: access stops, the roles pause, the record and the money relationship stay exactly as they were.
  v := pg_temp.say_as(pg_temp.id('alex'), format('select public.transition_club_membership(%L, ''SUSPENDED'', ''Journey: paused while we check something'', false)', pg_temp.id('pat_ms')));
  perform pg_temp.check(v = 'OK' and (select state from public.club_memberships where id = pg_temp.id('pat_ms')) = 'SUSPENDED'
                        and not pg_temp.can_as(pg_temp.id('pat'), 'team.roster.view', 'team', v_club, pg_temp.id('u11'))
                        and exists (select 1 from public.role_assignments where membership_id = pg_temp.id('pat_ms') and role_key = 'COACH' and state = 'SUSPENDED'),
    'JE1 deactivating stops the coach''s access at once and pauses (does not delete) the role (' || v || ')');
  perform pg_temp.check((select status from public.player_subscription_payers where id = v_payer) = 'active'
                        and (pg_temp.place(pg_temp.id('yan'), pg_temp.id('u12'))).state = 'ACTIVE'
                        and exists (select 1 from public.guardians where player_id = pg_temp.id('yan') and guardian_user_id = pg_temp.id('pat') and state = 'ACTIVE'),
    'JE2 by rule it does not touch the child''s place, the guardian link or the money relationship');

  v := pg_temp.say_as(pg_temp.id('alex'), format('select public.transition_club_membership(%L, ''ACTIVE'', ''Journey: all clear'', false)', pg_temp.id('pat_ms')));
  perform pg_temp.check(v = 'OK' and pg_temp.membership(v_club, pg_temp.id('pat')) = pg_temp.id('pat_ms')
                        and pg_temp.membership_rows(v_club, pg_temp.id('pat')) = 1
                        and pg_temp.open_roles(pg_temp.id('pat_ms'), 'COACH', pg_temp.id('u11')) = 1
                        and pg_temp.can_as(pg_temp.id('pat'), 'team.roster.view', 'team', v_club, pg_temp.id('u11')),
    'JE3 reactivating restores the same membership and the same role -- nothing duplicated (' || v || ')');

  -- Remove: the relationship ends, its history stays, the roles end; the money relationship is untouched by rule.
  v := pg_temp.say_as(pg_temp.id('alex'), format('select public.transition_club_membership(%L, ''REVOKED'', ''Journey: stepped down'', false)', pg_temp.id('pat_ms')));
  perform pg_temp.check(v = 'OK' and (select state from public.club_memberships where id = pg_temp.id('pat_ms')) = 'REVOKED'
                        and not pg_temp.can_as(pg_temp.id('pat'), 'team.roster.view', 'team', v_club, pg_temp.id('u11'))
                        and pg_temp.open_roles(pg_temp.id('pat_ms'), 'COACH', pg_temp.id('u11')) = 0
                        and exists (select 1 from public.role_assignments where membership_id = pg_temp.id('pat_ms') and role_key = 'COACH'),
    'JE4 removing ends the membership and the role, and keeps both as history (' || v || ')');
  perform pg_temp.check((select status from public.player_subscription_payers where id = v_payer) = 'active'
                        and (pg_temp.place(pg_temp.id('yan'), pg_temp.id('u12'))).state = 'ACTIVE',
    'JE5 by rule the child''s place and the responsible payer are untouched: staff removal is not leaving as a family');

  -- The old staff invitation does not let them back in.
  v_res := pg_temp.json_as(pg_temp.id('pat'), format('select public.redeem_invitation(%L, null, null)', pg_temp.token('pat_staff')));
  perform pg_temp.check(coalesce(v_res ->> 'outcome', '') not in ('MEMBERSHIP_ACTIVE', 'ACCEPTED')
                        and pg_temp.membership(v_club, pg_temp.id('pat')) is null,
    'JE6 a removed member cannot re-enter with the invitation they already used (' || coalesce(v_res ->> 'outcome', v_res::text) || ')');

  -- Invited back: a new membership row (history kept), never a second person, payer or enrolment.
  perform pg_temp.as_(pg_temp.id('alex'));
  select * into inv from public.issue_invitation('CLUB_STAFF', v_club, null, null, null, null,
    (select email from auth.users where id = pg_temp.id('pat')),
    jsonb_build_object('roles', jsonb_build_array('MEMBER'), 'invitee_name', 'Pat Journey'), null, null, null);
  perform pg_temp.off();
  v_res := pg_temp.json_as(pg_temp.id('pat'), format('select public.redeem_invitation(%L, null, null)', inv.token));
  v_new_ms := pg_temp.membership(v_club, pg_temp.id('pat'));
  perform pg_temp.check(v_res ->> 'outcome' = 'MEMBERSHIP_ACTIVE' and v_new_ms is not null and v_new_ms <> pg_temp.id('pat_ms')
                        and pg_temp.membership_rows(v_club, pg_temp.id('pat')) = 2
                        and pg_temp.open_roles(v_new_ms, 'COACH', pg_temp.id('u11')) = 0,
    'JE7 invited back, they are admitted on a new membership row with only what the new invitation offers; the old one stays as history');
  v := pg_temp.say_as(pg_temp.id('pat'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('yan'), pg_temp.id('programme')));
  perform pg_temp.check(v not like 'OK%'
                        and (select count(*) from public.player_subscription_payers where player_id = pg_temp.id('yan') and status = 'active') = 1
                        and (select count(*) from public.profiles where id = pg_temp.id('pat')) = 1,
    'JE8 and the child still has exactly one active responsible payer: claiming again is refused (' || v || ')');
end $$;

rollback;
