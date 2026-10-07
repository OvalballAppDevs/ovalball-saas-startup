-- =====================================================================================================
-- MEMBER PAYMENTS SETTLE TRUTHFULLY (2026-10-06)
--
-- The member -> club payment path (the club's own GoCardless, connected by OAuth) was audited end to end on
-- 5-6 October 2026 and six defects were proved from the code and the live definitions. This migration is
-- the server half of their fixes; activation's half is lib/payments/gocardless/collection-plan.ts.
--
--   1. A WEBHOOK EVENT THAT FAILED WAS NEVER RETRIED. The route answered 200 whatever happened and the inbox
--      skipped any redelivery (on conflict do nothing), so a failed event was stranded for good. The inbox is
--      now CLAIMABLE: a redelivery of an event that is not yet processed claims it again (unless another
--      delivery holds a live claim), the route answers 500 when any event failed so GoCardless redelivers, and
--      claim_stale_gocardless_events lets a replay pick up anything GoCardless has stopped retrying.
--   2. PAYMENT STATUS COULD MOVE BACKWARDS. A late or out-of-order observation overwrote a newer one (a
--      paid member could return to Submitted, then read as Overdue). Each status now carries the time it was
--      OBSERVED; an observation no newer than the recorded one changes nothing, GoCardless's own terminal
--      states (cancelled, customer_approval_denied) never reopen, and a reversed chargeback can return an
--      obligation to Paid. GoCardless's payment graph is cyclic (late failure, retry), so this orders by
--      observation, not by a status rank.
--   3. DISCONNECTING KEPT A USABLE TOKEN. The club's full-access token stayed in plain text, unrevoked and
--      unaudited. Disconnect now removes it from the connection (queued for revocation at GoCardless and
--      deleted once revoked), and connecting and disconnecting are audited.
--   4. record_billing_request TRUSTED THE CLIENT'S CLUB ID. The club is now the enrolment's own; a different
--      club id is refused.
--   5. A 100% DISCOUNT ROLLED BACK THE WHOLE CLUB. A zero amount failed the amount check inside one
--      club-wide transaction. A zero month is now recorded as EXEMPT (never collected), and each payer is
--      generated on its own, so one member's problem is recorded, not inflicted on everybody else.
--   6. Three price functions answered any signed-in caller; a minor could make themselves the responsible
--      payer; set_responsible_payer skipped the payer's guardianship when the caller was a guardian.
--
-- Tests: gocardless_member_payment_integrity.sql (SQL), gocardless_first_collection.test.mts and
-- gocardless_webhook_retry.test.mts (JS).
-- =====================================================================================================


-- -----------------------------------------------------------------------------------------------------
-- 6. WHO MAY SEE A PRICE -- one predicate, the row policy's own question
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.may_read_membership_price(p_club_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to ''
as $function$
  select coalesce(auth.role() = 'service_role', false)
      or internal.has_site_capability('site.commercial.view')
      or internal.has_capability('finance.subscription.configure', 'club', p_club_id, null)
      or internal.has_capability('finance.subscription.view', 'club', p_club_id, null)
      or internal.has_capability('finance.enrolment.manage', 'club', p_club_id, null)
      or exists (
        select 1
          from public.player_team_memberships ptm
          join public.teams t on t.id = ptm.team_id
         where t.club_id = p_club_id
           and ptm.status = 'active'
           and (internal.is_active_player_guardian(ptm.player_id) or internal.is_own_linked_player(ptm.player_id)));
$function$;
-- Only ever asked from inside the SECURITY DEFINER price functions below, which run as their owner, so no
-- browser role needs to call it directly.
revoke all on function internal.may_read_membership_price(uuid) from public, anon, authenticated;
grant execute on function internal.may_read_membership_price(uuid) to service_role;

create or replace function public.current_subscription_price(p_programme_id uuid, p_as_of date default current_date)
 returns integer
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select pr.amount_minor
    from public.club_subscription_pricing pr
   where pr.programme_id = p_programme_id and pr.effective_from <= p_as_of
     and internal.may_read_membership_price((select p.club_id from public.club_subscription_programmes p where p.id = p_programme_id))
   order by pr.effective_from desc
   limit 1;
$function$;

create or replace function public.get_first_collection_date(p_programme_id uuid, p_as_of date default current_date)
 returns date
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when extract(day from p_as_of)::int <= p.collection_day then
      date_trunc('month', p_as_of)::date + (p.collection_day - 1)
    else
      (date_trunc('month', p_as_of)::date + interval '1 month')::date + (p.collection_day - 1)
  end
  from public.club_subscription_programmes p
  where p.id = p_programme_id
    and internal.may_read_membership_price(p.club_id);
$function$;

create or replace function public.preview_first_payment(p_programme_id uuid, p_player_id uuid, p_membership_start_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(policy text, monthly_amount_minor integer, first_charge_amount_minor integer, first_charge_billing_period date, covers_from date, covers_to date, is_prorated boolean, sibling_ordinal integer, sibling_discount_type text, sibling_discount_value integer, sibling_discount_amount_minor integer, base_amount_minor integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_programme record;
  v_pricing record;
  v_first_period date;
  v_proration record;
begin
  select * into v_programme from public.club_subscription_programmes where id = p_programme_id;
  if v_programme is null then
    return;
  end if;
  -- WHO MAY SEE THE PRICE (internal.may_read_membership_price): this answered any signed-in caller for any
  -- programme id, past the scoped read policy on the rows it reads -- the bug class 20270537000000 closed for
  -- the illustrative preview. An outsider learns neither the price nor that the programme exists.
  if not internal.may_read_membership_price(v_programme.club_id) then
    return;
  end if;

  select * into v_pricing from internal.calculate_member_price(p_programme_id, auth.uid(), p_player_id, p_membership_start_date);
  if v_pricing.final_amount_minor is null then
    return;
  end if;

  v_first_period := date_trunc('month', p_membership_start_date)::date;

  if v_programme.first_payment_policy = 'NEXT_COLLECTION_DAY' then
    if extract(day from p_membership_start_date)::int > v_programme.collection_day then
      return query select
        v_programme.first_payment_policy, v_pricing.final_amount_minor, v_pricing.final_amount_minor,
        (v_first_period + interval '1 month')::date,
        (v_first_period + interval '1 month')::date, (v_first_period + interval '1 month')::date,
        false,
        v_pricing.ordinal, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.base_amount_minor;
    else
      return query select
        v_programme.first_payment_policy, v_pricing.final_amount_minor, v_pricing.final_amount_minor, v_first_period, v_first_period, v_first_period, false,
        v_pricing.ordinal, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.base_amount_minor;
    end if;
  else -- PRORATE_CURRENT_MONTH
    if extract(day from p_membership_start_date)::int = 1 then
      return query select
        v_programme.first_payment_policy, v_pricing.final_amount_minor, v_pricing.final_amount_minor, v_first_period, v_first_period, v_first_period, false,
        v_pricing.ordinal, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.base_amount_minor;
    else
      -- Section 9: proration is based on the DISCOUNTED recurring
      -- amount, never the undiscounted base.
      select * into v_proration from internal.calculate_first_month_proration(p_membership_start_date, v_pricing.final_amount_minor);
      return query select
        v_programme.first_payment_policy, v_pricing.final_amount_minor, v_proration.prorated_amount_minor, v_first_period,
        p_membership_start_date, (v_first_period + interval '1 month' - interval '1 day')::date,
        true,
        v_pricing.ordinal, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.base_amount_minor;
    end if;
  end if;
end;
$function$;

create or replace function public.preview_first_payment_illustrative(p_programme_id uuid, p_membership_start_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(policy text, monthly_amount_minor integer, first_charge_amount_minor integer, first_charge_billing_period date, covers_from date, covers_to date, is_prorated boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_programme record;
  v_price integer;
  v_first_period date;
  v_proration record;
begin
  select * into v_programme from public.club_subscription_programmes where id = p_programme_id;
  if v_programme is null then
    return;
  end if;

  -- THE SAME QUESTION THE ROW POLICY ASKS, through the canonical resolver: the club's finance and
  -- enrolment holders, the site's commercial viewer, or somebody who pays for a member of this club.
  -- THE SAME QUESTION THE ROW POLICY ASKS, asked in one place (internal.may_read_membership_price).
  if not internal.may_read_membership_price(v_programme.club_id) then
    return;
  end if;

  v_price := public.current_subscription_price(p_programme_id, p_membership_start_date);
  if v_price is null then
    return;
  end if;
  v_first_period := date_trunc('month', p_membership_start_date)::date;

  if v_programme.first_payment_policy = 'NEXT_COLLECTION_DAY' then
    if extract(day from p_membership_start_date)::int > v_programme.collection_day then
      return query select
        v_programme.first_payment_policy, v_price, v_price,
        (v_first_period + interval '1 month')::date,
        (v_first_period + interval '1 month')::date, (v_first_period + interval '1 month')::date,
        false;
    else
      return query select v_programme.first_payment_policy, v_price, v_price, v_first_period, v_first_period, v_first_period, false;
    end if;
  else
    if extract(day from p_membership_start_date)::int = 1 then
      return query select v_programme.first_payment_policy, v_price, v_price, v_first_period, v_first_period, v_first_period, false;
    else
      select * into v_proration from internal.calculate_first_month_proration(p_membership_start_date, v_price);
      return query select
        v_programme.first_payment_policy, v_price, v_proration.prorated_amount_minor, v_first_period,
        p_membership_start_date, (v_first_period + interval '1 month' - interval '1 day')::date,
        true;
    end if;
  end if;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 6. THE RESPONSIBLE PAYER IS AN ADULT WITH A REAL RELATIONSHIP
-- -----------------------------------------------------------------------------------------------------
create or replace function public.claim_responsible_payer(p_player_id uuid, p_programme_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
  v_relationship text;
  v_id uuid;
  v_pricing record;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  select club_id into v_club_id from public.club_subscription_programmes where id = p_programme_id and enabled = true;
  if v_club_id is null then
    raise exception 'This subscription programme is not available.';
  end if;

  if exists (select 1 from public.players where id = p_player_id and user_id = auth.uid()) then
    -- finance.payer.self is minor-prohibited in the catalogue, and this RPC is where it is enforced -- with the
    -- capability engine's own answer to "is this person a minor" (internal.person_is_minor). A child's
    -- membership is set up by a parent or guardian.
    if internal.person_is_minor(auth.uid()) then
      raise exception 'A player under 18 cannot be their own responsible payer. A parent or guardian sets up their membership.' using errcode = '42501';
    end if;
    v_relationship := 'self';
  elsif internal.is_active_player_guardian(p_player_id) then
    v_relationship := 'guardian';
  else
    raise exception 'You are not authorized to set up a subscription for this player.' using errcode = '42501';
  end if;

  if exists (select 1 from public.player_subscription_payers where player_id = p_player_id and programme_id = p_programme_id and status = 'active') then
    raise exception 'This player already has an active responsible payer. Ask a Club Admin to change it.';
  end if;

  if not exists (
    select 1 from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    where ptm.player_id = p_player_id and t.club_id = v_club_id and ptm.status = 'active'
  ) then
    raise exception 'This player does not have an active membership at this club.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || p_programme_id::text, 0));

  select * into v_pricing from internal.calculate_member_price(p_programme_id, auth.uid(), p_player_id, current_date);
  if v_pricing.final_amount_minor is null then
    raise exception 'No price is configured for this programme.';
  end if;

  insert into public.player_subscription_payers (
    player_id, programme_id, payer_user_id, relationship, created_by,
    sibling_ordinal, base_amount_minor, sibling_discount_type, sibling_discount_value, sibling_discount_amount_minor, final_amount_minor, pricing_id
  )
  values (
    p_player_id, p_programme_id, auth.uid(), v_relationship, auth.uid(),
    v_pricing.ordinal, v_pricing.base_amount_minor, v_pricing.discount_type, v_pricing.discount_value, v_pricing.discount_amount_minor, v_pricing.final_amount_minor, v_pricing.pricing_id
  )
  returning id into v_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (
    auth.uid(), v_club_id, 'payer_self_enrolled', 'player_subscription_payers', v_id,
    jsonb_build_object('player_id', p_player_id, 'relationship', v_relationship, 'sibling_ordinal', v_pricing.ordinal, 'final_amount_minor', v_pricing.final_amount_minor),
    'parent_ui'
  );

  return v_id;
end;
$function$;

create or replace function public.set_responsible_payer(p_player_id uuid, p_programme_id uuid, p_payer_user_id uuid, p_relationship text, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
  v_new_id uuid;
begin
  select club_id into v_club_id from public.club_subscription_programmes where id = p_programme_id;
  if v_club_id is null then
    raise exception 'Subscription programme not found.';
  end if;
  if not (internal.can('finance.enrolment.manage', 'club', v_club_id, null, null)) then
    raise exception 'You are not authorized to change the responsible payer for this club.' using errcode = '42501';
  end if;
  if p_relationship not in ('guardian', 'self') then
    raise exception 'Invalid payer relationship.';
  end if;
  -- The relationship claim must be backed by a real, active Guardian row for THIS PAYER -- never the caller's
  -- label, and never skipped because the caller happens to be a guardian themselves (it used to be: a Club
  -- Admin who was also the child's parent could name anybody as payer).
  if p_relationship = 'guardian'
     and not exists (select 1 from public.guardians where player_id = p_player_id and guardian_user_id = p_payer_user_id and status = 'active') then
    raise exception 'Payer is not an active guardian of this player.';
  end if;
  if p_relationship = 'self' and not exists (select 1 from public.players where id = p_player_id and user_id = p_payer_user_id) then
    raise exception 'Self-pay requires the payer to be the linked player account.';
  end if;
  if p_relationship = 'self' and internal.person_is_minor(p_payer_user_id) then
    raise exception 'A player under 18 cannot be their own responsible payer.' using errcode = '42501';
  end if;

  update public.player_subscription_payers
  set status = 'ended', effective_to = current_date, ended_by = auth.uid(), ended_at = now(), end_reason = coalesce(p_reason, 'Replaced by a new responsible payer.')
  where player_id = p_player_id and programme_id = p_programme_id and status = 'active';

  insert into public.player_subscription_payers (player_id, programme_id, payer_user_id, relationship, created_by)
  values (p_player_id, p_programme_id, p_payer_user_id, p_relationship, auth.uid())
  returning id into v_new_id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
  values (auth.uid(), v_club_id, 'payer_changed', 'player_subscription_payers', v_new_id, jsonb_build_object('player_id', p_player_id, 'payer_user_id', p_payer_user_id, 'relationship', p_relationship), 'admin_ui');

  return v_new_id;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 4. THE BILLING REQUEST'S CLUB IS THE ENROLMENT'S OWN
-- -----------------------------------------------------------------------------------------------------
create or replace function public.record_billing_request(p_payer_subscription_id uuid, p_club_id uuid, p_gc_billing_request_id text, p_gc_billing_request_flow_id text, p_authorisation_url text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_club_id uuid;
begin
  -- S6-9: the caller's Ovalball session must still be live and the account usable.
  -- SECURITY DEFINER bypasses RLS, so the RESTRICTIVE table gate never ran for this path.
  perform internal.require_live_session();
  -- The club comes from the enrolment the caller owns -- its programme's club -- never from the request. The
  -- client's id used to be stored as given and then copied into the customer and mandate rows, routing that
  -- family's mandate to another club's staff.
  select prog.club_id into v_club_id
    from public.player_subscription_payers psp
    join public.club_subscription_programmes prog on prog.id = psp.programme_id
   where psp.id = p_payer_subscription_id and psp.payer_user_id = auth.uid();
  if v_club_id is null then
    raise exception 'You are not authorized to start this enrolment.' using errcode = '42501';
  end if;
  if p_club_id is not null and p_club_id <> v_club_id then
    raise exception 'That enrolment belongs to a different club.' using errcode = '42501';
  end if;

  insert into public.gocardless_billing_requests (club_id, payer_subscription_id, gc_billing_request_id, gc_billing_request_flow_id, authorisation_url, created_by)
  values (v_club_id, p_payer_subscription_id, p_gc_billing_request_id, p_gc_billing_request_flow_id, p_authorisation_url, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 5. NOTHING TO COLLECT IS EXEMPT; ONE MEMBER NEVER STOPS ANOTHER
-- -----------------------------------------------------------------------------------------------------
-- A zero amount can exist only as a month the club asked nothing for -- exempt or waived -- so nothing with a
-- zero amount can ever be collected. Every other obligation still owes more than nothing.
alter table public.membership_obligations drop constraint membership_obligations_amount_due_minor_check;
alter table public.membership_obligations add constraint membership_obligations_amount_due_minor_check
  check (amount_due_minor > 0 or (amount_due_minor = 0 and status in ('EXEMPT', 'WAIVED')));

create or replace function public.create_membership_obligations_for_period(p_club_id uuid, p_billing_period date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_programme record;
  v_created integer := 0;
  v_payer record;
  v_price integer;
  v_pricing_id uuid;
  v_due_date date;
  v_payer_first_period date;
  v_proration record;
  v_amount integer;
  v_is_prorated boolean;
  v_prorate_days integer;
  v_prorate_total integer;
  v_price_as_of date;
  v_status text;
  v_error text;
begin
  if not (
    false
    or internal.can('finance.enrolment.manage', 'club', p_club_id, null, null)
    or auth.role() = 'service_role'
  ) then
    raise exception 'You are not authorized to generate obligations for this club.' using errcode = '42501';
  end if;
  if p_billing_period <> date_trunc('month', p_billing_period)::date then
    raise exception 'billing_period must be the first day of a month.';
  end if;

  select * into v_programme from public.club_subscription_programmes where club_id = p_club_id and enabled = true;
  if v_programme is null then
    return 0;
  end if;

  v_due_date := p_billing_period + (v_programme.collection_day - 1);

  for v_payer in
    select psp.id as payer_subscription_id, psp.player_id, psp.effective_from, psp.final_amount_minor, psp.pricing_id as snapshot_pricing_id
    from public.player_subscription_payers psp
    where psp.programme_id = v_programme.id and psp.status = 'active'
  loop
    -- ONE MEMBER'S PROBLEM IS THAT MEMBER'S. Each payer is generated on its own, and a failure is recorded where
    -- the club's finance history shows it (finance_audit_log) instead of rolling back the whole club's month.
    begin
      v_payer_first_period := date_trunc('month', v_payer.effective_from)::date;
      v_is_prorated := false;
      v_prorate_days := null;
      v_prorate_total := null;

      if v_payer_first_period > p_billing_period then
        continue;
      end if;

      if v_payer.final_amount_minor is not null then
        v_price := v_payer.final_amount_minor;
        v_pricing_id := v_payer.snapshot_pricing_id;
      else
        v_price_as_of := case when v_payer_first_period = p_billing_period then v_payer.effective_from else p_billing_period end;
        v_pricing_id := (select id from public.club_subscription_pricing where programme_id = v_programme.id and effective_from <= v_price_as_of order by effective_from desc limit 1);
        v_price := public.current_subscription_price(v_programme.id, v_price_as_of);
      end if;
      if v_price is null then
        raise exception 'No price is configured for this programme as of %.', p_billing_period;
      end if;

      if v_payer_first_period < p_billing_period then
        v_amount := v_price;
      else
        if v_programme.first_payment_policy = 'NEXT_COLLECTION_DAY' then
          if extract(day from v_payer.effective_from)::int > v_programme.collection_day then
            continue;
          else
            v_amount := v_price;
          end if;
        else
          if extract(day from v_payer.effective_from)::int = 1 then
            v_amount := v_price;
          else
            select * into v_proration from internal.calculate_first_month_proration(v_payer.effective_from, v_price);
            v_amount := v_proration.prorated_amount_minor;
            v_is_prorated := true;
            v_prorate_days := v_proration.chargeable_days;
            v_prorate_total := v_proration.total_days_in_month;
          end if;
        end if;
      end if;

      -- NOTHING TO COLLECT IS EXEMPT, NOT AN ERROR. A 100% sibling discount (or a free price) gives a zero amount:
      -- it is recorded as an exempt month -- history says the club asked nothing -- and is never collected. It
      -- used to break the amount check and roll back every other member's month with it.
      v_status := case when v_amount = 0 then 'EXEMPT' else 'SETUP_PENDING' end;
      insert into public.membership_obligations (
        programme_id, club_id, player_id, payer_subscription_id, pricing_id, billing_period, amount_due_minor, currency, due_date, status,
        first_payment_policy_used, is_prorated, proration_chargeable_days, proration_total_days, membership_effective_date,
        resolved_at, resolved_reason
      )
      values (
        v_programme.id, p_club_id, v_payer.player_id, v_payer.payer_subscription_id, v_pricing_id, p_billing_period, v_amount, v_programme.currency, v_due_date, v_status,
        v_programme.first_payment_policy, v_is_prorated, v_prorate_days, v_prorate_total, v_payer.effective_from,
        case when v_status = 'EXEMPT' then now() end,
        case when v_status = 'EXEMPT' then 'Nothing to collect: this membership''s price after discount is zero.' end
      )
      on conflict (player_id, programme_id, billing_period) do nothing;
      if found then
        v_created := v_created + 1;
      end if;
    exception when others then
      get stacked diagnostics v_error = message_text;
      insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, new_value, source)
      values (auth.uid(), p_club_id, 'obligation_generation_failed', 'player_subscription_payers', v_payer.payer_subscription_id,
              jsonb_build_object('billing_period', p_billing_period, 'error', v_error), 'system');
    end;
  end loop;

  return v_created;
end;
$function$;


-- -----------------------------------------------------------------------------------------------------
-- 1. A CLAIMABLE EVENT INBOX
-- -----------------------------------------------------------------------------------------------------
alter table public.gocardless_events
  add column if not exists attempts integer not null default 1,
  add column if not exists claimed_until timestamptz,
  add column if not exists last_attempt_at timestamptz;

-- Returns the event's id when this delivery should process it: a new event, or one recorded before that is
-- still unprocessed and not held by a live claim. NULL means "already done, or being done right now" -- the
-- only two cases where skipping is right.
create or replace function public.record_gocardless_event(p_gc_event_id text, p_resource_type text, p_action text, p_payload jsonb, p_club_id uuid default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  insert into public.gocardless_events (club_id, gc_event_id, resource_type, action, payload, attempts, claimed_until, last_attempt_at)
  values (p_club_id, p_gc_event_id, p_resource_type, p_action, p_payload, 1, now() + interval '2 minutes', now())
  on conflict (gc_event_id) do update
     set attempts = public.gocardless_events.attempts + 1,
         claimed_until = now() + interval '2 minutes',
         last_attempt_at = now()
   where public.gocardless_events.processed = false
     and (public.gocardless_events.claimed_until is null or public.gocardless_events.claimed_until < now())
  returning id into v_id;
  return v_id;
end;
$function$;

-- Success marks it processed; a failure keeps it unprocessed WITH its reason, and releases the claim so the
-- next delivery (or a replay) takes it again.
create or replace function public.mark_gocardless_event_processed(p_event_id uuid, p_error text default null)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  update public.gocardless_events
     set processed = (p_error is null),
         processed_at = case when p_error is null then now() else processed_at end,
         processing_error = p_error,
         claimed_until = null
   where id = p_event_id;
$function$;

-- Events GoCardless has stopped redelivering: unprocessed, not claimed for five minutes, under the attempt
-- ceiling. Claimed here (skip locked, so two replays never take the same event) and handed back to be
-- processed by the same code the webhook uses.
create or replace function public.claim_stale_gocardless_events(p_limit integer default 20, p_max_attempts integer default 12)
 returns table(id uuid, payload jsonb)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return query
  with stale as (
    select e.id
      from public.gocardless_events e
     where e.processed = false
       and e.attempts < p_max_attempts
       and coalesce(e.claimed_until, e.last_attempt_at, e.created_at) < now() - interval '5 minutes'
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
revoke all on function public.record_gocardless_event(text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.mark_gocardless_event_processed(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_stale_gocardless_events(integer, integer) from public, anon, authenticated;
grant execute on function public.record_gocardless_event(text, text, text, jsonb, uuid) to service_role;
grant execute on function public.mark_gocardless_event_processed(uuid, text) to service_role;
grant execute on function public.claim_stale_gocardless_events(integer, integer) to service_role;


-- -----------------------------------------------------------------------------------------------------
-- 2. A STATUS NEVER MOVES BACKWARDS
-- -----------------------------------------------------------------------------------------------------
alter table public.gocardless_payments add column if not exists status_observed_at timestamptz;

drop function public.apply_payment_status_transition(text, text, text, date, text);
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
  v_observed timestamptz := coalesce(p_observed_at, now());
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
      failure_reason_code = coalesce(p_failure_reason_code, failure_reason_code),
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
revoke all on function public.apply_payment_status_transition(text, text, text, date, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_payment_status_transition(text, text, text, date, text, timestamptz) to service_role;


-- -----------------------------------------------------------------------------------------------------
-- 3. NO USABLE TOKEN OUTLIVES ITS CONNECTION, AND CONNECTING IS ON THE RECORD
-- -----------------------------------------------------------------------------------------------------
insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason) values
  ('payment_provider.connected', 'OPERATIONS', 'INFO', true, false, false),
  ('payment_provider.disconnected', 'OPERATIONS', 'WARNING', true, false, true),
  ('payment_provider.revoked_by_merchant', 'OPERATIONS', 'WARNING', true, false, false)
on conflict (event_type) do nothing;

alter table public.gocardless_merchant_connections alter column access_token drop not null;

-- Tokens waiting to be revoked at GoCardless: written by disconnect and reconnect in the same transaction as
-- the token leaves its connection, read and deleted only by the service that calls /oauth/revoke. No signed-in
-- role can read it.
create table if not exists internal.gocardless_token_revocations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null,
  environment text not null check (environment in ('sandbox', 'production')),
  gc_organisation_id text,
  access_token text not null,
  reason text,
  requested_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text
);
revoke all on internal.gocardless_token_revocations from public, anon, authenticated;
grant select, insert, update, delete on internal.gocardless_token_revocations to service_role;

create or replace function public.disconnect_gocardless(p_club_id uuid, p_reason text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_conn public.gocardless_merchant_connections;
begin
  if not (internal.can('finance.gocardless.connect', 'club', p_club_id, null, null)) then
    raise exception 'You are not authorized to disconnect GoCardless for this club.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required to disconnect GoCardless.';
  end if;

  select * into v_conn from public.gocardless_merchant_connections
   where club_id = p_club_id and disconnected_at is null for update;
  if v_conn.id is null then
    raise exception 'No active GoCardless connection found for this club.';
  end if;

  -- The token leaves the connection now, and is queued to be revoked at GoCardless (a disconnected club's
  -- token used to stay, in plain text, able to act on the club's account).
  if v_conn.access_token is not null then
    insert into internal.gocardless_token_revocations (club_id, environment, gc_organisation_id, access_token, reason)
    values (p_club_id, v_conn.environment, v_conn.gc_organisation_id, v_conn.access_token, 'disconnected');
  end if;
  update public.gocardless_merchant_connections
     set disconnected_at = now(), disconnected_by = auth.uid(), access_token = null
   where id = v_conn.id;

  insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
  values (auth.uid(), p_club_id, 'gocardless_disconnected', 'gocardless_merchant_connections', v_conn.id,
          jsonb_build_object('environment', v_conn.environment, 'gc_organisation_id', v_conn.gc_organisation_id, 'connected_at', v_conn.connected_at),
          jsonb_build_object('reason', btrim(p_reason)), 'admin_ui');
  perform internal.emit_security_event('payment_provider.disconnected', auth.uid(), 'SUCCESS', btrim(p_reason),
    jsonb_build_object('environment', v_conn.environment, 'gc_organisation_id', v_conn.gc_organisation_id), p_club_id);
end;
$function$;

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

  -- A live token this connection replaces is revoked, not overwritten and forgotten.
  select * into v_previous from public.gocardless_merchant_connections where club_id = p_club_id for update;
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

-- GoCardless tells Ovalball when a club removes the app from its own account: the token is already dead at
-- GoCardless, so it is simply removed here, the connection marked disconnected, and the fact recorded.
create or replace function public.record_gocardless_app_disconnected(p_gc_organisation_id text)
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
     where gc_organisation_id = p_gc_organisation_id and disconnected_at is null
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

-- The revocation queue, through the API: claim a batch, then finish each one (deleted when GoCardless has
-- revoked it; kept with its error, and retried, when it has not).
create or replace function public.claim_gocardless_token_revocations(p_limit integer default 20)
 returns table(id uuid, environment text, access_token text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  return query
  with next_up as (
    select r.id from internal.gocardless_token_revocations r
     order by r.requested_at
     limit greatest(1, least(p_limit, 100))
     for update skip locked
  )
  update internal.gocardless_token_revocations r
     set attempts = r.attempts + 1
    from next_up
   where r.id = next_up.id
  returning r.id, r.environment, r.access_token;
end;
$function$;

create or replace function public.finish_gocardless_token_revocation(p_id uuid, p_error text default null)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if p_error is null then
    delete from internal.gocardless_token_revocations where id = p_id;
  else
    update internal.gocardless_token_revocations set last_error = left(p_error, 500) where id = p_id;
  end if;
end;
$function$;
revoke all on function public.record_gocardless_app_disconnected(text) from public, anon, authenticated;
revoke all on function public.claim_gocardless_token_revocations(integer) from public, anon, authenticated;
revoke all on function public.finish_gocardless_token_revocation(uuid, text) from public, anon, authenticated;
grant execute on function public.record_gocardless_app_disconnected(text) to service_role;
grant execute on function public.claim_gocardless_token_revocations(integer) to service_role;
grant execute on function public.finish_gocardless_token_revocation(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 7. A MANDATE THE PAYER SUSPENDED, OR ONE GOCARDLESS BLOCKED, IS RECORDED AS SUCH
--
-- GoCardless documents `suspended_by_payer` and `blocked` among a mandate's statuses
-- (https://docs.gocardless.com/docs/api-reference/mandate). Neither was recognised: reconciliation stored
-- "no change" for a status it did not know, so a suspended Direct Debit kept reading Active -- and the
-- membership it served kept reading as collecting. The table now holds both, reconciliation recognises
-- them (lib/payments/gocardless/reconcile.ts), and the membership standing counts them as a Direct Debit
-- problem (20270746000000).
-- ---------------------------------------------------------------------------------------------------
alter table public.gocardless_mandates drop constraint if exists gocardless_mandates_status_check;
alter table public.gocardless_mandates add constraint gocardless_mandates_status_check
  check (status = any (array['pending_submission'::text, 'submitted'::text, 'active'::text, 'failed'::text, 'cancelled'::text,
                             'expired'::text, 'consumed'::text, 'suspended_by_payer'::text, 'blocked'::text]));
