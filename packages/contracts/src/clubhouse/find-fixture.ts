import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { mapCompatibleTeams, type CompatibleTeam } from "./club-detail"
import {
  applyClubhouseDistanceFilter,
  applyClubhouseFilter,
  distanceMiles,
  findDistanceOrigin,
  readClubhouseMarkers,
  type ClubhouseDistanceFilter,
  type ClubMapMarker,
} from "./map-read-model"

type Client = SupabaseClient<Database>

/**
 * CLUBHOUSE PROGRAMME SECTION 6 -- FIND A FIXTURE.
 *
 * Answers exactly one question -- "who could we play?" -- through the SAME canonical primitives every
 * other Clubhouse surface already uses: `readClubhouseMarkers` for identity/location/partnership (one
 * shared population, never a second directory query), `find_fixture_candidate_teams` for compatibility
 * (the same `internal.identities_can_play_fixture` rule `compatible_opponent_teams` already enforces,
 * batched across the whole network instead of one club at a time), and `applyClubhouseDistanceFilter`/
 * `findDistanceOrigin` for distance (unchanged, Section 2's own factual-origin-only rule).
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO: decide availability (Section 7 -- "AVAILABLE" is a factual
 * scheduling claim this module has no data to back), mutate a fixture request (Section 8/9's
 * `createFixtureRequest` remains the one place that happens), or compute a subjective match score
 * (ranking here is always a stated, factual field -- partner status, distance, name -- never an opaque
 * number).
 */

export type FindFixtureVenuePreference = "home" | "away" | "either"

/**
 * THE FULL UI-LEVEL SEARCH INTENT -- FF-1's own shared search-session model (mock-up reconciliation,
 * "Find a Fixture" as a flagship product, not a utility screen). Transient presentation/workflow state
 * only, never a second source of authority: every field here still passes through the exact same
 * canonical reads and RLS-gated RPCs it always did.
 *
 * `teamIds` (plural, FF-1's own major conceptual improvement over the previous single `teamId`): 1+ of
 * the viewer's own real, active teams, exactly the set `readClubTeams`/team-context authority already
 * exposes -- never a wider set. NOT YET MULTI-TEAM MATCHED: `find_fixture_candidate_teams` and every
 * read below still query ONE team at a time; true "N of these M teams are compatible with this club,
 * with per-team availability" matching is FF-2/FF-3's own stated work (the next stage in this
 * programme), not built here. `readFindFixtureCandidates` uses `teamIds[0]` as the representative query
 * team -- a deliberate, stated limitation, never a silently faked multi-team result.
 *
 * `dates` is Section 7's own multi-date search -- 1 to 6 candidate dates, the bound
 * `find_fixture_candidate_availability` itself enforces server-side. `venuePreference` travels through
 * untouched to the eventual /fixtures/new handoff (one date at a time, once a specific candidate+date is
 * chosen), because this module has no venue data to judge a club's own home/away preference against.
 */
export interface FindFixtureCriteria {
  teamIds: string[]
  teamRugbyCode: string | null
  dates: string[]
  venuePreference: FindFixtureVenuePreference
  distance: ClubhouseDistanceFilter
}

/** A club that is a real, actionable candidate: on Ovalball, with at least one compatible team. */
export type FindFixtureCandidate = ClubMapMarker & { compatibleTeams: CompatibleTeam[] }

export interface FindFixtureResult {
  /** Real Ovalball clubs with >=1 compatible team -- the only results a fixture request can actually target. */
  actionable: FindFixtureCandidate[]
  /** Same rugby code, not yet on Ovalball -- geographically/growth-relevant, never mixed indistinguishably
   * with actionable results, because a directory-only club cannot receive a fixture request. */
  directoryOnly: ClubMapMarker[]
}

type CandidateTeamRow = { team_id: string; club_id: string; display_name: string; age_group: string | null; gender: string | null }

/**
 * THE PURE PROJECTION: groups the batched RPC's flat rows by club, then reuses `mapCompatibleTeams`
 * (Section 4) unchanged for the per-team shape -- the same four-field projection ("no player roster
 * leakage" pinned there) applies here without a second definition.
 */
export function groupCandidateTeamsByClub(rows: readonly CandidateTeamRow[]): Map<string, CompatibleTeam[]> {
  const rawByClub = new Map<string, CandidateTeamRow[]>()
  for (const row of rows) {
    const group = rawByClub.get(row.club_id)
    if (group) group.push(row)
    else rawByClub.set(row.club_id, [row])
  }
  const result = new Map<string, CompatibleTeam[]>()
  for (const [clubId, group] of rawByClub) result.set(clubId, mapCompatibleTeams(group))
  return result
}

/**
 * THE PURE DECISION: which markers are real, actionable candidates (own club always excluded, even
 * though `find_fixture_candidate_teams` already excludes it server-side -- defence at the read-model
 * layer too) versus directory-only same-code clubs worth surfacing for growth. A club with no
 * `teamRugbyCode` (the searching team's own code is unrecorded) gets NO directory-only list --
 * "unrecorded" is never treated as "any code matches," which would risk a Union club being shown League
 * directory rows or vice versa.
 */
export function buildFindFixtureCandidates(markers: readonly ClubMapMarker[], candidateRows: readonly CandidateTeamRow[], teamRugbyCode: string | null): FindFixtureResult {
  const byClub = groupCandidateTeamsByClub(candidateRows)
  const actionable: FindFixtureCandidate[] = []
  for (const marker of markers) {
    if (marker.isOwnClub || !marker.clubId) continue
    const compatibleTeams = byClub.get(marker.clubId)
    if (compatibleTeams && compatibleTeams.length > 0) actionable.push({ ...marker, compatibleTeams })
  }
  const directoryOnly = teamRugbyCode
    ? markers.filter((m) => !m.isOwnClub && m.networkState === "not_on_ovalball" && m.rugbyCode === teamRugbyCode)
    : []
  return { actionable, directoryOnly }
}

/**
 * "most_clear_dates" (Section 7) needs per-date availability this function has no access to -- it is a
 * legitimate, named factual ordering, but the actual re-sort happens one layer up, once availability has
 * been fetched (`countNoKnownClashDates`); `sortFindFixtureCandidates` itself treats it as a no-op
 * passthrough (client name order), never guessing at a ranking it cannot truthfully compute.
 */
export type FindFixtureSort = "nearest" | "partners_first" | "club_name" | "most_clear_dates"

/**
 * NEVER AN OPAQUE SCORE. Factual orderings only, matching the directive's own named options.
 * "nearest" without a factual origin (the viewer's own club has no known location) degrades to
 * alphabetical rather than fabricating a distance-based order; a candidate with no known distance
 * always sorts after every candidate that has one, never implying "nearby" by appearing early.
 */
export function sortFindFixtureCandidates(candidates: readonly FindFixtureCandidate[], sort: FindFixtureSort, origin: ClubMapMarker | null): FindFixtureCandidate[] {
  const sorted = [...candidates]
  if (sort === "club_name" || sort === "most_clear_dates") return sorted.sort((a, b) => a.name.localeCompare(b.name))
  if (sort === "partners_first") {
    return sorted.sort((a, b) => {
      const rank = (c: FindFixtureCandidate) => (c.partnershipStatus === "active" ? 0 : 1)
      const diff = rank(a) - rank(b)
      return diff !== 0 ? diff : a.name.localeCompare(b.name)
    })
  }
  if (!origin) return sorted.sort((a, b) => a.name.localeCompare(b.name))
  return sorted.sort((a, b) => {
    const da = distanceMiles(origin, a)
    const db = distanceMiles(origin, b)
    if (da === null && db === null) return a.name.localeCompare(b.name)
    if (da === null) return 1
    if (db === null) return -1
    return da - db
  })
}

export type FindFixturePartnerFilter = "all" | "partners"

/** Reuses `applyClubhouseFilter`'s own `"partners"` case unchanged -- never a second partner-status check. */
export function applyFindFixturePartnerFilter(candidates: readonly FindFixtureCandidate[], filter: FindFixturePartnerFilter): FindFixtureCandidate[] {
  return applyClubhouseFilter([...candidates], filter, null) as FindFixtureCandidate[]
}

/**
 * THE ONE I/O ENTRY POINT. Exactly two round trips regardless of network size: the existing marker
 * population (`readClubhouseMarkers`, already used by the map/list/profile) and the batched
 * compatibility RPC -- never one call per candidate club. Distance-filters both result lists with the
 * SAME factual origin (the viewer's own club, if it has a real location) via the unchanged Section 2
 * function, so "a compatible club with no known location never vanishes from an ANY-distance search"
 * holds here exactly as it already does for the map.
 */
export async function readFindFixtureCandidates(
  supabase: Client,
  criteria: Pick<FindFixtureCriteria, "teamIds" | "teamRugbyCode" | "distance">,
  viewerClubId: string | null,
  viewerTeamId: string | null
): Promise<FindFixtureResult> {
  const primaryTeamId = criteria.teamIds[0]
  if (!primaryTeamId) return { actionable: [], directoryOnly: [] }
  const [markers, candidateRowsResult] = await Promise.all([
    readClubhouseMarkers(supabase, viewerClubId, viewerTeamId),
    supabase.rpc("find_fixture_candidate_teams", { p_team_id: primaryTeamId }),
  ])
  if (candidateRowsResult.error) throw candidateRowsResult.error

  const { actionable, directoryOnly } = buildFindFixtureCandidates(markers, candidateRowsResult.data ?? [], criteria.teamRugbyCode)
  const origin = findDistanceOrigin(markers)

  return {
    actionable: applyClubhouseDistanceFilter(actionable as ClubMapMarker[], criteria.distance, origin) as FindFixtureCandidate[],
    directoryOnly: applyClubhouseDistanceFilter(directoryOnly, criteria.distance, origin),
  }
}

/**
 * QUICK DATE HELPERS (Section 7) -- "the next N Saturdays", a genuinely simple, unambiguous
 * calculation, never a rugby-schedule inference (no assumption about which Saturdays are fixture
 * weekends, cup weeks, or a club's own season calendar -- manual date selection always remains
 * available alongside this). `isoWeekday` follows the ISO convention (1 = Monday .. 7 = Sunday) so a
 * caller never has to remember JavaScript's own Sunday-is-0 quirk. Capped at 6 to match
 * `find_fixture_candidate_availability`'s own bound; a caller asking for more just gets 6.
 */
export function nextWeekdayDates(fromIso: string, isoWeekday: number, count: number): string[] {
  const from = new Date(`${fromIso}T00:00:00Z`)
  const fromIsoWeekday = ((from.getUTCDay() + 6) % 7) + 1
  const daysUntilFirst = (isoWeekday - fromIsoWeekday + 7) % 7 || 7
  const dates: string[] = []
  for (let i = 0; i < Math.min(count, 6); i++) {
    const d = new Date(from)
    d.setUTCDate(d.getUTCDate() + daysUntilFirst + i * 7)
    dates.push(d.toISOString().slice(0, 10))
  }
  return dates
}

/** Sorted, deduplicated, capped at 6 -- the exact bound `find_fixture_candidate_availability` itself
 * enforces server-side. The one place this arithmetic lives now (FF-1's date strip, and any future
 * caller), pinned directly rather than only inspected inside the screen that uses it. */
export function dedupeFindFixtureDates(candidates: readonly string[]): string[] {
  return [...new Set(candidates)].sort().slice(0, 6)
}

/**
 * A GENERIC TOGGLE: add if absent, remove if present -- FF-1's own multi-select team rows and its
 * date-strip tiles are both "tap to include/exclude from a small set" controls, and this is the one
 * place that arithmetic lives rather than being re-written per control.
 */
export function toggleSelection<T>(current: readonly T[], value: T): T[] {
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
}

/**
 * THE CTA'S OWN VALIDATION RULE (Section 13 of the FF-1 spec): never a meaningless search state. Pure
 * and pinned directly so "cannot proceed without a team" and "cannot proceed without a date" are real,
 * permanent regression tests, not just an inline `disabled` expression nobody re-checks.
 */
export function canSearchFindFixtureCriteria(criteria: Pick<FindFixtureCriteria, "teamIds" | "dates">): boolean {
  return criteria.teamIds.length > 0 && criteria.dates.length > 0
}
