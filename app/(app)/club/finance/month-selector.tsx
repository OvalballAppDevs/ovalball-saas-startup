"use client"

import { useRouter } from "next/navigation"

function shiftMonth(iso: string, delta: number): string {
  const [y, m] = iso.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
}

function label(iso: string): string {
  const [y, m] = iso.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
}

/** Metrics/tables all update to the selected period, never just the current month. */
export function MonthSelector({ currentMonth }: { currentMonth: string }) {
  const router = useRouter()

  function go(delta: number) {
    router.push(`/club/finance?month=${shiftMonth(currentMonth, delta)}`)
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-ink/10 bg-white px-2 py-1.5">
      <button type="button" onClick={() => go(-1)} className="rounded-md px-2 py-1 text-sm text-ink/60 hover:bg-ink/5" aria-label="Previous month">
        ←
      </button>
      <span className="min-w-[9rem] text-center text-sm font-medium text-ink">{label(currentMonth)}</span>
      <button type="button" onClick={() => go(1)} className="rounded-md px-2 py-1 text-sm text-ink/60 hover:bg-ink/5" aria-label="Next month">
        →
      </button>
    </div>
  )
}
