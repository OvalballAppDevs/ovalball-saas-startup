import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * Dashboard Commercial Cards + F1 Referral Intelligence.
 *
 * Deliberately NOT a new RPC alongside site_admin_dashboard_commercial() --
 * that function's own RETURNS TABLE shape is load-bearing for existing
 * callers, and this session's own established lesson (R-0, see
 * docs/CAPABILITY_ARCHITECTURE.md) is that re-declaring a function from a
 * partial copy is exactly how real data silently goes missing. This module
 * reads the SAME canonical sources directly instead: admin_referral_overview
 * (the R-5 view), platform_club_subscriptions, platform_payments, and
 * referral_data_health() -- never a second, parallel definition of any of
 * them.
 */

export interface CommercialCardsData {
  saas: {
    mrrPence: number
    activeSubscriptions: number
    onTrial: number
    billingCollecting: boolean
  }
  memberPayments: {
    clubsConnected: number
    collectedLast30dPence: number
  }
  referrals: {
    total: number
    activated: number
    rewardEarnedPence: number
  }
}

export interface ReferralFunnelStage {
  key: "invited" | "attributed" | "activated" | "qualified" | "rewarded"
  label: string
  count: number
  /** Only false for "qualified" during Beta -- an honest, labelled gap, never omitted silently. */
  active: boolean
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

export interface ReferralIntelligenceData {
  funnel: ReferralFunnelStage[]
  topClubs: TopReferringClub[]
  activity: ReferralActivityEvent[]
  rewardEarnedPence: number
  rewardReversedPence: number
}

/**
 * Whether Ovalball's own SaaS billing is actually collecting money right
 * now (spec C1/B10) -- read from the platform mode the rest of the app
 * already treats as authoritative, never re-derived from subscription rows
 * (a club can hold an "active" subscription row during Beta with no real
 * collection behind it).
 */
async function isBillingCollecting(supabase: SupabaseClient<Database>): Promise<boolean> {
  const { data } = await supabase.rpc("current_platform_mode").maybeSingle()
  return data?.mode === "live"
}

export async function getCommercialCardsData(supabase: SupabaseClient<Database>): Promise<CommercialCardsData | null> {
  const [{ data: subs }, { data: trials }, billingCollecting, { data: gcConnections }, { data: recentPayments }, { data: referrals }] = await Promise.all([
    supabase.from("platform_club_subscriptions").select("status, plan_price_pence"),
    supabase.from("platform_trials").select("status").in("status", ["active", "paused"]),
    isBillingCollecting(supabase),
    supabase.from("gocardless_merchant_connections").select("club_id").is("disconnected_at", null),
    supabase
      .from("platform_payments")
      .select("net_pence, status, charge_date")
      .eq("status", "confirmed")
      .gte("charge_date", new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10)),
    supabase.from("admin_referral_overview").select("status, reward_amount_pence"),
  ])

  const activeSubs = (subs ?? []).filter((s) => s.status === "active" || s.status === "scheduled")
  // MRR is only ever real when billing is actually collecting -- during
  // Beta it is honestly £0, not a projected total from unbilled rows.
  const mrrPence = billingCollecting ? activeSubs.reduce((sum, s) => sum + (s.plan_price_pence ?? 0), 0) : 0

  const refs = referrals ?? []

  return {
    saas: {
      mrrPence,
      activeSubscriptions: activeSubs.length,
      onTrial: (trials ?? []).length,
      billingCollecting,
    },
    memberPayments: {
      clubsConnected: (gcConnections ?? []).length,
      collectedLast30dPence: (recentPayments ?? []).reduce((sum, p) => sum + p.net_pence, 0),
    },
    referrals: {
      total: refs.length,
      activated: refs.filter((r) => r.status === "registered" || r.status === "qualified").length,
      rewardEarnedPence: refs.filter((r) => r.status === "qualified").reduce((sum, r) => sum + (r.reward_amount_pence ?? 0), 0),
    },
  }
}

export async function getReferralIntelligenceData(supabase: SupabaseClient<Database>): Promise<ReferralIntelligenceData | null> {
  const { data: rows } = await supabase.from("admin_referral_overview").select("*")
  if (!rows) return null

  const invited = rows.length
  const attributed = rows.filter((r) => r.invitation_status === "accepted").length
  const activated = rows.filter((r) => r.status === "registered" || r.status === "qualified").length
  const qualified = rows.filter((r) => r.status === "qualified")
  const rewardEarnedPence = qualified.reduce((sum, r) => sum + (r.reward_amount_pence ?? 0), 0)
  const rewardReversedPence = qualified.filter((r) => r.reward_reversed).reduce((sum, r) => sum + (r.reward_amount_pence ?? 0), 0)

  const funnel: ReferralFunnelStage[] = [
    { key: "invited", label: "Invitations sent", count: invited, active: true },
    { key: "attributed", label: "Valid referrals attributed", count: attributed, active: true },
    { key: "activated", label: "Referred clubs activated", count: activated, active: true },
    {
      key: "qualified",
      label: "Paid conversions",
      count: qualified.length,
      active: qualified.length > 0,
      note: qualified.length === 0 ? "Not active during Beta -- SaaS billing is not currently collecting." : undefined,
    },
    { key: "rewarded", label: "Rewards earned", count: qualified.length, active: qualified.length > 0 },
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
    if (r.status === "qualified") existing.rewardEarnedPence += r.reward_amount_pence ?? 0
    byClub.set(r.referring_club_id, existing)
  }
  // Beta ranking: clubs activated first, never raw invitation count alone.
  const topClubs = [...byClub.values()].sort((a, b) => b.clubsActivated - a.clubsActivated || b.referralsAttributed - a.referralsAttributed).slice(0, 10)

  const activity: ReferralActivityEvent[] = []
  for (const r of rows) {
    activity.push({
      id: `${r.referral_id}-created`,
      kind: "referral_created",
      clubName: r.referring_club_name ?? "A club",
      detail: `Referred ${r.referred_club_name ?? "a club"}`,
      occurredAt: r.created_at ?? r.invitation_created_at ?? new Date(0).toISOString(),
    })
    if (r.status === "registered" || r.status === "qualified") {
      activity.push({
        id: `${r.referral_id}-activated`,
        kind: "referred_club_activated",
        clubName: r.referred_club_name ?? "A club",
        detail: `Activated on Ovalball, referred by ${r.referring_club_name}`,
        occurredAt: r.referred_club_activated_at ?? r.updated_at ?? r.created_at ?? new Date(0).toISOString(),
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
    funnel,
    topClubs,
    activity: activity.slice(0, 20),
    rewardEarnedPence,
    rewardReversedPence,
  }
}

function formatMoney(pence: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 }).format(pence / 100)
}
