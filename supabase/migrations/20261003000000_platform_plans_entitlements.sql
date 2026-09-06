-- Commercial Platform, Phase E -- plans and entitlements.
--
-- Two plans, Standard and Pro. Standard is the core Ovalball product at
-- GBP 15 a month. Pro is GBP 25 a month and is **not purchasable**: no
-- premium feature exists yet that Standard does not have, and selling an
-- empty tier would be a lie. The architecture is here so that Pro can be
-- opened the day it means something, and not a day before.
--
-- Entitlements exist so that no page ever writes `if plan == 'pro'`. A
-- feature asks `club_has_entitlement(club_id, key)`; the answer comes from
-- the club's effective plan, resolved server-side. Hiding a button is not a
-- gate.

-- ---------------------------------------------------------------------
-- 1. The entitlement registry -- stable keys, and what may never be gated
-- ---------------------------------------------------------------------

create table if not exists public.platform_entitlements (
  key text primary key,
  label text not null,
  description text,

  -- Essential safety, security and record-keeping are never behind a paid
  -- tier. A non-gateable entitlement is granted to every club regardless of
  -- plan, regardless of trial state, and cannot be attached to a plan at
  -- all -- which is a structure rather than a promise to remember.
  gateable boolean not null default true,

  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  constraint platform_entitlements_key_shape check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);

alter table public.platform_entitlements enable row level security;

drop policy if exists platform_entitlements_select on public.platform_entitlements;
create policy platform_entitlements_select on public.platform_entitlements
  for select to anon, authenticated using (true);

drop policy if exists platform_entitlements_write on public.platform_entitlements;
create policy platform_entitlements_write on public.platform_entitlements
  for insert with check (internal.has_capability('site.commercial.manage', 'site'));

drop policy if exists platform_entitlements_update on public.platform_entitlements;
create policy platform_entitlements_update on public.platform_entitlements
  for update using (internal.has_capability('site.commercial.manage', 'site'));

drop trigger if exists audit_row_change on public.platform_entitlements;
create trigger audit_row_change
  after insert or update or delete on public.platform_entitlements
  for each row execute function internal.audit_row_change();

-- Seeded from what Ovalball actually does today, audited against the live
-- application rather than a marketing list. Nothing aspirational is here.
insert into public.platform_entitlements (key, label, description, gateable, sort_order)
values
  ('core.club_administration', 'Club administration', 'Club profile, venues, pitches, seasons and club settings.', true, 10),
  ('core.teams_and_roster', 'Teams and roster', 'Teams, squads, mini-rugby groups, player records and season rollover.', true, 20),
  ('core.fixtures', 'Fixtures', 'Fixture requests, scheduling, results and the fixture workspace.', true, 30),
  ('core.calendar', 'Calendar', 'The club calendar across fixtures, training and events.', true, 40),
  ('core.game_management', 'Game management', 'Matchday operations, call-ups, eligibility and dispensations.', true, 50),
  ('core.availability_attendance', 'Availability and attendance', 'Availability collection and attendance recording.', true, 60),
  ('core.messaging', 'Messaging', 'Club, team and fixture conversations.', true, 70),
  ('core.pitch_allocation', 'Pitch allocation', 'Pitch capacity, allocation and clash detection.', true, 80),
  ('core.member_payments', 'Member payments', 'Collecting membership subscriptions from a club''s own members through the club''s own connected merchant.', true, 90),
  ('safety.safeguarding', 'Safeguarding', 'Safeguarding records, guardian relationships and child-protection controls.', false, 1),
  ('safety.permissions', 'Permissions and access control', 'Roles, capabilities and authority controls.', false, 2),
  ('safety.audit', 'Audit trail', 'The record of who changed what, and when.', false, 3),
  ('safety.data_rights', 'Data rights', 'Access, correction, export and deletion requests.', false, 4)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Plans
-- ---------------------------------------------------------------------

create table if not exists public.platform_plans (
  code text primary key,
  name text not null,
  description text,

  -- Pence, so no float ever touches money.
  price_pence int not null,
  currency text not null default 'GBP',
  billing_interval text not null default 'month',

  -- Bumped automatically whenever the price or currency changes, so a
  -- commercial event can snapshot (code, price_pence, currency,
  -- price_version) and a later price change cannot rewrite what a club was
  -- actually charged or what a referral reward was actually worth.
  price_version int not null default 1,

  status text not null default 'available',
  purchasable boolean not null default false,
  sort_order int not null default 100,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint platform_plans_code_shape check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint platform_plans_price_not_negative check (price_pence >= 0),
  constraint platform_plans_currency_check check (currency = 'GBP'),
  constraint platform_plans_interval_check check (billing_interval in ('month', 'year')),
  constraint platform_plans_status_check check (status in ('available', 'coming_soon', 'retired')),

  -- The structural half of "do not sell an empty premium tier": a plan that
  -- is Coming Soon or retired cannot be bought, and no code path can make
  -- it buyable without also changing its status.
  constraint platform_plans_purchasable_only_when_available check (
    purchasable = false or status = 'available'
  )
);

create index if not exists platform_plans_sort_idx on public.platform_plans (sort_order) where status <> 'retired';

alter table public.platform_plans enable row level security;

-- Public: a pricing page needs to read plans without a session. Retired
-- plans stay readable to Site Admins so historical subscriptions still
-- render a plan name.
drop policy if exists platform_plans_select on public.platform_plans;
create policy platform_plans_select on public.platform_plans
  for select to anon, authenticated
  using (status <> 'retired' or internal.is_site_admin());

drop policy if exists platform_plans_write on public.platform_plans;
create policy platform_plans_write on public.platform_plans
  for insert with check (internal.has_capability('site.commercial.manage', 'site'));

drop policy if exists platform_plans_update on public.platform_plans;
create policy platform_plans_update on public.platform_plans
  for update using (internal.has_capability('site.commercial.manage', 'site'));

-- No DELETE policy: a plan a club was once on is never removed.

create or replace function internal.platform_plans_bump_price_version()
returns trigger
language plpgsql
as $$
begin
  if new.price_pence is distinct from old.price_pence
     or new.currency is distinct from old.currency then
    new.price_version := old.price_version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists platform_plans_bump_price_version on public.platform_plans;
create trigger platform_plans_bump_price_version
  before update on public.platform_plans
  for each row execute function internal.platform_plans_bump_price_version();

drop trigger if exists set_updated_at on public.platform_plans;
create trigger set_updated_at
  before update on public.platform_plans
  for each row execute function set_updated_at();

drop trigger if exists audit_row_change on public.platform_plans;
create trigger audit_row_change
  after insert or update or delete on public.platform_plans
  for each row execute function internal.audit_row_change();

insert into public.platform_plans (code, name, description, price_pence, currency, billing_interval, status, purchasable, sort_order)
values
  ('standard', 'Standard', 'The core Ovalball product: club and team administration, fixtures, calendar, game management, availability, messaging and pitch allocation.', 1500, 'GBP', 'month', 'available', true, 10),
  -- Coming Soon, and therefore not purchasable, because no premium feature
  -- exists yet that Standard does not already include. The plan record is
  -- here so the architecture is ready; the tier opens when it is real.
  ('pro', 'Pro', 'Everything in Standard. Premium tooling is in development; Pro is not yet available to buy.', 2500, 'GBP', 'month', 'coming_soon', false, 20)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 3. What each plan includes
-- ---------------------------------------------------------------------

create table if not exists public.platform_plan_entitlements (
  plan_code text not null references public.platform_plans(code) on delete cascade,
  entitlement_key text not null references public.platform_entitlements(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (plan_code, entitlement_key)
);

alter table public.platform_plan_entitlements enable row level security;

drop policy if exists platform_plan_entitlements_select on public.platform_plan_entitlements;
create policy platform_plan_entitlements_select on public.platform_plan_entitlements
  for select to anon, authenticated using (true);

drop policy if exists platform_plan_entitlements_write on public.platform_plan_entitlements;
create policy platform_plan_entitlements_write on public.platform_plan_entitlements
  for insert with check (internal.has_capability('site.commercial.manage', 'site'));

drop policy if exists platform_plan_entitlements_delete on public.platform_plan_entitlements;
create policy platform_plan_entitlements_delete on public.platform_plan_entitlements
  for delete using (internal.has_capability('site.commercial.manage', 'site'));

drop trigger if exists audit_row_change on public.platform_plan_entitlements;
create trigger audit_row_change
  after insert or update or delete on public.platform_plan_entitlements
  for each row execute function internal.audit_row_change();

-- Attaching a non-gateable entitlement to a plan would imply it could be
-- withheld from a club on another plan. It cannot, so the attachment is
-- refused rather than silently ignored.
create or replace function internal.platform_plan_entitlements_gateable_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not (select gateable from public.platform_entitlements where key = new.entitlement_key) then
    raise exception 'Entitlement % is essential and is granted to every club. It cannot be attached to a plan.', new.entitlement_key
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists platform_plan_entitlements_gateable_only on public.platform_plan_entitlements;
create trigger platform_plan_entitlements_gateable_only
  before insert or update on public.platform_plan_entitlements
  for each row execute function internal.platform_plan_entitlements_gateable_only();

-- Standard is the whole core product. Pro is Standard plus nothing, today,
-- and saying so in data is the honest version of section 25.
insert into public.platform_plan_entitlements (plan_code, entitlement_key)
select p.code, e.key
from public.platform_plans p
cross join public.platform_entitlements e
where p.code in ('standard', 'pro')
  and e.gateable
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 4. The resolver
-- ---------------------------------------------------------------------

-- A club's effective plan.
--
-- Phase E knows about trials only. A club on a running or paused trial has
-- the Standard product; nobody else has a plan. Phase F re-declares this
-- one function to consult `platform_club_subscriptions` first, and every
-- entitlement check in the application picks the change up without being
-- touched -- which is the entire reason the check is one function and not
-- an `if plan == 'pro'` scattered through pages.
create or replace function internal.club_effective_plan(p_club_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.platform_trials t
      where t.club_id = p_club_id and t.status in ('active', 'paused')
    ) then 'standard'
    else null
  end;
$$;

comment on function internal.club_effective_plan is
  'The single place that decides which plan a club is on. Phase F extends it to read platform_club_subscriptions; nothing else should ever need changing.';

create or replace function public.club_entitlements(p_club_id uuid)
returns table (entitlement_key text, source text)
language sql
stable
security definer
set search_path = public
as $$
  -- Essential entitlements: every club, always, no plan involved.
  select e.key, 'essential'::text
  from public.platform_entitlements e
  where not e.gateable

  union

  -- Plan entitlements: whatever the club's effective plan includes.
  select pe.entitlement_key, 'plan'::text
  from public.platform_plan_entitlements pe
  where pe.plan_code = internal.club_effective_plan(p_club_id);
$$;

-- The one call a feature makes. Server-resolved, so a hidden button or a
-- disabled control is presentation, never protection.
create or replace function public.club_has_entitlement(p_club_id uuid, p_entitlement_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_entitlements(p_club_id) ce
    where ce.entitlement_key = p_entitlement_key
  );
$$;

-- ---------------------------------------------------------------------
-- 5. Changing a plan's commercial terms
-- ---------------------------------------------------------------------

create or replace function public.set_platform_plan_terms(
  p_code text,
  p_price_pence int default null,
  p_status text default null,
  p_purchasable boolean default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version int;
begin
  if not internal.has_capability('site.commercial.manage', 'site') then
    raise exception 'Not authorized to change plan terms.' using errcode = '42501';
  end if;

  update public.platform_plans
  set price_pence = coalesce(p_price_pence, price_pence),
      status = coalesce(p_status, status),
      purchasable = coalesce(p_purchasable, purchasable),
      updated_by = auth.uid()
  where code = p_code
  returning price_version into v_version;

  if v_version is null then
    raise exception 'No such plan: %.', p_code;
  end if;

  return v_version;
end;
$$;
