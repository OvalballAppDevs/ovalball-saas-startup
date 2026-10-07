import type { TrainingPlanDetailRule, TrainingPlanUpcomingSession } from "./data"

/**
 * PLAN DETAIL's pure decisions, pulled out for fast unit tests -- the same reasoning every other
 * pure-logic file in Training Planning already uses.
 */

/** A session is "past" once its date is strictly before today -- the same boundary
 * `save_training_plan`'s own reconciliation uses (`occurrence_date >= current_date` is "future"). */
export function isSessionPast(occurrenceDate: string, todayIso: string): boolean {
  return occurrenceDate < todayIso
}

/** Chronological order, earliest first -- what the Sessions tab and "Next Session" both need. Pulled
 * out so the ordering can be pinned without a live database, even though the canonical loader
 * (`loadTrainingPlanDetail`) already asks Postgres to sort this way. */
export function sortSessionsByDate<T extends { occurrenceDate: string }>(sessions: readonly T[]): T[] {
  return [...sessions].sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate))
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** "Mon 5 Oct 2026, 18:00" -- the compact session-row label the Sessions tab and Plan Detail's own
 * "Next Session" card both use, built from the rule's own weekday numbering (0=Sunday, matching
 * `training_plan_schedule_rules.weekday`/Postgres `extract(dow from ...)`). */
export function sessionRowLabel(occurrenceDate: string): string {
  const weekday = WEEKDAY_SHORT[new Date(`${occurrenceDate}T12:00:00`).getDay()]
  const [, month, day] = occurrenceDate.split("-")
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${weekday} ${Number(day)} ${monthNames[Number(month) - 1]}`
}

/** Whether a rule set includes a genuinely different time on two different weekdays -- Plan Detail's
 * "Default Session Time" is only unambiguous to show as one line when every rule agrees. */
export function rulesShareOneTime(rules: readonly TrainingPlanDetailRule[]): boolean {
  if (rules.length <= 1) return true
  const first = `${rules[0].startTime}-${rules[0].durationMinutes}`
  return rules.every((r) => `${r.startTime}-${r.durationMinutes}` === first)
}

/** "70 sessions" / "1 session" -- the Overview tab's own upcoming count, computed from the SAME
 * canonical list Sessions tab renders, never a separately-fetched number that could disagree. */
export function upcomingCountLabel(sessions: readonly TrainingPlanUpcomingSession[]): string {
  return `${sessions.length} session${sessions.length === 1 ? "" : "s"}`
}

export type SessionDisplayStatus = "upcoming" | "completed" | "cancelled"

/** The Sessions tab's own three-way read of a row -- CANCELLED always wins regardless of date (a
 * cancelled occurrence stays "Cancelled" whether it was cancelled before or after it happened), and
 * everything else falls back to the same past/future boundary `isSessionPast` already uses. This is
 * presentation only: it never writes back to `training_sessions.status`, which stays the canonical
 * PLANNED/CANCELLED lifecycle. */
export function sessionDisplayStatus(occurrenceDate: string, status: string, todayIso: string): SessionDisplayStatus {
  if (status === "CANCELLED") return "cancelled"
  return isSessionPast(occurrenceDate, todayIso) ? "completed" : "upcoming"
}
