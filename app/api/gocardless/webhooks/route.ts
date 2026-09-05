import { NextResponse, type NextRequest } from "next/server"

import { mapPaymentActionToGoCardlessStatus } from "@/lib/payments/gocardless/mapper"
import { getGoCardlessWebhookSecret } from "@/lib/payments/gocardless/env"
import { discoverGoCardlessSubscriptionPayment, reconcileGoCardlessBillingRequest, reconcileGoCardlessPayment, reconcileGoCardlessSubscription } from "@/lib/payments/gocardless/reconcile"
import { syncGoCardlessVerificationStatus } from "@/lib/payments/gocardless/verification"
import { verifyGoCardlessWebhookSignature, type GoCardlessWebhookPayload } from "@/lib/payments/gocardless/webhooks"
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
 * update_gocardless_verification_status) are themselves un-granted to
 * `authenticated`/`anon`, reachable only via this server-only route.
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
    return NextResponse.json({ error: "Webhook endpoint not configured." }, { status: 503 })
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
    // Hoisted above the try so the catch block below can mark THIS
    // event's row with the real failure reason -- previously a version
    // of this route only logged to console, leaving processing_error
    // permanently NULL even when reconciliation genuinely failed,
    // indistinguishable from "never attempted."
    let insertedEventId: string | null = null
    try {
      // club_id is resolved defensively below, per resource type --
      // webhook events don't carry it directly; each branch resolves it
      // via the linked mandate/customer/subscription/billing-request's
      // own club_id lookup before acting.
      const { data: insertResult, error: insertError } = await supabase.rpc("record_gocardless_event", {
        p_gc_event_id: event.id,
        p_resource_type: event.resource_type,
        p_action: event.action,
        p_payload: JSON.parse(JSON.stringify(event)),
      })
      if (insertError) throw new Error(insertError.message)
      if (!insertResult) {
        // Already recorded -- duplicate delivery, safe no-op.
        continue
      }
      insertedEventId = insertResult

      if (event.resource_type === "payments" && event.links?.payment) {
        // The action-derived status (mapPaymentActionToGoCardlessStatus)
        // is still computed and passed through as a fallback for when the
        // live re-fetch itself fails, but the real re-fetched Payment
        // resource status is authoritative when available.
        const actionDerivedStatus = mapPaymentActionToGoCardlessStatus(event.action)
        const gcPaymentId = event.links.payment
        const { data: paymentRow } = await supabase.from("gocardless_payments").select("club_id").eq("gc_payment_id", gcPaymentId).maybeSingle()
        if (paymentRow) {
          const { data: connection } = await supabase.from("gocardless_merchant_connections").select("environment, access_token").eq("club_id", paymentRow.club_id).is("disconnected_at", null).maybeSingle()
          if (connection) {
            await reconcileGoCardlessPayment({
              environment: connection.environment as "sandbox" | "production",
              accessToken: connection.access_token,
              gcPaymentId,
              actionDerivedStatus,
              failureReasonCode: event.details?.reason_code ?? undefined,
              gcEventId: event.id,
            })
          }
        } else if (event.links.subscription) {
          // Unknown-Payment discovery -- a Payment GoCardless generated
          // directly from a Subscription (a recurring collection, never
          // created by activateMembership()) has no local
          // gocardless_payments row yet. The event's own
          // links.subscription is used ONLY to resolve which club's
          // connection to re-fetch with -- routing information, never
          // trusted as the payment's actual amount/status/currency, which
          // discoverGoCardlessSubscriptionPayment re-fetches from the real
          // resource before recording anything.
          const { data: subscriptionHint } = await supabase.from("gocardless_subscriptions").select("club_id").eq("gc_subscription_id", event.links.subscription).maybeSingle()
          if (subscriptionHint) {
            const { data: connection } = await supabase
              .from("gocardless_merchant_connections")
              .select("environment, access_token")
              .eq("club_id", subscriptionHint.club_id)
              .is("disconnected_at", null)
              .maybeSingle()
            if (connection) {
              await discoverGoCardlessSubscriptionPayment({
                environment: connection.environment as "sandbox" | "production",
                accessToken: connection.access_token,
                gcPaymentId,
              })
            }
          }
        }
      } else if (event.resource_type === "billing_requests" && event.links?.billing_request) {
        // One uniform branch for EVERY billing_requests action (created,
        // flow_created, flow_visited, collect_customer_details,
        // collect_bank_account, payer_details_confirmed, fulfilled, ...)
        // rather than a bespoke per-action branch -- the event body is
        // never authoritative (it's a link+metadata notification), so
        // every action just triggers the same canonical re-fetch-and-
        // reconcile. Early lifecycle events reconcile to a non-"fulfilled"
        // status (a harmless, accurate no-op); "fulfilled" is what
        // actually populates gocardless_customers/gocardless_mandates.
        const { data: billingRequestRow } = await supabase.from("gocardless_billing_requests").select("id, club_id, gc_billing_request_id").eq("gc_billing_request_id", event.links.billing_request).maybeSingle()
        if (billingRequestRow) {
          const { data: connection } = await supabase
            .from("gocardless_merchant_connections")
            .select("environment, access_token")
            .eq("club_id", billingRequestRow.club_id)
            .is("disconnected_at", null)
            .maybeSingle()
          if (connection) {
            await reconcileGoCardlessBillingRequest({
              environment: connection.environment as "sandbox" | "production",
              accessToken: connection.access_token,
              billingRequestLocalId: billingRequestRow.id,
              gcBillingRequestId: billingRequestRow.gc_billing_request_id,
            })
          }
        }
      } else if (event.resource_type === "mandates" && event.links?.mandate) {
        // Only reconcile a mandate event if we already have a local
        // mandate row to update -- the event payload carries no link back
        // to the originating billing request, so a first-time mandate (no
        // local row yet) is deliberately left to billing_requests
        // reconciliation above rather than inventing an orphan row here.
        const { data: existingMandate } = await supabase.from("gocardless_mandates").select("billing_request_id").eq("gc_mandate_id", event.links.mandate).maybeSingle()
        if (existingMandate?.billing_request_id) {
          const { data: billingRequestRow } = await supabase.from("gocardless_billing_requests").select("id, club_id, gc_billing_request_id").eq("id", existingMandate.billing_request_id).maybeSingle()
          if (billingRequestRow) {
            const { data: connection } = await supabase
              .from("gocardless_merchant_connections")
              .select("environment, access_token")
              .eq("club_id", billingRequestRow.club_id)
              .is("disconnected_at", null)
              .maybeSingle()
            if (connection) {
              await reconcileGoCardlessBillingRequest({
                environment: connection.environment as "sandbox" | "production",
                accessToken: connection.access_token,
                billingRequestLocalId: billingRequestRow.id,
                gcBillingRequestId: billingRequestRow.gc_billing_request_id,
              })
            }
          }
        }
      } else if (event.resource_type === "subscriptions" && event.links?.subscription) {
        // One uniform branch for EVERY subscriptions action, exactly
        // matching the billing_requests branch's design -- GoCardless's
        // real `action` field is a short unprefixed verb ("created"), not
        // a resource-prefixed name. Rather than invent an unverified
        // action->meaning table, every action just triggers the same
        // canonical re-fetch-and-reconcile of the real Subscription
        // resource (see reconcile.ts).
        const { data: subscriptionRow } = await supabase.from("gocardless_subscriptions").select("id, club_id, gc_subscription_id").eq("gc_subscription_id", event.links.subscription).maybeSingle()
        if (subscriptionRow) {
          const { data: connection } = await supabase
            .from("gocardless_merchant_connections")
            .select("environment, access_token")
            .eq("club_id", subscriptionRow.club_id)
            .is("disconnected_at", null)
            .maybeSingle()
          if (connection) {
            await reconcileGoCardlessSubscription({
              environment: connection.environment as "sandbox" | "production",
              accessToken: connection.access_token,
              localSubscriptionId: subscriptionRow.id,
              gcSubscriptionId: subscriptionRow.gc_subscription_id!,
              gcEventId: event.id,
            })
          }
        }
      } else if (event.resource_type === "refunds" && event.action === "created" && event.links?.payment) {
        // Refund confirmation -- amount is carried in event.details in
        // real GoCardless payloads under a different shape than modeled
        // here; a documented gap alongside the club_id resolution above.
      } else if (event.resource_type === "creditors" && event.action === "creditor_updated" && event.links?.organisation) {
        // Only the documented creditor_updated action is handled --
        // GoCardless's webhook payload never includes the new
        // verification_status value itself (every event is a
        // link+metadata notification, not a resource snapshot), so this
        // re-fetches the creditor via the same canonical sync used by the
        // OAuth callback rather than trusting anything in the event body.
        // Looked up by gc_organisation_id, the only creditor-linking field
        // this table stores; a club with no active connection for that
        // organisation is silently skipped (already disconnected, or not
        // ours).
        const { data: connection } = await supabase.from("gocardless_merchant_connections").select("club_id, environment, access_token").eq("gc_organisation_id", event.links.organisation).is("disconnected_at", null).maybeSingle()
        if (connection) {
          await syncGoCardlessVerificationStatus({
            clubId: connection.club_id,
            environment: connection.environment as "sandbox" | "production",
            accessToken: connection.access_token,
          })
        }
      }

      await supabase.rpc("mark_gocardless_event_processed", { p_event_id: insertedEventId, p_error: undefined })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error."
      console.error(`[gocardless webhook] Failed to process event ${event.id}:`, message)
      // Record the real failure reason against this event's own row
      // (processed=false, processing_error=message) -- distinguishes a
      // genuinely-attempted-but-failed reconciliation (e.g. a transient
      // provider re-fetch error, safely retryable) from an event that was
      // never reached at all (still processed=false, processing_error=NULL
      // from its INSERT default) or one that succeeded (processed=true).
      // Never marks success on a failure -- if this call itself fails, the
      // event simply keeps its insert-time default (unprocessed, no error
      // message), still safely retryable. insertedEventId is null only
      // when record_gocardless_event itself threw (e.g. a DB error) or the
      // event was already a duplicate (which `continue`s before ever
      // reaching here) -- nothing to mark.
      if (insertedEventId) {
        try {
          await supabase.rpc("mark_gocardless_event_processed", { p_event_id: insertedEventId, p_error: message })
        } catch {
          // Never let a failure to record the failure reason escalate
          // into failing the whole webhook batch.
        }
      }
      // Do not fail the whole batch for one bad event -- GoCardless
      // retries the WHOLE delivery on non-2xx, and partial success here is
      // already durably recorded via the events inbox.
    }
  }

  return NextResponse.json({ ok: true })
}
