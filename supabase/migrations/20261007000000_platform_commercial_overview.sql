-- Commercial Platform, Phase I -- the Site Admin commercial overview.
--
-- One function rather than a page-side join, for the same reason the trial
-- arithmetic lives in one function: remaining trial time must never be
-- recomputed in TypeScript from `entitlement_seconds - consumed_seconds`,
-- because a second implementation is a second thing that can be wrong
-- about money.
--
-- Read-only. It returns nothing at all unless the caller holds
-- `site.commercial.view`.

create or replace function public.platform_commercial_overview()
returns table (
  club_id uuid,
  club_name text,
  club_slug text,
  plan_code text,
  subscription_status text,
  plan_price_pence int,
  next_collection_on date,
  mandate_present boolean,
  trial_status text,
  trial_remaining_seconds bigint,
  credit_balance_pence int,
  last_payment_status text,
  last_payment_failed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    coalesce(d.name, c.slug),
    c.slug,
    s.plan_code,
    s.status,
    s.plan_price_pence,
    s.next_collection_on,
    s.provider_mandate_id is not null,
    t.status,
    case when t.club_id is null then null
         else internal.trial_remaining_seconds(t.entitlement_seconds, t.consumed_seconds, t.accruing_since)
    end,
    coalesce((select sum(cr.amount_pence)::int from public.platform_credits cr where cr.club_id = c.id), 0),
    lp.status,
    lp.failed_at
  from public.clubs c
  left join public.club_directory d on d.id = c.directory_id
  left join public.platform_club_subscriptions s on s.club_id = c.id
  left join public.platform_trials t on t.club_id = c.id
  left join lateral (
    select p.status, p.failed_at
    from public.platform_payments p
    where p.club_id = c.id
    order by p.created_at desc
    limit 1
  ) lp on true
  where internal.has_capability('site.commercial.view', 'site')
    -- Only clubs with a commercial relationship. A club that has never
    -- started a trial is a club-directory matter, not a commercial one.
    and (s.club_id is not null or t.club_id is not null)
  order by coalesce(d.name, c.slug);
$$;

comment on function public.platform_commercial_overview is
  'Every club with an Ovalball trial or subscription, with remaining trial time computed by the same function the club-facing surfaces use. Requires site.commercial.view.';
