import Link from "next/link"
import { billingPeriodLabel, currentBillingPeriod, formatMinorUnits, isBillingPeriod, loadFinanceDashboard } from "@ovalball/contracts/club/finance"

import { loadClubPayouts } from "@ovalball/contracts/membership/payouts"
import { PayoutsPanel } from "@/components/finance/payouts-panel"
import { monthName } from "@/components/membership/membership-board-parts"

import { AttentionPanel } from "../attention-panel"
import { ExportButton } from "../export-button"
import { GenerateObligationsButton } from "../generate-obligations-button"
import { loadMembershipsBoard, requireMembershipsAccess } from "../memberships-access"
import { MembershipsLoadProblem, MembershipsShell } from "../memberships-shell"
import { MonthSelector } from "../month-selector"
import { RelationshipReviewPanel } from "../relationship-review-panel"
import { SubscriberTable } from "../subscriber-table"

export const metadata = { title: "Payments | Memberships" }

/**
 * PAYMENTS -- THE MONTH'S LEDGER (Club Memberships Part 2; moved here from the old Finance Dashboard, unchanged in
 * what it does).
 *
 * Any month (`?month=YYYY-MM-01`): its metric cards, what needs attention, the memberships needing review, and every
 * membership's payment for the month with Waive (with a reason) and Retry; Generate the month's obligations and Export
 * CSV. It reads the website's own ledger contract (`loadFinanceDashboard`), whose metrics are the canonical formulas,
 * and it carries no provider id to the browser.
 *
 * For the month the club's board covers, Expected, Collected, Outstanding, Waived and who needs action are on the
 * Overview by the canonical definitions, so the ledger does not show a second set of those sums -- exactly as the old
 * dashboard did beside its overview.
 */
export default async function MembershipPaymentsPage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const params = await searchParams
  const access = await requireMembershipsAccess()
  const board = await loadMembershipsBoard()
  const { can, clubId, supabase } = access

  const asked = typeof params.month === "string" ? params.month : null
  const billingPeriod = isBillingPeriod(asked) ? asked : currentBillingPeriod()
  const [ledger, payouts] = await Promise.all([
    loadFinanceDashboard(supabase, clubId, billingPeriod).catch(() => null),
    loadClubPayouts(supabase, clubId).catch(() => null),
  ])
  const overviewCoversMonth = board?.programme != null && board.money.period === billingPeriod
  const month = billingPeriodLabel(billingPeriod)

  return (
    <MembershipsShell access={access} board={board} active="payments">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">{`Payments in ${month}`}</h2>
            <p className="mt-1 max-w-prose text-sm text-ink-muted">
              Every membership&rsquo;s payment for the month: waive a month, retry a failed payment, generate the month&rsquo;s obligations or export them.
            </p>
          </div>
          <MonthSelector currentMonth={billingPeriod} />
        </div>

        {(can.enrolment || can.export) && (
          <div className="flex flex-wrap gap-3">
            {can.enrolment && <GenerateObligationsButton clubId={clubId} billingPeriod={billingPeriod} monthLabel={month} />}
            {can.export && <ExportButton clubId={clubId} billingPeriod={billingPeriod} />}
          </div>
        )}

        {!ledger ? (
          <MembershipsLoadProblem />
        ) : (
          <>
            <div className={`grid grid-cols-2 gap-3 ${overviewCoversMonth ? "@3xl:grid-cols-4" : "@2xl:grid-cols-3 @5xl:grid-cols-6"}`}>
              {!overviewCoversMonth && <MetricCard label="Expected Revenue" value={formatMinorUnits(ledger.metrics.expectedRevenueMinor)} />}
              {!overviewCoversMonth && <MetricCard label="Collected This Month" value={formatMinorUnits(ledger.metrics.collectedMinor)} tone="success" />}
              {!overviewCoversMonth && (
                <MetricCard label="Outstanding" value={formatMinorUnits(ledger.metrics.outstandingMinor)} tone={ledger.metrics.outstandingMinor > 0 ? "warning" : undefined} />
              )}
              <MetricCard label="Payment Success Rate" value={ledger.metrics.successRatePercent !== null ? `${ledger.metrics.successRatePercent}%` : "—"} />
              <MetricCard label="Active Direct Debits" value={String(ledger.metrics.activeDirectDebits)} />
              {!overviewCoversMonth && <MetricCard label="Waived or Exempt" value={formatMinorUnits(ledger.metrics.exemptWaivedMinor)} />}
              {overviewCoversMonth && (
                <p className="col-span-2 flex items-center rounded-2xl border border-dashed border-ink/15 bg-white/60 px-4 py-3 text-sm text-ink-muted">
                  <span>
                    {`${monthName(billingPeriod)}'s money and who needs action are on the `}
                    <Link href="/club/finance" className="font-medium text-forest-800 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-forest-800">
                      Overview
                    </Link>
                    , worked out the same way as the rest of Memberships.
                  </span>
                </p>
              )}
            </div>

            {/* For the month the Overview covers, its standing IS the attention view (every player, including those
                nobody has set up); these counts stay for the months it does not cover. */}
            {(!overviewCoversMonth || ledger.review.length > 0) && (
              <div className="space-y-3">
                {!overviewCoversMonth && <AttentionPanel failedCount={ledger.attention.failed} notSetUpCount={ledger.attention.notSetUp} overdueCount={ledger.attention.overdue} />}
                <RelationshipReviewPanel items={ledger.review} />
              </div>
            )}

            <SubscriberTable clubId={clubId} rows={ledger.rows} canManageEnrolment={can.enrolment} canManagePayments={can.payments} monthLabel={month} />
          </>
        )}

        {/* WHAT REACHED THE CLUB'S BANK (20270754000000): GoCardless's payouts, explained from its own items. */}
        <PayoutsPanel payouts={payouts} problem={payouts === null ? "The club's payouts could not be loaded. Refresh the page to try again." : null} />
      </div>
    </MembershipsShell>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return (
    <div className="min-w-0 rounded-2xl border border-ink/10 bg-white p-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "success" ? "text-forest-800" : tone === "warning" ? "text-amber-700" : "text-ink"}`}>{value}</p>
    </div>
  )
}
