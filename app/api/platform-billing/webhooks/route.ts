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
 * Every event is recorded in `platform_provider_events` before any state
 * moves, and that table's uniqueness on the provider's event id is what
 * makes a redelivered webhook a no-op.
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
    return NextResponse.json({ error: "Endpoint not configured." }, { status: 503 })
  }

  if (!verifyGoCardlessWebhookSignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 })
  }

  let payload: GoCardlessWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 })
  }

  if (!Array.isArray(payload.events)) {
    return NextResponse.json({ error: "Malformed payload: missing events array." }, { status: 400 })
  }

  const supabase = createServiceRoleClient()

  for (const event of payload.events) {
    let recordedId: string | null = null
    try {
      const { data: inserted, error: insertError } = await supabase.rpc(
        "record_platform_provider_event",
        {
          p_provider_event_id: event.id,
          p_resource_type: event.resource_type,
          p_action: event.action,
          p_payload: JSON.parse(JSON.stringify(event)),
        }
      )
      if (insertError) throw new Error(insertError.message)
      if (!inserted) {
        // Already seen. A redelivery must not reprocess, and must not be
        // treated as an error either.
        continue
      }
      recordedId = inserted

      if (event.resource_type === "payments" && event.links?.payment) {
        await handlePaymentEvent(supabase, event.links.payment, event.details?.reason_code)
      } else if (event.resource_type === "billing_requests" && event.links?.billing_request) {
        await handleBillingRequestEvent(supabase, event.links.billing_request)
      } else if (event.resource_type === "mandates" && event.links?.mandate) {
        await handleMandateEvent(supabase, event.links.mandate)
      }

      await supabase.rpc("mark_platform_provider_event_processed", {
        p_event_id: recordedId,
        p_error: undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error."
      console.error(`[platform billing webhook] Failed to process event ${event.id}:`, message)

      // Record why, against this event's own row, so a genuinely-attempted
      // failure is distinguishable from one never reached.
      if (recordedId) {
        try {
          await supabase.rpc("mark_platform_provider_event_processed", {
            p_event_id: recordedId,
            p_error: message,
          })
        } catch {
          // Never let a failure to record a failure fail the batch.
        }
      }
      // GoCardless retries the whole delivery on a non-2xx, so one bad
      // event must not force every good one to be replayed.
    }
  }

  return NextResponse.json({ ok: true })
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>

/**
 * The event names a payment; the payment's real state comes from
 * re-fetching it. A webhook body is a notification, never a snapshot.
 */
async function handlePaymentEvent(
  supabase: ServiceClient,
  providerPaymentId: string,
  reasonCode: string | undefined
): Promise<void> {
  const { data: row } = await supabase
    .from("platform_payments")
    .select("id")
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle()

  if (!row) return // Not one of ours. Domain A's payments are not visible here.

  const remote = await fetchPlatformPayment(providerPaymentId)
  const status = mapPlatformPaymentStatus(remote.status)
  if (!status) return // A status this system does not model. Leave it alone.

  await supabase.rpc("apply_platform_payment_status", {
    p_payment_id: row.id,
    p_status: status,
    p_provider_payment_id: providerPaymentId,
    p_failure_reason: status === "failed" ? (reasonCode ?? remote.status) : undefined,
  })
}

/**
 * A billing request reaching `fulfilled` is what gives Ovalball a mandate
 * to collect against. Anything earlier reconciles to no change.
 */
async function handleBillingRequestEvent(
  supabase: ServiceClient,
  providerBillingRequestId: string
): Promise<void> {
  const { data: subscription } = await supabase
    .from("platform_club_subscriptions")
    .select("club_id")
    .eq("provider_billing_request_id", providerBillingRequestId)
    .maybeSingle()

  if (!subscription) return

  const remote = await fetchPlatformBillingRequest(providerBillingRequestId)
  const mandateId = remote.links?.mandate_request_mandate
  if (!mandateId) return

  const mandate = await fetchPlatformMandate(mandateId)

  await supabase.rpc("attach_platform_subscription_provider", {
    p_club_id: subscription.club_id,
    p_environment: getGoCardlessEnvironment(),
    p_customer_id: remote.links?.customer,
    p_mandate_id: mandateId,
    p_mandate_status: mandate.status,
  })
}

/** A mandate we already hold changing state — cancelled, failed, expired. */
async function handleMandateEvent(supabase: ServiceClient, providerMandateId: string): Promise<void> {
  const { data: subscription } = await supabase
    .from("platform_club_subscriptions")
    .select("club_id")
    .eq("provider_mandate_id", providerMandateId)
    .maybeSingle()

  if (!subscription) return

  const mandate = await fetchPlatformMandate(providerMandateId)

  await supabase.rpc("attach_platform_subscription_provider", {
    p_club_id: subscription.club_id,
    p_environment: getGoCardlessEnvironment(),
    p_mandate_id: providerMandateId,
    p_mandate_status: mandate.status,
  })
}
