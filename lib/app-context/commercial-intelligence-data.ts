import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import { toErrorState, type ReadState } from "@/lib/app-context/site-admin-dashboard-data"

/**
 * Dashboard Commercial Cards + F1 Referral Intelligence.
 *
 * Deliberately NOT a new RPC alongside site_admin_dashboard_commercial() --
 * that function's own RETURNS TABLE shape is load-bearing for existing
 * callers, and re-declaring a function from a partial copy is exactly how
 * real data silently goes missing (the R-0 lesson, see
 * docs/CAPABILITY_ARCHITECTURE.md). This module reads the SAME canonical
 * sources directly instead: admin_referral_overview (the R-5 view),
 * club_ovalball_invitations, platform_club_subscriptions, platform_payments
 * and gocardless_merchant_connections -- never a second, parallel
 * definition of any of them.
 *
 * EVERY read here returns a ReadState. The dashboard's founding rule is
 * that a failed read must never be pixel-identical to a genuine zero: "£0
 * MRR" is a business fact a Site Admin will act on, and a swallowed error
 * that renders as "£0 MRR" is a lie the page tells confidently.
 *
 * `?? []` appears below only on branches where the error has ALREADY been
 * checked and returned -- there it is narrowing a type the client declares
 * nullable, not absorbing a failure. It must never be the thing standing
 * between a failed query and a rendered number.
 */

export interface SaasCard {
  mrrPence: number
  activeSubscriptions: number
  onTrial: number
  /** False during Beta. When false, mrrPence is 0 BECAUSE nothing is collected -- not because nobody subscribed. */
  billingCollecting: boolean
}

export interface MemberPaymentsCard {
  collectedLast30dPence: number
}

export interface ReferralsCard {
  total: number
  activated: number
  /** The product entitlement. One qualifying referral = one free month. */
  freeMonthsEarned: number
}

/**
 * Three genuinely separate money domains, each contained: a referral read
 * failing must not blank the SaaS card, and neither may be conflated with
 * the other. Domain A is Ovalball charging clubs; Domain B is a club
 * charging its own members through its own connected merchant account.
 */
export interface CommercialCardsData {
  saas: ReadState<SaasCard>
  memberPayments: ReadState<MemberPaymentsCard>
  referrals: ReadState<ReferralsCard>
}

export interface ReferralFunnelStage {
  key: "invited" | "attributed" | "activated" | "qualified" | "rewarded"
  label: string
  count: number
  note?: string
}

export interface TopReferringClub {
  clubId: string
  clubName: string
  referralsAttributed: number
  clubsActivated: number
  rewardEarnedPence: number
}

export interface ReferralActivityEvent {
  id: string
  kind: "referral_created" | "referred_club_activated" | "reward_earned"
  clubName: string
  detail: string
  occurredAt: string
}

/**
 * What Ovalball actually promises a referring club, and its accounting.
 *
 * The published Referral Terms say: "one month of the referring club's own
 * plan, at the price that plan cost at the moment the reward was earned".
 * So the PRODUCT entitlement is a free month; the pence figure is how that
 * month is implemented in the ledger, not a cash reward.
 *
 * Months are counted, never divided. One qualifying referral earns exactly
 * one month -- `qualify_referral_for_payment` writes one credit per
 * qualification -- so `count(qualified)` is exact. Dividing a credit balance
 * by a current plan price would be wrong the moment pricing changes, plans
 * differ, or the balance mixes referral rewards with goodwill.
 *
 * Months APPLIED and REMAINING are deliberately absent. When credit is
 * spent, `open_platform_billing_cycle` reads the club's *balance* and writes
 * one pooled `application` row; it does not decrement a particular reward.
 * So no month can be traced to its use, and any "2 months remaining" figure
 * would be invented. The money equivalents are exact and are reported
 * instead, labelled as ledger-level rather than per-referral.
 */
export interface ReferralRewardSummary {
  /** Exact: one qualifying referral = one month. Never derived by division. */
  freeMonthsEarned: number
  /** Exact: qualifying referrals whose reward credit was later reversed. */
  freeMonthsWithdrawn: number
  /** Sum of the snapshotted month prices, from the referral rows. */
  rewardEarnedPence: number
  rewardWithdrawnPence: number
  /** Ledger-level, ALL credit sources pooled -- not attributable to referrals. */
  ledgerAppliedPence: number
  ledgerOutstandingPence: number
  /** Rewards whose recorded value cannot be verified against its own snapshot. */
  unverifiedRewardCount: number
}

export interface ReferralIntelligenceData {
  funnel: ReferralFunnelStage[]
  topClubs: TopReferringClub[]
  activity: ReferralActivityEvent[]
  reward: ReferralRewardSummary
  /** Beta suppresses paid conversions. Read from platform mode, never inferred from a zero count. */
  billingCollecting: boolean
}

/**
 * Whether Ovalball's own SaaS billing is actually collecting money right
 * now -- read from the platform mode the rest of the app already treats as
 * authoritative, never re-derived from subscription rows (a club can hold
 * an "active" subscription row during Beta with no real collection behind
 * it), and never inferred from "we saw no paid conversions", which is a
 * consequence, not evidence.
 */
async function readBillingCollecting(
  supabase: SupabaseClient<Database>
): Promise<ReadState<boolean>> {
  const { data, error } = await supabase.rpc("current_platform_mode").maybeSingle()
  if (error) return toErrorState<boolean>(error)
  if (!data) return { state: "error", message: "current_platform_mode() returned no row." }
  return { state: "ok", data: data.mode === "live" }
}

export async function getCommercialCardsData(
  supabase: SupabaseClient<Database>
): Promise<CommercialCardsData> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10)

  const [subsRes, trialsRes, billing, memberPaymentsRes, referralsRes] = await Promise.all([
    supabase.from("platform_club_subscriptions").select("status, plan_price_pence"),
    supabase.from("platform_trials").select("status").in("status", ["active", "paused"]),
    readBillingCollecting(supabase),
    // DOMAIN B: what a club's own members pay THE CLUB, through the club's
    // own connected merchant account. That is gocardless_payments.
    // platform_payments is Domain A -- what a club pays OVALBALL -- and
    // summing it under a "Club member payments" label is precisely the
    // conflation this section's own description promises never to make.
    supabase
      .from("gocardless_payments")
      .select("net_amount_minor, status, charge_date")
      .in("status", ["confirmed", "paid_out"])
      .gte("charge_date", thirtyDaysAgo),
    supabase.from("admin_referral_overview").select("status, reward_amount_pence"),
  ])

  // ---- SaaS (Domain A: Ovalball charging clubs) ----
  let saas: ReadState<SaasCard>
  if (subsRes.error) {
    saas = toErrorState<SaasCard>(subsRes.error)
  } else if (trialsRes.error) {
    saas = toErrorState<SaasCard>(trialsRes.error)
  } else if (billing.state !== "ok") {
    // MRR is meaningless without knowing whether billing collects at all,
    // so the card errors rather than guessing a mode.
    saas = billing as ReadState<SaasCard>
  } else {
    const activeSubs = (subsRes.data ?? []).filter(
      (s) => s.status === "active" || s.status === "scheduled"
    )
    saas = {
      state: "ok",
      data: {
        // Only ever real when billing is actually collecting. During Beta
        // this is honestly £0 and the card says why -- never a projected
        // total from rows nobody has been charged for.
        mrrPence: billing.data
          ? activeSubs.reduce((sum, s) => sum + (s.plan_price_pence ?? 0), 0)
          : 0,
        activeSubscriptions: activeSubs.length,
        onTrial: (trialsRes.data ?? []).length,
        billingCollecting: billing.data,
      },
    }
  }

  // ---- Club member payments (Domain B: a club charging its own members) ----
  //
  // "How many clubs are connected" is deliberately NOT read here.
  // gocardless_merchant_connections holds provider access tokens and has no
  // SELECT grant for authenticated at all, by design (see the table's own
  // comment) -- querying it from a user session returns 42501 for everyone,
  // including a Site Admin, which previously rendered as a confident
  // "0 clubs connected". The authorized count is adoption.withMemberPayments
  // from site_admin_dashboard_trends(), which the dashboard already reads;
  // the card composes it from there so this figure and the Adoption section
  // can never disagree.
  let memberPayments: ReadState<MemberPaymentsCard>
  if (memberPaymentsRes.error) {
    memberPayments = toErrorState<MemberPaymentsCard>(memberPaymentsRes.error)
  } else {
    memberPayments = {
      state: "ok",
      data: {
        collectedLast30dPence: (memberPaymentsRes.data ?? []).reduce(
          (sum, p) => sum + (p.net_amount_minor ?? 0),
          0
        ),
      },
    }
  }

  // ---- Referrals ----
  let referrals: ReadState<ReferralsCard>
  if (referralsRes.error) {
    referrals = toErrorState<ReferralsCard>(referralsRes.error)
  } else {
    const refs = referralsRes.data ?? []
    referrals = {
      state: "ok",
      data: {
        total: refs.length,
        activated: refs.filter((r) => r.status === "registered" || r.status === "qualified").length,
        // Counted, not divided: a qualified referral is one earned month.
        freeMonthsEarned: refs.filter((r) => r.status === "qualified").length,
      },
    }
  }

  return { saas, memberPayments, referrals }
}

export async function getReferralIntelligenceData(
  supabase: SupabaseClient<Database>
): Promise<ReadState<ReferralIntelligenceData>> {
  const [rowsRes, invitesRes, billing, creditsRes, integrityRes] = await Promise.all([
    supabase.from("admin_referral_overview").select("*"),
    // Invitations are a DIFFERENT entity from referrals: an invitation that
    // was never accepted produces no platform_referrals row at all. Counting
    // referral rows and labelling them "invitations sent" silently deletes
    // the top of the funnel -- the exact stage the funnel exists to show.
    supabase.from("club_ovalball_invitations").select("id", { count: "exact", head: true }),
    readBillingCollecting(supabase),
    // The pooled ledger, for the two money facts that are NOT per-referral.
    supabase.from("platform_credits").select("amount_pence, source"),
    supabase.rpc("referral_reward_integrity_detail"),
  ])

  if (rowsRes.error) return toErrorState<ReferralIntelligenceData>(rowsRes.error)
  if (invitesRes.error) return toErrorState<ReferralIntelligenceData>(invitesRes.error)
  if (billing.state !== "ok") return billing as ReadState<ReferralIntelligenceData>
  if (creditsRes.error) return toErrorState<ReferralIntelligenceData>(creditsRes.error)
  if (integrityRes.error) return toErrorState<ReferralIntelligenceData>(integrityRes.error)

  const rows = rowsRes.data ?? []
  const invitationsSent = invitesRes.count ?? 0
  const billingCollecting = billing.data

  const attributed = rows.length
  const activated = rows.filter((r) => r.status === "registered" || r.status === "qualified").length
  const qualified = rows.filter((r) => r.status === "qualified")

  // A reversal moves the referral to its own terminal status, so reversed
  // rewards are NOT inside `qualified`. Filtering reversals out of the
  // qualified set reports £0 reversed however many were clawed back, which
  // overstates net reward. Reward money is counted across every row that
  // actually produced a reward credit.
  const withReward = rows.filter((r) => r.reward_credit_id !== null)
  const stillHeld = withReward.filter((r) => !r.reward_reversed)
  const withdrawn = withReward.filter((r) => r.reward_reversed)

  // One qualifying referral earns exactly one month. Counted, never divided.
  const reward: ReferralRewardSummary = {
    freeMonthsEarned: stillHeld.length,
    freeMonthsWithdrawn: withdrawn.length,
    rewardEarnedPence: stillHeld.reduce((sum, r) => sum + (r.reward_amount_pence ?? 0), 0),
    rewardWithdrawnPence: withdrawn.reduce((sum, r) => sum + (r.reward_amount_pence ?? 0), 0),
    ledgerAppliedPence: Math.abs(
      (creditsRes.data ?? [])
        .filter((c) => c.source === "application")
        .reduce((sum, c) => sum + c.amount_pence, 0)
    ),
    // The ledger balance IS "outstanding": earnings positive, applications
    // and reversals negative. Same definition club_credit_balance_pence uses.
    ledgerOutstandingPence: (creditsRes.data ?? []).reduce((sum, c) => sum + c.amount_pence, 0),
    // Distinct rewards, not detector rows: one bad reward can trip several
    // checks at once (its credit AND its referral record), and reporting the
    // row count would overstate how many rewards are actually affected.
    unverifiedRewardCount: new Set(
      (integrityRes.data ?? []).map((r) => r.credit_id ?? r.referral_id ?? Math.random())
    ).size,
  }

  const funnel: ReferralFunnelStage[] = [
    { key: "invited", label: "Invitations sent", count: invitationsSent },
    { key: "attributed", label: "Referrals attributed", count: attributed },
    { key: "activated", label: "Referred clubs activated", count: activated },
    {
      key: "qualified",
      label: "Paid conversions",
      count: qualified.length,
      // Stated only when the platform mode actually says so. Deriving this
      // from "count === 0" would assert a cause that was never checked --
      // and would keep asserting it after go-live.
      note: billingCollecting
        ? undefined
        : "Ovalball SaaS billing is not collecting during Beta, so a paid conversion is possible but rare.",
    },
    {
      key: "rewarded",
      // The product's own words. One qualifying referral = one free month.
      label: "Free months earned",
      count: reward.freeMonthsEarned,
      note:
        reward.freeMonthsWithdrawn > 0
          ? `${reward.freeMonthsWithdrawn} withdrawn after a reversed payment, and excluded here.`
          : undefined,
    },
  ]

  const byClub = new Map<string, TopReferringClub>()
  for (const r of rows) {
    if (!r.referring_club_id || !r.referring_club_name) continue
    const existing = byClub.get(r.referring_club_id) ?? {
      clubId: r.referring_club_id,
      clubName: r.referring_club_name,
      referralsAttributed: 0,
      clubsActivated: 0,
      rewardEarnedPence: 0,
    }
    existing.referralsAttributed += 1
    if (r.status === "registered" || r.status === "qualified") existing.clubsActivated += 1
    if (r.reward_credit_id !== null && !r.reward_reversed) {
      existing.rewardEarnedPence += r.reward_amount_pence ?? 0
    }
    byClub.set(r.referring_club_id, existing)
  }
  // Beta ranking: clubs actually activated first, never raw invitation count
  // alone -- sending invitations is not an achievement the product rewards.
  const topClubs = [...byClub.values()]
    .sort(
      (a, b) => b.clubsActivated - a.clubsActivated || b.referralsAttributed - a.referralsAttributed
    )
    .slice(0, 10)

  const activity: ReferralActivityEvent[] = []
  for (const r of rows) {
    if (r.created_at) {
      activity.push({
        id: `${r.referral_id}-created`,
        kind: "referral_created",
        clubName: r.referring_club_name ?? "A club",
        detail: `Referred ${r.referred_club_name ?? "a club"}`,
        occurredAt: r.created_at,
      })
    }
    if ((r.status === "registered" || r.status === "qualified") && r.referred_club_activated_at) {
      activity.push({
        id: `${r.referral_id}-activated`,
        kind: "referred_club_activated",
        clubName: r.referred_club_name ?? "A club",
        detail: `Activated on Ovalball, referred by ${r.referring_club_name}`,
        occurredAt: r.referred_club_activated_at,
      })
    }
    if (r.status === "qualified" && r.qualified_at) {
      activity.push({
        id: `${r.referral_id}-reward`,
        kind: "reward_earned",
        clubName: r.referring_club_name ?? "A club",
        detail: `Earned ${formatMoney(r.reward_amount_pence ?? 0)} for referring ${r.referred_club_name}`,
        occurredAt: r.qualified_at,
      })
    }
  }
  activity.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())

  return {
    state: "ok",
    data: {
      funnel,
      topClubs,
      activity: activity.slice(0, 20),
      reward,
      billingCollecting,
    },
  }
}

function formatMoney(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(pence / 100)
}
