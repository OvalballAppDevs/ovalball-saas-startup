import type { TrainingPlanDraft } from "./draft-context"

/**
 * THE DRAFT -> save_training_plan PAYLOAD MAPPING, pulled out as a pure function so it can be pinned
 * with fast unit tests never touching a live database or React state -- the same reasoning every other
 * pure-logic file in this folder already uses.
 *
 * Deliberately produces the EXACT shape `save_training_plan` expects (confirmed by reading its live
 * definition, `20270584000000_a_training_plan_keeps_its_own_buffers_and_notes.sql`): one schedule rule
 * per selected weekday, all sharing the same start_time/duration_minutes -- the wizard has never offered
 * a per-weekday time, so this is a faithful mapping of what Page 3 actually captured, not a new
 * simplification introduced here. `starts_on`/`ends_on` are omitted per rule because this wizard only
 * ever produces SEASON or SEASON_PRE_SEASON plans (never CUSTOM) -- their effective date range is
 * resolved dynamically from the season server-side, exactly as the schema intends, so a season-date
 * correction is picked up automatically rather than needing every plan re-saved.
 */
export interface SaveTrainingPlanArgs {
  p_plan_id: string | null
  p_club_id: string
  p_team_id: string
  p_schedule_mode: "SEASON" | "SEASON_PRE_SEASON"
  p_season_id: string
  p_preferred_venue_id: string
  p_preferred_pitch_id: string
  p_rules: { weekday: number; start_time: string; duration_minutes: number }[]
  p_warm_up_minutes: number
  p_pack_up_minutes: number
  p_default_session_notes: string | null
  /** The team's "Needs a changing room" for every session of the plan. */
  p_needs_changing_room: boolean
}

/** null means the draft is genuinely incomplete -- Create Plan must stay disabled, never submit a partial payload. */
export function draftToSavePlanArgs(clubId: string, draft: TrainingPlanDraft): SaveTrainingPlanArgs | null {
  if (!draft.team || !draft.planType || !draft.season || !draft.venue || !draft.pitch) return null
  if (!draft.startTime || draft.durationMinutes === null) return null
  if (draft.repeatWeekdays.length === 0) return null

  return {
    p_plan_id: null,
    p_club_id: clubId,
    p_team_id: draft.team.teamId,
    p_schedule_mode: draft.planType,
    p_season_id: draft.season.id,
    p_preferred_venue_id: draft.venue.id,
    p_preferred_pitch_id: draft.pitch.id,
    p_rules: [...draft.repeatWeekdays]
      .sort((a, b) => a - b)
      .map((weekday) => ({ weekday, start_time: draft.startTime as string, duration_minutes: draft.durationMinutes as number })),
    p_warm_up_minutes: draft.warmUpMinutes,
    p_pack_up_minutes: draft.coolDownMinutes,
    p_default_session_notes: draft.notes.trim() || null,
    p_needs_changing_room: draft.needsChangingRoom,
  }
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** "Monday, Wednesday" -- Monday-first for display, matching the Repeat chips on Page 3, even though
 * the stored order is whatever `draftToSavePlanArgs` sorted (Sunday-first, Postgres's own numbering). */
export function repeatWeekdaysLabel(weekdays: readonly number[]): string {
  const mondayFirst = [1, 2, 3, 4, 5, 6, 0]
  return mondayFirst
    .filter((w) => weekdays.includes(w))
    .map((w) => WEEKDAY_NAMES[w])
    .join(", ")
}
