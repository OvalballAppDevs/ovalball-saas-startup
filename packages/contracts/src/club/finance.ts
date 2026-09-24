import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { loadStaffPlayers } from "../team/players"
import { currentBillingPeriod } from "../team/subscriptions"

type Client = SupabaseClient<Database>

/**
 * CLUB FINANCE -- SUBSCRIPTIONS & PAYMENTS, BOTH CLIENTS, ONE DOMAIN (CA-M11.1).
 *
 * TWO DIRECTIONS OF MONEY, KEPT APART. Domain A is members paying the club: the club's own programme,
 * pricing and sibling rules (`club_subscription_*`), the ledger of what is owed each month
 * (`membership_obligations`), the provider records the club's OWN GoCardless merchant produces
 * (`gocardless_*`), and the review reasons the relationship engine derives. Domain B is the club paying
 * Ovalball (`platform_*`). They share no table, no merchant and no webhook, and nothing in this module
 * joins them.
 *
 * THE WEBSITE IS THE SPECIFICATION. Every read here is the read `/club/finance`,
 * `/club/finance/[payerSubscriptionId]`, `/club/settings/subscriptions` and
 * `/club/settings/ovalball-billing` perform, and every write is the SAME RPC their server actions call --
 * `create_membership_obligations_for_period`, `set_obligation_exemption`, `configure_subscription_programme`,
 * `set_subscription_price`, `configure_sibling_discount_rule`, `disconnect_gocardless`, `select_club_plan`,
 * `start_club_trial`. There is no mobile ledger, no local status and no second formula: the dashboard
 * arithmetic, the proration illustration and the money formatting live HERE and the web imports them.
 *
 * AUTHORITY IS THE SERVER'S. `readFinanceAuthority` asks `my_capabilities` at CLUB scope for exactly the
 * keys the web pages gate on, and decides only what to OFFER. Every RPC judges the call again. Nothing is
 * derived from a role label, and nothing here asks a TEAM-scope finance question: the team manager's
 * bounded view (`team_subscription_status`) is a different contract for a different job.
 *
 * WHAT NEVER LEAVES HERE. No merchant access token (the table has no policy and no grant), no bank
 * account, no provider identifier -- the projections below deliberately drop `gc_*` columns an RPC returns,
 * so a screen could not draw one if it tried. The provider writes the web performs with the club's token
 * (retry a payment, cancel a membership, refund) are SERVER actions on the web tier and are not reachable
 * from a phone; `FINANCE_WEB_PATHS` names the page where each one lives so the app can hand off honestly.
 */

// ------------------------------------------------------------------------------------------------
// AUTHORITY
// ------------------------------------------------------------------------------------------------

/** The club-scope keys the four web pages gate on. Names, never roles. */
export const FINANCE_AUTHORITY_KEYS = {
  view: "finance.subscription.view",
  configure: "finance.subscription.configure",
  enrolmentManage: "finance.enrolment.manage",
  paymentAct: "finance.payment.act",
  export: "finance.subscription.export",
  gocardlessConnect: "finance.gocardless.connect",
  platformBillingView: "finance.platform_billing.view",
  platformBillingManage: "finance.platform_billing.manage",
  referralsView: "club.referrals.view",
} as const

export type FinanceAuthority = Record<keyof typeof FINANCE_AUTHORITY_KEYS, boolean>

export function noFinanceAuthority(): FinanceAuthority {
  return Object.fromEntries(Object.keys(FINANCE_AUTHORITY_KEYS).map((k) => [k, false])) as FinanceAuthority
}

/** One probe, club scope, re-asked on focus by every screen. Throws the server's refusal. */
export async function readFinanceAuthority(supabase: Client, clubId: string): Promise<FinanceAuthority> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) throw error
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return Object.fromEntries(Object.entries(FINANCE_AUTHORITY_KEYS).map(([k, key]) => [k, allowed.has(key)])) as FinanceAuthority
}

/** The web's `/club/settings/subscriptions` gate: configure OR view. `/club/finance` is view alone. */
export function canOpenSubscriptions(a: FinanceAuthority): boolean {
  return a.configure || a.view
}

// ------------------------------------------------------------------------------------------------
// MONEY -- integer minor units everywhere; formatted in one place.
// ------------------------------------------------------------------------------------------------

export function formatMinorUnits(minorUnits: number, currency: string = "GBP"): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minorUnits / 100)
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency}`
  }
}

export function poundsToMinorUnits(pounds: number): number {
  return Math.round(pounds * 100)
}

// ------------------------------------------------------------------------------------------------
// BILLING PERIODS -- the first of a month, which is how `membership_obligations.billing_period` is stored.
// ------------------------------------------------------------------------------------------------

export { currentBillingPeriod }

export function isBillingPeriod(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-01$/.test(value)
}

export function shiftBillingPeriod(iso: string, delta: number): string {
  const [y, m] = iso.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
}

/** "September 2026". */
export function billingPeriodLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
}

/** "24 Sep 2026" for a date or timestamp; the web's own short form. */
export function formatFinanceDate(value: string | null | undefined, style: "short" | "long" = "short"): string {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString("en-GB", { day: "numeric", month: style, year: "numeric" })
}

// ------------------------------------------------------------------------------------------------
// DASHBOARD METRICS -- every card's number has an explicit formula here, never invented in a component.
// Inputs are the canonical membership_obligations rows for one club + billing period: a payment's
// existence is evidence, the obligation is truth.
// ------------------------------------------------------------------------------------------------

export interface ObligationForMetrics {
  amountDueMinor: number
  status: string
}

export interface DashboardMetrics {
  /** Sum of amount_due_minor across every obligation for the period, regardless of status. */
  expectedRevenueMinor: number
  /** Sum where status = PAID. Confirmed by GoCardless, not merely submitted. */
  collectedMinor: number
  /** expected - collected - exemptWaived. Still owed and not excused. */
  outstandingMinor: number
  /** Sum where status in (EXEMPT, WAIVED): excluded from both collected and outstanding. */
  exemptWaivedMinor: number
  /** Attempted-and-not-failed over attempted; null when nothing was attempted. */
  successRatePercent: number | null
  activeDirectDebits: number
  countByStatus: Record<string, number>
}

const SETTLED_ATTEMPT_STATUSES = new Set(["SUBMITTED", "PAID", "FAILED", "RETRYING", "OVERDUE"])

export function computeDashboardMetrics(obligations: ObligationForMetrics[], activeDirectDebits: number): DashboardMetrics {
  let expectedRevenueMinor = 0
  let collectedMinor = 0
  let exemptWaivedMinor = 0
  const countByStatus: Record<string, number> = {}
  let attempted = 0
  let failed = 0

  for (const o of obligations) {
    expectedRevenueMinor += o.amountDueMinor
    countByStatus[o.status] = (countByStatus[o.status] ?? 0) + 1
    if (o.status === "PAID") collectedMinor += o.amountDueMinor
    if (o.status === "EXEMPT" || o.status === "WAIVED") exemptWaivedMinor += o.amountDueMinor
    if (SETTLED_ATTEMPT_STATUSES.has(o.status)) {
      attempted += 1
      if (o.status === "FAILED" || o.status === "OVERDUE") failed += 1
    }
  }

  const outstandingMinor = Math.max(0, expectedRevenueMinor - collectedMinor - exemptWaivedMinor)
  const successRatePercent = attempted > 0 ? Math.round(((attempted - failed) / attempted) * 1000) / 10 : null
  return { expectedRevenueMinor, collectedMinor, outstandingMinor, exemptWaivedMinor, successRatePercent, activeDirectDebits, countByStatus }
}

/** OVERDUE is never webhook-asserted: derived locally when an unsettled obligation's due date has passed a processing window. */
export function isObligationOverdue(status: string, dueDate: string, processingWindowDays: number = 5, now: Date = new Date()): boolean {
  if (!["SETUP_PENDING", "READY", "SCHEDULED", "SUBMITTED"].includes(status)) return false
  const due = new Date(dueDate)
  const cutoff = new Date(due.getTime() + processingWindowDays * 24 * 60 * 60 * 1000)
  return now > cutoff
}

// ------------------------------------------------------------------------------------------------
// FIRST-MONTH PRORATION -- integer pence, round-half-away-from-zero; mirrored exactly in
// internal.calculate_first_month_proration. Used only for the ILLUSTRATIVE example on the settings
// screen; a real enrolment's preview is server-computed by preview_first_payment_illustrative.
// ------------------------------------------------------------------------------------------------

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
}

export function isFirstMonthProrated(membershipStartDate: string): boolean {
  return Number(membershipStartDate.slice(8, 10)) > 1
}

export interface ProrationResult {
  chargeableDays: number
  totalDaysInMonth: number
  proratedAmountMinor: number
  billingPeriod: string
}

export function calculateFirstMonthProration(membershipStartDate: string, monthlyAmountMinor: number): ProrationResult {
  const year = Number(membershipStartDate.slice(0, 4))
  const month = Number(membershipStartDate.slice(5, 7))
  const day = Number(membershipStartDate.slice(8, 10))
  const totalDaysInMonth = daysInMonth(year, month)
  const chargeableDays = totalDaysInMonth - day + 1
  return {
    chargeableDays,
    totalDaysInMonth,
    proratedAmountMinor: Math.round((monthlyAmountMinor * chargeableDays) / totalDaysInMonth),
    billingPeriod: `${membershipStartDate.slice(0, 7)}-01`,
  }
}

export function nextFullBillingPeriod(membershipStartDate: string): string {
  const year = Number(membershipStartDate.slice(0, 4))
  const month = Number(membershipStartDate.slice(5, 7))
  const next = new Date(Date.UTC(year, month, 1))
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`
}

/** The settings screen's worked example: a player joining on the 16th of this month. */
export function firstPaymentExample(policy: FirstPaymentPolicy, monthlyAmountMinor: number, now: Date = new Date()): { firstAmountMinor: number; coversLabel: string | null; noChargeThisMonth: boolean } {
  const startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-16`
  if (policy === "PRORATE_CURRENT_MONTH") {
    const p = calculateFirstMonthProration(startDate, monthlyAmountMinor)
    const monthName = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })
    return { firstAmountMinor: p.proratedAmountMinor, coversLabel: `16–${p.totalDaysInMonth} ${monthName}`, noChargeThisMonth: false }
  }
  return { firstAmountMinor: monthlyAmountMinor, coversLabel: null, noChargeThisMonth: isFirstMonthProrated(startDate) }
}

// ------------------------------------------------------------------------------------------------
// VOCABULARY -- the web's own words for every status, so both clients say the same thing.
// ------------------------------------------------------------------------------------------------

export const OBLIGATION_STATUSES = ["SETUP_PENDING", "READY", "SCHEDULED", "SUBMITTED", "PAID", "FAILED", "RETRYING", "OVERDUE", "CANCELLED", "EXEMPT", "WAIVED", "REFUNDED", "CHARGEDBACK"] as const

export const OBLIGATION_STATUS_LABEL: Record<string, string> = {
  SETUP_PENDING: "Membership not yet set up",
  READY: "Ready to be charged",
  SCHEDULED: "Scheduled for collection",
  SUBMITTED: "Submitted to GoCardless",
  PAID: "Paid",
  FAILED: "Failed",
  RETRYING: "Retrying after failure",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
  EXEMPT: "Exempt",
  WAIVED: "Waived",
  REFUNDED: "Refunded",
  CHARGEDBACK: "Charged back",
}

/** The short pill word the dashboard table uses. */
export const OBLIGATION_STATUS_SHORT: Record<string, string> = {
  SETUP_PENDING: "Not set up",
  READY: "Ready",
  SCHEDULED: "Scheduled",
  SUBMITTED: "Submitted",
  PAID: "Paid",
  FAILED: "Failed",
  RETRYING: "Retrying",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
  EXEMPT: "Exempt",
  WAIVED: "Waived",
  REFUNDED: "Refunded",
  CHARGEDBACK: "Charged back",
}

export type ObligationTone = "positive" | "caution" | "danger" | "neutral"

export function obligationTone(status: string): ObligationTone {
  if (status === "PAID") return "positive"
  if (status === "FAILED" || status === "OVERDUE" || status === "CHARGEDBACK") return "danger"
  if (status === "RETRYING" || status === "SUBMITTED" || status === "SCHEDULED" || status === "READY") return "caution"
  return "neutral"
}

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending_submission: "Scheduled, not yet submitted",
  submitted: "Submitted, awaiting confirmation",
  confirmed: "Collected",
  paid_out: "Collected and paid out",
  failed: "Collection failed",
  cancelled: "Cancelled",
  charged_back: "Charged back",
}

/** Club Finance's own mandate wording (the family contract has the parent-facing form). */
export const FINANCE_MANDATE_STATUS_LABEL: Record<string, string> = {
  pending_submission: "Submitted to bank, not yet active",
  submitted: "Submitted to bank, awaiting confirmation",
  active: "Active",
  failed: "Setup failed",
  cancelled: "Cancelled",
  expired: "Expired",
  consumed: "Replaced by a newer mandate",
}

export const FINANCE_SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  pending: "Set up, first collection not yet due",
  active: "Active",
  finished: "Finished (all collections complete)",
  cancelled: "Cancelled",
  paused: "Paused",
}

/** Relationship-derived review reasons from get_finance_action_required. Truthful "review" language, never "cancelled". */
export const REVIEW_REASON_LABEL: Record<string, string> = {
  PAYMENT_FAILED: "The most recent payment failed. Review membership.",
  PAYMENT_RETRY_REQUIRES_ATTENTION: "A payment is being resubmitted after a prior failure. Review membership.",
  MANDATE_PROBLEM: "Direct Debit mandate has a problem. Review membership.",
  SUBSCRIPTION_PROBLEM: "Subscription ended with the provider unexpectedly. Review membership.",
  PROGRAMME_ELIGIBILITY_ENDED: "Player is no longer eligible for this programme. Review membership.",
  PAYER_RELATIONSHIP_REQUIRES_REVIEW: "Payer relationship has changed. Review membership.",
}

/** The dashboard's attention panel covers these two from the obligation rows; the review panel takes the rest. */
export const PAYMENT_REVIEW_REASONS = new Set(["PAYMENT_FAILED", "PAYMENT_RETRY_REQUIRES_ATTENTION"])

export type FirstPaymentPolicy = "PRORATE_CURRENT_MONTH" | "NEXT_COLLECTION_DAY"
export type PlatformFeeMode = "NONE" | "PARTNER_REVENUE_SHARE"
export type SiblingDiscountType = "NONE" | "PERCENTAGE" | "FIXED"

export const FIRST_PAYMENT_POLICY_OPTIONS: { value: FirstPaymentPolicy; label: string; body: string }[] = [
  { value: "PRORATE_CURRENT_MONTH", label: "Charge a pro-rata amount", body: "Charge only for the remaining days of their first month. Full monthly payments then continue from the next 1st." },
  { value: "NEXT_COLLECTION_DAY", label: "Start payments next month", body: "No payment is due for the remaining part of the current month. The first full monthly payment is scheduled for the next 1st." },
]

export const PLATFORM_FEE_MODE_OPTIONS: { value: PlatformFeeMode; label: string }[] = [
  { value: "NONE", label: "No platform fee" },
  { value: "PARTNER_REVENUE_SHARE", label: "Partner revenue share (Ovalball is paid separately by GoCardless, not the club)" },
]

export const SIBLING_ORDINALS = [2, 3, 4, 5, 6] as const

export function ordinalWord(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"
  return `${n}${suffix}`
}

export function describeSiblingRule(rule: { discountType: SiblingDiscountType; discountValue: number } | null): string {
  if (!rule || rule.discountType === "NONE") return "No discount"
  return rule.discountType === "PERCENTAGE" ? `${rule.discountValue}% off` : `${formatMinorUnits(rule.discountValue)} off`
}

/**
 * Connection (OAuth) and verification (creditor readiness) are independent axes; each gets its own
 * badge. `unknown` is Ovalball's fail-safe for "not yet confirmed with GoCardless".
 */
export const VERIFICATION_STATUS: Record<string, { label: string; tone: ObligationTone; explanation: string | null }> = {
  successful: { label: "Verified", tone: "positive", explanation: null },
  in_review: { label: "Pending", tone: "caution", explanation: "GoCardless is reviewing this account's verification. This usually resolves without any action from you." },
  action_required: { label: "Action Required", tone: "danger", explanation: "Your GoCardless account is connected, but GoCardless requires additional account verification before all payment features are available." },
  unknown: { label: "Not Yet Confirmed", tone: "neutral", explanation: "Ovalball hasn't yet confirmed this account's verification status with GoCardless." },
}

// ------------------------------------------------------------------------------------------------
// WHERE THE WEB DOES WHAT THE PHONE CANNOT -- honest hand-offs, opened in the system browser.
// ------------------------------------------------------------------------------------------------

export const FINANCE_WEB_PATHS = {
  /** The canonical entry to the merchant OAuth dance: capability + CSRF state on the server, then GoCardless's own consent page. */
  gocardlessConnect: (clubId: string) => `/api/gocardless/oauth/start?clubId=${encodeURIComponent(clubId)}`,
  subscriptionSettings: "/club/settings/subscriptions",
  financeDashboard: (billingPeriod: string) => `/club/finance?month=${billingPeriod}`,
  /** Retry a failed payment and Cancel Membership live here: both need the club's merchant token, held only by the web server. */
  membership: (payerSubscriptionId: string) => `/club/finance/${payerSubscriptionId}`,
  ovalballBilling: "/club/settings/ovalball-billing",
  partnerClubs: "/partner-clubs",
  referralTerms: "/legal/referral-terms",
} as const

// ------------------------------------------------------------------------------------------------
// DOMAIN A -- THE DASHBOARD READ
// ------------------------------------------------------------------------------------------------

export interface FinanceObligationRow {
  obligationId: string
  payerSubscriptionId: string
  playerId: string
  playerName: string
  amountMinor: number
  dueDate: string
  /** Canonical status, with OVERDUE derived locally exactly as the web derives it. */
  status: string
  resolvedReason: string | null
  /** The one provider collection attempt this obligation produced, by Ovalball's own id only. */
  payment: { id: string; status: string } | null
  isProrated: boolean
}

export interface ReviewItem {
  payerSubscriptionId: string
  playerId: string
  playerName: string
  reason: string
}

export interface FinanceDashboard {
  clubId: string
  billingPeriod: string
  metrics: DashboardMetrics
  attention: { failed: number; overdue: number; notSetUp: number }
  rows: FinanceObligationRow[]
  /** Relationship-derived reasons, club-wide; payment reasons are excluded because `attention` covers them. */
  review: ReviewItem[]
}

/** The `/club/finance` read, as the signed-in person, RLS-scoped. Throws the server's refusal. */
export async function loadFinanceDashboard(supabase: Client, clubId: string, billingPeriod: string): Promise<FinanceDashboard> {
  const [{ data: obligationsRaw, error: obligationsError }, { count: activeSubsCount, error: subsError }] = await Promise.all([
    supabase
      .from("membership_obligations")
      .select("id, amount_due_minor, due_date, status, resolved_reason, player_id, payer_subscription_id, gocardless_payment_id, is_prorated")
      .eq("club_id", clubId)
      .eq("billing_period", billingPeriod),
    supabase.from("gocardless_subscriptions").select("id", { count: "exact", head: true }).eq("club_id", clubId).eq("status", "active"),
  ])
  if (obligationsError) throw obligationsError
  if (subsError) throw subsError

  const obligations = obligationsRaw ?? []
  const metrics = computeDashboardMetrics(
    obligations.map((o) => ({ amountDueMinor: o.amount_due_minor, status: o.status })),
    activeSubsCount ?? 0
  )

  const paymentIds = obligations.map((o) => o.gocardless_payment_id).filter((id): id is string => Boolean(id))
  const { data: payments } = paymentIds.length > 0 ? await supabase.from("gocardless_payments").select("id, obligation_id, status").in("id", paymentIds) : { data: [] }
  const paymentByObligationId = new Map((payments ?? []).map((p) => [p.obligation_id, { id: p.id, status: p.status }]))

  const { data: actionRequiredRaw, error: reviewError } = await supabase.rpc("get_finance_action_required", { p_club_id: clubId })
  if (reviewError) throw reviewError
  const relationshipReasons = (actionRequiredRaw ?? []).filter((r) => !PAYMENT_REVIEW_REASONS.has(r.reason))

  const players = await loadStaffPlayers(supabase, [...relationshipReasons.map((r) => r.player_id), ...obligations.map((o) => o.player_id)])
  const nameOf = (id: string) => players.get(id)?.displayName || "Unknown player"

  const rows: FinanceObligationRow[] = obligations
    .map((o) => ({
      obligationId: o.id,
      payerSubscriptionId: o.payer_subscription_id,
      playerId: o.player_id,
      playerName: nameOf(o.player_id),
      amountMinor: o.amount_due_minor,
      dueDate: o.due_date,
      status: isObligationOverdue(o.status, o.due_date) ? "OVERDUE" : o.status,
      resolvedReason: o.resolved_reason,
      payment: paymentByObligationId.get(o.id) ?? null,
      isProrated: o.is_prorated,
    }))
    .sort((a, b) => a.playerName.localeCompare(b.playerName))

  return {
    clubId,
    billingPeriod,
    metrics,
    attention: {
      failed: obligations.filter((o) => o.status === "FAILED").length,
      overdue: obligations.filter((o) => isObligationOverdue(o.status, o.due_date)).length,
      notSetUp: obligations.filter((o) => o.status === "SETUP_PENDING").length,
    },
    rows,
    review: relationshipReasons.map((r) => ({ payerSubscriptionId: r.payer_subscription_id, playerId: r.player_id, playerName: nameOf(r.player_id), reason: r.reason })),
  }
}

export type MemberFilter = "all" | "attention" | "failed" | "overdue" | "not_set_up" | "paid" | "excused"

export const MEMBER_FILTERS: { key: MemberFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Needs Attention" },
  { key: "failed", label: "Failed" },
  { key: "overdue", label: "Overdue" },
  { key: "not_set_up", label: "Not Set Up" },
  { key: "paid", label: "Paid" },
  { key: "excused", label: "Exempt & Waived" },
]

export function filterObligationRows(rows: FinanceObligationRow[], filter: MemberFilter, query: string): FinanceObligationRow[] {
  const q = query.trim().toLowerCase()
  return rows.filter((r) => {
    if (q && !r.playerName.toLowerCase().includes(q)) return false
    switch (filter) {
      case "attention":
        return r.status === "FAILED" || r.status === "OVERDUE" || r.status === "SETUP_PENDING"
      case "failed":
        return r.status === "FAILED"
      case "overdue":
        return r.status === "OVERDUE"
      case "not_set_up":
        return r.status === "SETUP_PENDING"
      case "paid":
        return r.status === "PAID"
      case "excused":
        return r.status === "EXEMPT" || r.status === "WAIVED"
      default:
        return true
    }
  })
}

/** The web's rule: Waive is offered on any row not already settled or excused. */
export function canWaiveObligation(status: string): boolean {
  return !["EXEMPT", "WAIVED", "PAID", "REFUNDED"].includes(status)
}

/** The web's rule: Retry is offered on a FAILED row that has a payment attempt behind it. */
export function canRetryPayment(row: { status: string; payment: { id: string } | null }): boolean {
  return row.status === "FAILED" && row.payment !== null
}

// ------------------------------------------------------------------------------------------------
// DOMAIN A -- ONE MEMBERSHIP'S OPERATIONAL DETAIL
// ------------------------------------------------------------------------------------------------

export interface MembershipDetail {
  payerSubscriptionId: string
  clubId: string
  playerId: string
  playerName: string
  payerName: string
  payerEmail: string | null
  payerStatus: string
  payerEffectiveTo: string | null
  payerEndReason: string | null
  /** Snapshotted at enrolment -- never recomputed from current policy. */
  baseAmountMinor: number | null
  finalAmountMinor: number | null
  programmeAmountMinor: number | null
  siblingOrdinal: number | null
  siblingDiscountType: string | null
  siblingDiscountValue: number | null
  siblingDiscountAmountMinor: number | null
  firstPaymentPolicy: string | null
  mandateStatus: string | null
  subscriptionStatus: string | null
  /** Truthful, specific reasons for this membership. */
  reviewReasons: string[]
  history: MembershipHistoryRow[]
}

export interface MembershipHistoryRow {
  obligationId: string
  billingPeriod: string
  amountMinor: number
  dueDate: string
  status: string
  isProrated: boolean
  payment: { status: string; chargeDate: string | null; confirmedAt: string | null; failedAt: string | null } | null
}

/** The `/club/finance/[payerSubscriptionId]` read. Null when the single door refuses -- no existence signal. */
export async function loadMembershipDetail(supabase: Client, payerSubscriptionId: string): Promise<MembershipDetail | null> {
  const { data: detail, error } = await supabase.rpc("get_membership_operational_detail", { p_payer_subscription_id: payerSubscriptionId }).maybeSingle()
  if (error || !detail) return null

  const { data: obligationsRaw } = await supabase
    .from("membership_obligations")
    .select("id, billing_period, amount_due_minor, due_date, status, is_prorated, gocardless_payment_id")
    .eq("payer_subscription_id", payerSubscriptionId)
    .order("billing_period", { ascending: false })
  const obligations = obligationsRaw ?? []
  const paymentIds = obligations.map((o) => o.gocardless_payment_id).filter((id): id is string => Boolean(id))
  const { data: paymentsRaw } = paymentIds.length > 0 ? await supabase.from("gocardless_payments").select("id, status, charge_date, confirmed_at, failed_at").in("id", paymentIds) : { data: [] }
  const paymentById = new Map((paymentsRaw ?? []).map((p) => [p.id, p]))

  const { data: actionRequiredRaw } = detail.payer_status === "active" ? await supabase.rpc("get_finance_action_required", { p_club_id: detail.club_id }) : { data: [] }
  const reviewReasons = (actionRequiredRaw ?? []).filter((r) => r.payer_subscription_id === payerSubscriptionId).map((r) => r.reason)

  return {
    payerSubscriptionId,
    clubId: detail.club_id,
    playerId: detail.player_id,
    playerName: `${detail.player_first_name ?? ""} ${detail.player_surname ?? ""}`.trim() || "Unknown player",
    payerName: `${detail.payer_first_name ?? ""} ${detail.payer_surname ?? ""}`.trim(),
    payerEmail: detail.payer_email ?? null,
    payerStatus: detail.payer_status,
    payerEffectiveTo: detail.payer_effective_to ?? null,
    payerEndReason: detail.payer_end_reason ?? null,
    baseAmountMinor: detail.base_amount_minor ?? null,
    finalAmountMinor: detail.final_amount_minor ?? null,
    programmeAmountMinor: detail.programme_amount_minor ?? null,
    siblingOrdinal: detail.sibling_ordinal ?? null,
    siblingDiscountType: detail.sibling_discount_type ?? null,
    siblingDiscountValue: detail.sibling_discount_value ?? null,
    siblingDiscountAmountMinor: detail.sibling_discount_amount_minor ?? null,
    firstPaymentPolicy: detail.programme_first_payment_policy ?? null,
    mandateStatus: detail.mandate_status ?? null,
    subscriptionStatus: detail.subscription_status ?? null,
    reviewReasons,
    history: obligations.map((o) => {
      const p = o.gocardless_payment_id ? paymentById.get(o.gocardless_payment_id) : null
      return {
        obligationId: o.id,
        billingPeriod: o.billing_period,
        amountMinor: o.amount_due_minor,
        dueDate: o.due_date,
        status: isObligationOverdue(o.status, o.due_date) ? "OVERDUE" : o.status,
        isProrated: o.is_prorated,
        payment: p ? { status: p.status, chargeDate: p.charge_date ?? null, confirmedAt: p.confirmed_at ?? null, failedAt: p.failed_at ?? null } : null,
      }
    }),
  }
}

/** True when the snapshot carries a real sibling discount worth explaining. */
export function hasSiblingDiscount(d: Pick<MembershipDetail, "baseAmountMinor" | "siblingDiscountType" | "siblingDiscountAmountMinor">): boolean {
  return d.baseAmountMinor != null && !!d.siblingDiscountType && d.siblingDiscountType !== "NONE" && (d.siblingDiscountAmountMinor ?? 0) > 0
}

// ------------------------------------------------------------------------------------------------
// DOMAIN A -- SUBSCRIPTION SETTINGS (programme, pricing, sibling rules, connection)
// ------------------------------------------------------------------------------------------------

export interface SubscriptionProgrammeSettings {
  enabled: boolean
  collectionDay: number
  platformFeeMode: PlatformFeeMode
  firstPaymentPolicy: FirstPaymentPolicy
}

export const DEFAULT_PROGRAMME_SETTINGS: SubscriptionProgrammeSettings = { enabled: false, collectionDay: 1, platformFeeMode: "NONE", firstPaymentPolicy: "NEXT_COLLECTION_DAY" }

export function programmeSettingsEqual(a: SubscriptionProgrammeSettings, b: SubscriptionProgrammeSettings): boolean {
  return a.enabled === b.enabled && a.collectionDay === b.collectionDay && a.platformFeeMode === b.platformFeeMode && a.firstPaymentPolicy === b.firstPaymentPolicy
}

export interface PriceRow {
  id: string
  amountMinor: number
  effectiveFrom: string
}

export interface SiblingRule {
  ordinal: number
  discountType: SiblingDiscountType
  discountValue: number
}

/**
 * Connection status needs `finance.gocardless.connect` (the RPC's own gate). A person without it is told
 * so rather than shown "Disconnected" for a connected club -- the web draws the latter, and it is false.
 */
export type ConnectionStatus = { known: true; connected: boolean; verificationStatus: string | null; connectedAt: string | null; environment: string | null } | { known: false }

export interface SubscriptionSettings {
  clubId: string
  programme: { id: string; settings: SubscriptionProgrammeSettings; currency: string } | null
  currentPrice: PriceRow | null
  priceHistory: PriceRow[]
  siblingRules: SiblingRule[]
  connection: ConnectionStatus
}

/** The `/club/settings/subscriptions` read. Throws the server's refusal on the programme read. */
export async function loadSubscriptionSettings(supabase: Client, clubId: string, authority: Pick<FinanceAuthority, "gocardlessConnect">, todayIso: string = new Date().toISOString().slice(0, 10)): Promise<SubscriptionSettings> {
  const [{ data: programme, error: programmeError }, { data: pricing, error: pricingError }] = await Promise.all([
    supabase.from("club_subscription_programmes").select("id, enabled, collection_day, platform_fee_mode, first_payment_policy, currency").eq("club_id", clubId).maybeSingle(),
    supabase.from("club_subscription_pricing").select("id, amount_minor, effective_from, programme_id").order("effective_from", { ascending: false }),
  ])
  if (programmeError) throw programmeError
  if (pricingError) throw pricingError

  const history: PriceRow[] = (pricing ?? []).filter((p) => !programme || p.programme_id === programme.id).map((p) => ({ id: p.id, amountMinor: p.amount_minor, effectiveFrom: p.effective_from }))
  const currentPrice = history.find((p) => p.effectiveFrom <= todayIso) ?? null

  const [siblingRules, connection] = await Promise.all([
    programme ? readSiblingDiscountRules(supabase, programme.id).catch(() => [] as SiblingRule[]) : Promise.resolve([] as SiblingRule[]),
    authority.gocardlessConnect ? readConnectionStatus(supabase, clubId) : Promise.resolve<ConnectionStatus>({ known: false }),
  ])

  return {
    clubId,
    programme: programme
      ? {
          id: programme.id,
          currency: programme.currency,
          settings: {
            enabled: programme.enabled ?? false,
            collectionDay: programme.collection_day ?? 1,
            platformFeeMode: (programme.platform_fee_mode as PlatformFeeMode) ?? "NONE",
            firstPaymentPolicy: (programme.first_payment_policy as FirstPaymentPolicy) ?? "NEXT_COLLECTION_DAY",
          },
        }
      : null,
    currentPrice,
    priceHistory: history,
    siblingRules,
    connection,
  }
}

export async function readConnectionStatus(supabase: Client, clubId: string): Promise<ConnectionStatus> {
  const { data, error } = await supabase.rpc("get_gocardless_connection_status", { p_club_id: clubId }).maybeSingle()
  if (error) return { known: false }
  return { known: true, connected: Boolean(data?.connected), verificationStatus: data?.verification_status ?? null, connectedAt: data?.connected_at ?? null, environment: data?.environment ?? null }
}

export async function readSiblingDiscountRules(supabase: Client, programmeId: string): Promise<SiblingRule[]> {
  const { data, error } = await supabase.rpc("get_sibling_discount_rules", { p_programme_id: programmeId })
  if (error) throw error
  return (data ?? []).map((r) => ({ ordinal: r.ordinal, discountType: r.discount_type as SiblingDiscountType, discountValue: r.discount_value }))
}

export interface FirstPaymentPreview {
  policy: FirstPaymentPolicy
  monthlyAmountMinor: number
  firstChargeAmountMinor: number
  firstChargeBillingPeriod: string
  coversFrom: string
  coversTo: string
  isProrated: boolean
}

/** Server-computed against the SAVED policy, so it can never drift from what obligations will do. */
export async function previewFirstPayment(supabase: Client, programmeId: string, membershipStartDate: string): Promise<FirstPaymentPreview | null> {
  const { data, error } = await supabase.rpc("preview_first_payment_illustrative", { p_programme_id: programmeId, p_membership_start_date: membershipStartDate }).maybeSingle()
  if (error || !data) return null
  return {
    policy: data.policy as FirstPaymentPolicy,
    monthlyAmountMinor: data.monthly_amount_minor,
    firstChargeAmountMinor: data.first_charge_amount_minor,
    firstChargeBillingPeriod: data.first_charge_billing_period,
    coversFrom: data.covers_from,
    coversTo: data.covers_to,
    isProrated: data.is_prorated,
  }
}

export interface ActiveSubscriptionImpact {
  activeGoCardlessSubscriptions: number
  activePayers: number
  pendingObligations: number
}

/** What a disconnect would leave running. The web fetches this and never shows it; the phone shows it. */
export async function readActiveSubscriptionImpact(supabase: Client, clubId: string): Promise<ActiveSubscriptionImpact | null> {
  const { data, error } = await supabase.rpc("get_active_subscription_impact", { p_club_id: clubId }).maybeSingle()
  if (error || !data) return null
  return { activeGoCardlessSubscriptions: data.active_gocardless_subscriptions ?? 0, activePayers: data.active_payers ?? 0, pendingObligations: data.pending_obligations ?? 0 }
}

// ------------------------------------------------------------------------------------------------
// DOMAIN A -- MUTATIONS. Thin wrappers over the SAME RPCs the web's server actions call. Each throws the
// server's error untouched so a screen can tell a refusal (42501), a recent-authenticator ask and a
// validation message apart.
// ------------------------------------------------------------------------------------------------

export async function generateObligations(supabase: Client, clubId: string, billingPeriod: string): Promise<void> {
  const { error } = await supabase.rpc("create_membership_obligations_for_period", { p_club_id: clubId, p_billing_period: billingPeriod })
  if (error) throw error
}

export async function setObligationExemption(supabase: Client, obligationId: string, status: "EXEMPT" | "WAIVED", reason: string): Promise<void> {
  const { error } = await supabase.rpc("set_obligation_exemption", { p_obligation_id: obligationId, p_status: status, p_reason: reason })
  if (error) throw error
}

export async function saveSubscriptionProgramme(supabase: Client, clubId: string, settings: SubscriptionProgrammeSettings): Promise<void> {
  const { error } = await supabase.rpc("configure_subscription_programme", {
    p_club_id: clubId,
    p_enabled: settings.enabled,
    p_collection_day: settings.collectionDay,
    p_platform_fee_mode: settings.platformFeeMode,
    p_first_payment_policy: settings.firstPaymentPolicy,
  })
  if (error) throw error
}

export async function setSubscriptionPrice(supabase: Client, programmeId: string, amountMinor: number, effectiveFrom: string): Promise<void> {
  const { error } = await supabase.rpc("set_subscription_price", { p_programme_id: programmeId, p_amount_minor: amountMinor, p_effective_from: effectiveFrom })
  if (error) throw error
}

export async function saveSiblingDiscountRule(supabase: Client, programmeId: string, ordinal: number, discountType: SiblingDiscountType, discountValue: number): Promise<void> {
  const { error } = await supabase.rpc("configure_sibling_discount_rule", { p_programme_id: programmeId, p_ordinal: ordinal, p_discount_type: discountType, p_discount_value: discountValue })
  if (error) throw error
}

export async function disconnectGoCardless(supabase: Client, clubId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("disconnect_gocardless", { p_club_id: clubId, p_reason: reason })
  if (error) throw error
}

/** Client-side checks the web performs before it calls the server; the server checks again. */
export function priceInputProblem(amountPounds: string, effectiveFrom: string): string | null {
  const pounds = Number(amountPounds)
  if (!Number.isFinite(pounds) || pounds <= 0) return "Enter a valid amount greater than £0."
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(new Date(effectiveFrom).getTime())) return "Choose an effective-from date (YYYY-MM-DD)."
  return null
}

export function siblingRuleInput(discountType: SiblingDiscountType, value: string): { ok: true; discountValue: number } | { ok: false; problem: string } {
  if (discountType === "NONE") return { ok: true, discountValue: 0 }
  const n = Number(value)
  if (discountType === "PERCENTAGE") {
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, problem: "Percentage must be between 0 and 100." }
    return { ok: true, discountValue: n }
  }
  if (!Number.isFinite(n) || n < 0) return { ok: false, problem: "Amount must be £0 or more." }
  return { ok: true, discountValue: poundsToMinorUnits(n) }
}

// ------------------------------------------------------------------------------------------------
// DOMAIN A -- EXPORT. The same RPC the web calls (which writes the finance_export_generated audit row), the
// same thirteen columns, the same escaping. No bank data, no tokens, no provider ids.
// ------------------------------------------------------------------------------------------------

export type FinanceExportRow = Database["public"]["Functions"]["export_finance_rows"]["Returns"][number]

export async function readFinanceExportRows(supabase: Client, clubId: string, billingPeriod: string): Promise<FinanceExportRow[]> {
  const { data, error } = await supabase.rpc("export_finance_rows", { p_club_id: clubId, p_billing_period: billingPeriod })
  if (error) throw error
  return data ?? []
}

export const FINANCE_EXPORT_HEADER = ["Player", "Payer", "Payer email", "Billing period", "Amount", "Obligation status", "Due date", "Payment status", "Subscription status", "Base rate", "Sibling ordinal", "Sibling discount", "Final rate"] as const

export function financeRowsToCsv(rows: FinanceExportRow[]): string {
  const escape = (value: string | number | null | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`
  const lines = [
    FINANCE_EXPORT_HEADER.map(escape).join(","),
    ...rows.map((row) =>
      [
        `${row.player_first_name} ${row.player_surname}`,
        row.payer_first_name && row.payer_surname ? `${row.payer_first_name} ${row.payer_surname}` : "",
        row.payer_email,
        row.billing_period,
        (row.amount_due_minor / 100).toFixed(2),
        row.obligation_status,
        row.due_date,
        row.payment_status ?? "",
        row.subscription_status ?? "",
        row.base_amount_minor != null ? (row.base_amount_minor / 100).toFixed(2) : "",
        row.sibling_ordinal ?? "",
        row.sibling_discount_type && row.sibling_discount_type !== "NONE" ? row.sibling_discount_type : "",
        row.final_amount_minor != null ? (row.final_amount_minor / 100).toFixed(2) : "",
      ]
        .map(escape)
        .join(",")
    ),
  ]
  return lines.join("\n")
}

export function financeExportFileName(billingPeriod: string): string {
  return `finance-export-${billingPeriod.slice(0, 7)}.csv`
}

// ------------------------------------------------------------------------------------------------
// DOMAIN B -- THE CLUB PAYS OVALBALL. `platform_*` only; nothing here touches Domain A.
// ------------------------------------------------------------------------------------------------

export type PlatformSubscriptionStatus = "pending_setup" | "scheduled" | "active" | "past_due" | "cancelled" | "ended"
export type TrialStatus = "active" | "paused" | "completed" | "converted"
export type PlatformMode = "beta" | "live"

export interface ClubBillingState {
  effectivePlan: string | null
  subscriptionStatus: PlatformSubscriptionStatus | null
  planPricePence: number | null
  currency: string
  nextCollectionOn: string | null
  currentPeriodEnd: string | null
  trialStatus: TrialStatus | null
  trialRemainingSeconds: number | null
  creditBalancePence: number
  platformMode: PlatformMode
}

export interface NextCollection {
  grossPence: number
  creditAvailablePence: number
  creditAppliedPence: number
  netPence: number
  currency: string
  willSkip: boolean
}

export interface PlatformPlanCard {
  code: string
  name: string
  description: string | null
  priceLabel: string
  status: "available" | "coming_soon" | "retired"
  purchasable: boolean
  /** True when this plan grants nothing the purchasable plan does not; read from the data, never asserted in copy. */
  addsNothingYet: boolean
  comparedWithPlanName: string | null
}

export interface PlatformPaymentRow {
  id: string
  netPence: number
  creditAppliedPence: number
  status: string
  chargeDate: string | null
  failureReason: string | null
}

export interface PlatformCreditRow {
  id: string
  amountPence: number
  source: string
  reason: string | null
  createdAt: string
}

export type ReferralStatus = "pending" | "registered" | "qualified" | "rejected" | "reversed"

export interface ClubReferral {
  id: string
  referredClubName: string
  status: ReferralStatus
  rewardAmountPence: number | null
  qualifiedAt: string | null
  createdAt: string
}

export interface OvalballBilling {
  clubId: string
  state: ClubBillingState | null
  nextCollection: NextCollection | null
  plans: PlatformPlanCard[]
  /** The plan the club HAS, not the plan its trial grants. */
  currentPlanCode: string | null
  payments: PlatformPaymentRow[]
  credits: PlatformCreditRow[]
  referrals: ClubReferral[]
  /** Null billing state, or no plan and no trial: the club has not started. */
  hasNothingYet: boolean
}

export const REFERRAL_OFFER_SUMMARY = "Refer another rugby club to Ovalball. If they start a paid subscription and their first payment is successfully collected, your club gets one month of its current plan free."

export async function readClubBillingState(supabase: Client, clubId: string): Promise<ClubBillingState | null> {
  const { data, error } = await supabase.rpc("club_platform_billing_state", { p_club_id: clubId })
  if (error || !data || data.length === 0) return null
  const row = data[0]
  return {
    effectivePlan: row.effective_plan ?? null,
    subscriptionStatus: (row.subscription_status as PlatformSubscriptionStatus | null) ?? null,
    planPricePence: row.plan_price_pence ?? null,
    currency: row.currency ?? "GBP",
    nextCollectionOn: row.next_collection_on ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    trialStatus: (row.trial_status as TrialStatus | null) ?? null,
    trialRemainingSeconds: row.trial_remaining_seconds === null || row.trial_remaining_seconds === undefined ? null : Number(row.trial_remaining_seconds),
    creditBalancePence: row.credit_balance_pence ?? 0,
    platformMode: row.platform_mode === "live" ? "live" : "beta",
  }
}

export async function readNextCollection(supabase: Client, clubId: string): Promise<NextCollection | null> {
  const { data, error } = await supabase.rpc("club_platform_next_collection", { p_club_id: clubId })
  if (error || !data || data.length === 0) return null
  const row = data[0]
  return { grossPence: row.gross_pence, creditAvailablePence: row.credit_available_pence, creditAppliedPence: row.credit_applied_pence, netPence: row.net_pence, currency: row.currency, willSkip: row.will_skip }
}

/** "£15 a month": whole pounds drop the pence, as the web does. */
export function formatPlanPrice(plan: { pricePence: number; currency: string; billingInterval: string }): string {
  const digits = plan.pricePence % 100 === 0 ? 0 : 2
  let amount: string
  try {
    amount = new Intl.NumberFormat("en-GB", { style: "currency", currency: plan.currency, minimumFractionDigits: digits }).format(plan.pricePence / 100)
  } catch {
    amount = `${(plan.pricePence / 100).toFixed(digits)} ${plan.currency}`
  }
  return plan.billingInterval === "year" ? `${amount} a year` : `${amount} a month`
}

/** The `/club/settings/ovalball-billing` read: the same RPCs and tables, the referrals only where `club.referrals.view` says so. */
export async function loadOvalballBilling(supabase: Client, clubId: string, authority: Pick<FinanceAuthority, "referralsView">): Promise<OvalballBilling> {
  const [state, nextCollection, { data: plansRaw }, { data: entitlementsRaw }, { data: paymentsRaw }, { data: creditsRaw }, { data: referralsRaw }] = await Promise.all([
    readClubBillingState(supabase, clubId),
    readNextCollection(supabase, clubId),
    supabase.from("platform_plans").select("code, name, description, price_pence, currency, billing_interval, price_version, status, purchasable").neq("status", "retired").order("sort_order", { ascending: true }),
    supabase.from("platform_plan_entitlements").select("plan_code, entitlement_key"),
    supabase.from("platform_payments").select("id, gross_pence, credit_applied_pence, net_pence, status, charge_date, failure_reason").eq("club_id", clubId).order("charge_date", { ascending: false }).limit(24),
    supabase.from("platform_credits").select("id, amount_pence, source, reason, created_at").eq("club_id", clubId).order("seq", { ascending: false }).limit(24),
    authority.referralsView ? supabase.rpc("club_referral_summary", { p_club_id: clubId }) : Promise.resolve({ data: [] as Database["public"]["Functions"]["club_referral_summary"]["Returns"] }),
  ])

  const plans = plansRaw ?? []
  const entitlementsByPlan = new Map<string, Set<string>>()
  for (const row of entitlementsRaw ?? []) {
    const set = entitlementsByPlan.get(row.plan_code) ?? new Set<string>()
    set.add(row.entitlement_key)
    entitlementsByPlan.set(row.plan_code, set)
  }
  const purchasable = plans.find((p) => p.purchasable) ?? null
  const cards: PlatformPlanCard[] = plans.map((plan) => {
    const mine = entitlementsByPlan.get(plan.code) ?? new Set<string>()
    const baseline = purchasable ? (entitlementsByPlan.get(purchasable.code) ?? new Set<string>()) : new Set<string>()
    return {
      code: plan.code,
      name: plan.name,
      description: plan.description,
      priceLabel: formatPlanPrice({ pricePence: plan.price_pence, currency: plan.currency, billingInterval: plan.billing_interval }),
      status: plan.status as PlatformPlanCard["status"],
      purchasable: plan.purchasable,
      addsNothingYet: purchasable !== null && plan.code !== purchasable.code && [...mine].every((key) => baseline.has(key)),
      comparedWithPlanName: purchasable?.name ?? null,
    }
  })

  return {
    clubId,
    state,
    nextCollection,
    plans: cards,
    currentPlanCode: state?.subscriptionStatus ? (state.effectivePlan ?? null) : null,
    payments: (paymentsRaw ?? []).map((p) => ({ id: p.id, netPence: p.net_pence, creditAppliedPence: p.credit_applied_pence, status: p.status, chargeDate: p.charge_date ?? null, failureReason: p.failure_reason ?? null })),
    credits: (creditsRaw ?? []).map((c) => ({ id: c.id, amountPence: c.amount_pence, source: c.source, reason: c.reason ?? null, createdAt: c.created_at })),
    referrals: (referralsRaw ?? []).map((r) => ({ id: r.referral_id, referredClubName: r.referred_club_name ?? "A club", status: r.status as ReferralStatus, rewardAmountPence: r.reward_amount_pence ?? null, qualifiedAt: r.qualified_at ?? null, createdAt: r.created_at })),
    hasNothingYet: state === null || (state.effectivePlan === null && state.trialStatus === null),
  }
}

export async function choosePlatformPlan(supabase: Client, clubId: string, planCode: string): Promise<void> {
  const { error } = await supabase.rpc("select_club_plan", { p_club_id: clubId, p_plan_code: planCode })
  if (error) throw error
}

export async function startPlatformTrial(supabase: Client, clubId: string): Promise<void> {
  const { error } = await supabase.rpc("start_club_trial", { p_club_id: clubId })
  if (error) throw error
}

const SECONDS_PER_DAY = 86_400

/** Nine states, written out, because the failure mode of a billing page is a state nobody wrote copy for. */
export function describeBillingState(state: ClubBillingState, planName: string): { headline: string; explanation: string | null } {
  const days = state.trialRemainingSeconds === null ? null : Math.ceil(state.trialRemainingSeconds / SECONDS_PER_DAY)
  switch (state.subscriptionStatus) {
    case "active":
      return { headline: planName, explanation: null }
    case "past_due":
      return { headline: `${planName} · payment failed`, explanation: "The last collection did not go through. Nothing has changed about your access to Ovalball; we will try again." }
    case "scheduled":
      return { headline: `${planName} · starting`, explanation: "Your Direct Debit is set up. The first collection is scheduled." }
    case "pending_setup":
      return { headline: `${planName} · setup needed`, explanation: "Set up a Direct Debit with Ovalball to start your subscription." }
    case "cancelled":
      return { headline: `${planName} · ending`, explanation: "Your subscription is cancelled. You keep everything until the period you have paid for ends." }
    case "ended":
      return { headline: "No plan", explanation: "Your Ovalball subscription has ended. Choose a plan to start again." }
  }
  if (state.trialStatus === "active") return { headline: days === null ? "Free trial" : `Free trial · ${days} ${days === 1 ? "day" : "days"} left`, explanation: null }
  if (state.trialStatus === "paused") {
    return {
      headline: days === null ? "Free trial · paused" : `Free trial · ${days} ${days === 1 ? "day" : "days"} left`,
      explanation: state.platformMode === "beta" ? "Your trial is paused while Ovalball is in Beta. The days you have left are held, and start running again when Beta ends." : "Your trial is paused. The days you have left are held until you resume it.",
    }
  }
  if (state.trialStatus === "completed") return { headline: "Trial ended", explanation: "Choose a plan to carry on using Ovalball." }
  if (state.trialStatus === "converted") return { headline: "No plan", explanation: "Choose a plan to start again." }
  return { headline: "No plan yet", explanation: "Start a free trial, or choose a plan." }
}

export function describeNextCollection(state: ClubBillingState, next: NextCollection | null): { text: string; attention: boolean } {
  if (state.platformMode === "beta") return { text: "Nothing while Ovalball is in Beta", attention: false }
  if (state.subscriptionStatus === "past_due") return { text: "We will try the failed collection again", attention: true }
  if (state.subscriptionStatus === "cancelled") return { text: state.currentPeriodEnd ? `Nothing — your plan runs until ${formatFinanceDate(state.currentPeriodEnd, "long")}` : "Nothing more will be collected", attention: false }
  if (state.subscriptionStatus === "pending_setup") return { text: "Nothing until your Direct Debit is set up", attention: true }
  if (!next) return { text: state.trialStatus === "active" || state.trialStatus === "paused" ? "Nothing yet — you are on a free trial" : "Nothing scheduled", attention: false }
  if (next.willSkip) return { text: `Nothing${state.nextCollectionOn ? ` on ${formatFinanceDate(state.nextCollectionOn, "long")}` : ""} — covered by your ${formatMinorUnits(next.creditAppliedPence)} credit`, attention: false }
  const when = state.nextCollectionOn ? ` on ${formatFinanceDate(state.nextCollectionOn, "long")}` : ""
  const credited = next.creditAppliedPence > 0 ? ` (${formatMinorUnits(next.creditAppliedPence)} credit applied)` : ""
  return { text: `${formatMinorUnits(next.netPence)}${when}${credited}`, attention: false }
}

export function describePlatformPayment(p: Pick<PlatformPaymentRow, "status" | "creditAppliedPence" | "failureReason">): string {
  switch (p.status) {
    case "confirmed":
      return "Collected"
    case "skipped":
      return `Skipped — covered by your ${formatMinorUnits(p.creditAppliedPence)} credit`
    case "failed":
      return p.failureReason ? `Failed — ${p.failureReason.replace(/_/g, " ")}` : "Failed"
    case "submitted":
      return "On its way to your bank"
    case "cancelled":
      return "Cancelled"
    default:
      return "Scheduled"
  }
}

export function describeCreditSource(source: string): string {
  switch (source) {
    case "referral_reward":
      return "Referral reward"
    case "goodwill":
      return "Credit from Ovalball"
    case "beta_adjustment":
      return "Beta adjustment"
    case "application":
      return "Applied to a collection"
    case "reversal":
      return "Reversed"
    default:
      return "Credit"
  }
}

export function describeReferral(r: Pick<ClubReferral, "status">): { label: string; attention: boolean } {
  switch (r.status) {
    case "pending":
      return { label: "Invitation sent", attention: false }
    case "registered":
      return { label: "On Ovalball, not yet paid", attention: false }
    case "qualified":
      return { label: "Reward earned", attention: false }
    case "reversed":
      return { label: "Reward withdrawn — their payment didn't complete", attention: true }
    default:
      return { label: "Not eligible", attention: false }
  }
}

// ------------------------------------------------------------------------------------------------
// WHAT A PERSON READS WHEN THE SERVER SAYS NO
// ------------------------------------------------------------------------------------------------

/** The finance RPCs raise product-language sentences on purpose; those are shown as they are. */
export function financeErrorMessage(cause: unknown, fallback: string): string {
  const e = (cause ?? {}) as { code?: string; message?: string }
  const message = e.message ?? ""
  if (e.code === "42501") return /not authori[sz]ed/i.test(message) ? message : "You are not authorised to do this for this club."
  if (/not available to buy/i.test(message)) return "That plan is not available to buy yet."
  if (e.code === "22023" || e.code === "23514" || e.code === "P0001" || e.code === "P0002") return message || fallback
  return fallback
}
