-- Referral reward valuation integrity.
--
-- WHAT WENT WRONG
--
-- The Site Admin Dashboard reported "Reward £ earned: £29.00" against a
-- referral whose reward_plan_code was 'standard'. The Standard plan costs
-- £15.00. The credit row behind it carried amount_pence = 2900 with
-- snapshot_price_pence and snapshot_price_version both NULL.
--
-- internal.qualify_referral_for_payment ALWAYS writes those snapshot
-- columns, and always writes amount_pence = the plan's price_pence read in
-- the same statement. So that row cannot have come from the referral
-- engine. It was written directly into a database, and every downstream
-- surface -- the commercial card, the F1 reward totals, R-5's per-referral
-- reward -- reported it as real earned money, because nothing in the schema
-- required a reward to be worth what it says it is worth.
--
-- The published Referral Terms are specific: "One month of the referring
-- club's own plan, at the price that plan cost at the moment the reward was
-- earned. That value is recorded then and is not recalculated afterwards."
-- The engine implements exactly that. The gap was never the engine; it was
-- that nothing stopped a non-engine write from contradicting it.
--
-- WHY THESE CONSTRAINTS ARE `NOT VALID`
--
-- platform_credits is an append-only commercial record
-- (internal.platform_append_only refuses UPDATE and DELETE outright). A
-- wrong historical row therefore cannot be corrected in place, and it must
-- not be: rewriting a money ledger to make a new constraint pass is exactly
-- the kind of quiet history-editing the append-only rule exists to prevent.
--
-- So the constraints are added NOT VALID. Postgres enforces them on every
-- INSERT and UPDATE from now on -- no new row can ever be wrong -- while
-- existing rows are left exactly as they are. The non-conforming history is
-- surfaced instead, by referral_reward_integrity_detail() below, so a Site
-- Admin sees "this reward's value cannot be verified" rather than a clean
-- number that happens to be fiction.
--
-- A future migration may VALIDATE these once history is reconciled by
-- whatever compensating entries the product decides on. Do not validate
-- them by editing the ledger.

-- ---------------------------------------------------------------------
-- 1. A referral reward must be worth its own snapshot.
-- ---------------------------------------------------------------------
alter table public.platform_credits
  add constraint platform_credits_reward_matches_snapshot
  check (
    source <> 'referral_reward'
    or (
      snapshot_plan_code is not null
      and snapshot_price_pence is not null
      and snapshot_price_version is not null
      and amount_pence = snapshot_price_pence
    )
  ) not valid;

comment on constraint platform_credits_reward_matches_snapshot on public.platform_credits is
  'A referral reward is one month of the referring club''s own plan at the price it cost when earned. The snapshot columns are that record, so a reward credit must carry all three and its amount must equal the price it snapshotted. NOT VALID: enforced for every new row, while append-only history is left untouched and surfaced by referral_reward_integrity_detail() instead.';

-- ---------------------------------------------------------------------
-- 2. A qualified referral must carry the full reward record.
-- ---------------------------------------------------------------------
-- platform_referrals_qualified_has_reward already requires reward_credit_id,
-- qualifying_payment_id and qualified_at. It does not require the value
-- fields, which are what the dashboard actually reports.
alter table public.platform_referrals
  add constraint platform_referrals_qualified_reward_is_priced
  check (
    status <> 'qualified'
    or (
      reward_amount_pence is not null
      and reward_plan_code is not null
      and reward_price_version is not null
    )
  ) not valid;

comment on constraint platform_referrals_qualified_reward_is_priced on public.platform_referrals is
  'A qualified referral reports a reward value on the Site Admin Dashboard, so it must record what that value was and which plan and price version produced it. NOT VALID for the same reason as the platform_credits constraint.';

-- ---------------------------------------------------------------------
-- 3. The detector.
-- ---------------------------------------------------------------------
-- Deliberately NOT folded into referral_data_health/_detail. Those answer a
-- different question -- is this referral attributed to the right clubs --
-- and re-declaring a working function from a partial copy is how columns
-- silently go missing for its other callers. Reward VALUATION is its own
-- concern and gets its own function.
--
-- This also catches the one disagreement a CHECK constraint structurally
-- cannot: a referral whose reward_amount_pence differs from the amount on
-- the credit it points at. That is cross-table, so it lives here.
create or replace function public.referral_reward_integrity_detail()
returns table (
  category text,
  finding text,
  referral_id uuid,
  credit_id uuid,
  club_id uuid,
  club_name text,
  detail text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (internal.is_site_admin() and internal.has_capability('site.commercial.view', 'site')) then
    raise exception 'Not authorized to read referral reward integrity.' using errcode = '42501';
  end if;

  return query
  -- A reward credit that does not record what it was worth, or whose amount
  -- contradicts the snapshot it does record.
  select
    'reward_value_unverifiable'::text,
    case
      when cr.snapshot_price_pence is null then 'Reward credit has no recorded plan price'
      else 'Reward credit amount disagrees with its own snapshotted price'
    end::text,
    r.id,
    cr.id,
    cr.club_id,
    coalesce(d.name, c.slug)::text,
    format(
      'Credit is %s; snapshot records plan %s at %s. A reward is one month of the club''s plan at the price it cost when earned, so these must agree.',
      to_char(cr.amount_pence / 100.0, 'FM£999999990.00'),
      coalesce(cr.snapshot_plan_code, '(none recorded)'),
      case when cr.snapshot_price_pence is null then '(no price recorded)'
           else to_char(cr.snapshot_price_pence / 100.0, 'FM£999999990.00') end
    )::text
  from public.platform_credits cr
  left join public.platform_referrals r on r.reward_credit_id = cr.id
  left join public.clubs c on c.id = cr.club_id
  left join public.club_directory d on d.id = c.directory_id
  where cr.source = 'referral_reward'
    and (
      cr.snapshot_plan_code is null
      or cr.snapshot_price_pence is null
      or cr.snapshot_price_version is null
      or cr.amount_pence <> cr.snapshot_price_pence
    )

  union all

  -- A qualified referral missing the value fields the dashboard reports.
  select
    'reward_record_incomplete'::text,
    'Qualified referral does not record its reward value'::text,
    r.id,
    r.reward_credit_id,
    r.referring_club_id,
    coalesce(d.name, c.slug)::text,
    'The referral is qualified, so a reward was earned, but the amount, plan code or price version behind it was never recorded.'::text
  from public.platform_referrals r
  left join public.clubs c on c.id = r.referring_club_id
  left join public.club_directory d on d.id = c.directory_id
  where r.status = 'qualified'
    and (
      r.reward_amount_pence is null
      or r.reward_plan_code is null
      or r.reward_price_version is null
    )

  union all

  -- The cross-table disagreement no CHECK can express.
  select
    'reward_amount_disagrees_with_ledger'::text,
    'Referral reward value differs from the credit it points at'::text,
    r.id,
    cr.id,
    r.referring_club_id,
    coalesce(d.name, c.slug)::text,
    format(
      'Referral records %s; the credit it points at is %s. The dashboard reports the referral figure, so these disagreeing means a reported reward is not the money that actually moved.',
      to_char(r.reward_amount_pence / 100.0, 'FM£999999990.00'),
      to_char(cr.amount_pence / 100.0, 'FM£999999990.00')
    )::text
  from public.platform_referrals r
  join public.platform_credits cr on cr.id = r.reward_credit_id
  left join public.clubs c on c.id = r.referring_club_id
  left join public.club_directory d on d.id = c.directory_id
  where r.reward_amount_pence is not null
    and r.reward_amount_pence <> cr.amount_pence;
end;
$$;

revoke execute on function public.referral_reward_integrity_detail() from public, anon;
grant execute on function public.referral_reward_integrity_detail() to authenticated;

comment on function public.referral_reward_integrity_detail is
  'Reward VALUATION integrity, distinct from referral_data_health''s attribution integrity. Reports reward credits that cannot be verified against their own snapshot, qualified referrals with no recorded value, and referrals whose reported reward disagrees with the ledger row behind it. Exists because platform_credits is append-only: wrong history cannot be corrected in place, so it is surfaced rather than hidden behind a number that looks clean.';
