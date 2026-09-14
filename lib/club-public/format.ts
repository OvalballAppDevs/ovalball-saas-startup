/**
 * Dates on a club's public pages, in UK English and UK time.
 *
 * Match dates are calendar dates (a `date` column), so they are formatted in
 * UTC from their parts and can never slip a day at midnight. Publication
 * times are instants, so they are shown as the club reads them: Europe/London.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/**
 * Built from fixed UK names rather than Intl, because these strings are
 * rendered by client components too: Node and the browser ship different ICU
 * data, and "Thursday, 17 September" on the server against "Thursday 17
 * September" in the browser is a hydration mismatch.
 */
export function matchDateParts(iso: string): { weekday: string; day: string; month: string; long: string } {
  const [y, m, d] = iso.split("-").map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return {
    weekday: weekday.slice(0, 3),
    day: String(d),
    month: MONTHS[m - 1].slice(0, 3),
    long: `${weekday} ${d} ${MONTHS[m - 1]} ${y}`,
  }
}

export function shortMatchDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number)
  return `${d} ${MONTHS[m - 1].slice(0, 3)}`
}

/** The calendar date in London, e.g. "14 September 2026". Numbers from Intl, words from the fixed list above. */
export function publishedDate(timestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/London" }).formatToParts(new Date(timestamp))
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return `${part("day")} ${MONTHS[part("month") - 1]} ${part("year")}`
}

export function londonTodayIso(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/London" })
}
