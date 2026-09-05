/**
 * First-month proration. Deterministic calendar-day proration in integer
 * minor currency units (pence) -- never floating-point money.
 *
 * Rounding rule (the one explicit rule this domain uses, matched exactly
 * in the mirrored SQL implementation, internal.calculate_first_month_proration):
 *
 *   prorated_minor = round(monthly_amount_minor * chargeable_days / total_days_in_month)
 *
 * "round" is round-half-away-from-zero on a positive value (JS `Math.round`
 * and Postgres `round()` agree for every positive input this domain ever
 * produces -- money is never negative here). chargeable_days is inclusive
 * of the membership start date through the end of that calendar month.
 *
 * If membership starts on the 1st, this is a normal full-month
 * obligation, not a "100%-prorated" charge -- callers should not invoke
 * this function at all in that case; see isFirstMonthProrated below.
 */

export function daysInMonth(year: number, month1to12: number): number {
  // Day 0 of the next month is the last day of this month.
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
}

export function isFirstMonthProrated(membershipStartDate: string): boolean {
  const day = Number(membershipStartDate.slice(8, 10))
  return day > 1
}

export interface ProrationResult {
  chargeableDays: number
  totalDaysInMonth: number
  proratedAmountMinor: number
  billingPeriod: string // YYYY-MM-01, the calendar month the proration covers
}

/**
 * membershipStartDate: 'YYYY-MM-DD', the date the player becomes liable
 * for membership (never moved just because Direct Debit can't collect
 * immediately -- this is the MEMBERSHIP EFFECTIVE DATE, kept distinct
 * from provider collection timing).
 * monthlyAmountMinor: the full normal monthly amount, in minor units.
 */
export function calculateFirstMonthProration(membershipStartDate: string, monthlyAmountMinor: number): ProrationResult {
  const year = Number(membershipStartDate.slice(0, 4))
  const month = Number(membershipStartDate.slice(5, 7))
  const day = Number(membershipStartDate.slice(8, 10))

  const totalDaysInMonth = daysInMonth(year, month)
  const chargeableDays = totalDaysInMonth - day + 1
  const proratedAmountMinor = Math.round((monthlyAmountMinor * chargeableDays) / totalDaysInMonth)

  return {
    chargeableDays,
    totalDaysInMonth,
    proratedAmountMinor,
    billingPeriod: `${membershipStartDate.slice(0, 7)}-01`,
  }
}

/** The next full-month billing period after a (possibly prorated) first month -- always the 1st of the following calendar month. */
export function nextFullBillingPeriod(membershipStartDate: string): string {
  const year = Number(membershipStartDate.slice(0, 4))
  const month = Number(membershipStartDate.slice(5, 7))
  const next = new Date(Date.UTC(year, month, 1)) // month is already 1-indexed input -> UTC Date month arg is 0-indexed, so `month` here IS "next month" in 0-indexed terms
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`
}
