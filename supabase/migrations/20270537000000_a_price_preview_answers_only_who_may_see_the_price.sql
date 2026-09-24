-- ===========================================================================
-- A PRICE PREVIEW ANSWERS ONLY WHO MAY SEE THE PRICE
-- ===========================================================================
--
-- CA-M0 mapped `preview_first_payment_illustrative(p_programme_id, p_membership_start_date)` as an
-- ungated price oracle: SECURITY DEFINER, granted to `authenticated`, and answering for ANY
-- programme id with the club's current monthly amount, its first-payment policy and the first
-- charge -- while the tables it reads (`club_subscription_programmes`, `club_subscription_pricing`)
-- carry a scoped read policy that admits only the club's finance holders, the club's enrolment
-- holders, and the guardians and players of that club's own members.
--
-- Triage: the exposure is real but narrow. The value is a club's membership fee and its
-- first-payment policy -- something every enrolling family is told -- and the key is a programme
-- uuid that is not enumerable and is itself only readable through the scoped policy. It is still a
-- server-side answer given past the table's own policy, and the rule here is that a SECURITY
-- DEFINER read never answers wider than the policy on the rows it reads. So the preview now asks
-- the same question the policy asks, for the programme's club, and returns nothing otherwise --
-- exactly as it already returns nothing for an unknown programme, so an outsider learns neither
-- the price nor whether the programme exists.
--
-- Forward-only. No grant changes: the club's own settings page (a finance.subscription.configure
-- holder) is the one caller and keeps its answer. Data untouched.
-- ===========================================================================

create or replace function public.preview_first_payment_illustrative(p_programme_id uuid, p_membership_start_date date default current_date)
returns table(policy text, monthly_amount_minor integer, first_charge_amount_minor integer, first_charge_billing_period date, covers_from date, covers_to date, is_prorated boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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

  -- THE SAME QUESTION THE ROW POLICY ASKS. An answer this function gives is an answer the caller
  -- could already have read from the programme and pricing rows themselves; nothing wider.
  if not (
    internal.has_site_capability('site.commercial.view')
    or internal.has_capability('finance.subscription.configure', 'club', v_programme.club_id, null)
    or internal.has_capability('finance.subscription.view', 'club', v_programme.club_id, null)
    or internal.has_capability('finance.enrolment.manage', 'club', v_programme.club_id, null)
    or exists (
      select 1
      from public.player_team_memberships ptm
      join public.teams t on t.id = ptm.team_id
      where t.club_id = v_programme.club_id
        and ptm.status = 'active'
        and (internal.is_active_player_guardian(ptm.player_id) or internal.is_own_linked_player(ptm.player_id))
    )
  ) then
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

comment on function public.preview_first_payment_illustrative(uuid, date) is
  'A worked example of a programme''s first payment, computed server-side from the club''s configured price and policy so the settings page can never drift from create_membership_obligations_for_period. Answers only for a caller who may read the programme''s own rows (the same predicate as club_subscription_programmes_select_scoped); returns nothing otherwise, exactly as for an unknown programme.';

-- The guard: the predicate must be present, and the grants must be exactly what they were.
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'preview_first_payment_illustrative';
  if v_src !~ 'finance\.subscription\.view' or v_src !~ 'is_active_player_guardian' then
    raise exception 'preview_first_payment_illustrative is not gated on the programme''s own read predicate';
  end if;
  if has_function_privilege('anon', 'public.preview_first_payment_illustrative(uuid, date)', 'EXECUTE') then
    raise exception 'preview_first_payment_illustrative must not be executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.preview_first_payment_illustrative(uuid, date)', 'EXECUTE') then
    raise exception 'preview_first_payment_illustrative must stay executable by authenticated callers (the answer is gated inside)';
  end if;
end $$;
