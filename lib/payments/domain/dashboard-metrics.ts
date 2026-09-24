/**
 * Moved to `packages/contracts/src/club/finance.ts` so React Native can reach it (CA-M11.1), and
 * re-exported here so nothing on the web changed its import. Every dashboard metric has an explicit
 * formula there -- never a card whose number is invented ad hoc in a component -- and OVERDUE is derived
 * locally from the canonical rows, never webhook-asserted, on both clients by the same rule.
 */
export { computeDashboardMetrics, isObligationOverdue, type DashboardMetrics, type ObligationForMetrics } from "@ovalball/contracts/club/finance"
