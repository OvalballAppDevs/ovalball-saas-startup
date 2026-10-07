import { createOneOffGoCardlessPayment } from "./payments"
import { createGoCardlessSubscription } from "./billing_requests"
import type { GoCardlessEnvironment } from "./env"
import { nextPeriod, planFirstCollection } from "./collection-plan"
import { gcRequest } from "./client"
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
  const serviceRoleSupabase = createServiceRoleClient()

  // AN UNVERIFIED CLUB CANNOT COLLECT. GoCardless: "Always check the status before allowing payment or payout
  // features" (https://docs.gocardless.com/docs/partner-integrations/getting-your-users-verified), and the status can
  // go backwards after it was successful -- so it is checked here, at the moment money would be asked for, whatever
  // a page showed earlier.
  const { data: connection } = await serviceRoleSupabase
    .from("gocardless_merchant_connections")
    .select("verification_status")
    .eq("club_id", params.clubId)
    .is("disconnected_at", null)
    .maybeSingle()
  if (connection?.verification_status !== "successful") {
    return { ok: false, error: "The club's GoCardless account is still being verified, so this Direct Debit cannot start collecting yet." }
  }

  // WHAT THE DIRECT DEBIT COLLECTS EACH MONTH, AND OVALBALL'S FEE ON IT: the one server answer
  // (membership_charge_plan, 20270748000000). It reads the enrolment's own snapshot -- the price after any sibling
  // discount, who pays Ovalball's 2.5%, the collection day it was set up with -- never a fresh price lookup, which
  // would ignore the sibling discount and drift from what create_membership_obligations_for_period bills the same
  // enrolment. Server-authoritative throughout -- nothing client-supplied.
  const { data: chargePlanData } = await serviceRoleSupabase.rpc("membership_charge_plan", { p_payer_subscription_id: params.payerSubscriptionId })
  const chargePlan = chargePlanData as { monthly_amount_minor: number | null; monthly_collect_minor: number; monthly_fee_minor: number; collection_day: number } | null
  const currentPrice = chargePlan?.monthly_amount_minor
  if (!chargePlan || currentPrice == null) {
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
  const obligationFor = async (period: string) => {
    await serviceRoleSupabase.rpc("create_membership_obligations_for_period", { p_club_id: params.clubId, p_billing_period: period })
    const { data } = await supabase
      .from("membership_obligations")
      .select("id, billing_period, amount_due_minor, collect_amount_minor, platform_fee_minor, currency, gocardless_payment_id, is_prorated")
      .eq("payer_subscription_id", params.payerSubscriptionId)
      .eq("billing_period", period)
      .maybeSingle()
    return data
  }

  // THE FIRST OBLIGATION. This month's, or -- under NEXT_COLLECTION_DAY, where a member who joins after the
  // collection day owes nothing for the joining month and the generator rightly writes nothing -- next
  // month's. Activation used to insist on this month's, so with the default settings every join after the
  // 1st was refused ("Could not resolve the first-period obligation").
  const obligation = (await obligationFor(billingPeriod)) ?? (await obligationFor(nextPeriod(billingPeriod)))
  if (!obligation) {
    return { ok: false, error: "Could not resolve the first-period obligation for this enrolment." }
  }

  // The collection day this membership was SET UP with (the enrolment's snapshot): a later settings change reaches new
  // memberships only, so it never moves an existing member's Direct Debit day.
  const programmeConfig = { collection_day: chargePlan.collection_day }
  const { data: mandateRow } = await supabase.from("gocardless_mandates").select("next_possible_charge_date").eq("id", params.gocardlessMandateId).maybeSingle()
  // THE MANDATE'S EARLIEST CHARGE DATE AS GOCARDLESS SAYS IT NOW. It moves on as days pass (a Bacs mandate's
  // next possible charge date is a working-days calculation), so the copy stored at reconciliation can be
  // stale by the time the parent activates, and a subscription started before it is refused
  // (https://docs.gocardless.com/docs/api-reference/mandate). The stored copy is only the fallback.
  const freshChargeDate = await gcRequest<{ mandates: { next_possible_charge_date?: string | null } }>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "GET",
    path: `/mandates/${params.gcMandateId}`,
  })
    .then((r) => r.mandates.next_possible_charge_date ?? null)
    .catch(() => null)

  // EACH MONTH EXACTLY ONCE (collection-plan.ts): the months the subscription cannot reach are collected
  // one-off, and the subscription starts on the first collection day after them -- explicitly, so it can
  // never charge a month a one-off already covers.
  const plan = planFirstCollection({
    firstPeriod: obligation.billing_period,
    firstIsProrated: obligation.is_prorated,
    collectionDay: programmeConfig.collection_day,
    nextPossibleChargeDate: freshChargeDate ?? mandateRow?.next_possible_charge_date ?? null,
    today,
  })

  let gcPaymentId: string | null = null
  for (const period of plan.oneOffPeriods) {
    const owed = period === obligation.billing_period ? obligation : await obligationFor(period)
    if (!owed) return { ok: false, error: `Could not resolve the obligation for ${period.slice(0, 7)}.` }
    let paymentId: string | null = null
    if (owed.gocardless_payment_id) {
      const { data: existingPayment } = await supabase.from("gocardless_payments").select("gc_payment_id").eq("id", owed.gocardless_payment_id).maybeSingle()
      paymentId = existingPayment?.gc_payment_id ?? null
    } else if (owed.amount_due_minor > 0) {
      // One obligation can only ever produce one Payment: the idempotency key is the obligation's own id.
      // The month carries its own figures (20270748000000): what GoCardless collects (the membership amount, plus
      // Ovalball's fee when the club chose that members pay it) and Ovalball's fee, requested as the payment's
      // app_fee, which GoCardless deducts from what the club receives.
      const created = await createOneOffGoCardlessPayment({
        environment: params.environment,
        accessToken: params.accessToken,
        mandateId: params.gcMandateId,
        amountMinor: owed.collect_amount_minor ?? owed.amount_due_minor,
        appFeeMinor: owed.platform_fee_minor > 0 ? owed.platform_fee_minor : undefined,
        currency: owed.currency,
        description: owed.is_prorated ? "Pro-rata first month membership" : "First month membership",
        idempotencyKey: `payment-${owed.id}`,
      })
      paymentId = created.paymentId

      // record_gocardless_payment is service_role-only: it must never
      // trust an authenticated caller's own amount/status claim, only a
      // real gc_payment_id this exact call just received back from
      // GoCardless. Ownership was already independently proven by the
      // caller before ever reaching this function.
      const { error: recordPaymentError } = await serviceRoleSupabase.rpc("record_gocardless_payment", {
        p_obligation_id: owed.id,
        p_gc_payment_id: created.paymentId,
        p_amount_minor: owed.collect_amount_minor ?? owed.amount_due_minor,
        p_currency: owed.currency,
        p_charge_date: null as unknown as string,
        p_status: "pending_submission",
        p_app_fee_minor: owed.platform_fee_minor > 0 ? owed.platform_fee_minor : undefined,
      })
      if (recordPaymentError) return { ok: false, error: recordPaymentError.message }
    }
    if (period === obligation.billing_period) gcPaymentId = paymentId
  }

  // Recurring Subscription -- day_of_month is the collection day this membership was set up with, and the start
  // date is the plan's: the first collection day after every month the one-offs cover, never earlier than the
  // mandate's next possible charge date (GoCardless's own rule for start_date).
  const { data: existingSub } = await supabase.from("gocardless_subscriptions").select("id, gc_subscription_id").eq("payer_subscription_id", params.payerSubscriptionId).in("status", ["pending", "active"]).maybeSingle()

  let gcSubscriptionId: string | null = existingSub?.gc_subscription_id ?? null

  // NOTHING TO COLLECT, NOTHING TO SCHEDULE. A fully discounted membership owes £0 every month (each month is
  // generated EXEMPT); a GoCardless subscription for £0 is refused (gocardless_subscriptions.amount_minor > 0, and
  // the £1 Bacs minimum), so activation used to fail for exactly the members who owe nothing.
  if (!existingSub && currentPrice > 0) {
    // The price row the enrolment was priced from (its snapshot), else its membership's current one.
    const { data: payerRow } = await supabase.from("player_subscription_payers").select("pricing_id, product_id").eq("id", params.payerSubscriptionId).maybeSingle()
    const { data: pricingRow } = payerRow?.pricing_id
      ? { data: { id: payerRow.pricing_id } }
      : await supabase.from("club_subscription_pricing").select("id").eq("product_id", payerRow?.product_id ?? "").lte("effective_from", today).order("effective_from", { ascending: false }).limit(1).maybeSingle()
    if (!pricingRow) return { ok: false, error: "No current price row found." }

    const created = await createGoCardlessSubscription({
      environment: params.environment,
      accessToken: params.accessToken,
      idempotencyKey: `subscription-${params.payerSubscriptionId}`,
      mandateId: params.gcMandateId,
      amountMinor: chargePlan.monthly_collect_minor,
      appFeeMinor: chargePlan.monthly_fee_minor > 0 ? chargePlan.monthly_fee_minor : undefined,
      currency: obligation.currency,
      dayOfMonth: programmeConfig.collection_day,
      name: "Monthly membership",
      startDate: plan.subscriptionStartDate,
    })
    gcSubscriptionId = created.subscriptionId

    // Same service_role-only requirement as the payment recording above.
    const { error: recordSubError } = await serviceRoleSupabase.rpc("record_gocardless_subscription", {
      p_payer_subscription_id: params.payerSubscriptionId,
      p_pricing_id: pricingRow.id,
      p_gocardless_mandate_id: params.gocardlessMandateId,
      p_gc_subscription_id: created.subscriptionId,
      p_amount_minor: chargePlan.monthly_collect_minor,
      p_status: created.status,
      p_app_fee_minor: chargePlan.monthly_fee_minor > 0 ? chargePlan.monthly_fee_minor : undefined,
    })
    if (recordSubError) return { ok: false, error: recordSubError.message }
  }

  return { ok: true, obligationId: obligation.id, gcPaymentId, gcSubscriptionId }
}
