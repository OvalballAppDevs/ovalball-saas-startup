import { cancelGoCardlessSubscription } from "./billing_requests"
import type { GoCardlessEnvironment } from "./env"
import { reconcileGoCardlessSubscription } from "./reconcile"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import type { Database } from "@/types/database.types"

export type CancelMembershipResult = { ok: true } | { ok: false; error: string }

/**
 * THE canonical Club-Admin-triggered membership cancellation flow. Never
 * rewrites financial history -- no membership_obligations or
 * gocardless_payments row is touched. Stops only FUTURE recurring
 * collections; an already-created Payment (e.g. this month's charge,
 * already submitted) is left exactly as it is -- cancelling a GoCardless
 * Subscription does not retroactively affect Payments it already
 * generated (GoCardless does not offer, and this product does not
 * invoke, any "cancel and refund" combined operation).
 *
 * Ordering is deliberate and matches the "never mark cancelled locally
 * unless the provider genuinely cancelled it" requirement:
 *   1. authorize (the caller already did this before reaching here, via
 *      get_gocardless_token_for_club_admin_action's own capability check
 *      -- this function never runs without a real granted token)
 *   2. if a real, still-active provider Subscription exists: call
 *      GoCardless's real cancel action (idempotent via a deterministic
 *      key -- a retried/ambiguous-timeout call is always safe)
 *   3. re-fetch REAL current provider truth (never trust the action
 *      call's own response body) and reconcile through the SAME canonical
 *      reconciler the webhook path uses -- no second reconciliation code
 *      path
 *   4. ONLY once the provider Subscription is confirmed cancelled (or
 *      there was none to cancel) does the LOCAL Ovalball membership
 *      relationship get ended
 *
 * If step 2/3 throws (a real provider failure or ambiguous timeout), step
 * 4 never runs -- the membership remains "active" locally, truthfully,
 * and a retry (same deterministic idempotency key) is always safe.
 */
export async function cancelMembership(params: { supabase: SupabaseClient<Database>; environment: GoCardlessEnvironment; accessToken: string; payerSubscriptionId: string; reason: string; actorUserId: string }): Promise<CancelMembershipResult> {
  const { supabase } = params

  const { data: subscriptionRow } = await supabase.from("gocardless_subscriptions").select("id, gc_subscription_id, status").eq("payer_subscription_id", params.payerSubscriptionId).in("status", ["pending", "active"]).maybeSingle()

  if (subscriptionRow?.gc_subscription_id) {
    try {
      await cancelGoCardlessSubscription({
        environment: params.environment,
        accessToken: params.accessToken,
        subscriptionId: subscriptionRow.gc_subscription_id,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error."
      return { ok: false, error: `Could not cancel the Direct Debit subscription with GoCardless: ${message}` }
    }

    try {
      await reconcileGoCardlessSubscription({
        environment: params.environment,
        accessToken: params.accessToken,
        localSubscriptionId: subscriptionRow.id,
        gcSubscriptionId: subscriptionRow.gc_subscription_id,
        source: "admin_ui",
        actorUserId: params.actorUserId,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error."
      return { ok: false, error: `The provider cancellation may have succeeded, but re-fetching its current status failed: ${message}. Please retry -- this is safe.` }
    }
  }

  // Only now, after the provider Subscription is confirmed cancelled (or
  // there never was an active one to cancel), end the local membership
  // relationship. Uses the service-role client, matching
  // activateMembership()'s exact established precedent: the caller
  // (cancelMembershipAction) already independently proved the real
  // actor's manage_payment_actions capability for this exact club BEFORE
  // ever reaching this function, so this does not grant any privilege
  // beyond what was already verified -- actorUserId is passed explicitly
  // since auth.uid() would resolve to nothing under service_role.
  const serviceSupabase = createServiceRoleClient()
  const { error: endError } = await serviceSupabase.rpc("end_membership_subscription", {
    p_payer_subscription_id: params.payerSubscriptionId,
    p_reason: params.reason,
    p_actor_user_id: params.actorUserId,
  })
  if (endError) return { ok: false, error: endError.message }

  // Best-effort notification -- never fails the cancellation itself. Uses
  // the same service-role client as above -- a narrowly-scoped admin role
  // (manage_payment_actions only, without view_finance/manage_enrolment)
  // could otherwise fail this SELECT under RLS even though they were
  // already correctly authorized to cancel.
  try {
    const { data: payerRow } = await serviceSupabase.from("player_subscription_payers").select("payer_user_id, player_id, players(first_name, surname)").eq("id", params.payerSubscriptionId).maybeSingle()
    if (payerRow) {
      const playerName = payerRow.players ? `${payerRow.players.first_name} ${payerRow.players.surname}` : "your player"
      await serviceSupabase.from("notifications").insert({
        user_id: payerRow.payer_user_id,
        type: "gocardless_membership_cancelled",
        title: "Membership cancelled",
        body: `The Direct Debit membership for ${playerName} has been cancelled. No further monthly collections will be made.`,
        data: { payer_subscription_id: params.payerSubscriptionId },
      })
    }
  } catch {
    // Never fail the cancellation over a notification-insert error.
  }

  return { ok: true }
}
