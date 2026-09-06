import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { PlanCode } from "./plans"
import type { PlatformMode } from "./mode"
import type { TrialStatus } from "./trial"

/**
 * A club's subscription to Ovalball — Domain B, Pipaxon collecting from
 * rugby clubs.
 *
 * Nothing here touches `club_subscription_*` or `gocardless_*`, which are a
 * club collecting from its own members through that club's own merchant.
 * The two domains share no table, no foreign key and no webhook, and the
 * database tests assert it.
 */
export type SubscriptionStatus =
  | "pending_setup"
  | "scheduled"
  | "active"
  | "past_due"
  | "cancelled"
  | "ended"

/**
 * The one shape every surface reads — Club Admin, Site Admin, billing and
 * notifications alike. Nothing recomputes "is this club paying" from parts.
 */
export interface ClubBillingState {
  /** Null when the club is on no plan: no subscription and no trial. */
  effectivePlan: PlanCode | null
  subscriptionStatus: SubscriptionStatus | null
  /** The price the club agreed to, snapshotted — not today's list price. */
  planPricePence: number | null
  currency: string
  nextCollectionOn: string | null
  currentPeriodEnd: string | null
  trialStatus: TrialStatus | null
  trialRemainingSeconds: number | null
  creditBalancePence: number
  platformMode: PlatformMode
}

/** Null when the club has no billing state, or the reader may not see it. */
export async function getClubBillingState(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<ClubBillingState | null> {
  const { data, error } = await supabase.rpc("club_platform_billing_state", { p_club_id: clubId })

  if (error || !data || data.length === 0) return null

  const row = data[0]
  return {
    effectivePlan: (row.effective_plan as PlanCode | null) ?? null,
    subscriptionStatus: (row.subscription_status as SubscriptionStatus | null) ?? null,
    planPricePence: row.plan_price_pence,
    currency: row.currency ?? "GBP",
    nextCollectionOn: row.next_collection_on,
    currentPeriodEnd: row.current_period_end,
    trialStatus: (row.trial_status as TrialStatus | null) ?? null,
    trialRemainingSeconds:
      row.trial_remaining_seconds === null ? null : Number(row.trial_remaining_seconds),
    creditBalancePence: row.credit_balance_pence ?? 0,
    platformMode: row.platform_mode === "live" ? "live" : "beta",
  }
}

export interface NextCollection {
  grossPence: number
  creditAvailablePence: number
  creditAppliedPence: number
  netPence: number
  currency: string
  /**
   * True when credit covers the whole cycle. Ovalball skips the collection
   * rather than instructing a £0.00 direct debit, which is a real bank
   * message that confuses payers and costs provider fees for nothing.
   */
  willSkip: boolean
}

/** Null when there is nothing to collect — no live subscription, or no access. */
export async function getNextCollection(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<NextCollection | null> {
  const { data, error } = await supabase.rpc("club_platform_next_collection", { p_club_id: clubId })

  if (error || !data || data.length === 0) return null

  const row = data[0]
  return {
    grossPence: row.gross_pence,
    creditAvailablePence: row.credit_available_pence,
    creditAppliedPence: row.credit_applied_pence,
    netPence: row.net_pence,
    currency: row.currency,
    willSkip: row.will_skip,
  }
}

/**
 * Whether the club is currently paying Ovalball. `past_due` counts: the
 * subscription is live and being chased, not gone.
 */
export function isPaying(state: ClubBillingState): boolean {
  return (
    state.subscriptionStatus === "active" ||
    state.subscriptionStatus === "past_due" ||
    state.subscriptionStatus === "scheduled"
  )
}

/** On the product, by any route — a paid subscription or a live trial. */
export function hasProductAccess(state: ClubBillingState): boolean {
  return state.effectivePlan !== null
}
