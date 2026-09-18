-- =====================================================================================================
-- WHO MAY SAY WHAT HAPPENED TO AN EMAIL (Slice 6b.2a, adjacent authorisation defect)
--
-- `public.record_email_delivery_result` is SECURITY DEFINER, so RLS never runs for it, and until the
-- fix this suite pins it asked one question: is anybody signed in? It then updated
-- `public.email_deliveries` BY PRIMARY KEY. Any live authenticated session that knew -- or guessed --
-- a delivery id could rewrite that row's status, provider, provider reference, error code, error
-- message, suppression reason, attempt count and timestamps.
--
-- That is not a session-liveness defect. The 6b.2a contract migration closed session liveness on this
-- very function, and a revoked or suspended caller is already refused. This is the question underneath
-- it: a LIVE, ORDINARY, PERFECTLY VALID session had authority over deliveries that were nothing to do
-- with it.
--
-- WHY THE LEDGER MATTERS. `email_deliveries` is what Site Admin reads to answer "did that invitation
-- go out, and what did the provider say". Being able to write it means being able to make a delivery
-- that failed look sent, make a sent one look failed, plant provider text in a field an administrator
-- reads, or inflate the attempt count that drives retry reasoning. Nothing leaks, and no email is
-- redirected -- but the record an administrator trusts stops being a record.
--
-- THE AUTHORITY THAT ALREADY EXISTED. `email_deliveries.initiated_by` is an `auth.users` foreign key,
-- and `public.claim_test_email_send` has always set it from `auth.uid()`. The claim is the establishing
-- act and the claimant is the owner; the architecture had the column and the idiom already. What was
-- missing is that the ordinary claim path never filled it in and the result path never read it.
--
-- Deterministic and self-seeding.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',p_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v,'EDA',p_label,p_email,(current_date - interval '31 years')::date,'ACTIVE')
  on conflict (id) do update set account_state = 'ACTIVE';
  perform internal.refresh_account_security_state(v);
  return v;
end $$;

create or replace function pg_temp.session_for(p_user uuid) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v, p_user, now(), now(), 'aal1');
  return v;
end $$;

create or replace function pg_temp.as_session(p_user uuid, p_session uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true);
end $$;

create or replace function pg_temp.outcome(p_call text) returns text language plpgsql as $$
begin
  begin execute 'select ' || p_call; return '(no refusal)';
  exception when others then return sqlerrm; end;
end $$;

create or replace function pg_temp.session_refusal() returns text language sql immutable as $$
  select 'Your session is no longer valid. Sign in again.'
$$;
create or replace function pg_temp.authority_refusal() returns text language sql immutable as $$
  select 'That delivery is not yours to record a result for.'
$$;

/** Everything about a delivery row that must not move when a refusal happens. */
create or replace function pg_temp.snapshot(p_id uuid) returns text language sql as $$
  select coalesce(d.status,'-')||'|'||coalesce(d.provider,'-')||'|'||coalesce(d.provider_reference,'-')
       ||'|'||coalesce(d.error_code,'-')||'|'||coalesce(d.error_message,'-')||'|'||coalesce(d.suppression_reason,'-')
       ||'|'||d.attempts||'|'||coalesce(d.sent_at::text,'-')||'|'||coalesce(d.failed_at::text,'-')
  from public.email_deliveries d where d.id = p_id;
$$;

do $$
declare
  v_tag   text := substr(gen_random_uuid()::text,1,8);
  v_owner uuid; v_attacker uuid;
  v_sess  uuid; v_asess uuid;
  v_event text;
  v_id    uuid;
  v_before text; v_after text;
  v_out   text;
  v_attempts int;
begin
  v_owner    := pg_temp.person('Owner',    'eda-owner-'||v_tag||'@ovalball.test');
  v_attacker := pg_temp.person('Attacker', 'eda-attacker-'||v_tag||'@ovalball.test');
  v_sess     := pg_temp.session_for(v_owner);
  v_asess    := pg_temp.session_for(v_attacker);
  select e.event_key into v_event from public.email_events e order by e.event_key limit 1;

  -- ===========================================================================================
  -- SETUP. The owner claims a delivery, exactly as lib/email/send.ts does: claim, then record.
  -- ===========================================================================================
  perform pg_temp.as_session(v_owner, v_sess);
  select public.claim_email_delivery(v_event, 'eda-'||v_tag, 'eda-occ-'||v_tag, 'user', null,
                                     'someone-'||v_tag||'@example.com', null, 'Subject') into v_id;
  perform pg_temp.check(v_id is not null, 'EDA-01 SETUP: the owner claims a delivery');
  perform pg_temp.check(
    (select d.initiated_by from public.email_deliveries d where d.id = v_id) = v_owner,
    'EDA-02 the claim records WHO claimed it, server-derived from auth.uid() -- the binding the ordinary '
    'claim path never wrote, though claim_test_email_send has always written it');

  -- ===========================================================================================
  -- THE DEFECT. An unrelated authenticated session, with a perfectly live and ACTIVE account,
  -- holding nothing but the delivery id.
  -- ===========================================================================================
  v_before := pg_temp.snapshot(v_id);
  perform pg_temp.as_session(v_attacker, v_asess);
  v_out := pg_temp.outcome('public.record_email_delivery_result('||quote_literal(v_id)||', ''sent'', ''zeptomail'', ''forged-ref'', null, null, null)');
  v_after := pg_temp.snapshot(v_id);
  perform pg_temp.check(v_out = pg_temp.authority_refusal(),
    'EDA-03 B: an unrelated authenticated caller holding the delivery id is refused, and refused for '
    'AUTHORITY reasons rather than session ones (got: '||v_out||')');
  perform pg_temp.check(v_after = v_before,
    'EDA-04 B: and the row did not move -- status, provider, reference, error code, error message, '
    'suppression reason, attempts and both timestamps are all exactly as they were');

  -- C. Recording without ever having claimed anything: the same refusal, by the same rule.
  v_out := pg_temp.outcome('public.record_email_delivery_result('||quote_literal(v_id)||', ''failed'', ''zeptomail'', null, ''FORGED'', ''forged'', null)');
  perform pg_temp.check(v_out = pg_temp.authority_refusal() and pg_temp.snapshot(v_id) = v_before,
    'EDA-05 C: a caller who never claimed this delivery cannot complete it');

  -- D. The attacker claims a delivery of their OWN, then tries to use that standing on the owner's.
  perform public.claim_email_delivery(v_event, 'eda-att-'||v_tag, 'eda-att-occ-'||v_tag, 'user', null,
                                      'attacker-'||v_tag||'@example.com', null, 'Subject');
  v_out := pg_temp.outcome('public.record_email_delivery_result('||quote_literal(v_id)||', ''sent'', ''zeptomail'', ''forged-2'', null, null, null)');
  perform pg_temp.check(v_out = pg_temp.authority_refusal() and pg_temp.snapshot(v_id) = v_before,
    'EDA-06 D: holding a claim of your own gives you no standing over somebody else''s -- authority is '
    'per delivery, not a role you acquire by having used the system once');

  -- G. A delivery id that names nothing is refused the same way, and says nothing about what exists.
  perform pg_temp.check(
    pg_temp.outcome('public.record_email_delivery_result(gen_random_uuid(), ''sent'')') = pg_temp.authority_refusal(),
    'EDA-07 G: an id that matches no delivery is refused in exactly the same words, so the function '
    'cannot be used to find out which delivery ids are real');

  -- J. Provider and error metadata are payload, never authority. The attacker naming the real
  --    provider, a plausible reference and a real-looking error code changes nothing.
  perform pg_temp.check(
    pg_temp.outcome('public.record_email_delivery_result('||quote_literal(v_id)||', ''failed'', ''zeptomail'', ''zp-real-looking'', ''TM_3201'', ''Sender address not verified'', null)')
      = pg_temp.authority_refusal()
    and pg_temp.snapshot(v_id) = v_before,
    'EDA-08 J: provider, reference, error code and error message are payload and never an authority '
    'input -- a convincing-looking provider result is refused exactly as a crude one is');

  -- ===========================================================================================
  -- A. THE POSITIVE CONTROL. The legitimate claimant still completes their own delivery.
  -- ===========================================================================================
  perform pg_temp.as_session(v_owner, v_sess);
  v_out := pg_temp.outcome('public.record_email_delivery_result('||quote_literal(v_id)||', ''sent'', ''zeptomail'', ''zp-123'', null, null, null)');
  perform pg_temp.check(v_out = '(no refusal)',
    'EDA-09 A: the legitimate claimant records their own result without objection (got: '||v_out||')');
  perform pg_temp.check(
    (select d.status from public.email_deliveries d where d.id = v_id) = 'sent'
    and (select d.provider_reference from public.email_deliveries d where d.id = v_id) = 'zp-123'
    and (select d.sent_at from public.email_deliveries d where d.id = v_id) is not null
    and (select d.attempts from public.email_deliveries d where d.id = v_id) = 1,
    'EDA-10 A: and the row really moved -- status, provider reference, sent_at and the attempt count '
    'are observed on the row rather than inferred from the absence of an exception');

  -- H. A terminal delivery cannot be illegitimately rewritten.
  v_before := pg_temp.snapshot(v_id);
  perform pg_temp.as_session(v_attacker, v_asess);
  perform pg_temp.check(
    pg_temp.outcome('public.record_email_delivery_result('||quote_literal(v_id)||', ''failed'', ''zeptomail'', null, ''FAKE'', ''never happened'', null)')
      = pg_temp.authority_refusal()
    and pg_temp.snapshot(v_id) = v_before,
    'EDA-11 H: a delivery that has reached a terminal state cannot be rewritten by anybody but its '
    'claimant -- a sent email cannot be made to look failed by a stranger');

  -- I. Idempotency/retry, exactly as designed and NOT changed by this fix: the claimant may record
  --    again, and the attempt counter is what moves. Retry semantics are preserved deliberately.
  perform pg_temp.as_session(v_owner, v_sess);
  perform public.record_email_delivery_result(v_id, 'sent', 'zeptomail', 'zp-123', null, null, null);
  select d.attempts into v_attempts from public.email_deliveries d where d.id = v_id;
  perform pg_temp.check(v_attempts = 2,
    'EDA-12 I: the claimant recording a result again still increments attempts, which is the retry '
    'behaviour the ledger is built on and which this fix deliberately leaves alone');

  -- ===========================================================================================
  -- E / F. Session liveness is still decided, and decided FIRST -- the 6b.2a contract is not
  --        replaced by the authority check, it sits in front of it.
  -- ===========================================================================================
  delete from auth.sessions where id = v_sess;
  perform pg_temp.check(
    pg_temp.outcome('public.record_email_delivery_result('||quote_literal(v_id)||', ''failed'')') = pg_temp.session_refusal(),
    'EDA-13 E: the rightful claimant with a REVOKED session is refused by the session gate, not the '
    'authority one -- the two refusals stay distinguishable');

  v_sess := pg_temp.session_for(v_owner);
  perform pg_temp.as_session(v_owner, v_sess);
  update public.profiles set account_state = 'SUSPENDED' where id = v_owner;
  perform pg_temp.check(
    pg_temp.outcome('public.record_email_delivery_result('||quote_literal(v_id)||', ''failed'')') = pg_temp.session_refusal(),
    'EDA-14 F: and a SUSPENDED claimant is refused by the session gate too');

  update public.profiles set account_state = 'ACTIVE' where id = v_owner;
  perform pg_temp.check(
    pg_temp.outcome('public.record_email_delivery_result('||quote_literal(v_id)||', ''sent'', ''zeptomail'', ''zp-123'')') = '(no refusal)',
    'EDA-15 POSITIVE CONTROL: reinstated, the rightful claimant records again -- so EDA-13/14 measured '
    'the session and EDA-03..08 measured the authority, and neither was a broken fixture');
end $$;

-- =====================================================================================================
-- THE SIBLING, AUDITED AS A PAIR
--
-- CLAIM establishes the authority; RECORD RESULT completes it. That invariant is only worth anything if
-- the claim cannot be stolen, and if every path that creates a delivery row writes a claimant.
-- =====================================================================================================
do $$
declare
  v_tag   text := substr(gen_random_uuid()::text,1,8);
  v_owner uuid; v_attacker uuid; v_sess uuid; v_asess uuid;
  v_event text; v_id uuid; v_second uuid; v_supp uuid;
begin
  v_owner    := pg_temp.person('Owner2',    'eda2-owner-'||v_tag||'@ovalball.test');
  v_attacker := pg_temp.person('Attacker2', 'eda2-attacker-'||v_tag||'@ovalball.test');
  v_sess     := pg_temp.session_for(v_owner);
  v_asess    := pg_temp.session_for(v_attacker);
  select e.event_key into v_event from public.email_events e order by e.event_key limit 1;

  perform pg_temp.as_session(v_owner, v_sess);
  select public.claim_email_delivery(v_event, 'eda2-'||v_tag, 'eda2-occ-'||v_tag, 'user', null,
                                     'someone-'||v_tag||'@example.com', null, 'Subject') into v_id;

  -- Claim stealing: the same idempotency key, from somebody else.
  perform pg_temp.as_session(v_attacker, v_asess);
  select public.claim_email_delivery(v_event, 'eda2-'||v_tag, 'eda2-occ-'||v_tag, 'user', null,
                                     'attacker-'||v_tag||'@example.com', null, 'Hijacked') into v_second;
  perform pg_temp.check(v_second is null,
    'EDA-16 a second claim on the same idempotency key returns nothing rather than a claim -- the '
    'unique key is what makes one occurrence one delivery, and it is also what stops a claim being taken');
  perform pg_temp.check(
    (select d.initiated_by from public.email_deliveries d where d.id = v_id) = v_owner
    and (select d.recipient_email from public.email_deliveries d where d.id = v_id) = 'someone-'||v_tag||'@example.com'
    and (select d.subject from public.email_deliveries d where d.id = v_id) = 'Subject',
    'EDA-17 and the original claim is untouched -- owner, recipient and subject are all still the '
    'first caller''s, so the failed steal overwrote nothing');

  -- Every path that creates a delivery row writes a claimant.
  perform pg_temp.as_session(v_owner, v_sess);
  select public.claim_disabled_email_suppression(v_event, 'occ-'||v_tag, 'user') into v_supp;
  perform pg_temp.check(
    v_supp is not null and (select d.initiated_by from public.email_deliveries d where d.id = v_supp) = v_owner,
    'EDA-18 the suppression path records a claimant too, so "every delivery row knows who created it" '
    'is an invariant rather than something true of two paths out of three');
end $$;

-- =====================================================================================================
-- THE RACE THAT ACTUALLY EXISTS
--
-- A claim is a row with a unique key, so the contest is decided by the unique index inside one
-- statement rather than by anything this code arbitrates. What is worth proving is that the losing
-- caller gains nothing from losing, and that the attacker cannot win the completion by arriving first,
-- second, or in the middle of the legitimate claimant's own sequence.
-- =====================================================================================================
do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_owner uuid; v_attacker uuid; v_sess uuid; v_asess uuid; v_event text; v_id uuid; v_snap text;
begin
  v_owner    := pg_temp.person('Owner3',    'eda3-owner-'||v_tag||'@ovalball.test');
  v_attacker := pg_temp.person('Attacker3', 'eda3-attacker-'||v_tag||'@ovalball.test');
  v_sess     := pg_temp.session_for(v_owner);
  v_asess    := pg_temp.session_for(v_attacker);
  select e.event_key into v_event from public.email_events e order by e.event_key limit 1;

  perform pg_temp.as_session(v_owner, v_sess);
  select public.claim_email_delivery(v_event, 'eda3-'||v_tag, 'eda3-occ-'||v_tag, 'user', null,
                                     'someone-'||v_tag||'@example.com', null, 'Subject') into v_id;

  -- The attacker gets in between the claim and the legitimate completion.
  perform pg_temp.as_session(v_attacker, v_asess);
  perform pg_temp.check(
    pg_temp.outcome('public.record_email_delivery_result('||quote_literal(v_id)||', ''failed'', ''zeptomail'', null, ''RACE'', ''raced'', null)')
      = pg_temp.authority_refusal(),
    'EDA-19 RACE: arriving between the claim and the completion wins the attacker nothing -- the '
    'authority is read from the row at the moment of the write, not from anything held earlier');

  perform pg_temp.as_session(v_owner, v_sess);
  perform public.record_email_delivery_result(v_id, 'sent', 'zeptomail', 'zp-race', null, null, null);
  v_snap := pg_temp.snapshot(v_id);

  -- ...and after it, too.
  perform pg_temp.as_session(v_attacker, v_asess);
  perform pg_temp.check(
    pg_temp.outcome('public.record_email_delivery_result('||quote_literal(v_id)||', ''failed'', ''zeptomail'', null, ''RACE2'', ''raced'', null)')
      = pg_temp.authority_refusal()
    and pg_temp.snapshot(v_id) = v_snap,
    'EDA-20 RACE: and arriving after it leaves the terminal state exactly as the claimant left it');

  -- The revocation race: the claimant's session dies mid-sequence.
  perform pg_temp.as_session(v_owner, v_sess);
  delete from auth.sessions where id = v_sess;
  perform pg_temp.check(
    pg_temp.outcome('public.record_email_delivery_result('||quote_literal(v_id)||', ''failed'')') = pg_temp.session_refusal()
    and pg_temp.snapshot(v_id) = v_snap,
    'EDA-21 RACE: a claimant whose session is revoked between claim and completion is refused at the '
    'write, and the ledger keeps the last legitimate answer');
end $$;

-- =====================================================================================================
-- THE STRUCTURAL RULE, SO THIS CANNOT SILENTLY COME BACK
-- =====================================================================================================
do $$
declare v_src text; v_claim text;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='record_email_delivery_result';
  perform pg_temp.check(v_src ~ 'initiated_by' and v_src ~ 'auth\.uid\(\)',
    'EDA-22 record_email_delivery_result binds the write to the claimant recorded on the row, and '
    'derives the caller from auth.uid() rather than from any argument');
  perform pg_temp.check(v_src !~ 'p_provider\s*(=|<>)|p_error_code\s*(=|<>)|p_suppression_reason\s*(=|<>)',
    'EDA-23 and no provider, error or suppression argument appears in an authority comparison');

  select p.prosrc into v_claim from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='claim_email_delivery';
  perform pg_temp.check(v_claim ~ 'initiated_by',
    'EDA-24 and the ordinary claim path writes the claimant, so the binding the result path reads is '
    'always there to be read');
end $$;

rollback;
