-- =====================================================================================================
-- ONE MEMBERSHIP STANDING, AND REMINDERS (20270746000000)
--
--   MS1-MS16  THE STANDING is derived once, from the canonical records, for every case: paid; with the bank;
--             being retried; scheduled by a Direct Debit; due; overdue (and a new member is never overdue on
--             the day they join); a failed payment, a failed mandate, still enrolled after leaving every
--             team; not set up (a child, and an adult player); exempt, refunded and free; ended.
--   MM1-MM9   THE MONTH'S MONEY by the domain map's definitions: a scheduled or submitted collection is not
--             collected; a mandate is not money; a refund stops counting as collected; cancelled, exempt,
--             waived and refunded months are not expected; a retried payment counts once.
--   MA1-MA8   WHO MAY SEE WHAT: the club board is the club's; a Team Manager reads their own team's board --
--             the same standing, no payer, no money totals -- and no other team's; a parent reads neither.
--   MR1-MR14  REMINDERS go through the one notification system to the responsible payer, or (with nothing
--             set up) to the guardians the one contact rule allows -- never a child; an adult player is asked
--             themselves; a team's staff remind only their own team's players and learn counts, never who was
--             told; nothing is asked of somebody who is up to date; one reminder per player in 72 hours; who
--             sent it is recorded and shown. The club can tell a team's staff how many need attention, once
--             a day.
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
-- The board is read as of the 20th of this month: deterministic, whatever day the suite runs.
create or replace function pg_temp.asof() returns date language sql as $$ select date_trunc('month', current_date)::date + 19 $$;
create or replace function pg_temp.period() returns date language sql as $$ select date_trunc('month', current_date)::date $$;

create or replace function pg_temp.person(p_label text, p_dob date default (current_date - interval '40 years')::date)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_email text := 'mst-' || lower(p_label) || '-' || v::text || '@ovalball.test';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v, p_label, 'Standing', v_email, p_dob, 'ACTIVE')
  on conflict (id) do update set first_name = excluded.first_name, surname = excluded.surname, date_of_birth = excluded.date_of_birth, account_state = 'ACTIVE';
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

create or replace function pg_temp.team(p_club uuid, p_name text, p_category text, p_age text, p_gender text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, p_name, 'mst-' || substr(gen_random_uuid()::text, 1, 12), p_category, p_age, p_gender, 'union', true) returning id into v;
  return v;
end $$;
create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;
-- A player, their guardian (if any) and their place (if any).
create or replace function pg_temp.player(p_key text, p_dob date, p_parent uuid, p_team uuid, p_user uuid default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway, user_id)
  values (initcap(p_key), 'Standing', p_dob, true, 'MALE', p_user) returning id into v;
  if p_parent is not null then
    insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
    values (p_parent, v, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD');
  end if;
  if p_team is not null then
    insert into public.player_team_memberships (player_id, team_id, status, state, source) values (v, p_team, 'active', 'ACTIVE', 'CLUB_CREATED');
  end if;
  perform pg_temp.put(p_key, v);
  return v;
end $$;
create or replace function pg_temp.enrol(p_key text, p_payer uuid, p_from date, p_status text default 'active', p_relationship text default 'guardian') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, effective_from, created_by,
                                                 base_amount_minor, final_amount_minor, pricing_id, ended_at, effective_to)
  values (pg_temp.id(p_key), pg_temp.id('programme'), p_payer, p_relationship, p_status, p_from, p_payer, 1600, 1600, pg_temp.id('pricing'),
          case when p_status = 'ended' then now() - interval '30 days' end, case when p_status = 'ended' then current_date - 30 end)
  returning id into v;
  perform pg_temp.put(p_key || '_psp', v);
  return v;
end $$;
create or replace function pg_temp.owe(p_key text, p_status text, p_amount int default 1600, p_effective date default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor,
                                             due_date, status, membership_effective_date, is_prorated, proration_chargeable_days, proration_total_days)
  values (pg_temp.id('programme'), pg_temp.id('club'), pg_temp.id(p_key), pg_temp.id(p_key || '_psp'), pg_temp.id('pricing'), pg_temp.period(),
          p_amount, pg_temp.period(), p_status, p_effective, p_effective is not null,
          case when p_effective is not null then (pg_temp.period() + interval '1 month')::date - p_effective end,
          case when p_effective is not null then (pg_temp.period() + interval '1 month')::date - pg_temp.period() end)
  returning id into v;
  perform pg_temp.put(p_key || '_ob', v);
  return v;
end $$;
create or replace function pg_temp.pay(p_key text, p_status text, p_gross int default 1600) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.gocardless_payments (club_id, obligation_id, gc_payment_id, gross_amount_minor, status)
  values (pg_temp.id('club'), pg_temp.id(p_key || '_ob'), 'PM_MST_' || p_key || '_' || substr(gen_random_uuid()::text, 1, 6), p_gross, p_status)
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
  values (pg_temp.id('club'), v_payer, 'CU_MST_' || substr(v_payer::text, 1, 8))
  on conflict (club_id, payer_user_id) do update set updated_at = now()
  returning id into v_cust;
  insert into public.gocardless_billing_requests (club_id, payer_subscription_id, gc_billing_request_id, status, created_by)
  values (pg_temp.id('club'), pg_temp.id(p_key || '_psp'), 'BRQ_MST_' || p_key || '_' || substr(gen_random_uuid()::text, 1, 6), 'fulfilled', v_payer)
  returning id into v_br;
  insert into public.gocardless_mandates (club_id, gocardless_customer_id, billing_request_id, gc_mandate_id, status)
  values (pg_temp.id('club'), v_cust, v_br, 'MD_MST_' || p_key || '_' || substr(gen_random_uuid()::text, 1, 6), p_status)
  returning id into v;
  perform pg_temp.put(p_key || '_md', v);
  return v;
end $$;
create or replace function pg_temp.collecting(p_key text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.gocardless_subscriptions (club_id, payer_subscription_id, gocardless_mandate_id, pricing_id, gc_subscription_id, amount_minor, status)
  values (pg_temp.id('club'), pg_temp.id(p_key || '_psp'), pg_temp.id(p_key || '_md'), pg_temp.id('pricing'),
          'SB_MST_' || p_key || '_' || substr(gen_random_uuid()::text, 1, 6), 1600, 'active')
  returning id into v;
  return v;
end $$;

-- The standing of one player on a board.
create or replace function pg_temp.row_of(p_board jsonb, p_key text) returns jsonb language sql as $$
  select r from jsonb_array_elements(coalesce(p_board -> 'rows', '[]'::jsonb)) r where (r ->> 'player_id')::uuid = pg_temp.id(p_key) $$;
create or replace function pg_temp.standing(p_board jsonb, p_key text) returns text language sql as $$
  select (pg_temp.row_of(p_board, p_key) ->> 'standing') || '/' || (pg_temp.row_of(p_board, p_key) ->> 'reason') $$;

-- =====================================================================================================
-- SEED: one club running membership (collected on the 1st, £16), its Under 12s and Under 13s and a men's
-- side, a Club Admin, each team's Team Manager, a parent paying for most of the children, a second parent,
-- and an adult player.
-- =====================================================================================================
do $$
declare v_tag text := substr(gen_random_uuid()::text, 1, 8); v_dir uuid; v_club uuid; v_ms uuid; v_prog uuid; v_price uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Standing ' || v_tag || ' RFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mst-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'mst-' || v_tag, 'active') returning id into v_club;
  perform pg_temp.put('club', v_club);
  perform pg_temp.put('u12', pg_temp.team(v_club, 'Under 12 Boys', 'youth', 'U12', 'boys'));
  perform pg_temp.put('u13', pg_temp.team(v_club, 'Under 13 Boys', 'youth', 'U13', 'boys'));
  perform pg_temp.put('men', pg_temp.team(v_club, 'Men''s 1st Team', 'senior', null, 'mens'));

  perform pg_temp.put('ca', pg_temp.person('Clubadmin'));
  perform pg_temp.member(v_club, pg_temp.id('ca'), 'CLUB_ADMIN');
  perform pg_temp.put('tm12', pg_temp.person('Manager12'));
  v_ms := pg_temp.member(v_club, pg_temp.id('tm12'));
  perform internal.grant_role(v_ms, 'TEAM_MANAGER', pg_temp.id('u12'), 'LEGACY_BACKFILL', 'mst seed');
  perform pg_temp.put('tm13', pg_temp.person('Manager13'));
  v_ms := pg_temp.member(v_club, pg_temp.id('tm13'));
  perform internal.grant_role(v_ms, 'TEAM_MANAGER', pg_temp.id('u13'), 'LEGACY_BACKFILL', 'mst seed');
  perform pg_temp.put('coach12', pg_temp.person('Coach12'));
  v_ms := pg_temp.member(v_club, pg_temp.id('coach12'));
  perform internal.grant_role(v_ms, 'COACH', pg_temp.id('u12'), 'LEGACY_BACKFILL', 'mst seed');
  perform pg_temp.put('pam', pg_temp.person('Pam'));
  perform pg_temp.put('gus', pg_temp.person('Gus'));
  perform pg_temp.put('adam_user', pg_temp.person('Adam', (current_date - interval '25 years')::date));
  perform pg_temp.put('fin_user', pg_temp.person('Finlogin', pg_temp.dob('U12')));

  insert into public.club_subscription_programmes (club_id, enabled, collection_day, created_by) values (v_club, true, 1, pg_temp.id('ca')) returning id into v_prog;
  perform pg_temp.put('programme', v_prog);
  insert into public.club_subscription_pricing (programme_id, amount_minor, effective_from, created_by)
  values (v_prog, 1600, current_date - 90, pg_temp.id('ca')) returning id into v_price;
  perform pg_temp.put('pricing', v_price);

  -- Under 12s: Abe paid; Ben with the bank; Cal's payment failed; Dan's month is unpaid and late; Eve
  -- joined on the 20th (a part month); Fin is in the team and nothing is set up (and has his own login).
  perform pg_temp.player('abe', pg_temp.dob('U12'), pg_temp.id('pam'), pg_temp.id('u12'));
  perform pg_temp.enrol('abe', pg_temp.id('pam'), current_date - 60); perform pg_temp.owe('abe', 'PAID'); perform pg_temp.pay('abe', 'confirmed');
  perform pg_temp.mandate('abe', 'active');
  perform pg_temp.player('ben', pg_temp.dob('U12'), pg_temp.id('pam'), pg_temp.id('u12'));
  perform pg_temp.enrol('ben', pg_temp.id('pam'), current_date - 60); perform pg_temp.owe('ben', 'SUBMITTED'); perform pg_temp.pay('ben', 'submitted');
  perform pg_temp.mandate('ben', 'active');
  perform pg_temp.player('cal', pg_temp.dob('U12'), pg_temp.id('pam'), pg_temp.id('u12'));
  perform pg_temp.enrol('cal', pg_temp.id('pam'), current_date - 60); perform pg_temp.owe('cal', 'FAILED'); perform pg_temp.pay('cal', 'failed');
  perform pg_temp.mandate('cal', 'active');
  perform pg_temp.player('dan', pg_temp.dob('U12'), pg_temp.id('gus'), pg_temp.id('u12'));
  perform pg_temp.enrol('dan', pg_temp.id('gus'), current_date - 60); perform pg_temp.owe('dan', 'SETUP_PENDING');
  perform pg_temp.player('eve', pg_temp.dob('U12'), pg_temp.id('gus'), pg_temp.id('u12'));
  perform pg_temp.enrol('eve', pg_temp.id('gus'), pg_temp.asof()); perform pg_temp.owe('eve', 'SETUP_PENDING', 600, pg_temp.asof());
  perform pg_temp.player('fin', pg_temp.dob('U12'), pg_temp.id('gus'), pg_temp.id('u12'), pg_temp.id('fin_user'));

  -- Under 13s: Gil exempt; Hal enrolled though he left every team; Ida's membership ended; Jon's Direct Debit
  -- is in place and this month is scheduled; Kit's mandate failed; Lou is being retried; Ned was refunded
  -- part of a paid month; Zak costs nothing (a full sibling discount).
  perform pg_temp.player('gil', pg_temp.dob('U13'), pg_temp.id('pam'), pg_temp.id('u13'));
  perform pg_temp.enrol('gil', pg_temp.id('pam'), current_date - 60); perform pg_temp.owe('gil', 'EXEMPT');
  perform pg_temp.player('hal', pg_temp.dob('U13'), pg_temp.id('pam'), null);
  perform pg_temp.enrol('hal', pg_temp.id('pam'), current_date - 60);
  perform pg_temp.player('ida', pg_temp.dob('U13'), pg_temp.id('pam'), null);
  perform pg_temp.enrol('ida', pg_temp.id('pam'), current_date - 200, 'ended');
  perform pg_temp.player('jon', pg_temp.dob('U13'), pg_temp.id('pam'), pg_temp.id('u13'));
  perform pg_temp.enrol('jon', pg_temp.id('pam'), current_date - 60); perform pg_temp.mandate('jon', 'active'); perform pg_temp.collecting('jon');
  perform pg_temp.player('kit', pg_temp.dob('U13'), pg_temp.id('gus'), pg_temp.id('u13'));
  perform pg_temp.enrol('kit', pg_temp.id('gus'), current_date - 60); perform pg_temp.owe('kit', 'SETUP_PENDING'); perform pg_temp.mandate('kit', 'failed');
  perform pg_temp.player('lou', pg_temp.dob('U13'), pg_temp.id('gus'), pg_temp.id('u13'));
  perform pg_temp.enrol('lou', pg_temp.id('gus'), current_date - 60); perform pg_temp.owe('lou', 'RETRYING'); perform pg_temp.pay('lou', 'submitted');
  perform pg_temp.mandate('lou', 'active');
  perform pg_temp.player('ned', pg_temp.dob('U13'), pg_temp.id('gus'), pg_temp.id('u13'));
  perform pg_temp.enrol('ned', pg_temp.id('gus'), current_date - 60); perform pg_temp.owe('ned', 'REFUNDED'); perform pg_temp.pay('ned', 'paid_out');
  insert into public.payment_refunds (payment_id, amount_minor, reason, status, created_by) values (pg_temp.id('ned_pay'), 600, 'mst: a partial refund', 'pending', pg_temp.id('ca'));
  perform pg_temp.player('zak', pg_temp.dob('U13'), pg_temp.id('pam'), pg_temp.id('u13'));
  perform pg_temp.enrol('zak', pg_temp.id('pam'), current_date - 60); perform pg_temp.owe('zak', 'EXEMPT', 0);

  -- Adam is an adult who plays for the men's side, with his own login, and nothing is set up.
  perform pg_temp.player('adam', (current_date - interval '25 years')::date, null, pg_temp.id('men'), pg_temp.id('adam_user'));
end $$;

-- =====================================================================================================
-- MS. THE STANDING
-- =====================================================================================================
do $$
declare b jsonb := pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L, null, %L)', pg_temp.id('club'), pg_temp.asof()));
begin
  perform pg_temp.check(pg_temp.standing(b, 'abe') = 'UP_TO_DATE/PAID', 'MS1 a paid month is Up to date (' || coalesce(pg_temp.standing(b, 'abe'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'ben') = 'COLLECTING/WITH_THE_BANK', 'MS2 a payment with the bank is Collecting (' || coalesce(pg_temp.standing(b, 'ben'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'lou') = 'COLLECTING/RETRYING', 'MS3 a payment being retried is Collecting, not failed (' || coalesce(pg_temp.standing(b, 'lou'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'jon') = 'COLLECTING/SCHEDULED'
                        and (pg_temp.row_of(b, 'jon') ->> 'next_collection_date')::date = (pg_temp.period() + interval '1 month')::date,
    'MS4 a Direct Debit in place with this month not yet collected is Collecting, scheduled for the next collection day (' || coalesce(pg_temp.standing(b, 'jon'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'dan') = 'OVERDUE/SETUP_UNFINISHED', 'MS5 an unpaid month more than five days past its due date, not with the bank, is Overdue (' || coalesce(pg_temp.standing(b, 'dan'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'eve') = 'DUE/SETUP_UNFINISHED', 'MS6 a member who joined on the 20th is Due, never Overdue on the day they joined (' || coalesce(pg_temp.standing(b, 'eve'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'cal') = 'ACTION_NEEDED/PAYMENT_FAILED', 'MS7 a failed payment needs action (' || coalesce(pg_temp.standing(b, 'cal'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'kit') = 'ACTION_NEEDED/MANDATE_PROBLEM', 'MS8 a failed Direct Debit needs action (' || coalesce(pg_temp.standing(b, 'kit'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'hal') = 'ACTION_NEEDED/LEFT_THE_TEAM', 'MS9 still enrolled after leaving every team needs action, not a quiet monthly charge (' || coalesce(pg_temp.standing(b, 'hal'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'fin') = 'NOT_SET_UP/NO_PAYER', 'MS10 a child in a team with nothing set up is Not set up (' || coalesce(pg_temp.standing(b, 'fin'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'adam') = 'NOT_SET_UP/NO_PAYER', 'MS11 so is an adult player (' || coalesce(pg_temp.standing(b, 'adam'), '-') || ')');
  perform pg_temp.check(pg_temp.standing(b, 'gil') = 'EXEMPT/EXEMPT' and pg_temp.standing(b, 'ned') = 'EXEMPT/REFUNDED' and pg_temp.standing(b, 'zak') = 'EXEMPT/NOTHING_TO_PAY',
    'MS12 an exempt, a refunded and a free month owe nothing');
  perform pg_temp.check(pg_temp.standing(b, 'ida') = 'ENDED/ENDED', 'MS13 an ended membership of a player in no team is Ended (' || coalesce(pg_temp.standing(b, 'ida'), '-') || ')');
  perform pg_temp.check((b #>> '{counts,total}')::int = 14 and (b #>> '{counts,up_to_date}')::int = 1 and (b #>> '{counts,collecting}')::int = 3
                        and (b #>> '{counts,due}')::int = 1 and (b #>> '{counts,overdue}')::int = 1 and (b #>> '{counts,action_needed}')::int = 3
                        and (b #>> '{counts,not_set_up}')::int = 2 and (b #>> '{counts,exempt}')::int = 3 and (b #>> '{counts,ended}')::int = 1
                        and (b #>> '{counts,active_memberships}')::int = 12,
    'MS14 the counts are the rows: 14 who need or hold membership, each counted once (' || (b -> 'counts')::text || ')');
  perform pg_temp.check((pg_temp.row_of(b, 'cal') -> 'payer' ->> 'name') = 'Pam Standing' and (pg_temp.row_of(b, 'cal') ->> 'amount_due_minor')::int = 1600,
    'MS15 the club''s board names the responsible payer and the amount');
  perform pg_temp.check((select array_agg(r.value ->> 'standing' order by r.ord) from jsonb_array_elements(b -> 'rows') with ordinality r(value, ord))[1:3] = array['ACTION_NEEDED','ACTION_NEEDED','ACTION_NEEDED'],
    'MS16 what needs action comes first');
end $$;

-- =====================================================================================================
-- MM. THE MONTH'S MONEY
-- =====================================================================================================
do $$
declare b jsonb := pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L, null, %L)', pg_temp.id('club'), pg_temp.asof()));
        m jsonb;
begin
  m := b -> 'money';
  perform pg_temp.check((m ->> 'expected_minor')::int = 10200,
    'MM1 Expected is the months that are owed: cancelled, exempt, waived and refunded months are not expected (' || (m ->> 'expected_minor') || ')');
  -- A REFUND IS GIVEN BACK WHEN GOCARDLESS CONFIRMS IT (Part 2, 20270753000000). Ned's £6 refund is still pending
  -- at GoCardless: his £16 has arrived and has not yet gone back, so it still counts as collected.
  perform pg_temp.check((m ->> 'collected_minor')::int = 3200,
    'MM2 Collected is money that arrived, less CONFIRMED refunds: Abe £16 + Ned £16, whose £6 refund is still pending (' || (m ->> 'collected_minor') || ')');
  perform pg_temp.check((m ->> 'collecting_minor')::int = 3200,
    'MM3 a scheduled or submitted collection is Collecting, never Collected (' || (m ->> 'collecting_minor') || ')');
  perform pg_temp.check((m ->> 'outstanding_minor')::int = 8600,
    'MM4 Outstanding is what is owed and not yet paid, including what is with the bank (' || (m ->> 'outstanding_minor') || ')');
  perform pg_temp.check((m ->> 'overdue_minor')::int = 3200,
    'MM5 Overdue is unpaid money past due that is not with the bank -- not Eve''s first part month (' || (m ->> 'overdue_minor') || ')');
  perform pg_temp.check((m ->> 'failed_minor')::int = 1600 and (m ->> 'refunded_minor')::int = 0 and (m ->> 'waived_minor')::int = 1600,
    'MM6 Failed, Refunded and Waived are their own figures -- a pending refund is not yet Refunded');
  perform pg_temp.check((m ->> 'next_collection_minor')::int = 1600,
    'MM7 the next collection is the enrolments with a live Direct Debit collecting -- a mandate alone is not money (' || (m ->> 'next_collection_minor') || ')');
  -- GoCardless confirms Ned's refund: now it has been given back.
  update public.payment_refunds set status = 'confirmed' where payment_id = pg_temp.id('ned_pay');
  m := pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L, null, %L)', pg_temp.id('club'), pg_temp.asof())) -> 'money';
  perform pg_temp.check((m ->> 'collected_minor')::int = 2600 and (m ->> 'refunded_minor')::int = 600,
    'MM6b once GoCardless confirms the refund it is Refunded, and no longer Collected: £32 - £6 (' || (m ->> 'collected_minor') || ')');
  -- A retried payment is one obligation: a second, failed attempt at Lou's month does not count twice.
  insert into public.gocardless_payments (club_id, obligation_id, gc_payment_id, gross_amount_minor, status)
  values (pg_temp.id('club'), pg_temp.id('lou_ob'), 'PM_MST_lou_retry_' || substr(gen_random_uuid()::text, 1, 6), 1600, 'failed');
  b := pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L, null, %L)', pg_temp.id('club'), pg_temp.asof()));
  perform pg_temp.check((b #>> '{money,expected_minor}')::int = 10200 and (b #>> '{money,outstanding_minor}')::int = 8600 and (b #>> '{money,collected_minor}')::int = 2600,
    'MM8 a retried payment counts once: the month is one obligation');
  b := pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L, %L, %L)', pg_temp.id('club'), pg_temp.id('u12'), pg_temp.asof()));
  perform pg_temp.check((b #>> '{counts,total}')::int = 6 and (b #>> '{money,expected_minor}')::int = 7000 and (b #>> '{money,collected_minor}')::int = 1600,
    'MM9 filtered to a team, the same definitions over that team''s players (' || (b -> 'money')::text || ')');
end $$;

-- =====================================================================================================
-- MA. WHO MAY SEE WHAT
-- =====================================================================================================
do $$
declare v text; t jsonb; c jsonb;
begin
  v := pg_temp.say_as(pg_temp.id('tm12'), format('select public.club_membership_board(%L)', pg_temp.id('club')));
  perform pg_temp.check(v like '42501%', 'MA1 a Team Manager cannot read the club''s board (' || v || ')');
  t := pg_temp.json_as(pg_temp.id('tm12'), format('select public.team_membership_board(%L, %L)', pg_temp.id('u12'), pg_temp.asof()));
  c := pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L, null, %L)', pg_temp.id('club'), pg_temp.asof()));
  perform pg_temp.check((t #>> '{counts,total}')::int = 6 and (t #>> '{counts,up_to_date}')::int = 1 and (t #>> '{counts,collecting}')::int = 1
                        and (t #>> '{counts,overdue}')::int = 1 and (t #>> '{counts,action_needed}')::int = 1 and (t #>> '{counts,due}')::int = 1
                        and (t #>> '{counts,not_set_up}')::int = 1,
    'MA2 the Team Manager reads their own team: 6 players, 1 up to date, 1 collecting, 1 due, 1 overdue, 1 needs action, 1 not set up');
  perform pg_temp.check((select bool_and(pg_temp.standing(t, k) = pg_temp.standing(c, k)) from unnest(array['abe','ben','cal','dan','eve','fin']) k),
    'MA3 every player has the same standing on the team''s board as on the club''s: one derivation');
  perform pg_temp.check(not exists (select 1 from jsonb_array_elements(t -> 'rows') r where r ? 'payer' or r ? 'payer_subscription_id' or r ? 'mandate_status')
                        and not (t ? 'money')
                        and not exists (select 1 from jsonb_array_elements(t -> 'rows') r where (r ->> 'player_id')::uuid in (pg_temp.id('gil'), pg_temp.id('hal'), pg_temp.id('adam'))),
    'MA4 and nothing else: no payer, no mandate, no money totals, no player outside the team');
  v := pg_temp.say_as(pg_temp.id('tm12'), format('select public.team_membership_board(%L)', pg_temp.id('u13')));
  perform pg_temp.check(v like '42501%', 'MA5 nor another team''s board (' || v || ')');
  v := pg_temp.say_as(pg_temp.id('coach12'), format('select public.team_membership_board(%L)', pg_temp.id('u12')));
  perform pg_temp.check(v like '42501%', 'MA6 a coach without the capability reads no board (' || v || ')');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('pam'), format('select public.team_membership_board(%L)', pg_temp.id('u12'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('pam'), format('select public.club_membership_board(%L)', pg_temp.id('club'))) like '42501%',
    'MA7 a parent reads neither board');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('tm12'), 'select * from internal.membership_standing(gen_random_uuid())') like '42501%',
    'MA8 nobody signed in can call the derivation itself');
end $$;

-- =====================================================================================================
-- MR. REMINDERS
-- =====================================================================================================
do $$
declare r jsonb; v text; v_before bigint;
begin
  -- The club reminds Dan's payer (Gus) and Fin, who has nothing set up: Fin's guardian is asked, Fin is not.
  r := pg_temp.json_as(pg_temp.id('ca'), format('select public.send_membership_reminders(%L, %L::uuid[])', pg_temp.id('club'),
         array[pg_temp.id('dan'), pg_temp.id('fin')]));
  perform pg_temp.check((r ->> 'sent')::int = 2 and (r ->> 'recipients')::int = 2 and jsonb_array_length(r -> 'skipped') = 0,
    'MR1 the club reminds two players'' families (' || r::text || ')');
  perform pg_temp.check((select count(*) from public.notifications where user_id = pg_temp.id('gus') and type = 'membership_reminder'
                           and (data ->> 'player_id')::uuid in (pg_temp.id('dan'), pg_temp.id('fin'))) = 2,
    'MR2 through the one notification system, to the responsible payer and, with nothing set up, to the guardian');
  perform pg_temp.check(not exists (select 1 from public.notifications where user_id = pg_temp.id('fin_user')),
    'MR3 never to the child, though the child has their own login');
  perform pg_temp.check((select count(*) from public.finance_audit_log where club_id = pg_temp.id('club') and action = 'membership_reminder_sent'
                           and actor_user_id = pg_temp.id('ca') and target_id in (pg_temp.id('dan'), pg_temp.id('fin'))) = 2,
    'MR4 each reminder is recorded with who sent it');
  perform pg_temp.check(not (r ? 'recipients_ids') and r::text not like '%' || pg_temp.id('gus')::text || '%',
    'MR5 the answer carries counts, never who was told');

  -- An adult player is asked themselves.
  r := pg_temp.json_as(pg_temp.id('ca'), format('select public.send_membership_reminders(%L, %L::uuid[])', pg_temp.id('club'), array[pg_temp.id('adam')]));
  perform pg_temp.check((r ->> 'sent')::int = 1 and exists (select 1 from public.notifications where user_id = pg_temp.id('adam_user') and type = 'membership_reminder'
                                                             and (data ->> 'self')::boolean),
    'MR6 an adult player with nothing set up is asked themselves');

  -- Nothing is asked of somebody up to date, or collecting; and a second reminder inside 72 hours is held back.
  r := pg_temp.json_as(pg_temp.id('ca'), format('select public.send_membership_reminders(%L, %L::uuid[])', pg_temp.id('club'),
         array[pg_temp.id('abe'), pg_temp.id('ben'), pg_temp.id('dan')]));
  perform pg_temp.check((r ->> 'sent')::int = 0
                        and (select count(*) from jsonb_array_elements(r -> 'skipped') s where s ->> 'reason' = 'NOTHING_TO_ASK') >= 1
                        and exists (select 1 from jsonb_array_elements(r -> 'skipped') s where (s ->> 'player_id')::uuid = pg_temp.id('dan') and s ->> 'reason' = 'RECENTLY_REMINDED'),
    'MR7 nobody up to date or already collecting is asked, and nobody is asked twice in 72 hours (' || (r -> 'skipped')::text || ')');

  -- A team's own staff: their own players only, and they never reach a payer by name.
  r := pg_temp.json_as(pg_temp.id('tm12'), format('select public.send_membership_reminders(%L, %L::uuid[], %L)', pg_temp.id('club'),
         array[pg_temp.id('cal'), pg_temp.id('kit')], pg_temp.id('u12')));
  perform pg_temp.check((r ->> 'sent')::int = 1
                        and exists (select 1 from jsonb_array_elements(r -> 'skipped') s where (s ->> 'player_id')::uuid = pg_temp.id('kit') and s ->> 'reason' = 'NOT_IN_TEAM')
                        and exists (select 1 from public.notifications where user_id = pg_temp.id('pam') and type = 'membership_reminder' and (data ->> 'player_id')::uuid = pg_temp.id('cal')),
    'MR8 a Team Manager reminds the payer of a player in their own team, and nobody outside it (' || r::text || ')');
  v := pg_temp.say_as(pg_temp.id('tm12'), format('select public.send_membership_reminders(%L, %L::uuid[])', pg_temp.id('club'), array[pg_temp.id('eve')]));
  perform pg_temp.check(v like '42501%', 'MR9 and cannot remind club-wide (' || v || ')');
  v := pg_temp.say_as(pg_temp.id('tm12'), format('select public.send_membership_reminders(%L, %L::uuid[], %L)', pg_temp.id('club'), array[pg_temp.id('kit')], pg_temp.id('u13')));
  perform pg_temp.check(v like '42501%', 'MR10 nor as another team (' || v || ')');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('coach12'), format('select public.send_membership_reminders(%L, %L::uuid[], %L)', pg_temp.id('club'), array[pg_temp.id('eve')], pg_temp.id('u12'))) like '42501%'
                        and pg_temp.say_as(pg_temp.id('pam'), format('select public.send_membership_reminders(%L, %L::uuid[])', pg_temp.id('club'), array[pg_temp.id('eve')])) like '42501%',
    'MR11 a coach without the capability, and a parent, cannot send one');

  -- The boards show who sent the last one.
  perform pg_temp.check((pg_temp.row_of(pg_temp.json_as(pg_temp.id('tm12'), format('select public.team_membership_board(%L)', pg_temp.id('u12'))), 'cal') ->> 'last_reminded_by') = 'Manager12 Standing'
                        and not (pg_temp.row_of(pg_temp.json_as(pg_temp.id('tm12'), format('select public.team_membership_board(%L)', pg_temp.id('u12'))), 'cal') ->> 'can_remind')::boolean,
    'MR12 the team''s board shows who sent the last reminder, and holds the next one back');

  -- The club tells a team's staff how many of their players need attention -- once a day.
  v_before := (select count(*) from public.notifications where user_id = pg_temp.id('tm13') and type = 'membership_team_attention');
  r := pg_temp.json_as(pg_temp.id('ca'), format('select public.send_team_membership_attention(%L)', pg_temp.id('u13')));
  perform pg_temp.check((r ->> 'players')::int = 1
                        and (select count(*) from public.notifications where user_id = pg_temp.id('tm13') and type = 'membership_team_attention') = v_before + 1
                        and (select body from public.notifications where user_id = pg_temp.id('tm13') and type = 'membership_team_attention' order by created_at desc limit 1)
                            = 'Under 13 Boys has 1 player whose membership needs attention.',
    'MR13 the club tells the Under 13s'' Team Manager how many players need attention (' || r::text || ')');
  perform pg_temp.check(pg_temp.say_as(pg_temp.id('ca'), format('select public.send_team_membership_attention(%L)', pg_temp.id('u13'))) like '54000%'
                        and pg_temp.say_as(pg_temp.id('tm12'), format('select public.send_team_membership_attention(%L)', pg_temp.id('u12'))) like '42501%',
    'MR14 once a day per team, and only the club can send it');
end $$;

-- =====================================================================================================
-- MS17. A DIRECT DEBIT THE PAYER SUSPENDED, OR ONE GOCARDLESS BLOCKED, IS A PROBLEM (20270744000000 section 7)
-- =====================================================================================================
do $$
declare b jsonb;
begin
  update public.gocardless_mandates set status = 'suspended_by_payer' where id = pg_temp.id('jon_md');
  b := pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L, null, %L)', pg_temp.id('club'), pg_temp.asof()));
  perform pg_temp.check(pg_temp.standing(b, 'jon') = 'ACTION_NEEDED/MANDATE_PROBLEM',
    'MS17 a Direct Debit the payer suspended is a problem, never "collecting" (' || coalesce(pg_temp.standing(b, 'jon'), '-') || ')');
  update public.gocardless_mandates set status = 'blocked' where id = pg_temp.id('jon_md');
  b := pg_temp.json_as(pg_temp.id('ca'), format('select public.club_membership_board(%L, null, %L)', pg_temp.id('club'), pg_temp.asof()));
  perform pg_temp.check(pg_temp.standing(b, 'jon') = 'ACTION_NEEDED/MANDATE_PROBLEM',
    'MS17b and so is one GoCardless blocked (' || coalesce(pg_temp.standing(b, 'jon'), '-') || ')');
  update public.gocardless_mandates set status = 'active' where id = pg_temp.id('jon_md');
end $$;

-- =====================================================================================================
-- MF. A FAMILY READS THE SAME STANDING (20270747000000)
-- =====================================================================================================
do $$
declare v jsonb; v_second uuid; v_text text;
begin
  -- Cal's payment failed while his Direct Debit is live: the case the old family projection showed as fine.
  v := pg_temp.json_as(pg_temp.id('pam'), format('select public.family_membership_standing(%L, %L)', pg_temp.id('cal'), pg_temp.id('club')));
  perform pg_temp.check(v ->> 'standing' = 'ACTION_NEEDED' and v ->> 'reason' = 'PAYMENT_FAILED' and (v ->> 'payer_is_you')::boolean,
    'MF1 the paying parent reads the same standing the club and the team see -- a failed payment is a failure (' || v::text || ')');
  -- A second guardian who does not pay: told the membership is in hand, never by whom.
  v_second := pg_temp.person('Secondguardian');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
  values (v_second, pg_temp.id('cal'), 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD');
  v := pg_temp.json_as(v_second, format('select public.family_membership_standing(%L, %L)', pg_temp.id('cal'), pg_temp.id('club')));
  -- Part 2 (20270753000000, section 31): and nothing of the payer's money -- not the amount, not that their payment failed.
  perform pg_temp.check(v -> 'standing' = 'null'::jsonb and v -> 'reason' = 'null'::jsonb and not (v ? 'amount_due_minor') and not (v ? 'monthly_amount_minor')
                        and (v ->> 'has_payer')::boolean and not (v ->> 'payer_is_you')::boolean
                        and v::text not like '%' || pg_temp.id('pam')::text || '%' and v::text not like '%Pam%',
    'MF2 a second guardian learns somebody pays -- never who, never the payer''s amounts, never that their payment failed (' || v::text || ')');
  v := pg_temp.json_as(pg_temp.id('fin_user'), format('select public.family_membership_standing(%L, %L)', pg_temp.id('fin'), pg_temp.id('club')));
  perform pg_temp.check(v ->> 'standing' = 'NOT_SET_UP',
    'MF3 the linked player reads their own standing (' || coalesce(v ->> 'standing', '-') || ')');
  v_text := pg_temp.say_as(pg_temp.id('gus'), format('select public.family_membership_standing(%L, %L)', pg_temp.id('cal'), pg_temp.id('club')));
  perform pg_temp.check(v_text like '42501%', 'MF4 another family reads nothing (' || v_text || ')');
  v_text := pg_temp.say_as(pg_temp.id('coach12'), format('select public.family_membership_standing(%L, %L)', pg_temp.id('abe'), pg_temp.id('club')));
  perform pg_temp.check(v_text like '42501%', 'MF5 nor does the child''s coach: a family''s door is not a staff one (' || v_text || ')');
end $$;

rollback;
