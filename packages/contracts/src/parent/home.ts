import type { AgendaItem } from "../agenda/load"
import { availabilityQuestion } from "../availability/question"

import { ATTENDANCE_HORIZON_DAYS, daysBetween, needsAttendanceResponse } from "./agenda-model"

/**
 * WHAT A PARENT OPENS OVALBALL TO FIND OUT.
 *
 * Three questions, in the order they matter on a Friday night:
 *
 *   1. Is anything waiting on me?
 *   2. What is the next rugby thing?
 *   3. What else is on this week?
 *
 * All three are answered from ONE set of agenda rows -- the canonical family
 * agenda, already scoped by relationships the session proved. This module adds
 * no read, no query and no authority: it is array in, array out, and every
 * function here can only ever REMOVE from or reorder what it was handed.
 *
 * WHY IT LIVES IN THE SHARED PACKAGE. "Which event is next", "does this still
 * need an answer" and "what counts as this week" are product decisions, not
 * screen decisions. The website already answers the first two; putting the
 * answers here is what stops the phone growing a second opinion.
 */

/**
 * SOMETHING A PARENT CAN ACTUALLY DO SOMETHING ABOUT.
 *
 * Deliberately narrow. An unread message is not attention -- it already has a
 * badge in the header, and repeating it here would teach people that this panel
 * is a list of numbers rather than a list of jobs. Nor is a notification: read
 * is not resolved, and the domain state underneath is what decides.
 */
export type ParentAttentionKind =
  /**
   * A child has not yet said whether they can make a match or a session inside the
   * horizon.
   *
   * CURRENTLY THE ONLY ONE, and that is a finding rather than an omission. The
   * canonical platform has exactly one action-required state that belongs to a
   * Parent/Guardian:
   *
   *   FIXTURE REQUESTS are not shown to a family context at all -- the website's
   *   own dashboard skips the read rather than fetching data it would then hide.
   *
   *   A GUARDIAN LINK REQUEST looks like a parent's job and is not one:
   *   `internal.can_decide_guardian_link_request` requires
   *   `family.relationship.approve` at the CLUB, so the queue belongs to a Club
   *   Admin or Safeguarding Officer. Putting it on Parent Home would put a club
   *   safeguarding queue inside a parent's context -- and for somebody who holds
   *   both hats it would do so while they were wearing the wrong one.
   *
   *   PAYMENTS AND SUBSCRIPTIONS have no canonical family-facing
   *   action-required item to represent yet. Inventing one would be a fake
   *   payment state, which is worse than an absent panel.
   *
   * So a new kind is added here when the DOMAIN grows one, not when a screen
   * would like another row.
   */
  "availability"

export interface ParentAttention {
  key: string
  kind: ParentAttentionKind
  /** The one-line job, in the parent's words. */
  label: string
  /** The detail that makes it identifiable without opening it. */
  detail: string | null
  /** Whose rugby this is, where the item belongs to one child. */
  playerId: string | null
  /** The event this is about, so the row opens the thing itself rather than a list. */
  item: AgendaItem | null
  /**
   * Close enough that it is today's job rather than this fortnight's. Presentation
   * only -- an urgent item is not a different kind of item, and nothing is hidden
   * for being calm.
   */
  urgent: boolean
}

export interface ParentDay {
  /** YYYY-MM-DD, stable and sortable. */
  key: string
  /** "Today", "Tomorrow", then the weekday. Never a bare date for the days people think in words about. */
  label: string
  items: AgendaItem[]
}

export interface ParentHome {
  attention: ParentAttention[]
  /** The next thing that is actually happening. Null is an ordinary answer. */
  next: AgendaItem | null
  /** The rest of the current rugby week, grouped by day, with `next` left in place chronologically. */
  week: ParentDay[]
  /** How many of the week's rows are the same event as `next`, so a screen can play down the repeat. */
  nextIsInWeek: boolean
}

/** How soon an outstanding answer stops being "this fortnight" and becomes "now". */
export const URGENT_WITHIN_DAYS = 3

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

function weekdayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  // Midday, so no timezone reading of this date can land on the day before.
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]
}

/**
 * The words a parent uses for a day.
 *
 * Today and tomorrow get their names because that is how somebody talks about
 * them; the rest of the week gets its weekday, which is enough inside a
 * seven-day view and reads faster than a date. Anything beyond that carries the
 * date, because "Tuesday" two weeks out is ambiguous.
 */
export function dayLabel(iso: string, todayIso: string): string {
  const delta = daysBetween(todayIso, iso)
  if (delta === 0) return "Today"
  if (delta === 1) return "Tomorrow"
  if (delta > 1 && delta < 7) return weekdayOf(iso)
  if (delta === -1) return "Yesterday"
  const [, m, d] = iso.split("-").map(Number)
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${weekdayOf(iso)} ${d} ${months[m - 1]}`
}

/** Chronological, and within a day by time, then by child so two siblings always appear in the same order. */
export function sortAgenda(items: AgendaItem[]): AgendaItem[] {
  return [...items].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    const at = a.time ?? "99:99"
    const bt = b.time ?? "99:99"
    if (at !== bt) return at.localeCompare(bt)
    return (a.childFirstName ?? "").localeCompare(b.childFirstName ?? "")
  })
}

/**
 * THE NEXT THING THAT IS ACTUALLY HAPPENING.
 *
 * Not simply the first row. A cancelled match is still on the list -- it is the
 * reason somebody does NOT drive to a ground on Sunday, so it stays plainly
 * visible -- but it is not what anybody is getting ready for, so it does not take
 * the headline. Today still counts: a match at three this afternoon is the next
 * thing at ten this morning.
 */
export function nextEvent(items: AgendaItem[], todayIso: string): AgendaItem | null {
  return sortAgenda(items).find((item) => item.date >= todayIso && item.status !== "Cancelled") ?? null
}

/** Group into days, oldest first, dropping days with nothing in them rather than rendering an empty heading. */
export function groupByDay(items: AgendaItem[], todayIso: string): ParentDay[] {
  const byDay = new Map<string, AgendaItem[]>()
  for (const item of sortAgenda(items)) {
    const bucket = byDay.get(item.date)
    if (bucket) bucket.push(item)
    else byDay.set(item.date, [item])
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({ key, label: dayLabel(key, todayIso), items: list }))
}

/**
 * EVERY OUTSTANDING ANSWER, AS ITS OWN JOB.
 *
 * The website shows one aggregate ("3 attendance responses needed") because it
 * has a filtered agenda one click away to expand into. A phone does not: a row
 * that names the child and the match, and opens that match, is the difference
 * between being told there is work and being able to do it.
 *
 * The rule is `needsAttendanceResponse`, shared with the website's own count, so
 * the two cannot disagree about what is outstanding.
 */
export function attendanceAttention(
  items: AgendaItem[],
  todayIso: string,
  options: { viewerIsThePlayer?: boolean; horizonDays?: number } = {}
): ParentAttention[] {
  const horizonDays = options.horizonDays ?? ATTENDANCE_HORIZON_DAYS
  return sortAgenda(items)
    .filter((item) => needsAttendanceResponse(item, todayIso, horizonDays))
    .map((item) => ({
      key: `availability:${item.key}`,
      kind: "availability" as const,
      /*
        THE CANONICAL QUESTION, NOT A NEW ONE.

        `availabilityQuestion` is the sentence the Match Centre and the Training
        Centre already ask, on both clients -- "Can Pippa make it?" for a
        guardian, "Can you make it?" for an adult player answering for
        themselves, and "make training" rather than "make it" for a session. The
        attention row is the same question asked earlier, so it is the same
        sentence; inventing a second phrasing here is how a product starts
        sounding like two.
      */
      label: availabilityQuestion(item.kind, options.viewerIsThePlayer ?? false, item.childFirstName ?? ""),
      detail: eventDescription(item),
      playerId: item.playerId,
      item,
      urgent: daysBetween(todayIso, item.date) <= URGENT_WITHIN_DAYS,
    }))
}

/** A row in words: the match or the session, and where. */
export function eventDescription(item: AgendaItem): string | null {
  const when = item.time ? item.time.slice(0, 5) : null
  // Training has no opposition and must never be given a fake one, so it is
  // described by when and where -- which is what a parent is actually asking.
  if (item.kind === "training") return [when, item.venue].filter(Boolean).join(" · ") || null
  const opposition = item.them ? [item.them.clubName, item.them.teamName].filter(Boolean).join(" ") : null
  return [opposition ? `v ${opposition}` : null, item.homeAway === "Home" || item.homeAway === "Away" ? item.homeAway : null, when]
    .filter(Boolean)
    .join(" · ") || null
}

/**
 * ONE CHILD, OR ALL OF THEM.
 *
 * A NARROWING OVER ROWS THE READ ALREADY RETURNED, never a different read. The
 * family's rugby is loaded for the whole family and this removes from it, so there
 * is no query here for a selection to widen and an id that is not one of this
 * person's children simply matches nothing.
 *
 * `null` means every child, which is the honest default: a guardian's first
 * question is about their family, and narrowing is something they choose.
 *
 * The id reaching here has already been normalised against `FamilyProjection`, so
 * this is the second of two guards rather than the only one -- and it is the one
 * that holds even if the first were bypassed, because subtraction cannot add.
 */
export function narrowToChild(items: AgendaItem[], playerId: string | null): AgendaItem[] {
  if (!playerId) return items
  return items.filter((item) => item.playerId === playerId)
}

/**
 * THE WHOLE SCREEN, FROM ONE SET OF ROWS.
 *
 * `weekStartIso`/`weekEndIso` come from the canonical week window, so "this week"
 * means the same seven days on the phone as in the Calendar -- a rugby week
 * starting on Monday, because the fixture is on Saturday and the training that
 * prepares for it is on Tuesday.
 */
export function projectParentHome(
  items: AgendaItem[],
  options: {
    todayIso: string
    weekStartIso: string
    weekEndIso: string
    attentionHorizonDays?: number
    /**
     * True when the person reading is the player, rather than a guardian reading
     * about a child. It changes only the WORDS of the question -- "Can you make
     * it?" against "Can Pippa make it?" -- and nothing about what is shown or who
     * may answer, which the server decides.
     */
    viewerIsThePlayer?: boolean
  }
): ParentHome {
  const { todayIso, weekStartIso, weekEndIso } = options
  const next = nextEvent(items, todayIso)
  const thisWeek = items.filter(
    (item) => item.date >= weekStartIso && item.date <= weekEndIso && item.date >= todayIso
  )
  return {
    attention: [
      ...attendanceAttention(items, todayIso, {
        viewerIsThePlayer: options.viewerIsThePlayer,
        horizonDays: options.attentionHorizonDays,
      }),
    ],
    next,
    week: groupByDay(thisWeek, todayIso),
    nextIsInWeek: next !== null && thisWeek.some((item) => item.key === next.key),
  }
}
