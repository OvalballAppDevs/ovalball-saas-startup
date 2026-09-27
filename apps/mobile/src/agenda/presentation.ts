import type { AgendaItem } from "@ovalball/contracts"

/**
 * TURNING RUGBY FACTS INTO WORDS A PHONE CAN SHOW.
 *
 * Presentation only. Nothing here decides who is playing whom, which side is at home, or whether a
 * score may be shown -- those are the loader's answers and they arrive already made. This file is
 * about the difference between "2026-09-25" and "Saturday", which is a difference a person feels and a
 * database should not care about.
 */

/** Canonical statuses, verbatim from `fixtures_status_check`. Nothing invented. */
export type FixtureStatus =
  | "Planned"
  | "Booked"
  | "To Be Determined"
  | "Annual Holiday"
  | "Festival"
  | "Lancashire Cup"
  | "Cancelled"
  | "Completed"

/**
 * HOW A STATUS LOOKS, AND IT IS NEVER ONLY A COLOUR.
 *
 * A cancelled fixture has to be unmistakable to somebody who cannot distinguish red from green, is
 * reading in sunlight, or is hearing the screen rather than seeing it. So every state carries a WORD,
 * and cancelled additionally changes the shape of the row -- struck through, dimmed. Colour is the
 * third signal, never the first.
 */
export interface StatusTone {
  label: string
  tone: "neutral" | "confirmed" | "warning" | "stopped" | "done"
  /** True where the fixture is not going ahead as scheduled: the row is struck through as well. */
  struck: boolean
}

/**
 * WIN, LOSS OR DRAW -- the canonical wording (matches the website's own `FixtureResultPanel`).
 * `AgendaItem.result` is already normalised to the viewer's own side (`ourScore`/`theirScore`), so no
 * home/away conversion is needed here at all.
 */
export function resultOutcome(result: AgendaItem["result"]): { label: "Win" | "Loss" | "Draw"; tone: "positive" | "negative" | "neutral" } | null {
  if (!result) return null
  if (result.ourScore > result.theirScore) return { label: "Win", tone: "positive" }
  if (result.ourScore < result.theirScore) return { label: "Loss", tone: "negative" }
  return { label: "Draw", tone: "neutral" }
}

export function statusTone(status: string | null): StatusTone | null {
  switch (status) {
    case "Booked":
      return { label: "Booked", tone: "confirmed", struck: false }
    case "Planned":
      return { label: "Planned", tone: "neutral", struck: false }
    case "To Be Determined":
      return { label: "To be confirmed", tone: "warning", struck: false }
    case "Cancelled":
      return { label: "Cancelled", tone: "stopped", struck: true }
    case "Completed":
      return { label: "Completed", tone: "done", struck: false }
    case "Annual Holiday":
      return { label: "Annual holiday", tone: "neutral", struck: true }
    case "Festival":
      return { label: "Festival", tone: "confirmed", struck: false }
    case "Lancashire Cup":
      return { label: "Lancashire Cup", tone: "confirmed", struck: false }
    default:
      return status ? { label: status, tone: "neutral", struck: false } : null
  }
}

/**
 * HOME OR AWAY, SAID RATHER THAN IMPLIED.
 *
 * Nobody should have to work it out from which team is printed first. The loader has already flipped
 * it to the viewer's own point of view, so this only has to name it -- including the two cases that are
 * neither, which a two-state control would have had to lie about.
 */
export function homeAwayLabel(homeAway: AgendaItem["homeAway"]): { short: string; spoken: string } | null {
  switch (homeAway) {
    case "Home":
      return { short: "H", spoken: "Home" }
    case "Away":
      return { short: "A", spoken: "Away" }
    case "TBD":
      return { short: "?", spoken: "Venue to be confirmed" }
    case "Not Applicable":
      return { short: "–", spoken: "Neutral" }
    default:
      return null
  }
}

/**
 * WHO WE ARE PLAYING -- THE CLUB, AND NOTHING ELSE.
 *
 * NO "v" AND NO "at". The badge beside the row already says home or away, so a preposition repeating it
 * is a word doing no work at the front of every line, pushing the club's name rightwards and eating the
 * space a long one needs.
 *
 * AND NOT THEIR SIDE EITHER. Both sides of a fixture are the same age grade -- the compatibility rules
 * see to that -- so "Preston Grasshoppers RFC Under 13 Boys" above a metadata line reading "Under 13
 * Boys" said the grade twice and the club once. The club is the part that differs, so the club is the
 * line; whose side it is belongs in the metadata, where it is also the useful half in a club context.
 */
export function opponentLine(item: AgendaItem): string {
  if (!item.them) return item.us.teamName ?? item.us.clubName
  return item.them.clubName || item.them.teamName || "Opposition"
}

/** The full name, for the one place that has room for it and no badge beside it. */
export function opponentFullName(item: AgendaItem): string {
  if (!item.them) return item.us.teamName ?? item.us.clubName
  return [item.them.clubName, item.them.teamName].filter(Boolean).join(" ")
}

/**
 * A DATE SOMEBODY READS.
 *
 * "Today", "Tomorrow" and a weekday for the week ahead, because those are the words a person uses.
 * Beyond that the date itself, with the month spelled rather than numbered -- 09/10 means two different
 * days on two sides of the Atlantic and Ovalball has no business being ambiguous about a kick-off.
 */
export function relativeDate(iso: string, today: string): string {
  const days = daysBetween(today, iso)
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  if (days === -1) return "Yesterday"
  const date = parse(iso)
  if (!date) return iso
  if (days > 1 && days < 7) return date.toLocaleDateString("en-GB", { weekday: "long" })
  const sameYear = iso.slice(0, 4) === today.slice(0, 4)
  return date.toLocaleDateString("en-GB", sameYear ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })
}

/**
 * THE PART OF THE DATE THE RELATIVE WORD DOES NOT ALREADY CARRY.
 *
 * "FRI 2 OCT" beside "Friday, 2 October 2026" says Friday twice and the date twice. Where the heading
 * already names the weekday -- "Today", "Tomorrow", "Saturday" -- this gives the rest of it, so the two
 * together read as one date. Where the relative form IS the full date, it gives nothing and the heading
 * stands alone.
 */
export function restOfDate(iso: string, today: string): string {
  // A RELATIVE FORM THAT IS ALREADY A DATE NEEDS NOTHING AFTER IT. `relativeDate` returns a WORD only
  // inside the coming week -- "Today", "Tomorrow", "Saturday". Beyond that it returns a date of its
  // own, and following "FRI 2 OCT" with "Friday, 2 October 2026" says the same day twice.
  if (!isDayWord(relativeDate(iso, today))) return ""
  // Inside the week the word is the weekday, so the rest is the date without its weekday.
  return exactDate(iso).replace(/^[A-Za-z]+,\s*/, "")
}

/** True where the relative form is a word for a day rather than a date in its own right. */
function isDayWord(relative: string): boolean {
  return /^(Today|Tomorrow|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(relative)
}

/** The exact date, always reachable, for anybody who wants certainty rather than "Saturday". */
export function exactDate(iso: string): string {
  const date = parse(iso)
  return date ? date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : iso
}

/** The three parts of the little calendar block a fixture row carries. */
export function dateBlock(iso: string): { weekday: string; day: string; month: string } {
  const date = parse(iso)
  if (!date) return { weekday: "", day: iso, month: "" }
  return {
    weekday: date.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase(),
    day: date.toLocaleDateString("en-GB", { day: "numeric" }),
    month: date.toLocaleDateString("en-GB", { month: "short" }).toUpperCase(),
  }
}

/**
 * A DATE-ONLY VALUE, PARSED AS A LOCAL DAY.
 *
 * `new Date("2026-09-25")` is parsed as UTC MIDNIGHT by the specification, so west of Greenwich it is
 * the 24th and the fixture shows on the wrong day. Appending a time makes it local, which is what a
 * fixture date means: kick-off at half past ten is half past ten at the ground, not in UTC.
 */
function parse(iso: string): Date | null {
  const date = new Date(`${iso}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Whole days between two civil dates, counted on the DATES rather than on elapsed time.
 *
 * Elapsed-hours arithmetic is off by one twice a year: the clocks go forward and "tomorrow" becomes 23
 * hours away, which rounds to today. Both dates are read at midday, far from any transition, so the
 * difference is always a whole number of days whatever the clocks did in between.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = parse(fromIso)
  const to = parse(toIso)
  if (!from || !to) return 0
  return Math.round((to.getTime() - from.getTime()) / 86400000)
}

/**
 * THE GROUND'S NAME, WITHOUT ITS ADDRESS.
 *
 * A fixture at a ground Ovalball has a record of carries that ground's name. An AWAY fixture at a club
 * that is not on Ovalball carries a postal address instead, because that is the only thing the owning
 * club recorded -- and "Ovalball UAT Opposition RFC, Lightfoot Lane, Preston, PR4 0TA" is the right
 * thing to route a car to and the wrong thing to put in a list row, where it either wraps over three
 * lines or is truncated into meaninglessness.
 *
 * So a LIST shows the first segment, which is the ground. The full address stays exactly where it is
 * useful: on the Fixture Console, under WHERE, next to Directions.
 *
 * It is a split on the comma rather than anything cleverer, because the canonical shape is
 * "name, street, town, postcode" and guessing harder would start inventing a ground's name.
 */
export function shortVenue(venue: string | null): string | null {
  if (!venue) return null
  const first = venue.split(",")[0]?.trim()
  return first || null
}

/** "10:30", or nothing. A fixture with no kick-off time has none, and inventing one would be a lie. */
export function kickoffLabel(time: string | null): string | null {
  return time ? time.slice(0, 5) : null
}

/**
 * ONE SPOKEN SENTENCE FOR A WHOLE FIXTURE CARD.
 *
 * VoiceOver reads a card as a single label rather than as eight fragments, so the sentence has to
 * contain the same facts in the order somebody would say them: who, when, where, and what state it is
 * in. A card that makes sense when spoken is the test.
 */
export function spokenAgendaItem(item: AgendaItem, today: string): string {
  const parts: string[] = []
  if (item.childFirstName) parts.push(`${item.childFirstName}.`)
  // SPOKEN, THE PREPOSITION EARNS ITS PLACE -- there is no badge to read, so the sentence says it.
  parts.push(
    item.kind === "training"
      ? "Training"
      : `${item.homeAway === "Away" ? "Away to" : item.homeAway === "Home" ? "At home to" : "Against"} ${opponentFullName(item)}.`
  )
  if (item.kind === "training" && item.us.teamName) parts.push(`${item.us.teamName}.`)
  // ONE DATE, NOT TWO. "Fri 2 Oct, Friday, 2 October 2026" is the same day said twice, and a screen
  // reader reads every word of it. Inside the week the day word leads and the rest of the date
  // follows; beyond it the full date is said once, because that is the unambiguous form and there is
  // no shorter word for it.
  const relative = relativeDate(item.date, today)
  parts.push(
    isDayWord(relative)
      ? `${relative}, ${exactDate(item.date).replace(/^[A-Za-z]+,\s*/, "")}.`
      : `${exactDate(item.date)}.`
  )
  const time = kickoffLabel(item.time)
  if (time) parts.push(`Kick-off ${time}.`)
  if (item.venue) parts.push(`At ${item.venue}.`)
  const status = statusTone(item.status)
  if (status && status.tone !== "confirmed") parts.push(`${status.label}.`)
  if (item.result) parts.push(`Result ${item.result.ourScore} to ${item.result.theirScore}.`)
  return parts.join(" ")
}

/**
 * ONE DAY'S RUGBY, GROUPED.
 *
 * An agenda reads as days rather than as a flat list, because "Saturday" is the unit somebody plans in.
 * The loader already sorted; this only cuts the sorted run into days, so a group can never contain a
 * date that is not its own.
 */
export interface AgendaDay {
  date: string
  items: AgendaItem[]
}

export function groupByDay(items: AgendaItem[]): AgendaDay[] {
  const days: AgendaDay[] = []
  for (const item of items) {
    const last = days[days.length - 1]
    if (last && last.date === item.date) last.items.push(item)
    else days.push({ date: item.date, items: [item] })
  }
  return days
}
