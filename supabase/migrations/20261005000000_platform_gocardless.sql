-- Commercial Platform, Phase G -- the provider side of Ovalball's own
-- billing.
--
-- Domain B collects through **Ovalball's own GoCardless merchant**, with a
-- single platform access token and a single webhook endpoint. Domain A
-- collects through **each club's connected merchant**, with a per-club
-- OAuth token and its own webhook endpoint. They share the HTTP transport
-- and the HMAC signature check -- pure mechanics with no business meaning
-- -- and nothing else. Separate credentials, separate endpoints, separate
-- inboxes, separate tables.
--
-- Nothing in this migration enables production collection. The two-flag
-- go-live gate in lib/payments/gocardless/env.ts still applies, and the
-- platform token has its own separate variable that is unset everywhere.

-- ---------------------------------------------------------------------
-- 1. Provider references on the subscription
-- ---------------------------------------------------------------------

alter table public.platform_club_subscriptions
  add column if not exists provider text,
  add column if not exists provider_environment text,
  add column if not exists provider_customer_id text,
  add column if not exists provider_mandate_id text,
  add column if not exists provider_subscription_id text,
  add column if not exists provider_billing_request_id text,
  add column if not exists mandate_status text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'platform_club_subscriptions_provider_check') then
    alter table public.platform_club_subscriptions
      add constraint platform_club_subscriptions_provider_check
      check (provider is null or provider = 'gocardless');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'platform_club_subscriptions_provider_env_check') then
    alter table public.platform_club_subscriptions
      add constraint platform_club_subscriptions_provider_env_check
      check (provider_environment is null or provider_environment in ('sandbox', 'production'));
  end if;

  -- A club cannot be scheduled or active without a mandate to collect
  -- against. This is the structural reason a subscription cannot start
  -- billing on a hopeful assumption.
  if not exists (select 1 from pg_constraint where conname = 'platform_club_subscriptions_live_needs_mandate') then
    alter table public.platform_club_subscriptions
      add constraint platform_club_subscriptions_live_needs_mandate
      check (status not in ('scheduled', 'active', 'past_due') or provider_mandate_id is not null);
  end if;
end;
$$;

create unique index if not exists platform_club_subscriptions_provider_mandate_idx
  on public.platform_club_subscriptions (provider, provider_mandate_id)
  where provider_mandate_id is not null;

create unique index if not exists platform_club_subscriptions_provider_subscription_idx
  on public.platform_club_subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;

-- A cycle that credit covers entirely is neither collected nor cancelled;
-- it is skipped. Recording it as 'cancelled' would read, in a club's own
-- billing history, as though Ovalball had called off a collection it
-- intended to make.
alter table public.platform_payments drop constraint if exists platform_payments_status_check;
alter table public.platform_payments add constraint platform_payments_status_check
  check (status in ('pending', 'submitted', 'confirmed', 'failed', 'cancelled', 'skipped'));

-- ---------------------------------------------------------------------
-- 2. The Domain B webhook inbox
-- ---------------------------------------------------------------------

-- Deliberately NOT `gocardless_events`, which is Domain A's inbox for
-- club-merchant events. A shared inbox would be the single easiest way for
-- one domain's event to be reconciled against the other's tables.
create table if not exists public.platform_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'gocardless',

  -- The provider's own event id. Unique, and that uniqueness is the whole
  -- replay defence: a redelivered webhook finds the row already there and
  -- does nothing.
  provider_event_id text not null,

  resource_type text not null,
  action text not null,
  payload jsonb not null,

  received_at timestamptz not null default now(),
  processed boolean not null default false,
  processed_at timestamptz,
  processing_error text,

  constraint platform_provider_events_provider_check check (provider = 'gocardless'),
  constraint platform_provider_events_unique_event unique (provider, provider_event_id)
);

create index if not exists platform_provider_events_unprocessed_idx
  on public.platform_provider_events (received_at) where not processed;

alter table public.platform_provider_events enable row level security;

-- Site Admins only. A club has no business reading raw provider payloads,
-- and the payload can name Ovalball's own merchant objects.
drop policy if exists platform_provider_events_select on public.platform_provider_events;
create policy platform_provider_events_select on public.platform_provider_events
  for select using (internal.is_site_admin());

drop trigger if exists audit_row_change on public.platform_provider_events;
create trigger audit_row_change
  after insert or update or delete on public.platform_provider_events
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 3. Server-only transitions
-- ---------------------------------------------------------------------
--
-- Everything below runs from the webhook route or a scheduled job under
-- the service role. None of it is reachable from a browser session: these
-- functions move money state.
--
-- `revoke ... from public` is NOT enough on its own. Supabase's default
-- privileges grant EXECUTE on every new function in `public` directly to
-- `anon` and `authenticated`, and revoking from PUBLIC leaves those two
-- explicit grants in place. Each revoke below therefore names all three.
-- The Phase G test suite asserts the resulting ACL rather than trusting
-- that the revoke did what it looked like it did.

-- Records an inbound event. Returns the new row's id, or null when the
-- event has already been seen -- which is how the caller knows to skip.
create or replace function public.record_platform_provider_event(
  p_provider_event_id text,
  p_resource_type text,
  p_action text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.platform_provider_events (provider_event_id, resource_type, action, payload)
  values (p_provider_event_id, p_resource_type, p_action, p_payload)
  on conflict (provider, provider_event_id) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_platform_provider_event(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_platform_provider_event(text, text, text, jsonb) to service_role;

create or replace function public.mark_platform_provider_event_processed(
  p_event_id uuid,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.platform_provider_events
  set processed = (p_error is null),
      processed_at = case when p_error is null then now() else processed_at end,
      processing_error = p_error
  where id = p_event_id;
$$;

revoke execute on function public.mark_platform_provider_event_processed(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_platform_provider_event_processed(uuid, text) to service_role;

-- Attaching the provider's objects to a subscription once a mandate is in
-- place. The environment is recorded with them, so a sandbox mandate can
-- never be mistaken for a production one.
create or replace function public.attach_platform_subscription_provider(
  p_club_id uuid,
  p_environment text,
  p_customer_id text default null,
  p_mandate_id text default null,
  p_subscription_id text default null,
  p_billing_request_id text default null,
  p_mandate_status text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub record;
  v_new_status text;
begin
  if p_environment not in ('sandbox', 'production') then
    raise exception 'Unknown provider environment: %.', p_environment;
  end if;

  select id, status, provider_environment into v_sub
  from public.platform_club_subscriptions
  where club_id = p_club_id
  for update;

  if v_sub.id is null then
    raise exception 'This club has no Ovalball subscription to attach a mandate to.';
  end if;

  -- A subscription that already carries sandbox references must never be
  -- silently promoted to production, or the other way round.
  if v_sub.provider_environment is not null and v_sub.provider_environment <> p_environment then
    raise exception 'This subscription is bound to the % environment and cannot be re-attached to %.',
      v_sub.provider_environment, p_environment;
  end if;

  -- A confirmed mandate is what moves the subscription out of setup. Any
  -- other status leaves it exactly where it was.
  v_new_status := case
    when v_sub.status = 'pending_setup' and p_mandate_id is not null and p_mandate_status = 'active'
      then 'scheduled'
    else v_sub.status
  end;

  update public.platform_club_subscriptions
  set provider = 'gocardless',
      provider_environment = p_environment,
      provider_customer_id = coalesce(p_customer_id, provider_customer_id),
      provider_mandate_id = coalesce(p_mandate_id, provider_mandate_id),
      provider_subscription_id = coalesce(p_subscription_id, provider_subscription_id),
      provider_billing_request_id = coalesce(p_billing_request_id, provider_billing_request_id),
      mandate_status = coalesce(p_mandate_status, mandate_status),
      status = v_new_status
  where id = v_sub.id;

  if v_new_status <> v_sub.status then
    perform internal.record_subscription_event(p_club_id, v_sub.id, 'setup_completed', v_sub.status, v_new_status, null);
  end if;

  return v_sub.id;
end;
$$;

revoke execute on function public.attach_platform_subscription_provider(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.attach_platform_subscription_provider(uuid, text, text, text, text, text, text) to service_role;

-- Opening a billing cycle. The idempotency key is the cycle's identity, so
-- running the same cycle twice returns the same payment rather than
-- collecting twice. Credit is applied here, and a cycle that comes to
-- nothing is recorded as skipped rather than sent to the bank as zero.
create or replace function public.open_platform_billing_cycle(
  p_club_id uuid,
  p_charge_date date,
  p_idempotency_key text
)
returns table (payment_id uuid, net_pence int, skipped boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub record;
  v_existing record;
  v_balance int;
  v_applied int;
  v_payment uuid;
begin
  select id, plan_price_pence, plan_currency, status
  into v_sub
  from public.platform_club_subscriptions
  where club_id = p_club_id
  for update;

  if v_sub.id is null or v_sub.status not in ('scheduled', 'active', 'past_due') then
    raise exception 'This club has no collectable Ovalball subscription.';
  end if;

  -- Beta means Ovalball is not charging clubs. A cycle must not open at
  -- all, rather than opening and being cancelled afterwards.
  if coalesce(internal.current_platform_mode(), 'beta') <> 'live' then
    raise exception 'Ovalball is in Beta and is not charging clubs.';
  end if;

  -- Columns are qualified because this function's OUT parameters share
  -- their names; an unqualified `net_pence` here is ambiguous.
  select pp.id, pp.net_pence into v_existing
  from public.platform_payments pp
  where pp.idempotency_key = p_idempotency_key;

  if v_existing.id is not null then
    return query select v_existing.id, v_existing.net_pence, false;
    return;
  end if;

  select coalesce(sum(amount_pence), 0)::int into v_balance
  from public.platform_credits where club_id = p_club_id;

  v_applied := least(greatest(v_balance, 0), v_sub.plan_price_pence);

  insert into public.platform_payments (
    club_id, subscription_id, gross_pence, credit_applied_pence, net_pence,
    currency, status, charge_date, provider, idempotency_key
  )
  values (
    p_club_id, v_sub.id, v_sub.plan_price_pence, v_applied, v_sub.plan_price_pence - v_applied,
    v_sub.plan_currency,
    case when v_sub.plan_price_pence - v_applied = 0 then 'skipped' else 'pending' end,
    p_charge_date, 'gocardless', p_idempotency_key
  )
  returning id into v_payment;

  if v_applied > 0 then
    insert into public.platform_credits (club_id, amount_pence, source, reason, applied_to_payment_id)
    values (p_club_id, -v_applied, 'application', 'Applied to the Ovalball subscription collection.', v_payment);
  end if;

  if v_sub.plan_price_pence - v_applied = 0 then
    perform internal.record_subscription_event(
      p_club_id, v_sub.id, 'cycle_skipped', v_sub.status, v_sub.status,
      'Credit covered the whole cycle, so no collection was sent to the bank.'
    );
    return query select v_payment, 0, true;
    return;
  end if;

  return query select v_payment, v_sub.plan_price_pence - v_applied, false;
end;
$$;

revoke execute on function public.open_platform_billing_cycle(uuid, date, text) from public, anon, authenticated;
grant execute on function public.open_platform_billing_cycle(uuid, date, text) to service_role;

-- The one place a platform payment's status changes. Terminal states are
-- terminal: a redelivered webhook cannot move a confirmed payment back to
-- pending, and cannot confirm it twice.
create or replace function public.apply_platform_payment_status(
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
declare
  v_payment record;
  v_sub record;
begin
  if p_status not in ('pending', 'submitted', 'confirmed', 'failed', 'cancelled', 'skipped') then
    raise exception 'Unknown payment status: %.', p_status;
  end if;

  select id, club_id, subscription_id, status into v_payment
  from public.platform_payments
  where id = p_payment_id
  for update;

  if v_payment.id is null then
    return false;
  end if;

  -- Already where it is being asked to go, or already finished. Either
  -- way, nothing happens and nothing is recorded twice.
  if v_payment.status = p_status or v_payment.status in ('confirmed', 'failed', 'cancelled', 'skipped') then
    return false;
  end if;

  update public.platform_payments
  set status = p_status,
      provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id),
      confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
      failed_at = case when p_status = 'failed' then now() else failed_at end,
      failure_reason = case when p_status = 'failed' then p_failure_reason else failure_reason end
  where id = p_payment_id;

  select id, status into v_sub
  from public.platform_club_subscriptions
  where id = v_payment.subscription_id
  for update;

  if p_status = 'confirmed' then
    if v_sub.status in ('scheduled', 'past_due') then
      update public.platform_club_subscriptions
      set status = 'active',
          started_at = coalesce(started_at, now())
      where id = v_sub.id;
      perform internal.record_subscription_event(v_payment.club_id, v_sub.id,
        case when v_sub.status = 'past_due' then 'recovered' else 'activated' end,
        v_sub.status, 'active', null);
    end if;
    perform internal.record_subscription_event(v_payment.club_id, v_sub.id, 'payment_confirmed', v_sub.status, null, null);

  elsif p_status = 'failed' then
    if v_sub.status = 'active' then
      update public.platform_club_subscriptions set status = 'past_due' where id = v_sub.id;
      perform internal.record_subscription_event(v_payment.club_id, v_sub.id, 'past_due', v_sub.status, 'past_due', p_failure_reason);
    end if;
    perform internal.record_subscription_event(v_payment.club_id, v_sub.id, 'payment_failed', v_sub.status, null, p_failure_reason);

    -- Credit spent on a collection that never landed goes back. Recorded
    -- as a reversal row rather than by deleting the application, because
    -- the ledger is append-only and "we took it and gave it back" is the
    -- true history.
    insert into public.platform_credits (club_id, amount_pence, source, reason, reverses_credit_id)
    select v_payment.club_id, -c.amount_pence, 'reversal',
           'The collection this credit was applied to failed.', c.id
    from public.platform_credits c
    where c.applied_to_payment_id = p_payment_id
      and c.source = 'application'
      and not exists (select 1 from public.platform_credits r where r.reverses_credit_id = c.id);
  end if;

  return true;
end;
$$;

revoke execute on function public.apply_platform_payment_status(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_platform_payment_status(uuid, text, text, text) to service_role;

-- A reversal returns credit, so it is a POSITIVE ledger row. The
-- constraint written in Phase F assumed a reversal always removed credit;
-- that is only true of reversing an *earning*. Reversing an *application*
-- gives credit back.
alter table public.platform_credits drop constraint if exists platform_credits_reversal_is_negative;
alter table public.platform_credits drop constraint if exists platform_credits_reversal_needs_target;
alter table public.platform_credits add constraint platform_credits_reversal_needs_target
  check (source <> 'reversal' or reverses_credit_id is not null);

-- ---------------------------------------------------------------------
-- 4. Locking the internal state helpers
-- ---------------------------------------------------------------------
--
-- The `internal` schema is not exposed through PostgREST, so none of these
-- is reachable from the API today. That is a configuration, though, and
-- these functions are SECURITY DEFINER with no authorisation check of
-- their own -- they trust the public function that calls them. Removing
-- the grant makes the protection a privilege rather than a setting.
--
-- Deliberately NOT revoked from `authenticated`: `internal.has_capability`
-- and `internal.is_site_admin`, which are evaluated inside RLS policies
-- **as the querying role**. Revoking those would break every policy in the
-- product.
revoke execute on function internal.pause_trial_row(uuid, text) from public, anon, authenticated;
revoke execute on function internal.resume_trial_row(uuid, text) from public, anon, authenticated;
revoke execute on function internal.apply_platform_mode_to_trials(text) from public, anon, authenticated;
revoke execute on function internal.process_due_trials() from public, anon, authenticated;
revoke execute on function internal.record_subscription_event(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function internal.notify_club_platform_billing(uuid, text, text, text, jsonb) from public, anon, authenticated;
