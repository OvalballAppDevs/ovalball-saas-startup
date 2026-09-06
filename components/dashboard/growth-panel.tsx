"use client"

import { useMemo, useState } from "react"

import type { GrowthMetric, GrowthPoint } from "@/lib/app-context/site-admin-dashboard-data"
import { cn } from "@/lib/utils"

import { LineChart, type LinePoint } from "./charts"

/**
 * Platform growth: one metric at a time, by choice.
 *
 * Five series on one chart is unreadable at 390px and not much better on a
 * desktop -- clubs and players differ by an order of magnitude, so a shared
 * axis flattens four of them into the floor. A selector shows one series
 * properly instead of five badly.
 *
 * Both series and both windows come from ONE server read: the trends RPC
 * returns 30 daily and 12 monthly buckets already aggregated, so switching
 * metric or window is a slice of data already in hand, not a round trip.
 *
 * The definitions here are the Platform Pulse definitions -- users are
 * completed profiles, parents are distinct guardian PEOPLE, players are
 * sporting identities. A card and a chart that disagreed about what a
 * "parent" is would be worse than having neither.
 */
const METRICS: { key: GrowthMetric; label: string }[] = [
  { key: "users", label: "Users" },
  { key: "clubs", label: "Clubs" },
  { key: "teams", label: "Teams" },
  { key: "parents", label: "Parents" },
  { key: "players", label: "Players" },
]

const WINDOWS = [
  { key: "30d", label: "30D", source: "daily" as const, take: 30 },
  { key: "3m", label: "3M", source: "monthly" as const, take: 3 },
  { key: "6m", label: "6M", source: "monthly" as const, take: 6 },
  { key: "12m", label: "12M", source: "monthly" as const, take: 12 },
]

export function GrowthPanel({
  daily,
  monthly,
}: {
  daily: GrowthPoint[]
  monthly: GrowthPoint[]
}) {
  const [metric, setMetric] = useState<GrowthMetric>("clubs")
  const [win, setWin] = useState(WINDOWS[3])

  const points: LinePoint[] = useMemo(() => {
    const source = win.source === "daily" ? daily : monthly
    return source.slice(-win.take).map((p) => ({
      label: formatBucket(p.bucket, win.source),
      value: p[metric],
    }))
  }, [daily, monthly, metric, win])

  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? metric
  const total = points.reduce((s, p) => s + p.value, 0)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="Growth metric" className="flex flex-wrap gap-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              aria-pressed={metric === m.key}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                metric === m.key
                  ? "bg-forest-800 text-white"
                  : "bg-ink/5 text-ink/65 hover:bg-ink/10 hover:text-ink"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div role="group" aria-label="Time window" className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWin(w)}
              aria-pressed={win.key === w.key}
              className={cn(
                "rounded-full px-2.5 py-1.5 text-xs font-medium tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                win.key === w.key
                  ? "bg-ink/85 text-white"
                  : "bg-ink/5 text-ink/65 hover:bg-ink/10 hover:text-ink"
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-3 text-sm text-ink/70">
        <span className="font-display text-2xl text-ink tabular-nums">{total.toLocaleString("en-GB")}</span>{" "}
        new {metricLabel.toLowerCase()} in the last {win.label === "30D" ? "30 days" : win.label.replace("M", " months")}
      </p>

      <div className="mt-2">
        <LineChart
          title={`${metricLabel} added, last ${win.label}`}
          summary={`Newly registered ${metricLabel.toLowerCase()} per ${win.source === "daily" ? "day" : "month"}, ${total} in total over the period.`}
          points={points}
          seriesLabel={`New ${metricLabel.toLowerCase()}`}
        />
      </div>

      <p className="mt-2 text-xs text-ink/45">
        Newly added per {win.source === "daily" ? "day" : "month"}, from canonical creation
        timestamps. Records created in bulk show as a genuine spike on the day they were created —
        no history is invented to smooth it.
      </p>
    </div>
  )
}

function formatBucket(iso: string, source: "daily" | "monthly"): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return source === "daily"
    ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
}
