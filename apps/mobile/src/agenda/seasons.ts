import type { SupabaseClient } from "@supabase/supabase-js"
import {
  effectivePhaseRange,
  resolveDefaultPhase,
  resolveDefaultSeason,
  selectSeasonForCode,
  type Database,
  type EffectiveRange,
  type SeasonPhase,
  type SeasonRow,
} from "@ovalball/contracts"

/**
 * WHICH SEASON AM I LOOKING AT.
 *
 * EVERY SEASON DATE COMES FROM THE CANONICAL REGISTER. `public.seasons` is the one authority for when a
 * season starts, when pre-season starts and when it ends, and there is deliberately no second answer:
 * nothing here computes a season from a date, derives a year, or assumes a cut-off month. A club whose
 * season the register does not describe gets no season window rather than an invented one.
 *
 * THE RESOLVERS ARE THE WEBSITE'S OWN, now in the shared package, so the mobile Calendar and the
 * browser Calendar cannot disagree about which season today falls in -- which they would, the first
 * time a club's pre-season was configured to start in July.
 *
 * CODE-BOUND, NOT MERELY CODE-AWARE. The register holds both rugby codes, and a Union club must never
 * be shown a League season: `selectSeasonForCode` restricts the lookup to the viewer's own code, so a
 * League season id cannot be honoured on a Union calendar. This was a real defect on the web -- a
 * viewer with no code resolved to whichever season merely contained today's date.
 *
 * REGRESSION FIXTURES ARE NOT SEASONS. `is_regression_fixture` rows are SQL test scaffolding and are
 * excluded here exactly as every other season selector excludes them.
 */

export interface SeasonContext {
  /** Every real season for the viewer's own rugby code, oldest first. */
  seasons: SeasonRow[]
  selected: SeasonRow | null
  phase: SeasonPhase
  /** The dates the selected season and phase actually cover, or null where the register cannot say. */
  range: EffectiveRange | null
  /** True where the register describes a phase that should have a window and does not. Fail closed. */
  configBroken: boolean
}

export async function loadSeasons(
  supabase: SupabaseClient<Database>,
  rugbyCode: string | null
): Promise<SeasonRow[]> {
  const { data } = await supabase
    .from("seasons")
    .select("id, name, season_ref, rugby_code, pre_season_starts_on, starts_on, ends_on")
    .eq("is_regression_fixture", false)
    .order("starts_on", { ascending: true })

  const all: SeasonRow[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    seasonRef: row.season_ref,
    rugbyCode: row.rugby_code,
    preSeasonStartsOn: row.pre_season_starts_on,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
  }))
  return rugbyCode ? all.filter((season) => season.rugbyCode === rugbyCode) : all
}

/**
 * The season and phase to open on, and the dates they cover.
 *
 * `selectedId` is a preference somebody expressed by choosing from the list, so it can only ever pick a
 * season already in that list -- it cannot widen anything.
 */
export function resolveSeason(
  seasons: SeasonRow[],
  rugbyCode: string | null,
  todayIso: string,
  selectedId: string | null,
  phase: SeasonPhase | null
): SeasonContext {
  const selected = selectSeasonForCode(seasons, rugbyCode, selectedId ?? undefined, todayIso) ?? resolveDefaultSeason(seasons, rugbyCode, todayIso)
  if (!selected) return { seasons, selected: null, phase: "main", range: null, configBroken: false }

  // PRE-SEASON IS ONLY A PHASE WHERE THE REGISTER SAYS SO. A club with no pre-season start recorded
  // has no pre-season, and offering one would be inventing a window.
  const resolvedPhase: SeasonPhase = phase === "pre" && selected.preSeasonStartsOn ? "pre" : phase === "main" ? "main" : resolveDefaultPhase(selected, todayIso)
  const range = effectivePhaseRange(selected, resolvedPhase)
  const shouldHaveRange = resolvedPhase === "main" || Boolean(selected.preSeasonStartsOn)

  return {
    seasons,
    selected,
    phase: resolvedPhase,
    range,
    // A BROKEN REGISTER FAILS CLOSED. If the dates a season declares do not make a window, the answer is
    // "we cannot say", never an unbounded range that would quietly show every fixture ever scheduled.
    configBroken: shouldHaveRange && !range,
  }
}

/** Our own club's rugby code, which bounds which seasons are even shown. */
export async function clubRugbyCode(supabase: SupabaseClient<Database>, clubId: string | null): Promise<string | null> {
  if (!clubId) return null
  const { data } = await supabase.from("clubs").select("club_directory(rugby_code)").eq("id", clubId).maybeSingle()
  return data?.club_directory?.rugby_code ?? null
}

/** "2026/27 season" — the register's own name, never a label assembled from dates. */
export function seasonLabel(season: SeasonRow | null): string {
  return season?.name ?? "Season"
}

export type { SeasonPhase, SeasonRow, EffectiveRange }
