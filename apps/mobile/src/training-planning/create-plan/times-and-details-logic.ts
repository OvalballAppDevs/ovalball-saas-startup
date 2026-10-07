/**
 * THE PURE TIME ARITHMETIC for Times & Details (Page 5) -- pulled out so "Start + Duration -> End"
 * and "Start + End -> Duration" can be pinned with fast unit tests, the same reasoning every other
 * pure-logic file in this folder already uses.
 *
 * CANONICAL STORAGE IS (start_time, duration_minutes) -- confirmed by reading the actual schema
 * (`training_plan_schedule_rules.start_time`/`duration_minutes`, `training_sessions.start_time`/
 * `duration_minutes`, and `override_training_session`'s own parameters). There is no independently
 * stored end_time anywhere upstream of `training_sessions` -- the database itself always derives
 * end_time as `start_time + make_interval(mins => duration_minutes)`. This module mirrors that exact
 * arithmetic so the draft never disagrees with what the server will compute.
 *
 * OVERNIGHT IS NOT SUPPORTED. Nothing in the schema (`duration_minutes between 15 and 240`, always a
 * same-day `time` column) anticipates a session crossing midnight, so an End Time at or before Start
 * Time is rejected rather than wrapped to the next day.
 */

/** 24-hour "HH:MM". */
export type TimeOfDay = string

export function addMinutesToTime(time: TimeOfDay, minutes: number): TimeOfDay {
  const [h, m] = time.split(":").map(Number)
  const total = h * 60 + m + minutes
  const hh = Math.floor(total / 60)
  const mm = total % 60
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`
}

/** End minus start, in minutes. Negative or zero means "not a valid same-day session". */
export function minutesBetween(start: TimeOfDay, end: TimeOfDay): number {
  const [sh, sm] = start.split(":").map(Number)
  const [eh, em] = end.split(":").map(Number)
  return eh * 60 + em - (sh * 60 + sm)
}

export function deriveEndTime(startTime: TimeOfDay, durationMinutes: number): TimeOfDay {
  return addMinutesToTime(startTime, durationMinutes)
}

/** null means valid. Matches `training_plan_schedule_rules_duration_minutes_check` (15-240). */
export function validateTimeRange(startTime: TimeOfDay, endTime: TimeOfDay): string | null {
  const diff = minutesBetween(startTime, endTime)
  if (diff <= 0) return "End Time must be after Start Time."
  if (diff < 15) return "A training session must be at least 15 minutes long."
  if (diff > 240) return "A training session cannot be longer than 4 hours."
  return null
}

export interface DurationOption {
  minutes: number
  label: string
}

/** Sensible rugby-training lengths within the schema's own 15-240 minute range -- there is no
 * canonical duration list anywhere in the codebase to read instead (checked `pitch-allocation` and
 * `club/venues` contracts), so this is a plain, documented UI choice. */
export const DURATION_OPTIONS: DurationOption[] = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 45, label: "45 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 75, label: "1 hour 15 minutes" },
  { minutes: 90, label: "1 hour 30 minutes" },
  { minutes: 105, label: "1 hour 45 minutes" },
  { minutes: 120, label: "2 hours" },
]

export interface BufferOption {
  minutes: number
  label: string
}

/** Same 5-minute-increment vocabulary the club-wide Pitch Allocation buffer settings already use
 * (`club_scheduling_policy.warm_up_minutes`/`pack_up_minutes`, `pitch-allocation/settings.tsx`'s own
 * Stepper), even though -- see the Page 5 report -- there is no per-plan column these write to yet. */
export const BUFFER_OPTIONS: BufferOption[] = [
  { minutes: 0, label: "None" },
  { minutes: 5, label: "5 minutes" },
  { minutes: 10, label: "10 minutes" },
  { minutes: 15, label: "15 minutes" },
  { minutes: 20, label: "20 minutes" },
  { minutes: 30, label: "30 minutes" },
]

export function durationLabel(minutes: number): string {
  return DURATION_OPTIONS.find((o) => o.minutes === minutes)?.label ?? `${minutes} minutes`
}

export function bufferLabel(minutes: number): string {
  return BUFFER_OPTIONS.find((o) => o.minutes === minutes)?.label ?? `${minutes} minutes`
}

export function canContinueTimesStep(draft: { startTime: TimeOfDay | null; durationMinutes: number | null }): boolean {
  if (!draft.startTime || draft.durationMinutes === null) return false
  const end = deriveEndTime(draft.startTime, draft.durationMinutes)
  return validateTimeRange(draft.startTime, end) === null
}
