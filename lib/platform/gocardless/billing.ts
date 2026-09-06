import "server-only"

import { gcRequest } from "@/lib/payments/gocardless/client"
import { getAppBaseUrl, getGoCardlessEnvironment } from "@/lib/payments/gocardless/env"

import { assertPlatformBillingPermitted, getPlatformGoCardlessAccessToken } from "./env"

/**
 * Ovalball collecting its own subscription from a club.
 *
 * The HTTP transport (`gcRequest`) and the production environment gate are
 * shared with the club-charges-its-members integration, because they are
 * mechanics with no business meaning: a signed request is a signed request.
 * Everything with meaning is separate — the merchant token, the webhook
 * endpoint, the tables written, and the switch that permits any of it.
 *
 * Every call here goes through `assertPlatformBillingPermitted()` first.
 */

/**
 * The page a club returns to after authorising its Direct Debit with
 * GoCardless. Their own club's billing page, not a generic landing.
 */
function platformBillingReturnUrl(clubSlug: string): string {
  return `${getAppBaseUrl()}/club/settings/ovalball-billing?club=${encodeURIComponent(clubSlug)}`
}

export interface PlatformMandateSetup {
  billingRequestId: string
  authorisationUrl: string
  environment: "sandbox" | "production"
}

/**
 * Starts the club's Direct Debit authorisation with Ovalball. Returns the
 * hosted GoCardless URL the Club Admin is sent to; Ovalball never sees or
 * stores the club's bank details.
 *
 * `idempotencyKey` must be stable for one setup attempt — derive it from
 * the subscription id — so a retried request after a network timeout
 * cannot leave a club with two half-finished authorisations.
 */
export async function startPlatformMandateSetup(params: {
  clubSlug: string
  idempotencyKey: string
  existingCustomerId?: string
}): Promise<PlatformMandateSetup> {
  assertPlatformBillingPermitted()

  const environment = getGoCardlessEnvironment()
  const accessToken = getPlatformGoCardlessAccessToken()
  const redirectUri = platformBillingReturnUrl(params.clubSlug)

  const billingRequest = await gcRequest<{ billing_requests: { id: string } }>({
    environment,
    accessToken,
    method: "POST",
    path: "/billing_requests",
    idempotencyKey: params.idempotencyKey,
    body: {
      billing_requests: {
        mandate_request: { scheme: "bacs" },
        // Tags the object on Ovalball's own merchant so a human reading the
        // GoCardless dashboard can tell platform billing from anything else.
        metadata: { ovalball_domain: "platform_billing" },
        ...(params.existingCustomerId ? { links: { customer: params.existingCustomerId } } : {}),
      },
    },
  })

  const flow = await gcRequest<{ billing_request_flows: { id: string; authorisation_url: string } }>({
    environment,
    accessToken,
    method: "POST",
    path: "/billing_request_flows",
    idempotencyKey: `${params.idempotencyKey}-flow`,
    body: {
      billing_request_flows: {
        redirect_uri: redirectUri,
        exit_uri: redirectUri,
        links: { billing_request: billingRequest.billing_requests.id },
      },
    },
  })

  return {
    billingRequestId: billingRequest.billing_requests.id,
    authorisationUrl: flow.billing_request_flows.authorisation_url,
    environment,
  }
}

export interface PlatformCollectionResult {
  providerPaymentId: string
}

/**
 * Creates one collection against a club's mandate.
 *
 * `idempotencyKey` is the billing cycle's own key — the same value stored
 * on the `platform_payments` row — so GoCardless itself refuses a second
 * collection for a cycle even if this code is somehow called twice.
 *
 * A zero-amount collection is refused outright rather than sent: a £0.00
 * Direct Debit is a real bank instruction. A cycle covered entirely by
 * credit is skipped in the database and never reaches here.
 */
export async function collectPlatformSubscriptionPayment(params: {
  mandateId: string
  amountPence: number
  currency: string
  chargeDate: string
  idempotencyKey: string
  description: string
}): Promise<PlatformCollectionResult> {
  assertPlatformBillingPermitted()

  if (params.amountPence <= 0) {
    throw new Error("Refusing to send a zero or negative collection to GoCardless.")
  }

  const payment = await gcRequest<{ payments: { id: string } }>({
    environment: getGoCardlessEnvironment(),
    accessToken: getPlatformGoCardlessAccessToken(),
    method: "POST",
    path: "/payments",
    idempotencyKey: params.idempotencyKey,
    body: {
      payments: {
        amount: params.amountPence,
        currency: params.currency,
        charge_date: params.chargeDate,
        description: params.description,
        metadata: { ovalball_domain: "platform_billing" },
        links: { mandate: params.mandateId },
      },
    },
  })

  return { providerPaymentId: payment.payments.id }
}

/**
 * Re-fetches a payment from GoCardless. The webhook body is a link and a
 * verb, never a resource snapshot, so nothing trusts it for an amount or a
 * status — the real resource is authoritative.
 */
export async function fetchPlatformPayment(providerPaymentId: string): Promise<{
  status: string
  amount: number
  currency: string
}> {
  assertPlatformBillingPermitted()

  const result = await gcRequest<{ payments: { status: string; amount: number; currency: string } }>({
    environment: getGoCardlessEnvironment(),
    accessToken: getPlatformGoCardlessAccessToken(),
    method: "GET",
    path: `/payments/${encodeURIComponent(providerPaymentId)}`,
  })

  return result.payments
}

export async function fetchPlatformBillingRequest(providerBillingRequestId: string): Promise<{
  status: string
  links?: { customer?: string; mandate_request_mandate?: string }
}> {
  assertPlatformBillingPermitted()

  const result = await gcRequest<{
    billing_requests: { status: string; links?: { customer?: string; mandate_request_mandate?: string } }
  }>({
    environment: getGoCardlessEnvironment(),
    accessToken: getPlatformGoCardlessAccessToken(),
    method: "GET",
    path: `/billing_requests/${encodeURIComponent(providerBillingRequestId)}`,
  })

  return result.billing_requests
}

export async function fetchPlatformMandate(providerMandateId: string): Promise<{ status: string }> {
  assertPlatformBillingPermitted()

  const result = await gcRequest<{ mandates: { status: string } }>({
    environment: getGoCardlessEnvironment(),
    accessToken: getPlatformGoCardlessAccessToken(),
    method: "GET",
    path: `/mandates/${encodeURIComponent(providerMandateId)}`,
  })

  return result.mandates
}

/**
 * GoCardless payment statuses, mapped to Ovalball's own. `paid_out` is a
 * settlement milestone after confirmation, so it maps to confirmed too
 * rather than inventing a state the rest of the system does not model.
 */
export function mapPlatformPaymentStatus(
  providerStatus: string
): "pending" | "submitted" | "confirmed" | "failed" | "cancelled" | null {
  switch (providerStatus) {
    case "pending_customer_approval":
    case "pending_submission":
      return "pending"
    case "submitted":
      return "submitted"
    case "confirmed":
    case "paid_out":
      return "confirmed"
    case "failed":
    case "charged_back":
      return "failed"
    case "cancelled":
    case "customer_approval_denied":
      return "cancelled"
    default:
      return null
  }
}
