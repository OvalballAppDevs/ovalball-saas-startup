/**
 * WHERE AM I IN TIME?
 *
 * The agenda's date model, kept pure and dependency-free so the rules that
 * decide which rugby a person is shown can be tested on their own, the way
 * lib/weather/forecast-window.ts and lib/app-context/active-context-rules.ts
 * already are. Nothing here touches a database, a request or a clock it was
 * not handed.
 *
 * THE DEFAULT IS TODAY ONWARDS, NOT THE SEASON.
 *
 * A season-start default means opening Fixtures in March and scrolling past
 * five months of finished matches to find Saturday. The question this page
 * answers first is "what rugby have I got", which is a forward question. Past
 * rugby is a deliberate move, not the thing you land in.
 *
 * WEEK / MONTH / YEAR ARE ANCHORED, NOT RELATIVE.
 *
 * Each mode resolves an ANCHOR date to a concrete [start, end]. Previous and
 * next move the anchor by one unit and re-resolve. That keeps navigation
 * reversible and shareable -- the URL carries the anchor, so a link opens on
 * the same week the sender was looking at, rather than on the recipient's.
 *
 * A RUGBY WEEK STARTS ON MONDAY. The fixture is on Saturday and the training
 * that prepares for it is on Tuesday and Thursday; a Sunday-start week cuts
 * that story in half, and a Sunday-start week is also wrong for the age
 * groups who play on Sunday morning -- their match would open the week
 * belonging to the previous one's preparation.
 */

export type RangeMode = "upcoming" | "day" | "week" | "month" | "year"
export type Direction = "upcoming" | "past"

export interface DateWindow {
  /** Inclusive, YYYY-MM-DD. */
  startIso: string
  /** Inclusive, YYYY-MM-DD. */
  endIso: string
  /** What to call this window in the interface. */
  label: string
  /** Newest-first ordering for a backwards look; oldest-first for a forwards one. */
  order: "asc" | "desc"
}

/**
 * How far ahead the default "upcoming" view reaches.
 *
 * Bounded on purpose. This is the one mode with no user-chosen end, and an
 * unbounded one would mean a Site Admin's first paint asking for every fixture
 * every club has ever scheduled. A year covers a full season plus the start of
 * the next, which is further ahead than any club has actually planned.
 */
export const UPCOMING_HORIZON_DAYS = 365

/** How far back "past" reaches in one view. Two seasons is a long memory for a club. */
export const PAST_HORIZON_DAYS = 730

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number)
  return { y, m, d }
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Date-only arithmetic in UTC, so a fixture never shifts a day because the reader is in another timezone. */
export function shiftDays(iso: string, days: number): string {
  const { y, m, d } = parts(iso)
  return toIso(Date.UTC(y, m - 1, d + days))
}

export function shiftMonths(iso: string, months: number): string {
  const { y, m, d } = parts(iso)
  // Clamp to the last day of the target month, so stepping back from 31 March
  // lands on 28/29 February rather than skipping into March again.
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return toIso(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay)))
}

export function shiftYears(iso: string, years: number): string {
  const { y, m, d } = parts(iso)
  const lastDay = new Date(Date.UTC(y + years, m, 0)).getUTCDate()
  return toIso(Date.UTC(y + years, m - 1, Math.min(d, lastDay)))
}

/** The Monday of the rugby week containing this date. */
export function startOfWeek(iso: string): string {
  const { y, m, d } = parts(iso)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  const backToMonday = dow === 0 ? 6 : dow - 1
  return shiftDays(iso, -backToMonday)
}

export function startOfMonth(iso: string): string {
  const { y, m } = parts(iso)
  return toIso(Date.UTC(y, m - 1, 1))
}

export function endOfMonth(iso: string): string {
  const { y, m } = parts(iso)
  return toIso(Date.UTC(y, m, 0))
}

function shortDay(iso: string): string {
  const { y, m, d } = parts(iso)
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)))
}

/**
 * The concrete window for a mode, an anchor and a direction.
 *
 * `direction` only applies to the unanchored "upcoming" mode -- once somebody
 * has chosen a specific week, month or year, that window is what it is, and
 * whether it happens to be in the past is a fact about the anchor rather than
 * a separate setting.
 */
export function resolveWindow(mode: RangeMode, anchorIso: string, todayIso: string, direction: Direction = "upcoming"): DateWindow {
  // A single named day. This is what "jump to a date" resolves to: somebody
  // who picks 12 September wants that Saturday, not the week around it.
  if (mode === "day") {
    const { y, m, d } = parts(anchorIso)
    const label = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(y, m - 1, d))
    )
    return { startIso: anchorIso, endIso: anchorIso, label, order: "asc" }
  }
  if (mode === "week") {
    const start = startOfWeek(anchorIso)
    const end = shiftDays(start, 6)
    return { startIso: start, endIso: end, label: `${shortDay(start)} – ${shortDay(end)}`, order: "asc" }
  }
  if (mode === "month") {
    const start = startOfMonth(anchorIso)
    const { y, m } = parts(start)
    return { startIso: start, endIso: endOfMonth(anchorIso), label: `${MONTHS[m - 1]} ${y}`, order: "asc" }
  }
  if (mode === "year") {
    const { y } = parts(anchorIso)
    return { startIso: `${y}-01-01`, endIso: `${y}-12-31`, label: String(y), order: "asc" }
  }

  // "upcoming" -- the default, and its mirror image looking backwards.
  if (direction === "past") {
    return {
      startIso: shiftDays(todayIso, -PAST_HORIZON_DAYS),
      // Yesterday: today's rugby belongs to the forward view, because it has
      // not happened yet when somebody checks at breakfast.
      endIso: shiftDays(todayIso, -1),
      label: "Past rugby",
      // Newest first. Looking back, "what did we do last Saturday" is the
      // question, not "what did we do two seasons ago".
      order: "desc",
    }
  }
  return { startIso: todayIso, endIso: shiftDays(todayIso, UPCOMING_HORIZON_DAYS), label: "Today onwards", order: "asc" }
}

/** The anchor one unit earlier in the current mode. Meaningless for "upcoming", which has no anchor. */
export function previousAnchor(mode: RangeMode, anchorIso: string): string {
  if (mode === "day") return shiftDays(anchorIso, -1)
  if (mode === "week") return shiftDays(anchorIso, -7)
  if (mode === "month") return shiftMonths(anchorIso, -1)
  if (mode === "year") return shiftYears(anchorIso, -1)
  return anchorIso
}

export function nextAnchor(mode: RangeMode, anchorIso: string): string {
  if (mode === "day") return shiftDays(anchorIso, 1)
  if (mode === "week") return shiftDays(anchorIso, 7)
  if (mode === "month") return shiftMonths(anchorIso, 1)
  if (mode === "year") return shiftYears(anchorIso, 1)
  return anchorIso
}

/** True when the window contains today -- used to label the "This week"/"This month" middle control honestly. */
export function windowContainsToday(w: DateWindow, todayIso: string): boolean {
  return w.startIso <= todayIso && todayIso <= w.endIso
}

/**
 * A valid ISO date, or null.
 *
 * Anchors arrive from the query string, so they are parsed defensively: a
 * malformed one falls back to today rather than producing an Invalid Date that
 * silently becomes an empty agenda. Note that an anchor can only ever move the
 * WINDOW -- it cannot widen whose rugby is being read, which the scope
 * resolver settled before this ran.
 */
export function parseAnchor(value: string | null | undefined, fallbackIso: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallbackIso
  const { y, m, d } = parts(value)
  if (m < 1 || m > 12 || d < 1 || d > 31) return fallbackIso
  const back = new Date(Date.UTC(y, m - 1, d))
  if (Number.isNaN(back.getTime()) || back.getUTCMonth() !== m - 1) return fallbackIso
  // A century either side of today is plenty and keeps a nonsense year out of
  // the query planner.
  const { y: ty } = parts(fallbackIso)
  if (y < ty - 100 || y > ty + 100) return fallbackIso
  return value
}
