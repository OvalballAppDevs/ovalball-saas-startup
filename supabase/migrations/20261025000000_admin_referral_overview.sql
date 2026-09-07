-- Dashboard R-5: Site Admin Referral Administration.
--
-- One canonical read view, same shape/convention as admin_club_overview:
-- security_invoker, joins the REAL chain (platform_referrals ->
-- club_ovalball_invitations -> referring/referred clubs -> reward credit ->
-- qualifying payment) and invents nothing. The referrer/beneficiary is
-- always THE REFERRING CLUB (referring_club_id), never a person -- no
-- profile/user name is selected here at all except invited_by/created_by
-- for legitimate "who actioned this" traceability.

create or replace view public.admin_referral_overview
with (security_invoker = true) as
select
  r.id as referral_id,
  r.status,
  r.attribution_source,
  r.rejection_reason,
  r.created_at,
  r.updated_at,
  r.qualified_at,
  r.reversed_at,

  r.referring_club_id,
  coalesce(rcd.name, rc.slug) as referring_club_name,

  r.referred_club_id,
  coalesce(fcd.name, fc.slug) as referred_club_name,
  fc.created_at as referred_club_activated_at,

  r.invitation_id,
  inv.contact_email as invitation_contact_email,
  inv.status as invitation_status,
  inv.created_at as invitation_created_at,
  inv.accepted_at as invitation_accepted_at,

  r.reward_amount_pence,
  r.reward_plan_code,
  r.reward_credit_id,
  -- platform_credits is an append-only, per-club POOLED ledger (see
  -- internal.platform_credits_no_overspend/platform_credits_append_only) --
  -- an application row records which PAYMENT a club's balance was applied
  -- to, never which specific earning credit funded it. So "reversed" is the
  -- one honest per-referral fact this schema can answer about the reward
  -- credit's own fate; whether it has since been "spent" vs "outstanding"
  -- cannot be attributed to this one referral without assuming an
  -- allocation order the product does not define (see docs). Reporting a
  -- fabricated per-referral applied/outstanding split was rejected for
  -- exactly this reason.
  exists (select 1 from public.platform_credits rev where rev.reverses_credit_id = r.reward_credit_id) as reward_reversed,

  r.qualifying_payment_id,
  pp.charge_date as qualifying_payment_charge_date,
  pp.status as qualifying_payment_status

from public.platform_referrals r
join public.clubs rc on rc.id = r.referring_club_id
join public.club_directory rcd on rcd.id = rc.directory_id
left join public.clubs fc on fc.id = r.referred_club_id
left join public.club_directory fcd on fcd.id = fc.directory_id
left join public.club_ovalball_invitations inv on inv.id = r.invitation_id
left join public.platform_payments pp on pp.id = r.qualifying_payment_id;

comment on view public.admin_referral_overview is
  'Canonical Site Admin read surface for Dashboard R-5. One row per platform_referrals row; the referrer/beneficiary is always the referring CLUB, never a person. security_invoker -- RLS on platform_referrals (is_site_admin() or club.referrals.view) is the real boundary, identical to every other admin_*_overview view.';
