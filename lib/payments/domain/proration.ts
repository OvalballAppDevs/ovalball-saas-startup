/**
 * Moved to `packages/contracts/src/club/finance.ts` so React Native can reach it (CA-M11.1), and
 * re-exported here so nothing on the web changed its import. Deterministic calendar-day proration in
 * integer minor units, round-half-away-from-zero, matched exactly by
 * internal.calculate_first_month_proration.
 */
export { calculateFirstMonthProration, daysInMonth, isFirstMonthProrated, nextFullBillingPeriod, type ProrationResult } from "@ovalball/contracts/club/finance"
