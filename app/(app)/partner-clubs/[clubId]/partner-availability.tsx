"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

import { getPartnerAvailability } from "./actions"

interface Team {
  id: string
  display_name: string
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1)
  // Monday-first: JS getDay() is 0=Sun..6=Sat, shift so Monday=0.
  const leadingBlanks = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = Array(leadingBlanks).fill(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day))
  return cells
}

/**
 * "Polished calendar view" from the brief -- hand-rolled rather than a new
 * dependency, matching the rest of the app's plain-native-input approach to
 * dates. AVAILABLE/UNAVAILABLE only (get_partner_team_availability doesn't
 * distinguish a LIMITED state today -- every fixture in range is treated
 * the same regardless of status), never the partner's raw fixture details.
 */
export function PartnerAvailability({
  partnerClubId,
  partnerClubDirectoryId,
  teams,
}: {
  partnerClubId: string
  partnerClubDirectoryId: string
  teams: Team[]
}) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "")
  const today = useMemo(() => new Date(new Date().toDateString()), [])
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set())
  const [loading, startLoading] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!teamId) return
    const from = toISODate(visibleMonth)
    const to = toISODate(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0))
    startLoading(async () => {
      const result = await getPartnerAvailability(teamId, from, to)
      if (result.ok) {
        setUnavailable(new Set(result.unavailableDates))
        setError(null)
      } else {
        setError(result.error)
      }
    })
  }, [teamId, visibleMonth])

  const cells = useMemo(() => buildMonthGrid(visibleMonth.getFullYear(), visibleMonth.getMonth()), [visibleMonth])
  const monthLabel = visibleMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
  const selectedTeam = teams.find((t) => t.id === teamId)

  // Agenda rows for the mobile presentation below -- same data as the grid
  // (cells/unavailable), just future dates only (a past date can't be
  // requested either way, and a scrolling list benefits more from that
  // trim than a calendar-shaped grid does).
  const agendaDays = cells.filter((d): d is Date => d !== null && d >= today)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink/60">
          Availability for <span className="font-medium text-ink">{selectedTeam?.display_name ?? "this team"}</span>
        </p>
        {teams.length > 1 && (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Partner team">
            {teams.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={teamId === t.id}
                onClick={() => setTeamId(t.id)}
                className={cn(
                  "rounded-full border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                  teamId === t.id ? "border-pitch-600 bg-pitch-600/10 text-forest-900" : "border-ink/15 text-ink/60 hover:bg-ink/5"
                )}
              >
                {t.display_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 rounded-lg border border-ink/10 bg-white p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            className="flex size-10 items-center justify-center rounded-full text-ink/60 outline-none transition-colors hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <ChevronLeft className="size-5" />
          </button>
          <p className="text-sm font-medium text-ink" aria-live="polite">
            {monthLabel}
          </p>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setVisibleMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            className="flex size-10 items-center justify-center rounded-full text-ink/60 outline-none transition-colors hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>

        {/* Tablet/desktop: a real calendar grid reads naturally at this size. */}
        <div className="hidden sm:block">
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-medium text-ink/40">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>

          <div className="relative mt-1 grid grid-cols-7 gap-1">
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70">
                <Loader2 className="size-5 animate-spin text-ink/40" aria-label="Loading availability" />
              </div>
            )}
            {cells.map((date, i) => {
              if (!date) return <div key={`blank-${i}`} />
              const iso = toISODate(date)
              const isPast = date < today
              const isUnavailable = unavailable.has(iso)
              const isToday = date.getTime() === today.getTime()
              const disabled = isPast || isUnavailable

              if (disabled) {
                return (
                  <div
                    key={iso}
                    aria-label={`${date.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}, ${isUnavailable ? "unavailable" : "past"}`}
                    className={cn(
                      "flex aspect-square min-h-11 items-center justify-center rounded-lg text-sm",
                      isPast ? "text-ink/20" : "bg-destructive/5 text-destructive/50 line-through decoration-1"
                    )}
                  >
                    {date.getDate()}
                  </div>
                )
              }

              return (
                <Link
                  key={iso}
                  href={`/fixtures/new?opponentClubId=${partnerClubId}&opponentDirectoryId=${partnerClubDirectoryId}&targetTeamId=${teamId}&date=${iso}`}
                  aria-label={`Request a fixture on ${date.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}, available`}
                  className={cn(
                    "flex aspect-square min-h-11 items-center justify-center rounded-lg text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                    "bg-pitch-600/10 text-forest-900 hover:bg-pitch-600/20",
                    isToday && "ring-1 ring-inset ring-pitch-600"
                  )}
                >
                  {date.getDate()}
                </Link>
              )
            })}
          </div>
        </div>

        {/* Mobile: an agenda list instead of a shrunk-down grid -- a 7-column
            grid at 375px squeezes into ~44px cells with no room to breathe;
            a scrollable list of full-width rows reads far better on a phone
            and matches how the rest of this app already presents dated rows
            (Calendar, Fixtures, Dashboard). Same data, same month state. */}
        <div className="relative sm:hidden">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/70">
              <Loader2 className="size-5 animate-spin text-ink/40" aria-label="Loading availability" />
            </div>
          )}
          {agendaDays.length === 0 ? (
            <p className="mt-3 py-6 text-center text-sm text-ink/45">Nothing left in {monthLabel} &mdash; try next month.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {agendaDays.map((date) => {
                const iso = toISODate(date)
                const isUnavailable = unavailable.has(iso)
                const isToday = date.getTime() === today.getTime()
                const dateLabel = date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })

                if (isUnavailable) {
                  return (
                    <li
                      key={iso}
                      className="flex min-h-11 items-center justify-between rounded-lg bg-destructive/5 px-3.5 py-2.5"
                    >
                      <span className="text-sm text-destructive/60 line-through decoration-1">{dateLabel}</span>
                      <span className="text-xs font-medium text-destructive/60">Unavailable</span>
                    </li>
                  )
                }

                return (
                  <li key={iso}>
                    <Link
                      href={`/fixtures/new?opponentClubId=${partnerClubId}&opponentDirectoryId=${partnerClubDirectoryId}&targetTeamId=${teamId}&date=${iso}`}
                      className={cn(
                        "flex min-h-11 items-center justify-between rounded-lg bg-pitch-600/10 px-3.5 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 active:bg-pitch-600/20",
                        isToday && "ring-1 ring-inset ring-pitch-600"
                      )}
                    >
                      <span className="text-sm font-medium text-forest-900">
                        {dateLabel}
                        {isToday && <span className="ml-1.5 text-xs font-normal text-forest-800/70">Today</span>}
                      </span>
                      <span className="text-xs font-medium text-forest-800">Available &rsaquo;</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        {/* The mobile agenda rows already label themselves Available/
            Unavailable inline -- this legend is only needed to explain the
            grid's colour coding. */}
        <div className="mt-4 hidden flex-wrap items-center gap-4 border-t border-ink/10 pt-3 text-xs text-ink/50 sm:flex">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-pitch-600/40" /> Available &mdash; click to request
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-destructive/40" /> Unavailable
          </span>
        </div>
      </div>
    </div>
  )
}
