"use client"

import { useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { compareAvailability, findGoodDates, readTeamAvailability, type CompareDay } from "@ovalball/contracts"

/**
 * THE SHARED SCHEDULING PANEL (CA-M11.4) -- the website side of the same read model the native app's
 * Request Fixture screen already uses (apps/mobile/src/fixture-requests/availability-calendar.tsx).
 * Same shared contract (readTeamAvailability/compareAvailability/findGoodDates), same coarse,
 * privacy-safe statuses -- never event detail, never more than "Busy" for a partner's day (Section 15).
 *
 * AGENDA/LIST FORM (Section 16's minimum), not a month grid: a 21-day rolling window from today,
 * proportionate to what the composer needs -- "when can these two teams realistically play in the next
 * few weeks", not a full calendar destination of its own (that remains /calendar).
 */

const WINDOW_DAYS = 21

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatDay(iso: string): { weekday: string; day: string; month: string } {
  const d = new Date(`${iso}T00:00:00`)
  return {
    weekday: d.toLocaleDateString("en-GB", { weekday: "short" }),
    day: d.toLocaleDateString("en-GB", { day: "numeric" }),
    month: d.toLocaleDateString("en-GB", { month: "short" }),
  }
}

function detailLabel(status: CompareDay["ours"]): string {
  if (status === "available") return "Available"
  if (status === "fixture") return "Fixture"
  if (status === "training") return "Training"
  if (status === "club_event") return "Club event"
  return "Request pending"
}

function partnerLabel(status: CompareDay["partner"]): string {
  if (status === null) return "Unknown"
  if (status === "available") return "Available"
  if (status === "request_pending") return "Request pending"
  return "Busy"
}

export function AvailabilityPanel({ ourTeamId, partnerTeamId, selectedDate, onSelectDate }: { ourTeamId: string; partnerTeamId: string | null; selectedDate: string; onSelectDate: (iso: string) => void }) {
  const [days, setDays] = useState<CompareDay[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const from = todayIso()
    const to = addDaysIso(from, WINDOW_DAYS - 1)
    void (async () => {
      try {
        const [ours, partner] = await Promise.all([readTeamAvailability(supabase, ourTeamId, ourTeamId, from, to), partnerTeamId ? readTeamAvailability(supabase, ourTeamId, partnerTeamId, from, to) : Promise.resolve(null)])
        if (!live) return
        setDays(compareAvailability(ours, partner))
      } catch (cause) {
        if (!live) return
        setError(cause instanceof Error ? cause.message : "Couldn't load scheduling availability.")
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [ourTeamId, partnerTeamId])

  const goodDates = days ? new Set(findGoodDates(days)) : new Set<string>()

  return (
    <div className="mt-4 rounded-lg border border-ink/10 bg-white p-4">
      <p className="text-sm font-medium text-ink/80">When can these two teams realistically play?</p>
      <p className="mt-0.5 text-xs text-ink-muted">Next {WINDOW_DAYS} days. {partnerTeamId ? "Partner availability is shown where Ovalball knows it." : "Choose their team to compare availability."}</p>

      {loading && <p className="mt-3 text-sm text-ink-muted">Loading scheduling availability…</p>}
      {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}

      {!loading && !error && days && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => {
            const { weekday, day, month } = formatDay(d.date)
            const isSelected = d.date === selectedDate
            const isGood = goodDates.has(d.date)
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => onSelectDate(d.date)}
                aria-pressed={isSelected}
                aria-label={`${weekday} ${day} ${month}. Us: ${detailLabel(d.ours)}.${partnerTeamId ? ` Partner: ${partnerLabel(d.partner)}.` : ""}${isGood ? " Good option." : ""}`}
                className={`flex shrink-0 flex-col items-center gap-1 rounded-lg border px-3 py-2 text-center ${isSelected ? "border-pitch-600 bg-mint-100" : isGood ? "border-pitch-400/60 bg-pitch-50" : "border-ink/10 bg-white"}`}
              >
                <span className="text-[10px] font-medium tracking-wide text-ink-muted uppercase">{weekday}</span>
                <span className="text-base font-semibold text-ink">{day}</span>
                <span className="text-[10px] text-ink-muted">{month}</span>
                <span className={`mt-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${d.ours === "available" ? "bg-pitch-100 text-forest-800" : "bg-amber-100 text-amber-800"}`}>{detailLabel(d.ours)}</span>
                {partnerTeamId && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${d.partner === "available" ? "bg-pitch-100 text-forest-800" : "bg-ink/5 text-ink-muted"}`}>{partnerLabel(d.partner)}</span>}
                {isGood && <span className="text-[9px] font-semibold text-forest-800">Good option</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
