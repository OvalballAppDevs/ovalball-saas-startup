-- =====================================================================================================
-- A FAMILY SEES WHAT THE DIRECT DEBIT COLLECTS, AND WHO PAYS OVALBALL'S FEE (Club Memberships, Part 1)
--
-- OWNER-LOCKED (6 October 2026): each club chooses who pays Ovalball's 2.5% -- the club, or its members -- and
-- "the review and the parent setup must state which". Until now a family's Direct Debit page showed the
-- membership price alone and said "the 1st of each month" whatever the club's collection day. When a club's
-- members pay the fee, the Direct Debit collected more than the page said.
--
-- `family_membership_charge` is the one answer the website and the app give a family before and after they set
-- the Direct Debit up: the membership, its monthly price for this payer (sibling pricing included), who pays
-- Ovalball's fee, what the Direct Debit collects each month, the club's collection day, and -- before set-up --
-- the first payment if they set it up today. Every figure comes from the rules the generator, activation and the
-- club's own worked example already use (`internal.calculate_member_price`, `membership_first_payment_example`,
-- the enrolment's snapshot); nothing here is a second calculation.
--
-- WHO MAY ASK: whoever may pay for the player (finance.payer.self: an active guardian, or the adult player themself) --
-- and only about a club where the
-- player has an active team place or an active membership, so a family cannot use it to read another club's
-- prices. Once somebody has set the membership up, the answer is that enrolment's own snapshot -- to its payer.
-- A guardian who is not the payer is told that somebody else pays, never the payer's figures.
-- =====================================================================================================

create or replace function public.family_membership_charge(p_player_id uuid, p_club_id uuid)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_actor uuid := internal.actor();
  v_prog public.club_subscription_programmes;
  v_psp public.player_subscription_payers;
  v_product uuid;
  v_monthly integer;
  v_mode text;
  v_bps integer;
  v_fee integer;
  v_payer_pays boolean;
  v_collection_day integer;
  v_first jsonb;
begin
  if v_actor is null or not internal.session_ok() then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- WHO MAY PAY FOR THIS PLAYER: an active guardian, or the adult player -- the canonical family decision.
  if p_player_id is null or p_club_id is null or not internal.can_player_as_family('finance.payer.self', p_player_id) then
    raise exception 'You are not authorised to see this player''s membership.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.player_team_memberships ptm
                   join public.teams t on t.id = ptm.team_id
                  where ptm.player_id = p_player_id and t.club_id = p_club_id and ptm.state = 'ACTIVE')
     and not exists (select 1 from public.player_subscription_payers psp
                       join public.club_subscription_programmes p on p.id = psp.programme_id
                      where psp.player_id = p_player_id and p.club_id = p_club_id and psp.status = 'active') then
    raise exception 'You are not authorised to see this player''s membership.' using errcode = '42501';
  end if;

  select * into v_prog from public.club_subscription_programmes where club_id = p_club_id;
  if v_prog.id is null then
    return jsonb_build_object('club_id', p_club_id, 'programme_id', null, 'taking_memberships', false);
  end if;

  select * into v_psp from public.player_subscription_payers
   where player_id = p_player_id and programme_id = v_prog.id and status = 'active';

  -- SOMEBODY ELSE PAYS: that they do, and nothing of theirs.
  if v_psp.id is not null and v_psp.payer_user_id <> v_actor then
    return jsonb_build_object(
      'club_id', p_club_id, 'programme_id', v_prog.id, 'taking_memberships', v_prog.enabled,
      'membership', (select jsonb_build_object('id', mp.id, 'name', mp.name) from public.membership_products mp where mp.id = v_psp.product_id),
      'set_up', true, 'you_pay', false);
  end if;

  if v_psp.id is not null then
    -- SET UP, AND THIS PERSON PAYS: the enrolment's own snapshot (membership_charge_plan's rules).
    v_product := v_psp.product_id;
    v_monthly := coalesce(v_psp.final_amount_minor, (select x.amount_minor from internal.membership_product_price(v_psp.product_id, current_date) x));
    v_mode := v_psp.platform_fee_mode;
    v_bps := case when internal.fee_mode_is_chosen(v_psp.platform_fee_mode) then coalesce(v_psp.platform_fee_bps, 0) else 0 end;
    v_collection_day := coalesce(v_psp.collection_day, v_prog.collection_day);
  else
    -- NOT SET UP YET: what it would be for this person, joining today.
    v_product := internal.membership_product_for_player(p_club_id, p_player_id, current_date);
    v_monthly := (select x.final_amount_minor from internal.calculate_member_price(v_prog.id, v_actor, p_player_id, current_date) x);
    v_mode := v_prog.platform_fee_mode;
    v_bps := case when internal.fee_mode_is_chosen(v_prog.platform_fee_mode) then internal.ovalball_fee_bps() else 0 end;
    v_collection_day := v_prog.collection_day;
  end if;

  v_payer_pays := v_mode = 'PAYER_SURCHARGE';
  v_fee := case when v_monthly is null then null else internal.ovalball_fee_minor(v_monthly, v_bps) end;

  if v_psp.id is null and v_monthly is not null and v_monthly > 0 then
    v_first := public.membership_first_payment_example(
      p_club_id, v_monthly, current_date, v_collection_day, v_prog.first_payment_policy,
      case v_mode when 'GOCARDLESS_APP_FEE' then 'CLUB' when 'PAYER_SURCHARGE' then 'PAYER' end);
  end if;

  return jsonb_build_object(
    'club_id', p_club_id,
    'programme_id', v_prog.id,
    'taking_memberships', v_prog.enabled,
    'membership', (select jsonb_build_object('id', mp.id, 'name', mp.name) from public.membership_products mp where mp.id = v_product),
    'set_up', v_psp.id is not null,
    'you_pay', true,
    'collection_day', v_collection_day,
    'first_payment_policy', v_prog.first_payment_policy,
    'currency', v_prog.currency,
    'fee_bps', v_bps,
    'fee_bearer', case v_mode when 'GOCARDLESS_APP_FEE' then 'CLUB' when 'PAYER_SURCHARGE' then 'PAYER' end,
    'monthly_amount_minor', v_monthly,
    'monthly_fee_minor', v_fee,
    'monthly_collect_minor', case when v_monthly is null then null else v_monthly + case when v_payer_pays then v_fee else 0 end end,
    'first', v_first);
end;
$function$;

revoke all on function public.family_membership_charge(uuid, uuid) from public, anon;
grant execute on function public.family_membership_charge(uuid, uuid) to authenticated;

comment on function public.family_membership_charge(uuid, uuid) is
  'What a family''s Direct Debit collects for a player''s membership at a club, who pays Ovalball''s fee, the collection day and (before set-up) the first payment. Guardian or the player''s own account only, for a club where the player has a place or a membership; a non-paying guardian learns only that somebody else pays.';
