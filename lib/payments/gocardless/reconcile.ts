import { createServiceRoleClient } from "@/lib/supabase/service-role"

import { gcRequest } from "./client"
import type { GoCardlessEnvironment } from "./env"

const KNOWN_MANDATE_STATUSES: ReadonlySet<string> = new Set(["pending_submission", "submitted", "active", "failed", "cancelled", "expired", "consumed"])

// Must exactly match gocardless_subscriptions_status_check.
const KNOWN_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(["pending", "active", "finished", "cancelled", "paused"])

// Must exactly match gocardless_payments_status_check -- GoCardless's own
// real Payment resource `status` field uses this exact vocabulary, so no
// separate translation table is needed here the way
// PAYMENT_ACTION_TO_GC_STATUS translates the webhook *action* name.
const KNOWN_PAYMENT_STATUSES: ReadonlySet<string> = new Set(["pending_submission", "submitted", "confirmed", "paid_out", "failed", "cancelled", "charged_back"])

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
 */
export async function reconcileGoCardlessBillingRequest(params: {
  environment: GoCardlessEnvironment
  accessToken: string
  billingRequestLocalId: string
  gcBillingRequestId: string
}): Promise<{ status: string; customerId: string | null; mandateId: string | null }> {
  const billingRequest = await gcRequest<GoCardlessBillingRequestResponse>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "GET",
    path: `/billing_requests/${params.gcBillingRequestId}`,
  })

  const status = billingRequest.billing_requests.status
  const gcCustomerId = billingRequest.billing_requests.links?.customer ?? null
  const gcMandateId = billingRequest.billing_requests.links?.mandate_request_mandate ?? null

  let mandateStatus: string | null = null
  let mandateScheme: string | null = null
  let nextPossibleChargeDate: string | null = null

  if (gcMandateId) {
    try {
      const mandate = await gcRequest<GoCardlessMandateResponse>({
        environment: params.environment,
        accessToken: params.accessToken,
        method: "GET",
        path: `/mandates/${gcMandateId}`,
      })
      const rawStatus = mandate.mandates.status
      // Fail safe on an unrecognized status rather than trusting it
      // blindly -- never let a provider value we don't understand imply
      // something we can't back up.
      mandateStatus = rawStatus && KNOWN_MANDATE_STATUSES.has(rawStatus) ? rawStatus : null
      mandateScheme = mandate.mandates.scheme ?? null
      nextPossibleChargeDate = mandate.mandates.next_possible_charge_date ?? null
    } catch {
      // Mandate fetch failed -- still record the customer/billing-request
      // status we DO have; the mandate itself stays unreconciled until a
      // later call succeeds (never guessed).
    }
  }

  const supabase = createServiceRoleClient()
  const { error } = await supabase.rpc("reconcile_gocardless_billing_request", {
    p_billing_request_local_id: params.billingRequestLocalId,
    p_gc_billing_request_status: status,
    // The SQL params are genuinely nullable (a mandate may not exist yet,
    // its status/scheme/date may be unknown) -- the generated RPC Args
    // type doesn't encode Postgres NULL-ability for scalar params, so the
    // nulls here are cast, not actually unsafe.
    p_gc_customer_id: gcCustomerId as string,
    p_gc_mandate_id: gcMandateId as string,
    p_mandate_status: mandateStatus as string,
    p_mandate_scheme: mandateScheme as string,
    p_next_possible_charge_date: nextPossibleChargeDate as string,
  })
  if (error) throw new Error(error.message)

  return { status, customerId: gcCustomerId, mandateId: gcMandateId }
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
 * billing_requests.
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
  const subscription = await gcRequest<GoCardlessSubscriptionResponse>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "GET",
    path: `/subscriptions/${params.gcSubscriptionId}`,
  })

  const rawStatus = subscription.subscriptions.status
  // Fail safe: an unrecognized status is never written -- the RPC's own
  // COALESCE additionally defends this, but validating here too means we
  // never even attempt to pass a bogus value across the boundary.
  const status = rawStatus && KNOWN_SUBSCRIPTION_STATUSES.has(rawStatus) ? rawStatus : null

  const supabase = createServiceRoleClient()
  const { error } = await supabase.rpc("reconcile_gocardless_subscription", {
    p_local_subscription_id: params.localSubscriptionId,
    p_gc_status: status as string,
    p_gc_event_id: params.gcEventId,
    p_source: params.source ?? "webhook",
    p_actor_user_id: params.actorUserId,
  })
  if (error) throw new Error(error.message)

  return { status }
}

interface GoCardlessPaymentResponse {
  payments: {
    status: string
  }
}

/**
 * The SAME "always re-fetch, never trust the notification" discipline
 * used for billing_requests/subscriptions above, applied to payments.
 * Re-fetches the real Payment resource via GET /payments/{id} and
 * reconciles its own real `status` field -- the single most authoritative
 * source available, immune to any mismatch between an action name and its
 * assumed status. Falls back to the action-derived status only if the
 * re-fetch itself fails (e.g. a transient network error) so a real,
 * already-verified action mapping is not thrown away over a temporary
 * provider outage.
 */
export async function reconcileGoCardlessPayment(params: { environment: GoCardlessEnvironment; accessToken: string; gcPaymentId: string; actionDerivedStatus: string | null; failureReasonCode?: string; gcEventId?: string }): Promise<{
  status: string | null
}> {
  let status: string | null = null
  try {
    const payment = await gcRequest<GoCardlessPaymentResponse>({
      environment: params.environment,
      accessToken: params.accessToken,
      method: "GET",
      path: `/payments/${params.gcPaymentId}`,
    })
    const rawStatus = payment.payments.status
    status = rawStatus && KNOWN_PAYMENT_STATUSES.has(rawStatus) ? rawStatus : null
  } catch {
    // Re-fetch failed -- fall back to the action-derived status below
    // rather than dropping a real, already-verified event entirely.
  }

  if (!status) {
    status = params.actionDerivedStatus
  }
  if (!status) {
    return { status: null }
  }

  const supabase = createServiceRoleClient()
  const { error } = await supabase.rpc("apply_payment_status_transition", {
    p_gc_payment_id: params.gcPaymentId,
    p_new_status: status,
    p_failure_reason_code: params.failureReasonCode,
    p_charge_date: undefined,
    p_gc_event_id: params.gcEventId,
  })
  if (error) throw new Error(error.message)

  return { status }
}

interface GoCardlessPaymentDetailResponse {
  payments: {
    status: string
    amount: number
    currency: string
    charge_date: string | null
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
 * pending_submission and then, only if the real re-fetched status has
 * already progressed further (a webhook can legitimately arrive after the
 * payment has already been submitted/confirmed), applying the real status
 * through the SAME apply_payment_status_transition() path a normal
 * follow-up webhook would use -- never a second, bespoke status-setting
 * code path.
 */
export async function discoverGoCardlessSubscriptionPayment(params: { environment: GoCardlessEnvironment; accessToken: string; gcPaymentId: string }): Promise<{ discovered: boolean; reason?: string }> {
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

  const supabase = createServiceRoleClient()
  const { data: subscriptionRow } = await supabase.from("gocardless_subscriptions").select("id, club_id, payer_subscription_id").eq("gc_subscription_id", gcSubscriptionId).maybeSingle()
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

  const { data: obligation } = await supabase.from("membership_obligations").select("id, gocardless_payment_id").eq("payer_subscription_id", subscriptionRow.payer_subscription_id).eq("billing_period", billingPeriod).maybeSingle()
  if (!obligation) {
    // The programme may have been disabled between the Subscription's
    // creation and this charge, or the payer's effective_from postdates
    // this period -- create_membership_obligations_for_period is the
    // single source of truth for whether an obligation should exist; if
    // it declines to create one, this payment is not silently attached to
    // the wrong period.
    return { discovered: false, reason: `create_membership_obligations_for_period did not produce an obligation for payer_subscription ${subscriptionRow.payer_subscription_id}, period ${billingPeriod}.` }
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
    })
    if (recordError) throw new Error(`Failed to record discovered payment: ${recordError.message}`)
  }

  // The real status may already be past pending_submission by the time
  // this webhook is processed -- bring it current through the exact same
  // path a normal follow-up event uses, never a bespoke setter.
  if (payment.payments.status !== "pending_submission") {
    const { error: transitionError } = await supabase.rpc("apply_payment_status_transition", {
      p_gc_payment_id: params.gcPaymentId,
      p_new_status: payment.payments.status,
      p_failure_reason_code: undefined,
      p_charge_date: chargeDate,
    })
    if (transitionError) throw new Error(`Failed to apply discovered payment's current status: ${transitionError.message}`)
  }

  return { discovered: true }
}
