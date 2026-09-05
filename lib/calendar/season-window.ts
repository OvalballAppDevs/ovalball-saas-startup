export interface SeasonRow {
  id: string
  name: string
  seasonRef: string
  rugbyCode: string | null
  preSeasonStartsOn: string | null
  startsOn: string
  endsOn: string
}

export type SeasonPhase = "pre" | "main"

export interface EffectiveRange {
  start: string
  end: string
}


/** The season (of the given rugby code) that contains today, or the nearest upcoming one, or else the most recent past one. */
export function resolveDefaultSeason(seasons: SeasonRow[], rugbyCode: string | null, todayIso: string): SeasonRow | null {
  const matching = rugbyCode ? seasons.filter((s) => s.rugbyCode === rugbyCode) : seasons
  if (matching.length === 0) return null

  const current = matching.find((s) => (s.preSeasonStartsOn ?? s.startsOn) <= todayIso && todayIso <= s.endsOn)
  if (current) return current

  const upcoming = matching.filter((s) => s.startsOn > todayIso).sort((a, b) => a.startsOn.localeCompare(b.startsOn))
  if (upcoming.length > 0) return upcoming[0]

  return [...matching].sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0] ?? null
}

export function resolveDefaultPhase(season: SeasonRow, todayIso: string): SeasonPhase {
  if (season.preSeasonStartsOn && todayIso >= season.preSeasonStartsOn && todayIso < season.startsOn) return "pre"
  return "main"
}

/** yyyy-mm-dd arithmetic done via local-midnight Date construction, matching this codebase's established convention (never .toISOString(), which silently shifts a day for any viewer west of UTC). */
function isoAddDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/**
 * PRE-SEASON / MAIN-SEASON date-boundary addendum. The one shared resolver
 * for "which dates may the Calendar (or a mutating action) legitimately
 * operate on, given this season and this phase" -- Month, Week, Agenda,
 * and every date-bounded control all call this, never a locally
 * reinvented copy (Section 6/13 of the addendum brief). Both ends are
 * INCLUSIVE. Pre-Season has no stored end date of its own -- it is always
 * derived as the day before Main Season Start (`seasons` has no
 * `preseason_end` column; `lib/seasons/validation.ts`'s own canonical
 * ordering rule, `preseason_start < main_season_start <= main_season_end`,
 * already documents this as the intended derivation, not a Calendar-local
 * guess). Fails closed (returns null) when the season has no configured
 * window for that phase, or when its dates violate that canonical
 * ordering -- never falls back to an unbounded range.
 */
export function effectivePhaseRange(season: SeasonRow, phase: SeasonPhase): EffectiveRange | null {
  if (phase === "pre") {
    if (!season.preSeasonStartsOn) return null
    if (season.preSeasonStartsOn >= season.startsOn) return null
    return { start: season.preSeasonStartsOn, end: isoAddDays(season.startsOn, -1) }
  }
  if (!season.startsOn || !season.endsOn || season.startsOn > season.endsOn) return null
  return { start: season.startsOn, end: season.endsOn }
}

/** Pre-Season-through-Main-Season-End, ignoring the pre/main split -- used where a control (e.g. a mutating action's server-side validation) needs "is this date genuinely within this season at all", not "within this exact phase". Agenda does NOT use this for its own display range -- it shares Week/Month's effectivePhaseRange(selectedSeason, selectedPhase) via resolveCalendarSeasonContext() so all three views agree on the same bounded window. */
export function overallSeasonRange(season: SeasonRow): EffectiveRange | null {
  const start = season.preSeasonStartsOn ?? season.startsOn
  if (!start || !season.endsOn || start > season.endsOn) return null
  return { start, end: season.endsOn }
}

export function isIsoInRange(iso: string, range: EffectiveRange): boolean {
  return iso >= range.start && iso <= range.end
}

export function clampIsoToRange(iso: string, range: EffectiveRange): string {
  if (iso < range.start) return range.start
  if (iso > range.end) return range.end
  return iso
}

/** True if `dateIso` falls within ANY of the given seasons' overall (pre-through-main) window -- used by server-side mutation validation to reject a date that belongs to no configured season at all, without being tied to one specific season_id the client may not have passed. */
export function dateWithinAnySeason(seasons: SeasonRow[], dateIso: string): boolean {
  return seasons.some((s) => {
    const r = overallSeasonRange(s)
    return r ? isIsoInRange(dateIso, r) : false
  })
}
