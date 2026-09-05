import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { clampIsoToRange, effectivePhaseRange, resolveDefaultPhase, resolveDefaultSeason, type EffectiveRange, type SeasonPhase, type SeasonRow } from "./season-window"

export interface CalendarSeasonContext {
  allSeasons: SeasonRow[]
  rugbyCodeSeasons: SeasonRow[]
  selectedSeason: SeasonRow | null
  defaultSeason: SeasonRow | null
  selectedPhase: SeasonPhase
  defaultPhase: SeasonPhase
  range: EffectiveRange | null
  /** True when the season config itself is broken (violates canonical ordering) for a phase that should have a real window -- callers must fail closed, never fall back to an unbounded range. */
  seasonConfigBroken: boolean
  /** True when the viewer explicitly switched season or phase away from today's own -- callers use this to decide whether to anchor a view on the period's start date vs. on today. */
  isExplicitPeriodSwitch: boolean
  prevSeason: SeasonRow | null
  nextSeason: SeasonRow | null
  todayIso: string
}

/**
 * The one season/phase resolver Week, Month, AND Agenda all call --
 * Master Architecture Pass reconciliation ("Agenda must inherit Calendar's
 * season_id/phase/team-filters, using the same shared resolver, never its
 * own overall-season-range fallback"). Reads the canonical `seasons` table
 * once and derives selectedSeason/selectedPhase/range identically for
 * every view, so switching Week -> Month -> Agenda never silently resets
 * or reinterprets which season/phase window is active.
 */
export async function resolveCalendarSeasonContext(
  supabase: SupabaseClient<Database>,
  clubRugbyCode: string | null,
  seasonParam: string | undefined,
  phaseParam: string | undefined
): Promise<CalendarSeasonContext> {
  // is_regression_fixture rows (SQL-regression-test scaffolding, never a
  // real product season -- see 20260906000000_structured_season_identity)
  // are excluded here exactly as app/(app)/admin/competitions/page.tsx
  // already does for its own season dropdown -- Calendar's season
  // selector/prev-next navigation must never surface synthetic test
  // seasons to a real user, regardless of what dates a regression fixture
  // happens to be configured with.
  const { data: seasonRows } = await supabase
    .from("seasons")
    .select("id, name, season_ref, rugby_code, pre_season_starts_on, starts_on, ends_on")
    .eq("is_regression_fixture", false)
    .order("starts_on", { ascending: true })
  const allSeasons: SeasonRow[] = (seasonRows ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    seasonRef: s.season_ref,
    rugbyCode: s.rugby_code,
    preSeasonStartsOn: s.pre_season_starts_on,
    startsOn: s.starts_on,
    endsOn: s.ends_on,
  }))

  const now = new Date()
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`

  const defaultSeason = resolveDefaultSeason(allSeasons, clubRugbyCode, todayIso)
  const selectedSeason = seasonParam ? (allSeasons.find((s) => s.id === seasonParam) ?? defaultSeason) : defaultSeason
  const defaultPhase = selectedSeason ? resolveDefaultPhase(selectedSeason, todayIso) : "main"
  // A client-crafted ?phase=pre for a season with no configured Pre-Season
  // falls back to the safe default rather than operating against a null
  // range -- "pre" is never a real, selectable phase unless the season
  // actually has one.
  const selectedPhase: SeasonPhase = phaseParam === "pre" && selectedSeason?.preSeasonStartsOn ? "pre" : phaseParam === "main" ? "main" : defaultPhase
  const range = selectedSeason ? effectivePhaseRange(selectedSeason, selectedPhase) : null
  const phaseShouldHaveRange = Boolean(selectedSeason) && (selectedPhase === "main" || Boolean(selectedSeason?.preSeasonStartsOn))
  const seasonConfigBroken = phaseShouldHaveRange && !range
  const isExplicitPeriodSwitch = Boolean(selectedSeason) && (selectedSeason?.id !== defaultSeason?.id || selectedPhase !== defaultPhase)

  const rugbyCodeSeasons = clubRugbyCode ? allSeasons.filter((s) => s.rugbyCode === clubRugbyCode) : allSeasons
  const seasonIndex = selectedSeason ? rugbyCodeSeasons.findIndex((s) => s.id === selectedSeason.id) : -1
  const prevSeason = seasonIndex > 0 ? rugbyCodeSeasons[seasonIndex - 1] : null
  const nextSeason = seasonIndex >= 0 && seasonIndex < rugbyCodeSeasons.length - 1 ? rugbyCodeSeasons[seasonIndex + 1] : null

  return {
    allSeasons,
    rugbyCodeSeasons,
    selectedSeason,
    defaultSeason,
    selectedPhase,
    defaultPhase,
    range,
    seasonConfigBroken,
    isExplicitPeriodSwitch,
    prevSeason,
    nextSeason,
    todayIso,
  }
}

/** yyyy-mm-dd local-date clamp helper for anchors derived from this context -- re-exported so callers don't need a second import from season-window.ts just for this one call. */
export { clampIsoToRange }
