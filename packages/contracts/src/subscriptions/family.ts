import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { STANDING_LABEL, reasonSentence, type MembershipReason, type MembershipStanding } from "../membership/board"

/**
 * A FAMILY'S MEMBERSHIP, AS A PARENT SEES IT.
 *
 * ONE PAYMENT DOMAIN, AND IT IS THE WEB'S. `club_subscription_programmes`,
 * `player_subscription_payers`, `gocardless_mandates`, `gocardless_subscriptions`
 * -- the same records the parent's own subscription page reads on the website and
 * the same ones GoCardless's webhooks reconcile. There is no mobile ledger, no
 * local "Active" boolean and nothing to synchronise: a mandate authorised through
 * the provider-hosted flow appears here because the record changed, not because
 * anything copied it.
 *
 * AND THE AUTHORITY IS THE FAMILY'S, NOT A STAFF CAPABILITY.
 * `family_membership_standing` is the canonical entry point -- a guardian's or the
 * linked player's own relationship to that child, checked on the server -- and the
 * parent page's own `get_enrolment_eligibility` decides who may SET UP a membership.
 * `finance.subscription.view` is a TEAM STAFF rule for a different question
 * ("what does this squad owe") and is deliberately not consulted here.
 *
 * STATUSES ARE THE PROVIDER'S OWN WORDS, NEVER COLLAPSED. "Submitted to your bank"
 * and "Active" are different facts, and so are "Collected from your account" and
 * "Collected and paid out to the club". Flattening them into "Paid" would tell a
 * parent something GoCardless has not said.
 */

/** GoCardless mandate statuses, in the web's own words. */
export const MANDATE_STATUS_LABEL: Record<string, string> = {
  pending_submission: "Submitted to your bank, not yet active",
  submitted: "Submitted to your bank, not yet active",
  active: "Active",
  failed: "Setup failed",
  cancelled: "Cancelled",
  expired: "Expired",
  consumed: "Replaced by a newer mandate",
  suspended_by_payer: "Suspended at your bank",
  blocked: "Blocked by GoCardless",
}

/** GoCardless subscription statuses, in the web's own words. */
export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  pending: "Set up, first collection not yet due",
  active: "Active",
  finished: "Finished",
  cancelled: "Cancelled",
  paused: "Paused",
}

/**
 * WHAT, IF ANYTHING, THIS FAMILY NEEDS TO DO.
 *
 * Deliberately narrow. A provider processing state is NOT something to act on:
 * "submitted to your bank" is GoCardless doing its job, and dressing it as a task
 * would have parents chasing a bank over nothing. Only a genuine absence or a
 * genuine failure is attention.
 */
/**
 * A family's task, if any. `start_required` (20270753000000): the payer's Direct Debit is in place but they never
 * started the membership, so nothing is collected until they do.
 */
export type SubscriptionAttention = "none" | "setup_required" | "start_required" | "failed"

export interface FamilySubscription {
  playerId: string
  playerName: string
  clubId: string
  /**
   * WHAT IT IS CALLED.
   *
   * "Membership" -- the platform's own word for this obligation, used throughout
   * the payments domain (`membership_obligations`, `end_membership_subscription`,
   * the web's own activate-membership path). A club's programme has no NAME
   * column: `club_subscription_programmes` is one unnamed programme per club, so
   * there is nothing else to call it and "Club Membership" would be a label
   * invented to match a mock-up.
   */
  programmeName: string
  /** The canonical status, in the provider's own words. Null where nothing is set up. */
  statusLabel: string | null
  attention: SubscriptionAttention
  /** One line saying what is true, for a card with no room for a page. */
  detail: string | null
}

/**
 * The family's membership state for one child at one club, or null where the club
 * runs no subscription programme at all -- which is not a problem to report, it is
 * simply a club that does not collect subscriptions through Ovalball.
 *
 * ONE STANDING, THE SAME ONE THE CLUB AND THE TEAM SEE (20270747000000). It used to
 * be worked out here from rows only the PAYER can read, so a second guardian saw
 * "setup required" for a healthy membership, and a payment that failed while the
 * Direct Debit was live projected nothing -- the payment-failed notice was then
 * paired to an item that did not exist. `family_membership_standing` is the family's
 * own door to `internal.membership_standing`: the server checks that the reader is
 * the child's active guardian or the linked player, and says only whether the reader
 * is the payer.
 *
 * ATTENTION IS STILL ONLY A GENUINE ABSENCE OR A GENUINE FAILURE. Money with the bank,
 * being retried or scheduled is GoCardless doing its job (Collecting), and an ordinary
 * month not yet collected is not a task; nothing set up, a Direct Debit to finish, and
 * a payment or Direct Debit that failed are.
 */
export async function loadFamilySubscription(
  supabase: SupabaseClient<Database>,
  input: { playerId: string; playerName: string; clubId: string }
): Promise<FamilySubscription | null> {
  const { data, error } = await supabase.rpc("family_membership_standing", { p_player_id: input.playerId, p_club_id: input.clubId })
  if (error) throw error
  const row = (data ?? {}) as {
    programme_enabled?: boolean
    standing?: MembershipStanding | null
    reason?: MembershipReason | null
    has_payer?: boolean
    payer_is_you?: boolean
  }
  // NO PROGRAMME IS NOT A GAP. A club that has not configured subscriptions has
  // nothing for a parent to see, and a card saying so would be furniture.
  if (!row.programme_enabled) return null

  const base = {
    playerId: input.playerId,
    playerName: input.playerName,
    clubId: input.clubId,
    programmeName: "Membership",
  }
  // SOMEBODY ELSE PAYS (20270753000000): the server says only that it is in hand -- never the payer's figures or how
  // their Direct Debit is doing -- so there is nothing here for this reader to do.
  if (row.has_payer && !row.payer_is_you) {
    return { ...base, statusLabel: "Set up by someone else", attention: "none", detail: "Someone else looks after the payments for this membership." }
  }
  if (!row.standing || !row.reason) {
    return { ...base, statusLabel: null, attention: "setup_required", detail: "Payment has not been set up yet." }
  }
  const attention = familyAttention(row.standing, row.reason)
  return {
    ...base,
    statusLabel: STANDING_LABEL[row.standing],
    attention,
    detail: attention === "none" ? null : attention === "start_required" ? FAMILY_START_SENTENCE : reasonSentence(row.reason, "team"),
  }
}

/** To the payer, whose task it is: the Direct Debit is set up, and the membership is waiting for them to start it. */
export const FAMILY_START_SENTENCE = "Your Direct Debit is set up, but the membership hasn't started. Start it so the club can collect it."

/** Only a genuine absence, a membership waiting to be started, or a genuine failure is a family's task; a processing state never is. */
export function familyAttention(standing: MembershipStanding, reason: MembershipReason): SubscriptionAttention {
  if (standing === "NOT_SET_UP") return "setup_required"
  if ((standing === "DUE" || standing === "OVERDUE") && reason === "NOT_STARTED") return "start_required"
  if ((standing === "DUE" || standing === "OVERDUE") && reason === "SETUP_UNFINISHED") return "setup_required"
  const failed = standing === "ACTION_NEEDED" && (reason === "PAYMENT_FAILED" || reason === "CHARGED_BACK" || reason === "PAYMENT_CANCELLED" || reason === "MANDATE_PROBLEM")
  return failed ? "failed" : "none"
}
