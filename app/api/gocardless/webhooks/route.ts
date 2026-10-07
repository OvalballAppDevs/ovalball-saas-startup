import { NextResponse, type NextRequest } from "next/server"

import { getGoCardlessWebhookSecret } from "@/lib/payments/gocardless/env"
import { GoCardlessEventDeferred, processGoCardlessEvent } from "@/lib/payments/gocardless/process-event"
import { goCardlessEventKey, verifyGoCardlessWebhookSignature, type GoCardlessWebhookPayload } from "@/lib/payments/gocardless/webhooks"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export const dynamic = "force-dynamic"

/**
 * The canonical provider event input. GoCardless calls this with NO user
 * session at all -- authenticity comes entirely from the
 * Webhook-Signature check below, never from anything else in the
 * request. Every event is persisted to the gocardless_events inbox
 * BEFORE any state transition is attempted (idempotent on gc_event_id),
 * so a duplicate delivery is a safe no-op and a mid-processing crash
 * never loses the event itself.
 *
 * Uses the service-role client because there is no authenticated user
 * session to run this request under -- the RPCs it calls
 * (record_gocardless_event, apply_payment_status_transition,
 * update_gocardless_verification_status, defer_gocardless_event) are
 * themselves un-granted to `authenticated`/`anon`, reachable only via this
 * server-only route and the replay.
 *
 * A request refused before anything is recorded is LOGGED, as one line and
 * never with its body (20270749000000, G2): GoCardless does not retry a 498,
 * so a wrong production secret would otherwise lose every event in silence.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get("Webhook-Signature")

  let webhookSecret: string
  try {
    webhookSecret = getGoCardlessWebhookSecret()
  } catch {
    // Not configured in this environment (no real sandbox credentials in
    // this local .env.local). Reject rather than silently accepting an
    // unverifiable request.
    console.error("[gocardless webhook] Answered 503: the webhook secret is not configured here, so nothing was recorded.")
    return NextResponse.json({ error: "Webhook endpoint not configured." }, { status: 503 })
  }

  if (!verifyGoCardlessWebhookSignature(rawBody, signature, webhookSecret)) {
    // GoCardless documents 498 (Token Invalid) as the answer to a signature that does not verify, and does not
    // retry it. One line, with neither the body nor the signature.
    console.error(`[gocardless webhook] Answered 498: the signature did not verify (signature header ${signature ? "present" : "missing"}, ${Buffer.byteLength(rawBody, "utf8")} bytes). Nothing was recorded, and GoCardless will not retry this delivery.`)
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 498 })
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
  let failed = 0

  for (const event of payload.events) {
    // The inbox is CLAIMABLE (20270744000000): a new event, or one recorded before that is still unprocessed
    // and not held by another delivery, comes back with its id and is processed now; null means it is already
    // done, or being done right now -- the only cases where skipping is right. GoCardless's own "app
    // disconnected" event carries no id, so it is keyed by what it is about.
    const eventKey = goCardlessEventKey(event)
    let claimedEventId: string | null = null
    try {
      const { data: claimed, error: claimError } = await supabase.rpc("record_gocardless_event", {
        p_gc_event_id: eventKey,
        p_resource_type: event.resource_type,
        p_action: event.action,
        p_payload: JSON.parse(JSON.stringify(event)),
      })
      if (claimError) throw new Error(claimError.message)
      if (!claimed) continue
      claimedEventId = claimed

      await processGoCardlessEvent(supabase, event)

      const { error: markError } = await supabase.rpc("mark_gocardless_event_processed", { p_event_id: claimedEventId, p_error: undefined })
      if (markError) throw new Error(markError.message)
    } catch (error) {
      if (error instanceof GoCardlessEventDeferred && claimedEventId) {
        // THE CLUB CANNOT ACT FOR THIS EVENT YET (20270749000000, G7): it waits, deferred, and the replay takes it
        // once the club is connected to its GoCardless account again. Not a failure -- a redelivery could not
        // succeed either -- so it does not ask GoCardless for one.
        const { error: deferError } = await supabase.rpc("defer_gocardless_event", { p_event_id: claimedEventId, p_club_id: error.clubId, p_reason: error.reason })
        if (!deferError) continue
        error = new Error(`Could not defer the event: ${deferError.message}`)
      }
      failed += 1
      const message = error instanceof Error ? error.message : "Unknown error."
      console.error(`[gocardless webhook] Failed to process event ${eventKey}:`, message)
      // Recorded against the event with its reason, and released, so the redelivery below processes it again.
      if (claimedEventId) {
        try {
          await supabase.rpc("mark_gocardless_event_processed", { p_event_id: claimedEventId, p_error: message })
        } catch {
          // The claim lapses on its own within minutes, so the event is still retried.
        }
      }
    }
  }

  // ANY FAILURE ASKS FOR THE DELIVERY AGAIN. GoCardless retries a webhook only when it is not answered with a
  // 2xx (it used to be answered 200 whatever happened, so a failed event was stranded for good). The events
  // already processed are skipped on redelivery by their claim; only the failed ones run again.
  if (failed > 0) {
    return NextResponse.json({ ok: false, failed }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
