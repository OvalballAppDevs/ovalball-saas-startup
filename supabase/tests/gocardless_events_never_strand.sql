-- GOCARDLESS EVENTS NEVER STRAND (20270749000000) -- one test per gap the 6 October 2026 webhook audit left open,
-- each with its negative case.
--
--   A. BUDGET     the wait doubles with each attempt (5 minutes, capped at 6 hours); the first and last error are
--                 kept; a spent budget dead-letters the event (on a failure, or by the replay's sweep when the last
--                 attempt never finished) and the replay never claims it again; a GoCardless redelivery still may,
--                 and success clears it; two claims never return the same event (G5, audit test 2)
--   B. DEFERRED   an event whose club has no live connection to its GoCardless account waits, spends no budget,
--                 and is released only by a connection to that same account (G7)
--   C. POISON     a payment's pending_customer_approval and customer_approval_denied, and a billing request's
--                 ready_to_fulfil and fulfilling, are recorded per GoCardless's meanings -- never failed for ever (G4)
--   D. ORDER      subscription, mandate and billing-request statuses are ordered by observation; final states stay
--                 final; a mandate GoCardless reinstates comes back (G9, audit test 9)
--   E. VERIFIED   a failed check never downgrades a known verification status (G8, audit test 10)
--   F. CONNECT    reconnecting reuses the row; the same token handed back is not revoked; another account or
--                 environment is refused while Direct Debits still run through the old one; an organisation two
--                 clubs share is never guessed (G6, G12, audit test 6)
--   G. LATE       a late "app disconnected" never ends a newer connection (G13, audit test 13)
--   H. HEALTH     counts only, and to a Full Site Admin only (G2, audit test 5)
--   I. SCHEDULE   the replay is scheduled, inert without its Vault entries, HTTPS only, and its answers are kept
--                 as counts (G1)
--   J. GRANTS     nobody signed in can run the inbox's doors
--   K. FEE        a payment's own app fee is kept, never changed once recorded
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/gocardless_events_never_strand.sql
--
-- Self-contained and rolled back: every row it writes -- audit and security-event rows included -- goes with the
-- rollback, which the last block checks. No GoCardless call and no HTTP request is ever made (a queued pg_net
-- request is never committed, and its host is .invalid).

\pset pager off

-- What exists before the suite, kept for this session, so the last block can prove it left nothing behind.
do $$
begin
  perform set_config('ns.base_runs', (select count(*) from internal.gocardless_replay_runs)::text, false);
  perform set_config('ns.base_vault', (select count(*) from vault.secrets where name in ('gocardless_replay_url', 'gocardless_replay_secret'))::text, false);
  perform set_config('ns.base_revocations', (select count(*) from internal.gocardless_token_revocations)::text, false);
end $$;

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create temp table ids (k text primary key, v uuid) on commit drop;
create temp table words (k text primary key, v text) on commit drop;
create or replace function pg_temp.put(p_k text, p_v uuid) returns void language sql as $$ insert into ids values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
create or replace function pg_temp.word(p_k text) returns text language sql as $$ select v from words where k = p_k $$;

create or replace function pg_temp.person(p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, '', now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth) values (v, 'Ns', 'Person', p_email, date '1980-02-02')
  on conflict (id) do update set date_of_birth = excluded.date_of_birth;
  return v;
end $$;

-- As somebody, the way the API calls a function: their claims, their role, then back.
create or replace function pg_temp.say_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  if p_subject is null then
    perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  begin execute p_sql; v_state := 'OK'; exception when others then get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_state || coalesce(': ' || v_msg, '');
end $$;
create or replace function pg_temp.val_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- An inbox event about a payment, recorded the way the webhook records it; the payload names its organisation.
create or replace function pg_temp.ev(p_key text, p_org text default null) returns uuid language sql as $$
  select public.record_gocardless_event('EV_NS_' || (select v from words where k = 'tag') || '_' || p_key, 'payments', 'confirmed',
    jsonb_build_object('id', 'EV_NS_' || (select v from words where k = 'tag') || '_' || p_key, 'resource_type', 'payments', 'action', 'confirmed',
                       'links', jsonb_strip_nulls(jsonb_build_object('payment', 'PM_NS_NONE', 'organisation', p_org))))
$$;
-- Whether the replay's claim, called now, takes this event.
create or replace function pg_temp.claims(p_id uuid) returns boolean language sql as $$
  select exists (select 1 from public.claim_stale_gocardless_events(100) c where c.id = p_id)
$$;

-- ---------------------------------------------------------------------------------------------------------
-- The world: three clubs, a family paying club A, the Site Admin profiles, a Club Admin and an outsider.
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_tag text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_dir uuid; v_club uuid; v_key text;
  v_player uuid; v_player2 uuid; v_prog uuid; v_price uuid; v_payer uuid; v_progC uuid; v_priceC uuid; v_payerC uuid;
begin
  insert into words values ('tag', v_tag);
  foreach v_key in array array['a', 'b', 'c'] loop
    insert into public.club_directory (name, rugby_code, country, nation, source, normalized_key, verification_status)
    values ('NS Club ' || upper(v_key) || ' ' || v_tag, 'union', 'England', 'England', 'manual', 'ns-club-' || v_key || '-' || v_tag, 'verified')
    returning id into v_dir;
    insert into public.clubs (directory_id, slug, status) values (v_dir, 'ns-' || v_key || '-' || v_tag, 'active') returning id into v_club;
    perform pg_temp.put('club_' || v_key, v_club);
  end loop;

  perform pg_temp.put('full', pg_temp.person('ns.full.' || v_tag || '@ovalball.test'));
  perform pg_temp.put('support', pg_temp.person('ns.support.' || v_tag || '@ovalball.test'));
  perform pg_temp.put('ops', pg_temp.person('ns.ops.' || v_tag || '@ovalball.test'));
  perform pg_temp.put('ca', pg_temp.person('ns.ca.' || v_tag || '@ovalball.test'));
  perform pg_temp.put('outsider', pg_temp.person('ns.outsider.' || v_tag || '@ovalball.test'));
  perform pg_temp.put('parent', pg_temp.person('ns.parent.' || v_tag || '@ovalball.test'));
  insert into public.site_admins (user_id, profile_key) values (pg_temp.id('full'), 'SITE_FULL'), (pg_temp.id('support'), 'SITE_SUPPORT');
  -- Site Operations with the commercial add-on: holds site.commercial.view, and is still not a Full Site Admin.
  insert into public.site_admins (user_id, profile_key, view_commercial) values (pg_temp.id('ops'), 'SITE_OPS', true);
  insert into public.club_memberships (club_id, user_id, role, status) values (pg_temp.id('club_c'), pg_temp.id('ca'), 'CLUB_ADMIN', 'active');

  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Nia', 'Strand ' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'FEMALE') returning id into v_player;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Ned', 'Strand ' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_player2;
  insert into public.club_subscription_programmes (club_id, enabled, created_by) values (pg_temp.id('club_a'), true, pg_temp.id('parent')) returning id into v_prog;
  insert into public.club_subscription_pricing (programme_id, amount_minor, effective_from, created_by) values (v_prog, 1600, current_date - 120, pg_temp.id('parent')) returning id into v_price;
  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, created_by)
  values (v_player, v_prog, pg_temp.id('parent'), 'guardian', 'active', pg_temp.id('parent')) returning id into v_payer;
  insert into public.club_subscription_programmes (club_id, enabled, created_by) values (pg_temp.id('club_c'), true, pg_temp.id('ca')) returning id into v_progC;
  insert into public.club_subscription_pricing (programme_id, amount_minor, effective_from, created_by) values (v_progC, 2000, current_date - 120, pg_temp.id('ca')) returning id into v_priceC;
  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, created_by)
  values (v_player2, v_progC, pg_temp.id('parent'), 'guardian', 'active', pg_temp.id('parent')) returning id into v_payerC;

  perform pg_temp.put('player', v_player); perform pg_temp.put('prog', v_prog); perform pg_temp.put('price', v_price); perform pg_temp.put('payer', v_payer);
  perform pg_temp.put('player2', v_player2); perform pg_temp.put('prog_c', v_progC); perform pg_temp.put('price_c', v_priceC); perform pg_temp.put('payer_c', v_payerC);

  insert into public.gocardless_billing_requests (club_id, payer_subscription_id, gc_billing_request_id, gc_billing_request_flow_id, status, created_by)
  values (pg_temp.id('club_a'), v_payer, 'BRQ_NS_' || v_tag, 'BRF_NS_' || v_tag, 'pending', pg_temp.id('parent')) returning id into v_dir;
  perform pg_temp.put('br', v_dir);
  insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id) values (pg_temp.id('club_a'), pg_temp.id('parent'), 'CU_NS_A_' || v_tag) returning id into v_dir;
  perform pg_temp.put('customer_a', v_dir);
  insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id) values (pg_temp.id('club_c'), pg_temp.id('parent'), 'CU_NS_C_' || v_tag) returning id into v_dir;
  perform pg_temp.put('customer_c', v_dir);
end $$;

-- =========================================================================================================
-- A. BUDGET
-- =========================================================================================================
do $$
declare v_id uuid; v_id2 uuid; e public.gocardless_events; v_a boolean; v_b boolean; v_first uuid[]; v_second uuid[]; v_mine uuid[];
begin
  v_id := pg_temp.ev('A1');
  perform public.mark_gocardless_event_processed(v_id, 'GoCardless answered 503');
  update public.gocardless_events set last_attempt_at = now() - interval '4 minutes' where id = v_id;
  v_a := not pg_temp.claims(v_id);
  update public.gocardless_events set last_attempt_at = now() - interval '6 minutes' where id = v_id;
  v_b := pg_temp.claims(v_id);
  perform pg_temp.check(v_a and v_b and (select attempts from public.gocardless_events where id = v_id) = 2,
    'NS1 a first failure is taken again after five minutes idle, and not before');

  update public.gocardless_events set attempts = 3, claimed_until = null, last_attempt_at = now() - interval '15 minutes' where id = v_id;
  v_a := not pg_temp.claims(v_id);
  update public.gocardless_events set claimed_until = null, last_attempt_at = now() - interval '25 minutes' where id = v_id;
  v_b := pg_temp.claims(v_id);
  perform pg_temp.check(v_a and v_b, 'NS2 the wait doubles with each attempt: after three attempts it is twenty minutes, not five');

  update public.gocardless_events set attempts = 12, claimed_until = null, last_attempt_at = now() - interval '5 hours 50 minutes' where id = v_id;
  v_a := not pg_temp.claims(v_id);
  update public.gocardless_events set claimed_until = null, last_attempt_at = now() - interval '6 hours 10 minutes' where id = v_id;
  v_b := pg_temp.claims(v_id);
  perform pg_temp.check(v_a and v_b, 'NS3 and the wait is capped at six hours');

  perform public.mark_gocardless_event_processed(v_id, 'GoCardless answered 500');
  select * into e from public.gocardless_events where id = v_id;
  perform pg_temp.check(e.first_error = 'GoCardless answered 503' and e.processing_error = 'GoCardless answered 500' and e.failure_count = 2
      and e.first_failed_at is not null and e.last_failed_at is not null and not e.processed and e.dead_lettered_at is null,
    'NS4 the first error and the last are both kept, with how many failures there have been');

  update public.gocardless_events set attempts = internal.gocardless_event_attempt_ceiling() where id = v_id;
  perform public.mark_gocardless_event_processed(v_id, 'still failing');
  update public.gocardless_events set last_attempt_at = now() - interval '3 days' where id = v_id;
  select * into e from public.gocardless_events where id = v_id;
  perform pg_temp.check(e.dead_lettered_at is not null and e.dead_letter_reason = 'Gave up after 20 attempts. Last error: still failing'
      and not e.processed and e.payload ? 'links' and not pg_temp.claims(v_id),
    'NS5 a failure that spends the budget dead-letters the event, whole and with its reason, and the replay never claims it again');

  v_id2 := pg_temp.ev('A2');
  update public.gocardless_events set attempts = internal.gocardless_event_attempt_ceiling(), claimed_until = now() - interval '1 minute' where id = v_id2;
  v_a := not pg_temp.claims(v_id2);
  perform pg_temp.check(v_a
      and (select dead_letter_reason from public.gocardless_events where id = v_id2) = 'Gave up after 20 attempts. Last error: none recorded -- the last attempt never finished.',
    'NS6 an exhausted event whose last attempt never finished is dead-lettered by the replay''s own sweep, not left stranded');

  perform pg_temp.check(public.record_gocardless_event('EV_NS_' || pg_temp.word('tag') || '_A1', 'payments', 'confirmed', '{}'::jsonb) = v_id,
    'NS7 a GoCardless redelivery (or a manual retry from its dashboard) can still take a dead-lettered event');
  perform public.mark_gocardless_event_processed(v_id, null);
  select * into e from public.gocardless_events where id = v_id;
  perform pg_temp.check(e.processed and e.dead_lettered_at is null and e.dead_letter_reason is null and e.processing_error is null
      and e.first_error = 'GoCardless answered 503',
    'NS8 and its success clears the dead letter, while the history of what went wrong stays');

  perform public.mark_gocardless_event_processed(v_id, 'a late duplicate failed');
  perform pg_temp.check((select processed and processing_error is null from public.gocardless_events where id = v_id),
    'NS9 a failure reported after another delivery processed the event does not un-process it');

  -- Three failing events, older than anything else in the inbox, so a claim of two takes two of them first.
  v_mine := array[pg_temp.ev('A3'), pg_temp.ev('A4'), pg_temp.ev('A5')];
  update public.gocardless_events
     set claimed_until = null, last_attempt_at = now() - interval '1 hour', processing_error = 'x'
   where id = any(v_mine);
  update public.gocardless_events set created_at = timestamptz '2001-01-01 00:00' where id = v_mine[1];
  update public.gocardless_events set created_at = timestamptz '2001-01-01 00:01' where id = v_mine[2];
  update public.gocardless_events set created_at = timestamptz '2001-01-01 00:02' where id = v_mine[3];
  v_first := array(select c.id from public.claim_stale_gocardless_events(2) c);
  v_second := array(select c.id from public.claim_stale_gocardless_events(2) c);
  perform pg_temp.check(not (v_first && v_second) and v_first @> array[v_mine[1], v_mine[2]] and v_mine[3] = any(v_second)
      and pg_get_functiondef('public.claim_stale_gocardless_events(integer, integer)'::regprocedure) ~* 'for update skip locked',
    'NS10 two claims never return the same event: a claimed one is held, and the claim skips rows another replay has locked');

  delete from public.gocardless_events where gc_event_id like 'EV_NS_' || pg_temp.word('tag') || '_%';
end $$;

-- =========================================================================================================
-- B. DEFERRED
-- =========================================================================================================
do $$
declare v_tag text := pg_temp.word('tag'); v_org text := 'OR_NS_A_' || pg_temp.word('tag'); v_id uuid; v_id2 uuid; v_id3 uuid; v_done uuid;
        e public.gocardless_events;
begin
  v_id := pg_temp.ev('B1', v_org);
  perform public.defer_gocardless_event(v_id, pg_temp.id('club_a'), 'The club is not connected to GoCardless. This event waits until it reconnects.');
  update public.gocardless_events set deferred_at = now() - interval '2 days', last_attempt_at = now() - interval '2 days' where id = v_id;
  select * into e from public.gocardless_events where id = v_id;
  perform pg_temp.check(e.deferred_at is not null and e.deferred_reason like 'The club is not connected to GoCardless.%' and e.club_id = pg_temp.id('club_a')
      and not e.processed and e.failure_count = 0 and e.claimed_until is null and not pg_temp.claims(v_id),
    'ND1 an event for a club with no live connection waits, deferred with its reason and its club, and is not taken while nothing has changed');

  insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, connected_by)
  values (pg_temp.id('club_a'), 'sandbox', 'OR_NS_OTHER_' || v_tag, 'tok_ns_other_' || v_tag, 'read_write', pg_temp.id('parent'));
  perform pg_temp.check(not pg_temp.claims(v_id),
    'ND2 a connection to a DIFFERENT GoCardless account does not release an event that belongs to the old one');

  update public.gocardless_merchant_connections set gc_organisation_id = v_org where club_id = pg_temp.id('club_a');
  perform pg_temp.check(pg_temp.claims(v_id),
    'ND3 once the club is connected to the event''s own GoCardless account again, the replay takes it');

  v_id2 := pg_temp.ev('B2', v_org);
  perform public.defer_gocardless_event(v_id2, pg_temp.id('club_a'), 'waiting');
  update public.gocardless_events set attempts = internal.gocardless_event_attempt_ceiling(), deferred_at = now() - interval '1 hour' where id = v_id2;
  perform pg_temp.check(pg_temp.claims(v_id2),
    'ND4 waiting spends no budget: a released event is taken even when its attempts are at the ceiling');
  perform public.mark_gocardless_event_processed(v_id2, 'GoCardless answered 404');
  select * into e from public.gocardless_events where id = v_id2;
  perform pg_temp.check(e.dead_lettered_at is not null and e.deferred_at is null and e.processing_error = 'GoCardless answered 404',
    'ND5 but when that released attempt fails, the budget applies: no longer waiting, and dead-lettered');

  v_id3 := pg_temp.ev('B3', 'OR_NS_B_' || v_tag);
  perform public.defer_gocardless_event(v_id3, pg_temp.id('club_b'), 'waiting');
  update public.gocardless_events set attempts = 30, deferred_at = now() - interval '9 days', claimed_until = null where id = v_id3;
  perform pg_temp.check(not pg_temp.claims(v_id3) and (select dead_lettered_at is null and deferred_at is not null from public.gocardless_events where id = v_id3),
    'ND6 a waiting event is never dead-lettered by the replay''s sweep, however long it waits: it is not failing');

  v_done := pg_temp.ev('B4', v_org);
  perform public.mark_gocardless_event_processed(v_done, null);
  perform public.defer_gocardless_event(v_done, pg_temp.id('club_a'), 'too late');
  perform pg_temp.check((select processed and deferred_at is null from public.gocardless_events where id = v_done),
    'ND7 an event already processed is never deferred');

  delete from public.gocardless_events where gc_event_id like 'EV_NS_' || v_tag || '_%';
  delete from public.gocardless_merchant_connections where club_id = pg_temp.id('club_a');
end $$;

-- =========================================================================================================
-- C. POISON
-- =========================================================================================================
do $$
declare v_tag text := pg_temp.word('tag'); v_t0 timestamptz := now() - interval '10 days'; v_obl uuid; v_obl2 uuid; v_obl3 uuid;
        p public.gocardless_payments; o text; v_month date := date_trunc('month', current_date)::date;
begin
  insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, due_date, status)
  values (pg_temp.id('prog'), pg_temp.id('club_a'), pg_temp.id('player'), pg_temp.id('payer'), pg_temp.id('price'), (v_month - interval '3 months')::date, 1600, current_date - 80, 'SUBMITTED')
  returning id into v_obl;
  insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, due_date, status)
  values (pg_temp.id('prog'), pg_temp.id('club_a'), pg_temp.id('player'), pg_temp.id('payer'), pg_temp.id('price'), (v_month - interval '2 months')::date, 1600, current_date - 50, 'SUBMITTED')
  returning id into v_obl2;
  insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, due_date, status)
  values (pg_temp.id('prog'), pg_temp.id('club_a'), pg_temp.id('player'), pg_temp.id('payer'), pg_temp.id('price'), (v_month - interval '1 month')::date, 1600, current_date - 20, 'SUBMITTED')
  returning id into v_obl3;
  insert into public.gocardless_payments (club_id, obligation_id, gc_payment_id, gross_amount_minor, status, status_observed_at) values
    (pg_temp.id('club_a'), v_obl, 'PM_NS_PCA_' || v_tag, 1600, 'pending_submission', v_t0),
    (pg_temp.id('club_a'), v_obl2, 'PM_NS_DEN_' || v_tag, 1600, 'pending_customer_approval', v_t0),
    (pg_temp.id('club_a'), v_obl3, 'PM_NS_RSN_' || v_tag, 1600, 'submitted', v_t0);

  perform public.apply_payment_status_transition('PM_NS_PCA_' || v_tag, 'pending_customer_approval', null, null, 'EV_NS_P1', v_t0 + interval '1 hour');
  select status into o from public.membership_obligations where id = v_obl;
  perform pg_temp.check((select status from public.gocardless_payments where gc_payment_id = 'PM_NS_PCA_' || v_tag) = 'pending_customer_approval' and o = 'SUBMITTED',
    'NP1 a payment waiting for the customer''s approval is recorded as such, and its month is left as it was (' || o || ')');

  perform public.apply_payment_status_transition('PM_NS_DEN_' || v_tag, 'customer_approval_denied', null, null, 'EV_NS_P2', v_t0 + interval '1 hour');
  select status into o from public.membership_obligations where id = v_obl2;
  perform pg_temp.check((select status from public.gocardless_payments where gc_payment_id = 'PM_NS_DEN_' || v_tag) = 'customer_approval_denied' and o = 'CANCELLED',
    'NP2 a payment the customer declined is recorded, and its month is settled as cancelled -- it will not be collected (' || o || ')');
  perform public.apply_payment_status_transition('PM_NS_DEN_' || v_tag, 'confirmed', null, null, 'EV_NS_P3', v_t0 + interval '2 days');
  perform pg_temp.check((select status from public.gocardless_payments where gc_payment_id = 'PM_NS_DEN_' || v_tag) = 'customer_approval_denied'
      and (select status from public.membership_obligations where id = v_obl2) = 'CANCELLED'
      and exists (select 1 from public.finance_audit_log where action = 'payment_status_transition_ignored' and new_value ->> 'gc_event_id' = 'EV_NS_P3' and new_value ->> 'why' = 'terminal'),
    'NP3 and a declined payment is final: a later observation never reopens it, and the ignored one is on the record');

  perform public.apply_payment_status_transition('PM_NS_RSN_' || v_tag, 'failed', 'insufficient_funds', null, 'EV_NS_P4', v_t0 + interval '1 hour');
  perform public.apply_payment_status_transition('PM_NS_RSN_' || v_tag, 'pending_submission', 'refer_to_payer', null, 'EV_NS_P5', v_t0 + interval '2 hours');
  select * into p from public.gocardless_payments where gc_payment_id = 'PM_NS_RSN_' || v_tag;
  perform pg_temp.check(p.status = 'pending_submission' and p.failure_reason_code = 'insufficient_funds',
    'NP4 an event''s failure reason is never carried onto a status it cannot describe (a retry keeps the real failure''s reason)');
  perform public.apply_payment_status_transition('PM_NS_RSN_' || v_tag, 'failed', 'refer_to_payer', null, 'EV_NS_P6', v_t0 + interval '3 hours');
  perform pg_temp.check((select failure_reason_code from public.gocardless_payments where gc_payment_id = 'PM_NS_RSN_' || v_tag) = 'refer_to_payer',
    'NP5 while a genuinely later failure does record its own reason');

  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), 'ready_to_fulfil', null, null, null, null, null, v_t0 + interval '1 hour');
  o := (select status from public.gocardless_billing_requests where id = pg_temp.id('br'));
  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), 'fulfilling', null, null, null, null, null, v_t0 + interval '2 hours');
  perform pg_temp.check(o = 'ready_to_fulfil' and (select status from public.gocardless_billing_requests where id = pg_temp.id('br')) = 'fulfilling',
    'NP6 a billing request that is ready to fulfil, then fulfilling, is recorded as GoCardless says -- these failed for ever before');
  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), null, null, null, null, null, null, v_t0 + interval '3 hours');
  perform pg_temp.check((select status from public.gocardless_billing_requests where id = pg_temp.id('br')) = 'fulfilling',
    'NP7 a status GoCardless has not documented arrives as nothing, and writes nothing');
  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), 'fulfilled', null, null, null, null, null, v_t0 + interval '4 hours');
  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), 'pending', null, null, null, null, null, v_t0 + interval '5 hours');
  perform pg_temp.check((select status from public.gocardless_billing_requests where id = pg_temp.id('br')) = 'fulfilled',
    'NP8 a fulfilled billing request is final');
end $$;

-- =========================================================================================================
-- D. ORDER
-- =========================================================================================================
do $$
declare v_tag text := pg_temp.word('tag'); v_t0 timestamptz := now() - interval '10 days'; v_md uuid; v_md2 uuid; v_md3 uuid; v_sub uuid; s text;
begin
  insert into public.gocardless_mandates (club_id, gocardless_customer_id, billing_request_id, gc_mandate_id, status, scheme, next_possible_charge_date, status_observed_at)
  values (pg_temp.id('club_a'), pg_temp.id('customer_a'), pg_temp.id('br'), 'MD_NS_1_' || v_tag, 'active', 'bacs', current_date + 3, v_t0) returning id into v_md;
  insert into public.gocardless_mandates (club_id, gocardless_customer_id, billing_request_id, gc_mandate_id, status, scheme, status_observed_at)
  values (pg_temp.id('club_a'), pg_temp.id('customer_a'), pg_temp.id('br'), 'MD_NS_2_' || v_tag, 'failed', 'bacs', v_t0) returning id into v_md2;
  insert into public.gocardless_mandates (club_id, gocardless_customer_id, billing_request_id, gc_mandate_id, status, scheme, status_observed_at)
  values (pg_temp.id('club_a'), pg_temp.id('customer_a'), pg_temp.id('br'), 'MD_NS_3_' || v_tag, 'expired', 'bacs', v_t0) returning id into v_md3;
  insert into public.gocardless_subscriptions (club_id, payer_subscription_id, gocardless_mandate_id, pricing_id, gc_subscription_id, amount_minor, status, status_observed_at)
  values (pg_temp.id('club_a'), pg_temp.id('payer'), v_md, pg_temp.id('price'), 'SB_NS_1_' || v_tag, 1600, 'active', v_t0) returning id into v_sub;

  perform public.reconcile_gocardless_subscription(v_sub, 'paused', 'EV_NS_O1', 'webhook', null, v_t0 + interval '2 hours');
  perform public.reconcile_gocardless_subscription(v_sub, 'active', 'EV_NS_O2', 'webhook', null, v_t0 + interval '1 hour');
  s := (select status from public.gocardless_subscriptions where id = v_sub);
  perform pg_temp.check(s = 'paused'
      and exists (select 1 from public.finance_audit_log where action = 'subscription_status_transition_ignored' and target_id = v_sub and new_value ->> 'why' = 'stale'),
    'NO1 a subscription observation older than the recorded one changes nothing, and the ignored one is on the record (' || s || ')');
  perform public.reconcile_gocardless_subscription(v_sub, 'active', 'EV_NS_O3', 'webhook', null, v_t0 + interval '3 hours');
  perform pg_temp.check((select status from public.gocardless_subscriptions where id = v_sub) = 'active',
    'NO2 while a newer one moves it on: a paused subscription GoCardless resumed is active');
  perform public.reconcile_gocardless_subscription(v_sub, 'cancelled', 'EV_NS_O4', 'webhook', null, v_t0 + interval '4 hours');
  perform public.reconcile_gocardless_subscription(v_sub, 'active', 'EV_NS_O5', 'webhook', null, v_t0 + interval '5 hours');
  perform pg_temp.check((select status from public.gocardless_subscriptions where id = v_sub) = 'cancelled'
      and exists (select 1 from public.finance_audit_log where action = 'subscription_status_transition_ignored' and target_id = v_sub and new_value ->> 'why' = 'terminal'),
    'NO3 a stale "active" never reopens a cancelled subscription -- however late it arrives');

  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), null, 'CU_NS_A_' || v_tag, 'MD_NS_1_' || v_tag, 'cancelled', 'bacs', null, v_t0 + interval '1 hour', v_t0 + interval '1 hour');
  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), null, 'CU_NS_A_' || v_tag, 'MD_NS_1_' || v_tag, 'active', 'bacs', null, v_t0 + interval '30 minutes', v_t0 + interval '30 minutes');
  s := (select status from public.gocardless_mandates where id = v_md);
  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), null, 'CU_NS_A_' || v_tag, 'MD_NS_1_' || v_tag, 'active', 'bacs', null, v_t0 + interval '2 hours', v_t0 + interval '2 hours');
  perform pg_temp.check(s = 'cancelled' and (select status from public.gocardless_mandates where id = v_md) = 'active',
    'NO4 a stale "active" never reopens a cancelled mandate; a newer one does -- GoCardless reinstates cancelled mandates (' || s || ')');

  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), null, 'CU_NS_A_' || v_tag, 'MD_NS_2_' || v_tag, 'active', 'bacs', null, v_t0 + interval '1 day', v_t0 + interval '1 day');
  perform pg_temp.check((select status from public.gocardless_mandates where id = v_md2) = 'failed',
    'NO5 a failed mandate is final: GoCardless reinstates only a cancelled or expired one');

  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), null, 'CU_NS_A_' || v_tag, 'MD_NS_3_' || v_tag, 'pending_submission', 'bacs', null, v_t0 + interval '1 hour', v_t0 + interval '1 hour');
  s := (select status from public.gocardless_mandates where id = v_md3);
  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), null, 'CU_NS_A_' || v_tag, 'MD_NS_3_' || v_tag, 'submitted', 'bacs', null, v_t0 + interval '2 hours', v_t0 + interval '2 hours');
  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), null, 'CU_NS_A_' || v_tag, 'MD_NS_3_' || v_tag, 'active', 'bacs', current_date + 9, v_t0 + interval '3 hours', v_t0 + interval '3 hours');
  perform pg_temp.check(s = 'pending_submission' and (select status from public.gocardless_mandates where id = v_md3) = 'active',
    'NO6 an expired mandate resubmitted for reinstatement moves through submission to active again');

  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), null, 'CU_NS_A_' || v_tag, 'MD_NS_3_' || v_tag, 'active', 'bacs', current_date + 2, v_t0 + interval '150 minutes', v_t0 + interval '150 minutes');
  perform pg_temp.check((select next_possible_charge_date from public.gocardless_mandates where id = v_md3) = current_date + 9,
    'NO7 a stale mandate observation does not move its next possible charge date either');

  update public.gocardless_mandates set status = 'blocked', status_observed_at = v_t0 where id = v_md2;
  perform public.reconcile_gocardless_billing_request(pg_temp.id('br'), null, 'CU_NS_A_' || v_tag, 'MD_NS_2_' || v_tag, 'active', 'bacs', null, v_t0 + interval '2 days', v_t0 + interval '2 days');
  perform pg_temp.check((select status from public.gocardless_mandates where id = v_md2) = 'blocked',
    'NO8 and a blocked mandate is final ("cannot be unblocked")');
end $$;

-- =========================================================================================================
-- E. VERIFIED
-- =========================================================================================================
do $$
declare v_tag text := pg_temp.word('tag'); v_checked timestamptz := now() - interval '1 day'; v text;
begin
  insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, connected_by, verification_status, status_checked_at)
  values (pg_temp.id('club_b'), 'sandbox', 'OR_NS_B_' || v_tag, 'tok_ns_b_' || v_tag, 'read_write', pg_temp.id('parent'), 'successful', v_checked);
  perform public.update_gocardless_verification_status(pg_temp.id('club_b'), 'unknown');
  perform pg_temp.check((select verification_status = 'successful' and status_checked_at = v_checked from public.gocardless_merchant_connections where club_id = pg_temp.id('club_b')),
    'NV1 a check that failed (unknown) never downgrades a status GoCardless gave -- enrolment is not blocked by an outage');
  perform public.update_gocardless_verification_status(pg_temp.id('club_b'), 'in_review');
  perform pg_temp.check((select verification_status = 'in_review' and status_checked_at = now() from public.gocardless_merchant_connections where club_id = pg_temp.id('club_b')),
    'NV2 while a status GoCardless did give replaces it, with the time it was read');
  begin
    perform public.update_gocardless_verification_status(pg_temp.id('club_b'), 'verified');
    v := 'OK';
  exception when others then v := 'refused';
  end;
  perform pg_temp.check(v = 'refused', 'NV3 a value that is not a verification status is refused');
end $$;

-- =========================================================================================================
-- F. CONNECT
-- =========================================================================================================
do $$
declare v_tag text := pg_temp.word('tag'); v_tok1 text := 'tok_ns_c1_' || pg_temp.word('tag'); v_tok2 text := 'tok_ns_c2_' || pg_temp.word('tag');
        v_tok3 text := 'tok_ns_c3_' || pg_temp.word('tag'); v text; v_conn uuid; v_md uuid; v_sub uuid;
        v_store text := 'select public.store_gocardless_connection(%L, %L, %L, %L, %L)';
begin
  v := pg_temp.say_as(pg_temp.id('ca'), format(v_store, pg_temp.id('club_c'), 'sandbox', 'OR_NS_C1_' || v_tag, v_tok1, 'read_write'));
  select id into v_conn from public.gocardless_merchant_connections where club_id = pg_temp.id('club_c');
  v := v || ' / ' || pg_temp.say_as(pg_temp.id('ca'), format('select public.disconnect_gocardless(%L, %L)', pg_temp.id('club_c'), 'Changing bank'));
  v := v || ' / ' || pg_temp.say_as(pg_temp.id('ca'), format(v_store, pg_temp.id('club_c'), 'sandbox', 'OR_NS_C1_' || v_tag, v_tok2, 'read_write'));
  perform pg_temp.check(v = 'OK / OK / OK' and (select id from public.gocardless_merchant_connections where club_id = pg_temp.id('club_c')) = v_conn
      and (select count(*) from internal.gocardless_token_revocations where club_id = pg_temp.id('club_c')) = 1
      and exists (select 1 from internal.gocardless_token_revocations where access_token = v_tok1),
    'NC1 reconnecting after a disconnect reuses the club''s one connection, and queues nothing more: the old token was already queued (' || v || ')');

  v := pg_temp.say_as(pg_temp.id('ca'), format('select public.disconnect_gocardless(%L, %L)', pg_temp.id('club_c'), 'Changing bank again'));
  v := v || ' / ' || pg_temp.say_as(pg_temp.id('ca'), format(v_store, pg_temp.id('club_c'), 'sandbox', 'OR_NS_C1_' || v_tag, v_tok2, 'read_write'));
  perform pg_temp.check(v = 'OK / OK' and not exists (select 1 from internal.gocardless_token_revocations where access_token = v_tok2)
      and (select access_token from public.gocardless_merchant_connections where id = v_conn) = v_tok2,
    'NC2 the same token handed back is live again: its queued revocation is withdrawn, so the drain cannot revoke the connection (' || v || ')');

  insert into public.gocardless_mandates (club_id, gocardless_customer_id, gc_mandate_id, status, scheme)
  values (pg_temp.id('club_c'), pg_temp.id('customer_c'), 'MD_NS_C_' || v_tag, 'active', 'bacs') returning id into v_md;
  v := pg_temp.say_as(pg_temp.id('ca'), format(v_store, pg_temp.id('club_c'), 'sandbox', 'OR_NS_C2_' || v_tag, v_tok3, 'read_write'));
  perform pg_temp.check(v like '55000: This club still has Direct Debits running through the GoCardless account it was connected to before.%'
      and (select gc_organisation_id = 'OR_NS_C1_' || v_tag and access_token = v_tok2 from public.gocardless_merchant_connections where id = v_conn)
      and not exists (select 1 from internal.gocardless_token_revocations where access_token in (v_tok2, v_tok3)),
    'NC3 switching to a different GoCardless account while a mandate is live there is refused, in words, and changes nothing (' || v || ')');

  v := pg_temp.say_as(pg_temp.id('ca'), format(v_store, pg_temp.id('club_c'), 'production', 'OR_NS_C1_' || v_tag, v_tok3, 'read_write'));
  perform pg_temp.check(v like '55000:%', 'NC4 and so is switching environment (' || v || ')');

  update public.gocardless_mandates set status = 'cancelled' where id = v_md;
  insert into public.gocardless_subscriptions (club_id, payer_subscription_id, gocardless_mandate_id, pricing_id, gc_subscription_id, amount_minor, status)
  values (pg_temp.id('club_c'), pg_temp.id('payer_c'), v_md, pg_temp.id('price_c'), 'SB_NS_C_' || v_tag, 2000, 'paused') returning id into v_sub;
  v := pg_temp.say_as(pg_temp.id('ca'), format(v_store, pg_temp.id('club_c'), 'sandbox', 'OR_NS_C2_' || v_tag, v_tok3, 'read_write'));
  perform pg_temp.check(v like '55000:%', 'NC5 a paused subscription still counts as running there (' || v || ')');

  update public.gocardless_subscriptions set status = 'cancelled' where id = v_sub;
  v := pg_temp.say_as(pg_temp.id('ca'), format(v_store, pg_temp.id('club_c'), 'sandbox', 'OR_NS_C2_' || v_tag, v_tok3, 'read_write'));
  perform pg_temp.check(v = 'OK' and (select gc_organisation_id from public.gocardless_merchant_connections where id = v_conn) = 'OR_NS_C2_' || v_tag
      and exists (select 1 from internal.gocardless_token_revocations where access_token = v_tok2)
      and exists (select 1 from public.gocardless_mandates where id = v_md and club_id = pg_temp.id('club_c'))
      and exists (select 1 from public.gocardless_subscriptions where id = v_sub and club_id = pg_temp.id('club_c')),
    'NC6 once nothing is live there, switching is allowed -- the replaced token is queued, and the old records are kept (' || v || ')');

  v := pg_temp.say_as(pg_temp.id('outsider'), format(v_store, pg_temp.id('club_c'), 'sandbox', 'OR_NS_X_' || v_tag, 'tok_ns_x_' || v_tag, 'read_write'));
  perform pg_temp.check(v like '42501%' and (select gc_organisation_id from public.gocardless_merchant_connections where id = v_conn) = 'OR_NS_C2_' || v_tag,
    'NC7 somebody without the club''s authority cannot connect it at all (' || v || ')');

  -- Club A takes club B's organisation too: two clubs, one GoCardless account.
  insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, connected_by)
  values (pg_temp.id('club_a'), 'sandbox', 'OR_NS_B_' || v_tag, 'tok_ns_a_' || v_tag, 'read_write', pg_temp.id('parent'));
  v_md := pg_temp.ev('F1', 'OR_NS_B_' || v_tag);
  v_sub := pg_temp.ev('F2', 'OR_NS_C2_' || v_tag);
  perform pg_temp.check(v_md is not null and (select club_id from public.gocardless_events where id = v_md) is null
      and (select club_id from public.gocardless_events where id = v_sub) = pg_temp.id('club_c'),
    'NC8 an event is tied to its club where its organisation resolves to exactly one, and never guessed where two clubs share it');

  delete from public.gocardless_events where gc_event_id like 'EV_NS_' || v_tag || '_%';
  delete from public.gocardless_merchant_connections where club_id = pg_temp.id('club_a');
end $$;

-- =========================================================================================================
-- G. LATE
-- =========================================================================================================
do $$
declare v_tag text := pg_temp.word('tag'); v_n integer; v_n2 integer; v_n3 integer;
begin
  update public.gocardless_merchant_connections set connected_at = now() - interval '1 hour' where club_id = pg_temp.id('club_c');
  v_n := public.record_gocardless_app_disconnected('OR_NS_C2_' || v_tag, now() - interval '2 hours');
  perform pg_temp.check(v_n = 0 and (select disconnected_at is null and access_token is not null from public.gocardless_merchant_connections where club_id = pg_temp.id('club_c')),
    'NL1 an "app disconnected" GoCardless recorded before the club''s current connection was made does not end it');
  v_n2 := public.record_gocardless_app_disconnected('OR_NS_C2_' || v_tag, now() - interval '30 minutes');
  perform pg_temp.check(v_n2 = 1 and (select disconnected_at is not null and access_token is null from public.gocardless_merchant_connections where club_id = pg_temp.id('club_c')),
    'NL2 one recorded after it does: the connection ends and its dead token is dropped');
  update public.gocardless_merchant_connections set disconnected_at = null, access_token = 'tok_ns_c4_' || v_tag where club_id = pg_temp.id('club_c');
  v_n3 := public.record_gocardless_app_disconnected('OR_NS_C2_' || v_tag);
  perform pg_temp.check(v_n3 = 1, 'NL3 and with no time given, it ends the live connection as before');
end $$;

-- =========================================================================================================
-- H. HEALTH
-- =========================================================================================================
do $$
declare v_tag text := pg_temp.word('tag'); v_before jsonb; v_after jsonb; v_stranded uuid; v_deferred uuid; v_dead uuid;
        v_fn text := 'select row_to_json(h)::text from public.gocardless_inbox_health() h';
begin
  v_before := pg_temp.val_as(pg_temp.id('full'), v_fn)::jsonb;

  v_stranded := pg_temp.ev('H1');
  perform public.mark_gocardless_event_processed(v_stranded, 'GoCardless answered 503');
  update public.gocardless_events set created_at = now() - interval '400 days', last_attempt_at = now() - interval '2 hours' where id = v_stranded;
  v_deferred := pg_temp.ev('H2');
  perform public.defer_gocardless_event(v_deferred, pg_temp.id('club_b'), 'waiting');
  v_dead := pg_temp.ev('H3');
  update public.gocardless_events set attempts = internal.gocardless_event_attempt_ceiling() where id = v_dead;
  perform public.mark_gocardless_event_processed(v_dead, 'given up');
  insert into internal.gocardless_token_revocations (club_id, environment, gc_organisation_id, access_token, reason, requested_at, attempts)
  values (pg_temp.id('club_b'), 'sandbox', 'OR_NS_B_' || v_tag, 'tok_ns_h_' || v_tag, 'disconnected', now() - interval '500 days', 7);

  v_after := pg_temp.val_as(pg_temp.id('full'), v_fn)::jsonb;
  perform pg_temp.check((v_after ->> 'unprocessed')::int = (v_before ->> 'unprocessed')::int + 3
      and (v_after ->> 'stranded')::int = (v_before ->> 'stranded')::int + 1
      and (v_after ->> 'deferred')::int = (v_before ->> 'deferred')::int + 1
      and (v_after ->> 'dead_lettered')::int = (v_before ->> 'dead_lettered')::int + 1
      and (v_after ->> 'oldest_unprocessed_seconds')::int >= 400 * 86400
      and (v_after ->> 'revocations_queued')::int = (v_before ->> 'revocations_queued')::int + 1
      and (v_after ->> 'oldest_revocation_seconds')::int >= 500 * 86400
      and (v_after ->> 'max_revocation_attempts')::int >= 7,
    'NH1 a Full Site Admin reads the inbox''s health as counts: stranded, deferred, dead-lettered, the oldest, and the revocation queue');
  perform pg_temp.check((v_after ->> 'replay_scheduled')::boolean = exists (select 1 from pg_extension where extname = 'pg_cron')
      and v_after ? 'replay_configured' and v_after ? 'last_replay_outcome'
      and v_after::text !~* 'tok_ns|EV_NS|PM_NS|GoCardless answered|given up|payload',
    'NH2 and nothing else: the schedule''s state, never an event''s payload, error text or a token');
  perform pg_temp.check(pg_get_function_result('public.gocardless_inbox_health()'::regprocedure) !~* 'payload|token|error|reason|secret|url',
    'NH3 the function cannot return a payload, a token, an error or a secret: none is among its columns');

  perform pg_temp.check(pg_temp.say_as(pg_temp.id('support'), v_fn) like '42501%'
      and pg_temp.say_as(pg_temp.id('ops'), v_fn) like '42501%'
      and pg_temp.say_as(pg_temp.id('ca'), v_fn) like '42501%'
      and pg_temp.say_as(pg_temp.id('outsider'), v_fn) like '42501%'
      and pg_temp.say_as(null, v_fn) like '42501%',
    'NH4 everybody else is refused: User Support, Site Operations holding the commercial add-on, a Club Admin, a member, and anyone signed out');

  delete from public.gocardless_events where gc_event_id like 'EV_NS_' || v_tag || '_%';
  delete from internal.gocardless_token_revocations where access_token = 'tok_ns_h_' || v_tag;
end $$;

-- =========================================================================================================
-- I. SCHEDULE
-- =========================================================================================================
do $$
declare v_queue bigint; v_runs bigint; v_request bigint; v_secret text := 'ns-secret-' || pg_temp.word('tag'); q record; r record; v_neg bigint := -1 * (1000000 + floor(random() * 1000000)::bigint);
begin
  -- pg_cron exists only in the cron database (pg_cron_portability): there the jobs must really be scheduled;
  -- anywhere else nothing may pretend they are.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform pg_temp.check(exists (select 1 from cron.job where jobname = 'gocardless-webhook-replay' and schedule = '*/10 * * * *' and active
                                     and command = 'select internal.request_gocardless_replay()')
        and exists (select 1 from cron.job where jobname = 'collect-gocardless-replay-responses' and schedule = '5-59/10 * * * *' and active
                       and command = 'select internal.collect_gocardless_replay_responses()'),
      'NR1 the replay runs every ten minutes and its answers are collected five minutes later; neither command carries a secret or an address');
  else
    perform pg_temp.check(not exists (select 1 from pg_namespace where nspname = 'cron'),
      'NR1 pg_cron is not installed in this database, so nothing is scheduled here and nothing pretends it is');
  end if;

  delete from vault.secrets where name in ('gocardless_replay_url', 'gocardless_replay_secret');
  select count(*) into v_queue from net.http_request_queue;
  select count(*) into v_runs from internal.gocardless_replay_runs;
  v_request := internal.request_gocardless_replay();
  perform pg_temp.check(v_request is null
      and (select count(*) from net.http_request_queue) = v_queue and (select count(*) from internal.gocardless_replay_runs) = v_runs,
    'NR2 without its Vault entries the schedule does nothing at all -- local, CI and clean-boot stacks can never call anything');

  perform vault.create_secret('http://replay.invalid/api/gocardless/webhooks/replay', 'gocardless_replay_url', 'never committed');
  perform vault.create_secret(v_secret, 'gocardless_replay_secret', 'never committed');
  v_request := internal.request_gocardless_replay();
  perform pg_temp.check(v_request is null and (select count(*) from net.http_request_queue) = v_queue
      and (select outcome from internal.gocardless_replay_runs order by id desc limit 1) = 'refused_insecure_url',
    'NR3 an address that is not HTTPS is never sent the secret: refused, and recorded so it is seen');

  delete from vault.secrets where name = 'gocardless_replay_url';
  perform vault.create_secret('https://replay.invalid/api/gocardless/webhooks/replay', 'gocardless_replay_url', 'never committed');
  v_request := internal.request_gocardless_replay();
  select * into q from net.http_request_queue where id = v_request;
  perform pg_temp.check(v_request is not null and q.method::text = 'POST' and q.url = 'https://replay.invalid/api/gocardless/webhooks/replay'
      and q.headers ->> 'Authorization' = 'Bearer ' || v_secret and q.timeout_milliseconds = 300000
      and exists (select 1 from internal.gocardless_replay_runs where request_id = v_request and collected_at is null),
    'NR4 with both entries it POSTs the replay route with the bearer secret, and records the request (never committed here, so never sent)');

  insert into net._http_response (id, status_code, content_type, content, timed_out, created)
  values (v_request, 200, 'application/json',
          '{"ok":true,"claimed":2,"replayed":1,"deferred":1,"failed":0,"tokensRevoked":1,"tokensFailed":0,"verificationChecked":0,"verificationFailed":0}', false, now());
  insert into internal.gocardless_replay_runs (request_id) values (v_neg), (v_neg - 1);
  insert into internal.gocardless_replay_runs (request_id, requested_at) values (v_neg - 2, now() - interval '7 hours');
  insert into net._http_response (id, status_code, content_type, content, timed_out, created) values (v_neg, 503, 'text/plain', 'Replay is not configured.', false, now());
  insert into net._http_response (id, status_code, timed_out, error_msg, created) values (v_neg - 1, null, true, 'Timeout of 300000 ms reached', now());
  perform internal.collect_gocardless_replay_responses();
  select * into r from internal.gocardless_replay_runs where request_id = v_request;
  perform pg_temp.check(r.collected_at is not null and r.outcome = 'ok' and r.ok and r.status_code = 200 and r.claimed = 2 and r.replayed = 1
      and r.deferred = 1 and r.failed = 0 and r.tokens_revoked = 1 and r.tokens_failed = 0,
    'NR5 the collector keeps each answer as counts before pg_net forgets it');
  perform pg_temp.check((select outcome = 'http_error' and not ok and status_code = 503 and claimed is null from internal.gocardless_replay_runs where request_id = v_neg)
      and (select outcome = 'timed_out' and not ok from internal.gocardless_replay_runs where request_id = v_neg - 1)
      and (select outcome = 'no_response' and collected_at is not null from internal.gocardless_replay_runs where request_id = v_neg - 2),
    'NR6 and a refusal, a timeout and a request never answered are each recorded as what they were');
  perform pg_temp.check(not exists (select 1 from information_schema.columns where table_schema = 'internal' and table_name = 'gocardless_replay_runs'
                                       and column_name ~* 'content|header|body|secret|url'),
    'NR7 the replay log has nowhere to keep a response body, a header or a secret');
end $$;

-- =========================================================================================================
-- J. GRANTS
-- =========================================================================================================
do $$
declare v_role text; v_ok boolean := true; v_fn text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_fn in array array[
      'public.defer_gocardless_event(uuid, uuid, text)', 'public.claim_stale_gocardless_events(integer, integer)',
      'public.mark_gocardless_event_processed(uuid, text)', 'public.record_gocardless_event(text, text, text, jsonb, uuid)',
      'public.record_gocardless_payment_app_fee(text, integer)', 'public.apply_payment_status_transition(text, text, text, date, text, timestamptz)',
      'public.reconcile_gocardless_subscription(uuid, text, text, text, uuid, timestamptz)',
      'public.reconcile_gocardless_billing_request(uuid, text, text, text, text, text, date, timestamptz, timestamptz)',
      'public.update_gocardless_verification_status(uuid, text)', 'public.record_gocardless_app_disconnected(text, timestamptz)',
      'internal.request_gocardless_replay()', 'internal.collect_gocardless_replay_responses()'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        v_ok := false;
        raise notice 'NOTE % can execute %', v_role, v_fn;
      end if;
    end loop;
  end loop;
  perform pg_temp.check(v_ok and not has_function_privilege('service_role', 'internal.request_gocardless_replay()', 'EXECUTE')
      and not has_table_privilege('authenticated', 'internal.gocardless_replay_runs', 'SELECT')
      and not has_table_privilege('anon', 'internal.gocardless_replay_runs', 'SELECT')
      and has_function_privilege('authenticated', 'public.gocardless_inbox_health()', 'EXECUTE')
      and not has_function_privilege('anon', 'public.gocardless_inbox_health()', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.store_gocardless_connection(uuid, text, text, text, text)', 'EXECUTE'),
    'NG1 nobody signed in can defer, claim, mark, reconcile or schedule: the inbox is the server''s; the health card is signed-in and gated inside');
end $$;

-- =========================================================================================================
-- K. FEE
-- =========================================================================================================
do $$
declare v_tag text := pg_temp.word('tag'); v_filled boolean; v_again boolean; v_unknown boolean; v text;
begin
  v_filled := public.record_gocardless_payment_app_fee('PM_NS_PCA_' || v_tag, 40);
  v_again := public.record_gocardless_payment_app_fee('PM_NS_PCA_' || v_tag, 55);
  v_unknown := public.record_gocardless_payment_app_fee('PM_NS_NOBODY_' || v_tag, 40);
  begin
    perform public.record_gocardless_payment_app_fee('PM_NS_PCA_' || v_tag, -1);
    v := 'OK';
  exception when others then get stacked diagnostics v = returned_sqlstate;
  end;
  perform pg_temp.check(v_filled and not v_again and not v_unknown and v = '22023'
      and (select app_fee_minor from public.gocardless_payments where gc_payment_id = 'PM_NS_PCA_' || v_tag) = 40,
    'NF1 the fee GoCardless reports on a payment fills a missing one, never changes one already recorded, and is never negative');
end $$;

rollback;

-- =========================================================================================================
-- Nothing left behind
-- =========================================================================================================
do $$
begin
  if (select count(*) from public.clubs where slug ~ '^ns-[abc]-[0-9a-f]{8}$') = 0
     and (select count(*) from auth.users where email ~ '^ns\.(full|support|ops|ca|outsider|parent)\.[0-9a-f]{8}@ovalball\.test$') = 0
     and (select count(*) from public.gocardless_events where gc_event_id like 'EV\_NS\_%') = 0
     and (select count(*) from public.gocardless_merchant_connections where gc_organisation_id like 'OR\_NS\_%') = 0
     and (select count(*) from public.gocardless_payments where gc_payment_id like 'PM\_NS\_%') = 0
     and (select count(*) from public.finance_audit_log where new_value ->> 'gc_event_id' like 'EV\_NS\_%') = 0
     and (select count(*) from public.security_events where metadata ->> 'gc_organisation_id' like 'OR\_NS\_%') = 0
     and (select count(*) from internal.gocardless_replay_runs) = current_setting('ns.base_runs')::bigint
     and (select count(*) from internal.gocardless_token_revocations) = current_setting('ns.base_revocations')::bigint
     and (select count(*) from vault.secrets where name in ('gocardless_replay_url', 'gocardless_replay_secret')) = current_setting('ns.base_vault')::bigint
     and (select count(*) from net.http_request_queue where url like 'https://replay.invalid%') = 0
     and (select count(*) from net._http_response where id < 0 and content = 'Replay is not configured.') = 0 then
    raise notice 'PASS NZ1 the suite left nothing behind: clubs, people, events, connections, payments, audit and security rows, the replay log, Vault and pg_net';
  else
    raise notice 'FAIL NZ1 the suite left rows behind';
  end if;
end $$;
