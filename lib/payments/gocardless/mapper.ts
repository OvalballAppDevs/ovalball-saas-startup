/**
 * Deterministic provider-event -> domain-status mapping. This is the ONLY
 * place a GoCardless resource_type/action pair is translated into one of
 * membership_obligations' 13 domain statuses -- pages/components never
 * see a raw GoCardless event code directly.
 *
 * Each mapping below is a (resource_type, action) -> target obligation
 * status. `null` means "no obligation status transition for this event"
 * (e.g. a mandate-level event that doesn't resolve to any one billing
 * period). Where an event could plausibly mean more than one thing (e.g.
 * payments.action = "failed" vs "late_failure" vs "chargeback_settled"),
 * each is its own explicit entry -- never a catch-all default that risks
 * mapping an unrecognised action to PAID.
 *
 * GoCardless's own documentation notes events "may arrive before the
 * event they logically follow" (e.g. confirmed before created) -- this
 * mapper and the apply_payment_status_transition RPC are both written to
 * be safe under out-of-order delivery, never assuming a strict
 * created -> submitted -> confirmed sequence.
 */
export const PAYMENT_EVENT_TO_OBLIGATION_STATUS: Record<string, string | null> = {
  "payments.created": "SUBMITTED",
  "payments.submitted": "SUBMITTED",
  "payments.confirmed": "PAID",
  "payments.paid_out": "PAID",
  "payments.cancelled": "CANCELLED",
  "payments.customer_approval_granted": null,
  "payments.customer_approval_denied": "CANCELLED",
  "payments.failed": "FAILED",
  "payments.late_failure_settled": "FAILED",
  "payments.chargeback_settled": "CHARGEDBACK",
  "payments.charged_back": "CHARGEDBACK",
  "payments.resubmission_requested": "RETRYING",
}

/**
 * The ONE place a payments.<action> event is translated into the real
 * GoCardless Payment resource status (distinct from
 * PAYMENT_EVENT_TO_OBLIGATION_STATUS above, which maps to the local
 * obligation's own status vocabulary) -- apply_payment_status_transition
 * writes this value directly into gocardless_payments.status, which has
 * its own check constraint over GoCardless's real status enum, never the
 * raw webhook action string. `null` means "this action does not change
 * the payment's own status field" (e.g. customer_approval_granted,
 * resubmission_requested -- informational actions with no corresponding
 * status value).
 */
export const PAYMENT_ACTION_TO_GC_STATUS: Record<string, string | null> = {
  created: "pending_submission",
  submitted: "submitted",
  confirmed: "confirmed",
  paid_out: "paid_out",
  cancelled: "cancelled",
  customer_approval_granted: null,
  customer_approval_denied: "cancelled",
  failed: "failed",
  late_failure_settled: "failed",
  chargeback_settled: "charged_back",
  charged_back: "charged_back",
  resubmission_requested: null,
}

export function mapPaymentActionToGoCardlessStatus(action: string): string | null {
  return action in PAYMENT_ACTION_TO_GC_STATUS ? PAYMENT_ACTION_TO_GC_STATUS[action] : null
}

/**
 * A payment-resource GoCardless event never IMPLIES "overdue" -- OVERDUE
 * is a locally-computed state (an obligation whose due_date has passed
 * without a settling event), never something a webhook event itself
 * asserts. This mapper deliberately has no OVERDUE case for that reason.
 */
export function mapPaymentEventToObligationStatus(action: string): string | null {
  const key = `payments.${action}`
  return key in PAYMENT_EVENT_TO_OBLIGATION_STATUS ? PAYMENT_EVENT_TO_OBLIGATION_STATUS[key] : null
}
