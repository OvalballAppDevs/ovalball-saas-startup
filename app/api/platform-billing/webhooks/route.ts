import { NextResponse, type NextRequest } from "next/server"

import {
  fetchPlatformBillingRequest,
  fetchPlatformMandate,
  fetchPlatformPayment,
  mapPlatformPaymentStatus,
} from "@/lib/platform/gocardless/billing"
import { getPlatformGoCardlessWebhookSecret } from "@/lib/platform/gocardless/env"
import { getGoCardlessEnvironment } from "@/lib/payments/gocardless/env"
import {
  verifyGoCardlessWebhookSignature,
  type GoCardlessWebhookEvent,
  type GoCardlessWebhookPayload,
} from "@/lib/payments/gocardless/webhooks"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export const dynamic = "force-dynamic"

/**
 * Ovalball's OWN billing webhook — events about clubs paying Pipaxon.
 *
 * Deliberately a separate endpoint from `/api/gocardless/webhooks`, which
 * receives events about club members paying their clubs. Different
 * merchant, different signing secret, different inbox table, different
 * tables written. An event arriving here can only ever move Domain B
 * state, and an event arriving there can only ever move Domain A state —
 * which is a property of the routing, not of remembering to check.
 *
 * There is no user session on this request. Authenticity comes entirely
 * from the HMAC signature check below; nothing else in the request is
 * trusted, including the event body's own view of an amount or a status.
 *
 * A DELIVERY IS ACKNOWLEDGED ONLY WHEN EVERY EVENT IN IT IS PROCESSED
 * (20270765000000). GoCardless retries a delivery only when it is not
 * answered with a 2xx, so a 200 is a promise that nothing in the batch is
 * left to do. Each event is claimed in `platform_provider_events` before
 * any state moves (the provider's event id is unique, so a redelivery
 * finds the same row); the route answers 500 when any event could not be
 * recorded, failed in processing, or is held right now by another
 * delivery, and GoCardless redelivers. The claim has an owner (its
 * generation): a delivery that outlives its two-minute claim applies
 * nothing more and cannot release or mark its successor's claim. An event already processed is
 * skipped, so a redelivery processes only what is left. Until 8 October
 * 2026 this answered 200 whatever happened, so an event whose inbox write
 * was refused — a database outage, or the release's read-only maintenance
 * window — was acknowledged and lost.
 *
 * Processing makes only GET requests to GoCardless; nothing here changes
 * anything at the provider. It logs event ids and counts, never a body,
 * a signature or a secret.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get("Webhook-Signature")

  let webhookSecret: string
  try {
    webhookSecret = getPlatformGoCardlessWebhookSecret()
  } catch {
    // Ovalball SaaS billing is not configured in this environment. Reject
    // rather than accept something that cannot be verified.
    console.error("[platform billing webhook] Answered 503: the webhook secret is not configured here, so nothing was recorded.")
    return NextResponse.json({ error: "Endpoint not configured." }, { status: 503 })
  }

  if (!verifyGoCardlessWebhookSignature(rawBody, signature, webhookSecret)) {
    // GoCardless documents 498 (Token Invalid) as the answer to a signature
    // that does not verify, and does not retry it.
    console.error(`[platform billing webhook] Answered 498: the signature did not verify (signature header ${signature ? "present" : "missing"}, ${Buffer.byteLength(rawBody, "utf8")} bytes). Nothing was recorded.`)
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 498 })
  }

  let payload: GoCardlessWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 })
  }

  if (!payload || !Array.isArray(payload.events)) {
    return NextResponse.json({ error: "Malformed payload: missing events array." }, { status: 400 })
  }
  // Every event must name itself before any is recorded: an event without
  // its own id cannot be made idempotent, so the batch is refused whole.
  if (!payload.events.every(isWellFormedEvent)) {
    console.error("[platform billing webhook] Answered 400: an event in the delivery has no id, resource type or action. Nothing was recorded.")
    return NextResponse.json({ error: "Malformed payload: every event needs an id, a resource_type and an action." }, { status: 400 })
  }

  const supabase = createServiceRoleClient()
  const outcome = { processed: 0, duplicate: 0, inProgress: 0, failed: 0 }

  for (const event of payload.events) {
    let claim: Claim | null = null
    try {
      const { data: claimed, error: claimError } = await supabase.rpc("claim_platform_provider_event", {
        p_provider_event_id: event.id,
        p_resource_type: event.resource_type,
        p_action: event.action,
        p_payload: JSON.parse(JSON.stringify(event)),
      })
      // A refused or unanswered write (an outage, a read-only window, a lost
      // response) is a failure: the event may not be recorded at all.
      if (claimError) throw new Error(`could not record the event: ${claimError.message}`)

      const row = claimed?.[0]
      if (!row) {
        // Not claimable: either done, or held by another delivery right now.
        // Only "done" may be acknowledged.
        const { data: done, error: stateError } = await supabase.rpc("platform_provider_event_processed", { p_provider_event_id: event.id })
        if (stateError) throw new Error(`could not read the event's state: ${stateError.message}`)
        if (done === true) {
          outcome.duplicate += 1
        } else {
          outcome.inProgress += 1
        }
        continue
      }
      claim = { eventId: row.event_id, generation: row.claim_generation }

      if (event.resource_type === "payments" && event.links?.payment) {
        await handlePaymentEvent(supabase, claim, event.links.payment, event.details?.reason_code)
      } else if (event.resource_type === "billing_requests" && event.links?.billing_request) {
        await handleBillingRequestEvent(supabase, claim, event.links.billing_request)
      } else if (event.resource_type === "mandates" && event.links?.mandate) {
        await handleMandateEvent(supabase, claim, event.links.mandate)
      }

      const { data: marked, error: markError } = await supabase.rpc("mark_platform_provider_event_processed", {
        p_event_id: claim.eventId,
        p_error: undefined,
        p_claim_generation: claim.generation,
      })
      if (markError) throw new Error(`could not mark the event processed: ${markError.message}`)
      if (marked !== true) {
        // The claim lapsed and another delivery owns the event now; it decides.
        claim = null
        outcome.inProgress += 1
        continue
      }
      outcome.processed += 1
    } catch (error) {
      if (error instanceof ClaimLost) {
        // Nothing applied by this delivery; the delivery that owns the event
        // now decides. Still not acknowledged: the redelivery will see "done".
        console.error(`[platform billing webhook] Event ${event.id}: ${error.message}`)
        outcome.inProgress += 1
        continue
      }
      outcome.failed += 1
      const message = error instanceof Error ? error.message : "Unknown error."
      console.error(`[platform billing webhook] Event ${event.id} failed: ${message}`)

      // Kept unprocessed with its reason, and the claim released, so the
      // redelivery this 500 asks for takes it again. If this write fails too,
      // the claim lapses within two minutes and the redelivery still does.
      // Only this delivery's own claim: one that lapsed may belong to a successor.
      if (claim) {
        try {
          await supabase.rpc("mark_platform_provider_event_processed", { p_event_id: claim.eventId, p_error: message, p_claim_generation: claim.generation })
        } catch {
          // Never let a failure to record a failure change the answer.
        }
      }
    }
  }

  const summary = `processed=${outcome.processed} duplicate=${outcome.duplicate} inProgress=${outcome.inProgress} failed=${outcome.failed}`
  if (outcome.failed > 0 || outcome.inProgress > 0) {
    console.error(`[platform billing webhook] Answered 500 so GoCardless redelivers: ${summary}`)
    return NextResponse.json({ ok: false, ...outcome }, { status: 500 })
  }
  return NextResponse.json({ ok: true, ...outcome })
}

/** The link each event type this route acts on must carry: without it the event cannot be reconciled. */
const REQUIRED_LINK: Record<string, string> = { payments: "payment", billing_requests: "billing_request", mandates: "mandate" }

function isWellFormedEvent(event: unknown): event is GoCardlessWebhookEvent {
  if (!event || typeof event !== "object") return false
  const e = event as Record<string, unknown>
  if (!(typeof e.id === "string" && e.id.length > 0 && e.id.length <= 255
    && typeof e.resource_type === "string" && e.resource_type.length > 0
    && typeof e.action === "string" && e.action.length > 0)) return false
  const link = REQUIRED_LINK[e.resource_type]
  if (!link) return true // a type this route records and does not act on
  const links = e.links as Record<string, unknown> | undefined
  return !!links && typeof links === "object" && typeof links[link] === "string" && (links[link] as string).length > 0
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>

interface Claim {
  eventId: string
  generation: number
}

/**
 * The state writes go through `*_for_event` functions that lock the event and
 * check this delivery's claim in the SAME transaction as the write
 * (20270765000000): a delivery that outlived its two-minute claim (a slow
 * provider call) is refused there, so it can never overwrite what a later
 * delivery applied.
 */
function throwIfClaimLost(error: { message: string; code?: string } | null, what: string): void {
  if (!error) return
  if (error.code === "PT409" || error.message.includes("platform_event_claim_lost")) throw new ClaimLost()
  throw new Error(`could not ${what}: ${error.message}`)
}

class ClaimLost extends Error {
  constructor() {
    super("the claim lapsed before the state write; another delivery owns the event")
  }
}

/**
 * The event names a payment; the payment's real state comes from
 * re-fetching it. A webhook body is a notification, never a snapshot.
 */
async function handlePaymentEvent(
  supabase: ServiceClient,
  claim: Claim,
  providerPaymentId: string,
  reasonCode: string | undefined
): Promise<void> {
  const { data: row, error } = await supabase
    .from("platform_payments")
    .select("id")
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle()
  if (error) throw new Error(`could not read the payment: ${error.message}`)

  if (!row) return // Not one of ours. Domain A's payments are not visible here.

  const remote = await fetchPlatformPayment(providerPaymentId)
  const status = mapPlatformPaymentStatus(remote.status)
  if (!status) return // A status this system does not model. Leave it alone.

  const { error: applyError } = await supabase.rpc("apply_platform_payment_status_for_event", {
    p_event_id: claim.eventId,
    p_claim_generation: claim.generation,
    p_payment_id: row.id,
    p_status: status,
    p_provider_payment_id: providerPaymentId,
    p_failure_reason: status === "failed" ? (reasonCode ?? remote.status) : undefined,
  })
  throwIfClaimLost(applyError, "apply the payment status")
}

/**
 * A billing request reaching `fulfilled` is what gives Ovalball a mandate
 * to collect against. Anything earlier reconciles to no change.
 */
async function handleBillingRequestEvent(
  supabase: ServiceClient,
  claim: Claim,
  providerBillingRequestId: string
): Promise<void> {
  const { data: subscription, error } = await supabase
    .from("platform_club_subscriptions")
    .select("club_id")
    .eq("provider_billing_request_id", providerBillingRequestId)
    .maybeSingle()
  if (error) throw new Error(`could not read the subscription: ${error.message}`)

  if (!subscription) return

  const remote = await fetchPlatformBillingRequest(providerBillingRequestId)
  const mandateId = remote.links?.mandate_request_mandate
  if (!mandateId) return

  const mandate = await fetchPlatformMandate(mandateId)

  const { error: attachError } = await supabase.rpc("attach_platform_subscription_provider_for_event", {
    p_event_id: claim.eventId,
    p_claim_generation: claim.generation,
    p_club_id: subscription.club_id,
    p_environment: getGoCardlessEnvironment(),
    p_customer_id: remote.links?.customer,
    p_mandate_id: mandateId,
    p_mandate_status: mandate.status,
  })
  throwIfClaimLost(attachError, "attach the mandate")
}

/** A mandate we already hold changing state — cancelled, failed, expired. */
async function handleMandateEvent(supabase: ServiceClient, claim: Claim, providerMandateId: string): Promise<void> {
  const { data: subscription, error } = await supabase
    .from("platform_club_subscriptions")
    .select("club_id")
    .eq("provider_mandate_id", providerMandateId)
    .maybeSingle()
  if (error) throw new Error(`could not read the subscription: ${error.message}`)

  if (!subscription) return

  const mandate = await fetchPlatformMandate(providerMandateId)

  const { error: attachError } = await supabase.rpc("attach_platform_subscription_provider_for_event", {
    p_event_id: claim.eventId,
    p_claim_generation: claim.generation,
    p_club_id: subscription.club_id,
    p_environment: getGoCardlessEnvironment(),
    p_mandate_id: providerMandateId,
    p_mandate_status: mandate.status,
  })
  throwIfClaimLost(attachError, "attach the mandate")
}
