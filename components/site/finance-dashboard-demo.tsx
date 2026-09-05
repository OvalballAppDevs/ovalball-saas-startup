"use client"

import { useState } from "react"
import { AlertTriangle } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  DEMO_FINANCE_ROWS,
  DEMO_FINANCE_SUMMARY,
  OBLIGATION_LABELS,
  type DemoFinanceRow,
} from "@/lib/marketing/game-day-demo"

/**
 * The Club Finance view, filterable.
 *
 * Statuses and their wording are the application's own membership-
 * obligation labels, not a marketing simplification -- "Scheduled for
 * collection" and "Submitted to GoCardless" say something specific and
 * true about where a collection actually is.
 *
 * On mobile the rows become stacked cards rather than a shrunken table:
 * a six-column finance table at 390px is unreadable, so the same markup
 * renders as a definition-style card and the column headers are dropped.
 *
 * No bank details, sort codes, mandate references or provider identifiers
 * appear here, in keeping with what the real Club Finance page exposes.
 */
const FILTERS = [
  { id: "all", label: "All" },
  { id: "PAID", label: "Paid" },
  { id: "SCHEDULED", label: "Scheduled" },
  { id: "attention", label: "Needs attention" },
] as const

type FilterId = (typeof FILTERS)[number]["id"]

function matches(row: DemoFinanceRow, filter: FilterId): boolean {
  if (filter === "all") return true
  if (filter === "attention") return row.status === "FAILED" || row.status === "OVERDUE"
  return row.status === filter
}

export function FinanceDashboardDemo() {
  const [filter, setFilter] = useState<FilterId>("all")
  const rows = DEMO_FINANCE_ROWS.filter((r) => matches(r, filter))

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.035] p-6 md:p-7">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium tracking-[0.06em] text-white/55 uppercase">
          Membership overview
        </h3>
        <span className="shrink-0 rounded-full border border-white/12 px-2.5 py-1 text-[11px] tracking-[0.06em] text-white/40 uppercase">
          Product preview
        </span>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Active members" value={String(DEMO_FINANCE_SUMMARY.activeMembers)} />
        <SummaryTile label="Expected this month" value={DEMO_FINANCE_SUMMARY.expectedThisMonth} />
        <SummaryTile label="Collected" value={DEMO_FINANCE_SUMMARY.collected} tone="good" />
        <SummaryTile
          label="Needs attention"
          value={String(DEMO_FINANCE_SUMMARY.needsAttention)}
          tone="warn"
        />
      </dl>

      <div role="tablist" aria-label="Filter memberships by status" className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = f.id === filter
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(f.id)}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none",
                active
                  ? "border-pitch-600 bg-pitch-600 text-ink"
                  : "border-white/15 bg-white/[0.03] text-white/70 hover:border-white/35 hover:text-white"
              )}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* Column headers only exist where there are actually columns. */}
      <div className="mt-5 hidden grid-cols-[1fr_auto_auto] gap-4 px-4 pb-2 text-[11px] tracking-[0.04em] text-white/35 uppercase sm:grid">
        <span>Member</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Status</span>
      </div>

      <ul className="flex flex-col gap-2" role="list" aria-live="polite">
        {rows.map((row) => (
          <li
            key={row.member}
            className="flex flex-col gap-2 rounded-lg bg-white/[0.03] px-4 py-3 sm:grid sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-4"
          >
            <div className="min-w-0">
              <p className="text-sm text-white">{row.member}</p>
              <p className="text-xs text-white/45">{row.ageGroup}</p>
            </div>
            <p className="text-sm tabular-nums text-white/80 sm:text-right">{row.amount}</p>
            <StatusChip status={row.status} />
          </li>
        ))}
        {rows.length === 0 && (
          <li className="rounded-lg bg-white/[0.03] px-4 py-6 text-center text-sm text-white/50">
            Nothing in this state right now.
          </li>
        )}
      </ul>

      <p className="mt-4 text-xs text-white/40">
        Visible to Club Admins with finance permission &mdash; not to coaches, team admins, other
        families or players. No bank details are shown here or held by Ovalball.
      </p>
    </div>
  )
}

function SummaryTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: string
  tone?: "neutral" | "good" | "warn"
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        tone === "good"
          ? "border-pitch-600/35 bg-pitch-600/[0.09]"
          : tone === "warn"
            ? "border-amber-500/30 bg-amber-500/[0.08]"
            : "border-white/10 bg-white/[0.02]"
      )}
    >
      <dt className="text-[11px] tracking-[0.04em] text-white/50 uppercase">{label}</dt>
      <dd
        className={cn(
          "mt-1 font-display text-2xl tabular-nums",
          tone === "good" ? "text-pitch-400" : tone === "warn" ? "text-amber-300" : "text-white"
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const needsAttention = status === "FAILED" || status === "OVERDUE"
  const paid = status === "PAID"
  return (
    <span
      className={cn(
        "flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:justify-self-end",
        needsAttention
          ? "bg-amber-500/15 text-amber-300"
          : paid
            ? "bg-pitch-600/15 text-pitch-400"
            : "bg-white/[0.08] text-white/60"
      )}
    >
      {/* An icon as well as colour on the one state that matters most. */}
      {needsAttention && <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />}
      {OBLIGATION_LABELS[status] ?? status}
    </span>
  )
}
