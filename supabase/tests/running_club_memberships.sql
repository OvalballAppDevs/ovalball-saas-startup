-- =====================================================================================================
-- CLUB MEMBERSHIPS, PART 2 -- RUNNING THEM (20270753000000)
--
--   RS1-RS7   THE ONE STANDING knows the membership and whether collecting has started: a Direct Debit in place
--             whose membership was never started is Due (or Overdue), never "Collecting", and the family sees it.
--   RB1-RB6   THE CLUB'S BOARD names each player's membership and lists the club's memberships; its money is the
--             chain gross -> Ovalball's fee -> what reaches the club, honest about refunds and who paid the fee.
--   RT1-RT4   A TEAM'S BOARD is the same standing for the team's own players and carries no money and no payer.
--   RH1-RH6   REMINDER HISTORY: the club sees who was reminded, when, by whom and how many were told; a team's
--             staff see their own team's players only, never who or how many were told.
--   RV1-RV5   THE REMINDER PREVIEW says how many families would be asked and who is left out, shows the exact
--             words the family then receives, records nothing, and has exactly the sending rule.
--   RD1-RD9   ONE MEMBER, ONE READ, for the club's finance viewers only; a payer's contact details only for
--             somebody who may see members' contact details.
--   RL1-RL9   CHANGING WHO PAYS: refused while a collection runs or a payment is on its way; otherwise the old
--             set-up ends (audited, the old payer told, history kept) and another guardian takes it on -- and the
--             old payer's month is never the new payer's.
--   RP1-RP5   A PAUSED CLUB still shows its members to the club, the team and the family; it takes no new ones.
--   RX1-RX7   NEGATIVE: not signed in; a club id, team id or membership id from another club; grants; a Team
--             Manager never reads the club's board or money.
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
create or replace function pg_temp.dob(p_age text) returns date language sql as $$
  select internal.date_of_birth_in_age_grade('union', p_age) $$;
create or replace function pg_temp.period() returns date language sql as $$ select date_trunc('month', current_date)::date $$;

create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '40 years')::date)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_email text := 'rcm-' || lower(p_label) || '-' || v::text || '@ovalball.test';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state, phone_number)
  values (v, p_label, 'Running', v_email, p_dob, 'ACTIVE', '07700 900' || lpad((floor(random() * 1000))::int::text, 3, '0'))
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth,
                                 account_state = 'ACTIVE', phone_number = excluded.phone_number;
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

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_tag text := substr(gen_random_uuid()::text, 1, 8); v_dir uuid; v uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values (p_label || ' ' || v_tag || ' RFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'rcm-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'rcm-' || v_tag, 'active') returning id into v;
  return v;
end $$;
create or replace function pg_temp.team(p_club uuid, p_name text, p_category text, p_age text, p_gender text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, p_name, 'rcm-' || substr(gen_random_uuid()::text, 1, 12), p_category, p_age, p_gender, 'union', true) returning id into v;
  return v;
end $$;
create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;
-- A player, their guardians (if any) and their place (if any).
create or replace function pg_temp.player(p_key text, p_dob date, p_guardians uuid[], p_team uuid, p_user uuid default null) returns uuid language plpgsql as $$
declare v uuid; g uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway, user_id)
  values (initcap(p_key), 'Running', p_dob, true, 'MALE', p_user) returning id into v;
  foreach g in array coalesce(p_guardians, array[]::uuid[]) loop
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
    values (g, v, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD');
  end loop;
  if p_team is not null then
    insert into public.player_team_memberships (player_id, team_id, status, state, source) values (v, p_team, 'active', 'ACTIVE', 'CLUB_CREATED');
  end if;
  perform pg_temp.put(p_key, v);
  return v;
end $$;
create or replace function pg_temp.connect(p_club uuid) returns void language plpgsql as $$
begin
  insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, verification_status, connected_by, connected_at)
  values (p_club, 'sandbox', 'OR_RCM_' || substr(p_club::text, 1, 8), null, 'read_write', 'successful', pg_temp.id('ca'), now())
  on conflict (club_id) do update set verification_status = 'successful', disconnected_at = null, disconnected_by = null;
end $$;
create or replace function pg_temp.product(p_name text) returns uuid language sql as $$
  select id from public.membership_products where club_id = pg_temp.id('club') and name = p_name and status = 'active' $$;
-- An enrolment as the canonical enrolment door writes it (claim_responsible_payer): the membership's price, the
-- club's fee choice (the club pays), collected on the 1st. Started 60 days ago.
create or replace function pg_temp.enrol(p_key text, p_payer uuid, p_relationship text default 'guardian') returns uuid language plpgsql as $$
declare v uuid; v_pricing uuid := (select id from public.club_subscription_pricing where product_id = pg_temp.product('Junior Membership')
                                    order by effective_from desc limit 1);
begin
  insert into public.player_subscription_payers (player_id, programme_id, product_id, payer_user_id, relationship, status, effective_from, created_by,
                                                 base_amount_minor, final_amount_minor, pricing_id, collection_day, first_payment_policy,
                                                 platform_fee_mode, platform_fee_bps)
  values (pg_temp.id(p_key), pg_temp.id('programme'), pg_temp.product('Junior Membership'), p_payer, p_relationship, 'active', current_date - 60, p_payer,
          1600, 1600, v_pricing, 1, 'PRORATE_CURRENT_MONTH', 'GOCARDLESS_APP_FEE', 250)
  returning id into v;
  perform pg_temp.put(p_key || '_psp', v);
  return v;
end $$;
-- This month's obligation, due ten days ago (so "five days past due" holds whatever day the suite runs).
create or replace function pg_temp.owe(p_key text, p_status text) returns uuid language plpgsql as $$
declare v uuid; v_psp public.player_subscription_payers := (select psp from public.player_subscription_payers psp where id = pg_temp.id(p_key || '_psp'));
begin
  insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, product_id, billing_period,
                                             amount_due_minor, due_date, status, platform_fee_mode, platform_fee_bps, platform_fee_minor,
                                             payer_fee_minor)
  values (pg_temp.id('programme'), pg_temp.id('club'), pg_temp.id(p_key), v_psp.id, v_psp.pricing_id, v_psp.product_id, pg_temp.period(),
          1600, current_date - 10, p_status, 'GOCARDLESS_APP_FEE', 250, 40, 0)
  returning id into v;
  perform pg_temp.put(p_key || '_ob', v);
  return v;
end $$;
create or replace function pg_temp.pay(p_key text, p_status text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.gocardless_payments (club_id, obligation_id, gc_payment_id, gross_amount_minor, status, app_fee_minor)
  values (pg_temp.id('club'), pg_temp.id(p_key || '_ob'), 'PM_RCM_' || p_key || '_' || substr(gen_random_uuid()::text, 1, 6), 1600, p_status, 40)
  returning id into v;
  update public.membership_obligations set gocardless_payment_id = v where id = pg_temp.id(p_key || '_ob');
  perform pg_temp.put(p_key || '_pay', v);
  return v;
end $$;
create or replace function pg_temp.mandate(p_key text, p_status text) returns uuid language plpgsql as $$
declare v_br uuid; v uuid; v_payer uuid := (select payer_user_id from public.player_subscription_payers where id = pg_temp.id(p_key || '_psp'));
        v_cust uuid;
begin
  insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id)
  values (pg_temp.id('club'), v_payer, 'CU_RCM_' || substr(v_payer::text, 1, 8))
  on conflict (club_id, payer_user_id) do update set updated_at = now()
  returning id into v_cust;
  insert into public.gocardless_billing_requests (club_id, payer_subscription_id, gc_billing_request_id, status, created_by)
  values (pg_temp.id('club'), pg_temp.id(p_key || '_psp'), 'BRQ_RCM_' || p_key || '_' || substr(gen_random_uuid()::text, 1, 6), 'fulfilled', v_payer)
  returning id into v_br;
  insert into public.gocardless_mandates (club_id, gocardless_customer_id, billing_request_id, gc_mandate_id, status)
  values (pg_temp.id('club'), v_cust, v_br, 'MD_RCM_' || p_key || '_' || substr(gen_random_uuid()::text, 1, 6), p_status)
  returning id into v;
  perform pg_temp.put(p_key || '_md', v);
  return v;
end $$;
-- The payer pressed start: GoCardless is collecting the membership monthly.
create or replace function pg_temp.collecting(p_key text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.gocardless_subscriptions (club_id, payer_subscription_id, gocardless_mandate_id, pricing_id, gc_subscription_id, amount_minor, status)
  values (pg_temp.id('club'), pg_temp.id(p_key || '_psp'), pg_temp.id(p_key || '_md'),
          (select pricing_id from public.player_subscription_payers where id = pg_temp.id(p_key || '_psp')),
          'SB_RCM_' || p_key || '_' || substr(gen_random_uuid()::text, 1, 6), 1600, 'active')
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.row_of(p_board jsonb, p_key text) returns jsonb language sql as $$
  select r from jsonb_array_elements(coalesce(p_board -> 'rows', '[]'::jsonb)) r where (r ->> 'player_id')::uuid = pg_temp.id(p_key) $$;
create or replace function pg_temp.standing(p_board jsonb, p_key text) returns text language sql as $$
  select (pg_temp.row_of(p_board, p_key) ->> 'standing') || '/' || (pg_temp.row_of(p_board, p_key) ->> 'reason') $$;
create or replace function pg_temp.board() returns jsonb language sql as $$
  select pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L)', pg_temp.id('club'))) $$;
create or replace function pg_temp.detail(p_reader text, p_key text) returns jsonb language sql as $$
  select pg_temp.json_as(pg_temp.id(p_reader), format('select public.club_member_membership(%L, %L)', pg_temp.id('club'), pg_temp.id(p_key))) $$;

-- =====================================================================================================
-- SEED: one club with a Junior Membership (Under 12s and Under 13s, £16 a month) and a Senior Membership (the
-- men's side, £30), set up through the canonical doors; its Club Admin, each junior team's Team Manager, an
-- Under 12s coach, a member the club let see its memberships (and nothing else), three parents, an adult
-- player; another club with its own administrator and team.
-- =====================================================================================================
do $$
declare v_club uuid; v_other uuid; v_ms uuid; v_prog uuid; v jsonb;
begin
  v_club := pg_temp.put('club', pg_temp.club('Running'));
  perform pg_temp.put('u12', pg_temp.team(v_club, 'Under 12 Boys', 'youth', 'U12', 'boys'));
  perform pg_temp.put('u13', pg_temp.team(v_club, 'Under 13 Boys', 'youth', 'U13', 'boys'));
  perform pg_temp.put('men', pg_temp.team(v_club, 'Men''s 1st Team', 'senior', null, 'mens'));

  perform pg_temp.put('ca', pg_temp.person('Clubadmin'));
  perform pg_temp.member(v_club, pg_temp.id('ca'), 'CLUB_ADMIN');
  perform pg_temp.put('tm12', pg_temp.person('Manager12'));
  v_ms := pg_temp.member(v_club, pg_temp.id('tm12'));
  perform internal.grant_role(v_ms, 'TEAM_MANAGER', pg_temp.id('u12'), 'LEGACY_BACKFILL', 'rcm seed');
  perform pg_temp.put('tm13', pg_temp.person('Manager13'));
  v_ms := pg_temp.member(v_club, pg_temp.id('tm13'));
  perform internal.grant_role(v_ms, 'TEAM_MANAGER', pg_temp.id('u13'), 'LEGACY_BACKFILL', 'rcm seed');
  perform pg_temp.put('coach12', pg_temp.person('Coach12'));
  v_ms := pg_temp.member(v_club, pg_temp.id('coach12'));
  perform internal.grant_role(v_ms, 'COACH', pg_temp.id('u12'), 'LEGACY_BACKFILL', 'rcm seed');
  -- A member the club allowed to see its memberships, through the existing per-person permission -- and nothing more.
  perform pg_temp.put('viewer', pg_temp.person('Viewer'));
  perform pg_temp.member(v_club, pg_temp.id('viewer'));
  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, status, granted_by, granted_level, reason)
  values (pg_temp.id('viewer'), 'finance.subscription.view', 'club', v_club, null, 'grant', 'active', pg_temp.id('ca'), 'CLUB', 'rcm seed');

  perform pg_temp.put('pam', pg_temp.person('Pam'));
  perform pg_temp.put('gus', pg_temp.person('Gus'));
  perform pg_temp.put('hana', pg_temp.person('Hana'));
  perform pg_temp.put('adam_user', pg_temp.person('Adam', (current_date - interval '25 years')::date));
  perform pg_temp.put('outsider', pg_temp.person('Outsider'));

  v_other := pg_temp.put('other_club', pg_temp.club('Elsewhere'));
  perform pg_temp.put('other_team', pg_temp.team(v_other, 'Under 12 Boys', 'youth', 'U12', 'boys'));
  perform pg_temp.put('other_ca', pg_temp.person('Otheradmin'));
  perform pg_temp.member(v_other, pg_temp.id('other_ca'), 'CLUB_ADMIN');

  -- The club's memberships, through the doors a Club Admin uses.
  v_prog := pg_temp.uuid_as(pg_temp.id('ca'), format('select public.save_membership_settings(%L, 1, %L, %L)', v_club, 'PRORATE_CURRENT_MONTH', 'CLUB'));
  perform pg_temp.put('programme', v_prog);
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.rename_membership_product(%L, %L)', pg_temp.product('Club Membership'), 'Junior Membership'));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_teams(%L, %L::uuid[])', pg_temp.product('Junior Membership'),
                                                  array[pg_temp.id('u12'), pg_temp.id('u13')]));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_price(%L, 1600, current_date)', pg_temp.product('Junior Membership')));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.create_membership_product(%L, %L, 3000, %L::uuid[])', v_club, 'Senior Membership', array[pg_temp.id('men')]));
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.accept_club_membership_terms(%L, %L)', v_club, 'club-memberships-2026-10-06-proposed'));
  perform pg_temp.connect(v_club);
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.activate_membership_programme(%L)', v_club));
  if v ->> 'outcome' <> 'ACTIVATED' then raise exception 'seed: the club could not be activated (%)', v; end if;

  -- Under 12s. Abe: Direct Debit in place, membership never started. Bea: started, collecting. Cal: never started,
  -- and this month's payment is ten days late. Dan: nobody has set it up (two guardians). Gil: collecting.
  -- Ida: Hana paid, then cancelled her Direct Debit and this month's payment failed; Gus is her other guardian.
  perform pg_temp.player('abe', pg_temp.dob('U12'), array[pg_temp.id('pam')], pg_temp.id('u12'));
  perform pg_temp.enrol('abe', pg_temp.id('pam')); perform pg_temp.mandate('abe', 'active');
  perform pg_temp.player('bea', pg_temp.dob('U12'), array[pg_temp.id('pam')], pg_temp.id('u12'));
  perform pg_temp.enrol('bea', pg_temp.id('pam')); perform pg_temp.mandate('bea', 'active'); perform pg_temp.collecting('bea');
  perform pg_temp.player('cal', pg_temp.dob('U12'), array[pg_temp.id('gus')], pg_temp.id('u12'));
  perform pg_temp.enrol('cal', pg_temp.id('gus')); perform pg_temp.mandate('cal', 'active'); perform pg_temp.owe('cal', 'SETUP_PENDING');
  perform pg_temp.player('dan', pg_temp.dob('U12'), array[pg_temp.id('gus'), pg_temp.id('hana')], pg_temp.id('u12'));
  perform pg_temp.player('gil', pg_temp.dob('U12'), array[pg_temp.id('pam')], pg_temp.id('u12'));
  perform pg_temp.enrol('gil', pg_temp.id('pam')); perform pg_temp.mandate('gil', 'active'); perform pg_temp.collecting('gil');
  perform pg_temp.player('ida', pg_temp.dob('U12'), array[pg_temp.id('hana'), pg_temp.id('gus')], pg_temp.id('u12'));
  perform pg_temp.enrol('ida', pg_temp.id('hana')); perform pg_temp.mandate('ida', 'cancelled');
  perform pg_temp.owe('ida', 'FAILED'); perform pg_temp.pay('ida', 'failed');

  -- Under 13s. Eli: paid this month. Fay: the first payment is with the bank, no monthly collection yet.
  perform pg_temp.player('eli', pg_temp.dob('U13'), array[pg_temp.id('gus')], pg_temp.id('u13'));
  perform pg_temp.enrol('eli', pg_temp.id('gus')); perform pg_temp.mandate('eli', 'active'); perform pg_temp.collecting('eli');
  perform pg_temp.owe('eli', 'PAID'); perform pg_temp.pay('eli', 'confirmed');
  perform pg_temp.player('fay', pg_temp.dob('U13'), array[pg_temp.id('hana')], pg_temp.id('u13'));
  perform pg_temp.enrol('fay', pg_temp.id('hana')); perform pg_temp.mandate('fay', 'active');
  perform pg_temp.owe('fay', 'SUBMITTED'); perform pg_temp.pay('fay', 'submitted');

  -- Adam: an adult in the men's side, with his own login; nothing set up.
  perform pg_temp.player('adam', (current_date - interval '25 years')::date, null, pg_temp.id('men'), pg_temp.id('adam_user'));
  -- A player at the other club only.
  perform pg_temp.player('zoe', pg_temp.dob('U12'), array[pg_temp.id('pam')], pg_temp.id('other_team'));
end $$;

-- =====================================================================================================
-- RS. THE ONE STANDING KNOWS WHETHER COLLECTING HAS STARTED
-- =====================================================================================================
do $$
declare b jsonb := pg_temp.board(); f jsonb;
begin
  perform pg_temp.check(pg_temp.standing(b, 'abe') = 'DUE/NOT_STARTED' and (pg_temp.row_of(b, 'abe') ->> 'collection_started')::boolean = false
                        and (pg_temp.row_of(b, 'abe') ->> 'can_remind')::boolean,
    'RS1 a Direct Debit in place whose membership was never started is Due -- not "Collecting" -- and the payer can be reminded (' || coalesce(pg_temp.standing(b, 'abe'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'cal') = 'OVERDUE/NOT_STARTED',
    'RS2 and once this month is more than five days late it is Overdue, for the same reason (' || coalesce(pg_temp.standing(b, 'cal'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'bea') = 'COLLECTING/SCHEDULED' and (pg_temp.row_of(b, 'bea') ->> 'collection_started')::boolean,
    'RS3 a started membership still reads Collecting, scheduled for the collection day (' || coalesce(pg_temp.standing(b, 'bea'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'eli') = 'UP_TO_DATE/PAID' and pg_temp.standing(b, 'fay') = 'COLLECTING/WITH_THE_BANK',
    'RS4 a paid month is Up to date; a payment with the bank is Collecting (' || coalesce(pg_temp.standing(b, 'eli'), '-') || ', ' || coalesce(pg_temp.standing(b, 'fay'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'dan') = 'NOT_SET_UP/NO_PAYER' and pg_temp.standing(b, 'adam') = 'NOT_SET_UP/NO_PAYER',
    'RS5 a child and an adult player with nothing set up are Not set up');
  perform pg_temp.check(pg_temp.row_of(b, 'abe') -> 'membership' ->> 'name' = 'Junior Membership'
                        and pg_temp.row_of(b, 'adam') -> 'membership' ->> 'name' = 'Senior Membership'
                        and pg_temp.row_of(b, 'dan') -> 'membership' ->> 'name' = 'Junior Membership',
    'RS6 every row names the membership the player holds, or would hold from their team');
  f := pg_temp.json_as(pg_temp.id('pam'), format('select public.family_membership_standing(%L, %L)', pg_temp.id('abe'), pg_temp.id('club')));
  perform pg_temp.check(f ->> 'standing' = 'DUE' and f ->> 'reason' = 'NOT_STARTED' and (f ->> 'collection_started')::boolean = false
                        and f -> 'membership' ->> 'name' = 'Junior Membership' and (f ->> 'taking_new_memberships')::boolean,
    'RS7 the family sees the same: Due, not started, which membership (' || coalesce(f ->> 'standing', '-') || '/' || coalesce(f ->> 'reason', '-') || ')');
end $$;

-- =====================================================================================================
-- RB. THE CLUB'S BOARD AND THE MONTH'S MONEY
-- =====================================================================================================
do $$
declare b jsonb := pg_temp.board(); j jsonb; s jsonb; m jsonb;
begin
  select x into j from jsonb_array_elements(b -> 'memberships') x where x ->> 'name' = 'Junior Membership';
  select x into s from jsonb_array_elements(b -> 'memberships') x where x ->> 'name' = 'Senior Membership';
  perform pg_temp.check(jsonb_array_length(b -> 'memberships') = 2
                        and (j ->> 'price_minor')::int = 1600 and (j ->> 'teams')::int = 2 and (j ->> 'members')::int = 7
                        and (s ->> 'price_minor')::int = 3000 and (s ->> 'teams')::int = 1 and (s ->> 'members')::int = 0,
    'RB1 the board lists the club''s memberships: today''s price, the teams each covers, how many hold it (' || coalesce((b -> 'memberships')::text, '-') || ')');
  perform pg_temp.check(b -> 'programme' -> 'price_minor' = 'null'::jsonb and b -> 'programme' ->> 'fee_bearer' = 'CLUB'
                        and b -> 'programme' ->> 'activated_at' is not null and (b -> 'programme' ->> 'enabled')::boolean,
    'RB2 with two memberships there is no single club price; the board says who pays Ovalball''s fee');
  perform pg_temp.check((b -> 'programme' ->> 'fee_bps')::int = 250, 'RB2b and Ovalball''s rate, from the one authority (250 basis points)');
  perform pg_temp.check((b -> 'counts' ->> 'direct_debit_in_place')::int = 6 and (b -> 'counts' ->> 'active_memberships')::int = 7,
    'RB3 seven memberships, six with a Direct Debit in place (' || coalesce(b -> 'counts' ->> 'direct_debit_in_place', '-') || ')');
  m := b -> 'money';
  perform pg_temp.check((m ->> 'expected_minor')::int = 6400 and (m ->> 'collected_minor')::int = 1600
                        and (m ->> 'ovalball_fee_minor')::int = 40 and (m ->> 'members_fee_minor')::int = 0
                        and (m ->> 'club_receives_minor')::int = 1560 and (m ->> 'fee_on_refunds_minor')::int = 0,
    'RB4 £64 expected; £16 collected; Ovalball''s 2.5% is £0.40, paid by the club; £15.60 reaches the club before GoCardless''s own fee (' || m::text || ')');
end $$;

-- RB5/RB6 change the money and then undo it, so the rest of the suite reads the seed.
do $$
declare m jsonb;
begin
  begin
    insert into public.payment_refunds (payment_id, amount_minor, reason, status, created_by)
    values (pg_temp.id('eli_pay'), 600, 'rcm: a partial refund', 'confirmed', pg_temp.id('ca'));
    m := pg_temp.board() -> 'money';
    perform pg_temp.check((m ->> 'collected_minor')::int = 1000 and (m ->> 'refunded_minor')::int = 600
                          and (m ->> 'ovalball_fee_minor')::int = 0 and (m ->> 'fee_on_refunds_minor')::int = 40
                          and (m ->> 'club_receives_minor')::int = 960,
      'RB5 a confirmed £6 refund is no longer collected; Ovalball''s fee on it is not counted as earned, and is still not counted as the club''s (' || m::text || ')');
    raise exception using errcode = 'P0001', message = 'undo';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    update public.membership_obligations set payer_fee_minor = 40, platform_fee_mode = 'PAYER_SURCHARGE'
     where id = pg_temp.id('eli_ob');
    m := pg_temp.board() -> 'money';
    perform pg_temp.check((m ->> 'collected_minor')::int = 1600 and (m ->> 'ovalball_fee_minor')::int = 40 and (m ->> 'members_fee_minor')::int = 40
                          and (m ->> 'club_receives_minor')::int = 1600,
      'RB6 when members pay Ovalball''s fee on top, the club receives the whole membership amount (' || m::text || ')');
    raise exception using errcode = 'P0001', message = 'undo';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- =====================================================================================================
-- RT. A TEAM'S BOARD: THE SAME STANDING, NO MONEY, NO PAYER
-- =====================================================================================================
do $$
declare t jsonb := pg_temp.json_as(pg_temp.id('tm12'), format('select public.team_membership_board(%L)', pg_temp.id('u12'))); v_leak int;
begin
  select count(*) into v_leak from jsonb_array_elements(t -> 'rows') r
   where r ?| array['amount_due_minor', 'monthly_amount_minor', 'payer', 'payer_subscription_id', 'mandate_status', 'obligation_status',
                    'obligation_id', 'teams', 'due_date', 'next_collection_date', 'collection_started'];
  perform pg_temp.check(v_leak = 0 and not (t ? 'money') and not (t ? 'memberships') and jsonb_array_length(t -> 'rows') = 6,
    'RT1 a Team Manager''s board carries no amounts, no payer, no Direct Debit and no money totals -- six Under 12s (' || v_leak || ' rows leaked)');
  perform pg_temp.check(pg_temp.standing(t, 'abe') = 'DUE/NOT_STARTED' and pg_temp.row_of(t, 'abe') -> 'membership' ->> 'name' = 'Junior Membership'
                        and t ->> 'team_name' = 'Under 12 Boys' and (t ->> 'programme_enabled')::boolean and (t ->> 'taking_new_memberships')::boolean,
    'RT2 the same standing as the club''s board, the membership''s name, the team''s name');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('tm12'), format('select public.team_membership_board(%L)', pg_temp.id('u13'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('coach12'), format('select public.team_membership_board(%L)', pg_temp.id('u12'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('pam'), format('select public.team_membership_board(%L)', pg_temp.id('u12'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('other_ca'), format('select public.team_membership_board(%L)', pg_temp.id('u12'))) like '42501%',
    'RT3 refused: another team''s Team Manager, a coach, a parent, another club''s administrator');
  t := pg_temp.json_as(pg_temp.id('ca'), format('select public.team_membership_board(%L)', pg_temp.id('u12')));
  perform pg_temp.check(jsonb_array_length(t -> 'rows') = 6, 'RT4 the club''s finance holder reads any team''s board');
end $$;

-- =====================================================================================================
-- RH. REMINDERS AND THEIR HISTORY
-- =====================================================================================================
do $$
declare r jsonb; h jsonb; e jsonb; p jsonb; v_audit int; v_notes int;
begin
  -- THE PREVIEW first: it must say exactly what sending then does, and record nothing.
  v_audit := (select count(*) from public.finance_audit_log where club_id = pg_temp.id('club') and action = 'membership_reminder_sent');
  v_notes := (select count(*) from public.notifications where type = 'membership_reminder');
  p := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_reminder_preview(%L, %L::uuid[])', pg_temp.id('club'),
                                                array[pg_temp.id('abe'), pg_temp.id('eli'), pg_temp.id('dan')]));
  perform pg_temp.check((p ->> 'will_send')::int = 2
                        and exists (select 1 from jsonb_array_elements(p -> 'skipped') x where (x ->> 'player_id')::uuid = pg_temp.id('eli') and x ->> 'reason' = 'NOTHING_TO_ASK')
                        and (p -> 'example' ->> 'player_id')::uuid in (pg_temp.id('abe'), pg_temp.id('dan')) and not (p -> 'example' ? 'recipients'),
    'RV1 the preview says two families would be asked, Eli is up to date so is left out, and shows one message (' || p::text || ')');
  perform pg_temp.check(jsonb_array_length(p -> 'examples') = 2
                        and exists (select 1 from jsonb_array_elements(p -> 'examples') ex where ex ->> 'variant' = 'START' and (ex ->> 'count')::int = 1 and ex ->> 'body' like '%has not been started%')
                        and exists (select 1 from jsonb_array_elements(p -> 'examples') ex where ex ->> 'variant' = 'SET_UP' and (ex ->> 'count')::int = 1 and ex ->> 'body' like '%asks you to set up%'),
    'RV1b and, because the two families are in different situations, shows both messages with how many get each');
  perform pg_temp.check((select count(*) from public.finance_audit_log where club_id = pg_temp.id('club') and action = 'membership_reminder_sent') = v_audit
                        and (select count(*) from public.notifications where type = 'membership_reminder') = v_notes,
    'RV2 a preview records nothing and tells nobody anything');
  p := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_reminder_preview(%L, %L::uuid[])', pg_temp.id('club'), array[pg_temp.id('abe')]));

  r := pg_temp.json_as(pg_temp.id('ca'), format('select public.send_membership_reminders(%L, %L::uuid[])', pg_temp.id('club'), array[pg_temp.id('abe')]));
  perform pg_temp.check((r ->> 'sent')::int = 1
      and exists (select 1 from public.notifications n where n.user_id = pg_temp.id('pam') and n.type = 'membership_reminder'
                    and n.data ->> 'player_id' = pg_temp.id('abe')::text and n.body like '%has not been started. Please start it%'),
    'RH1 a membership never started is reminded to start it, and the payer is told so');
  perform pg_temp.check((select n.body from public.notifications n where n.user_id = pg_temp.id('pam') and n.type = 'membership_reminder'
                          and n.data ->> 'player_id' = pg_temp.id('abe')::text order by n.created_at desc limit 1) = p -> 'example' ->> 'body',
    'RV3 the family receives exactly the words the preview showed');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('tm12'), format('select public.membership_reminder_preview(%L, %L::uuid[])', pg_temp.id('club'), array[pg_temp.id('cal')])) like '42501%'
                        and pg_temp.say_as(pg_temp.id('coach12'), format('select public.membership_reminder_preview(%L, %L::uuid[], %L)', pg_temp.id('club'), array[pg_temp.id('cal')], pg_temp.id('u12'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('other_ca'), format('select public.membership_reminder_preview(%L, %L::uuid[])', pg_temp.id('club'), array[pg_temp.id('cal')])) like '42501%'
                        and pg_temp.say_as(pg_temp.id('viewer'), format('select public.membership_reminder_preview(%L, %L::uuid[])', pg_temp.id('club'), array[pg_temp.id('cal')])) like '42501%',
    'RV4 the preview has the sending rule: refused to a Team Manager club-wide, a coach, another club, a viewer who cannot send');
  p := pg_temp.json_as(pg_temp.id('tm12'), format('select public.membership_reminder_preview(%L, %L::uuid[], %L)', pg_temp.id('club'),
                                                  array[pg_temp.id('cal'), pg_temp.id('eli')], pg_temp.id('u12')));
  perform pg_temp.check((p ->> 'will_send')::int = 1
                        and exists (select 1 from jsonb_array_elements(p -> 'skipped') x where (x ->> 'player_id')::uuid = pg_temp.id('eli') and x ->> 'reason' = 'NOT_IN_TEAM'),
    'RV5 a Team Manager''s preview covers their own team''s players only');
  r := pg_temp.json_as(pg_temp.id('tm12'), format('select public.send_membership_reminders(%L, %L::uuid[], %L)', pg_temp.id('club'), array[pg_temp.id('cal')], pg_temp.id('u12')));
  perform pg_temp.check((r ->> 'sent')::int = 1, 'RH1b a Team Manager reminds their own team''s player');

  h := pg_temp.json_as(pg_temp.id('ca'), format('select public.membership_reminder_history(%L)', pg_temp.id('club')));
  select x into e from jsonb_array_elements(h -> 'reminders') x where (x ->> 'player_id')::uuid = pg_temp.id('abe');
  perform pg_temp.check(jsonb_array_length(h -> 'reminders') = 2 and e ->> 'sent_by' = 'Clubadmin Running' and e ->> 'scope' = 'club'
                        and e ->> 'standing' = 'DUE' and e ->> 'reason' = 'NOT_STARTED' and (e ->> 'recipients')::int = 1
                        and (h -> 'reminders' -> 0 ->> 'sent_at') >= (h -> 'reminders' -> 1 ->> 'sent_at'),
    'RH2 the club sees each reminder: who, when, by whom, why, how many were told -- newest first (' || coalesce(e::text, '-') || ')');
  select x into e from jsonb_array_elements(h -> 'reminders') x where (x ->> 'player_id')::uuid = pg_temp.id('cal');
  perform pg_temp.check(e ->> 'scope' = 'team' and e ->> 'sent_by' = 'Manager12 Running', 'RH3 and that the Team Manager sent Cal''s');

  h := pg_temp.json_as(pg_temp.id('tm12'), format('select public.membership_reminder_history(%L, %L)', pg_temp.id('club'), pg_temp.id('u12')));
  perform pg_temp.check(jsonb_array_length(h -> 'reminders') = 2
                        and not exists (select 1 from jsonb_array_elements(h -> 'reminders') x where x -> 'recipients' <> 'null'::jsonb),
    'RH4 the Team Manager sees their own team''s reminders, never how many people were told');
  h := pg_temp.json_as(pg_temp.id('tm13'), format('select public.membership_reminder_history(%L, %L)', pg_temp.id('club'), pg_temp.id('u13')));
  perform pg_temp.check(jsonb_array_length(h -> 'reminders') = 0, 'RH5 another team''s Team Manager sees none of them');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('tm12'), format('select public.membership_reminder_history(%L)', pg_temp.id('club'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('tm12'), format('select public.membership_reminder_history(%L, %L)', pg_temp.id('club'), pg_temp.id('u13'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('coach12'), format('select public.membership_reminder_history(%L, %L)', pg_temp.id('club'), pg_temp.id('u12'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('pam'), format('select public.membership_reminder_history(%L)', pg_temp.id('club'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('other_ca'), format('select public.membership_reminder_history(%L)', pg_temp.id('club'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('viewer'), format('select public.membership_reminder_history(%L)', pg_temp.id('club'))) like 'OK%',
    'RH6 refused: a Team Manager club-wide or for another team, a coach, a parent, another club; the club''s finance viewer may read it');
end $$;

-- RV6: the one composer -- every case says what to do, and none of them names an amount or another person.
do $$
declare v text; v_all text := '';
begin
  foreach v in array array[
    internal.membership_reminder_body('NOT_SET_UP', 'NO_PAYER', 'Dan', 'Running RFC'),
    internal.membership_reminder_body('DUE', 'NOT_STARTED', 'Abe', 'Running RFC'),
    internal.membership_reminder_body('OVERDUE', 'NOT_STARTED', 'Cal', 'Running RFC'),
    internal.membership_reminder_body('DUE', 'SETUP_UNFINISHED', 'Eve', 'Running RFC'),
    internal.membership_reminder_body('OVERDUE', 'SETUP_UNFINISHED', 'Eve', 'Running RFC'),
    internal.membership_reminder_body('OVERDUE', 'NOT_COLLECTED', 'Jon', 'Running RFC'),
    internal.membership_reminder_body('ACTION_NEEDED', 'PAYMENT_FAILED', 'Kit', 'Running RFC')] loop
    v_all := v_all || v || ' | ';
  end loop;
  perform pg_temp.check(v_all !~ '£|[0-9]{2,}' and v_all like '%Dan''s membership.%' and v_all like '%Jon''s membership for % has not been collected yet. Please check your Direct Debit%'
                        and v_all not like '%Jon''s%finish setting up%',
    'RV6 every reminder says what to do, names no amount, and a running Direct Debit is never told to "finish setting up" (' || v_all || ')');
end $$;

-- =====================================================================================================
-- RD. ONE MEMBER, ONE READ
-- =====================================================================================================
do $$
declare d jsonb; h jsonb;
begin
  d := pg_temp.detail('ca', 'abe');
  perform pg_temp.check(d -> 'standing' ->> 'standing' = 'DUE' and d -> 'standing' ->> 'reason' = 'NOT_STARTED'
                        and d -> 'membership' ->> 'name' = 'Junior Membership' and (d -> 'membership' ->> 'monthly_amount_minor')::int = 1600
                        and d -> 'membership' ->> 'enrolment_status' = 'active' and d -> 'membership' ->> 'fee_bearer' = 'CLUB'
                        and (d -> 'membership' ->> 'collection_day')::int = 1
                        and d -> 'payer' ->> 'name' = 'Pam Running' and d -> 'payer' ->> 'relationship' = 'guardian'
                        and d -> 'payer' ->> 'email' like 'rcm-pam-%' and d -> 'payer' ->> 'phone' like '07700 900%'
                        and d -> 'direct_debit' ->> 'mandate_status' = 'active' and d -> 'direct_debit' -> 'subscription_status' = 'null'::jsonb,
    'RD1 the Club Admin reads one member: standing, membership, price, who pays Ovalball''s fee, the payer and how to reach them, the Direct Debit');
  d := pg_temp.detail('viewer', 'abe');
  perform pg_temp.check(d -> 'payer' ->> 'name' = 'Pam Running' and d -> 'payer' -> 'email' = 'null'::jsonb and d -> 'payer' -> 'phone' = 'null'::jsonb,
    'RD2 somebody who may see the club''s memberships but not members'' contact details sees who pays, never their email or phone');
  perform pg_temp.check((d -> 'can' ->> 'remind')::boolean = false and (d -> 'can' ->> 'release_payer')::boolean = false and (d -> 'can' ->> 'cancel')::boolean = false
                        and (pg_temp.detail('ca', 'abe') -> 'can' ->> 'remind')::boolean and (pg_temp.detail('ca', 'abe') -> 'can' ->> 'release_payer')::boolean
                        and (pg_temp.detail('ca', 'abe') -> 'can' ->> 'cancel')::boolean,
    'RD3 and is told they cannot remind, change the payer or cancel; the Club Admin can');
  d := pg_temp.detail('ca', 'dan');
  perform pg_temp.check(d -> 'standing' ->> 'standing' = 'NOT_SET_UP' and d -> 'membership' ->> 'name' = 'Junior Membership'
                        and d -> 'membership' -> 'enrolment_status' = 'null'::jsonb and d -> 'payer' = 'null'::jsonb
                        and jsonb_array_length(d -> 'askable') = 2
                        and not exists (select 1 from jsonb_array_elements(d -> 'askable') a where (a ->> 'is_payer')::boolean or a ? 'email'),
    'RD4 a player nobody has set up has a page: the membership they would hold, and the two guardians a reminder would go to -- names only');
  d := pg_temp.detail('ca', 'adam');
  perform pg_temp.check(d -> 'membership' ->> 'name' = 'Senior Membership' and (d -> 'player' ->> 'is_adult')::boolean
                        and exists (select 1 from jsonb_array_elements(d -> 'askable') a where a ->> 'relationship' = 'self'),
    'RD5 an adult player is asked himself');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('tm12'), format('select public.club_member_membership(%L, %L)', pg_temp.id('club'), pg_temp.id('abe'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('coach12'), format('select public.club_member_membership(%L, %L)', pg_temp.id('club'), pg_temp.id('abe'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('pam'), format('select public.club_member_membership(%L, %L)', pg_temp.id('club'), pg_temp.id('abe'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('other_ca'), format('select public.club_member_membership(%L, %L)', pg_temp.id('club'), pg_temp.id('abe'))) like '42501%',
    'RD6 refused: a Team Manager (their view is the team''s board), a coach, the parent (theirs is the family page), another club');
  perform pg_temp.check(pg_temp.detail('ca', 'zoe') is null
                        and pg_temp.json_as(pg_temp.id('other_ca'), format('select public.club_member_membership(%L, %L)', pg_temp.id('other_club'), pg_temp.id('abe'))) is null,
    'RD7 a player this club''s memberships do not know reads as nothing -- no sign they exist elsewhere');
  h := pg_temp.detail('ca', 'eli') -> 'history';
  perform pg_temp.check(jsonb_array_length(h) = 1 and (h -> 0 ->> 'amount_minor')::int = 1600 and (h -> 0 ->> 'fee_minor')::int = 40
                        and h -> 0 ->> 'fee_position' = 'EARNED' and h -> 0 ->> 'payment_status' = 'confirmed' and h -> 0 ->> 'status' = 'PAID',
    'RD8 each month''s payment, with Ovalball''s fee and where it stands (' || coalesce(h::text, '-') || ')');
  perform pg_temp.check(position('MD_RCM_' in pg_temp.detail('ca', 'abe')::text) = 0 and position('CU_RCM_' in pg_temp.detail('ca', 'abe')::text) = 0
                        and position('PM_RCM_' in pg_temp.detail('ca', 'eli')::text) = 0,
    'RD9 no GoCardless ids reach the page');
  d := pg_temp.detail('ca', 'abe');
  perform pg_temp.check((d -> 'membership' ->> 'fee_bps')::int = 250 and (d -> 'membership' ->> 'monthly_fee_minor')::int = 40
                        and (d -> 'membership' ->> 'monthly_collect_minor')::int = 1600,
    'RD10 the page says what the Direct Debit collects: £16 a month with Ovalball''s 40p paid by the club (' || coalesce(d -> 'membership' ->> 'monthly_fee_minor', '-') || ')');
  -- A member who joined on an older rate keeps it: the figures are the enrolment's own snapshot, never today's.
  update public.player_subscription_payers set platform_fee_bps = 200 where id = pg_temp.id('abe_psp');
  d := pg_temp.detail('ca', 'abe');
  perform pg_temp.check((d -> 'membership' ->> 'fee_bps')::int = 200 and (d -> 'membership' ->> 'monthly_fee_minor')::int = 32,
    'RD11 and a member who joined on another rate is shown their own (2%: 32p), not today''s');
  update public.player_subscription_payers set platform_fee_bps = 250 where id = pg_temp.id('abe_psp');
  d := pg_temp.detail('ca', 'dan');
  perform pg_temp.check((d -> 'membership' ->> 'monthly_fee_minor')::int = 40 and (d -> 'membership' ->> 'fee_bearer') = 'CLUB',
    'RD12 for a player nobody has set up, what it would be today');
end $$;

-- =====================================================================================================
-- RL. CHANGING WHO PAYS
-- =====================================================================================================
do $$
declare r jsonb; d jsonb; v_new uuid;
begin
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.release_responsible_payer(%L, %L)', pg_temp.id('gil_psp'), 'Dad is taking over')) like '55000%Cancel the membership first%',
    'RL1 refused while GoCardless is collecting: cancel the membership first, so two Direct Debits never run');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.release_responsible_payer(%L, %L)', pg_temp.id('fay_psp'), 'Mum is taking over')) like '55000%on its way to the bank%',
    'RL2 refused while a payment is on its way to the bank: the payer could not truthfully be told nothing more will be taken');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('tm12'), format('select public.release_responsible_payer(%L, %L)', pg_temp.id('ida_psp'), 'x')) like '42501%'
                        and pg_temp.say_as(pg_temp.id('viewer'), format('select public.release_responsible_payer(%L, %L)', pg_temp.id('ida_psp'), 'x')) like '42501%'
                        and pg_temp.say_as(pg_temp.id('hana'), format('select public.release_responsible_payer(%L, %L)', pg_temp.id('ida_psp'), 'x')) like '42501%'
                        and pg_temp.say_as(pg_temp.id('other_ca'), format('select public.release_responsible_payer(%L, %L)', pg_temp.id('ida_psp'), 'x')) like '42501%',
    'RL3 refused: a Team Manager, a viewer, the payer herself, another club''s administrator');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.release_responsible_payer(%L, %L)', pg_temp.id('ida_psp'), '  ')) like '22023%',
    'RL4 the club must say why');

  r := pg_temp.json_as(pg_temp.id('ca'), format('select public.release_responsible_payer(%L, %L)', pg_temp.id('ida_psp'), 'Gus is paying from now on'));
  perform pg_temp.check(r ->> 'outcome' = 'RELEASED'
      and (select status = 'ended' and end_reason = 'Gus is paying from now on' and ended_by = pg_temp.id('ca') from public.player_subscription_payers where id = pg_temp.id('ida_psp'))
      and exists (select 1 from public.finance_audit_log where club_id = pg_temp.id('club') and action = 'payer_released' and target_id = pg_temp.id('ida_psp'))
      and exists (select 1 from public.notifications n where n.user_id = pg_temp.id('hana') and n.type = 'membership_payer_released'
                    and n.data ->> 'player_id' = pg_temp.id('ida')::text and n.body like '%Nothing more will be collected from you%'),
    'RL5 otherwise the old set-up ends -- recorded with why and by whom, audited, and the old payer is told');
  perform pg_temp.check(pg_temp.standing(pg_temp.board(), 'ida') = 'NOT_SET_UP/NO_PAYER', 'RL6 the membership now reads Not set up, so the club can ask the guardians');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.release_responsible_payer(%L, %L)', pg_temp.id('ida_psp'), 'again')) like '55000%already ended%',
    'RL7 a second release is refused, not repeated');
  perform pg_temp.check((select payer_subscription_id = pg_temp.id('ida_psp') and status = 'FAILED' from public.membership_obligations where id = pg_temp.id('ida_ob')),
    'RL8 history is kept: the month whose payment failed is still Hana''s, untouched');

  v_new := pg_temp.uuid_as(pg_temp.id('gus'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('ida'), pg_temp.id('programme')));
  d := pg_temp.detail('ca', 'ida');
  perform pg_temp.check(v_new is not null and d -> 'payer' ->> 'name' = 'Gus Running' and d -> 'standing' ->> 'standing' = 'DUE'
                        and d -> 'standing' ->> 'reason' = 'SETUP_UNFINISHED',
    'RL9 Gus takes it on through the family door, and Hana''s failed payment is not his: Due, not Action needed (' || coalesce(d -> 'standing' ->> 'standing', '-') || '/' || coalesce(d -> 'standing' ->> 'reason', '-') || ')');
  perform pg_temp.check(d -> 'direct_debit' ->> 'mandate_status' is null,
    'RL9b and Hana''s old Direct Debit never becomes his: nothing is collected until Gus sets up his own');
  -- Hana is still Ida's guardian, but no longer pays: she learns it is in hand, and nothing of Gus's money.
  d := pg_temp.json_as(pg_temp.id('hana'), format('select public.family_membership_standing(%L, %L)', pg_temp.id('ida'), pg_temp.id('club')));
  perform pg_temp.check(d -> 'standing' = 'null'::jsonb and (d ->> 'has_payer')::boolean and not (d ->> 'payer_is_you')::boolean
                        and not (d ? 'amount_due_minor') and d -> 'membership' ->> 'name' = 'Junior Membership' and d::text not like '%Gus%',
    'RL10 the guardian who no longer pays sees it is set up and which membership -- not who pays, not their amounts (' || d::text || ')');
  d := pg_temp.json_as(pg_temp.id('gus'), format('select public.family_membership_standing(%L, %L)', pg_temp.id('ida'), pg_temp.id('club')));
  perform pg_temp.check(d ->> 'standing' = 'DUE' and (d ->> 'payer_is_you')::boolean, 'RL11 the new payer sees his own standing');
end $$;

-- =====================================================================================================
-- RP. A PAUSED CLUB STILL SHOWS ITS MEMBERS
-- =====================================================================================================
do $$
declare v jsonb; t jsonb; f jsonb;
begin
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.pause_membership_programme(%L, %L)', pg_temp.id('club'), 'End of season review'));
  perform pg_temp.check((select not enabled and activated_at is not null from public.club_subscription_programmes where id = pg_temp.id('programme')),
    'RP1 the club pauses: it is no longer taking new memberships');
  t := pg_temp.json_as(pg_temp.id('tm12'), format('select public.team_membership_board(%L)', pg_temp.id('u12')));
  -- Every member whose membership was taken on still shows. Dan, whom nobody set up, does not: while the club takes
  -- no new memberships there is nothing his family could do, so he is not shown as something to chase.
  perform pg_temp.check((t ->> 'programme_enabled')::boolean and not (t ->> 'taking_new_memberships')::boolean and jsonb_array_length(t -> 'rows') = 5
                        and pg_temp.row_of(t, 'dan') is null,
    'RP2 the team''s board still shows every member, says no new memberships are being taken, and chases nobody who cannot join (' || jsonb_array_length(t -> 'rows') || ' rows)');
  f := pg_temp.json_as(pg_temp.id('pam'), format('select public.family_membership_standing(%L, %L)', pg_temp.id('abe'), pg_temp.id('club')));
  perform pg_temp.check((f ->> 'programme_enabled')::boolean and not (f ->> 'taking_new_memberships')::boolean and f ->> 'standing' = 'DUE',
    'RP3 the family still sees its membership (' || coalesce(f::text, '-') || ')');
  perform pg_temp.check(pg_temp.row_of(pg_temp.board(), 'bea') ->> 'standing' = 'COLLECTING', 'RP4 the club''s board still shows the Direct Debits running');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('pam'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('dan'), pg_temp.id('programme'))) not like 'OK%'
                        and pg_temp.say_as(pg_temp.id('gus'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('dan'), pg_temp.id('programme'))) not like 'OK%',
    'RP5 and nobody can start a new membership while it is paused');
end $$;

-- =====================================================================================================
-- RX. NEGATIVE
-- =====================================================================================================
do $$
begin
  perform pg_temp.check(pg_temp.say_as(null, format('select public.club_member_membership(%L, %L)', pg_temp.id('club'), pg_temp.id('abe'))) like '42501%'
                        and pg_temp.say_as(null, format('select public.membership_reminder_history(%L)', pg_temp.id('club'))) like '42501%'
                        and pg_temp.say_as(null, format('select public.release_responsible_payer(%L, %L)', pg_temp.id('abe_psp'), 'x')) like '42501%',
    'RX1 nothing is read or changed without signing in');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.club_member_membership(%L, %L)', pg_temp.id('other_club'), pg_temp.id('zoe'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('ca'), format('select public.membership_reminder_history(%L)', pg_temp.id('other_club'))) like '42501%',
    'RX2 a Club Admin who swaps in another club''s id is refused: authority is the club''s, not the request''s');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.membership_reminder_history(%L, %L)', pg_temp.id('club'), pg_temp.id('other_team'))) like '42501%That team is not at this club%'
                        and pg_temp.say_as(pg_temp.id('tm12'), format('select public.send_membership_reminders(%L, %L::uuid[], %L)', pg_temp.id('club'), array[pg_temp.id('eli')], pg_temp.id('u12'))) like 'OK%'
                        and (select count(*) from public.notifications where type = 'membership_reminder' and data ->> 'player_id' = pg_temp.id('eli')::text) = 0,
    'RX3 another club''s team is refused; a Team Manager naming a player from another team reminds nobody');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('other_ca'), format('select public.release_responsible_payer(%L, %L)', pg_temp.id('abe_psp'), 'x')) like '42501%'
                        and (select status from public.player_subscription_payers where id = pg_temp.id('abe_psp')) = 'active',
    'RX4 a membership id from another club cannot be released: the club is resolved from the membership, never from the caller');
  perform pg_temp.check(not has_function_privilege('anon', 'public.club_member_membership(uuid, uuid)', 'execute')
                        and not has_function_privilege('anon', 'public.membership_reminder_history(uuid, uuid, integer)', 'execute')
                        and not has_function_privilege('anon', 'public.release_responsible_payer(uuid, text)', 'execute')
                        and has_function_privilege('authenticated', 'public.club_member_membership(uuid, uuid)', 'execute'),
    'RX5 none of the three is open to anonymous callers');
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(
                          pg_temp.json_as(pg_temp.id('tm12'), format('select public.membership_reminder_history(%L, %L)', pg_temp.id('club'), pg_temp.id('u12'))) -> 'reminders') x
                          where x ? 'recipients' and x -> 'recipients' <> 'null'::jsonb),
    'RX6 a team''s history never carries who or how many were told');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('tm12'), format('select public.club_membership_board(%L)', pg_temp.id('club'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('tm12'), format('select public.club_membership_board(%L, %L)', pg_temp.id('club'), pg_temp.id('u12'))) like '42501%',
    'RX7 a Team Manager cannot read the club''s board or its money, even filtered to their own team');
end $$;

rollback;
