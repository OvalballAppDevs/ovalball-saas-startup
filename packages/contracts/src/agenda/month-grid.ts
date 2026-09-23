import { startOfMonth, endOfMonth, shiftDays, startOfWeek } from "./window"

/**
 * A MONTH, AS THE SIX ROWS A PHONE DRAWS IT IN.
 *
 * Pure date arithmetic, in the shared package because "which squares does October
 * occupy" is not a rendering detail -- it decides which days a person can reach,
 * and it has to be assertable without a renderer. Nothing here reads a clock it
 * was not handed.
 *
 * THE WEEK STARTS ON MONDAY, as it does everywhere else in Ovalball. The reference
 * design this grid follows opens on Sunday; the platform does not, and for a
 * reason it has written down: the fixture is on Saturday and the training that
 * prepares for it is on Tuesday, so a Sunday-start week cuts that story in half.
 * The Calendar's own week strip already starts on Monday, and two calendars in one
 * app that disagree about which column Monday is in would be worse than either
 * choice on its own.
 *
 * ALWAYS SIX ROWS. A month that needs five leaves the sixth showing the start of
 * the next, rather than the grid changing height between September and October and
 * shifting everything under it up the screen.
 */

export interface MonthCell {
  /** YYYY-MM-DD. Every cell is a real date, including the ones spilling either side. */
  iso: string
  /** The day number to print. */
  day: number
  /** False for the days that belong to the neighbouring month and are drawn dimmed. */
  inMonth: boolean
}

export const MONTH_ROWS = 6
export const WEEK_DAYS = 7

/** Monday-first initials, for the header row above the grid. */
export const WEEKDAY_INITIALS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** "October 2026" — the month a grid is showing, named in full. */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

/**
 * The forty-two cells the month occupies, starting on the Monday on or before the
 * first of the month.
 */
export function monthCells(anchorIso: string): MonthCell[] {
  const first = startOfMonth(anchorIso)
  const last = endOfMonth(anchorIso)
  const start = startOfWeek(first)
  const cells: MonthCell[] = []
  for (let i = 0; i < MONTH_ROWS * WEEK_DAYS; i += 1) {
    const iso = shiftDays(start, i)
    cells.push({ iso, day: Number(iso.slice(8, 10)), inMonth: iso >= first && iso <= last })
  }
  return cells
}

/** The six rows, so a grid can lay out by row rather than by index arithmetic. */
export function monthWeeks(anchorIso: string): MonthCell[][] {
  const cells = monthCells(anchorIso)
  const weeks: MonthCell[][] = []
  for (let i = 0; i < cells.length; i += WEEK_DAYS) weeks.push(cells.slice(i, i + WEEK_DAYS))
  return weeks
}

/**
 * WHAT IS ON, ON EACH DAY — one dot per kind, never one per event.
 *
 * A Saturday with four matches is still a Saturday with matches; four dots under a
 * two-digit number is a smudge. So a day carries at most one mark for rugby played
 * and one for rugby trained, and the list below the grid carries the detail.
 *
 * THE DOTS ARE NOT THE ONLY SIGNAL. Colour alone never tells anybody anything
 * here: tapping the day names every event in words, with its own state.
 */
export interface DayMarks {
  fixture: boolean
  training: boolean
  /** True where something on this day is not going ahead, so the day can say so without colour. */
  cancelled: boolean
}

export function marksByDay(
  items: { date: string; kind: "fixture" | "training"; status: string | null }[]
): Map<string, DayMarks> {
  const marks = new Map<string, DayMarks>()
  for (const item of items) {
    const existing = marks.get(item.date) ?? { fixture: false, training: false, cancelled: false }
    if (item.kind === "fixture") existing.fixture = true
    else existing.training = true
    if (item.status === "Cancelled") existing.cancelled = true
    marks.set(item.date, existing)
  }
  return marks
}

/**
 * The next day at or after `fromIso` that has anything on it.
 *
 * What an empty day points at, so somebody who lands on a quiet Wednesday is told
 * where the rugby is rather than left tapping across the month to find it.
 */
export function nextDayWithSomething(dates: Iterable<string>, fromIso: string): string | null {
  let best: string | null = null
  for (const date of dates) {
    if (date < fromIso) continue
    if (best === null || date < best) best = date
  }
  return best
}
