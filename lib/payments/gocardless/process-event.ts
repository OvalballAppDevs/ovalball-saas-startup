import type { SupabaseClient } from "@supabase/supabase-js"

import { fetchAllPayoutItems, fetchGoCardlessPayout, payoutClub, reconcileGoCardlessRefund, recordGoCardlessPayout } from "./payouts"
import { discoverGoCardlessSubscriptionPayment, reconcileGoCardlessBillingRequest, reconcileGoCardlessPayment, reconcileGoCardlessSubscription } from "./reconcile"
import { syncGoCardlessVerificationStatus } from "./verification"
import type { GoCardlessWebhookPayload } from "./webhooks"
import type { GoCardlessEnvironment } from "./env"
import type { Database } from "@/types/database.types"

export type GoCardlessEvent = GoCardlessWebhookPayload["events"][number]

/**
 * THE EVENT HAS TO WAIT (20270749000000, gap G7). Its club has no live connection to the GoCardless account the
 * event belongs to -- disconnected, or connected to a different account -- so nothing can be re-fetched and the
 * event cannot have its effect yet. It used to be consumed as if it had: a collection, failure or cancellation
 * made while a club was disconnected never reached the ledger, even after it reconnected. The caller records the
 * event as DEFERRED (defer_gocardless_event) and the replay takes it again once the club has a live connection to
 * that account. Not a failure: it spends none of the event's attempt budget and is not retried before then.
 */
export class GoCardlessEventDeferred extends Error {
  // Declared fields rather than constructor parameter properties, so Node's own TypeScript stripping (the test
  // runner) loads this file unchanged.
  readonly clubId: string
  readonly reason: string
  constructor(clubId: string, reason: string) {
    super(reason)
    this.name = "GoCardlessEventDeferred"
    this.clubId = clubId
    this.reason = reason
  }
}

/** A read that failed is a failure of this event (retried), never "nothing to do" (skipped for good). */
async function read<R extends { data: unknown; error: { message: string } | null }>(query: PromiseLike<R>): Promise<R["data"]> {
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}

interface LiveConnection {
  environment: GoCardlessEnvironment
  accessToken: string
}

/**
 * The club's live connection, when it can act for this event: connected, holding a token, and -- where the event
 * names its GoCardless organisation, as every partner event does -- connected to THAT account. Anything else
 * defers the event rather than consuming it.
 */
async function liveConnectionFor(supabase: SupabaseClient<Database>, clubId: string, event: GoCardlessEvent): Promise<LiveConnection> {
  const connection = await read(supabase
    .from("gocardless_merchant_connections")
    .select("environment, access_token, gc_organisation_id")
    .eq("club_id", clubId)
    .is("disconnected_at", null)
    .maybeSingle())
  if (!connection?.access_token) {
    throw new GoCardlessEventDeferred(clubId, "The club is not connected to GoCardless. This event waits until it reconnects.")
  }
  const organisation = event.links?.organisation
  if (organisation && connection.gc_organisation_id !== organisation) {
    throw new GoCardlessEventDeferred(clubId, "The club is now connected to a different GoCardless account. This event waits until it reconnects the account it belongs to.")
  }
  return { environment: connection.environment as GoCardlessEnvironment, accessToken: connection.access_token }
}

/**
 * WHAT ONE GOCARDLESS EVENT DOES -- the one implementation, used by the webhook and by the replay of events
 * GoCardless has stopped redelivering, so a replayed event is processed exactly as it would have been.
 *
 * Every event is a link and a verb, never the resource itself: each branch resolves the club from Ovalball's
 * own rows, re-fetches the real resource with that club's connection, and reconciles it through the canonical
 * functions. It THROWS on anything that went wrong, so the caller records the failure and the event is
 * processed again; it throws GoCardlessEventDeferred when the club cannot act for the event yet (no live
 * connection to its account), so the caller defers it; it returns normally only when the event has had its
 * effect, or genuinely has none to have (a resource that is not Ovalball's).
 */
export async function processGoCardlessEvent(supabase: SupabaseClient<Database>, event: GoCardlessEvent): Promise<void> {
  const gcEventId = event.id ?? undefined

  if (event.resource_type === "payments" && event.links?.payment) {
    // The re-fetched Payment resource is the only status written. There is no fallback to a status guessed
    // from the event's action: when the re-fetch fails, this event fails and is retried, so a stale or
    // guessed status can never overwrite a newer one (20270744000000).
    const gcPaymentId = event.links.payment
    const paymentRow = await read(supabase.from("gocardless_payments").select("club_id").eq("gc_payment_id", gcPaymentId).maybeSingle())
    if (paymentRow) {
      const connection = await liveConnectionFor(supabase, paymentRow.club_id, event)
      await reconcileGoCardlessPayment({
        environment: connection.environment,
        accessToken: connection.accessToken,
        gcPaymentId,
        failureReasonCode: event.details?.reason_code ?? undefined,
        gcEventId,
      })
    } else if (event.links.subscription) {
      // Unknown-Payment discovery -- a Payment GoCardless generated directly from a Subscription (a recurring
      // collection, never created by activateMembership()) has no local gocardless_payments row yet. The
      // event's own links.subscription is used ONLY to resolve which club's connection to re-fetch with --
      // routing information, never trusted as the payment's actual amount/status/currency, which
      // discoverGoCardlessSubscriptionPayment re-fetches from the real resource before recording anything.
      const subscriptionHint = await read(supabase.from("gocardless_subscriptions").select("club_id").eq("gc_subscription_id", event.links.subscription).maybeSingle())
      if (subscriptionHint) {
        const connection = await liveConnectionFor(supabase, subscriptionHint.club_id, event)
        await discoverGoCardlessSubscriptionPayment({
          environment: connection.environment,
          accessToken: connection.accessToken,
          gcPaymentId,
          gcEventId,
        })
      }
    }
  } else if (event.resource_type === "billing_requests" && event.links?.billing_request) {
    // One uniform branch for EVERY billing_requests action (created, flow_created, flow_visited,
    // collect_customer_details, collect_bank_account, payer_details_confirmed, fulfilled, ...) rather than a
    // bespoke per-action branch -- the event body is never authoritative (it's a link+metadata notification),
    // so every action just triggers the same canonical re-fetch-and-reconcile. Early lifecycle events reconcile
    // to a non-"fulfilled" status (a harmless, accurate no-op); "fulfilled" is what actually populates
    // gocardless_customers/gocardless_mandates.
    const billingRequestRow = await read(supabase.from("gocardless_billing_requests").select("id, club_id, gc_billing_request_id").eq("gc_billing_request_id", event.links.billing_request).maybeSingle())
    if (billingRequestRow) {
      const connection = await liveConnectionFor(supabase, billingRequestRow.club_id, event)
      await reconcileGoCardlessBillingRequest({
        environment: connection.environment,
        accessToken: connection.accessToken,
        billingRequestLocalId: billingRequestRow.id,
        gcBillingRequestId: billingRequestRow.gc_billing_request_id,
      })
    }
  } else if (event.resource_type === "mandates" && event.links?.mandate) {
    // Only reconcile a mandate event if we already have a local mandate row to update -- the event payload
    // carries no link back to the originating billing request, so a first-time mandate (no local row yet) is
    // deliberately left to billing_requests reconciliation above rather than inventing an orphan row here.
    const existingMandate = await read(supabase.from("gocardless_mandates").select("billing_request_id").eq("gc_mandate_id", event.links.mandate).maybeSingle())
    if (existingMandate?.billing_request_id) {
      const billingRequestRow = await read(supabase.from("gocardless_billing_requests").select("id, club_id, gc_billing_request_id").eq("id", existingMandate.billing_request_id).maybeSingle())
      if (billingRequestRow) {
        const connection = await liveConnectionFor(supabase, billingRequestRow.club_id, event)
        await reconcileGoCardlessBillingRequest({
          environment: connection.environment,
          accessToken: connection.accessToken,
          billingRequestLocalId: billingRequestRow.id,
          gcBillingRequestId: billingRequestRow.gc_billing_request_id,
        })
      }
    }
  } else if (event.resource_type === "subscriptions" && event.links?.subscription) {
    // One uniform branch for EVERY subscriptions action, exactly matching the billing_requests branch's design
    // -- GoCardless's real `action` field is a short unprefixed verb ("created"), not a resource-prefixed name.
    // Rather than invent an unverified action->meaning table, every action just triggers the same canonical
    // re-fetch-and-reconcile of the real Subscription resource (see reconcile.ts).
    const subscriptionRow = await read(supabase.from("gocardless_subscriptions").select("id, club_id, gc_subscription_id").eq("gc_subscription_id", event.links.subscription).maybeSingle())
    if (subscriptionRow?.gc_subscription_id) {
      const connection = await liveConnectionFor(supabase, subscriptionRow.club_id, event)
      await reconcileGoCardlessSubscription({
        environment: connection.environment,
        accessToken: connection.accessToken,
        localSubscriptionId: subscriptionRow.id,
        gcSubscriptionId: subscriptionRow.gc_subscription_id,
        gcEventId,
      })
    }
  } else if (event.resource_type === "refunds" && event.links?.refund) {
    // EVERY refund action (created, paid, refund_settled, failed, funds_returned...) re-reads the refund itself and
    // records it against Ovalball's payment (20270754000000, audit G14): a refund made at GoCardless is no longer
    // invisible, and only a refund GoCardless has paid is ever counted as given back. The club is resolved from
    // Ovalball's own payment row where the event names one, else from the account the event belongs to.
    let clubId: string | null = null
    if (event.links.payment) {
      const paymentRow = await read(supabase.from("gocardless_payments").select("club_id").eq("gc_payment_id", event.links.payment).maybeSingle())
      clubId = paymentRow?.club_id ?? null
      if (!clubId) return // not a payment Ovalball collected
    } else if (event.links.organisation) {
      const connections = await read(supabase.from("gocardless_merchant_connections").select("club_id").eq("gc_organisation_id", event.links.organisation).is("disconnected_at", null))
      clubId = connections?.[0]?.club_id ?? null
      if (!clubId) return
    } else {
      return
    }
    const connection = await liveConnectionFor(supabase, clubId, event)
    await reconcileGoCardlessRefund({ supabase, connection, gcRefundId: event.links.refund })
  } else if (event.resource_type === "payouts" && event.links?.payout) {
    // A PAYOUT REACHED THE CLUB'S BANK (paid, paid_again, ...): read it and EVERY item in it from GoCardless and keep
    // them (20270754000000) -- GoCardless serves payout items for six months only. The payout is the club's whose
    // account it is; where more than one club holds that account, the club whose payments are in it.
    const known = await read(supabase.from("gocardless_payouts").select("club_id").eq("gc_payout_id", event.links.payout).maybeSingle())
    let candidates: string[] = known ? [known.club_id] : []
    if (candidates.length === 0 && event.links.organisation) {
      const connections = await read(supabase.from("gocardless_merchant_connections").select("club_id").eq("gc_organisation_id", event.links.organisation).is("disconnected_at", null))
      candidates = (connections ?? []).map((c) => c.club_id)
      if (candidates.length === 0) {
        const held = await read(supabase.from("gocardless_merchant_connections").select("club_id, connected_at").eq("gc_organisation_id", event.links.organisation))
        const lastHeld = [...(held ?? [])].sort((a, b) => b.connected_at.localeCompare(a.connected_at))[0]
        if (lastHeld) throw new GoCardlessEventDeferred(lastHeld.club_id, "The club is not connected to GoCardless. This event waits until it reconnects.")
        return // an account Ovalball never held
      }
    }
    if (candidates.length === 0) return
    const connection = await liveConnectionFor(supabase, candidates[0], event)
    const payout = await fetchGoCardlessPayout(connection, event.links.payout)
    // Partner payouts are Ovalball's own app-fee income, not the club's money.
    if (payout.payout_type === "partner") return
    const items = await fetchAllPayoutItems(connection, event.links.payout)
    const clubId = await payoutClub(supabase, candidates, items)
    if (!clubId) return
    await recordGoCardlessPayout(supabase, clubId, payout, items)
  } else if (event.resource_type === "creditors" && event.action === "creditor_updated" && event.links?.organisation) {
    // Only the documented creditor_updated action is handled -- GoCardless's webhook payload never includes the
    // new verification_status value itself (every event is a link+metadata notification, not a resource
    // snapshot), so this re-fetches the creditor via the same canonical sync used by the OAuth callback rather
    // than trusting anything in the event body. Looked up by gc_organisation_id, the only creditor-linking field
    // this table stores. More than one club can hold one organisation, so every live one is brought up to date;
    // an organisation Ovalball once held but no club is connected to now waits (deferred) for a reconnect; one
    // Ovalball never held is not ours.
    const organisation = event.links.organisation
    const connections = await read(supabase.from("gocardless_merchant_connections").select("club_id, environment, access_token, disconnected_at, connected_at").eq("gc_organisation_id", organisation))
    const live = (connections ?? []).filter((c) => c.disconnected_at === null && c.access_token)
    if (live.length === 0) {
      const lastHeld = [...(connections ?? [])].sort((a, b) => b.connected_at.localeCompare(a.connected_at))[0]
      if (lastHeld) {
        throw new GoCardlessEventDeferred(lastHeld.club_id, "The club is not connected to GoCardless. This event waits until it reconnects.")
      }
      return
    }
    for (const connection of live) {
      await syncGoCardlessVerificationStatus({
        clubId: connection.club_id,
        environment: connection.environment as GoCardlessEnvironment,
        accessToken: connection.access_token as string,
      })
    }
  } else if (event.resource_type === "organisations" && event.action === "disconnected" && event.links?.organisation) {
    // The club removed Ovalball from its own GoCardless account. Its token is already dead at GoCardless, so the
    // connection is ended here, the token dropped, and the fact recorded (20270744000000) -- but only a
    // connection made before GoCardless recorded the disconnection: a late delivery or replay of an old event
    // never ends the newer connection a club made since (20270749000000, G13).
    const { error } = await supabase.rpc("record_gocardless_app_disconnected", {
      p_gc_organisation_id: event.links.organisation,
      p_disconnected_at: event.created_at ?? undefined,
    })
    if (error) throw new Error(error.message)
  }
}
