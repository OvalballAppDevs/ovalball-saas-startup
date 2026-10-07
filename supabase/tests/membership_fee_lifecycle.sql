-- =====================================================================================================
-- OVALBALL'S 2.5% THROUGH A PAYMENT'S WHOLE LIFE (Club Memberships Part 1, 20270748000000)
--
-- The fee rules themselves are proved in membership_setup.sql (SF*, SFP*). This suite drives payments through
-- the CANONICAL STATUS DOOR the webhooks use (apply_payment_status_transition), not by editing rows, and proves
-- that the money reconciles at every step:
--
--   FL1-FL3   WHAT A MONTH COLLECTS: the club bears it (collect = price, fee taken from it); members bear it
--             (collect = price + fee); a pro-rata first month carries 2.5% of its own amount, half up.
--   FL4-FL6   FAILURE AND RETRY: an immediate failure earns nothing; GoCardless retrying the SAME payment keeps
--             one payment and one fee, earned once when it is collected; a duplicate webhook changes nothing.
--   FL7       OUT OF ORDER: an older observation arriving after a newer one changes nothing, and is recorded.
--   FL8-FL10  AFTER COLLECTION: a late failure and a chargeback return the fee; a chargeback the bank reverses is
--             collected after all; a cancellation carries no fee and never reopens; one still with the bank is pending.
--   FL11      NOTHING TO COLLECT: a fully discounted month is exempt and carries no fee and no payment.
--   FL12-FL14 RECONCILIATION across every month of the club: collect = price + members' fee, fee = 2.5% of the
--             price half up, gross − fee = what reaches the club before GoCardless; an app fee never exceeds half
--             a payment; no fee is ever counted as earned before its payment is collected (no phantom revenue);
--             every obligation holds one payment at most.
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
declare v uuid := gen_random_uuid(); v_email text := 'mfl-' || lower(p_label) || '-' || v::text || '@ovalball.test';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v, p_label, 'Lifecycle', v_email, p_dob, 'ACTIVE')
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

create or replace function pg_temp.player(p_key text, p_parent uuid, p_team uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
  values (initcap(p_key), 'Lifecycle', pg_temp.dob('U12'), true, 'MALE') returning id into v;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source)
  values (p_parent, v, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD');
  insert into public.player_team_memberships (player_id, team_id, status, state, source) values (v, p_team, 'active', 'ACTIVE', 'CLUB_CREATED');
  perform pg_temp.put(p_key, v);
  return v;
end $$;

/** Enrol a player with their parent as the responsible payer, joining on the given day of this month. */
create or replace function pg_temp.enrol(p_key text, p_parent text, p_joined date) returns uuid language plpgsql as $$
declare v_psp uuid;
begin
  v_psp := pg_temp.uuid_as(pg_temp.id(p_parent), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id(p_key), pg_temp.id('programme')));
  update public.player_subscription_payers set effective_from = p_joined where id = v_psp;
  return pg_temp.put(p_key || '_psp', v_psp);
end $$;

create or replace function pg_temp.obligation(p_key text) returns public.membership_obligations language sql as $$
  select o.* from public.membership_obligations o where o.player_id = pg_temp.id(p_key) and o.billing_period = pg_temp.period() $$;
create or replace function pg_temp.position(p_key text) returns text language sql as $$
  select fee_position from internal.membership_fee_position((pg_temp.obligation(p_key)).id) $$;

/** GoCardless creates a payment for this month (what activate-membership does), as the server. */
create or replace function pg_temp.pay(p_key text, p_status text default 'pending_submission') returns text language plpgsql as $$
declare o public.membership_obligations := pg_temp.obligation(p_key); v_gc text := 'PM_MFL_' || p_key || '_' || substr(o.id::text, 1, 8);
begin
  set local role service_role;
  perform public.record_gocardless_payment(o.id, v_gc, o.collect_amount_minor, 'GBP', null, p_status, null, o.platform_fee_minor);
  reset role;
  return v_gc;
end $$;

/** A webhook: GoCardless says this payment is now in this status, as observed at this moment. */
create or replace function pg_temp.event(p_gc text, p_status text, p_observed timestamptz, p_event text default null, p_reason text default null) returns void language plpgsql as $$
begin
  set local role service_role;
  perform public.apply_payment_status_transition(p_gc, p_status, p_reason, null, coalesce(p_event, 'EV_' || p_gc || '_' || p_status), p_observed);
  reset role;
end $$;

create or replace function pg_temp.payment(p_gc text) returns public.gocardless_payments language sql as $$
  select * from public.gocardless_payments where gc_payment_id = p_gc $$;

-- =====================================================================================================
-- SEED: one club, its Under 12s, a Club Admin and two parents. Terms agreed, settings saved (the club pays
-- Ovalball's fee, pro rata first months, the 1st), the club's one membership priced at £20.00, GoCardless
-- connected and verified, memberships switched on through Activate.
-- =====================================================================================================
do $$
declare v_tag text := substr(gen_random_uuid()::text, 1, 8); v_dir uuid; v_club uuid; v_team uuid; v_product uuid; v_prog uuid; v jsonb;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Lifecycle ' || v_tag || ' RFC', 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mfl-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'mfl-' || v_tag, 'active') returning id into v_club;
  perform pg_temp.put('club', v_club);
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'mfl-' || v_tag || '-u12', 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  perform pg_temp.put('u12', v_team);
  perform pg_temp.put('ca', pg_temp.person('Clubadmin'));
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, pg_temp.id('ca'), 'CLUB_ADMIN', 'active');
  perform pg_temp.put('pam', pg_temp.person('Pam'));
  perform pg_temp.put('gus', pg_temp.person('Gus'));

  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.accept_club_membership_terms(%L, %L)', v_club, internal.club_membership_terms_version()));
  v_prog := pg_temp.uuid_as(pg_temp.id('ca'), format('select public.save_membership_settings(%L, 1, %L, %L)', v_club, 'PRORATE_CURRENT_MONTH', 'CLUB'));
  perform pg_temp.put('programme', v_prog);
  select id into v_product from public.membership_products where club_id = v_club and status = 'active';
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.set_membership_product_price(%L, 2000, %L)', v_product, current_date));
  insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, verification_status, connected_by, connected_at)
  values (v_club, 'sandbox', 'OR_MFL_' || v_tag, null, 'read_write', 'successful', pg_temp.id('ca'), now());
  v := pg_temp.json_as(pg_temp.id('ca'), format('select public.activate_membership_programme(%L)', v_club));
  perform pg_temp.check(v ->> 'outcome' = 'ACTIVATED', 'FL0 the world is set up through the real doors: terms, settings, a £20.00 membership, a verified connection, Activate');

  -- Club-borne fee: Abe (whole month), Pip (joined on the 11th, pro rata). Then the club moves the fee to its
  -- members, and Dan enrols under that; the earlier enrolments keep the terms they joined on.
  perform pg_temp.player('abe', pg_temp.id('pam'), v_team);
  perform pg_temp.enrol('abe', 'pam', pg_temp.period());
  perform pg_temp.player('pip', pg_temp.id('pam'), v_team);
  perform pg_temp.enrol('pip', 'pam', pg_temp.period() + 10);
  perform pg_temp.player('cat', pg_temp.id('gus'), v_team);
  perform pg_temp.enrol('cat', 'gus', pg_temp.period());
  perform pg_temp.player('eve', pg_temp.id('gus'), v_team);
  perform pg_temp.enrol('eve', 'gus', pg_temp.period());
  perform pg_temp.player('fin', pg_temp.id('gus'), v_team);
  perform pg_temp.enrol('fin', 'gus', pg_temp.period());
  perform pg_temp.player('gil', pg_temp.id('gus'), v_team);
  perform pg_temp.enrol('gil', 'gus', pg_temp.period());
  perform pg_temp.player('zed', pg_temp.id('gus'), v_team);
  perform pg_temp.enrol('zed', 'gus', pg_temp.period());
  update public.player_subscription_payers set final_amount_minor = 0, sibling_discount_amount_minor = 2000 where id = pg_temp.id('zed_psp');
  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.save_membership_settings(%L, 1, %L, %L)', v_club, 'PRORATE_CURRENT_MONTH', 'PAYER'));
  perform pg_temp.player('dan', pg_temp.id('pam'), v_team);
  perform pg_temp.enrol('dan', 'pam', pg_temp.period());

  perform pg_temp.say_as(pg_temp.id('ca'), format('select public.create_membership_obligations_for_period(%L, %L)', v_club, pg_temp.period()));
end $$;

-- =====================================================================================================
-- FL1-FL3 WHAT A MONTH COLLECTS
-- =====================================================================================================
do $$
declare o public.membership_obligations;
begin
  o := pg_temp.obligation('abe');
  perform pg_temp.check(o.amount_due_minor = 2000 and o.platform_fee_minor = 50 and o.payer_fee_minor = 0 and o.collect_amount_minor = 2000,
    'FL1 the club bears the fee: £20.00 collected, Ovalball''s 50p taken from it, £19.50 reaches the club before GoCardless');
  o := pg_temp.obligation('dan');
  perform pg_temp.check(o.amount_due_minor = 2000 and o.platform_fee_minor = 50 and o.payer_fee_minor = 50 and o.collect_amount_minor = 2050,
    'FL2 members bear it: £20.50 collected, the club still receives the full £20.00 before GoCardless');
  perform pg_temp.check((pg_temp.obligation('abe')).payer_fee_minor = 0,
    'FL2b the change reached new enrolments only: Abe, enrolled before it, still has the club bearing his fee');
  o := pg_temp.obligation('pip');
  perform pg_temp.check(o.amount_due_minor > 0 and o.amount_due_minor < 2000
                        and o.platform_fee_minor = internal.ovalball_fee_minor(o.amount_due_minor, 250)
                        and o.collect_amount_minor = o.amount_due_minor,
    'FL3 a pro-rata first month carries 2.5% of its own amount, half up (' || coalesce(o.amount_due_minor, 0) || 'p → ' || coalesce(o.platform_fee_minor, 0) || 'p)');
end $$;

-- =====================================================================================================
-- FL4-FL6 FAILURE, RETRY, DUPLICATE DELIVERY
-- =====================================================================================================
do $$
declare v_gc text; t0 timestamptz := clock_timestamp(); v_transitions int;
begin
  v_gc := pg_temp.pay('abe');
  perform pg_temp.event(v_gc, 'submitted', t0 + interval '1 minute');
  perform pg_temp.event(v_gc, 'failed', t0 + interval '2 minutes', null, 'insufficient_funds');
  perform pg_temp.check(pg_temp.position('abe') = 'RETURNED' and (pg_temp.obligation('abe')).status = 'FAILED',
    'FL4 an immediate failure earns Ovalball nothing: the fee is returned and the month is failed');

  -- GoCardless retries the SAME payment: pending submission, submitted, confirmed.
  perform pg_temp.event(v_gc, 'pending_submission', t0 + interval '3 minutes');
  perform pg_temp.check((pg_temp.obligation('abe')).status = 'RETRYING' and pg_temp.position('abe') = 'PENDING',
    'FL5 a retry puts the month back on its way: retrying, and the fee pending again -- not earned twice, not lost');
  perform pg_temp.event(v_gc, 'submitted', t0 + interval '4 minutes');
  perform pg_temp.event(v_gc, 'confirmed', t0 + interval '5 minutes');
  perform pg_temp.check(pg_temp.position('abe') = 'EARNED' and (pg_temp.obligation('abe')).status = 'PAID'
                        and (select count(*) from public.gocardless_payments where obligation_id = (pg_temp.obligation('abe')).id) = 1
                        and (pg_temp.payment(v_gc)).app_fee_minor = 50,
    'FL5b collected after the retry: one payment, one 50p fee, earned once');

  -- The same confirmation delivered again (GoCardless redelivers), and a second time with a newer observation.
  select count(*) into v_transitions from public.finance_audit_log where target_id = (pg_temp.payment(v_gc)).id and action = 'payment_status_transition';
  perform pg_temp.event(v_gc, 'confirmed', t0 + interval '5 minutes', 'EV_' || v_gc || '_confirmed');
  perform pg_temp.event(v_gc, 'confirmed', t0 + interval '6 minutes', 'EV_' || v_gc || '_confirmed_again');
  perform pg_temp.check((select count(*) from public.finance_audit_log where target_id = (pg_temp.payment(v_gc)).id and action = 'payment_status_transition') = v_transitions
                        and pg_temp.position('abe') = 'EARNED' and (pg_temp.payment(v_gc)).app_fee_minor = 50
                        and (select count(*) from public.gocardless_payments where obligation_id = (pg_temp.obligation('abe')).id) = 1,
    'FL6 a duplicate webhook changes nothing: no second transition, no second payment, the same single fee');
end $$;

-- =====================================================================================================
-- FL7 OUT OF ORDER
-- =====================================================================================================
do $$
declare v_gc text; t0 timestamptz := clock_timestamp();
begin
  v_gc := pg_temp.pay('dan');
  -- The confirmation (observed later) arrives first; the older "submitted" observation arrives after it.
  perform pg_temp.event(v_gc, 'confirmed', t0 + interval '10 minutes');
  perform pg_temp.event(v_gc, 'submitted', t0 + interval '5 minutes');
  perform pg_temp.check((pg_temp.payment(v_gc)).status = 'confirmed' and pg_temp.position('dan') = 'EARNED' and (pg_temp.obligation('dan')).status = 'PAID'
                        and exists (select 1 from public.finance_audit_log where target_id = (pg_temp.payment(v_gc)).id and action = 'payment_status_transition_ignored'
                                     and new_value ->> 'why' = 'stale'),
    'FL7 an older observation arriving late changes nothing -- still collected, the fee still earned -- and the stale event is recorded');
  perform pg_temp.check((pg_temp.payment(v_gc)).gross_amount_minor = 2050 and (pg_temp.payment(v_gc)).app_fee_minor = 50,
    'FL7b the members-pay month: £20.50 collected, 50p of it Ovalball''s');
end $$;

-- =====================================================================================================
-- FL8-FL10 AFTER COLLECTION
-- =====================================================================================================
do $$
declare v_cat text; v_eve text; v_fin text; t0 timestamptz := clock_timestamp();
begin
  -- Cat: collected, paid out, then fails late.
  v_cat := pg_temp.pay('cat');
  perform pg_temp.event(v_cat, 'submitted', t0 + interval '1 minute');
  perform pg_temp.event(v_cat, 'confirmed', t0 + interval '2 minutes');
  perform pg_temp.event(v_cat, 'paid_out', t0 + interval '3 minutes');
  perform pg_temp.check(pg_temp.position('cat') = 'EARNED', 'FL8 paid out: the fee is earned');
  perform pg_temp.event(v_cat, 'failed', t0 + interval '4 minutes', null, 'late_failure_settled');
  perform pg_temp.check(pg_temp.position('cat') = 'RETURNED' and (pg_temp.obligation('cat')).status = 'FAILED',
    'FL8b a late failure after paying out returns the fee and fails the month');

  -- Eve: collected, charged back, then the bank reverses the chargeback.
  v_eve := pg_temp.pay('eve');
  perform pg_temp.event(v_eve, 'confirmed', t0 + interval '1 minute');
  perform pg_temp.event(v_eve, 'charged_back', t0 + interval '2 minutes', null, 'refund_requested');
  perform pg_temp.check(pg_temp.position('eve') = 'RETURNED' and (pg_temp.obligation('eve')).status = 'CHARGEDBACK',
    'FL9 a chargeback returns the fee');
  perform pg_temp.event(v_eve, 'confirmed', t0 + interval '3 minutes');
  perform pg_temp.check(pg_temp.position('eve') = 'EARNED' and (pg_temp.obligation('eve')).status = 'PAID',
    'FL9b a chargeback the bank reverses is collected after all: the month is paid and the fee earned again');

  -- Fin: cancelled before collection; a later event cannot reopen it.
  v_fin := pg_temp.pay('fin');
  perform pg_temp.event(v_fin, 'cancelled', t0 + interval '1 minute');
  perform pg_temp.event(v_fin, 'confirmed', t0 + interval '2 minutes');
  perform pg_temp.check(pg_temp.position('fin') = 'NONE' and (pg_temp.payment(v_fin)).status = 'cancelled' and (pg_temp.obligation('fin')).status = 'CANCELLED',
    'FL10 a cancelled payment carries no fee and never reopens');
end $$;

-- FL10b: Gil's payment is still on its way when the books below are read.
do $$
declare v_gil text;
begin
  v_gil := pg_temp.pay('gil');
  perform pg_temp.event(v_gil, 'submitted', clock_timestamp() + interval '1 minute');
  perform pg_temp.check(pg_temp.position('gil') = 'PENDING' and (pg_temp.obligation('gil')).status = 'SUBMITTED',
    'FL10b a payment with the bank: the fee is pending, not yet earned');
end $$;

-- =====================================================================================================
-- FL11 NOTHING TO COLLECT
-- =====================================================================================================
do $$
declare o public.membership_obligations := pg_temp.obligation('zed');
begin
  perform pg_temp.check(o.status = 'EXEMPT' and o.amount_due_minor = 0 and o.platform_fee_minor = 0 and o.collect_amount_minor = 0
                        and o.gocardless_payment_id is null and pg_temp.position('zed') = 'NONE',
    'FL11 a fully discounted month is exempt: nothing collected, no payment, no fee');
end $$;

-- =====================================================================================================
-- FL12-FL14 RECONCILIATION ACROSS EVERY MONTH OF THE CLUB
-- =====================================================================================================
do $$
declare v_bad int; v_gross bigint; v_fee bigint; v_net bigint; v_expect_net bigint;
begin
  select count(*) into v_bad from public.membership_obligations o
   where o.club_id = pg_temp.id('club') and o.billing_period = pg_temp.period()
     and (o.collect_amount_minor <> o.amount_due_minor + o.payer_fee_minor
          or o.platform_fee_minor <> internal.ovalball_fee_minor(o.amount_due_minor, o.platform_fee_bps)
          or (o.payer_fee_minor <> 0 and o.payer_fee_minor <> o.platform_fee_minor));
  perform pg_temp.check(v_bad = 0, 'FL12 every month: collect = price + any members'' fee, and the fee is 2.5% of the price, half up (' || v_bad || ' wrong)');

  select count(*) into v_bad from public.gocardless_payments gp join public.membership_obligations o on o.id = gp.obligation_id
   where o.club_id = pg_temp.id('club') and (gp.app_fee_minor * 2 > gp.gross_amount_minor or gp.gross_amount_minor <> o.collect_amount_minor or gp.app_fee_minor <> o.platform_fee_minor);
  perform pg_temp.check(v_bad = 0, 'FL12b every payment asks GoCardless for exactly the month''s amount and fee, and no fee exceeds half a payment');

  -- Gross collected, Ovalball's earned fee and what reaches the club before GoCardless, from the records.
  select coalesce(sum(gp.gross_amount_minor), 0), coalesce(sum(gp.app_fee_minor), 0)
    into v_gross, v_fee
    from public.gocardless_payments gp join public.membership_obligations o on o.id = gp.obligation_id
   where o.club_id = pg_temp.id('club') and gp.status in ('confirmed', 'paid_out');
  v_net := v_gross - v_fee;
  -- Abe £20.00 (club bears), Dan £20.50 (members bear), Eve £20.00 (chargeback reversed): £60.50 gross, £1.50 fee.
  v_expect_net := 2000 - 50 + 2050 - 50 + 2000 - 50;
  perform pg_temp.check(v_gross = 6050 and v_fee = 150 and v_net = v_expect_net,
    'FL13 gross → Ovalball''s fee → the club before GoCardless reconciles: £60.50 collected, £1.50 earned, £59.00 to the club (' || v_gross || '/' || v_fee || '/' || v_net || ')');

  select count(*) into v_bad from public.membership_obligations o
    left join public.gocardless_payments gp on gp.id = o.gocardless_payment_id
   where o.club_id = pg_temp.id('club') and o.billing_period = pg_temp.period()
     and (select fee_position from internal.membership_fee_position(o.id)) = 'EARNED'
     and coalesce(gp.status, '') not in ('confirmed', 'paid_out');
  perform pg_temp.check(v_bad = 0, 'FL14 no phantom revenue: no fee is counted as earned for a month that was not collected');

  select count(*) into v_bad from (
    select gp.obligation_id from public.gocardless_payments gp join public.membership_obligations o on o.id = gp.obligation_id
     where o.club_id = pg_temp.id('club') group by gp.obligation_id having count(*) > 1) x;
  perform pg_temp.check(v_bad = 0, 'FL14b no month holds two payments, whatever was retried or redelivered');
  perform pg_temp.check((select count(*) from internal.membership_fee_position((pg_temp.obligation('pip')).id) where fee_position = 'EXPECTED') = 1,
    'FL14c a month with no payment yet expects its fee and has earned nothing');
end $$;

rollback;
