import { createOneOffGoCardlessPayment } from "./payments"
import { createGoCardlessSubscription } from "./billing_requests"
import type { GoCardlessEnvironment } from "./env"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createServiceRoleClient } from "@/lib/supabase/service-role"
import type { Database } from "@/types/database.types"

export type ActivateMembershipResult = { ok: true; obligationId: string; gcPaymentId: string | null; gcSubscriptionId: string | null } | { ok: false; error: string }

/**
 * The ONE canonical server-side financial-plan-and-creation path for
 * turning a reconciled mandate into real GoCardless financial
 * instructions. Every amount, date, and policy used here is derived
 * server-side from the programme's CURRENT configuration and the
 * mandate's real provider state -- nothing is ever accepted from the
 * caller beyond the stable payerSubscriptionId (the Parent's browser has
 * no way to influence amount/date/policy).
 *
 * Two separate provider writes, each individually idempotent via a
 * deterministic key derived from a stable LOCAL id (never a fresh random
 * value per click):
 *   - the prorated first-period Payment: idempotency key derived from the
 *     membership_obligations row id (one obligation can only ever
 *     produce one Payment)
 *   - the recurring Subscription: idempotency key derived from the
 *     payer_subscription_id (one payer/programme enrolment can only ever
 *     produce one Subscription)
 *
 * If the Payment succeeds but the Subscription fails (or vice versa on a
 * retry), a repeated call resumes from whatever already exists rather
 * than re-creating it -- both GoCardless's own Idempotency-Key handling
 * and this function's own "already recorded locally" checks provide this
 * independently.
 */
export async function activateMembership(params: {
  supabase: SupabaseClient<Database>
  environment: GoCardlessEnvironment
  accessToken: string
  payerSubscriptionId: string
  programmeId: string
  clubId: string
  gocardlessMandateId: string
  gcMandateId: string
}): Promise<ActivateMembershipResult> {
  const { supabase } = params
  const today = new Date().toISOString().slice(0, 10)

  // Sibling-discount policy: the recurring amount is the PAYER'S OWN
  // permanently-snapshotted final_amount_minor (resolved once, at claim
  // time, by claim_responsible_payer -- see internal.calculate_member_price),
  // never a fresh current_subscription_price() lookup -- that would
  // silently ignore any sibling discount this specific enrolment is
  // entitled to, and would drift from what
  // create_membership_obligations_for_period independently resolves for
  // the same payer (which also reads this same snapshot).
  // Server-authoritative throughout -- nothing client-supplied.
  const { data: payerSnapshot } = await supabase.from("player_subscription_payers").select("final_amount_minor").eq("id", params.payerSubscriptionId).maybeSingle()
  const currentPrice = payerSnapshot?.final_amount_minor
  if (currentPrice == null) {
    return { ok: false, error: "This programme has no current price configured." }
  }

  const billingPeriod = `${today.slice(0, 7)}-01`

  // create_membership_obligations_for_period() is gated to
  // club.subscription.manage_enrolment/site-admin -- a batch operation
  // that processes a WHOLE club's active payers for a period, never
  // something an individual Parent's own session is authorized to call
  // directly. Using the service-role client here is safe specifically
  // because the caller (activateMembershipAction) has ALREADY proven this
  // authenticated Parent owns payerSubscriptionId before ever reaching
  // this function -- this does not grant the Parent any privilege beyond
  // generating their own already-eligible obligation for the current
  // period. Reuses the existing canonical obligation generator rather
  // than inventing a second write path -- idempotent per (player,
  // programme, billing_period) via its own unique constraint, so a retry
  // never creates a second obligation.
  const serviceRoleSupabase = createServiceRoleClient()
  await serviceRoleSupabase.rpc("create_membership_obligations_for_period", { p_club_id: params.clubId, p_billing_period: billingPeriod })

  const { data: obligation } = await supabase
    .from("membership_obligations")
    .select("id, amount_due_minor, currency, gocardless_payment_id, is_prorated")
    .eq("payer_subscription_id", params.payerSubscriptionId)
    .eq("billing_period", billingPeriod)
    .maybeSingle()

  if (!obligation) {
    return { ok: false, error: "Could not resolve the first-period obligation for this enrolment." }
  }

  let gcPaymentId: string | null = null

  if (!obligation.gocardless_payment_id && obligation.amount_due_minor > 0) {
    // Only ever create a standalone Payment for a genuinely PRORATED
    // first period -- NEXT_COLLECTION_DAY's first obligation (a full
    // month, not prorated) is collected by the recurring Subscription
    // itself, never a separate one-off Payment.
    if (obligation.is_prorated) {
      const created = await createOneOffGoCardlessPayment({
        environment: params.environment,
        accessToken: params.accessToken,
        mandateId: params.gcMandateId,
        amountMinor: obligation.amount_due_minor,
        currency: obligation.currency,
        description: "Pro-rata first month membership",
        idempotencyKey: `payment-${obligation.id}`,
      })
      gcPaymentId = created.paymentId

      // record_gocardless_payment is service_role-only: it must never
      // trust an authenticated caller's own amount/status claim, only a
      // real gc_payment_id this exact call just received back from
      // GoCardless. Ownership was already independently proven by the
      // caller before ever reaching this function.
      const { error: recordPaymentError } = await serviceRoleSupabase.rpc("record_gocardless_payment", {
        p_obligation_id: obligation.id,
        p_gc_payment_id: created.paymentId,
        p_amount_minor: obligation.amount_due_minor,
        p_currency: obligation.currency,
        p_charge_date: null as unknown as string,
        p_status: "pending_submission",
      })
      if (recordPaymentError) return { ok: false, error: recordPaymentError.message }
    }
  } else if (obligation.gocardless_payment_id) {
    const { data: existingPayment } = await supabase.from("gocardless_payments").select("gc_payment_id").eq("id", obligation.gocardless_payment_id).maybeSingle()
    gcPaymentId = existingPayment?.gc_payment_id ?? null
  }

  // Recurring Subscription -- day_of_month is the CLUB'S OWN configured
  // collection_day, never a hardcoded value that would silently ignore a
  // club's real setting. NO start_date is supplied deliberately: per
  // GoCardless's own documented semantics, omitting start_date while
  // providing day_of_month makes GoCardless itself derive the first
  // qualifying charge date (respecting the mandate's real
  // next_possible_charge_date and Bacs advance-notice rules) -- never a
  // hardcoded date guessed locally.
  const { data: programmeConfig } = await supabase.from("club_subscription_programmes").select("collection_day").eq("id", params.programmeId).maybeSingle()
  if (!programmeConfig) return { ok: false, error: "Programme configuration not found." }

  const { data: existingSub } = await supabase.from("gocardless_subscriptions").select("id, gc_subscription_id").eq("payer_subscription_id", params.payerSubscriptionId).in("status", ["pending", "active"]).maybeSingle()

  let gcSubscriptionId: string | null = existingSub?.gc_subscription_id ?? null

  if (!existingSub) {
    const { data: pricingRow } = await supabase.from("club_subscription_pricing").select("id").eq("programme_id", params.programmeId).lte("effective_from", today).order("effective_from", { ascending: false }).limit(1).maybeSingle()
    if (!pricingRow) return { ok: false, error: "No current price row found." }

    const created = await createGoCardlessSubscription({
      environment: params.environment,
      accessToken: params.accessToken,
      idempotencyKey: `subscription-${params.payerSubscriptionId}`,
      mandateId: params.gcMandateId,
      amountMinor: currentPrice,
      currency: obligation.currency,
      dayOfMonth: programmeConfig.collection_day,
      name: "Monthly membership",
    })
    gcSubscriptionId = created.subscriptionId

    // Same service_role-only requirement as the payment recording above.
    const { error: recordSubError } = await serviceRoleSupabase.rpc("record_gocardless_subscription", {
      p_payer_subscription_id: params.payerSubscriptionId,
      p_pricing_id: pricingRow.id,
      p_gocardless_mandate_id: params.gocardlessMandateId,
      p_gc_subscription_id: created.subscriptionId,
      p_amount_minor: currentPrice,
      p_status: created.status,
    })
    if (recordSubError) return { ok: false, error: recordSubError.message }
  }

  return { ok: true, obligationId: obligation.id, gcPaymentId, gcSubscriptionId }
}
