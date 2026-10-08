-- A PLATFORM-BILLING EVENT IS NEVER ACKNOWLEDGED AND LOST.
--
-- The release operations review of 8 October 2026 found that Ovalball's own billing webhook
-- (app/api/platform-billing/webhooks) answered 200 whatever happened: an event whose inbox write was refused --
-- a database outage, or the release's read-only maintenance window -- was acknowledged and gone, because
-- GoCardless does not redeliver an acknowledged event. Answering 500 instead is not enough on its own, because the
-- inbox was not claimable: an event recorded on one delivery whose processing then failed was SKIPPED by every
-- redelivery (the insert conflicted and returned null), so it was stranded unprocessed for good.
--
-- This gives platform_provider_events the claim the member-payments inbox has had since 20270744000000:
--
--   record_platform_provider_event   returns the event's id when THIS delivery should process it: a new event,
--                                    or one recorded before that is still unprocessed and not held by a live
--                                    claim (two minutes). NULL otherwise. Same signature as before.
--   platform_provider_event_processed  whether an event is recorded AND processed -- the only state in which the
--                                    route may acknowledge a delivery it did not process itself. NULL when the
--                                    event has never been recorded.
--   claim_platform_provider_event    the same claim, returning its generation (the claim's owner)
--   platform_provider_event_claim_held  whether a delivery still owns its claim (diagnostic)
--   apply_platform_payment_status_for_event / attach_platform_subscription_provider_for_event
--                                    the state writes, fenced by the claim in the same transaction
--   mark_platform_provider_event_processed  success marks it processed and releases the claim; a failure keeps it
--                                    unprocessed WITH its reason and releases the claim, so the next delivery takes
--                                    it again. Only the claim's owner may do either; a failure never un-processes an
--                                    event already marked processed (a success whose answer was lost in transit
--                                    must not be run twice).
--
-- Nothing here reaches outside the database. Proved by supabase/tests/platform_gocardless.sql and
-- supabase/tests/js/platform_billing_webhook.test.mts (the real route handler against the database).

alter table public.platform_provider_events
  add column if not exists attempts integer not null default 1,
  add column if not exists claimed_until timestamptz,
  add column if not exists last_attempt_at timestamptz;

comment on column public.platform_provider_events.attempts is 'Deliveries that claimed this event (the first included).';
comment on column public.platform_provider_events.claimed_until is 'A delivery is processing this event until then; another delivery neither takes it nor acknowledges it.';

-- THE CLAIM HAS AN OWNER. `attempts` is the claim's generation: every claim increments it, and the delivery that
-- made the claim gets that number back. Completion, failure and every state write check it, so a delivery that
-- stalled past its two-minute lease (a slow provider call) can neither clear its successor's claim nor mark the
-- event, and the route refuses to apply state once its claim is gone (the independent review of 8 Oct 2026).
create or replace function public.claim_platform_provider_event(
  p_provider_event_id text,
  p_resource_type text,
  p_action text,
  p_payload jsonb
)
returns table (event_id uuid, claim_generation integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  insert into public.platform_provider_events as e (provider_event_id, resource_type, action, payload, attempts, claimed_until, last_attempt_at)
  values (p_provider_event_id, p_resource_type, p_action, p_payload, 1, now() + interval '2 minutes', now())
  on conflict (provider, provider_event_id) do update
     set attempts = e.attempts + 1,
         claimed_until = now() + interval '2 minutes',
         last_attempt_at = now()
   where e.processed = false
     and (e.claimed_until is null or e.claimed_until < now())
  returning e.id, e.attempts;
end;
$$;

-- The earlier interface, kept with its signature so the route deployed before this migration keeps working until
-- the cutover replaces it. Same claim; the generation is simply not returned.
create or replace function public.record_platform_provider_event(
  p_provider_event_id text,
  p_resource_type text,
  p_action text,
  p_payload jsonb
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select c.event_id from public.claim_platform_provider_event(p_provider_event_id, p_resource_type, p_action, p_payload) c;
$$;

create or replace function public.platform_provider_event_processed(p_provider_event_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select e.processed
    from public.platform_provider_events e
   where e.provider = 'gocardless' and e.provider_event_id = p_provider_event_id;
$$;

-- Whether this delivery still holds its claim: same generation, unprocessed, lease not lapsed.
create or replace function public.platform_provider_event_claim_held(p_event_id uuid, p_claim_generation integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select e.attempts = p_claim_generation and not e.processed and e.claimed_until > now()
      from public.platform_provider_events e
     where e.id = p_event_id), false);
$$;

-- Success marks it processed and releases the claim; a failure keeps it unprocessed WITH its reason and releases
-- the claim, so the next delivery takes it again. With a generation, only that claim's owner may do either. A
-- failure never un-processes an event already marked processed (a success whose answer was lost in transit must
-- not be run twice). Returns whether the mark was applied.
drop function if exists public.mark_platform_provider_event_processed(uuid, text);
create function public.mark_platform_provider_event_processed(
  p_event_id uuid,
  p_error text default null,
  p_claim_generation integer default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  update public.platform_provider_events
     set processed = (p_error is null),
         processed_at = case when p_error is null then now() else processed_at end,
         processing_error = p_error,
         claimed_until = null
   where id = p_event_id
     and (p_claim_generation is null or attempts = p_claim_generation)
     and processed = false;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- THE STATE WRITES ARE FENCED BY THE CLAIM, IN THEIR OWN TRANSACTION. A check in one call and the write in another
-- leaves a gap: a delivery could pass the check, stall, lose its lease to a successor that applies newer state, and
-- then overwrite it. These two wrappers lock the event row, check that the caller's generation still holds a live
-- claim, and only then make the write -- all in one transaction. A successor's claim is an UPDATE of the same row, so
-- it waits for this transaction, and a write that starts after the successor's claim sees the new generation and is
-- refused (SQLSTATE PT409, message 'platform_event_claim_lost'). The route uses only these for state.
create or replace function internal.assert_platform_event_claim(p_event_id uuid, p_claim_generation integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  select e.attempts = p_claim_generation and not e.processed and e.claimed_until > now()
    into v_ok
    from public.platform_provider_events e
   where e.id = p_event_id
   for update;
  if not coalesce(v_ok, false) then
    raise exception 'platform_event_claim_lost' using errcode = 'PT409';
  end if;
end;
$$;
revoke all on function internal.assert_platform_event_claim(uuid, integer) from public, anon, authenticated;

create or replace function public.apply_platform_payment_status_for_event(
  p_event_id uuid,
  p_claim_generation integer,
  p_payment_id uuid,
  p_status text,
  p_provider_payment_id text default null,
  p_failure_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform internal.assert_platform_event_claim(p_event_id, p_claim_generation);
  return public.apply_platform_payment_status(p_payment_id, p_status, p_provider_payment_id, p_failure_reason);
end;
$$;

create or replace function public.attach_platform_subscription_provider_for_event(
  p_event_id uuid,
  p_claim_generation integer,
  p_club_id uuid,
  p_environment text,
  p_customer_id text default null,
  p_mandate_id text default null,
  p_mandate_status text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  perform internal.assert_platform_event_claim(p_event_id, p_claim_generation);
  return public.attach_platform_subscription_provider(p_club_id, p_environment, p_customer_id, p_mandate_id, null, null, p_mandate_status);
end;
$$;

revoke all on function public.apply_platform_payment_status_for_event(uuid, integer, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.attach_platform_subscription_provider_for_event(uuid, integer, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_platform_payment_status_for_event(uuid, integer, uuid, text, text, text) to service_role;
grant execute on function public.attach_platform_subscription_provider_for_event(uuid, integer, uuid, text, text, text, text) to service_role;

-- COMPATIBILITY, AND ITS LIMIT. `record_platform_provider_event` and a mark without a generation remain only so the
-- route deployed before this migration keeps working until the cutover replaces it; that route is not fenced. The
-- release applies this migration inside the maintenance window, where the gate refuses every API write, and deploys
-- the new route before reopening -- so the unfenced path never runs against an open database. Nothing new may call
-- them.

revoke all on function public.claim_platform_provider_event(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_platform_provider_event(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.platform_provider_event_processed(text) from public, anon, authenticated;
revoke all on function public.platform_provider_event_claim_held(uuid, integer) from public, anon, authenticated;
revoke all on function public.mark_platform_provider_event_processed(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_platform_provider_event(text, text, text, jsonb) to service_role;
grant execute on function public.record_platform_provider_event(text, text, text, jsonb) to service_role;
grant execute on function public.platform_provider_event_processed(text) to service_role;
grant execute on function public.platform_provider_event_claim_held(uuid, integer) to service_role;
grant execute on function public.mark_platform_provider_event_processed(uuid, text, integer) to service_role;
