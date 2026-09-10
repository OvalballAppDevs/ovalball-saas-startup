import "server-only"

/**
 * THE ONE PLACE AN EMAIL FORMATS A DATE OR A TIME.
 *
 * Every resolver (fixture, training, event) builds its display strings by
 * calling these, so a Site Admin never has to reason about ISO strings and a
 * template never has to concatenate a range by hand. Centralising this is
 * what makes "7-14 September 2026" the same shape everywhere it appears,
 * rather than however each renderer happened to write it.
 *
 * Deliberately hand-rolled with Intl/toLocaleDateString rather than a date
 * library dependency, matching resolve-fixture-email-context.ts's existing
 * convention.
 */

const UK_TIME_ZONE = "UTC" // canonical dates/times are stored and read as wall-clock values; no timezone conversion happens here, matching resolve-fixture-email-context.ts's existing convention.

/**
 * "Wednesday 9 September 2026" -- no comma. `Intl`'s en-GB locale inserts
 * one between the weekday and the day whenever `year` is also requested
 * (`toLocaleDateString` alone gives "Wednesday, 9 September 2026"); this
 * codebase's existing fixture date format never used one, so the comma is
 * stripped rather than let ICU's punctuation choice quietly diverge from
 * the format every other date-carrying resolver already produces.
 */
export function formatDateLong(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`)
    .toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: UK_TIME_ZONE })
    .replace(",", "")
}

/** "9 September 2026" */
export function formatDateShort(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: UK_TIME_ZONE,
  })
}

/** "Wednesday" */
export function formatDayName(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: UK_TIME_ZONE })
}

/** Postgres `time` columns arrive as "HH:mm:ss" -- trimmed to "HH:mm". Null in, null out. */
export function formatTime(value: string | null): string | null {
  if (!value) return null
  return value.slice(0, 5)
}

/** "10:30-12:00", or just "10:30" when there is no end time, or null when there is no start time. */
export function formatTimeRange(startTime: string | null, endTime: string | null): string | null {
  const start = formatTime(startTime)
  if (!start) return null
  const end = formatTime(endTime)
  return end ? `${start}–${end}` : start
}

/**
 * A date range for a multi-day event, collapsing to a single date when the
 * span is one day. "7-14 September 2026" spans a month; "7-14 September" is
 * ambiguous about the year, so the year is always spelled out once at the
 * end rather than risked being cut for brevity.
 */
export function formatDateRange(startIsoDate: string, endIsoDate: string): string {
  if (startIsoDate === endIsoDate) return formatDateShort(startIsoDate)

  const start = new Date(`${startIsoDate}T00:00:00Z`)
  const end = new Date(`${endIsoDate}T00:00:00Z`)
  const sameMonth = start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()

  const startDay = start.getUTCDate()
  const endLong = formatDateShort(endIsoDate)

  if (sameMonth) {
    // "7-14 September 2026"
    return `${startDay}–${endLong}`
  }
  if (sameYear) {
    // "28 August - 3 September 2026"
    const startNoYear = start.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: UK_TIME_ZONE })
    return `${startNoYear} – ${endLong}`
  }
  // Spans a year boundary: spell both years out in full.
  return `${formatDateShort(startIsoDate)} – ${endLong}`
}
