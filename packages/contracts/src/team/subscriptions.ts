import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * SUBSCRIPTION STATE FOR ONE TEAM'S PLAYERS -- BOTH CLIENTS, ONE OPERATIONAL PROJECTION (CA-M7).
 *
 * The same canonical truth `/club/finance` reads -- `membership_obligations` for what is owed this
 * period, `player_subscription_payers` for whether anybody has taken a player on -- narrowed to the
 * players in one team, because a team manager's question is not "how is the club doing" but "is anybody
 * in MY squad not set up".
 *
 * NOTHING HERE IS A SECOND FINANCE SYSTEM. It reads the same tables through one server operation,
 * `team_subscription_status`, and invents no state. In particular it does not compute "paid": a player is
 * `PAID` only when the canonical obligation says so, and a player with no obligation this period is
 * `NOT_EXPECTED` rather than quietly "up to date". Being owed nothing and having paid are different facts.
 *
 * AUTHORITY IS THE SERVER'S. `finance.subscription.view` at TEAM scope is the bounded authority migration
 * 20270531 gave a Team Manager -- "subscription state for players of that team only, no ledger, no export,
 * no payment actions" -- and `team_subscription_status` is where that sentence is enforced: it asks the
 * capability at the team, or at the club, and refuses everybody else outright. The row policies on the
 * underlying tables still admit club scope only, which is why the read is an operation and not a query.
 *
 * NO PROVIDER DETAIL EVER LEAVES HERE. No bank account, no mandate reference, no GoCardless customer,
 * payment or payer identity. The operation's columns are the whole of what this module can know, so it
 * could not leak one if it tried.
 */
export type SubscriptionState =
  /** An obligation exists for this period and the canonical record says it is settled. */
  | "PAID"
  /** An obligation exists and is still outstanding. */
  | "DUE"
  /** An obligation exists and its payment failed. Somebody has to act. */
  | "FAILED"
  /** Somebody is meant to pay and there is no Direct Debit behind them yet. */
  | "NOT_SET_UP"
  /** No obligation for this period. Not the same as paid, and never shown as paid. */
  | "NOT_EXPECTED"

export const SUBSCRIPTION_STATE_LABEL: Record<SubscriptionState, string> = {
  PAID: "Paid",
  DUE: "Due",
  FAILED: "Payment failed",
  NOT_SET_UP: "Not set up",
  NOT_EXPECTED: "Nothing due",
}

/** The states that need somebody to do something, in the order a manager works through them. */
export const SUBSCRIPTION_ATTENTION_STATES: SubscriptionState[] = ["FAILED", "NOT_SET_UP"]

export interface TeamSubscriptionRow {
  playerId: string
  playerName: string
  state: SubscriptionState
  /** Minor units, for the period this row is about. Null where nothing is owed. */
  amountDueMinor: number | null
  currency: string | null
  /** Whether a payer relationship exists at all -- the "has anybody taken this on" question. */
  hasPayer: boolean
}

export interface TeamSubscriptionSummary {
  billingPeriod: string
  rows: TeamSubscriptionRow[]
  /** How many need somebody to do something. Drives the team's Needs Attention row. */
  attentionCount: number
  /** Whether the club collects subscriptions through Ovalball at all. False is an ordinary answer, not a gap. */
  programmeExists: boolean
}

/**
 * The canonical obligation status decides, and the absence of one is stated rather than interpreted.
 *
 * The status vocabulary is free text on the table rather than an enum, so this matches what the
 * finance domain actually writes and falls through to DUE -- outstanding -- for anything it does not
 * recognise. Erring towards "somebody still owes this" is the safe direction.
 */
export function resolveSubscriptionState(obligationStatus: string | null, hasPayer: boolean): SubscriptionState {
  if (obligationStatus === null) return hasPayer ? "NOT_EXPECTED" : "NOT_SET_UP"
  const status = obligationStatus.toLowerCase()
  if (status === "paid" || status === "settled" || status === "resolved") return "PAID"
  if (status === "failed" || status === "chargedback") return "FAILED"
  if (status === "waived" || status === "exempt" || status === "cancelled" || status === "refunded") return "NOT_EXPECTED"
  return hasPayer ? "DUE" : "NOT_SET_UP"
}

const ORDER: Record<SubscriptionState, number> = { FAILED: 0, NOT_SET_UP: 1, DUE: 2, PAID: 3, NOT_EXPECTED: 4 }

/** Pure: rows from the operation become the summary both clients render. Sorted so the work is at the top. */
export function summariseTeamSubscriptions(
  rows: { player_id: string; first_name: string | null; surname: string | null; billing_period: string; obligation_status: string | null; amount_due_minor: number | null; currency: string | null; has_payer: boolean; programme_exists: boolean }[]
): TeamSubscriptionSummary {
  const billingPeriod = rows[0]?.billing_period ?? currentBillingPeriod()
  const programmeExists = rows.some((r) => r.programme_exists)
  const projected: TeamSubscriptionRow[] = rows.map((r) => ({
    playerId: r.player_id,
    playerName: `${r.first_name ?? ""} ${r.surname ?? ""}`.trim() || "Unknown player",
    state: resolveSubscriptionState(r.obligation_status, r.has_payer),
    amountDueMinor: r.amount_due_minor,
    currency: r.currency,
    hasPayer: r.has_payer,
  }))
  projected.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.playerName.localeCompare(b.playerName))
  return {
    billingPeriod,
    rows: projected,
    attentionCount: programmeExists ? projected.filter((r) => SUBSCRIPTION_ATTENTION_STATES.includes(r.state)).length : 0,
    programmeExists,
  }
}

/** The first of the current month, which is how `membership_obligations.billing_period` is stored. */
export function currentBillingPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`
}

/** Throws the server's refusal (42501) for somebody who may not see this team's subscription state. */
export async function loadTeamSubscriptions(supabase: Client, teamId: string): Promise<TeamSubscriptionSummary> {
  const { data, error } = await supabase.rpc("team_subscription_status", { p_team_id: teamId })
  if (error) throw error
  return summariseTeamSubscriptions(data ?? [])
}

/** Minor units as a person reads them: 1250 GBP -> "£12.50". */
export function formatMinor(amountMinor: number | null, currency: string | null): string | null {
  if (amountMinor === null) return null
  const code = (currency ?? "GBP").toUpperCase()
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: code }).format(amountMinor / 100)
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${code}`
  }
}
