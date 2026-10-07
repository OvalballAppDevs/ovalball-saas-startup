import type { CanonicalSeason } from "../data"
import type { TrainingPlanDraft } from "./draft-context"

/**
 * The pure decisions Dates & Frequency makes, pulled out of the screen component so they can be pinned
 * with fast unit tests (`dates-and-frequency-logic.test.mts`) that never touch React state or a live
 * database -- the same reasoning `data.ts`'s own `orderClubTeamsForDisplay`/`pickCurrentSeason` already
 * use in this codebase.
 */

/**
 * SEASON LONG derives from the canonical season's own `starts_on`/`ends_on`. PRE SEASON derives from
 * `pre_season_starts_on`/`ends_on` -- and returns null (never a guessed date) when the season has no
 * canonical pre-season boundary, matching `save_training_plan`'s own server-side NEEDS_ATTENTION
 * behaviour for exactly that gap rather than inventing a fallback here.
 */
export function deriveDefaultDates(planType: "SEASON" | "SEASON_PRE_SEASON" | null, season: CanonicalSeason | null): { startDate: string; endDate: string } | null {
  if (!season) return null
  if (planType === "SEASON") return { startDate: season.startsOn, endDate: season.endsOn }
  if (planType === "SEASON_PRE_SEASON" && season.preSeasonStartsOn) return { startDate: season.preSeasonStartsOn, endDate: season.endsOn }
  return null
}

/** ISO yyyy-mm-dd strings compare correctly with plain string comparison. */
export function validateDateOrder(startDate: string | null, endDate: string | null): string | null {
  if (startDate && endDate && startDate > endDate) return "Start Date cannot be after End Date."
  return null
}

export function canContinueDatesStep(draft: Pick<TrainingPlanDraft, "startDate" | "endDate" | "repeatWeekdays">): boolean {
  return draft.startDate !== null && draft.endDate !== null && draft.repeatWeekdays.length > 0 && validateDateOrder(draft.startDate, draft.endDate) === null
}
