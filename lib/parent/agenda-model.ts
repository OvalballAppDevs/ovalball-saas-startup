/**
 * The Parent/Guardian agenda's pure decision logic -- grouping, filtering
 * and the outstanding-response count.
 *
 * Deliberately its own dependency-free module (no "server-only", no
 * Supabase, no next/headers), exactly like active-context-rules.ts and
 * fixture-authority-rule.ts before it, so the rules a parent actually acts
 * on have standalone regression coverage rather than being reachable only
 * through a rendered page.
 *
 * Everything here is PRESENTATION over rows the caller already read under
 * RLS. None of it authorizes anything: a filter can hide an event, never
 * reveal one, and the outstanding count is derived on every read rather
 * than stored, so it can never drift out of date with the responses it
 * describes.
 */

export type AgendaEventKind = "fixture" | "training"

/** The three canonical responses. `null` means not yet answered -- the state the 14-day card counts. */
export type AttendanceResponse = "ATTENDING" | "CANNOT_ATTEND" | "UNSURE" | null

export interface AgendaEvent {
  /**
   * Identity of one CHILD'S view of one event. A fixture two siblings both
   * play in is two rows here, because each child answers for themselves --
   * but one child can never appear twice for the same event, which is what
   * the dedupe below guarantees.
   */
  key: string
  kind: AgendaEventKind
  /** The canonical fixture_id or training_session_id. Never a synthesised frontend id. */
  eventId: string
  playerId: string
  childName: string
  childFirstName: string
  teamId: string
  teamName: string
  clubName: string
  /** ISO date, YYYY-MM-DD. */
  date: string
  /** HH:MM, or null when the time is not yet set. */
  time: string | null
  /** Canonical arrival time (fixtures.meet_time), when the club has set one. The same column the Match Centre reads. */
  meetTime?: string | null
  title: string
  venue: string | null
  /** The fixture's own lifecycle status; null for training. */
  status: string | null
  attendance: AttendanceResponse
  /** Where this row opens -- the Match Centre for a fixture. */
  href: string | null
}

export interface AgendaMonth {
  /** YYYY-MM, stable and sortable. */
  key: string
  label: string
  events: AgendaEvent[]
}

export interface AgendaFilters {
  /** Player ids to include. Empty means every child in scope. */
  playerIds: string[]
  /** Team ids to include. Empty means every team. */
  teamIds: string[]
  kind: "all" | "fixture" | "training"
  /** "needs_response" is the actionable one the 14-day card links to. */
  attendance: "all" | "needs_response" | "ATTENDING" | "CANNOT_ATTEND" | "UNSURE"
  venue: string | null
  dateRange: "all" | "this_month" | "next_14_days" | "next_30_days" | "season"
}

export const DEFAULT_AGENDA_FILTERS: AgendaFilters = {
  playerIds: [],
  teamIds: [],
  kind: "all",
  attendance: "all",
  venue: null,
  dateRange: "all",
}

/** The window the outstanding-response card asks about. */
export const ATTENDANCE_HORIZON_DAYS = 14

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function isoToParts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number)
  return { y, m, d }
}

/** Days from `fromIso` to `toIso`, both YYYY-MM-DD. Date-only arithmetic in UTC, so a kickoff never shifts a day because the reader is in a different timezone. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = isoToParts(fromIso)
  const b = isoToParts(toIso)
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)
  return Math.round(ms / 86_400_000)
}

/**
 * One child, one event, once.
 *
 * Two real sources of double counting this closes:
 *
 *   1. A fixture matched through BOTH its owning and opponent team, which
 *      happens whenever two of the same club's teams play each other.
 *   2. Mini-Rugby mirror pairs, where one physical fixture is represented
 *      by two rows. The caller collapses those to the primary before
 *      building events; this is the backstop.
 *
 * A sibling playing the same fixture is NOT a duplicate -- they answer
 * separately, so the key includes the player.
 */
export function dedupeAgendaEvents(events: AgendaEvent[]): AgendaEvent[] {
  const seen = new Set<string>()
  const out: AgendaEvent[] = []
  for (const e of events) {
    const id = `${e.kind}:${e.eventId}:${e.playerId}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(e)
  }
  return out
}

/**
 * Events still awaiting THIS child's answer inside the horizon.
 *
 * Derived, never stored. "Responded" means any of the three canonical
 * statuses -- Unsure is a real answer, not a gap, so a parent who has said
 * "not sure yet" is not nagged as though they had ignored it.
 *
 * Past events are excluded: an unanswered fixture from last week is not
 * something a parent can still act on, and counting it would make the card
 * permanently non-zero.
 */
export function countOutstandingResponses(events: AgendaEvent[], todayIso: string, horizonDays: number = ATTENDANCE_HORIZON_DAYS): number {
  return outstandingResponseEvents(events, todayIso, horizonDays).length
}

export function outstandingResponseEvents(events: AgendaEvent[], todayIso: string, horizonDays: number = ATTENDANCE_HORIZON_DAYS): AgendaEvent[] {
  return dedupeAgendaEvents(events).filter((e) => {
    if (e.attendance !== null) return false
    // A cancelled fixture is not a commitment; asking a parent to respond
    // to one would be noise.
    if (e.status === "Cancelled") return false
    const delta = daysBetween(todayIso, e.date)
    return delta >= 0 && delta <= horizonDays
  })
}

/** The inclusive ISO date window a range filter means, or null for "all". */
export function resolveDateWindow(range: AgendaFilters["dateRange"], todayIso: string, season: { startIso: string; endIso: string } | null): { startIso: string; endIso: string } | null {
  const { y, m, d } = isoToParts(todayIso)
  const iso = (dt: Date) => dt.toISOString().slice(0, 10)
  switch (range) {
    case "all":
      return null
    case "this_month": {
      const start = new Date(Date.UTC(y, m - 1, 1))
      const end = new Date(Date.UTC(y, m, 0)) // day 0 of next month = last day of this one
      return { startIso: iso(start), endIso: iso(end) }
    }
    case "next_14_days":
      return { startIso: todayIso, endIso: iso(new Date(Date.UTC(y, m - 1, d + 14))) }
    case "next_30_days":
      return { startIso: todayIso, endIso: iso(new Date(Date.UTC(y, m - 1, d + 30))) }
    case "season":
      // No canonical season resolved (a club with none configured) falls
      // back to showing everything rather than silently emptying the page.
      return season ? { startIso: season.startIso, endIso: season.endIso } : null
  }
}

/**
 * One coherent filter model, applied in one place.
 *
 * Attendance filtering resolves the SELECTED CHILD's own response, because
 * each AgendaEvent is already one child's view. In All Children mode two
 * siblings at the same fixture keep their two different answers -- they are
 * never collapsed into one invented family status.
 */
export function applyAgendaFilters(
  events: AgendaEvent[],
  filters: AgendaFilters,
  todayIso: string,
  season: { startIso: string; endIso: string } | null = null
): AgendaEvent[] {
  const window = resolveDateWindow(filters.dateRange, todayIso, season)
  return dedupeAgendaEvents(events).filter((e) => {
    if (filters.playerIds.length > 0 && !filters.playerIds.includes(e.playerId)) return false
    if (filters.teamIds.length > 0 && !filters.teamIds.includes(e.teamId)) return false
    if (filters.kind !== "all" && e.kind !== filters.kind) return false
    if (filters.venue && e.venue !== filters.venue) return false
    if (window && (e.date < window.startIso || e.date > window.endIso)) return false
    if (filters.attendance === "needs_response") {
      if (e.attendance !== null) return false
      if (e.status === "Cancelled") return false
      const delta = daysBetween(todayIso, e.date)
      if (delta < 0 || delta > ATTENDANCE_HORIZON_DAYS) return false
    } else if (filters.attendance !== "all" && e.attendance !== filters.attendance) {
      return false
    }
    return true
  })
}

/**
 * Month-grouped, chronological within each month.
 *
 * Months carry the year ("September 2026", not "September") because a
 * season spans a year boundary and a bare month name would put two
 * different Septembers under one heading.
 */
export function groupAgendaByMonth(events: AgendaEvent[]): AgendaMonth[] {
  const byKey = new Map<string, AgendaEvent[]>()
  for (const e of events) {
    const key = e.date.slice(0, 7)
    const bucket = byKey.get(key)
    if (bucket) bucket.push(e)
    else byKey.set(key, [e])
  }
  return Array.from(byKey.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => {
      const [y, m] = key.split("-").map(Number)
      return {
        key,
        label: `${MONTH_LABELS[m - 1]} ${y}`,
        events: list.sort((a, b) => (a.date === b.date ? (a.time ?? "").localeCompare(b.time ?? "") || a.childName.localeCompare(b.childName) : a.date.localeCompare(b.date))),
      }
    })
}

/** Every distinct venue present, for the filter's own options. Derived from the data so it never offers a venue with nothing behind it. */
export function venueOptions(events: AgendaEvent[]): string[] {
  return Array.from(new Set(events.map((e) => e.venue).filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b))
}
