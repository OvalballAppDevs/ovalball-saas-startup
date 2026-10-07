-- =====================================================================================================
-- THE MONEY REACHES THE CLUB: PAYOUTS AND REFUNDS FROM GOCARDLESS'S OWN RECORDS (Club Memberships Part 2, §29)
--
-- A club could see what its members paid, but never what reached its bank, nor GoCardless's own fee, nor a refund
-- made at GoCardless: `gocardless_payouts` and `gocardless_reconciliation_entries` existed and nothing wrote them,
-- and every refund event was ignored (audit G14). GoCardless keeps payout items for six months only
-- (https://docs.gocardless.com/docs/api-reference/payout-item, "410 Gone"), so they must be kept here.
--
--   1. PAYOUTS AND THEIR ITEMS, as GoCardless records them. A payout is read from GoCardless when it is paid
--      (payouts.paid), with every item: GoCardless's ten item types, amounts to a tenth of a penny ("we sum all of
--      the items and then round"), and VAT on GoCardless's fees. Recording is idempotent: a redelivered or replayed
--      event replaces the payout's items with GoCardless's current list, never adds a second copy.
--   2. A PAYOUT IS NOT ALL OURS. "A payout will not necessarily only contain payments collected through your
--      integration": each item is linked to an Ovalball payment where it is one of this club's, and the rest is
--      kept and shown as the club's other GoCardless activity -- never attributed to a member.
--   3. REFUNDS FROM GOCARDLESS'S OWN EVENTS. A refund made at GoCardless (its dashboard, or anything else) is
--      recorded from the refund resource itself: pending while GoCardless processes it, confirmed once paid, failed
--      if it bounced or was cancelled -- and it never moves backwards. Only a confirmed refund is subtracted from
--      Collected (20270753000000).
--   4. ONE READ FOR THE CLUB (club_payouts): each payout from what members paid through Ovalball, less GoCardless's
--      fees (with VAT), Ovalball's fee, refunds and failures, plus the club's other GoCardless activity, to the
--      amount paid into the club's bank -- and whether the items add up to it.
--
-- Nothing here estimates a fee: every figure is GoCardless's own.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------------------
-- 1. PAYOUTS AND THEIR ITEMS
-- ---------------------------------------------------------------------------------------------------------------
do $$
begin
  -- The items table has never been written; its old four-word vocabulary is replaced by GoCardless's own. Refuse
  -- (rather than silently rewrite) if anything was ever stored under the old one.
  if exists (select 1 from public.gocardless_reconciliation_entries) then
    raise exception 'gocardless_reconciliation_entries holds rows written under the old vocabulary; reconcile them before this migration';
  end if;
end $$;

alter table public.gocardless_payouts
  add column if not exists reference text,
  add column if not exists payout_type text,
  add column if not exists deducted_fees_minor integer,
  add column if not exists gc_created_at timestamptz,
  add column if not exists items_recorded_at timestamptz;

alter table public.gocardless_payouts
  drop constraint if exists gocardless_payouts_payout_type_check,
  add constraint gocardless_payouts_payout_type_check check (payout_type is null or payout_type in ('merchant', 'partner'));

alter table public.gocardless_reconciliation_entries
  drop constraint if exists gocardless_reconciliation_entries_entry_type_check,
  add column if not exists club_id uuid references public.clubs(id),
  add column if not exists item_index integer,
  add column if not exists amount_pence numeric(14,1),
  add column if not exists taxes_pence numeric(14,1) not null default 0,
  add column if not exists gc_payment_id text,
  add column if not exists gc_refund_id text;

alter table public.gocardless_reconciliation_entries alter column amount_minor drop not null;

alter table public.gocardless_reconciliation_entries
  drop constraint if exists gocardless_reconciliation_entries_entry_type_check,
  drop constraint if exists gocardless_reconciliation_entries_amount_present,
  drop constraint if exists gocardless_reconciliation_entries_item_unique,
  add constraint gocardless_reconciliation_entries_entry_type_check check (entry_type in (
    'payment_paid_out', 'payment_failed', 'payment_charged_back', 'payment_refunded', 'refund', 'refund_funds_returned',
    'gocardless_fee', 'app_fee', 'revenue_share', 'surcharge_fee')),
  add constraint gocardless_reconciliation_entries_amount_present check (amount_pence is not null),
  add constraint gocardless_reconciliation_entries_item_unique unique (payout_id, item_index);

create index if not exists gocardless_reconciliation_entries_payment_idx on public.gocardless_reconciliation_entries (payment_id) where payment_id is not null;
create index if not exists gocardless_payouts_club_arrival_idx on public.gocardless_payouts (club_id, arrival_date desc);

comment on column public.gocardless_reconciliation_entries.amount_pence is
  'GoCardless''s own item amount, in pence to one decimal place: positive is money to the club, negative money taken. The payout is the sum of its items, rounded.';
comment on column public.gocardless_reconciliation_entries.payment_id is
  'The Ovalball payment this item belongs to, when it is one of this club''s; null for the club''s other GoCardless activity.';

-- Server-only: the webhook, after re-reading the payout and its items from GoCardless with the club's own connection.
create or replace function public.record_gocardless_payout(p_club_id uuid, p_payout jsonb, p_items jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_payout uuid;
  v_item jsonb;
  v_index integer := 0;
  v_payment uuid;
  v_ours integer := 0;
  v_other integer := 0;
  v_type text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Payouts are recorded by the server only.' using errcode = '42501';
  end if;
  if p_club_id is null or not exists (select 1 from public.clubs c where c.id = p_club_id) then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
  if coalesce(p_payout ->> 'id', '') = '' or (p_payout ->> 'amount') is null or coalesce(p_payout ->> 'status', '') not in ('pending', 'paid', 'bounced') then
    raise exception 'That is not a GoCardless payout.' using errcode = '22023';
  end if;
  -- Null items: GoCardless no longer serves them (archived after six months). The payout is brought up to date and
  -- the items already held are kept -- an archive is never mistaken for an empty payout.
  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'Payout items must be a list.' using errcode = '22023';
  end if;

  -- A payout belongs to the club it was first recorded for; a second club claiming it is refused, never moved.
  if exists (select 1 from public.gocardless_payouts po where po.gc_payout_id = p_payout ->> 'id' and po.club_id <> p_club_id) then
    raise exception 'This payout is already recorded for another club.' using errcode = '23505';
  end if;

  insert into public.gocardless_payouts (club_id, gc_payout_id, amount_minor, currency, status, arrival_date, reference, payout_type,
                                         deducted_fees_minor, gc_created_at, items_recorded_at)
  values (p_club_id, p_payout ->> 'id', (p_payout ->> 'amount')::integer, coalesce(p_payout ->> 'currency', 'GBP'), p_payout ->> 'status',
          nullif(p_payout ->> 'arrival_date', '')::date, nullif(p_payout ->> 'reference', ''), nullif(p_payout ->> 'payout_type', ''),
          nullif(p_payout ->> 'deducted_fees', '')::integer, nullif(p_payout ->> 'created_at', '')::timestamptz,
          case when p_items is not null then now() end)
  on conflict (gc_payout_id) do update
     set amount_minor = excluded.amount_minor, status = excluded.status, arrival_date = excluded.arrival_date,
         reference = excluded.reference, payout_type = excluded.payout_type, deducted_fees_minor = excluded.deducted_fees_minor,
         gc_created_at = excluded.gc_created_at,
         items_recorded_at = coalesce(excluded.items_recorded_at, public.gocardless_payouts.items_recorded_at), updated_at = now()
  returning id into v_payout;

  if p_items is null then
    return jsonb_build_object('payout_id', v_payout, 'items', null, 'kept_items', (select count(*) from public.gocardless_reconciliation_entries where payout_id = v_payout));
  end if;

  -- GoCardless's current list replaces what was held: a replay or redelivery never doubles an item.
  delete from public.gocardless_reconciliation_entries where payout_id = v_payout;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    v_type := v_item ->> 'type';
    v_payment := null;
    if v_item -> 'links' ->> 'payment' is not null then
      select gp.id into v_payment from public.gocardless_payments gp
       where gp.gc_payment_id = v_item -> 'links' ->> 'payment' and gp.club_id = p_club_id;
    end if;
    if v_payment is null then v_other := v_other + 1; else v_ours := v_ours + 1; end if;
    insert into public.gocardless_reconciliation_entries (payout_id, club_id, item_index, payment_id, entry_type, amount_pence, amount_minor, taxes_pence,
                                                          gc_payment_id, gc_refund_id)
    values (v_payout, p_club_id, v_index, v_payment, v_type, (v_item ->> 'amount')::numeric(14,1), round((v_item ->> 'amount')::numeric)::integer,
            coalesce((select sum((t ->> 'amount')::numeric) from jsonb_array_elements(coalesce(v_item -> 'taxes', '[]'::jsonb)) t), 0),
            v_item -> 'links' ->> 'payment', v_item -> 'links' ->> 'refund');
  end loop;

  return jsonb_build_object('payout_id', v_payout, 'items', v_index, 'ovalball_items', v_ours, 'other_items', v_other);
end;
$function$;

revoke all on function public.record_gocardless_payout(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_gocardless_payout(uuid, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. REFUNDS FROM GOCARDLESS'S OWN EVENTS
-- ---------------------------------------------------------------------------------------------------------------
alter table public.payment_refunds alter column created_by drop not null;
alter table public.payment_refunds
  add column if not exists source text not null default 'ovalball',
  add column if not exists gc_status text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.payment_refunds
  drop constraint if exists payment_refunds_status_check,
  add constraint payment_refunds_status_check check (status in ('pending', 'confirmed', 'failed')),
  drop constraint if exists payment_refunds_source_check,
  add constraint payment_refunds_source_check check (source in ('ovalball', 'gocardless')),
  drop constraint if exists payment_refunds_created_by_present,
  add constraint payment_refunds_created_by_present check (source = 'gocardless' or created_by is not null);

-- Server-only: the webhook, after re-reading the refund from GoCardless with the club's own connection.
create or replace function public.record_gocardless_refund(p_gc_refund_id text, p_gc_payment_id text, p_amount_minor integer, p_gc_status text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_payment public.gocardless_payments;
  v_refund public.payment_refunds;
  v_status text;
  v_rank_new integer;
  v_rank_old integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Refunds are recorded by the server only.' using errcode = '42501';
  end if;
  if coalesce(p_gc_refund_id, '') = '' or coalesce(p_amount_minor, 0) <= 0 then
    raise exception 'That is not a GoCardless refund.' using errcode = '22023';
  end if;

  -- GoCardless's refund statuses, in Ovalball's three words.
  v_status := case
    when p_gc_status in ('created', 'pending_submission', 'submitted') then 'pending'
    when p_gc_status in ('paid', 'refund_settled') then 'confirmed'
    when p_gc_status in ('cancelled', 'bounced', 'funds_returned', 'failed') then 'failed'
  end;
  if v_status is null then
    raise exception 'Unknown GoCardless refund status: %', p_gc_status using errcode = '22023';
  end if;

  select * into v_payment from public.gocardless_payments where gc_payment_id = p_gc_payment_id;
  if v_payment.id is null then
    -- Not a payment Ovalball collected: not ours to record.
    return jsonb_build_object('outcome', 'NOT_OURS');
  end if;

  select * into v_refund from public.payment_refunds where gc_refund_id = p_gc_refund_id for update;
  if v_refund.id is null then
    -- A refund Ovalball itself asked for, waiting for its GoCardless id: the same refund, not a second one.
    select * into v_refund from public.payment_refunds
     where payment_id = v_payment.id and gc_refund_id is null and status = 'pending' and amount_minor = p_amount_minor
     order by created_at limit 1 for update;
  end if;

  if v_refund.id is null then
    insert into public.payment_refunds (payment_id, gc_refund_id, amount_minor, reason, status, created_by, source, gc_status)
    values (v_payment.id, p_gc_refund_id, p_amount_minor, 'Refunded at GoCardless', v_status, null, 'gocardless', p_gc_status)
    returning * into v_refund;
    insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
    values (null, v_payment.club_id, 'refund_recorded_from_gocardless', 'payment_refunds', v_refund.id, null,
            jsonb_build_object('gc_status', p_gc_status, 'status', v_status, 'amount_minor', p_amount_minor), 'webhook');
    return jsonb_build_object('outcome', 'RECORDED', 'status', v_status);
  end if;

  -- NEVER BACKWARDS: pending < confirmed; failed is final for a refund that never paid.
  v_rank_old := case v_refund.status when 'pending' then 1 when 'confirmed' then 2 when 'failed' then 2 end;
  v_rank_new := case v_status when 'pending' then 1 when 'confirmed' then 2 when 'failed' then 2 end;
  if v_rank_new < v_rank_old or (v_refund.status = 'confirmed' and v_status = 'failed' and p_gc_status <> 'funds_returned') then
    return jsonb_build_object('outcome', 'STALE', 'status', v_refund.status);
  end if;

  update public.payment_refunds
     set gc_refund_id = p_gc_refund_id, status = v_status, gc_status = p_gc_status, updated_at = now()
   where id = v_refund.id;
  if v_refund.status is distinct from v_status then
    insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
    values (null, v_payment.club_id, 'refund_status_from_gocardless', 'payment_refunds', v_refund.id,
            jsonb_build_object('status', v_refund.status), jsonb_build_object('gc_status', p_gc_status, 'status', v_status), 'webhook');
  end if;
  return jsonb_build_object('outcome', 'UPDATED', 'status', v_status);
end;
$function$;

revoke all on function public.record_gocardless_refund(text, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_gocardless_refund(text, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. THE CLUB'S PAYOUTS, EXPLAINED
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.club_payouts(p_club_id uuid, p_limit integer default 24)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_rows jsonb;
begin
  if internal.actor() is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can('finance.subscription.view', 'club', p_club_id, null, null) then
    raise exception 'You are not authorised to see this club''s payouts.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by (x ->> 'arrival_date') desc nulls last, (x ->> 'recorded_at') desc), '[]'::jsonb) into v_rows
    from (
      select jsonb_build_object(
        'id', po.id,
        'reference', po.reference,
        'arrival_date', po.arrival_date,
        'status', po.status,
        'currency', po.currency,
        'amount_minor', po.amount_minor,
        'recorded_at', po.items_recorded_at,
        -- Through Ovalball: this club's payments and what GoCardless did with each.
        'members_paid_minor', round(coalesce(sum(e.amount_pence) filter (where e.payment_id is not null and e.entry_type = 'payment_paid_out'), 0))::integer,
        'gocardless_fees_minor', round(coalesce(sum(e.amount_pence) filter (where e.payment_id is not null and e.entry_type in ('gocardless_fee', 'surcharge_fee')), 0))::integer,
        'gocardless_vat_minor', round(coalesce(sum(e.taxes_pence) filter (where e.payment_id is not null and e.entry_type in ('gocardless_fee', 'surcharge_fee')), 0))::integer,
        'ovalball_fee_minor', round(coalesce(sum(e.amount_pence) filter (where e.payment_id is not null and e.entry_type = 'app_fee'), 0))::integer,
        'refunds_minor', round(coalesce(sum(e.amount_pence) filter (where e.payment_id is not null and e.entry_type in ('payment_refunded', 'refund', 'refund_funds_returned')), 0))::integer,
        'failures_minor', round(coalesce(sum(e.amount_pence) filter (where e.payment_id is not null and e.entry_type in ('payment_failed', 'payment_charged_back')), 0))::integer,
        -- Everything else in the payout: the club's other GoCardless activity, never attributed to a member.
        'other_minor', round(coalesce(sum(e.amount_pence) filter (where e.payment_id is null), 0))::integer,
        'items', count(e.id),
        'ovalball_payments', count(distinct e.payment_id),
        -- GoCardless sums the items and then rounds: they must come to the payout.
        'balanced', count(e.id) > 0 and round(coalesce(sum(e.amount_pence), 0))::integer = po.amount_minor
      ) as x
        from public.gocardless_payouts po
        left join public.gocardless_reconciliation_entries e on e.payout_id = po.id
       where po.club_id = p_club_id and coalesce(po.payout_type, 'merchant') = 'merchant'
       group by po.id
       order by po.arrival_date desc nulls last, po.items_recorded_at desc
       limit greatest(1, least(coalesce(p_limit, 24), 120))
    ) q;

  return jsonb_build_object('club_id', p_club_id, 'payouts', v_rows);
end;
$function$;

revoke all on function public.club_payouts(uuid, integer) from public, anon;
grant execute on function public.club_payouts(uuid, integer) to authenticated;

comment on function public.club_payouts(uuid, integer) is
  'The club''s GoCardless payouts, each explained from GoCardless''s own items: what members paid through Ovalball, GoCardless''s fees (with VAT), Ovalball''s fee, refunds and failures, the club''s other GoCardless activity, and whether the items add up to what was paid into the bank. finance.subscription.view at the club.';
