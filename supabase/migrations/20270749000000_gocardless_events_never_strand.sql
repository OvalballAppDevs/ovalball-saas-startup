-- =====================================================================================================
-- GOCARDLESS EVENTS NEVER STRAND (2026-10-06)
--
-- The webhook replay and security re-proof of 6 October 2026 found that 20270744000000 made the member ->
-- club payments inbox claimable and retryable, but that an event could still be lost quietly or for good.
-- This is the server half of those fixes (gaps G1, G2, G4-G9 and G13 of that audit); the processor half is
-- lib/payments/gocardless/{process-event,reconcile,verification}.ts and the two webhook routes.
--
--   G1  NOTHING RAN THE REPLAY. internal.request_gocardless_replay(), on pg_cron every ten minutes, POSTs the
--       replay route with a bearer secret it reads from Supabase Vault -- and does NOTHING when either Vault
--       entry is missing, so a local, CI or clean-boot stack can never call anything. pg_net is
--       fire-and-forget, so a collector copies each answer into internal.gocardless_replay_runs before
--       pg_net's own retention removes it.
--   G2  FAILURE WAS INVISIBLE. public.gocardless_inbox_health() answers a Full Site Admin with COUNTS ONLY:
--       events unprocessed for over 30 minutes, deferred, dead-lettered, the oldest one's age, the token
--       revocation queue, and the last replay run. Never a payload, never a token.
--   G4  FOUR DOCUMENTED GOCARDLESS STATUSES COULD NEVER BE RECORDED, so their events failed for ever: a
--       payment's pending_customer_approval and customer_approval_denied, a billing request's
--       ready_to_fulfil and fulfilling (https://docs.gocardless.com/docs/api-reference/payment,
--       .../billing-request). Each table now holds GoCardless's whole documented vocabulary, and a denied
--       payment settles its month as CANCELLED -- the payment will not be collected.
--   G5  A SHORT FLAT BUDGET. Twelve claims, a flat five-minute wait, then silence. Now the wait doubles with
--       each attempt (5 minutes, capped at 6 hours) over twenty attempts -- about three and a half days of
--       automatic retry -- and an event that uses them all is DEAD-LETTERED: never claimed again by the
--       replay, kept whole for diagnosis with its first and last error. Events are tied to their club where
--       GoCardless's organisation id resolves to exactly one.
--   G6  RECONNECTING TO A DIFFERENT GOCARDLESS ACCOUNT ORPHANED LIVE DIRECT DEBITS. They kept collecting
--       where Ovalball could no longer see or cancel them. Switching account or environment is now refused
--       while the club still has a live mandate or subscription; and a revocation still queued for the very
--       token being stored is withdrawn, so the drain can never revoke a live connection.
--   G7  AN EVENT FOR A DISCONNECTED CLUB WAS CONSUMED AS A SUCCESS. It is now DEFERRED, with its reason, and
--       the replay takes it again once the club has a live connection to that GoCardless account.
--   G8  A FAILED VERIFICATION CHECK WROTE 'unknown' OVER A KNOWN STATUS, which blocks enrolment. A check
--       that failed now writes nothing.
--   G9  SUBSCRIPTION, MANDATE AND BILLING-REQUEST STATUSES OVERWROTE EACH OTHER IN ARRIVAL ORDER. Each now
--       carries the time it was observed; an observation no newer than the recorded one changes nothing, and
--       GoCardless's own final states never reopen. A mandate's cancelled and expired are NOT final:
--       GoCardless reinstates them ("reinstated": "The mandate has become active again, after it was
--       cancelled or expired", https://docs.gocardless.com/docs/api-reference/events/mandate), so only
--       failed, consumed and blocked ("cannot be unblocked") are.
--   G13 A LATE "APP DISCONNECTED" EVENT ENDED A NEWER CONNECTION. It now ends only a connection made before
--       GoCardless recorded the disconnection.
--
-- Re-runnable: every object is created or replaced, columns and constraints are added if missing, and the
-- schedules use the unschedule-if-exists idiom of 20270544000000.
--
-- Tests: supabase/tests/gocardless_events_never_strand.sql (SQL) and
-- supabase/tests/js/gocardless_replay_route.test.mts (JS, GoCardless stubbed).
-- =====================================================================================================


-- -----------------------------------------------------------------------------------------------------
-- 1. THE BUDGET: twenty attempts, each wait twice the last (5 minutes, capped at 6 hours)
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.gocardless_event_attempt_ceiling()
 returns integer
 language sql
 immutable
 set search_path to ''
as $function$
  select 20
$function$;

-- How long an event must sit idle after its latest attempt before the replay takes it again.
create or replace function internal.gocardless_event_backoff(p_attempts integer)
 returns interval
 language sql
 immutable
 set search_path to ''
as $function$
  select least(interval '5 minutes' * power(2, least(greatest(coalesce(p_attempts, 1), 1) - 1, 10))::integer,
               interval '6 hours')
$function$;

-- The club a GoCardless event is about, from the organisation GoCardless names on every partner event: the one
-- club whose live connection holds it, or else the one club that ever held it. Ambiguous stays unresolved --
-- never guessed.
create or replace function internal.gocardless_event_club(p_payload jsonb)
 returns uuid
 language sql
 stable
 set search_path to ''
as $function$
  with org as (
    select nullif(p_payload -> 'links' ->> 'organisation', '') as id
  ), live as (
    select c.club_id from public.gocardless_merchant_connections c, org
     where org.id is not null and c.gc_organisation_id = org.id and c.disconnected_at is null
  ), ever as (
    select c.club_id from public.gocardless_merchant_connections c, org
     where org.id is not null and c.gc_organisation_id = org.id
  )
  select case
           when (select count(*) from live) = 1 then (select club_id from live)
           when (select count(*) from ever) = 1 then (select club_id from ever)
         end
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 2. AN EVENT KEEPS ITS HISTORY, AND CAN BE DEFERRED OR DEAD-LETTERED
-- -----------------------------------------------------------------------------------------------------
alter table public.gocardless_events
  add column if not exists failure_count integer not null default 0,
  add column if not exists first_error text,
  add column if not exists first_failed_at timestamptz,
  add column if not exists last_failed_at timestamptz,
  add column if not exists deferred_at timestamptz,
  add column if not exists deferred_reason text,
  add column if not exists dead_lettered_at timestamptz,
  add column if not exists dead_letter_reason text;

comment on column public.gocardless_events.processing_error is 'The LAST failure''s message (first_error keeps the first).';
comment on column public.gocardless_events.attempts is 'Claims made by either path (webhook delivery or replay); the budget is internal.gocardless_event_attempt_ceiling().';
comment on column public.gocardless_events.deferred_at is 'Set while the event waits for its club to have a live connection to its GoCardless account (G7); cleared by a later failure.';
comment on column public.gocardless_events.dead_lettered_at is 'Set when the event used its whole budget: the replay never claims it again; a GoCardless redelivery or manual retry still may.';

-- What is known about events that failed before this migration: their last error, as their first.
update public.gocardless_events
   set failure_count = 1,
       first_error = processing_error,
       first_failed_at = coalesce(last_attempt_at, created_at),
       last_failed_at = coalesce(last_attempt_at, created_at)
 where processed = false and processing_error is not null and failure_count = 0;

-- Best effort: the club, wherever the organisation resolves to exactly one.
update public.gocardless_events e
   set club_id = internal.gocardless_event_club(e.payload)
 where e.club_id is null
   and internal.gocardless_event_club(e.payload) is not null;


-- -----------------------------------------------------------------------------------------------------
-- 3. THE INBOX'S DOORS
-- -----------------------------------------------------------------------------------------------------
-- Unchanged contract (20270744000000): the event's id when this delivery should process it, NULL when it is done
-- or another delivery holds a live claim. Now also notes the club, where the organisation resolves to one.
create or replace function public.record_gocardless_event(p_gc_event_id text, p_resource_type text, p_action text, p_payload jsonb, p_club_id uuid default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_club uuid := coalesce(p_club_id, internal.gocardless_event_club(p_payload));
begin
  insert into public.gocardless_events (club_id, gc_event_id, resource_type, action, payload, attempts, claimed_until, last_attempt_at)
  values (v_club, p_gc_event_id, p_resource_type, p_action, p_payload, 1, now() + interval '2 minutes', now())
  on conflict (gc_event_id) do update
     set attempts = public.gocardless_events.attempts + 1,
         claimed_until = now() + interval '2 minutes',
         last_attempt_at = now(),
         club_id = coalesce(public.gocardless_events.club_id, excluded.club_id)
   where public.gocardless_events.processed = false
     and (public.gocardless_events.claimed_until is null or public.gocardless_events.claimed_until < now())
  returning id into v_id;
  return v_id;
end;
$function$;

-- Success marks it processed (and no longer dead). A failure keeps it unprocessed with its reason -- the first one
-- kept as well as the last -- releases the claim, and dead-letters it once the budget is spent. A failure reported
-- for an event another delivery has already processed changes nothing: processing is idempotent, so that success
-- stands.
create or replace function public.mark_gocardless_event_processed(p_event_id uuid, p_error text default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_error text := left(p_error, 1000);
  v_ceiling integer := internal.gocardless_event_attempt_ceiling();
begin
  if p_error is null then
    update public.gocardless_events
       set processed = true,
           processed_at = now(),
           processing_error = null,
           claimed_until = null,
           dead_lettered_at = null,
           dead_letter_reason = null
     where id = p_event_id;
    return;
  end if;

  update public.gocardless_events
     set processing_error = v_error,
         first_error = coalesce(first_error, v_error),
         first_failed_at = coalesce(first_failed_at, now()),
         last_failed_at = now(),
         failure_count = failure_count + 1,
         claimed_until = null,
         deferred_at = null,
         deferred_reason = null,
         dead_lettered_at = case when attempts >= v_ceiling then coalesce(dead_lettered_at, now()) end,
         dead_letter_reason = case when attempts >= v_ceiling
                                   then format('Gave up after %s attempts. Last error: %s', attempts, left(v_error, 300)) end
   where id = p_event_id
     and processed = false;
end;
$function$;

-- G7: an event whose club has no live connection to its GoCardless account waits -- unprocessed, out of the
-- failure budget's way -- until the club has one again. Never consumed as if it had had its effect.
create or replace function public.defer_gocardless_event(p_event_id uuid, p_club_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  update public.gocardless_events
     set deferred_at = now(),
         deferred_reason = left(coalesce(nullif(btrim(p_reason), ''), 'Waiting for the club to reconnect GoCardless.'), 300),
         club_id = coalesce(p_club_id, club_id),
         claimed_until = null
   where id = p_event_id
     and processed = false;
end;
$function$;

-- The replay's claim. First, anything that has spent its budget and that nobody holds is dead-lettered. Then the
-- oldest claimable events are taken (skip locked, so two replays never take the same one):
--   * a failing event, within its budget, once it has sat idle for its back-off (internal.gocardless_event_backoff);
--   * a deferred event once its club has a live connection to the event's GoCardless account again -- whatever its
--     attempts, because waiting is not failing; if that attempt then fails, the budget applies as usual.
-- Same signature as 20270744000000; p_max_attempts now defaults to the shared ceiling.
create or replace function public.claim_stale_gocardless_events(p_limit integer default 20, p_max_attempts integer default null)
 returns table(id uuid, payload jsonb)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ceiling integer := coalesce(p_max_attempts, internal.gocardless_event_attempt_ceiling());
begin
  update public.gocardless_events d
     set dead_lettered_at = now(),
         dead_letter_reason = format('Gave up after %s attempts. Last error: %s', d.attempts,
                                     coalesce(left(d.processing_error, 300), 'none recorded -- the last attempt never finished.'))
   where d.id in (select e.id
                    from public.gocardless_events e
                   where e.processed = false
                     and e.dead_lettered_at is null
                     and e.deferred_at is null
                     and e.attempts >= v_ceiling
                     and coalesce(e.claimed_until, '-infinity'::timestamptz) < now()
                     for update skip locked);

  return query
  with stale as (
    select e.id
      from public.gocardless_events e
     where e.processed = false
       and e.dead_lettered_at is null
       and ((e.deferred_at is null
             and e.attempts < v_ceiling
             and coalesce(e.claimed_until, e.last_attempt_at, e.created_at) < now() - internal.gocardless_event_backoff(e.attempts))
            or (e.deferred_at is not null
                and coalesce(e.claimed_until, e.deferred_at) < now() - interval '5 minutes'
                and exists (select 1
                              from public.gocardless_merchant_connections c
                             where c.club_id = e.club_id
                               and c.disconnected_at is null
                               and c.access_token is not null
                               and (nullif(e.payload -> 'links' ->> 'organisation', '') is null
                                    or c.gc_organisation_id = e.payload -> 'links' ->> 'organisation'))))
     order by e.created_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  )
  update public.gocardless_events e
     set attempts = e.attempts + 1, claimed_until = now() + interval '2 minutes', last_attempt_at = now()
    from stale
   where e.id = stale.id
  returning e.id, e.payload;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 4. GOCARDLESS'S WHOLE DOCUMENTED VOCABULARY, AND THE TIME EACH STATUS WAS OBSERVED (G4, G9)
-- -----------------------------------------------------------------------------------------------------
alter table public.gocardless_payments drop constraint if exists gocardless_payments_status_check;
alter table public.gocardless_payments add constraint gocardless_payments_status_check
  check (status = any (array['pending_customer_approval', 'pending_submission', 'submitted', 'confirmed', 'paid_out',
                             'failed', 'cancelled', 'customer_approval_denied', 'charged_back']::text[]));

-- 'pending' is Ovalball's own state between creating a subscription and first hearing GoCardless's.
alter table public.gocardless_subscriptions drop constraint if exists gocardless_subscriptions_status_check;
alter table public.gocardless_subscriptions add constraint gocardless_subscriptions_status_check
  check (status = any (array['pending', 'pending_customer_approval', 'customer_approval_denied', 'active', 'finished',
                             'cancelled', 'paused']::text[]));

alter table public.gocardless_mandates drop constraint if exists gocardless_mandates_status_check;
alter table public.gocardless_mandates add constraint gocardless_mandates_status_check
  check (status = any (array['pending_customer_approval', 'pending_submission', 'submitted', 'active', 'suspended_by_payer',
                             'failed', 'cancelled', 'expired', 'consumed', 'blocked']::text[]));

-- 'authorised' and 'expired' are kept for rows written before reconciliation recorded GoCardless's own words.
alter table public.gocardless_billing_requests drop constraint if exists gocardless_billing_requests_status_check;
alter table public.gocardless_billing_requests add constraint gocardless_billing_requests_status_check
  check (status = any (array['pending', 'ready_to_fulfil', 'fulfilling', 'fulfilled', 'cancelled', 'authorised', 'expired']::text[]));

alter table public.gocardless_subscriptions add column if not exists status_observed_at timestamptz;
alter table public.gocardless_mandates add column if not exists status_observed_at timestamptz;
alter table public.gocardless_billing_requests add column if not exists status_observed_at timestamptz;


-- -----------------------------------------------------------------------------------------------------
-- 5. A PAYMENT: the denied approval settles its month, and an observation's time is its own
--    Redefined from the live definition (20270744000000). Three changes:
--      * customer_approval_denied, now recordable (G4), settles the month as CANCELLED -- the payment will not be
--        collected; pending_customer_approval leaves the month as it is;
--      * an observation with no stated time is observed NOW, by the clock (clock_timestamp), not at the start of
--        its transaction -- two observations made one after the other are two observations, not one stale one;
--      * a failure reason is written only with a status it can describe (failed, charged back, cancelled,
--        denied), never carried by a stale event onto a newer status.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.apply_payment_status_transition(p_gc_payment_id text, p_new_status text, p_failure_reason_code text default null,
                                                                  p_charge_date date default null, p_gc_event_id text default null,
                                                                  p_observed_at timestamptz default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_payment record;
  v_observed timestamptz := coalesce(p_observed_at, clock_timestamp());
  v_obligation_status text;
  v_payer_user_id uuid;
  v_player_id uuid;
  v_player_name text;
begin
  select * into v_payment from public.gocardless_payments where gc_payment_id = p_gc_payment_id for update;
  if v_payment is null then
    return;
  end if;

  -- GOCARDLESS'S OWN TERMINALS never reopen: a cancelled payment, or one the customer declined.
  if v_payment.status in ('cancelled', 'customer_approval_denied') and p_new_status is distinct from v_payment.status then
    insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
    values (null, v_payment.club_id, 'payment_status_transition_ignored', 'gocardless_payments', v_payment.id,
            jsonb_build_object('status', v_payment.status),
            jsonb_build_object('status', p_new_status, 'why', 'terminal', 'gc_event_id', p_gc_event_id), 'webhook');
    return;
  end if;
  -- A STALE OBSERVATION CHANGES NOTHING: one made no later than the status already recorded (a delivery out of
  -- order, or a slow re-fetch overtaken by a faster one).
  if v_payment.status_observed_at is not null and v_observed <= v_payment.status_observed_at then
    if p_new_status is distinct from v_payment.status then
      insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
      values (null, v_payment.club_id, 'payment_status_transition_ignored', 'gocardless_payments', v_payment.id,
              jsonb_build_object('status', v_payment.status, 'observed_at', v_payment.status_observed_at),
              jsonb_build_object('status', p_new_status, 'observed_at', v_observed, 'why', 'stale', 'gc_event_id', p_gc_event_id), 'webhook');
    end if;
    return;
  end if;

  update public.gocardless_payments
  set status = p_new_status,
      status_observed_at = v_observed,
      failure_reason_code = case when p_new_status in ('failed', 'charged_back', 'cancelled', 'customer_approval_denied')
                                 then coalesce(p_failure_reason_code, failure_reason_code)
                                 else failure_reason_code end,
      charge_date = coalesce(p_charge_date, charge_date),
      submitted_at = case when p_new_status = 'submitted' and v_payment.status is distinct from 'submitted' then now() else submitted_at end,
      confirmed_at = case when p_new_status = 'confirmed' and v_payment.status is distinct from 'confirmed' then now() else confirmed_at end,
      failed_at = case when p_new_status = 'failed' and v_payment.status is distinct from 'failed' then now() else failed_at end
  where id = v_payment.id;

  if p_new_status is not distinct from v_payment.status then
    -- The same status, seen again later: the observation is newer, nothing else is.
    return;
  end if;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (
    null,
    v_payment.club_id,
    'payment_status_transition',
    'gocardless_payments',
    v_payment.id,
    jsonb_build_object('status', v_payment.status),
    jsonb_build_object('status', p_new_status, 'gc_payment_id', p_gc_payment_id, 'gc_event_id', p_gc_event_id, 'observed_at', v_observed),
    'webhook'
  );

  if p_new_status = 'failed' then
    select psp.payer_user_id, mo.player_id, p.first_name || ' ' || p.surname
    into v_payer_user_id, v_player_id, v_player_name
    from public.membership_obligations mo
    join public.player_subscription_payers psp on psp.id = mo.payer_subscription_id
    join public.players p on p.id = mo.player_id
    where mo.id = v_payment.obligation_id;

    if v_payer_user_id is not null then
      insert into public.notifications (user_id, type, title, body, data)
      values (
        v_payer_user_id,
        'gocardless_payment_failed',
        'Membership payment failed',
        format('The Direct Debit payment for %s''s membership could not be collected. Please check your bank details or contact the club.', coalesce(v_player_name, 'your player')),
        jsonb_build_object('obligation_id', v_payment.obligation_id, 'player_id', v_player_id, 'gc_payment_id', p_gc_payment_id)
      );
    end if;
  end if;

  v_obligation_status := case
    when p_new_status in ('pending_submission', 'submitted') and v_payment.status = 'failed' then 'RETRYING'
    when p_new_status = 'submitted' then 'SUBMITTED'
    when p_new_status = 'confirmed' then 'PAID'
    when p_new_status = 'paid_out' then 'PAID'
    when p_new_status = 'failed' then 'FAILED'
    when p_new_status = 'cancelled' then 'CANCELLED'
    -- GoCardless: "the customer has denied approval for the payment" -- it will not be collected.
    when p_new_status = 'customer_approval_denied' then 'CANCELLED'
    when p_new_status = 'charged_back' then 'CHARGEDBACK'
    else null
  end;

  if v_obligation_status is not null then
    update public.membership_obligations
    set status = v_obligation_status, resolved_at = case when v_obligation_status in ('PAID', 'CANCELLED', 'CHARGEDBACK', 'REFUNDED') then now() else resolved_at end
    where id = v_payment.obligation_id
      and (status not in ('CANCELLED', 'REFUNDED', 'CHARGEDBACK', 'EXEMPT', 'WAIVED')
           -- A chargeback the bank reversed collects the month after all.
           or (status = 'CHARGEDBACK' and v_obligation_status = 'PAID'));
  end if;
end;
$function$;

-- The fee GoCardless itself reports on a payment ("payments.app_fee ... Only present if the payment was created via
-- an app"). A payment's fee never changes once created, so the first value recorded stands -- the same rule as
-- record_gocardless_payment (20270748000000). Returns whether it filled a missing one.
create or replace function public.record_gocardless_payment_app_fee(p_gc_payment_id text, p_app_fee_minor integer)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n integer;
begin
  if p_app_fee_minor is null then
    return false;
  end if;
  if p_app_fee_minor < 0 then
    raise exception 'An app fee cannot be negative.' using errcode = '22023';
  end if;
  update public.gocardless_payments
     set app_fee_minor = p_app_fee_minor
   where gc_payment_id = p_gc_payment_id
     and app_fee_minor is null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 6. A SUBSCRIPTION: observed in order, and its final states stay final (G9)
--    Redefined from the live definition; gains p_observed_at. GoCardless's finished, cancelled and
--    customer_approval_denied are final ("will no longer create payments"); paused and active move both ways.
-- -----------------------------------------------------------------------------------------------------
drop function if exists public.reconcile_gocardless_subscription(uuid, text, text, text, uuid);
create or replace function public.reconcile_gocardless_subscription(p_local_subscription_id uuid, p_gc_status text, p_gc_event_id text default null,
                                                                    p_source text default 'webhook', p_actor_user_id uuid default null,
                                                                    p_observed_at timestamptz default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_before record;
  v_observed timestamptz := coalesce(p_observed_at, clock_timestamp());
  v_why text;
begin
  if p_local_subscription_id is null then
    raise exception 'Local subscription id required.';
  end if;
  if p_source not in ('webhook', 'admin_ui', 'parent_ui', 'system') then
    raise exception 'Invalid audit source.';
  end if;

  select id, club_id, status, status_observed_at into v_before
    from public.gocardless_subscriptions where id = p_local_subscription_id for update;
  if v_before.id is null then
    raise exception 'Subscription not found.';
  end if;

  -- A status GoCardless reported that Ovalball does not recognise arrives as NULL: nothing is written over a
  -- known one.
  if p_gc_status is null then
    return v_before.id;
  end if;

  v_why := case
    when v_before.status in ('finished', 'cancelled', 'customer_approval_denied') and p_gc_status is distinct from v_before.status then 'terminal'
    when v_before.status_observed_at is not null and v_observed <= v_before.status_observed_at then 'stale'
  end;
  if v_why is not null then
    if p_gc_status is distinct from v_before.status then
      insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
      values (p_actor_user_id, v_before.club_id, 'subscription_status_transition_ignored', 'gocardless_subscriptions', v_before.id,
              jsonb_build_object('status', v_before.status, 'observed_at', v_before.status_observed_at),
              jsonb_build_object('status', p_gc_status, 'observed_at', v_observed, 'why', v_why, 'gc_event_id', p_gc_event_id),
              p_source);
    end if;
    return v_before.id;
  end if;

  update public.gocardless_subscriptions
     set status = p_gc_status, status_observed_at = v_observed
   where id = v_before.id;

  if p_gc_status is distinct from v_before.status then
    insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
    values (
      p_actor_user_id,
      v_before.club_id,
      'subscription_status_transition',
      'gocardless_subscriptions',
      v_before.id,
      jsonb_build_object('status', v_before.status),
      jsonb_build_object('status', p_gc_status, 'gc_event_id', p_gc_event_id, 'observed_at', v_observed),
      p_source
    );
  end if;

  return v_before.id;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 7. A BILLING REQUEST AND ITS MANDATE: observed in order; final states stay final (G9)
--    Redefined from the live definition; gains p_observed_at (the billing request's re-fetch) and
--    p_mandate_observed_at (the mandate's). A billing request's fulfilled and cancelled are final. A mandate's
--    failed, consumed and blocked are final; its cancelled and expired can come back (GoCardless reinstatement).
--    An unrecognised status arrives as NULL and writes nothing. The customer link is a fact, not an observation,
--    and is always kept.
-- -----------------------------------------------------------------------------------------------------
drop function if exists public.reconcile_gocardless_billing_request(uuid, text, text, text, text, text, date);
create or replace function public.reconcile_gocardless_billing_request(p_billing_request_local_id uuid, p_gc_billing_request_status text,
                                                                       p_gc_customer_id text, p_gc_mandate_id text, p_mandate_status text,
                                                                       p_mandate_scheme text, p_next_possible_charge_date date,
                                                                       p_observed_at timestamptz default null,
                                                                       p_mandate_observed_at timestamptz default null)
 returns table(customer_id uuid, mandate_id uuid)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_br record;
  v_payer_user_id uuid;
  v_customer_id uuid;
  v_mandate record;
  v_mandate_id uuid;
  v_observed timestamptz := coalesce(p_observed_at, clock_timestamp());
  v_mandate_observed timestamptz := coalesce(p_mandate_observed_at, p_observed_at, clock_timestamp());
begin
  select br.id, br.club_id, br.payer_subscription_id, br.status, br.status_observed_at into v_br
    from public.gocardless_billing_requests br
   where br.id = p_billing_request_local_id
   for update;
  if v_br.id is null then
    raise exception 'Billing request not found.';
  end if;

  select psp.payer_user_id into v_payer_user_id
    from public.player_subscription_payers psp
   where psp.id = v_br.payer_subscription_id;
  if v_payer_user_id is null then
    raise exception 'Responsible payer not found for this billing request.';
  end if;

  if p_gc_billing_request_status is not null
     and not (v_br.status in ('fulfilled', 'cancelled') and p_gc_billing_request_status is distinct from v_br.status)
     and not (v_br.status_observed_at is not null and v_observed <= v_br.status_observed_at) then
    update public.gocardless_billing_requests
       set status = p_gc_billing_request_status, status_observed_at = v_observed
     where id = v_br.id;
  end if;

  if p_gc_customer_id is not null then
    insert into public.gocardless_customers (club_id, payer_user_id, gc_customer_id)
    values (v_br.club_id, v_payer_user_id, p_gc_customer_id)
    on conflict (club_id, payer_user_id) do update set gc_customer_id = excluded.gc_customer_id
    returning id into v_customer_id;
  end if;

  if p_gc_mandate_id is not null then
    insert into public.gocardless_mandates (club_id, gocardless_customer_id, billing_request_id, gc_mandate_id, status, scheme,
                                            next_possible_charge_date, status_observed_at)
    values (v_br.club_id, v_customer_id, v_br.id, p_gc_mandate_id, coalesce(p_mandate_status, 'pending_submission'), p_mandate_scheme,
            p_next_possible_charge_date, case when p_mandate_status is not null then v_mandate_observed end)
    on conflict (gc_mandate_id) do nothing
    returning id into v_mandate_id;

    if v_mandate_id is null then
      select m.id, m.status, m.status_observed_at into v_mandate
        from public.gocardless_mandates m
       where m.gc_mandate_id = p_gc_mandate_id
       for update;
      v_mandate_id := v_mandate.id;

      if (p_mandate_status is not null or p_mandate_scheme is not null or p_next_possible_charge_date is not null)
         and not (v_mandate.status in ('failed', 'consumed', 'blocked') and p_mandate_status is distinct from v_mandate.status)
         and not (v_mandate.status_observed_at is not null and v_mandate_observed <= v_mandate.status_observed_at) then
        update public.gocardless_mandates m
           set status = coalesce(p_mandate_status, m.status),
               scheme = coalesce(p_mandate_scheme, m.scheme),
               next_possible_charge_date = coalesce(p_next_possible_charge_date, m.next_possible_charge_date),
               status_observed_at = case when p_mandate_status is not null then v_mandate_observed else m.status_observed_at end,
               updated_at = now()
         where m.id = v_mandate_id;
      end if;

      if v_customer_id is not null then
        update public.gocardless_mandates m
           set gocardless_customer_id = v_customer_id
         where m.id = v_mandate_id
           and m.gocardless_customer_id is distinct from v_customer_id;
      end if;
    end if;
  end if;

  return query select v_customer_id, v_mandate_id;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 8. VERIFICATION: a check that failed writes nothing (G8)
--    'unknown' is not an answer from GoCardless -- it is a check that failed, or a value GoCardless has not
--    documented. It never replaces a status GoCardless did give; a known status is written with the time it was
--    read. (A reconnect still starts from 'unknown': store_gocardless_connection resets it, because it has not
--    been checked since.)
-- -----------------------------------------------------------------------------------------------------
create or replace function public.update_gocardless_verification_status(p_club_id uuid, p_status text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_status not in ('action_required', 'in_review', 'successful', 'unknown') then
    raise exception 'Invalid verification status.';
  end if;
  if p_status = 'unknown' then
    return;
  end if;
  update public.gocardless_merchant_connections
  set verification_status = p_status, status_checked_at = now()
  where club_id = p_club_id and disconnected_at is null;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 9. CONNECTING: never strand live Direct Debits at another account; never revoke the token being stored (G6)
--    Redefined from the live definition (20270744000000); the authority check, the queueing of a replaced token,
--    the upsert and the record are unchanged.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.store_gocardless_connection(p_club_id uuid, p_environment text, p_gc_organisation_id text, p_access_token text, p_scope text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_previous public.gocardless_merchant_connections;
begin
  if not (internal.can('finance.gocardless.connect', 'club', p_club_id, null, null)) then
    raise exception 'You are not authorized to connect GoCardless for this club.' using errcode = '42501';
  end if;
  if p_environment not in ('sandbox', 'production') then
    raise exception 'Invalid environment.';
  end if;

  select * into v_previous from public.gocardless_merchant_connections where club_id = p_club_id for update;

  -- A DIFFERENT ACCOUNT OR ENVIRONMENT, WHILE DIRECT DEBITS STILL RUN THROUGH THE OLD ONE, IS REFUSED. Those
  -- mandates and subscriptions belong to the old GoCardless account: they would keep collecting where Ovalball
  -- could no longer see, reconcile or cancel them, and every event about them would fail. Reconnecting the same
  -- account is always allowed, and so is switching once nothing is live there.
  if v_previous.id is not null
     and (v_previous.gc_organisation_id is distinct from p_gc_organisation_id or v_previous.environment is distinct from p_environment)
     and (exists (select 1 from public.gocardless_mandates m
                   where m.club_id = p_club_id
                     and m.status in ('pending_customer_approval', 'pending_submission', 'submitted', 'active', 'suspended_by_payer'))
          or exists (select 1 from public.gocardless_subscriptions s
                      where s.club_id = p_club_id
                        and s.status in ('pending', 'pending_customer_approval', 'active', 'paused'))) then
    raise exception 'This club still has Direct Debits running through the GoCardless account it was connected to before. Reconnect that same GoCardless account, or cancel those Direct Debits first, before connecting a different one.'
      using errcode = '55000';
  end if;

  -- The token being stored is live from now on. A revocation still queued for it (the same token handed back) is
  -- withdrawn, so the drain can never revoke the connection it now belongs to.
  delete from internal.gocardless_token_revocations where access_token = p_access_token;

  -- A live token this connection replaces is revoked, not overwritten and forgotten.
  if v_previous.id is not null and v_previous.access_token is not null and v_previous.access_token is distinct from p_access_token then
    insert into internal.gocardless_token_revocations (club_id, environment, gc_organisation_id, access_token, reason)
    values (p_club_id, v_previous.environment, v_previous.gc_organisation_id, v_previous.access_token, 'replaced by a new connection');
  end if;

  insert into public.gocardless_merchant_connections (club_id, environment, gc_organisation_id, access_token, scope, connected_by)
  values (p_club_id, p_environment, p_gc_organisation_id, p_access_token, p_scope, auth.uid())
  on conflict (club_id) do update set
    environment = excluded.environment,
    gc_organisation_id = excluded.gc_organisation_id,
    access_token = excluded.access_token,
    scope = excluded.scope,
    connected_by = excluded.connected_by,
    connected_at = now(),
    disconnected_at = null,
    disconnected_by = null,
    verification_status = 'unknown',
    status_checked_at = null
  returning id into v_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (auth.uid(), p_club_id, 'gocardless_connected', 'gocardless_merchant_connections', v_id,
          case when v_previous.id is null then null
               else jsonb_build_object('environment', v_previous.environment, 'gc_organisation_id', v_previous.gc_organisation_id,
                                       'disconnected_at', v_previous.disconnected_at) end,
          jsonb_build_object('environment', p_environment, 'gc_organisation_id', p_gc_organisation_id), 'admin_ui');
  perform internal.emit_security_event('payment_provider.connected', auth.uid(), 'SUCCESS', null,
    jsonb_build_object('environment', p_environment, 'gc_organisation_id', p_gc_organisation_id), p_club_id);

  return v_id;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 10. "APP DISCONNECTED" ENDS ONLY A CONNECTION MADE BEFORE IT (G13)
--     Redefined from the live definition; gains p_disconnected_at, the time GoCardless recorded the disconnection
--     (the event's created_at). A connection made after that is a newer one -- the club came back -- and a late
--     delivery or replay of the old event must not end it.
-- -----------------------------------------------------------------------------------------------------
drop function if exists public.record_gocardless_app_disconnected(text);
create or replace function public.record_gocardless_app_disconnected(p_gc_organisation_id text, p_disconnected_at timestamptz default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_conn record;
  v_count integer := 0;
begin
  for v_conn in
    select * from public.gocardless_merchant_connections
     where gc_organisation_id = p_gc_organisation_id
       and disconnected_at is null
       and (p_disconnected_at is null or connected_at <= p_disconnected_at)
     for update
  loop
    update public.gocardless_merchant_connections
       set disconnected_at = now(), disconnected_by = null, access_token = null
     where id = v_conn.id;
    insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
    values (null, v_conn.club_id, 'gocardless_disconnected', 'gocardless_merchant_connections', v_conn.id,
            jsonb_build_object('environment', v_conn.environment, 'gc_organisation_id', v_conn.gc_organisation_id),
            jsonb_build_object('reason', 'The club removed Ovalball from its GoCardless account.'), 'webhook');
    perform internal.emit_security_event('payment_provider.revoked_by_merchant', null, 'SUCCESS', null,
      jsonb_build_object('environment', v_conn.environment, 'gc_organisation_id', v_conn.gc_organisation_id), v_conn.club_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 11. THE SCHEDULE (G1): pg_cron + pg_net + Vault, inert wherever Vault has not been given the two entries
--
--     Operator step, production only, never in a migration or in git (docs/PRODUCTION_HOSTING.md):
--       Vault  gocardless_replay_url     https://<production origin>/api/gocardless/webhooks/replay
--       Vault  gocardless_replay_secret  the same value as the Vercel variable GOCARDLESS_REPLAY_SECRET
-- -----------------------------------------------------------------------------------------------------
create extension if not exists pg_net;

-- Every request the schedule made, and what came back. Durable (pg_net keeps its own answers for hours only);
-- counts and status codes only -- never a response body, never a header.
create table if not exists internal.gocardless_replay_runs (
  id bigint generated always as identity primary key,
  request_id bigint unique,
  requested_at timestamptz not null default now(),
  collected_at timestamptz,
  outcome text check (outcome is null or outcome in ('ok', 'not_ok', 'http_error', 'timed_out', 'network_error', 'no_response', 'refused_insecure_url')),
  status_code integer,
  ok boolean,
  claimed integer,
  replayed integer,
  deferred integer,
  failed integer,
  tokens_revoked integer,
  tokens_failed integer,
  error_message text
);
create index if not exists gocardless_replay_runs_requested_idx on internal.gocardless_replay_runs (requested_at desc);
revoke all on internal.gocardless_replay_runs from public, anon, authenticated;

comment on table internal.gocardless_replay_runs is
  'Each scheduled call of the GoCardless webhook replay route (internal.request_gocardless_replay) and its collected answer (internal.collect_gocardless_replay_responses). Counts and status codes only. Pruned after 30 days.';

-- Asks the replay route to run. Reads the route's address and its bearer secret from Vault, and does nothing at all
-- when either is missing -- so no stack without them (local, CI, a clean boot, a preview) ever calls anything.
create or replace function internal.request_gocardless_replay()
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_url text;
  v_secret text;
  v_request bigint;
begin
  select btrim(s.decrypted_secret) into v_url from vault.decrypted_secrets s where s.name = 'gocardless_replay_url';
  select btrim(s.decrypted_secret) into v_secret from vault.decrypted_secrets s where s.name = 'gocardless_replay_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;
  -- The bearer secret only ever travels over HTTPS. A misconfigured address is recorded, so it is seen.
  if v_url !~* '^https://' then
    insert into internal.gocardless_replay_runs (collected_at, outcome) values (now(), 'refused_insecure_url');
    return null;
  end if;

  select net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds := 300000
  ) into v_request;
  insert into internal.gocardless_replay_runs (request_id) values (v_request);
  return v_request;
end;
$function$;

-- A whole number the replay route reported under p_key, or NULL.
create or replace function internal.gocardless_replay_count(p_body jsonb, p_key text)
 returns integer
 language sql
 immutable
 set search_path to ''
as $function$
  select case when jsonb_typeof(p_body -> p_key) = 'number' then (p_body ->> p_key)::numeric::integer end
$function$;

-- Copies each answer pg_net has collected into the durable log (modelled on internal.collect_venue_geocodes,
-- 20270544000000). A request with no answer six hours on is recorded as having had none; the log keeps 30 days.
create or replace function internal.collect_gocardless_replay_responses()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
  v_body jsonb;
  v_n integer := 0;
begin
  for r in
    select g.id, h.status_code, h.content, h.timed_out, h.error_msg
      from internal.gocardless_replay_runs g
      join net._http_response h on h.id = g.request_id
     where g.collected_at is null
  loop
    begin
      v_body := r.content::jsonb;
    exception when others then
      v_body := null;
    end;
    if jsonb_typeof(v_body) is distinct from 'object' then
      v_body := null;
    end if;

    update internal.gocardless_replay_runs g
       set collected_at = now(),
           status_code = r.status_code,
           ok = coalesce(r.status_code between 200 and 299 and (v_body ->> 'ok') = 'true', false),
           outcome = case
                       when coalesce(r.timed_out, false) then 'timed_out'
                       when r.status_code is null then 'network_error'
                       when r.status_code not between 200 and 299 then 'http_error'
                       when (v_body ->> 'ok') = 'true' then 'ok'
                       else 'not_ok'
                     end,
           claimed = internal.gocardless_replay_count(v_body, 'claimed'),
           replayed = internal.gocardless_replay_count(v_body, 'replayed'),
           deferred = internal.gocardless_replay_count(v_body, 'deferred'),
           failed = internal.gocardless_replay_count(v_body, 'failed'),
           tokens_revoked = internal.gocardless_replay_count(v_body, 'tokensRevoked'),
           tokens_failed = internal.gocardless_replay_count(v_body, 'tokensFailed'),
           error_message = left(r.error_msg, 300)
     where g.id = r.id;
    v_n := v_n + 1;
  end loop;

  update internal.gocardless_replay_runs g
     set collected_at = now(), outcome = 'no_response'
   where g.collected_at is null
     and g.requested_at < now() - interval '6 hours';

  delete from internal.gocardless_replay_runs g where g.requested_at < now() - interval '30 days';

  return v_n;
end;
$function$;

-- pg_cron can only be installed in the single database named by cron.database_name (supabase/tests/
-- pg_cron_portability.sql): install where cron lives, skip where it cannot, and schedule only when the extension
-- is genuinely present. Everything above is complete either way -- the replay route can be called by any other
-- scheduler, and both functions run by hand.
do $$
begin
  if current_database() = nullif(current_setting('cron.database_name', true), '') then
    execute 'create extension if not exists pg_cron';
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'gocardless-webhook-replay') then
      perform cron.unschedule('gocardless-webhook-replay');
    end if;
    perform cron.schedule('gocardless-webhook-replay', '*/10 * * * *', $job$select internal.request_gocardless_replay()$job$);

    -- Five minutes after each request: the replay route has up to five minutes to answer.
    if exists (select 1 from cron.job where jobname = 'collect-gocardless-replay-responses') then
      perform cron.unschedule('collect-gocardless-replay-responses');
    end if;
    perform cron.schedule('collect-gocardless-replay-responses', '5-59/10 * * * *', $job$select internal.collect_gocardless_replay_responses()$job$);
  else
    raise notice 'pg_cron is not installed in %; gocardless-webhook-replay and collect-gocardless-replay-responses were not scheduled.', current_database();
  end if;
end $$;


-- -----------------------------------------------------------------------------------------------------
-- 12. WHAT A FULL SITE ADMIN CAN SEE (G2): counts only
--     Gated like email_delivery_health (a site capability, refused with 42501), and narrowed to the Full Site
--     Admin profile that /admin/system-health itself requires. site.commercial.view is the capability the inbox
--     table's own site-level row policy names; the profile check excludes an add-on holder of it.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.gocardless_inbox_health()
 returns table(
   unprocessed integer,
   stranded integer,
   deferred integer,
   dead_lettered integer,
   oldest_unprocessed_seconds integer,
   revocations_queued integer,
   oldest_revocation_seconds integer,
   max_revocation_attempts integer,
   replay_configured boolean,
   replay_scheduled boolean,
   last_replay_requested_at timestamptz,
   last_replay_collected_at timestamptz,
   last_replay_outcome text,
   last_replay_status_code integer
 )
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_ceiling integer := internal.gocardless_event_attempt_ceiling();
begin
  if not (internal.has_site_capability('site.commercial.view')
          and exists (select 1 from public.site_admins sa
                       where sa.user_id = internal.effective_person()
                         and sa.status = 'active'
                         and sa.profile_key = 'SITE_FULL')) then
    raise exception 'Not authorised to read GoCardless inbox health.' using errcode = '42501';
  end if;

  select count(*)::integer,
         count(*) filter (where e.deferred_at is null
                            and e.dead_lettered_at is null
                            and not (e.attempts >= v_ceiling and coalesce(e.claimed_until, '-infinity'::timestamptz) < now())
                            and coalesce(e.claimed_until, e.last_attempt_at, e.created_at) < now() - interval '30 minutes')::integer,
         count(*) filter (where e.deferred_at is not null and e.dead_lettered_at is null)::integer,
         count(*) filter (where e.dead_lettered_at is not null
                             or (e.deferred_at is null and e.attempts >= v_ceiling
                                 and coalesce(e.claimed_until, '-infinity'::timestamptz) < now()))::integer,
         floor(extract(epoch from now() - min(e.created_at)))::integer
    into unprocessed, stranded, deferred, dead_lettered, oldest_unprocessed_seconds
    from public.gocardless_events e
   where e.processed = false;

  select count(*)::integer,
         floor(extract(epoch from now() - min(r.requested_at)))::integer,
         coalesce(max(r.attempts), 0)::integer
    into revocations_queued, oldest_revocation_seconds, max_revocation_attempts
    from internal.gocardless_token_revocations r;

  replay_configured := exists (select 1 from vault.secrets s where s.name = 'gocardless_replay_url')
                   and exists (select 1 from vault.secrets s where s.name = 'gocardless_replay_secret');
  -- Where pg_cron does not exist (any database but the cron one), nothing is scheduled -- and cron.job is not read.
  replay_scheduled := false;
  if exists (select 1 from pg_catalog.pg_extension x where x.extname = 'pg_cron') then
    replay_scheduled := exists (select 1 from cron.job j where j.jobname = 'gocardless-webhook-replay' and j.active);
  end if;

  select g.requested_at, g.collected_at, g.outcome, g.status_code
    into last_replay_requested_at, last_replay_collected_at, last_replay_outcome, last_replay_status_code
    from internal.gocardless_replay_runs g
   order by g.requested_at desc, g.id desc
   limit 1;

  return next;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 13. WHO MAY CALL WHAT
--     Everything here is the server's (service_role), or the database's own schedule, except the health card,
--     which a signed-in Full Site Admin reads through its own gate.
-- -----------------------------------------------------------------------------------------------------
revoke all on function internal.gocardless_event_attempt_ceiling() from public, anon, authenticated;
revoke all on function internal.gocardless_event_backoff(integer) from public, anon, authenticated;
revoke all on function internal.gocardless_event_club(jsonb) from public, anon, authenticated;
revoke all on function internal.gocardless_replay_count(jsonb, text) from public, anon, authenticated;
revoke all on function internal.request_gocardless_replay() from public, anon, authenticated, service_role;
revoke all on function internal.collect_gocardless_replay_responses() from public, anon, authenticated, service_role;

revoke all on function public.record_gocardless_event(text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.mark_gocardless_event_processed(uuid, text) from public, anon, authenticated;
revoke all on function public.defer_gocardless_event(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_stale_gocardless_events(integer, integer) from public, anon, authenticated;
revoke all on function public.apply_payment_status_transition(text, text, text, date, text, timestamptz) from public, anon, authenticated;
revoke all on function public.record_gocardless_payment_app_fee(text, integer) from public, anon, authenticated;
revoke all on function public.reconcile_gocardless_subscription(uuid, text, text, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reconcile_gocardless_billing_request(uuid, text, text, text, text, text, date, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.update_gocardless_verification_status(uuid, text) from public, anon, authenticated;
revoke all on function public.record_gocardless_app_disconnected(text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_gocardless_event(text, text, text, jsonb, uuid) to service_role;
grant execute on function public.mark_gocardless_event_processed(uuid, text) to service_role;
grant execute on function public.defer_gocardless_event(uuid, uuid, text) to service_role;
grant execute on function public.claim_stale_gocardless_events(integer, integer) to service_role;
grant execute on function public.apply_payment_status_transition(text, text, text, date, text, timestamptz) to service_role;
grant execute on function public.record_gocardless_payment_app_fee(text, integer) to service_role;
grant execute on function public.reconcile_gocardless_subscription(uuid, text, text, text, uuid, timestamptz) to service_role;
grant execute on function public.reconcile_gocardless_billing_request(uuid, text, text, text, text, text, date, timestamptz, timestamptz) to service_role;
grant execute on function public.update_gocardless_verification_status(uuid, text) to service_role;
grant execute on function public.record_gocardless_app_disconnected(text, timestamptz) to service_role;

-- Unchanged: a Club Admin connects through the OAuth callback in their own session.
revoke all on function public.store_gocardless_connection(uuid, text, text, text, text) from public, anon;
grant execute on function public.store_gocardless_connection(uuid, text, text, text, text) to authenticated, service_role;

revoke all on function public.gocardless_inbox_health() from public, anon;
grant execute on function public.gocardless_inbox_health() to authenticated, service_role;


-- -----------------------------------------------------------------------------------------------------
-- 14. SELF-CHECKS
-- -----------------------------------------------------------------------------------------------------
do $$
begin
  -- Scheduled wherever pg_cron is; and wherever it is not, nothing pretends otherwise.
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'gocardless-webhook-replay' and schedule = '*/10 * * * *')
       or not exists (select 1 from cron.job where jobname = 'collect-gocardless-replay-responses') then
      raise exception 'the GoCardless webhook replay is not scheduled';
    end if;
    if exists (select 1 from cron.job where jobname in ('gocardless-webhook-replay', 'collect-gocardless-replay-responses')
                                        and command ~* 'secret|bearer|https?://') then
      raise exception 'a scheduled command carries the replay secret or address; both must be read from Vault at run time';
    end if;
  end if;
  if has_function_privilege('anon', 'public.gocardless_inbox_health()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.defer_gocardless_event(uuid, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_stale_gocardless_events(integer, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_gocardless_payment_app_fee(text, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'internal.request_gocardless_replay()', 'EXECUTE')
     or has_function_privilege('service_role', 'internal.request_gocardless_replay()', 'EXECUTE') then
    raise exception 'a GoCardless inbox function is executable by a role that must not run it';
  end if;
  if has_table_privilege('authenticated', 'internal.gocardless_replay_runs', 'SELECT') then
    raise exception 'the replay log is readable by a signed-in role';
  end if;
  if internal.gocardless_event_backoff(1) <> interval '5 minutes'
     or internal.gocardless_event_backoff(2) <> interval '10 minutes'
     or internal.gocardless_event_backoff(19) <> interval '6 hours' then
    raise exception 'the GoCardless event back-off is not 5 minutes doubling to a 6 hour cap';
  end if;
end $$;
