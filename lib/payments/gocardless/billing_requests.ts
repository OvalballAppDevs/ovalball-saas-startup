import { gcRequest } from "./client"
import type { GoCardlessEnvironment } from "./env"

/**
 * Creates a GoCardless Billing Request (with an inline mandate_request)
 * and its hosted Billing Request Flow, returning the `authorisation_url`
 * GoCardless generates -- the Parent is redirected there to authorize
 * their own Direct Debit mandate directly with GoCardless. Ovalball never
 * collects or stores raw bank account details itself.
 *
 * `idempotencyKey` should be a stable value derived from the payer
 * subscription id so a retried request (e.g. after a network timeout)
 * cannot create two billing requests for the same enrolment attempt.
 */
export async function createBillingRequestWithFlow(params: {
  environment: GoCardlessEnvironment
  accessToken: string
  idempotencyKey: string
  redirectUri: string
  gcCustomerId?: string
}): Promise<{ billingRequestId: string; flowId: string; authorisationUrl: string }> {
  const billingRequest = await gcRequest<{ billing_requests: { id: string } }>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "POST",
    path: "/billing_requests",
    idempotencyKey: params.idempotencyKey,
    body: {
      billing_requests: {
        mandate_request: { scheme: "bacs" },
        ...(params.gcCustomerId ? { links: { customer: params.gcCustomerId } } : {}),
      },
    },
  })

  const flow = await gcRequest<{ billing_request_flows: { id: string; authorisation_url: string } }>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "POST",
    path: "/billing_request_flows",
    idempotencyKey: `${params.idempotencyKey}-flow`,
    body: {
      billing_request_flows: {
        redirect_uri: params.redirectUri,
        exit_uri: params.redirectUri,
        links: { billing_request: billingRequest.billing_requests.id },
      },
    },
  })

  return {
    billingRequestId: billingRequest.billing_requests.id,
    flowId: flow.billing_request_flows.id,
    authorisationUrl: flow.billing_request_flows.authorisation_url,
  }
}

/**
 * Creates the recurring GoCardless Subscription against an ACTIVE
 * mandate -- called once the mandate is confirmed (via webhook), never at
 * billing-request time. `amount` is in minor units; GoCardless
 * subscriptions are fixed-amount for their whole life, so a price change
 * always means cancelling this and creating a new one, never a PATCH.
 *
 * `startDate` (optional, 'YYYY-MM-DD') delays the first charge to that
 * date or later, per GoCardless's own subscription API ("must be within a
 * year of the subscription being created, and on or after the mandate's
 * next_possible_charge_date"). Omit it to charge as soon as possible --
 * this is the mechanism the NEXT_COLLECTION_DAY policy (and
 * PRORATE_CURRENT_MONTH's follow-on recurring series, which always
 * starts on the *next* 1st regardless of policy) relies on, never an
 * app-side delay/cron.
 */
export async function createGoCardlessSubscription(params: {
  environment: GoCardlessEnvironment
  accessToken: string
  idempotencyKey: string
  mandateId: string
  amountMinor: number
  currency: string
  dayOfMonth: number
  name: string
  appFeeMinor?: number
  startDate?: string
}): Promise<{ subscriptionId: string; status: string; startDate: string | null }> {
  const response = await gcRequest<{ subscriptions: { id: string; status: string; start_date: string | null } }>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "POST",
    path: "/subscriptions",
    idempotencyKey: params.idempotencyKey,
    body: {
      subscriptions: {
        amount: params.amountMinor,
        currency: params.currency,
        interval_unit: "monthly",
        day_of_month: params.dayOfMonth,
        name: params.name,
        ...(params.appFeeMinor ? { app_fee: params.appFeeMinor } : {}),
        ...(params.startDate ? { start_date: params.startDate } : {}),
        links: { mandate: params.mandateId },
      },
    },
  })
  // Return the REAL provider-assigned status and (GoCardless-derived,
  // never locally guessed) start_date -- a caller hardcoding "pending"
  // here would silently drift from the real status GoCardless returns.
  return { subscriptionId: response.subscriptions.id, status: response.subscriptions.status, startDate: response.subscriptions.start_date }
}

export async function cancelGoCardlessSubscription(params: { environment: GoCardlessEnvironment; accessToken: string; subscriptionId: string }): Promise<void> {
  await gcRequest({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "POST",
    path: `/subscriptions/${params.subscriptionId}/actions/cancel`,
    idempotencyKey: `cancel-${params.subscriptionId}`,
  })
}
