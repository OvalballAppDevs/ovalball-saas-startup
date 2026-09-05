/**
 * Every dashboard metric has an explicit formula here -- never a card
 * whose number is invented ad hoc in a component. All inputs are the
 * canonical membership_obligations rows for one club + billing_period
 * (never raw GoCardless payment rows alone -- a payment's existence is
 * evidence, the obligation is truth).
 */

export interface ObligationForMetrics {
  amountDueMinor: number
  status: string
}

export interface DashboardMetrics {
  /** Sum of amount_due_minor across every obligation for the period, regardless of status. What members are expected to owe this month. */
  expectedRevenueMinor: number
  /** Sum of amount_due_minor where status = PAID. Confirmed by GoCardless, not merely submitted. */
  collectedMinor: number
  /** expectedRevenueMinor - collectedMinor - exemptWaivedMinor. What is still owed and not excused. */
  outstandingMinor: number
  /** Sum where status in (EXEMPT, WAIVED) -- excluded from both collected and outstanding, shown separately. */
  exemptWaivedMinor: number
  /** count(FAILED) / count(SUBMITTED | PAID | FAILED) -- payments GoCardless actually attempted, excluding ones never yet submitted. Undefined (null) when the denominator is 0. */
  successRatePercent: number | null
  activeDirectDebits: number
  countByStatus: Record<string, number>
}

const SETTLED_ATTEMPT_STATUSES = new Set(["SUBMITTED", "PAID", "FAILED", "RETRYING", "OVERDUE"])

export function computeDashboardMetrics(obligations: ObligationForMetrics[], activeDirectDebits: number): DashboardMetrics {
  let expectedRevenueMinor = 0
  let collectedMinor = 0
  let exemptWaivedMinor = 0
  const countByStatus: Record<string, number> = {}
  let attempted = 0
  let failed = 0

  for (const o of obligations) {
    expectedRevenueMinor += o.amountDueMinor
    countByStatus[o.status] = (countByStatus[o.status] ?? 0) + 1

    if (o.status === "PAID") collectedMinor += o.amountDueMinor
    if (o.status === "EXEMPT" || o.status === "WAIVED") exemptWaivedMinor += o.amountDueMinor
    if (SETTLED_ATTEMPT_STATUSES.has(o.status)) {
      attempted += 1
      if (o.status === "FAILED" || o.status === "OVERDUE") failed += 1
    }
  }

  const outstandingMinor = Math.max(0, expectedRevenueMinor - collectedMinor - exemptWaivedMinor)
  const successRatePercent = attempted > 0 ? Math.round(((attempted - failed) / attempted) * 1000) / 10 : null

  return { expectedRevenueMinor, collectedMinor, outstandingMinor, exemptWaivedMinor, successRatePercent, activeDirectDebits, countByStatus }
}

/** OVERDUE is never a webhook-asserted status -- it is derived locally when a SUBMITTED/SCHEDULED obligation's due_date has passed a processing window without settling. */
export function isObligationOverdue(status: string, dueDate: string, processingWindowDays: number = 5): boolean {
  if (!["SETUP_PENDING", "READY", "SCHEDULED", "SUBMITTED"].includes(status)) return false
  const due = new Date(dueDate)
  const cutoff = new Date(due.getTime() + processingWindowDays * 24 * 60 * 60 * 1000)
  return new Date() > cutoff
}
