import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

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
 * `get_enrolment_eligibility` is the canonical entry point the parent page uses --
 * a guardian's or an adult player's own relationship to that child and that club.
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
export type SubscriptionAttention = "none" | "setup_required" | "failed"

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
 */
export async function loadFamilySubscription(
  supabase: SupabaseClient<Database>,
  input: { playerId: string; playerName: string; clubId: string }
): Promise<FamilySubscription | null> {
  const { data: eligibility } = await supabase
    .rpc("get_enrolment_eligibility", { p_player_id: input.playerId, p_club_id: input.clubId })
    .maybeSingle()
  // NO PROGRAMME IS NOT A GAP. A club that has not configured subscriptions has
  // nothing for a parent to see, and a card saying so would be furniture.
  if (!eligibility || !eligibility.programme_enabled) return null

  const base = {
    playerId: input.playerId,
    playerName: input.playerName,
    clubId: input.clubId,
    programmeName: "Membership",
  }

  // NOTHING SET UP YET. The one state that is genuinely a job for the parent.
  if (!eligibility.existing_payer_subscription_id) {
    return {
      ...base,
      statusLabel: null,
      attention: "setup_required",
      detail: "Payment has not been set up yet.",
    }
  }

  const { data: subscription } = await supabase
    .from("gocardless_subscriptions")
    .select("status")
    .eq("payer_subscription_id", eligibility.existing_payer_subscription_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (subscription?.status) {
    const label = SUBSCRIPTION_STATUS_LABEL[subscription.status] ?? subscription.status
    return {
      ...base,
      statusLabel: label,
      // A cancelled or finished membership is a fact, not a failure to chase.
      attention: "none",
      detail: null,
    }
  }

  /*
    A PAYER EXISTS BUT NO SUBSCRIPTION DOES, so the mandate is where the truth is:
    still with the bank, or failed. Only the second is a job.
  */
  const { data: billingRequest } = await supabase
    .from("gocardless_billing_requests")
    .select("id")
    .eq("payer_subscription_id", eligibility.existing_payer_subscription_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: mandate } = billingRequest
    ? await supabase.from("gocardless_mandates").select("status").eq("billing_request_id", billingRequest.id).maybeSingle()
    : { data: null }

  if (!mandate?.status) {
    return { ...base, statusLabel: null, attention: "setup_required", detail: "Payment setup is not finished." }
  }
  const label = MANDATE_STATUS_LABEL[mandate.status] ?? mandate.status
  const failed = mandate.status === "failed" || mandate.status === "expired" || mandate.status === "cancelled"
  return {
    ...base,
    statusLabel: label,
    attention: failed ? "failed" : "none",
    detail: failed ? label : null,
  }
}
