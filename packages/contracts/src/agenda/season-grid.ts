/**
 * THE SHAPE OF A RUGBY SEASON, AS WEEKS.
 *
 * Season view exists to answer one question the Month and Week views cannot:
 * WHAT DOES OUR YEAR LOOK LIKE. Not "what is on this month" — the rhythm. Where
 * the matches cluster, where the away runs are, which weeks are rest.
 *
 * So the unit is the WEEK, not the day. A season is thirty-odd weeks, which
 * fits on one screen as squares and does not fit as days. Months are kept only
 * as grouping headers, because "early October" is how people talk about a
 * season and "week 6" is not.
 *
 * THIS MODULE IS PURE. It takes events the server already authorised and
 * returns an arrangement of them. It performs no fetching, holds no scope and
 * makes no authority decision — which is what makes the Season view safe to
 * add: it cannot widen anything, because there is nothing here to widen from.
 *
 * WEEKS START ON MONDAY, matching the Agenda's own rule: a Saturday match and
 * the Tuesday session that preceded it belong to the same rugby week, and a
 * Sunday-start week would split them.
 */

export interface SeasonGridEvent {
  id: string
  kind: "fixture" | "training" | "event"
  /** yyyy-mm-dd */
  date: string
  time: string | null
  /** "Home" | "Away" | "" — fixtures only. Training is never given one. */
  homeAway: string
  teamDisplayName: string
  opposition: string
  laneId: string
  status: string
  /**
   * Where it is played -- pitch where the club records one, otherwise the
   * venue. Presentation only; the week panel shows it because "which pitch"
   * is the question a parent asks second, right after "what time".
   */
  venue: string | null
  /**
   * A multi-day event's whole span, written out -- "7-14 September 2026".
   *
   * The grid projects such an event onto every day it covers so the shape of
   * the week is honest, but a LIST of a week's events should say the event
   * once and say how long it runs. Null for anything happening on one day.
   */
  spanNote?: string | null
  /**
   * Whether THIS viewer may manage THIS event. Computed upstream from the
   * capability engine per entry, carried through so the expansion can offer a
   * route to the canonical management surface. Never a role name, and never
   * recomputed here -- this module holds no authority.
   */
  canEdit: boolean
}

export interface SeasonWeek {
  /**
   * Where this week falls in the season, 1-based -- "W8".
   *
   * Counted from the season's own first week, not from the calendar year, so
   * it answers "how far into the season are we" the way a coach counts it.
   * Presentation only: nothing is scheduled, authorised or filtered by it.
   */
  weekNumber: number
  /** Monday of this week, yyyy-mm-dd. The stable key and the URL anchor. */
  startIso: string
  endIso: string
  events: SeasonGridEvent[]
  homeMatches: number
  awayMatches: number
  /** Matches whose side is not yet settled — counted, never guessed into home or away. */
  undecidedMatches: number
  trainingSessions: number
  /** Club events touching this week -- counted per EVENT, never per day it spans. */
  clubEvents: number
  /** True when this week holds nothing at all: a rest week is a real answer, not an absence of data. */
  isRest: boolean
  /** How many distinct teams have something on. Drives club-density signalling. */
  teamCount: number
}

export interface SeasonMonth {
  /** yyyy-mm */
  key: string
  label: string
  year: string
  weeks: SeasonWeek[]
}

function isoAddDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** The Monday on or before this date. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  const shift = (d.getDay() + 6) % 7
  return isoAddDays(iso, -shift)
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/**
 * Build the whole grid for a season range.
 *
 * Every week between the bounds appears, INCLUDING empty ones. That is the
 * point: a season with a three-week gap in February should show three empty
 * squares, because the gap is information. Dropping them would compress the
 * year and destroy the rhythm the view exists to show.
 *
 * A week is filed under the month its MONDAY falls in, so a week straddling a
 * month boundary appears exactly once rather than in both.
 */
export function buildSeasonGrid(rangeStart: string, rangeEnd: string, events: SeasonGridEvent[]): SeasonMonth[] {
  if (!rangeStart || !rangeEnd || rangeEnd < rangeStart) return []

  const byWeek = new Map<string, SeasonGridEvent[]>()
  for (const e of events) {
    const wk = mondayOf(e.date)
    const list = byWeek.get(wk)
    if (list) list.push(e)
    else byWeek.set(wk, [e])
  }

  const months: SeasonMonth[] = []
  const monthIndex = new Map<string, SeasonMonth>()

  let cursor = mondayOf(rangeStart)
  // Guard against a malformed range producing an unbounded loop: a season is
  // never more than a couple of hundred weeks, and this is a pure function
  // that must not be able to hang a page.
  for (let guard = 0; cursor <= rangeEnd && guard < 400; guard++) {
    const weekEvents = (byWeek.get(cursor) ?? []).slice().sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return (a.time ?? "99:99").localeCompare(b.time ?? "99:99")
    })
    const fixtures = weekEvents.filter((e) => e.kind === "fixture")
    const week: SeasonWeek = {
      weekNumber: guard + 1,
      startIso: cursor,
      endIso: isoAddDays(cursor, 6),
      events: weekEvents,
      homeMatches: fixtures.filter((e) => e.homeAway === "Home").length,
      awayMatches: fixtures.filter((e) => e.homeAway === "Away").length,
      undecidedMatches: fixtures.filter((e) => e.homeAway !== "Home" && e.homeAway !== "Away").length,
      trainingSessions: weekEvents.filter((e) => e.kind === "training").length,
      // A seven-day event crossing this week is ONE event here, not seven.
      // The grid counts what is happening, not how many squares it touches.
      clubEvents: new Set(weekEvents.filter((e) => e.kind === "event").map((e) => e.id)).size,
      isRest: weekEvents.length === 0,
      teamCount: new Set(weekEvents.map((e) => e.laneId)).size,
    }

    // A week is filed under the month its MONDAY falls in, so a week
    // straddling a month boundary appears exactly once rather than in both.
    //
    // THE ONE EXCEPTION IS THE LEADING WEEK. A season starting on Tuesday
    // 1 September belongs to a week that opened on Monday 31 August, and
    // filing it by that Monday invented a whole "August" month header above
    // the season -- a month the season does not include, holding a single
    // stub square, reading "Nothing scheduled" because nothing could ever be
    // scheduled in it. The week is clamped to the month the season actually
    // starts in; every later week still files by its own Monday.
    const mk = cursor < rangeStart ? rangeStart.slice(0, 7) : cursor.slice(0, 7)
    let month = monthIndex.get(mk)
    if (!month) {
      const [y, m] = mk.split("-").map(Number)
      month = { key: mk, label: MONTHS[m - 1], year: String(y), weeks: [] }
      monthIndex.set(mk, month)
      months.push(month)
    }
    month.weeks.push(week)

    cursor = isoAddDays(cursor, 7)
  }

  return months
}

/**
 * What a screen reader is told about a week.
 *
 * The squares carry colour, icons and counts; this is the same information as
 * a sentence, so the view is navigable without seeing any of it. Deliberately
 * spells out home and away rather than saying "2 matches", because which of
 * the two decides whether a family is travelling.
 */
export function describeWeek(week: SeasonWeek): string {
  const when = `Week beginning ${formatWeekStart(week.startIso)}`
  if (week.isRest) return `${when} — nothing scheduled`
  const parts: string[] = []
  if (week.homeMatches > 0) parts.push(`${week.homeMatches} home ${week.homeMatches === 1 ? "match" : "matches"}`)
  if (week.awayMatches > 0) parts.push(`${week.awayMatches} away ${week.awayMatches === 1 ? "match" : "matches"}`)
  if (week.undecidedMatches > 0) parts.push(`${week.undecidedMatches} ${week.undecidedMatches === 1 ? "match" : "matches"} with the venue still to be confirmed`)
  if (week.trainingSessions > 0) parts.push(`${week.trainingSessions} training ${week.trainingSessions === 1 ? "session" : "sessions"}`)
  if (week.clubEvents > 0) parts.push(`${week.clubEvents} club ${week.clubEvents === 1 ? "event" : "events"}`)
  return `${when} — ${parts.join(", ")}`
}

/**
 * A week names itself from its OWN date, never from the month it is filed
 * under. The season's opening week is filed under the month the season starts
 * in -- so the week beginning 31 August sits in September -- and borrowing
 * that group's label produced "31 September", a date that does not exist.
 */
export function weekStartLabel(iso: string): { day: number; month: string } {
  return { day: Number(iso.slice(8, 10)), month: MONTHS[Number(iso.slice(5, 7)) - 1] }
}

function formatWeekStart(iso: string): string {
  const { day, month } = weekStartLabel(iso)
  return `${day} ${month}`
}

/** Which week contains this date, or null when it falls outside the grid. */
export function weekContaining(months: SeasonMonth[], iso: string): SeasonWeek | null {
  const wk = mondayOf(iso)
  for (const m of months) {
    const found = m.weeks.find((w) => w.startIso === wk)
    if (found) return found
  }
  return null
}
