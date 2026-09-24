-- ===========================================================================
-- THE PRICE PREVIEW ASKS THE CANONICAL RESOLVER
-- ===========================================================================
--
-- 20270537 contained the price oracle by making `preview_first_payment_illustrative` ask the same
-- question as the programme rows' read policy. It copied the policy's predicate verbatim -- and the
-- policy is written with two LEGACY helpers (`internal.has_capability`, `internal.is_own_linked_player`)
-- whose reference counts the helper-retirement ledger (`authority_helper_retirement.sql`) only lets
-- shrink. A SECURITY DEFINER body is the wrong place to add a legacy reference: the whole point of
-- Slice 4 is that new code asks the canonical decision.
--
-- Same answer, canonical wording: club authority through `internal.can` (the capability decision the
-- policy's `has_capability` wrapper resolves to anyway), and the family branch through
-- `internal.can_player_as_family('finance.payer.self', player)` -- the catalogue's own "who pays for
-- this player" capability (scopes self and child), which is what "a guardian or the adult player
-- themself of a member of this club" means. The site master and the grants are unchanged.
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

  -- THE SAME QUESTION THE ROW POLICY ASKS, through the canonical resolver: the club's finance and
  -- enrolment holders, the site's commercial viewer, or somebody who pays for a member of this club.
  if not (
    internal.has_site_capability('site.commercial.view')
    or internal.can('finance.subscription.configure', 'club', v_programme.club_id, null, null)
    or internal.can('finance.subscription.view', 'club', v_programme.club_id, null, null)
    or internal.can('finance.enrolment.manage', 'club', v_programme.club_id, null, null)
    or exists (
      select 1
      from public.player_team_memberships ptm
      join public.teams t on t.id = ptm.team_id
      where t.club_id = v_programme.club_id
        and ptm.status = 'active'
        and internal.can_player_as_family('finance.payer.self', ptm.player_id)
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

do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'preview_first_payment_illustrative';
  if v_src ~ '\mhas_capability\(' or v_src ~ '\mis_own_linked_player\(' or v_src ~ '\mis_active_player_guardian\(' then
    raise exception 'preview_first_payment_illustrative must ask the canonical resolver, not a legacy helper';
  end if;
  if v_src !~ 'can_player_as_family\(''finance\.payer\.self''' then
    raise exception 'preview_first_payment_illustrative must gate the family branch on finance.payer.self';
  end if;
  if has_function_privilege('anon', 'public.preview_first_payment_illustrative(uuid, date)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.preview_first_payment_illustrative(uuid, date)', 'EXECUTE') then
    raise exception 'preview_first_payment_illustrative grants changed';
  end if;
end $$;
