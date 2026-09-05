-- Side Project 1 integration (SIDE_PROJECT_1_FINAL_INTEGRATION_2026_09_05),
-- Phase 2 follow-up: 5 functions the previous migration's name-pattern
-- search (matching "gocardless"/"subscription"/etc. in the function name)
-- missed entirely, because these five don't contain any of those
-- substrings -- found only by cross-referencing the TypeScript provider
-- layer's own RPC calls against a full scan of every function whose BODY
-- references one of this domain's 16 tables. Verbatim from Side Project
-- 1's live database, same verification standard as the schema migration.
CREATE OR REPLACE FUNCTION public.apply_payment_status_transition(p_gc_payment_id text, p_new_status text, p_failure_reason_code text DEFAULT NULL::text, p_charge_date date DEFAULT NULL::date, p_gc_event_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_payment record;
  v_obligation_status text;
  v_payer_user_id uuid;
  v_player_name text;
begin
  select * into v_payment from public.gocardless_payments where gc_payment_id = p_gc_payment_id for update;
  if v_payment is null then
    return;
  end if;

  update public.gocardless_payments
  set status = p_new_status,
      failure_reason_code = coalesce(p_failure_reason_code, failure_reason_code),
      charge_date = coalesce(p_charge_date, charge_date),
      submitted_at = case when p_new_status = 'submitted' then now() else submitted_at end,
      confirmed_at = case when p_new_status = 'confirmed' then now() else confirmed_at end,
      failed_at = case when p_new_status = 'failed' then now() else failed_at end
  where id = v_payment.id;

  if p_new_status is distinct from v_payment.status then
    insert into public.finance_audit_log (actor_user_id, club_id, action, target_table, target_id, old_value, new_value, source)
    values (
      null,
      v_payment.club_id,
      'payment_status_transition',
      'gocardless_payments',
      v_payment.id,
      jsonb_build_object('status', v_payment.status),
      jsonb_build_object('status', p_new_status, 'gc_payment_id', p_gc_payment_id, 'gc_event_id', p_gc_event_id),
      'webhook'
    );
  end if;

  if p_new_status = 'failed' and v_payment.status is distinct from 'failed' then
    select psp.payer_user_id, p.first_name || ' ' || p.surname
    into v_payer_user_id, v_player_name
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
        jsonb_build_object('obligation_id', v_payment.obligation_id, 'gc_payment_id', p_gc_payment_id)
      );
    end if;
  end if;

  v_obligation_status := case
    when p_new_status = 'submitted' and v_payment.status = 'failed' then 'RETRYING'
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
      and status not in ('CANCELLED', 'REFUNDED', 'CHARGEDBACK', 'EXEMPT', 'WAIVED');
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_enrolment_eligibility(p_player_id uuid, p_club_id uuid)
 RETURNS TABLE(programme_enabled boolean, has_pricing boolean, merchant_verified boolean, player_has_active_membership boolean, existing_payer_subscription_id uuid, programme_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce(p.enabled, false),
    exists (select 1 from public.club_subscription_pricing cp where cp.programme_id = p.id),
    coalesce((select mc.verification_status = 'successful' from public.gocardless_merchant_connections mc where mc.club_id = p_club_id and mc.disconnected_at is null), false),
    exists (
      select 1 from public.player_team_memberships ptm join public.teams t on t.id = ptm.team_id
      where ptm.player_id = p_player_id and t.club_id = p_club_id and ptm.status = 'active'
    ),
    (select psp.id from public.player_subscription_payers psp where psp.player_id = p_player_id and psp.programme_id = p.id and psp.status = 'active'),
    p.id
  from public.club_subscription_programmes p
  where p.club_id = p_club_id
    and (internal.is_own_linked_player(p_player_id) or internal.is_active_player_guardian(p_player_id) or internal.has_capability('club.subscription.manage_enrolment', 'club', p_club_id, null));
$function$
;

CREATE OR REPLACE FUNCTION public.get_first_collection_date(p_programme_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when extract(day from p_as_of)::int <= p.collection_day then
      date_trunc('month', p_as_of)::date + (p.collection_day - 1)
    else
      (date_trunc('month', p_as_of)::date + interval '1 month')::date + (p.collection_day - 1)
  end
  from public.club_subscription_programmes p
  where p.id = p_programme_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_membership_operational_detail(p_payer_subscription_id uuid)
 RETURNS TABLE(payer_subscription_id uuid, payer_status text, payer_effective_from date, payer_effective_to date, payer_end_reason text, player_id uuid, player_first_name text, player_surname text, payer_first_name text, payer_surname text, payer_email text, club_id uuid, programme_amount_minor integer, programme_first_payment_policy text, programme_collection_day integer, gc_mandate_id text, mandate_status text, gc_subscription_id text, subscription_status text, subscription_amount_minor integer, sibling_ordinal integer, base_amount_minor integer, sibling_discount_type text, sibling_discount_value integer, sibling_discount_amount_minor integer, final_amount_minor integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club_id uuid;
begin
  select p.club_id into v_club_id
  from public.player_subscription_payers psp
  join public.club_subscription_programmes p on p.id = psp.programme_id
  where psp.id = p_payer_subscription_id;

  if v_club_id is null then
    raise exception 'Membership not found.';
  end if;

  if not (internal.is_site_admin() or internal.has_capability('club.subscription.view_finance', 'club', v_club_id, null) or internal.has_capability('club.subscription.manage_payment_actions', 'club', v_club_id, null) or internal.has_capability('club.subscription.manage_enrolment', 'club', v_club_id, null)) then
    raise exception 'You are not authorized to view this membership.' using errcode = '42501';
  end if;

  return query
  select
    psp.id, psp.status, psp.effective_from, psp.effective_to, psp.end_reason,
    pl.id, pl.first_name, pl.surname,
    pr.first_name, pr.surname, u.email::text,
    v_club_id,
    cp.amount_minor, prog.first_payment_policy, prog.collection_day,
    gm.gc_mandate_id, gm.status,
    gs.gc_subscription_id, gs.status, gs.amount_minor,
    psp.sibling_ordinal, psp.base_amount_minor, psp.sibling_discount_type, psp.sibling_discount_value, psp.sibling_discount_amount_minor, psp.final_amount_minor
  from public.player_subscription_payers psp
  join public.players pl on pl.id = psp.player_id
  join public.club_subscription_programmes prog on prog.id = psp.programme_id
  left join public.profiles pr on pr.id = psp.payer_user_id
  left join auth.users u on u.id = psp.payer_user_id
  left join lateral (
    select amount_minor from public.club_subscription_pricing where programme_id = prog.id and effective_from <= current_date order by effective_from desc limit 1
  ) cp on true
  left join public.gocardless_subscriptions gs on gs.payer_subscription_id = psp.id and gs.status in ('pending', 'active')
  left join public.gocardless_mandates gm on gm.id = gs.gocardless_mandate_id
  where psp.id = p_payer_subscription_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_billing_request(p_payer_subscription_id uuid, p_club_id uuid, p_gc_billing_request_id text, p_gc_billing_request_flow_id text, p_authorisation_url text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.player_subscription_payers psp where psp.id = p_payer_subscription_id and psp.payer_user_id = auth.uid()) then
    raise exception 'You are not authorized to start this enrolment.' using errcode = '42501';
  end if;

  insert into public.gocardless_billing_requests (club_id, payer_subscription_id, gc_billing_request_id, gc_billing_request_flow_id, authorisation_url, created_by)
  values (p_club_id, p_payer_subscription_id, p_gc_billing_request_id, p_gc_billing_request_flow_id, p_authorisation_url, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$
;


grant execute on function public.get_enrolment_eligibility(p_player_id uuid, p_club_id uuid) to authenticated;
grant execute on function public.get_first_collection_date(p_programme_id uuid, p_as_of date) to anon;
grant execute on function public.get_first_collection_date(p_programme_id uuid, p_as_of date) to authenticated;
grant execute on function public.get_membership_operational_detail(p_payer_subscription_id uuid) to authenticated;
grant execute on function public.record_billing_request(p_payer_subscription_id uuid, p_club_id uuid, p_gc_billing_request_id text, p_gc_billing_request_flow_id text, p_authorisation_url text) to authenticated;
-- apply_payment_status_transition: service_role-only (webhook-driven), no
-- anon/authenticated grant -- matches its live source exactly.
