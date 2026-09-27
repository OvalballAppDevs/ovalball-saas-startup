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
 * exposes -- never a wider set. GENUINELY MULTI-TEAM MATCHED (FF-1.1): `readFindFixtureMatches` calls
 * `find_fixture_candidate_teams_batch` -- one round trip answering compatibility for EVERY selected team
 * at once, never `teamIds[0]` standing in for the rest. Each actionable candidate carries its own
 * `matchedTeamIds`, the real "N of these M teams are compatible with this club" count -- never an opaque
 * score, always the actual subset of the caller's own selected teams.
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

type CandidateTeamBatchRow = CandidateTeamRow & { my_team_id: string }

/** A candidate carrying which of the caller's OWN selected teams are compatible with it -- the real
 * "N/M teams matched" concept, never an opaque score. `matchedTeamIds` is always a subset of the
 * criteria's own `teamIds`, in the same order they were selected. */
export type FindFixtureCandidateMatch = FindFixtureCandidate & { matchedTeamIds: string[] }

export interface FindFixtureMatchResult {
  actionable: FindFixtureCandidateMatch[]
  directoryOnly: ClubMapMarker[]
}

/**
 * THE MULTI-TEAM PROJECTION: groups the batched RPC's rows by club (deduplicating the opposition team
 * list across every selected team via the same `mapCompatibleTeams` four-field shape), while separately
 * tracking, per club, WHICH of the caller's selected teams (`my_team_id`) found at least one compatible
 * opposition team there.
 */
export function groupBatchCandidateTeamsByClub(rows: readonly CandidateTeamBatchRow[]): Map<string, { compatibleTeams: CompatibleTeam[]; matchedTeamIds: Set<string> }> {
  const rawByClub = new Map<string, CandidateTeamBatchRow[]>()
  for (const row of rows) {
    const group = rawByClub.get(row.club_id)
    if (group) group.push(row)
    else rawByClub.set(row.club_id, [row])
  }
  const result = new Map<string, { compatibleTeams: CompatibleTeam[]; matchedTeamIds: Set<string> }>()
  for (const [clubId, group] of rawByClub) {
    const uniqueTeams = new Map<string, CandidateTeamBatchRow>()
    for (const row of group) if (!uniqueTeams.has(row.team_id)) uniqueTeams.set(row.team_id, row)
    result.set(clubId, { compatibleTeams: mapCompatibleTeams([...uniqueTeams.values()]), matchedTeamIds: new Set(group.map((row) => row.my_team_id)) })
  }
  return result
}

/**
 * THE PURE DECISION, MULTI-TEAM FORM: same actionable/directory-only split as `buildFindFixtureCandidates`,
 * plus each actionable candidate's real `matchedTeamIds` -- the subset of `selectedTeamIds` (order
 * preserved) that found a>=1 compatible opposition team at that club.
 */
export function buildFindFixtureMatches(
  markers: readonly ClubMapMarker[],
  candidateRows: readonly CandidateTeamBatchRow[],
  teamRugbyCode: string | null,
  selectedTeamIds: readonly string[]
): FindFixtureMatchResult {
  const byClub = groupBatchCandidateTeamsByClub(candidateRows)
  const actionable: FindFixtureCandidateMatch[] = []
  for (const marker of markers) {
    if (marker.isOwnClub || !marker.clubId) continue
    const group = byClub.get(marker.clubId)
    if (group && group.compatibleTeams.length > 0) {
      actionable.push({ ...marker, compatibleTeams: group.compatibleTeams, matchedTeamIds: selectedTeamIds.filter((id) => group.matchedTeamIds.has(id)) })
    }
  }
  const directoryOnly = teamRugbyCode
    ? markers.filter((m) => !m.isOwnClub && m.networkState === "not_on_ovalball" && m.rugbyCode === teamRugbyCode)
    : []
  return { actionable, directoryOnly }
}

/** "3/3 matched", "2/3 matched" -- the exact factual phrasing FF-2/FF-3 need, computed once here rather
 * than re-derived per screen. Never implies only full matches are returned: a 2/3 candidate is still a
 * real, actionable result, just named honestly. */
export function matchedTeamCountLabel(candidate: Pick<FindFixtureCandidateMatch, "matchedTeamIds">, totalSelected: number): string {
  return `${candidate.matchedTeamIds.length}/${totalSelected} matched`
}

/**
 * THE ONE I/O ENTRY POINT, GENUINELY MULTI-TEAM (FF-1.1): exactly two round trips regardless of network
 * size OR how many teams are selected -- the existing marker population (`readClubhouseMarkers`) and the
 * batched multi-team compatibility RPC (`find_fixture_candidate_teams_batch`), never one call per
 * candidate club and never one call per selected team. Distance-filters both result lists with the SAME
 * factual origin (the viewer's own club, if it has a real location) via the unchanged Section 2
 * function, so "a compatible club with no known location never vanishes from an ANY-distance search"
 * holds here exactly as it already does for the map.
 */
export async function readFindFixtureMatches(
  supabase: Client,
  criteria: Pick<FindFixtureCriteria, "teamIds" | "teamRugbyCode" | "distance">,
  viewerClubId: string | null,
  viewerTeamId: string | null
): Promise<FindFixtureMatchResult> {
  if (criteria.teamIds.length === 0) return { actionable: [], directoryOnly: [] }
  const [markers, candidateRowsResult] = await Promise.all([
    readClubhouseMarkers(supabase, viewerClubId, viewerTeamId),
    supabase.rpc("find_fixture_candidate_teams_batch", { p_team_ids: criteria.teamIds }),
  ])
  if (candidateRowsResult.error) throw candidateRowsResult.error

  const { actionable, directoryOnly } = buildFindFixtureMatches(markers, candidateRowsResult.data ?? [], criteria.teamRugbyCode, criteria.teamIds)
  const origin = findDistanceOrigin(markers)

  return {
    actionable: applyClubhouseDistanceFilter(actionable as ClubMapMarker[], criteria.distance, origin) as FindFixtureCandidateMatch[],
    directoryOnly: applyClubhouseDistanceFilter(directoryOnly, criteria.distance, origin),
  }
}

type CandidateAvailabilityBatchRow = { my_team_id: string; opponent_team_id: string; the_date: string; status: string }

/**
 * THE MULTI-TEAM AVAILABILITY READ: same partners-only, busy/request_pending-coarsened boundary as
 * Section 7's `find_fixture_candidate_availability`, batched across every selected team in one round
 * trip. Callers combine this with `buildFindFixtureAvailability` per `my_team_id` slice when FF-3 needs
 * per-matchup detail; this function's own job stops at the honest, minimal row set the server returns.
 */
export async function readFindFixtureAvailabilityBatch(
  supabase: Client,
  teamIds: readonly string[],
  dates: readonly string[]
): Promise<CandidateAvailabilityBatchRow[]> {
  if (teamIds.length === 0 || dates.length === 0) return []
  const { data, error } = await supabase.rpc("find_fixture_candidate_availability_batch", { p_team_ids: [...teamIds], p_dates: [...dates] })
  if (error) throw error
  return data ?? []
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

/**
 * FF-2's own dynamic copy (Section O/P of the FF-1.1/FF-2 spec): truthful, never implying only clubs
 * compatible with EVERY selected team will be returned. A single selected team names it directly; more
 * than one is described honestly as "your N selected teams" -- the batched read model still returns a
 * club that matches only SOME of them, so the copy never claims otherwise. Date formatting itself stays
 * in the UI layer (this only decides the "on X" vs "across N possible dates" branch, so it is testable
 * without a locale-dependent date formatter).
 */
export function findFixtureMatchingCopy(teamCount: number, singleTeamLabel: string | null, dateClause: string): string {
  if (teamCount <= 1) return `We're finding clubs with compatible opposition for ${singleTeamLabel ?? "your selected team"} ${dateClause}.`
  return `We're finding clubs with compatible teams for your ${teamCount} selected teams ${dateClause}.`
}

/** "on Sat 26 Sep 2026" for one date, "across N possible dates" for several -- never implies only an
 * all-dates match is possible. */
export function findFixtureDateClause(dateCount: number, firstDateLabel: string): string {
  return dateCount <= 1 ? `on ${firstDateLabel}` : `across ${dateCount} possible dates`
}
