-- MEMBER PAYMENTS SETTLE TRUTHFULLY (20270744000000) -- one test per defect the 5-6 October 2026 audit proved
-- in the member -> club payment path, each with its negative case.
--
--   A. INBOX      a failed webhook event is claimed again by the next delivery; a processed or live-claimed
--                 one is not; a replay finds what GoCardless stopped retrying; nobody signed in can touch it
--   B. ORDER      a stale observation never moves a payment or its month backwards; terminals stay shut; a
--                 late failure, a retry and a reversed chargeback still land
--   C. TOKENS     disconnecting removes the usable token (queued for revocation), audits it, and puts the token
--                 nowhere else; reconnecting revokes the one it replaces; the merchant removing the app is honoured
--   D. CLUB       a billing request's club is the enrolment's own, never the client's
--   E. ZERO       a 100% discount is an exempt month, and one member's failure stops nobody else's month
--   F. PRICE      a price is answered only to who may see it
--   G. PAYER      a minor is never their own payer; the payer's guardianship is checked whoever asks
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/gocardless_member_payment_integrity.sql
--
-- Self-contained, rolled back, and no GoCardless call is made.

begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create temp table ids (k text primary key, v uuid) on commit drop;
create or replace function pg_temp.put(p_k text, p_v uuid) returns void language sql as $$ insert into ids values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;

create or replace function pg_temp.person(p_email text, p_dob date) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, '', now(), now(), now(),
    '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth) values (v, 'Mpi', 'Person', p_email, p_dob)
  on conflict (id) do update set date_of_birth = excluded.date_of_birth;
  return v;
end $$;

-- As somebody, the way the API calls a function: their claims, the authenticated role, then back.
create or replace function pg_temp.say_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  set local role authenticated;
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

-- ---------------------------------------------------------------------------------------------------------
-- The world: one club with a membership product, an admin, two families, an outsider and another club.
-- ---------------------------------------------------------------------------------------------------------
do $$
declare v_dir uuid; v_club uuid; v_dir2 uuid; v_club2 uuid; v_team uuid; v_prog uuid; v_price uuid; v_prog2 uuid;
        v_ca uuid; v_par uuid; v_par2 uuid; v_out uuid; v_teen_user uuid; v_kid1 uuid; v_kid2 uuid; v_kid3 uuid; v_teen uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, rugby_code, country, nation, source, normalized_key, verification_status)
  values ('MPI Club ' || v_tag, 'union', 'England', 'England', 'manual', 'mpi-club-' || v_tag, 'verified') returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'mpi-' || v_tag, 'active') returning id into v_club;
  insert into public.club_directory (name, rugby_code, country, nation, source, normalized_key, verification_status)
  values ('MPI Other ' || v_tag, 'union', 'England', 'England', 'manual', 'mpi-other-' || v_tag, 'verified') returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status) values (v_dir2, 'mpi-o-' || v_tag, 'active') returning id into v_club2;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 'mpi-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;

  v_ca := pg_temp.person('mpi.ca.' || v_tag || '@ovalball.test', date '1980-03-03');
  v_par := pg_temp.person('mpi.parent.' || v_tag || '@ovalball.test', date '1984-04-04');
  v_par2 := pg_temp.person('mpi.parent2.' || v_tag || '@ovalball.test', date '1985-05-05');
  v_out := pg_temp.person('mpi.outsider.' || v_tag || '@ovalball.test', date '1979-09-09');
  v_teen_user := pg_temp.person('mpi.teen.' || v_tag || '@ovalball.test', internal.date_of_birth_in_age_grade('union', 'U16'));
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_ca, 'CLUB_ADMIN', 'active');

  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Ana', 'Mpi ' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_kid1;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Bo', 'Mpi ' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_kid2;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Cy', 'Mpi ' || v_tag, internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_kid3;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id) values ('Tia', 'Mpi ' || v_tag, internal.date_of_birth_in_age_grade('union', 'U16'), 'MALE', v_teen_user) returning id into v_teen;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_kid1, v_team, 'active'), (v_kid2, v_team, 'active'), (v_kid3, v_team, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values
    (v_par, v_kid1, 'parent', 'active'), (v_par, v_kid2, 'parent', 'active'), (v_par2, v_kid3, 'parent', 'active'), (v_ca, v_kid3, 'parent', 'active');

  insert into public.club_subscription_programmes (club_id, enabled, created_by) values (v_club, true, v_ca) returning id into v_prog;
  insert into public.club_subscription_pricing (programme_id, amount_minor, effective_from, created_by) values (v_prog, 1600, current_date - 60, v_ca) returning id into v_price;
  insert into public.club_subscription_programmes (club_id, enabled, created_by) values (v_club2, true, v_ca) returning id into v_prog2;

  perform pg_temp.put('club', v_club); perform pg_temp.put('club2', v_club2); perform pg_temp.put('team', v_team);
  perform pg_temp.put('prog', v_prog); perform pg_temp.put('price', v_price); perform pg_temp.put('prog2', v_prog2);
  perform pg_temp.put('ca', v_ca); perform pg_temp.put('par', v_par); perform pg_temp.put('par2', v_par2); perform pg_temp.put('out', v_out);
  perform pg_temp.put('teen_user', v_teen_user); perform pg_temp.put('teen', v_teen);
  perform pg_temp.put('kid1', v_kid1); perform pg_temp.put('kid2', v_kid2); perform pg_temp.put('kid3', v_kid3);
end $$;

-- =========================================================================================================
-- A. INBOX
-- =========================================================================================================
do $$
declare v_ev text := 'EV_MPI_' || substr(gen_random_uuid()::text, 1, 8); v_id uuid; v_id2 uuid; e public.gocardless_events; v_stale uuid;
begin
  v_id := public.record_gocardless_event(v_ev, 'payments', 'confirmed', '{"id":"x"}'::jsonb);
  select * into e from public.gocardless_events where id = v_id;
  perform pg_temp.check(v_id is not null and e.attempts = 1 and e.claimed_until > now() and not e.processed,
    'MP1 a new event is recorded, claimed for this delivery, and not yet processed');
  perform pg_temp.check(public.record_gocardless_event(v_ev, 'payments', 'confirmed', '{"id":"x"}'::jsonb) is null,
    'MP2 a second delivery while the first still holds its claim is told to skip it');

  perform public.mark_gocardless_event_processed(v_id, 'GoCardless answered 503');
  select * into e from public.gocardless_events where id = v_id;
  v_id2 := public.record_gocardless_event(v_ev, 'payments', 'confirmed', '{"id":"x"}'::jsonb);
  perform pg_temp.check(not e.processed and e.processing_error = 'GoCardless answered 503' and e.claimed_until is null
      and v_id2 = v_id and (select attempts from public.gocardless_events where id = v_id) = 2,
    'MP3 a failure keeps the event unprocessed with its reason and releases it, so the redelivery processes it again -- it used to be skipped for good');

  update public.gocardless_events set claimed_until = now() - interval '1 second' where id = v_id;
  perform pg_temp.check(public.record_gocardless_event(v_ev, 'payments', 'confirmed', '{"id":"x"}'::jsonb) = v_id,
    'MP4 a claim that expired (a delivery that died mid-way) does not strand the event either');

  perform public.mark_gocardless_event_processed(v_id, null);
  perform pg_temp.check((select processed from public.gocardless_events where id = v_id)
      and public.record_gocardless_event(v_ev, 'payments', 'confirmed', '{"id":"x"}'::jsonb) is null,
    'MP5 once processed, any further delivery is a no-op -- duplicate delivery never duplicates a financial effect');

  v_stale := public.record_gocardless_event('EV_MPI_STALE_' || substr(gen_random_uuid()::text, 1, 8), 'payments', 'failed', '{"id":"y"}'::jsonb);
  perform public.mark_gocardless_event_processed(v_stale, 'still failing');
  update public.gocardless_events set last_attempt_at = now() - interval '10 minutes', created_at = now() - interval '2 days' where id = v_stale;
  perform pg_temp.check(exists (select 1 from public.claim_stale_gocardless_events(50) c where c.id = v_stale)
      and not exists (select 1 from public.claim_stale_gocardless_events(50) c where c.id = v_id),
    'MP6 a replay picks up an event GoCardless stopped retrying, takes it once, and never a processed one');

  perform pg_temp.check(not has_function_privilege('authenticated', 'public.record_gocardless_event(text, text, text, jsonb, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.mark_gocardless_event_processed(uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.claim_stale_gocardless_events(integer, integer)', 'execute')
      and not has_function_privilege('anon', 'public.claim_stale_gocardless_events(integer, integer)', 'execute'),
    'MP7 nobody signed in can record, mark or claim an event: the inbox is the server''s');
end $$;

-- =========================================================================================================
-- B. ORDER
-- =========================================================================================================
do $$
declare v_payer uuid; v_obl uuid; v_gc text := 'PM_MPI_' || substr(gen_random_uuid()::text, 1, 8); v_gc2 text := 'PM_MPI2_' || substr(gen_random_uuid()::text, 1, 8);
        v_t0 timestamptz := now() - interval '10 days'; p public.gocardless_payments; o text; v_obl2 uuid;
begin
  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, created_by)
  values (pg_temp.id('kid1'), pg_temp.id('prog'), pg_temp.id('par'), 'guardian', 'active', pg_temp.id('par')) returning id into v_payer;
  insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, due_date, status)
  values (pg_temp.id('prog'), pg_temp.id('club'), pg_temp.id('kid1'), v_payer, pg_temp.id('price'), (date_trunc('month', current_date) - interval '2 months')::date, 1600, current_date - 50, 'PAID')
  returning id into v_obl;
  insert into public.gocardless_payments (club_id, obligation_id, gc_payment_id, gross_amount_minor, status, status_observed_at)
  values (pg_temp.id('club'), v_obl, v_gc, 1600, 'paid_out', v_t0);
  perform pg_temp.put('payer_kid1', v_payer);

  perform public.apply_payment_status_transition(v_gc, 'submitted', null, null, 'EV1', v_t0 - interval '1 hour');
  select * into p from public.gocardless_payments where gc_payment_id = v_gc;
  select status into o from public.membership_obligations where id = v_obl;
  perform pg_temp.check(p.status = 'paid_out' and o = 'PAID'
      and exists (select 1 from public.finance_audit_log where target_id = p.id and action = 'payment_status_transition_ignored' and new_value ->> 'why' = 'stale'),
    'MP8 a late "submitted" observed before the payout changes nothing: the member stays paid, and the ignored event is on the record');

  perform public.apply_payment_status_transition(v_gc, 'failed', 'refer_to_payer', null, 'EV2', v_t0 + interval '1 day');
  select status into o from public.membership_obligations where id = v_obl;
  perform pg_temp.check((select status from public.gocardless_payments where gc_payment_id = v_gc) = 'failed' and o = 'FAILED'
      and (select count(*) from public.notifications where user_id = pg_temp.id('par') and type = 'gocardless_payment_failed' and data ->> 'gc_payment_id' = v_gc) = 1,
    'MP9 a genuinely later failure after payout still lands, and the payer is told once');

  perform public.apply_payment_status_transition(v_gc, 'failed', 'refer_to_payer', null, 'EV2b', v_t0 + interval '1 day 1 hour');
  perform pg_temp.check((select count(*) from public.notifications where user_id = pg_temp.id('par') and type = 'gocardless_payment_failed' and data ->> 'gc_payment_id' = v_gc) = 1,
    'MP10 the same failure seen again tells nobody twice');

  perform public.apply_payment_status_transition(v_gc, 'pending_submission', null, null, 'EV3', v_t0 + interval '2 days');
  select status into o from public.membership_obligations where id = v_obl;
  perform pg_temp.check(o = 'RETRYING', 'MP11 a retry after the failure reads Retrying (' || o || ')');

  perform public.apply_payment_status_transition(v_gc, 'confirmed', null, null, 'EV4', v_t0 + interval '6 days');
  perform public.apply_payment_status_transition(v_gc, 'charged_back', null, null, 'EV5', v_t0 + interval '7 days');
  select status into o from public.membership_obligations where id = v_obl;
  perform pg_temp.check(o = 'CHARGEDBACK', 'MP12 a chargeback after collection is recorded (' || o || ')');
  perform public.apply_payment_status_transition(v_gc, 'confirmed', null, null, 'EV6', v_t0 + interval '9 days');
  select status into o from public.membership_obligations where id = v_obl;
  perform pg_temp.check(o = 'PAID', 'MP13 and a chargeback the bank reversed collects the month after all (' || o || ')');

  insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, due_date, status)
  values (pg_temp.id('prog'), pg_temp.id('club'), pg_temp.id('kid1'), v_payer, pg_temp.id('price'), (date_trunc('month', current_date) - interval '1 month')::date, 1600, current_date - 20, 'SUBMITTED')
  returning id into v_obl2;
  insert into public.gocardless_payments (club_id, obligation_id, gc_payment_id, gross_amount_minor, status, status_observed_at)
  values (pg_temp.id('club'), v_obl2, v_gc2, 1600, 'submitted', v_t0);
  perform public.apply_payment_status_transition(v_gc2, 'cancelled', null, null, 'EV7', v_t0 + interval '1 day');
  perform public.apply_payment_status_transition(v_gc2, 'submitted', null, null, 'EV8', v_t0 + interval '3 days');
  perform pg_temp.check((select status from public.gocardless_payments where gc_payment_id = v_gc2) = 'cancelled'
      and (select status from public.membership_obligations where id = v_obl2) = 'CANCELLED',
    'MP14 a cancelled payment never reopens, however late the next event');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.apply_payment_status_transition(text, text, text, date, text, timestamptz)', 'execute'),
    'MP15 nobody signed in can move a payment''s status');
end $$;

-- =========================================================================================================
-- C. TOKENS
-- =========================================================================================================
do $$
declare v_tok text := 'tok_' || replace(gen_random_uuid()::text, '-', ''); v_tok2 text := 'tok_' || replace(gen_random_uuid()::text, '-', '');
        v_tok3 text := 'tok_' || replace(gen_random_uuid()::text, '-', ''); v text; v_conn uuid; v_n integer;
begin
  v := pg_temp.say_as(pg_temp.id('ca'), format('select public.store_gocardless_connection(%L, %L, %L, %L, %L)', pg_temp.id('club'), 'sandbox', 'OR_MPI_1', v_tok, 'read_write'));
  select id into v_conn from public.gocardless_merchant_connections where club_id = pg_temp.id('club');
  perform pg_temp.check(v = 'OK' and exists (select 1 from public.finance_audit_log where club_id = pg_temp.id('club') and action = 'gocardless_connected')
      and exists (select 1 from public.security_events where club_id = pg_temp.id('club') and event_type = 'payment_provider.connected'),
    'MP16 connecting is on the record: a finance audit row and a security event (' || v || ')');

  v := pg_temp.say_as(pg_temp.id('ca'), format('select public.store_gocardless_connection(%L, %L, %L, %L, %L)', pg_temp.id('club'), 'sandbox', 'OR_MPI_1', v_tok2, 'read_write'));
  perform pg_temp.check(v = 'OK' and exists (select 1 from internal.gocardless_token_revocations where access_token = v_tok and club_id = pg_temp.id('club'))
      and (select access_token from public.gocardless_merchant_connections where id = v_conn) = v_tok2,
    'MP17 a reconnect queues the token it replaces for revocation, not overwritten and forgotten');

  v := pg_temp.say_as(pg_temp.id('ca'), format('select public.disconnect_gocardless(%L, %L)', pg_temp.id('club'), 'Moving to a new bank account'));
  perform pg_temp.check(v = 'OK' and (select access_token from public.gocardless_merchant_connections where id = v_conn) is null
      and exists (select 1 from internal.gocardless_token_revocations where access_token = v_tok2)
      and exists (select 1 from public.finance_audit_log where target_id = v_conn and action = 'gocardless_disconnected' and new_value ->> 'reason' = 'Moving to a new bank account')
      and exists (select 1 from public.security_events where club_id = pg_temp.id('club') and event_type = 'payment_provider.disconnected'),
    'MP18 disconnecting removes the usable token from the connection, queues it for revocation, and records who, when and why (' || v || ')');
  perform pg_temp.check(not exists (select 1 from public.finance_audit_log where club_id = pg_temp.id('club') and (old_value::text || coalesce(new_value::text, '')) ~ 'tok_')
      and not exists (select 1 from public.security_events where club_id = pg_temp.id('club') and (metadata::text || coalesce(reason, '')) ~ 'tok_')
      and not exists (select 1 from public.audit_log where (coalesce(before::text, '') || coalesce(after::text, '')) like '%' || v_tok2 || '%'),
    'MP19 the token is written nowhere but the revocation queue');
  perform pg_temp.check(not has_table_privilege('authenticated', 'internal.gocardless_token_revocations', 'select')
      and not has_function_privilege('authenticated', 'public.claim_gocardless_token_revocations(integer)', 'execute')
      and pg_temp.say_as(pg_temp.id('ca'), 'select count(*) from internal.gocardless_token_revocations') like '42501%',
    'MP20 nobody signed in -- the Club Admin included -- can read a queued token');

  v := pg_temp.say_as(pg_temp.id('ca'), format('select public.store_gocardless_connection(%L, %L, %L, %L, %L)', pg_temp.id('club'), 'sandbox', 'OR_MPI_1', v_tok3, 'read_write'));
  v_n := public.record_gocardless_app_disconnected('OR_MPI_1');
  perform pg_temp.check(v = 'OK' and v_n = 1
      and (select access_token from public.gocardless_merchant_connections where id = v_conn) is null
      and (select disconnected_at from public.gocardless_merchant_connections where id = v_conn) is not null
      and exists (select 1 from public.security_events where club_id = pg_temp.id('club') and event_type = 'payment_provider.revoked_by_merchant'),
    'MP21 when the club removes Ovalball from its GoCardless account, the connection is ended and its dead token dropped (' || v || ', ' || coalesce(v_n, -1) || ')');
end $$;

-- =========================================================================================================
-- D. CLUB
-- =========================================================================================================
do $$
declare v_payer uuid; v text; v_club uuid;
begin
  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, created_by)
  values (pg_temp.id('kid3'), pg_temp.id('prog'), pg_temp.id('par2'), 'guardian', 'active', pg_temp.id('par2')) returning id into v_payer;
  v := pg_temp.say_as(pg_temp.id('par2'), format('select public.record_billing_request(%L, %L, %L, %L, %L)', v_payer, pg_temp.id('club2'), 'BRQ_MPI_X', 'BRF_MPI_X', 'https://pay.example/x'));
  perform pg_temp.check(v like '42501%different club%' and not exists (select 1 from public.gocardless_billing_requests where gc_billing_request_id = 'BRQ_MPI_X'),
    'MP22 a billing request naming another club is refused and records nothing (' || v || ')');
  v := pg_temp.say_as(pg_temp.id('par2'), format('select public.record_billing_request(%L, null, %L, %L, %L)', v_payer, 'BRQ_MPI_Y', 'BRF_MPI_Y', 'https://pay.example/y'));
  select club_id into v_club from public.gocardless_billing_requests where gc_billing_request_id = 'BRQ_MPI_Y';
  perform pg_temp.check(v = 'OK' and v_club = pg_temp.id('club'),
    'MP23 the club recorded is the enrolment''s own, whatever the request says (' || v || ')');
  v := pg_temp.say_as(pg_temp.id('par'), format('select public.record_billing_request(%L, null, %L, %L, %L)', v_payer, 'BRQ_MPI_Z', 'BRF_MPI_Z', 'https://pay.example/z'));
  perform pg_temp.check(v like '42501%', 'MP24 and another family cannot start somebody else''s enrolment (' || v || ')');
end $$;

-- =========================================================================================================
-- E. ZERO
-- =========================================================================================================
do $$
declare v_free uuid; v_paying uuid; v_broken uuid; v_period date := date_trunc('month', current_date)::date; v_n integer;
begin
  -- Bo's price after a 100% sibling discount is zero; Ana pays; Tia's enrolment has no price that applies.
  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, effective_from, final_amount_minor, pricing_id, created_by)
  values (pg_temp.id('kid2'), pg_temp.id('prog'), pg_temp.id('par'), 'guardian', 'active', current_date - 40, 0, pg_temp.id('price'), pg_temp.id('par')) returning id into v_free;
  insert into public.club_subscription_programmes (club_id, enabled, created_by) select pg_temp.id('club'), true, pg_temp.id('ca') where false;
  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, status, effective_from, final_amount_minor, pricing_id, created_by)
  values (pg_temp.id('teen'), pg_temp.id('prog'), pg_temp.id('teen_user'), 'self', 'active', current_date - 400, null, null, pg_temp.id('teen_user')) returning id into v_broken;
  update public.club_subscription_pricing set effective_from = current_date - 60 where id = pg_temp.id('price');
  update public.player_subscription_payers set effective_from = current_date - 40, final_amount_minor = 1600, pricing_id = pg_temp.id('price')
   where id = pg_temp.id('payer_kid1');
  -- No price as of Tia's start: her row cannot be priced.
  update public.player_subscription_payers set effective_from = current_date - 400 where id = v_broken;
  delete from public.membership_obligations where billing_period = v_period and programme_id = pg_temp.id('prog');

  -- Tia's enrolment carries no price of its own, and for this run the product's price only starts next week:
  -- her month cannot be priced. (Put back straight after, for the blocks that follow.)
  update public.club_subscription_pricing set effective_from = current_date + 7 where id = pg_temp.id('price');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.id('ca'), 'role', 'authenticated')::text, true);
  v_n := public.create_membership_obligations_for_period(pg_temp.id('club'), v_period);
  perform set_config('request.jwt.claims', '', true);
  update public.club_subscription_pricing set effective_from = current_date - 60 where id = pg_temp.id('price');

  perform pg_temp.check((select status from public.membership_obligations where payer_subscription_id = v_free and billing_period = v_period) = 'EXEMPT'
      and (select amount_due_minor from public.membership_obligations where payer_subscription_id = v_free and billing_period = v_period) = 0
      and (select resolved_reason from public.membership_obligations where payer_subscription_id = v_free and billing_period = v_period) like 'Nothing to collect%',
    'MP25 a 100% discount is an exempt month with its reason -- never collected, and no longer an error');
  perform pg_temp.check((select status from public.membership_obligations where payer_subscription_id = pg_temp.id('payer_kid1') and billing_period = v_period) = 'SETUP_PENDING',
    'MP26 and the family''s other child still has their month: one free membership stops nobody else''s');
  perform pg_temp.check(not exists (select 1 from public.membership_obligations where payer_subscription_id = v_broken and billing_period = v_period)
      and exists (select 1 from public.finance_audit_log where target_id = v_broken and action = 'obligation_generation_failed'),
    'MP27 a member whose month cannot be priced is recorded as a failure for the club to see, and the run carries on (' || v_n || ' created)');
  perform pg_temp.check(not exists (
      select 1 from public.membership_obligations where amount_due_minor = 0 and status not in ('EXEMPT', 'WAIVED')),
    'MP28 nothing with a zero amount exists except as exempt or waived');
  declare v text;
  begin
    begin
      insert into public.membership_obligations (programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, due_date, status)
      values (pg_temp.id('prog'), pg_temp.id('club'), pg_temp.id('kid3'), pg_temp.id('payer_kid1'), pg_temp.id('price'), (v_period + interval '1 month')::date, 0, current_date, 'SETUP_PENDING');
      v := 'OK';
    exception when check_violation then v := '23514';
    end;
    perform pg_temp.check(v = '23514', 'MP29 a zero amount waiting to be collected is still refused by the table');
  end;
end $$;

-- =========================================================================================================
-- F. PRICE
-- =========================================================================================================
do $$
begin
  perform pg_temp.check(pg_temp.val_as(pg_temp.id('out'), format('select public.current_subscription_price(%L)::text', pg_temp.id('prog'))) is null
      and pg_temp.val_as(pg_temp.id('out'), format('select public.get_first_collection_date(%L)::text', pg_temp.id('prog'))) is null
      and pg_temp.val_as(pg_temp.id('out'), format('select count(*)::text from public.preview_first_payment(%L, %L)', pg_temp.id('prog'), pg_temp.id('kid1'))) = '0',
    'MP30 somebody unconnected to the club learns no price and no collection date -- not even that the product exists');
  perform pg_temp.check(pg_temp.val_as(pg_temp.id('par'), format('select public.current_subscription_price(%L)::text', pg_temp.id('prog'))) = '1600'
      and pg_temp.val_as(pg_temp.id('ca'), format('select public.current_subscription_price(%L)::text', pg_temp.id('prog'))) = '1600',
    'MP31 a parent of a player there, and the club''s finance holders, still read it');
end $$;

-- =========================================================================================================
-- G. PAYER
-- =========================================================================================================
do $$
declare v text;
begin
  v := pg_temp.say_as(pg_temp.id('teen_user'), format('select public.claim_responsible_payer(%L, %L)', pg_temp.id('teen'), pg_temp.id('prog')));
  perform pg_temp.check(v like '42501%under 18%', 'MP32 a player under 18 cannot make themselves their own payer (' || v || ')');
  -- The Club Admin is Cy's parent too; naming an unrelated adult as Cy's "guardian" payer is still refused.
  v := pg_temp.say_as(pg_temp.id('ca'), format('select public.set_responsible_payer(%L, %L, %L, %L, %L)', pg_temp.id('kid3'), pg_temp.id('prog'), pg_temp.id('out'), 'guardian', 'Suite'));
  perform pg_temp.check(v like '%not an active guardian%',
    'MP33 a payer named as a guardian must be one -- even when the person naming them is a guardian themselves (' || v || ')');
  v := pg_temp.say_as(pg_temp.id('ca'), format('select public.set_responsible_payer(%L, %L, %L, %L, %L)', pg_temp.id('kid3'), pg_temp.id('prog'), pg_temp.id('par2'), 'guardian', 'Suite'));
  perform pg_temp.check(v = 'OK', 'MP34 and naming the child''s real guardian still works (' || v || ')');
end $$;

rollback;
