import { createServiceRoleClient } from "@/lib/supabase/service-role"

import { gcRequest } from "./client"
import type { GoCardlessEnvironment } from "./env"

// Each set must exactly match its table's status check, which since 20270749000000 holds GoCardless's whole
// documented vocabulary for that resource (https://docs.gocardless.com/docs/api-reference/{mandate,subscription,
// payment,billing-request}). A status outside the set is one GoCardless has not documented: never written.

// gocardless_mandates_status_check.
const KNOWN_MANDATE_STATUSES: ReadonlySet<string> = new Set(["pending_customer_approval", "pending_submission", "submitted", "active", "suspended_by_payer", "failed", "cancelled", "expired", "consumed", "blocked"])

// gocardless_subscriptions_status_check, less Ovalball's own 'pending' (its state before GoCardless has answered),
// which GoCardless never reports.
const KNOWN_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(["pending_customer_approval", "customer_approval_denied", "active", "finished", "cancelled", "paused"])

// gocardless_payments_status_check -- GoCardless's own real Payment resource `status` field uses this exact
// vocabulary, so no separate translation table is needed here the way PAYMENT_ACTION_TO_GC_STATUS translates the
// webhook *action* name. pending_customer_approval and customer_approval_denied used to be missing, so an event for
// either failed for ever (20270749000000, G4).
const KNOWN_PAYMENT_STATUSES: ReadonlySet<string> = new Set(["pending_customer_approval", "pending_submission", "submitted", "confirmed", "paid_out", "failed", "cancelled", "customer_approval_denied", "charged_back"])

// gocardless_billing_requests_status_check, as GoCardless documents it. ready_to_fulfil and fulfilling used to be
// passed through unchecked and refused by the table, so an event for either failed for ever (G4).
const KNOWN_BILLING_REQUEST_STATUSES: ReadonlySet<string> = new Set(["pending", "ready_to_fulfil", "fulfilling", "fulfilled", "cancelled"])

interface GoCardlessBillingRequestResponse {
  billing_requests: {
    status: string
    links?: { customer?: string; mandate_request_mandate?: string }
  }
}

interface GoCardlessMandateResponse {
  mandates: {
    status: string
    scheme?: string
    next_possible_charge_date?: string
  }
}

/**
 * THE ONE canonical write path for turning a real GoCardless Billing
 * Request into local gocardless_customers/gocardless_mandates rows and an
 * up-to-date gocardless_billing_requests.status. Called from both the
 * Parent's synchronous return to /parent/players/[playerId]/subscription
 * and the webhook handler on any billing_requests/mandates event --
 * neither caller does its own mapping. Always re-fetches provider truth
 * (webhook payloads are notification metadata, never authoritative
 * resource state); never trusts a client-supplied customer/mandate ID.
 *
 * `billingRequestLocalId` is OUR row's id
 * (public.gocardless_billing_requests.id) -- never a client-suppliable
 * club/programme pair -- the write RPC derives club/payer ownership
 * entirely from that existing row, so this can never attach a real
 * provider object to the wrong club.
 *
 * ORDERED BY OBSERVATION (20270749000000, G9). The moment of each re-fetch -- the billing request's and the
 * mandate's -- is passed as its observation time, taken before the request is sent: an observation that arrives
 * after a newer one changes nothing, and GoCardless's final states never reopen (a mandate's reinstatement from
 * cancelled or expired is the one way back GoCardless documents, and is allowed).
 */
export async function reconcileGoCardlessBillingRequest(params: {
  environment: GoCardlessEnvironment
  accessToken: string
  billingRequestLocalId: string
  gcBillingRequestId: string
}): Promise<{ status: string; customerId: string | null; mandateId: string | null }> {
  const observedAt = new Date().toISOString()
  const billingRequest = await gcRequest<GoCardlessBillingRequestResponse>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "GET",
    path: `/billing_requests/${params.gcBillingRequestId}`,
  })

  const rawStatus = billingRequest.billing_requests.status
  // An undocumented status is never written; the customer and mandate it links are still reconciled.
  const status = rawStatus && KNOWN_BILLING_REQUEST_STATUSES.has(rawStatus) ? rawStatus : null
  const gcCustomerId = billingRequest.billing_requests.links?.customer ?? null
  const gcMandateId = billingRequest.billing_requests.links?.mandate_request_mandate ?? null

  let mandateStatus: string | null = null
  let mandateScheme: string | null = null
  let nextPossibleChargeDate: string | null = null
  let mandateObservedAt: string | null = null

  if (gcMandateId) {
    try {
      const observed = new Date().toISOString()
      const mandate = await gcRequest<GoCardlessMandateResponse>({
        environment: params.environment,
        accessToken: params.accessToken,
        method: "GET",
        path: `/mandates/${gcMandateId}`,
      })
      const rawMandateStatus = mandate.mandates.status
      // Fail safe on an unrecognized status rather than trusting it
      // blindly -- never let a provider value we don't understand imply
      // something we can't back up.
      mandateStatus = rawMandateStatus && KNOWN_MANDATE_STATUSES.has(rawMandateStatus) ? rawMandateStatus : null
      mandateScheme = mandate.mandates.scheme ?? null
      nextPossibleChargeDate = mandate.mandates.next_possible_charge_date ?? null
      mandateObservedAt = observed
    } catch {
      // Mandate fetch failed -- still record the customer/billing-request
      // status we DO have; the mandate itself stays unreconciled until a
      // later call succeeds (never guessed).
    }
  }

  const supabase = createServiceRoleClient()
  const { error } = await supabase.rpc("reconcile_gocardless_billing_request", {
    p_billing_request_local_id: params.billingRequestLocalId,
    // The SQL params are genuinely nullable (a status GoCardless has not
    // documented, a mandate that does not exist yet, a status/scheme/date
    // that could not be read) -- the generated RPC Args type doesn't encode
    // Postgres NULL-ability for scalar params, so the nulls here are cast,
    // not actually unsafe.
    p_gc_billing_request_status: status as string,
    p_gc_customer_id: gcCustomerId as string,
    p_gc_mandate_id: gcMandateId as string,
    p_mandate_status: mandateStatus as string,
    p_mandate_scheme: mandateScheme as string,
    p_next_possible_charge_date: nextPossibleChargeDate as string,
    p_observed_at: observedAt,
    p_mandate_observed_at: (mandateObservedAt ?? observedAt) as string,
  })
  if (error) throw new Error(error.message)

  return { status: rawStatus, customerId: gcCustomerId, mandateId: gcMandateId }
}

interface GoCardlessSubscriptionResponse {
  subscriptions: {
    status: string
  }
}

/**
 * The canonical Subscription webhook reconciliation path, mirroring
 * reconcileGoCardlessBillingRequest exactly. Deliberately ACTION-AGNOSTIC
 * -- called uniformly for ANY `resource_type: "subscriptions"` event
 * regardless of its `action` value. GoCardless's real `action` field is
 * the short unprefixed verb ("created"), not a longer resource-prefixed
 * form -- rather than invent a full action->meaning mapping table from
 * unverified names, this always re-fetches the real Subscription resource
 * and reconciles its real current status -- the same "never trust the
 * action string, only the re-fetched resource" principle used for
 * billing_requests. The moment of the re-fetch is its observation time
 * (20270749000000, G9): a late observation never reopens a cancelled or
 * finished subscription.
 */
export async function reconcileGoCardlessSubscription(params: {
  environment: GoCardlessEnvironment
  accessToken: string
  localSubscriptionId: string
  gcSubscriptionId: string
  gcEventId?: string
  // Who/what triggered this reconciliation, for an accurate audit trail --
  // defaults to the real webhook path's identity (no human actor). An
  // admin-triggered reconciliation (e.g. after cancelMembership's real
  // provider cancel call) passes 'admin_ui' and the acting admin's own id
  // explicitly -- auth.uid() cannot be relied on here since this always
  // runs via the service-role client.
  source?: "webhook" | "admin_ui" | "parent_ui" | "system"
  actorUserId?: string
}): Promise<{ status: string | null }> {
  const observedAt = new Date().toISOString()
  const subscription = await gcRequest<GoCardlessSubscriptionResponse>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "GET",
    path: `/subscriptions/${params.gcSubscriptionId}`,
  })

  const rawStatus = subscription.subscriptions.status
  // Fail safe: an unrecognized status is never written -- the RPC's own
  // null handling additionally defends this, but validating here too means we
  // never even attempt to pass a bogus value across the boundary.
  const status = rawStatus && KNOWN_SUBSCRIPTION_STATUSES.has(rawStatus) ? rawStatus : null

  const supabase = createServiceRoleClient()
  const { error } = await supabase.rpc("reconcile_gocardless_subscription", {
    p_local_subscription_id: params.localSubscriptionId,
    p_gc_status: status as string,
    p_gc_event_id: params.gcEventId,
    p_source: params.source ?? "webhook",
    p_actor_user_id: params.actorUserId,
    p_observed_at: observedAt,
  })
  if (error) throw new Error(error.message)

  return { status }
}

interface GoCardlessPaymentResponse {
  payments: {
    status: string
    charge_date?: string | null
    /** "Only present if the payment was created via an app" -- the partner fee, in pence. */
    app_fee?: number | null
  }
}

/** The fee GoCardless reports on the payment itself, when it is a whole number of pence. */
function appFeeOf(payment: { app_fee?: number | null }): number | null {
  return typeof payment.app_fee === "number" && Number.isInteger(payment.app_fee) && payment.app_fee >= 0 ? payment.app_fee : null
}

/**
 * The payment's own app fee, kept on its row: record_gocardless_payment_app_fee fills it where it is missing
 * (a payment recorded before fees were, or without one) and never changes a fee already recorded -- a payment's fee
 * cannot change at GoCardless once created.
 */
async function recordPaymentAppFee(gcPaymentId: string, appFeeMinor: number | null): Promise<void> {
  if (appFeeMinor === null) return
  const supabase = createServiceRoleClient()
  const { error } = await supabase.rpc("record_gocardless_payment_app_fee", { p_gc_payment_id: gcPaymentId, p_app_fee_minor: appFeeMinor })
  if (error) throw new Error(error.message)
}

/**
 * The SAME "always re-fetch, never trust the notification" discipline
 * used for billing_requests/subscriptions above, applied to payments.
 * Re-fetches the real Payment resource via GET /payments/{id} and
 * reconciles its own real `status` field -- the single most authoritative
 * source available -- and keeps the payment's own app fee.
 *
 * NO FALLBACK (20270744000000). When the re-fetch fails, this THROWS: the
 * webhook records the failure and GoCardless redelivers, or the replay
 * picks the event up. Falling back to a status guessed from the event's
 * action let a stale guess overwrite a newer, real status. The moment of
 * the re-fetch is passed as the observation time, so an observation that
 * arrives late never moves the payment, or its month, backwards.
 */
export async function reconcileGoCardlessPayment(params: { environment: GoCardlessEnvironment; accessToken: string; gcPaymentId: string; failureReasonCode?: string; gcEventId?: string }): Promise<{
  status: string | null
}> {
  const observedAt = new Date().toISOString()
  const payment = await gcRequest<GoCardlessPaymentResponse>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "GET",
    path: `/payments/${params.gcPaymentId}`,
  })
  const rawStatus = payment.payments.status
  const status = rawStatus && KNOWN_PAYMENT_STATUSES.has(rawStatus) ? rawStatus : null
  if (!status) {
    throw new Error(`GoCardless reported a payment status Ovalball does not recognise (${rawStatus ?? "none"}).`)
  }

  const supabase = createServiceRoleClient()
  const { error } = await supabase.rpc("apply_payment_status_transition", {
    p_gc_payment_id: params.gcPaymentId,
    p_new_status: status,
    p_failure_reason_code: params.failureReasonCode,
    p_charge_date: payment.payments.charge_date ?? undefined,
    p_gc_event_id: params.gcEventId,
    p_observed_at: observedAt,
  })
  if (error) throw new Error(error.message)

  await recordPaymentAppFee(params.gcPaymentId, appFeeOf(payment.payments))

  return { status }
}

interface GoCardlessPaymentDetailResponse {
  payments: {
    status: string
    amount: number
    currency: string
    charge_date: string | null
    app_fee?: number | null
    links?: { subscription?: string; mandate?: string }
  }
}

/**
 * A Payment GoCardless generates directly from a Subscription arrives as
 * a payments.created webhook for a gc_payment_id this app has never seen
 * before -- without this path, a real recurring collection would go
 * completely untracked (never shown to the Parent, never counted by
 * Finance, never reconciled) purely because nothing locally created it
 * first.
 *
 * Called only when `event.links.subscription` is present and no local
 * gocardless_payments row exists for event.links.payment. Resolution
 * path, never guessed by amount or name:
 *
 *   real Payment (re-fetched) -> its own links.subscription
 *     -> local gocardless_subscriptions row (by gc_subscription_id)
 *       -> payer_subscription_id -> club_id
 *
 * Deliberately reuses create_membership_obligations_for_period (the SAME
 * function the synchronous activateMembership() path uses) rather than
 * inventing a second obligation-creation path -- idempotent per (player,
 * programme, billing_period), so this can never create a duplicate
 * obligation whether the Club Admin already generated the period manually
 * or not. record_gocardless_payment's own defense-in-depth (initial
 * status must be pending_submission) is respected by recording first at
 * pending_submission -- with the fee GoCardless reports on the payment --
 * and then, only if the real re-fetched status has already progressed
 * further (a webhook can legitimately arrive after the payment has already
 * been submitted/confirmed), applying the real status through the SAME
 * apply_payment_status_transition() path a normal follow-up webhook would
 * use -- never a second, bespoke status-setting code path.
 *
 * A read that fails THROWS (the event is retried): "nothing found" is only
 * ever concluded from a read that worked.
 */
export async function discoverGoCardlessSubscriptionPayment(params: { environment: GoCardlessEnvironment; accessToken: string; gcPaymentId: string; gcEventId?: string }): Promise<{ discovered: boolean; reason?: string }> {
  const observedAt = new Date().toISOString()
  const payment = await gcRequest<GoCardlessPaymentDetailResponse>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "GET",
    path: `/payments/${params.gcPaymentId}`,
  })

  const gcSubscriptionId = payment.payments.links?.subscription
  if (!gcSubscriptionId) {
    // Not a subscription-generated payment -- e.g. a one-off Payment this
    // app never recorded for some other reason. Never guessed; left as a
    // documented no-op rather than inventing an obligation to attach it to.
    return { discovered: false, reason: "Payment has no links.subscription -- not a recurring-collection payment." }
  }

  const rawStatus = payment.payments.status
  if (!rawStatus || !KNOWN_PAYMENT_STATUSES.has(rawStatus)) {
    throw new Error(`GoCardless reported a payment status Ovalball does not recognise (${rawStatus ?? "none"}).`)
  }
  const appFeeMinor = appFeeOf(payment.payments)

  const supabase = createServiceRoleClient()
  const { data: subscriptionRow, error: subscriptionError } = await supabase.from("gocardless_subscriptions").select("id, club_id, payer_subscription_id").eq("gc_subscription_id", gcSubscriptionId).maybeSingle()
  if (subscriptionError) throw new Error(subscriptionError.message)
  if (!subscriptionRow) {
    // The Subscription itself isn't one of ours -- cross-club/foreign
    // resource, never attached.
    return { discovered: false, reason: `No local subscription row for gc_subscription_id ${gcSubscriptionId}.` }
  }

  const chargeDate = payment.payments.charge_date
  if (!chargeDate) {
    return { discovered: false, reason: "Payment has no charge_date -- cannot resolve a billing period." }
  }
  const billingPeriod = `${chargeDate.slice(0, 7)}-01`

  const { error: generateError } = await supabase.rpc("create_membership_obligations_for_period", {
    p_club_id: subscriptionRow.club_id,
    p_billing_period: billingPeriod,
  })
  if (generateError) throw new Error(`Failed to ensure obligation exists: ${generateError.message}`)

  const { data: obligation, error: obligationError } = await supabase.from("membership_obligations").select("id, gocardless_payment_id").eq("payer_subscription_id", subscriptionRow.payer_subscription_id).eq("billing_period", billingPeriod).maybeSingle()
  if (obligationError) throw new Error(obligationError.message)
  if (!obligation) {
    // The programme may have been disabled between the Subscription's
    // creation and this charge, or the payer's effective_from postdates
    // this period -- create_membership_obligations_for_period is the
    // single source of truth for whether an obligation should exist; if
    // it declines to create one, this payment is not silently attached to
    // the wrong period.
    return { discovered: false, reason: `create_membership_obligations_for_period did not produce an obligation for payer_subscription ${subscriptionRow.payer_subscription_id}, period ${billingPeriod}.` }
  }

  if (obligation.gocardless_payment_id) {
    // THE MONTH IS ALREADY BEING COLLECTED by another payment, so this one is a second collection for the same
    // month. It used to be dropped here in silence -- never in the ledger, never in a dashboard, and nobody told
    // if it later failed. Now it is put on the club's finance record, where it is seen and can be refunded.
    const { data: existing, error: existingError } = await supabase.from("gocardless_payments").select("gc_payment_id").eq("id", obligation.gocardless_payment_id).maybeSingle()
    if (existingError) throw new Error(existingError.message)
    if (existing?.gc_payment_id !== params.gcPaymentId) {
      const { error: auditError } = await supabase.from("finance_audit_log").insert({
        actor_user_id: null,
        club_id: subscriptionRow.club_id,
        action: "subscription_payment_unmatched",
        target_table: "membership_obligations",
        target_id: obligation.id,
        new_value: { gc_payment_id: params.gcPaymentId, amount_minor: payment.payments.amount, currency: payment.payments.currency, charge_date: chargeDate, already_collected_by: existing?.gc_payment_id ?? null },
        source: "webhook",
      })
      if (auditError) throw new Error(`Failed to record an unmatched collection: ${auditError.message}`)
      return { discovered: false, reason: `The ${billingPeriod.slice(0, 7)} membership is already collected by ${existing?.gc_payment_id ?? "another payment"}; this second collection is on the club's finance record.` }
    }
  }

  if (!obligation.gocardless_payment_id) {
    const { error: recordError } = await supabase.rpc("record_gocardless_payment", {
      p_obligation_id: obligation.id,
      p_gc_payment_id: params.gcPaymentId,
      p_amount_minor: payment.payments.amount,
      p_currency: payment.payments.currency,
      p_charge_date: chargeDate,
      p_status: "pending_submission",
      p_gocardless_subscription_id: subscriptionRow.id,
      // The fee GoCardless deducted from this collection -- a subscription's app_fee applies to "each payment".
      p_app_fee_minor: appFeeMinor ?? undefined,
    })
    if (recordError) throw new Error(`Failed to record discovered payment: ${recordError.message}`)
  }
  // Already recorded (a replay of this discovery): its fee is still kept, if it was missing.
  await recordPaymentAppFee(params.gcPaymentId, appFeeMinor)

  // The real status may already be past pending_submission by the time
  // this webhook is processed -- bring it current through the exact same
  // path a normal follow-up event uses, never a bespoke setter.
  if (rawStatus !== "pending_submission") {
    const { error: transitionError } = await supabase.rpc("apply_payment_status_transition", {
      p_gc_payment_id: params.gcPaymentId,
      p_new_status: rawStatus,
      p_failure_reason_code: undefined,
      p_charge_date: chargeDate,
      p_gc_event_id: params.gcEventId,
      p_observed_at: observedAt,
    })
    if (transitionError) throw new Error(`Failed to apply discovered payment's current status: ${transitionError.message}`)
  }

  return { discovered: true }
}
