import { gcRequest } from "./client"
import type { GoCardlessEnvironment } from "./env"

/**
 * GoCardless's own documented retry mechanism -- calling this on a
 * payment GoCardless does not consider retry-eligible fails at their end
 * (never blindly retried client-side; the local "retry eligible" flag
 * application code shows is informational, this call is the actual
 * authority).
 */
export async function retryGoCardlessPayment(params: { environment: GoCardlessEnvironment; accessToken: string; gcPaymentId: string }): Promise<void> {
  await gcRequest({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "POST",
    path: `/payments/${params.gcPaymentId}/actions/retry`,
    idempotencyKey: `retry-${params.gcPaymentId}`,
  })
}

/**
 * PRORATE_CURRENT_MONTH's first-month charge is a standalone one-off
 * Payment against the mandate directly, NOT the first charge of a
 * Subscription (GoCardless subscriptions are fixed-amount for their whole
 * life -- there is no way to give the first charge a different amount
 * than every later one). A Payment can be created with just `amount`,
 * `currency`, and `links.mandate`, independent of any subscription. The
 * recurring Subscription for the full monthly amount is created
 * separately (createGoCardlessSubscription with `startDate` set to the
 * next 1st).
 *
 * `idempotencyKey` must be stable per obligation (e.g. derived from the
 * membership_obligations.id) so a retried request -- double-click,
 * browser refresh, network timeout, webhook-triggered retry -- can never
 * create two payments for the same prorated obligation.
 */
export async function createOneOffGoCardlessPayment(params: {
  environment: GoCardlessEnvironment
  accessToken: string
  mandateId: string
  amountMinor: number
  currency: string
  description: string
  idempotencyKey: string
}): Promise<{ paymentId: string }> {
  const response = await gcRequest<{ payments: { id: string } }>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "POST",
    path: "/payments",
    idempotencyKey: params.idempotencyKey,
    body: {
      payments: {
        amount: params.amountMinor,
        currency: params.currency,
        description: params.description,
        links: { mandate: params.mandateId },
      },
    },
  })
  return { paymentId: response.payments.id }
}

export async function createGoCardlessRefund(params: { environment: GoCardlessEnvironment; accessToken: string; gcPaymentId: string; amountMinor: number; idempotencyKey: string }): Promise<{ refundId: string }> {
  const response = await gcRequest<{ refunds: { id: string } }>({
    environment: params.environment,
    accessToken: params.accessToken,
    method: "POST",
    path: "/refunds",
    idempotencyKey: params.idempotencyKey,
    body: { refunds: { amount: params.amountMinor, total_amount_confirmation: params.amountMinor, links: { payment: params.gcPaymentId } } },
  })
  return { refundId: response.refunds.id }
}
