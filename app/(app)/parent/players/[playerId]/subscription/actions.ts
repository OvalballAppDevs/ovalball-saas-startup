"use server"

import { revalidatePath } from "next/cache"

import { activateMembership } from "@/lib/payments/gocardless/activate-membership"
import { createBillingRequestWithFlow } from "@/lib/payments/gocardless/billing_requests"
import { cancelMembership } from "@/lib/payments/gocardless/cancel-membership"
import { getAppBaseUrl } from "@/lib/payments/gocardless/env"
import { createClient } from "@/lib/supabase/server"

export type StartEnrolmentResult = { ok: true; authorisationUrl: string } | { ok: false; error: string }
export type ActivateMembershipActionResult = { ok: true } | { ok: false; error: string }
export type CancelOwnMembershipResult = { ok: true } | { ok: false; error: string }

/**
 * The ONE server action a Parent's "Set Up Direct Debit" button calls.
 * It never creates a mandate itself -- it claims payer responsibility
 * (if not already claimed), then starts a GoCardless Billing Request
 * Flow and returns the authorisation_url for the browser to navigate
 * to; GoCardless's own hosted flow collects the actual bank details and
 * mandate authorization, never this app.
 */
export async function startSubscriptionEnrolment(playerId: string, programmeId: string, clubId: string): Promise<StartEnrolmentResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  const { data: existing } = await supabase.from("player_subscription_payers").select("id").eq("player_id", playerId).eq("programme_id", programmeId).eq("status", "active").maybeSingle()

  let payerSubscriptionId = existing?.id ?? null
  if (!payerSubscriptionId) {
    const { data: claimedId, error: claimError } = await supabase.rpc("claim_responsible_payer", { p_player_id: playerId, p_programme_id: programmeId })
    if (claimError) return { ok: false, error: claimError.message }
    payerSubscriptionId = claimedId
  }

  const { data: tokenRow, error: tokenError } = await supabase.rpc("get_gocardless_token_for_payer_subscription", { p_payer_subscription_id: payerSubscriptionId }).maybeSingle()
  if (tokenError || !tokenRow) {
    return { ok: false, error: "This club's GoCardless connection is not ready yet. Please try again later or contact the club." }
  }

  try {
    const result = await createBillingRequestWithFlow({
      environment: tokenRow.environment as "sandbox" | "production",
      accessToken: tokenRow.access_token,
      idempotencyKey: `billing-request-${payerSubscriptionId}`,
      redirectUri: `${getAppBaseUrl()}/parent/players/${playerId}/subscription`,
    })

    const { error: recordError } = await supabase.rpc("record_billing_request", {
      p_payer_subscription_id: payerSubscriptionId,
      p_club_id: clubId,
      p_gc_billing_request_id: result.billingRequestId,
      p_gc_billing_request_flow_id: result.flowId,
      p_authorisation_url: result.authorisationUrl,
    })
    if (recordError) return { ok: false, error: recordError.message }

    revalidatePath(`/parent/players/${playerId}/subscription`)
    return { ok: true, authorisationUrl: result.authorisationUrl }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error."
    return { ok: false, error: `Could not start GoCardless Direct Debit setup: ${message}` }
  }
}

/**
 * The ONE server action the Parent's "Confirm & start membership" button
 * calls. Takes ONLY playerId -- everything else (payer subscription,
 * programme, club, mandate, price, policy) is resolved server-side from
 * that, via the SAME ownership-proving lookup pattern as
 * startSubscriptionEnrolment above (payer_user_id = auth.uid()). The
 * browser cannot influence amount, date, or which mandate is used.
 */
export async function activateMembershipAction(playerId: string): Promise<ActivateMembershipActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  const { data: payerRow } = await supabase.from("player_subscription_payers").select("id, programme_id, payer_user_id").eq("player_id", playerId).eq("status", "active").maybeSingle()
  if (!payerRow || payerRow.payer_user_id !== user.id) {
    return { ok: false, error: "No active responsible-payer relationship found for this player." }
  }

  const { data: programmeRow } = await supabase.from("club_subscription_programmes").select("club_id").eq("id", payerRow.programme_id).maybeSingle()
  if (!programmeRow) return { ok: false, error: "Programme not found." }

  const { data: billingRequestRow } = await supabase.from("gocardless_billing_requests").select("id").eq("payer_subscription_id", payerRow.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
  const { data: mandateRow } = billingRequestRow ? await supabase.from("gocardless_mandates").select("id, gc_mandate_id").eq("billing_request_id", billingRequestRow.id).maybeSingle() : { data: null }
  if (!mandateRow) {
    return { ok: false, error: "No reconciled Direct Debit mandate found yet for this player." }
  }

  const { data: tokenRow } = await supabase.rpc("get_gocardless_token_for_payer_subscription", { p_payer_subscription_id: payerRow.id }).maybeSingle()
  if (!tokenRow) {
    return { ok: false, error: "This club's GoCardless connection is not ready yet." }
  }

  try {
    const result = await activateMembership({
      supabase,
      environment: tokenRow.environment as "sandbox" | "production",
      accessToken: tokenRow.access_token,
      payerSubscriptionId: payerRow.id,
      programmeId: payerRow.programme_id,
      clubId: programmeRow.club_id,
      gocardlessMandateId: mandateRow.id,
      gcMandateId: mandateRow.gc_mandate_id,
    })
    if (!result.ok) return { ok: false, error: result.error }

    revalidatePath(`/parent/players/${playerId}/subscription`)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error."
    return { ok: false, error: `Could not activate membership: ${message}` }
  }
}

/**
 * The Parent-facing "Cancel membership" action. Deliberately calls the
 * SAME canonical cancelMembership() domain service Club Finance uses --
 * no parallel implementation. Ownership is proven here, server-side,
 * via the exact same payerRow.payer_user_id === user.id check
 * activateMembershipAction already uses -- a non-payer guardian of the
 * same player, or any unrelated user, never reaches cancelMembership()
 * at all.
 */
export async function cancelOwnMembershipAction(playerId: string, reason: string): Promise<CancelOwnMembershipResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  if (!reason || reason.trim().length === 0) return { ok: false, error: "A reason is required to cancel your membership." }

  const { data: payerRow } = await supabase.from("player_subscription_payers").select("id, programme_id, payer_user_id, status").eq("player_id", playerId).eq("status", "active").maybeSingle()
  if (!payerRow || payerRow.payer_user_id !== user.id) {
    return { ok: false, error: "No active membership found that you are the responsible payer for." }
  }

  const { data: programmeRow } = await supabase.from("club_subscription_programmes").select("club_id").eq("id", payerRow.programme_id).maybeSingle()
  if (!programmeRow) return { ok: false, error: "Programme not found." }

  const { data: tokenRow } = await supabase.rpc("get_gocardless_token_for_payer_subscription", { p_payer_subscription_id: payerRow.id }).maybeSingle()
  if (!tokenRow) return { ok: false, error: "This club's GoCardless connection is not ready yet." }

  const result = await cancelMembership({
    supabase,
    environment: tokenRow.environment as "sandbox" | "production",
    accessToken: tokenRow.access_token,
    payerSubscriptionId: payerRow.id,
    reason: reason.trim(),
    actorUserId: user.id,
  })
  if (!result.ok) return result

  revalidatePath(`/parent/players/${playerId}/subscription`)
  return { ok: true }
}
