import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { loadStaffPlayers } from "@/lib/players/staff-players"
import type { Database } from "@/types/database.types"

type Client = SupabaseClient<Database>

/**
 * SUBSCRIPTION STATE FOR ONE TEAM'S PLAYERS.
 *
 * The same canonical truth `/club/finance` reads -- `membership_obligations` for what is owed this
 * period, `player_subscription_payers` for who pays, `gocardless_subscriptions` for whether a Direct
 * Debit exists -- narrowed to the players in one team, because a team manager's question is not "how
 * is the club doing" but "is anybody in MY squad not set up".
 *
 * NOTHING HERE IS A SECOND FINANCE SYSTEM. It reads the same tables and invents no state. In
 * particular it does not compute "paid": a player is `PAID` only when the canonical obligation says
 * so, and a player with no obligation this period is `NOT_EXPECTED` rather than quietly "up to date".
 * Being owed nothing and having paid are different facts and a manager chasing money needs them apart.
 *
 * AUTHORITY IS THE CALLER'S PROBLEM, AND IT IS A CLUB CAPABILITY.
 *
 * Every finance capability in this product is club-scoped -- `finance.subscription.view`,
 * `finance.payment.act`, `finance.enrolment.manage` and the rest all carry `valid_scopes = {club}`.
 * There is no team-scoped finance authority, so a Team Manager who is not also club finance staff
 * genuinely cannot see this, and the page must not call this loader for them. Granting a team-level
 * finance capability would be creating authority that does not exist, which is an owner decision and
 * not something a UI pass gets to assume.
 *
 * NO PROVIDER DETAIL EVER LEAVES HERE. No bank account, no mandate reference, no GoCardless customer
 * or payment id. A manager needs to know somebody is not set up; they do not need the person's
 * banking arrangements, and this shape makes leaking them impossible rather than merely unlikely.
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

export interface TeamSubscriptionRow {
  playerId: string
  playerName: string
  state: SubscriptionState
  /** Minor units, for the period this row is about. Null where nothing is owed. */
  amountDueMinor: number | null
  /** Whether a payer relationship exists at all -- the "has anybody taken this on" question. */
  hasPayer: boolean
}

export interface TeamSubscriptionSummary {
  billingPeriod: string
  rows: TeamSubscriptionRow[]
  /** How many need somebody to do something. Drives the team's Needs Attention row. */
  attentionCount: number
}

/** The first of the current month, which is how `membership_obligations.billing_period` is stored. */
function currentBillingPeriod(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`
}

export async function loadTeamSubscriptions(
  supabase: Client,
  teamId: string,
): Promise<TeamSubscriptionSummary> {
  const billingPeriod = currentBillingPeriod()

  const { data: memberships } = await supabase
    .from("player_team_memberships")
    .select("player_id")
    .eq("team_id", teamId)
    .eq("status", "active")

  const playerIds = (memberships ?? []).map((m) => m.player_id).filter(Boolean)
  if (playerIds.length === 0) return { billingPeriod, rows: [], attentionCount: 0 }

  const [{ data: obligations }, { data: payers }, players] = await Promise.all([
    supabase
      .from("membership_obligations")
      .select("player_id, status, amount_due_minor")
      .in("player_id", playerIds)
      .eq("billing_period", billingPeriod),
    supabase
      .from("player_subscription_payers")
      .select("player_id, status")
      .in("player_id", playerIds)
      .eq("status", "active"),
    loadStaffPlayers(supabase, playerIds),
  ])

  const obligationByPlayer = new Map((obligations ?? []).map((o) => [o.player_id, o]))
  const payerPlayerIds = new Set((payers ?? []).map((p) => p.player_id))

  const rows: TeamSubscriptionRow[] = playerIds.map((playerId) => {
    const obligation = obligationByPlayer.get(playerId)
    const hasPayer = payerPlayerIds.has(playerId)
    const state = resolveState(obligation?.status ?? null, hasPayer)
    return {
      playerId,
      playerName: players.get(playerId)?.displayName ?? "Unknown player",
      state,
      amountDueMinor: obligation?.amount_due_minor ?? null,
      hasPayer,
    }
  })

  // Sort the work to the top. A manager opens this to find the problems, not to read an alphabet.
  const ORDER: Record<SubscriptionState, number> = {
    FAILED: 0,
    NOT_SET_UP: 1,
    DUE: 2,
    PAID: 3,
    NOT_EXPECTED: 4,
  }
  rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.playerName.localeCompare(b.playerName))

  return {
    billingPeriod,
    rows,
    attentionCount: rows.filter((r) => r.state === "FAILED" || r.state === "NOT_SET_UP").length,
  }
}

/**
 * The canonical obligation status decides, and the absence of one is stated rather than interpreted.
 *
 * The status vocabulary is free text on the table rather than an enum, so this matches what the
 * finance domain actually writes and falls through to DUE -- outstanding -- for anything it does not
 * recognise. Erring towards "somebody still owes this" is the safe direction: the opposite would tell
 * a manager a player is settled on the strength of a word this function had never seen before.
 */
function resolveState(obligationStatus: string | null, hasPayer: boolean): SubscriptionState {
  if (obligationStatus === null) return hasPayer ? "NOT_EXPECTED" : "NOT_SET_UP"
  const status = obligationStatus.toLowerCase()
  if (status === "paid" || status === "settled" || status === "resolved") return "PAID"
  if (status === "failed") return "FAILED"
  if (status === "waived" || status === "exempt" || status === "cancelled") return "NOT_EXPECTED"
  return hasPayer ? "DUE" : "NOT_SET_UP"
}
