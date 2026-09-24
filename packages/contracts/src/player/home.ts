import type { AgendaItem } from "../agenda/load"
import { ATTENDANCE_HORIZON_DAYS, daysBetween, needsAttendanceResponse } from "../parent/agenda-model"
import { sortAgenda } from "../parent/home"

/**
 * PLAYER HOME -- a player's own week, in the order a player asks (CA-M9).
 *
 *   what have I got next, and where do I need to be
 *   what am I still to answer
 *   what happened last time
 *
 * Array in, projection out: the same agenda the Calendar reads, narrowed by the server to the player's
 * own sides. A player context is never a stripped parent screen -- it is their own rugby workspace --
 * and it is never a staff screen: nothing here decides what a player may change. Availability is
 * offered by the Match Centre, which asks the server per event.
 */
export interface PlayerAvailabilityRow {
  item: AgendaItem
  attendance: AgendaItem["attendance"]
  /** Still to answer, by the one canonical rule. */
  outstanding: boolean
  /** Close enough to be today's job. */
  urgent: boolean
}

export interface PlayerHome {
  /** The next thing that is on. */
  next: AgendaItem | null
  /** Up to `PLAYER_UPCOMING_LIMIT` events after `next`, so the week is visible at a glance. */
  upcoming: AgendaItem[]
  /** Every event inside the fortnight, with the player's answer beside it. */
  availability: PlayerAvailabilityRow[]
  outstandingCount: number
  /** The most recent match with a score. */
  lastResult: AgendaItem | null
}

export const PLAYER_UPCOMING_LIMIT = 4
export const PLAYER_URGENT_WITHIN_DAYS = 3

export function projectPlayerHome(items: AgendaItem[], todayIso: string, horizonDays = ATTENDANCE_HORIZON_DAYS): PlayerHome {
  const sorted = sortAgenda(items)
  const on = sorted.filter((i) => i.status !== "Cancelled")
  const future = on.filter((i) => i.date >= todayIso)
  const next = future[0] ?? null
  const upcoming = future.slice(1, 1 + PLAYER_UPCOMING_LIMIT)
  const availability = future
    .filter((i) => daysBetween(todayIso, i.date) <= horizonDays)
    .map((item) => ({
      item,
      attendance: item.attendance,
      outstanding: needsAttendanceResponse(item, todayIso, horizonDays),
      urgent: daysBetween(todayIso, item.date) <= PLAYER_URGENT_WITHIN_DAYS,
    }))
  const played = sorted.filter((i) => i.kind === "fixture" && i.result !== null && i.date <= todayIso)
  return {
    next,
    upcoming,
    availability,
    outstandingCount: availability.filter((r) => r.outstanding).length,
    lastResult: played[played.length - 1] ?? null,
  }
}
