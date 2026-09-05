/**
 * Canonical Season date-boundary rules -- shared by the client form (fast
 * feedback) and createSeason() (the real, authoritative boundary; UI
 * constraints alone are never trusted). Deliberately does NOT touch
 * `seasons.season_year_end` (a DB `generated always as (season_year_start
 * + 1) stored` column, applied uniformly regardless of rugby_code) --
 * no consumer anywhere reads that column today (confirmed by search), and
 * the consolidation brief that produced this file explicitly asked for
 * any Rugby-League-specific year-model question to be REPORTED rather
 * than silently resolved by changing the data model. See the final report
 * for that disclosure; this file only adds validation on top of the
 * existing schema, never a schema change.
 *
 * Ordering, every code: preseason_start < main_season_start <=
 * main_season_end (Section I). Pre-Season End is never its own stored
 * field -- it's derived as "the day before Main Season Start" wherever
 * displayed (Section S); main_season_start is the one source of truth for
 * that transition.
 *
 * Year-window, per rugby_code -- this IS a real design decision, made
 * explicitly rather than silently, because Union and League genuinely
 * don't share one shape:
 *   - Union: a genuine cross-year season (compute_season_identity's own
 *     naming already proves this -- "Rugby Union 26/27"). Pre-Season Start
 *     and Main Season Start must both fall within calendar year
 *     `season_year_start`; Main Season End must fall no later than 31 Dec
 *     of `season_year_start + 1`.
 *   - League: compute_season_identity already names a League season with
 *     a SINGLE year ("Rugby League 2026", never "26/27") -- the real-world
 *     competition (per the product's own stated default, roughly March
 *     through October) sits entirely inside one calendar year. Main Season
 *     Start and Main Season End must both fall within `season_year_start`
 *     itself. Pre-Season Start is allowed to fall in EITHER
 *     `season_year_start - 1` (a pre-season starting the preceding
 *     November, per the product's own stated default) or
 *     `season_year_start` -- never later. This is the one place League's
 *     window is deliberately WIDER than a strict single-year box, and it
 *     is documented here precisely so it's a decision, not a guess.
 */

export type RugbyCode = "union" | "league"

export interface SeasonDateInput {
  rugbyCode: RugbyCode
  seasonYearStart: number
  preSeasonStartsOn: string | null // ISO yyyy-mm-dd
  startsOn: string // ISO yyyy-mm-dd -- main season start
  endsOn: string // ISO yyyy-mm-dd -- main season end
}

function yearOf(iso: string): number {
  return Number(iso.slice(0, 4))
}

/** Returns the first validation error found, or null if the input is fully valid. Checks are ordered so the earliest, most fundamental problem is reported first. */
export function validateSeasonDates(input: SeasonDateInput): string | null {
  const { rugbyCode, seasonYearStart, preSeasonStartsOn, startsOn, endsOn } = input

  if (!Number.isInteger(seasonYearStart) || seasonYearStart < 2000 || seasonYearStart > 2200) {
    return "Season starting year must be a whole number between 2000 and 2200."
  }
  if (!startsOn || !endsOn) {
    return "Main season start and end dates are required."
  }

  // Ordering (Section I): preseason_start < main_season_start <= main_season_end.
  if (preSeasonStartsOn && preSeasonStartsOn >= startsOn) {
    return "Pre-season start must be before the main season start."
  }
  if (startsOn > endsOn) {
    return "Main season start must be on or before the main season end."
  }
  if (startsOn === endsOn) {
    return "Main season end must be after the main season start, not the same day."
  }

  if (rugbyCode === "union") {
    if (preSeasonStartsOn && yearOf(preSeasonStartsOn) !== seasonYearStart) {
      return `Pre-season start must fall within ${seasonYearStart} for a ${seasonYearStart}/${(seasonYearStart + 1) % 100} Rugby Union season.`
    }
    if (yearOf(startsOn) !== seasonYearStart) {
      return `Main season start must fall within ${seasonYearStart} for a ${seasonYearStart}/${(seasonYearStart + 1) % 100} Rugby Union season.`
    }
    const maxEnd = `${seasonYearStart + 1}-12-31`
    if (endsOn > maxEnd) {
      return `Main season end must be on or before 31 December ${seasonYearStart + 1}.`
    }
  } else {
    // league -- a single-calendar-year main season (Section N); pre-season
    // may reach back into the preceding November per the product default.
    if (preSeasonStartsOn) {
      const preYear = yearOf(preSeasonStartsOn)
      if (preYear !== seasonYearStart && preYear !== seasonYearStart - 1) {
        return `Pre-season start must fall within ${seasonYearStart - 1} or ${seasonYearStart} for a ${seasonYearStart} Rugby League season.`
      }
    }
    if (yearOf(startsOn) !== seasonYearStart) {
      return `Main season start must fall within ${seasonYearStart} for a ${seasonYearStart} Rugby League season.`
    }
    if (yearOf(endsOn) !== seasonYearStart) {
      return `Main season end must fall within ${seasonYearStart} for a ${seasonYearStart} Rugby League season.`
    }
  }

  return null
}

/** Deterministic starting-year options for the Season dropdown (Section H/Q) -- generated from a safe range, never a stored `season_year_options` lookup table. */
export function seasonYearStartOptions(aroundYear: number, span = 5): number[] {
  const years: number[] = []
  for (let y = aroundYear - 1; y < aroundYear + span; y++) years.push(y)
  return years
}

export function seasonYearLabel(rugbyCode: RugbyCode, seasonYearStart: number): string {
  if (rugbyCode === "union") return `${seasonYearStart}/${(seasonYearStart + 1) % 100}`
  return String(seasonYearStart)
}
