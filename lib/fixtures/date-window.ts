/**
 * MOVING THROUGH A SEASON WITHOUT REOPENING A PICKER.
 *
 * The Fixture Control Centre could say "upcoming", "past" or "all dates" and
 * nothing else. A fixture secretary's actual question on a Tuesday is "what is
 * happening this weekend", and answering it meant reading an unbounded list or
 * sorting and scrolling. The brief asks for fast period navigation rather than
 * a conventional date picker, and the reason is the one that matters: a picker
 * answers "jump to a date" well and "show me next week, and the week after"
 * badly, because every step costs a dialog.
 *
 * So the window is part of the URL -- two dates, `from_date` and `to_date` --
 * and previous/next/today are ordinary links that recompute them. There is no
 * client state, the view is bookmarkable and shareable, the back button works,
 * and a keyboard user tabs between three links rather than operating a dialog.
 * A specific date is still reachable: the picker is offered beside the stepper
 * for the case it is genuinely good at.
 *
 * THIS IS A VIEW WINDOW, NOT A SEASON. Nothing here defines, bounds or names a
 * season. Season boundaries come from the canonical `public.seasons` register
 * and reach this surface through the separate `season` filter. A week is a week
 * in any season, so computing one from a date invents no second calendar.
 *
 * WEEKS START ON MONDAY. Rugby is played at the weekend, so a Sunday-start week
 * would cut most clubs' match day in half and put Saturday and Sunday of one
 * fixture block in different windows.
 */

export type FixtureWindowKind = "week" | "month"

export interface FixtureWindow {
  kind: FixtureWindowKind
  /** Inclusive ISO date (YYYY-MM-DD). */
  from: string
  /** Inclusive ISO date (YYYY-MM-DD). */
  to: string
}

/** Dates are handled as UTC midnight throughout: a fixture's `kickoff_date` is a calendar date, not an instant, and re-introducing a local timezone here is how a Saturday fixture lands in the previous week for somebody west of Greenwich. */
function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setUTCDate(next.getUTCDate() + n)
  return next
}

/** True for a well-formed `YYYY-MM-DD` that names a real day. Rejects `2026-02-30` as well as `banana`. */
export function isCalendarDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = utc(value)
  return !Number.isNaN(d.getTime()) && iso(d) === value
}

/** Today, as a calendar date, in UTC. */
export function todayIso(now: Date = new Date()): string {
  return iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())))
}

/** The window of `kind` that contains `anchor`. */
export function windowFor(kind: FixtureWindowKind, anchor: string): FixtureWindow {
  const d = utc(anchor)
  if (kind === "month") {
    const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
    const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    return { kind, from: iso(from), to: iso(to) }
  }
  // getUTCDay(): 0 is Sunday. Monday-start means Sunday is six days after the
  // week's first day, not the day before it.
  const dayOffset = (d.getUTCDay() + 6) % 7
  const from = addDays(d, -dayOffset)
  return { kind, from: iso(from), to: iso(addDays(from, 6)) }
}

/** The same kind of window, one step earlier or later. */
export function stepWindow(window: FixtureWindow, direction: -1 | 1): FixtureWindow {
  const from = utc(window.from)
  if (window.kind === "month") {
    return windowFor("month", iso(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + direction, 1))))
  }
  return windowFor("week", iso(addDays(from, 7 * direction)))
}

/**
 * Recover a window from the URL.
 *
 * Returns null when no window is in force, which is the resting state and is
 * NOT the same as "this week": a person who has not asked for a window keeps
 * the existing `date` bucket behaviour rather than silently having the season
 * narrowed under them.
 */
export function parseFixtureWindow(fromDate: string | null | undefined, toDate: string | null | undefined): FixtureWindow | null {
  if (!isCalendarDate(fromDate) || !isCalendarDate(toDate)) return null
  if (fromDate > toDate) return null
  // The kind is derived rather than carried, so a hand-edited URL cannot claim
  // a month-shaped window is a week and get a stepper that disagrees with the
  // dates beside it. Anything that is not exactly a calendar month reads as a
  // week-shaped range, and stepping it moves seven days -- which is the honest
  // behaviour for an arbitrary range somebody pasted in.
  const month = windowFor("month", fromDate)
  const kind: FixtureWindowKind = month.from === fromDate && month.to === toDate ? "month" : "week"
  return { kind, from: fromDate, to: toDate }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * What the window is called on screen.
 *
 * A month is named. A week is a range, and the range drops whatever the two
 * ends already share: "20 - 26 Sep 2026" rather than "20 Sep 2026 - 26 Sep
 * 2026", and "29 Sep - 5 Oct 2026" when it crosses one.
 */
export function describeFixtureWindow(window: FixtureWindow): string {
  const from = utc(window.from)
  const to = utc(window.to)
  if (window.kind === "month") return `${MONTHS[from.getUTCMonth()]} ${from.getUTCFullYear()}`

  const sameYear = from.getUTCFullYear() === to.getUTCFullYear()
  const sameMonth = sameYear && from.getUTCMonth() === to.getUTCMonth()
  const left = sameMonth
    ? `${from.getUTCDate()}`
    : sameYear
      ? `${from.getUTCDate()} ${MONTHS[from.getUTCMonth()]}`
      : `${from.getUTCDate()} ${MONTHS[from.getUTCMonth()]} ${from.getUTCFullYear()}`
  const right = `${to.getUTCDate()} ${MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()}`
  return `${left} – ${right}`
}

/** Whether `today` falls inside the window -- used to say so, and to know when "This Week" is already where you are. */
export function windowContains(window: FixtureWindow, day: string): boolean {
  return day >= window.from && day <= window.to
}
