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

/**
 * FF-3'S OWN NETWORK FILTER (visual-lock, Job 1): the four real distinctions the result list can make
 * about a club, never a fabricated fifth. "Not Yet Partnered" is every on-Ovalball candidate that is
 * NOT an active partner -- `none`, `pending_outgoing`, `pending_incoming` AND `unknown` all belong here,
 * because all four are equally "not yet an active partnership"; the point of the filter is which clubs
 * you could still go and partner with, not which ones happen to have a fully-resolved relationship row.
 * The card itself is what must keep `unknown` visually distinct from `none` -- this filter only decides
 * inclusion, never presentation. "Not on Ovalball" reuses the exact `directoryOnly` population FF-2/FF-3
 * already computed (`buildFindFixtureMatches`'s own same-rugby-code, distance-filtered rows) -- never a
 * second directory query invented for the filter chip.
 */
export type FindFixtureNetworkFilter = "all" | "partners" | "not_yet_partnered" | "not_on_ovalball"

export function applyFindFixtureNetworkFilter<TCandidate extends { partnershipStatus: ClubMapMarker["partnershipStatus"] }, TDirectory>(
  result: { actionable: readonly TCandidate[]; directoryOnly: readonly TDirectory[] },
  filter: FindFixtureNetworkFilter
): { actionable: TCandidate[]; directoryOnly: TDirectory[] } {
  if (filter === "partners") return { actionable: result.actionable.filter((c) => c.partnershipStatus === "active"), directoryOnly: [] }
  if (filter === "not_yet_partnered") return { actionable: result.actionable.filter((c) => c.partnershipStatus !== "active"), directoryOnly: [] }
  if (filter === "not_on_ovalball") return { actionable: [], directoryOnly: [...result.directoryOnly] }
  return { actionable: [...result.actionable], directoryOnly: [...result.directoryOnly] }
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
export async function readFindFixtureMatchesUnfiltered(
  supabase: Client,
  criteria: Pick<FindFixtureCriteria, "teamIds" | "teamRugbyCode">,
  viewerClubId: string | null,
  viewerTeamId: string | null
): Promise<{ result: FindFixtureMatchResult; origin: ClubMapMarker | null }> {
  if (criteria.teamIds.length === 0) return { result: { actionable: [], directoryOnly: [] }, origin: null }
  const [markers, candidateRowsResult] = await Promise.all([
    readClubhouseMarkers(supabase, viewerClubId, viewerTeamId),
    supabase.rpc("find_fixture_candidate_teams_batch", { p_team_ids: criteria.teamIds }),
  ])
  if (candidateRowsResult.error) throw candidateRowsResult.error

  return { result: buildFindFixtureMatches(markers, candidateRowsResult.data ?? [], criteria.teamRugbyCode, criteria.teamIds), origin: findDistanceOrigin(markers) }
}

/** The distance-filter step split out on its own (FF-2's own "Applying distance preference" stage is
 * genuine work, not a fabricated pause) -- same factual-origin-only rule as every other Clubhouse
 * distance filter, never a personal-GPS fallback. */
export function applyFindFixtureDistanceFilter(result: FindFixtureMatchResult, distance: ClubhouseDistanceFilter, origin: ClubMapMarker | null): FindFixtureMatchResult {
  return {
    actionable: applyClubhouseDistanceFilter(result.actionable as ClubMapMarker[], distance, origin) as FindFixtureCandidateMatch[],
    directoryOnly: applyClubhouseDistanceFilter(result.directoryOnly, distance, origin),
  }
}

/**
 * THE ONE I/O ENTRY POINT, GENUINELY MULTI-TEAM (FF-1.1): exactly two round trips regardless of network
 * size OR how many teams are selected -- the existing marker population (`readClubhouseMarkers`) and the
 * batched multi-team compatibility RPC (`find_fixture_candidate_teams_batch`), never one call per
 * candidate club and never one call per selected team. Thin wrapper over
 * `readFindFixtureMatchesUnfiltered` + `applyFindFixtureDistanceFilter` -- FF-2's own progress screen
 * calls those two directly so its "checking compatibility" and "applying distance preference" stages
 * correspond to real, separate work; every other caller wants both steps done in one call.
 */
export async function readFindFixtureMatches(
  supabase: Client,
  criteria: Pick<FindFixtureCriteria, "teamIds" | "teamRugbyCode" | "distance">,
  viewerClubId: string | null,
  viewerTeamId: string | null
): Promise<FindFixtureMatchResult> {
  const { result, origin } = await readFindFixtureMatchesUnfiltered(supabase, criteria, viewerClubId, viewerTeamId)
  return applyFindFixtureDistanceFilter(result, criteria.distance, origin)
}

export type CandidateAvailabilityBatchRow = { my_team_id: string; opponent_team_id: string; the_date: string; status: string }

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

/** "0 clubs" / "1 club" / "N clubs" -- plain result-count grammar, pinned so it is never re-typed
 * inconsistently across FF-3's header and its empty state. */
export function findFixtureResultCountLabel(count: number): string {
  return `${count} ${count === 1 ? "club" : "clubs"}`
}

/**
 * FF-3's own per-club availability coverage (Section 21/22 of the visual-lock spec): for ONE requested
 * date, how many of a candidate's `matchedTeamIds` are genuinely clear versus busy versus tentative
 * versus unknown. The club-level `partnershipStatus` gates the whole club at once (the same rule
 * `buildFindFixtureAvailability` already applies per candidate) -- a non-partner club is UNKNOWN on
 * every matched team, never consulted row-by-row. A matched team with no row for this date reads
 * `no_known_clash` -- the server's own "absence means no clash" contract, never a fabricated status.
 * Never claims a coarsened `no_known_clash` is confirmed "Available".
 */
export interface FindFixtureClubAvailabilitySummary {
  matchedCount: number
  totalSelected: number
  noKnownClashCount: number
  busyCount: number
  tentativeCount: number
  unknownCount: number
}

export function summariseFindFixtureClubAvailability(
  candidate: Pick<FindFixtureCandidateMatch, "matchedTeamIds" | "partnershipStatus" | "compatibleTeams">,
  totalSelected: number,
  date: string,
  availabilityRows: readonly CandidateAvailabilityBatchRow[]
): FindFixtureClubAvailabilitySummary {
  const opponentTeamIds = new Set(candidate.compatibleTeams.map((t) => t.teamId))
  const summary: FindFixtureClubAvailabilitySummary = { matchedCount: candidate.matchedTeamIds.length, totalSelected, noKnownClashCount: 0, busyCount: 0, tentativeCount: 0, unknownCount: 0 }
  for (const myTeamId of candidate.matchedTeamIds) {
    if (candidate.partnershipStatus !== "active") {
      summary.unknownCount += 1
      continue
    }
    const hit = availabilityRows.find((r) => r.my_team_id === myTeamId && r.the_date === date && opponentTeamIds.has(r.opponent_team_id))
    if (!hit || hit.status === "no_known_clash") summary.noKnownClashCount += 1
    else if (hit.status === "busy") summary.busyCount += 1
    else summary.tentativeCount += 1
  }
  return summary
}

/** "3/3 no known clash", "2 clear · 1 busy", "Availability unknown" -- factual coverage, never a
 * confirmed "Available" claim the server's own coarsened data cannot back. */
export function findFixtureAvailabilitySummaryLabel(summary: FindFixtureClubAvailabilitySummary): string {
  if (summary.matchedCount === 0 || summary.unknownCount === summary.matchedCount) return "Availability unknown"
  if (summary.noKnownClashCount === summary.matchedCount) return `${summary.matchedCount}/${summary.matchedCount} no known clash`
  if (summary.busyCount === summary.matchedCount) return "Busy"
  const parts: string[] = []
  if (summary.noKnownClashCount) parts.push(`${summary.noKnownClashCount} clear`)
  if (summary.busyCount) parts.push(`${summary.busyCount} busy`)
  if (summary.tentativeCount) parts.push(`${summary.tentativeCount} tentative`)
  if (summary.unknownCount) parts.push(`${summary.unknownCount} unknown`)
  return parts.join(" · ")
}

/**
 * GAME WEEK (visual-lock Section A5/A6): rugby's own working week, Monday 00:00 through Sunday
 * 23:59:59 -- never Sunday-to-Saturday. A team already committed on Friday is not truthfully "clear"
 * just because the SPECIFIC requested Sunday has nothing on it; this is the range every same-week
 * question below is asked against. `date_trunc('week', ...)` in Postgres already truncates to Monday,
 * so the server side (`find_fixture_candidate_game_week_batch`) computes the identical range -- this is
 * the client-side mirror, used only for display (e.g. deciding which of several requested dates a given
 * commitment falls under), never a second authority for what the server already decided.
 */
export function gameWeekRange(dateIso: string): { start: string; end: string } {
  const d = new Date(`${dateIso}T00:00:00Z`)
  const isoWeekday = ((d.getUTCDay() + 6) % 7) + 1 // 1 = Monday .. 7 = Sunday
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - (isoWeekday - 1))
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) }
}

/** Whether `candidateDate` falls inside the Monday-Sunday game week that CONTAINS `referenceDate` --
 * the boundary check the Public Club Profile's Availability tab needs (Section N): a commitment the
 * day before the week's own Monday is OUTSIDE, the week's own Monday through Sunday are all INSIDE, and
 * the following Monday is OUTSIDE again. Plain ISO-string comparison is safe here because `YYYY-MM-DD`
 * sorts identically to chronological order. */
export function withinGameWeek(candidateDate: string, referenceDate: string): boolean {
  const { start, end } = gameWeekRange(referenceDate)
  return candidateDate >= start && candidateDate <= end
}

/** The deduplicated set of game weeks spanned by a multi-date search, sorted -- a caller with dates
 * that straddle two different weeks needs both ranges, never just the first date's. */
export function gameWeekRangesForDates(dates: readonly string[]): { start: string; end: string }[] {
  const byStart = new Map<string, { start: string; end: string }>()
  for (const date of dates) {
    const range = gameWeekRange(date)
    byStart.set(range.start, range)
  }
  return [...byStart.values()].sort((a, b) => a.start.localeCompare(b.start))
}

export type GameWeekCommitmentRow = { my_team_id: string; opponent_team_id: string; commitment_date: string }

/**
 * PER-TEAM WEEK SUMMARY (Section A8): the exact requested date's own already-coarsened state, plus
 * every OTHER real fixture/competition-match commitment the same opposition team has in the same
 * Monday-Sunday game week (the requested date itself is excluded here -- that is what `dateState`
 * already answers). Sourced ONLY from `find_fixture_candidate_game_week_batch`, which deliberately
 * narrows its OWN sources to real fixtures/competition matches (Section A9: training, club events and
 * pending requests are not "the team already has a game this week", and stay out of this signal
 * entirely -- they already count toward `dateState` on the exact date, where that is the existing,
 * unchanged rule).
 */
export interface FindFixtureTeamWeekSummary {
  dateState: "no_known_clash" | "busy" | "tentative" | "unknown"
  otherWeekCommitments: string[]
}

export function summariseFindFixtureTeamWeek(
  dateState: FindFixtureTeamWeekSummary["dateState"],
  requestedDate: string,
  myTeamId: string,
  opponentTeamId: string,
  weekRows: readonly GameWeekCommitmentRow[]
): FindFixtureTeamWeekSummary {
  const otherWeekCommitments = weekRows
    .filter((r) => r.my_team_id === myTeamId && r.opponent_team_id === opponentTeamId && r.commitment_date !== requestedDate)
    .map((r) => r.commitment_date)
    .sort()
  return { dateState, otherWeekCommitments }
}

/**
 * THE SAME QUESTION FOR THE PUBLIC CLUB PROFILE'S OWN GENERIC Availability tab (Part B, Section B4):
 * "does THIS opposition team have a real commitment elsewhere in the week", asked without pinning it to
 * one specific one of the viewer's own teams -- that screen shows every one of a club's compatible
 * teams at once, not a single viewer-team-scoped search result row.
 */
export function otherWeekCommitmentsForOpponent(opponentTeamId: string, requestedDate: string, weekRows: readonly GameWeekCommitmentRow[]): string[] {
  return weekRows
    .filter((r) => r.opponent_team_id === opponentTeamId && r.commitment_date !== requestedDate)
    .map((r) => r.commitment_date)
    .sort()
}

/** "Busy" (the exact date itself), "Busy this week" (a real commitment elsewhere in the same Monday-
 * Sunday week, `detail` carrying that raw date for the UI to format), "Tentative", "Availability
 * unknown", or "No known clash" -- never "Available", and a clear exact date is never presented as
 * clear overall if the same team is already committed elsewhere that week. */
export function findFixtureWeekLabel(summary: FindFixtureTeamWeekSummary): { primary: string; detail: string | null } {
  if (summary.dateState === "busy") return { primary: "Busy", detail: null }
  if (summary.otherWeekCommitments.length > 0) return { primary: "Busy this week", detail: summary.otherWeekCommitments[0]! }
  if (summary.dateState === "tentative") return { primary: "Tentative", detail: null }
  if (summary.dateState === "unknown") return { primary: "Availability unknown", detail: null }
  return { primary: "No known clash", detail: null }
}

/**
 * CLUB-LEVEL WEEK-AWARE SUMMARY (Section A10): the same per-club roll-up as
 * `summariseFindFixtureClubAvailability`, extended with `weekBusyCount` -- among the matched teams that
 * read `no_known_clash` on the exact requested date, how many still have a real commitment elsewhere in
 * the same game week (and so are not truthfully "clear" overall, even though the one specific day is
 * empty).
 */
export function summariseFindFixtureClubWeek(
  candidate: Pick<FindFixtureCandidateMatch, "matchedTeamIds" | "partnershipStatus" | "compatibleTeams">,
  totalSelected: number,
  date: string,
  availabilityRows: readonly CandidateAvailabilityBatchRow[],
  weekRows: readonly GameWeekCommitmentRow[]
): FindFixtureClubAvailabilitySummary & { weekBusyCount: number } {
  const base = summariseFindFixtureClubAvailability(candidate, totalSelected, date, availabilityRows)
  const opponentTeamIds = new Set(candidate.compatibleTeams.map((t) => t.teamId))
  let weekBusyCount = 0
  if (candidate.partnershipStatus === "active") {
    for (const myTeamId of candidate.matchedTeamIds) {
      const exactHit = availabilityRows.some((r) => r.my_team_id === myTeamId && r.the_date === date && opponentTeamIds.has(r.opponent_team_id))
      if (exactHit) continue // already counted as busy/tentative on the exact date
      const weekHit = weekRows.some((r) => r.my_team_id === myTeamId && opponentTeamIds.has(r.opponent_team_id) && r.commitment_date !== date)
      if (weekHit) weekBusyCount += 1
    }
  }
  return { ...base, weekBusyCount }
}

/** "No known clash" (every matched team genuinely clear all week), "N busy" (every matched team either
 * busy on the exact date or elsewhere in the week), "Mixed" (a genuine split), or "Availability unknown"
 * (every matched team is at a non-partner club). Matches Section A10's own three worked examples
 * exactly. */
export function findFixtureClubWeekLabel(summary: FindFixtureClubAvailabilitySummary & { weekBusyCount: number }): string {
  if (summary.matchedCount === 0 || summary.unknownCount === summary.matchedCount) return "Availability unknown"
  const effectiveBusy = summary.busyCount + summary.tentativeCount + summary.weekBusyCount
  const effectiveClear = summary.matchedCount - effectiveBusy - summary.unknownCount
  if (summary.unknownCount > 0 && (effectiveClear > 0 || effectiveBusy > 0)) return "Mixed"
  if (effectiveClear === summary.matchedCount) return "No known clash"
  if (effectiveBusy === summary.matchedCount) return effectiveBusy === 1 ? "1 busy" : `${effectiveBusy} busy`
  return "Mixed"
}

/**
 * THE GAME-WEEK READ: same per-team authority (checked individually, no widening) as every other
 * batched Find a Fixture RPC, but its OWN, narrower busy-signal sources (real fixtures and competition
 * matches only -- Section A9) over a WIDER date range (the full Monday-Sunday week(s) spanning the
 * requested dates, not just the exact dates themselves). Never a second availability engine: the exact-
 * date busy/tentative/no_known_clash rule is entirely unchanged and lives in
 * `find_fixture_candidate_availability_batch`, called separately; this only adds "does this team have
 * a game elsewhere in the same week".
 */
export async function readFindFixtureGameWeekBatch(supabase: Client, teamIds: readonly string[], dates: readonly string[]): Promise<GameWeekCommitmentRow[]> {
  if (teamIds.length === 0 || dates.length === 0) return []
  const { data, error } = await supabase.rpc("find_fixture_candidate_game_week_batch", { p_team_ids: [...teamIds], p_dates: [...dates] })
  if (error) throw error
  return data ?? []
}

export type FindFixtureResultSort = "nearest" | "best_match" | "most_clear"

/**
 * FF-3's own three sort modes (Section 23): "nearest" reuses `sortFindFixtureCandidates` unchanged
 * (never a second distance-ordering rule); "best_match" ranks by how many of the caller's own selected
 * teams matched first, then by clear-availability coverage, then distance; "most_clear" ranks by clear-
 * availability coverage alone. Never an opaque score -- every tier is a named, factual field.
 */
/**
 * The minimal shape `sortFindFixtureMatches` needs -- deliberately smaller than either availability
 * summary type, so "most_clear"/"best_match" can rank on whichever richness level the caller has
 * available (exact-date only, or the week-aware form) without the sort itself caring which. `effectiveClearCount`
 * is EXACT-date no_known_clash minus any of those teams that turn out to have a real fixture/competition-
 * match commitment elsewhere in the same Monday-Sunday game week (Section A13/A10) -- a team is never
 * counted as "clear" for ranking purposes on the strength of one empty day alone if it is playing
 * elsewhere that week.
 */
export interface FindFixtureSortSummary {
  matchedCount: number
  effectiveClearCount: number
}

/** `FindFixtureClubAvailabilitySummary` already IS this shape when there is no week data -- its own
 * `noKnownClashCount` is exact-date-only clear, which is exactly `effectiveClearCount` in that case. */
export function toSortSummary(summary: Pick<FindFixtureClubAvailabilitySummary, "matchedCount" | "noKnownClashCount">): FindFixtureSortSummary {
  return { matchedCount: summary.matchedCount, effectiveClearCount: summary.noKnownClashCount }
}

export function sortFindFixtureMatches(
  candidates: readonly FindFixtureCandidateMatch[],
  sort: FindFixtureResultSort,
  origin: { latitude: number | null; longitude: number | null } | null,
  summaries: ReadonlyMap<string, FindFixtureSortSummary>
): FindFixtureCandidateMatch[] {
  if (sort === "nearest") return sortFindFixtureCandidates(candidates, "nearest", origin as ClubMapMarker | null) as FindFixtureCandidateMatch[]
  const distanceTiebreak = (a: FindFixtureCandidateMatch, b: FindFixtureCandidateMatch): number => {
    const da = origin ? distanceMiles(origin, a) : null
    const db = origin ? distanceMiles(origin, b) : null
    if (da === null && db === null) return a.name.localeCompare(b.name)
    if (da === null) return 1
    if (db === null) return -1
    return da - db
  }
  const sorted = [...candidates]
  if (sort === "most_clear") {
    return sorted.sort((a, b) => {
      const diff = (summaries.get(b.clubId ?? "")?.effectiveClearCount ?? 0) - (summaries.get(a.clubId ?? "")?.effectiveClearCount ?? 0)
      return diff !== 0 ? diff : distanceTiebreak(a, b)
    })
  }
  return sorted.sort((a, b) => {
    const matchedDiff = (summaries.get(b.clubId ?? "")?.matchedCount ?? 0) - (summaries.get(a.clubId ?? "")?.matchedCount ?? 0)
    if (matchedDiff !== 0) return matchedDiff
    const clearDiff = (summaries.get(b.clubId ?? "")?.effectiveClearCount ?? 0) - (summaries.get(a.clubId ?? "")?.effectiveClearCount ?? 0)
    return clearDiff !== 0 ? clearDiff : distanceTiebreak(a, b)
  })
}
