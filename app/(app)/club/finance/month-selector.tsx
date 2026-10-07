import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { FINANCE_WEB_PATHS, billingPeriodLabel, shiftBillingPeriod } from "@ovalball/contracts/club/finance"

const STEP =
  "inline-flex size-11 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-forest-800 sm:size-8"

/**
 * Metrics and tables all update to the selected period, never just the current month. Plain links to the Payments
 * page's own address, so Back, Refresh and a copied link all keep the month.
 */
export function MonthSelector({ currentMonth }: { currentMonth: string }) {
  const previous = shiftBillingPeriod(currentMonth, -1)
  const next = shiftBillingPeriod(currentMonth, 1)
  return (
    <nav aria-label="Month" className="flex items-center gap-1 rounded-lg border border-ink/10 bg-white px-1 py-1">
      <Link href={FINANCE_WEB_PATHS.financeDashboard(previous)} className={STEP} aria-label={`Previous Month, ${billingPeriodLabel(previous)}`}>
        <ChevronLeft aria-hidden="true" className="size-4" />
      </Link>
      <span className="min-w-[9rem] text-center text-sm font-medium text-ink">
        {billingPeriodLabel(currentMonth)}
      </span>
      <Link href={FINANCE_WEB_PATHS.financeDashboard(next)} className={STEP} aria-label={`Next Month, ${billingPeriodLabel(next)}`}>
        <ChevronRight aria-hidden="true" className="size-4" />
      </Link>
    </nav>
  )
}
