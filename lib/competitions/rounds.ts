/**
 * ROUND DATES.
 *
 * Four ways to date a draft, all of them editable afterwards:
 *   none      -- rounds without dates yet
 *   specific  -- the organiser types a date for each round
 *   weekly    -- a start date and a gap in days, repeated
 *   (a date on one match always overrides its round)
 *
 * Dates are ISO strings built from calendar arithmetic in UTC, so a round never
 * lands on the wrong day because of a clock change.
 */

export type RoundDating =
  | { kind: "none" }
  | { kind: "specific"; dates: (string | null)[] }
  | { kind: "weekly"; start: string; everyDays: number }

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

export function roundDates(roundCount: number, dating: RoundDating): (string | null)[] {
  if (dating.kind === "none") return Array.from({ length: roundCount }, () => null)
  if (dating.kind === "specific") return Array.from({ length: roundCount }, (_, i) => dating.dates[i] || null)
  const gap = Math.max(1, Math.floor(dating.everyDays))
  return Array.from({ length: roundCount }, (_, i) => addDaysIso(dating.start, i * gap))
}

/** Moving one round leaves every other round where it was. */
export function moveRound(dates: (string | null)[], roundIndex: number, date: string | null): (string | null)[] {
  return dates.map((d, i) => (i === roundIndex ? date : d))
}
