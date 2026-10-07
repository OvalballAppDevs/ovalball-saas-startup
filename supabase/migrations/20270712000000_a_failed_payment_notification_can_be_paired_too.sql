-- NOTIFICATIONS PLATFORM PROGRAMME, PHASE E: a failed-payment notification could not be paired to the
-- live attention projection at all -- not because nobody wired notificationAttentionId for it, but
-- because its payload never carried the id the pairing would need. `gocardless_payment_failed` has
-- always carried `obligation_id`; the family attention projection's money row
-- (packages/contracts/src/attention/family.ts) is keyed `family_subscription:<playerId>`. No client
-- code could have bridged that without guessing, which is exactly what "no client-side guesses" rules
-- out -- the fix belongs here, at the producer, not in a client lookup.
--
-- Every other line of this function is unchanged from its live definition (20260928400000) -- only
-- the player_id lookup and its addition to the notification payload are new.

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
  v_player_id uuid;
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
$function$;
