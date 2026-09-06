-- Commercial Platform, Phase F -- a club's subscription to Ovalball.
--
-- This is Domain B: Pipaxon collecting from rugby clubs. It shares nothing
-- with `club_subscription_*` / `gocardless_*` / `membership_obligations`,
-- which are a club collecting from its own members. No foreign key, no
-- shared payment row, no shared webhook, ever. The `platform_` prefix is
-- what makes that visible in every query and policy.
--
-- No provider is wired here. Phase G attaches GoCardless; this phase is the
-- domain the provider will report into, so that the lifecycle is testable
-- before any money can move.

-- ---------------------------------------------------------------------
-- 1. The subscription
-- ---------------------------------------------------------------------

create table if not exists public.platform_club_subscriptions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null unique references public.clubs(id) on delete cascade,

  plan_code text not null references public.platform_plans(code),

  -- Snapshotted at selection. A later price change must not rewrite what
  -- this club agreed to pay, so nothing reads platform_plans.price_pence to
  -- decide what to collect.
  plan_price_pence int not null,
  plan_currency text not null default 'GBP',
  plan_price_version int not null,

  status text not null default 'pending_setup',

  started_at timestamptz,
  current_period_start date,
  current_period_end date,
  next_collection_on date,

  cancel_requested_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint platform_club_subscriptions_status_check check (
    status in ('pending_setup', 'scheduled', 'active', 'past_due', 'cancelled', 'ended')
  ),
  constraint platform_club_subscriptions_price_not_negative check (plan_price_pence >= 0),
  constraint platform_club_subscriptions_currency_check check (plan_currency = 'GBP'),
  constraint platform_club_subscriptions_period_ordered check (
    current_period_start is null or current_period_end is null or current_period_end > current_period_start
  ),
  constraint platform_club_subscriptions_ended_has_date check (
    status <> 'ended' or cancelled_at is not null
  )
);

create index if not exists platform_club_subscriptions_status_idx
  on public.platform_club_subscriptions (status);
create index if not exists platform_club_subscriptions_next_collection_idx
  on public.platform_club_subscriptions (next_collection_on)
  where status in ('scheduled', 'active', 'past_due');

alter table public.platform_club_subscriptions enable row level security;

drop policy if exists platform_club_subscriptions_select on public.platform_club_subscriptions;
create policy platform_club_subscriptions_select on public.platform_club_subscriptions
  for select
  using (internal.has_capability('club.platform_billing.view', 'club', club_id) or internal.is_site_admin());

-- No INSERT, UPDATE or DELETE policy. Every transition goes through a
-- function, exactly as with platform_trials, so lifecycle rules and price
-- snapshots have one implementation.

drop trigger if exists set_updated_at on public.platform_club_subscriptions;
create trigger set_updated_at
  before update on public.platform_club_subscriptions
  for each row execute function set_updated_at();

drop trigger if exists audit_row_change on public.platform_club_subscriptions;
create trigger audit_row_change
  after insert or update or delete on public.platform_club_subscriptions
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 2. Lifecycle events -- append-only
-- ---------------------------------------------------------------------

create table if not exists public.platform_subscription_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  club_id uuid not null references public.clubs(id) on delete cascade,
  subscription_id uuid references public.platform_club_subscriptions(id) on delete set null,

  event_type text not null,
  previous_status text,
  new_status text,

  -- What the terms were at the moment of the event, so history reads
  -- correctly however prices move afterwards.
  plan_code text,
  plan_price_pence int,
  plan_currency text,
  plan_price_version int,

  reason text,
  actor uuid references auth.users(id),
  occurred_at timestamptz not null default now(),

  constraint platform_subscription_events_type_check check (
    event_type in (
      'plan_selected', 'plan_changed', 'setup_completed', 'activated',
      'payment_confirmed', 'payment_failed', 'past_due', 'recovered',
      'cancel_requested', 'cancelled', 'ended', 'cycle_skipped'
    )
  )
);

create index if not exists platform_subscription_events_club_idx
  on public.platform_subscription_events (club_id, seq desc);

alter table public.platform_subscription_events enable row level security;

drop policy if exists platform_subscription_events_select on public.platform_subscription_events;
create policy platform_subscription_events_select on public.platform_subscription_events
  for select
  using (internal.has_capability('club.platform_billing.view', 'club', club_id) or internal.is_site_admin());

create or replace function internal.platform_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'This is an append-only commercial record. Write a new row instead of altering an old one.'
    using errcode = '42501';
end;
$$;

drop trigger if exists platform_subscription_events_append_only on public.platform_subscription_events;
create trigger platform_subscription_events_append_only
  before update or delete on public.platform_subscription_events
  for each row execute function internal.platform_append_only();

drop trigger if exists audit_row_change on public.platform_subscription_events;
create trigger audit_row_change
  after insert on public.platform_subscription_events
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 3. Payments (Ovalball's own merchant)
-- ---------------------------------------------------------------------

create table if not exists public.platform_payments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  subscription_id uuid not null references public.platform_club_subscriptions(id) on delete cascade,

  -- What the plan cost, what credit was taken off, and what is actually
  -- collected. Kept as three columns rather than one, because "we charged
  -- you £15 and applied £15 of credit" and "we charged you nothing" are
  -- different facts and a club is entitled to see which happened.
  gross_pence int not null,
  credit_applied_pence int not null default 0,
  net_pence int not null,
  currency text not null default 'GBP',

  status text not null default 'pending',
  charge_date date,
  confirmed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,

  -- Provider columns. Phase G populates them; nothing here assumes a
  -- provider exists.
  provider text,
  provider_payment_id text,

  -- The exactly-once key for a billing cycle. Two runs of the same cycle
  -- produce one payment row, not two.
  idempotency_key text not null unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint platform_payments_status_check check (
    status in ('pending', 'submitted', 'confirmed', 'failed', 'cancelled')
  ),
  constraint platform_payments_currency_check check (currency = 'GBP'),
  constraint platform_payments_amounts_not_negative check (
    gross_pence >= 0 and credit_applied_pence >= 0 and net_pence >= 0
  ),
  constraint platform_payments_amounts_add_up check (net_pence = gross_pence - credit_applied_pence),
  constraint platform_payments_provider_check check (provider is null or provider = 'gocardless'),
  constraint platform_payments_confirmed_has_time check (status <> 'confirmed' or confirmed_at is not null)
);

create unique index if not exists platform_payments_provider_id_idx
  on public.platform_payments (provider, provider_payment_id)
  where provider_payment_id is not null;

create index if not exists platform_payments_club_idx
  on public.platform_payments (club_id, charge_date desc);

alter table public.platform_payments enable row level security;

drop policy if exists platform_payments_select on public.platform_payments;
create policy platform_payments_select on public.platform_payments
  for select
  using (internal.has_capability('club.platform_billing.view', 'club', club_id) or internal.is_site_admin());

drop trigger if exists set_updated_at on public.platform_payments;
create trigger set_updated_at
  before update on public.platform_payments
  for each row execute function set_updated_at();

drop trigger if exists audit_row_change on public.platform_payments;
create trigger audit_row_change
  after insert or update or delete on public.platform_payments
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 4. The credit ledger -- append-only, never a mutable counter
-- ---------------------------------------------------------------------

-- A club's credit balance is the sum of its ledger rows. There is no
-- `free_months` column to decrement, because a counter loses the answer to
-- "where did this come from" the moment it is wrong, and a reversal has
-- nowhere to live.
create table if not exists public.platform_credits (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  club_id uuid not null references public.clubs(id) on delete cascade,

  -- Positive earns credit, negative spends or reverses it.
  amount_pence int not null,
  currency text not null default 'GBP',

  source text not null,
  reason text,

  -- What the reward was worth when it was earned (section 41). A later
  -- price change cannot rewrite an earned reward, because nothing reads the
  -- current price to value a historical row.
  snapshot_plan_code text references public.platform_plans(code),
  snapshot_price_pence int,
  snapshot_price_version int,

  applied_to_payment_id uuid references public.platform_payments(id) on delete restrict,
  reverses_credit_id uuid references public.platform_credits(id) on delete restrict,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),

  constraint platform_credits_source_check check (
    source in ('referral_reward', 'goodwill', 'beta_adjustment', 'application', 'reversal')
  ),
  constraint platform_credits_currency_check check (currency = 'GBP'),
  constraint platform_credits_amount_not_zero check (amount_pence <> 0),
  constraint platform_credits_application_is_negative check (
    source <> 'application' or (amount_pence < 0 and applied_to_payment_id is not null)
  ),
  constraint platform_credits_reversal_is_negative check (
    source <> 'reversal' or (amount_pence < 0 and reverses_credit_id is not null)
  ),
  constraint platform_credits_earning_is_positive check (
    source in ('application', 'reversal') or amount_pence > 0
  )
);

-- Exactly once: a payment can have at most one credit application, and a
-- credit can be reversed at most once.
create unique index if not exists platform_credits_one_application_per_payment
  on public.platform_credits (applied_to_payment_id)
  where source = 'application';

create unique index if not exists platform_credits_one_reversal_per_credit
  on public.platform_credits (reverses_credit_id)
  where source = 'reversal';

create index if not exists platform_credits_club_idx on public.platform_credits (club_id, seq desc);

alter table public.platform_credits enable row level security;

drop policy if exists platform_credits_select on public.platform_credits;
create policy platform_credits_select on public.platform_credits
  for select
  using (internal.has_capability('club.platform_billing.view', 'club', club_id) or internal.is_site_admin());

drop trigger if exists platform_credits_append_only on public.platform_credits;
create trigger platform_credits_append_only
  before update or delete on public.platform_credits
  for each row execute function internal.platform_append_only();

drop trigger if exists audit_row_change on public.platform_credits;
create trigger audit_row_change
  after insert on public.platform_credits
  for each row execute function internal.audit_row_change();

-- A club can never spend credit it does not have. Checked inside the
-- insert, against the ledger, rather than against a cached balance.
create or replace function internal.platform_credits_no_overspend()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_balance int;
begin
  if new.amount_pence >= 0 then
    return new;
  end if;

  select coalesce(sum(amount_pence), 0) into v_balance
  from public.platform_credits
  where club_id = new.club_id;

  if v_balance + new.amount_pence < 0 then
    raise exception 'A club cannot spend more credit than it holds (balance %p, requested %p).',
      v_balance, -new.amount_pence using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists platform_credits_no_overspend on public.platform_credits;
create trigger platform_credits_no_overspend
  before insert on public.platform_credits
  for each row execute function internal.platform_credits_no_overspend();

create or replace function public.club_credit_balance_pence(p_club_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(c.amount_pence), 0)::int
  from public.platform_credits c
  where c.club_id = p_club_id
    and (internal.has_capability('club.platform_billing.view', 'club', c.club_id) or internal.is_site_admin());
$$;

-- ---------------------------------------------------------------------
-- 5. The effective plan, now that subscriptions exist
-- ---------------------------------------------------------------------

-- Phase E promised this would be the only function that needed changing.
-- A subscription wins over a trial. `past_due` and `cancelled` still grant
-- the product: a failed payment is a dunning conversation, not a reason to
-- lock a club out of its own fixtures mid-season, and a cancelled
-- subscription runs to the end of the period the club paid for.
create or replace function internal.club_effective_plan(p_club_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select s.plan_code
      from public.platform_club_subscriptions s
      where s.club_id = p_club_id
        and s.status in ('scheduled', 'active', 'past_due', 'cancelled')
    ),
    (
      select 'standard'
      where exists (
        select 1 from public.platform_trials t
        where t.club_id = p_club_id and t.status in ('active', 'paused')
      )
    )
  );
$$;

-- ---------------------------------------------------------------------
-- 6. Transitions
-- ---------------------------------------------------------------------

create or replace function internal.record_subscription_event(
  p_club_id uuid,
  p_subscription_id uuid,
  p_event_type text,
  p_previous_status text,
  p_new_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.platform_subscription_events (
    club_id, subscription_id, event_type, previous_status, new_status,
    plan_code, plan_price_pence, plan_currency, plan_price_version, reason, actor
  )
  select p_club_id, s.id, p_event_type, p_previous_status, p_new_status,
         s.plan_code, s.plan_price_pence, s.plan_currency, s.plan_price_version, p_reason, auth.uid()
  from public.platform_club_subscriptions s
  where s.id = p_subscription_id;
end;
$$;

-- Choosing a plan. The price is snapshotted here and never re-read.
create or replace function public.select_club_plan(p_club_id uuid, p_plan_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan record;
  v_existing record;
  v_id uuid;
begin
  if not (internal.has_capability('club.platform_billing.manage', 'club', p_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to choose a plan for this club.' using errcode = '42501';
  end if;

  select code, price_pence, currency, price_version, purchasable, status
  into v_plan
  from public.platform_plans
  where code = p_plan_code;

  if v_plan.code is null then
    raise exception 'No such plan: %.', p_plan_code;
  end if;

  -- The commercial guard. A plan that is not purchasable cannot be taken,
  -- however the request reaches here.
  if not v_plan.purchasable then
    raise exception 'The % plan is not available to buy yet.', p_plan_code;
  end if;

  select id, status, plan_code into v_existing
  from public.platform_club_subscriptions
  where club_id = p_club_id
  for update;

  if v_existing.id is null then
    insert into public.platform_club_subscriptions (
      club_id, plan_code, plan_price_pence, plan_currency, plan_price_version,
      status, created_by, updated_by
    )
    values (p_club_id, v_plan.code, v_plan.price_pence, v_plan.currency, v_plan.price_version,
            'pending_setup', auth.uid(), auth.uid())
    returning id into v_id;

    perform internal.record_subscription_event(p_club_id, v_id, 'plan_selected', null, 'pending_setup', null);
    return v_id;
  end if;

  -- Choosing the plan already held is a no-op rather than an error: a
  -- double-submitted form must not churn the record or the event log.
  if v_existing.plan_code = v_plan.code and v_existing.status <> 'ended' then
    return v_existing.id;
  end if;

  update public.platform_club_subscriptions
  set plan_code = v_plan.code,
      plan_price_pence = v_plan.price_pence,
      plan_currency = v_plan.currency,
      plan_price_version = v_plan.price_version,
      status = case when status = 'ended' then 'pending_setup' else status end,
      cancel_requested_at = null,
      cancelled_at = null,
      cancel_reason = null,
      updated_by = auth.uid()
  where id = v_existing.id;

  perform internal.record_subscription_event(
    p_club_id, v_existing.id,
    case when v_existing.status = 'ended' then 'plan_selected' else 'plan_changed' end,
    v_existing.status,
    (select status from public.platform_club_subscriptions where id = v_existing.id),
    null
  );

  return v_existing.id;
end;
$$;

-- Cancelling. The subscription runs to the end of the period already paid
-- for; it does not stop dead on the day someone clicks the button.
create or replace function public.cancel_club_subscription(p_club_id uuid, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub record;
begin
  if not (internal.has_capability('club.platform_billing.manage', 'club', p_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to cancel this club''s Ovalball subscription.' using errcode = '42501';
  end if;

  select id, status into v_sub
  from public.platform_club_subscriptions
  where club_id = p_club_id
  for update;

  if v_sub.id is null then
    raise exception 'This club has no Ovalball subscription.';
  end if;

  if v_sub.status in ('cancelled', 'ended') then
    return false;
  end if;

  update public.platform_club_subscriptions
  set status = 'cancelled',
      cancel_requested_at = now(),
      cancel_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      next_collection_on = null,
      updated_by = auth.uid()
  where id = v_sub.id;

  perform internal.record_subscription_event(p_club_id, v_sub.id, 'cancel_requested', v_sub.status, 'cancelled', p_reason);
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. What the next collection would be
-- ---------------------------------------------------------------------

-- Credit is applied at calculation time, and a cycle that comes to nothing
-- is **skipped** rather than collected as zero (section 71): a GBP 0.00
-- direct debit is a real bank instruction that confuses payers and costs
-- provider fees for no reason.
create or replace function public.club_next_collection(p_club_id uuid)
returns table (
  gross_pence int,
  credit_available_pence int,
  credit_applied_pence int,
  net_pence int,
  currency text,
  will_skip boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sub record;
  v_balance int;
  v_applied int;
begin
  if not (internal.has_capability('club.platform_billing.view', 'club', p_club_id) or internal.is_site_admin()) then
    return;
  end if;

  select plan_price_pence, plan_currency, status into v_sub
  from public.platform_club_subscriptions
  where club_id = p_club_id;

  if v_sub.plan_price_pence is null or v_sub.status not in ('scheduled', 'active', 'past_due') then
    return;
  end if;

  select coalesce(sum(amount_pence), 0)::int into v_balance
  from public.platform_credits where club_id = p_club_id;

  v_applied := least(greatest(v_balance, 0), v_sub.plan_price_pence);

  return query select
    v_sub.plan_price_pence,
    greatest(v_balance, 0),
    v_applied,
    v_sub.plan_price_pence - v_applied,
    v_sub.plan_currency,
    (v_sub.plan_price_pence - v_applied) = 0;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. The canonical state resolver (section 89)
-- ---------------------------------------------------------------------

-- One function every surface reads: Club Admin, Site Admin, billing,
-- entitlement checks and notifications. Nothing recomputes "is this club
-- paying" from parts.
create or replace function public.club_platform_billing_state(p_club_id uuid)
returns table (
  effective_plan text,
  subscription_status text,
  plan_price_pence int,
  currency text,
  next_collection_on date,
  current_period_end date,
  trial_status text,
  trial_remaining_seconds bigint,
  credit_balance_pence int,
  platform_mode text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    internal.club_effective_plan(p_club_id),
    s.status,
    s.plan_price_pence,
    coalesce(s.plan_currency, 'GBP'),
    s.next_collection_on,
    s.current_period_end,
    t.status,
    case when t.club_id is null then null
         else internal.trial_remaining_seconds(t.entitlement_seconds, t.consumed_seconds, t.accruing_since)
    end,
    coalesce((select sum(c.amount_pence)::int from public.platform_credits c where c.club_id = p_club_id), 0),
    coalesce(internal.current_platform_mode(), 'beta')
  from (select p_club_id as club_id) base
  left join public.platform_club_subscriptions s on s.club_id = base.club_id
  left join public.platform_trials t on t.club_id = base.club_id
  where internal.has_capability('club.platform_billing.view', 'club', p_club_id) or internal.is_site_admin();
$$;
