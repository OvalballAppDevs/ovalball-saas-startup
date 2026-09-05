import "server-only"

import { createClient } from "@/lib/supabase/server"
import { eligibleOppositionCanonicalTypes } from "@/lib/fixtures/eligibility"
import { resolveDefaultSeason, type SeasonRow } from "@/lib/calendar/season-window"

import { canActOnTeam } from "./actor-context"
import { haversineMiles } from "./distance"
import { rankCandidates } from "./rank-candidates"
import type { FixtureAvailabilityState, OpponentSearchCriteria, OpponentSearchResult, OvieActorContext, PartnershipState } from "./types"

/**
 * Ovie's opponent-matching / availability domain service. This is the ONE
 * server-side place that decides who a suitable opponent is and what
 * "free" means -- Ovie's language layer is a consumer of this, never the
 * other way round, and it is written to be equally usable by any FUTURE
 * consumer (Fixture Management, Calendar, Tournament invitations) per the
 * brief's own architecture note. It reads only the canonical fixture
 * domain (fixtures, fixture_requests, teams, club_directory, seasons,
 * scheduling_groups, club_partnerships) -- there is no separate
 * availability store, no AI-specific club/team record, anywhere.
 *
 * PRIVACY: every function below returns, or contributes fields to,
 * SafeOpponentCandidate ONLY -- club_directory_id, a display name, a
 * canonical team identity, an approximate distance, three coarse state
 * enums, a meeting count, and a boolean. Nothing else about a candidate
 * club is ever assembled here: no staff/contact rows are queried, no
 * player/parent/attendance data, no raw fixture list, no message content.
 * This reduction happens INSIDE this service, before the result is ever
 * handed to the LLM layer (lib/ovie/orchestrator.ts) -- there is no wider
 * object upstream of this file that a future change could accidentally
 * start forwarding.
 *
 * "A meeting" (for maxPreviousMeetings / "don't show anyone we're playing
 * twice"): a real fixtures row between the two teams in the resolved
 * season, status <> 'Cancelled'. Completed AND future-confirmed fixtures
 * both count -- the purpose of the rule is avoiding a genuine third
 * booking, so an already-scheduled future match must count exactly like a
 * played one. There is no "Rejected" fixtures.status (rejection lives on
 * fixture_requests, which never produces a fixtures row at all) -- a
 * declined/never-accepted request therefore already can't inflate this
 * count, by construction, not by an extra filter.
 */

interface RequestingTeamInfo {
  teamId: string
  clubId: string
  clubDirectoryId: string
  clubName: string
  rugbyCode: string
  category: string
  ageGroup: string | null
  gender: string | null
  squadDesignation: string | null
  canonicalTeamTypeId: string | null
  latitude: number | null
  longitude: number | null
}

async function loadRequestingTeam(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teamId: string
): Promise<RequestingTeamInfo | null> {
  const { data } = await supabase
    .from("teams")
    .select(
      "id, club_id, rugby_code, category, age_group, gender, squad_designation, canonical_team_type_id, clubs!inner(directory_id, club_directory(name, latitude, longitude, geocode_status))"
    )
    .eq("id", teamId)
    .maybeSingle()
  if (!data || !data.clubs) return null
  const directory = data.clubs.club_directory
  return {
    teamId: data.id,
    clubId: data.club_id,
    clubDirectoryId: data.clubs.directory_id,
    clubName: directory?.name ?? "Your club",
    rugbyCode: data.rugby_code,
    category: data.category,
    ageGroup: data.age_group,
    gender: data.gender,
    squadDesignation: data.squad_designation,
    canonicalTeamTypeId: data.canonical_team_type_id,
    latitude: directory?.geocode_status === "success" ? (directory.latitude ?? null) : null,
    longitude: directory?.geocode_status === "success" ? (directory.longitude ?? null) : null,
  }
}

async function resolveSeasonId(supabase: Awaited<ReturnType<typeof createClient>>, rugbyCode: string, date: string): Promise<string | null> {
  // Reuses the exact canonical resolver Calendar/Season Rollover already
  // treat as authoritative (lib/calendar/season-window.ts) rather than
  // re-deriving season boundaries here -- a raw `.lte("pre_season_starts_on", date)`
  // filter would silently exclude any season with that column left null,
  // since Postgres null comparisons never match. Resolved against the
  // FIXTURE date (not today), since a request can legitimately be for a
  // date in next season's pre-season window.
  const { data } = await supabase
    .from("seasons")
    .select("id, name, season_ref, rugby_code, pre_season_starts_on, starts_on, ends_on")
    .eq("rugby_code", rugbyCode)
    .eq("is_regression_fixture", false)
  const rows: SeasonRow[] = (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    seasonRef: s.season_ref,
    rugbyCode: s.rugby_code,
    preSeasonStartsOn: s.pre_season_starts_on,
    startsOn: s.starts_on,
    endsOn: s.ends_on,
  }))
  return resolveDefaultSeason(rows, rugbyCode, date)?.id ?? null
}

/** A generous ~1 degree-of-latitude bounding box (≈69 miles) around the requesting club, used only to keep the candidate set small before the real haversine distance is calculated per row -- never a substitute for the real distance check, just an index-friendly pre-filter so this never fetches the whole Club Directory. */
function boundingBox(lat: number, lon: number, radiusMiles: number) {
  const latDelta = radiusMiles / 69
  const lonDelta = radiusMiles / (69 * Math.cos((lat * Math.PI) / 180) || 1)
  return { minLat: lat - latDelta, maxLat: lat + latDelta, minLon: lon - lonDelta, maxLon: lon + lonDelta }
}

interface CandidateDirectoryRow {
  id: string
  name: string
  rugby_code: string
  latitude: number | null
  longitude: number | null
}

/**
 * `supabase` is injected rather than constructed internally -- the ONLY
 * change from Phase 1 -- so this service is genuinely usable by any future
 * server-side caller (Fixture Management, Calendar, Tournament invitations,
 * per this module's own header comment) regardless of whether that caller
 * runs inside a Next.js request (`@/lib/supabase/server`'s `createClient()`
 * needs `next/headers`, which only resolves inside one) and so it can be
 * exercised directly by an automated test with a real Supabase client,
 * without needing a live request/session. The caller remains solely
 * responsible for which client it hands in -- an ordinary request-scoped,
 * RLS-enforcing client in every real product code path (orchestrator.ts is
 * the only one today); a privileged client ONLY ever appears in this
 * function's own automated test, which independently re-derives and
 * re-checks canActOnTeam()/RLS-equivalent scoping itself rather than
 * relying on this function's internal checks alone (see
 * lib/ovie/opponent-search.test-scenario.ts).
 */
export async function findSuitableOpponents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actor: OvieActorContext,
  criteria: OpponentSearchCriteria
): Promise<OpponentSearchResult> {
  // Permission boundary FIRST -- an actor who cannot manage the requesting
  // team is refused before any search runs, never after results are
  // computed. This is what stops a scoped Coach/Team Manager from
  // searching "on behalf of" a team they don't hold, and stops a
  // view-only Parent/Player reaching this at all except through the
  // read-only narration path, which never calls this with write intent.
  const requestingTeam = await loadRequestingTeam(supabase, criteria.requestingTeamId)
  if (!requestingTeam || requestingTeam.clubId !== criteria.requestingClubId) {
    return { candidates: [], excludedCount: 0, criteria }
  }
  if (!actor.isSiteAdmin && !canActOnTeam(actor, criteria.requestingTeamId, criteria.requestingClubId)) {
    return { candidates: [], excludedCount: 0, criteria }
  }

  const seasonId = await resolveSeasonId(supabase, criteria.rugbyCode, criteria.date)
  const radiusMiles = criteria.radiusMiles ?? 20
  const maxResults = criteria.maxResults ?? 5

  // Geographic pre-filter (bounding box) -- avoids fetching the whole
  // Club Directory (1,400+ rows) to compute distance in the application
  // layer for every one of them.
  let directoryQuery = supabase
    .from("club_directory")
    .select("id, name, rugby_code, latitude, longitude")
    .eq("active", true)
    .eq("rugby_code", criteria.rugbyCode)
    .eq("geocode_status", "success")
    .neq("id", requestingTeam.clubDirectoryId)

  if (requestingTeam.latitude != null && requestingTeam.longitude != null) {
    const box = boundingBox(requestingTeam.latitude, requestingTeam.longitude, radiusMiles)
    directoryQuery = directoryQuery.gte("latitude", box.minLat).lte("latitude", box.maxLat).gte("longitude", box.minLon).lte("longitude", box.maxLon)
  }
  if (criteria.excludeClubDirectoryIds?.length) {
    directoryQuery = directoryQuery.not("id", "in", `(${criteria.excludeClubDirectoryIds.join(",")})`)
  }

  const { data: directoryRows } = await directoryQuery.limit(300)
  const candidates = (directoryRows ?? []) as CandidateDirectoryRow[]
  if (candidates.length === 0) return { candidates: [], excludedCount: 0, criteria }

  // Real (haversine) distance, computed once the candidate set is small --
  // discard anything the bounding box let through but the true circle
  // excludes.
  const withDistance = candidates
    .map((c) => ({
      ...c,
      distanceMiles:
        requestingTeam.latitude != null && requestingTeam.longitude != null && c.latitude != null && c.longitude != null
          ? haversineMiles(requestingTeam.latitude, requestingTeam.longitude, c.latitude, c.longitude)
          : null,
    }))
    .filter((c) => c.distanceMiles == null || c.distanceMiles <= radiusMiles)

  const directoryIds = withDistance.map((c) => c.id)
  if (directoryIds.length === 0) return { candidates: [], excludedCount: 0, criteria }

  // Batch: which of these directory rows are claimed (an activated
  // `clubs` row), and their partnership state with the requester's own
  // club -- two queries total, never one per candidate.
  const [{ data: activatedClubs }, { data: partnerships }, { data: canonicalTypes }] = await Promise.all([
    supabase.from("clubs").select("id, directory_id, status").in("directory_id", directoryIds),
    supabase
      .from("club_partnerships")
      .select("requesting_club_id, partner_club_id, status")
      .neq("status", "revoked")
      .or(`requesting_club_id.eq.${criteria.requestingClubId},partner_club_id.eq.${criteria.requestingClubId}`),
    supabase.from("canonical_team_types").select("id, category, age_group, gender").eq("is_active", true),
  ])

  const claimedByDirectoryId = new Map((activatedClubs ?? []).filter((c) => c.status === "active").map((c) => [c.directory_id, c.id]))
  const partnershipByClubId = new Map<string, PartnershipState>()
  for (const p of partnerships ?? []) {
    const otherClubId = p.requesting_club_id === criteria.requestingClubId ? p.partner_club_id : p.requesting_club_id
    partnershipByClubId.set(otherClubId, p.status === "active" ? "partner" : "pending")
  }

  // The requesting team's compatible canonical identities -- STRICT mode
  // (ordinary 1-v-1 fixture, not a tournament): never a cross-gender
  // pairing, never outside the same age band, mirroring
  // internal.teams_can_play_fixture exactly. eligibleOppositionCanonicalTypes
  // expects camelCase fields, so the raw (snake_case) query rows are mapped
  // first -- passing them through unmapped would silently leave `ageGroup`
  // undefined on every candidate and corrupt the age-band filter.
  const canonicalTypeCandidates = (canonicalTypes ?? []).map((t) => ({
    id: t.id,
    category: t.category,
    ageGroup: t.age_group,
    gender: t.gender,
  }))
  const compatibleTypes = eligibleOppositionCanonicalTypes(
    { category: requestingTeam.category, ageGroup: requestingTeam.ageGroup, gender: requestingTeam.gender },
    canonicalTypeCandidates,
    "strict"
  )
  const compatibleTypeIds = compatibleTypes.map((t) => t.id)
  if (compatibleTypeIds.length === 0) return { candidates: [], excludedCount: 0, criteria }

  const activeClubIds = [...claimedByDirectoryId.values()]

  // For every claimed candidate club, find their real teams that match a
  // compatible canonical identity (active or folded) -- one batched query,
  // not one per club.
  const { data: candidateTeams } =
    activeClubIds.length > 0
      ? await supabase
          .from("teams")
          .select("id, club_id, active, canonical_team_type_id")
          .in("club_id", activeClubIds)
          .in("canonical_team_type_id", compatibleTypeIds)
      : { data: [] }

  const teamsByClubId = new Map<string, { id: string; active: boolean; canonical_team_type_id: string | null }[]>()
  for (const t of candidateTeams ?? []) {
    const list = teamsByClubId.get(t.club_id) ?? []
    list.push(t)
    teamsByClubId.set(t.club_id, list)
  }

  // Resolve availability + season history only for the candidate TEAM ids
  // that actually exist (active or folded) -- unclaimed clubs and
  // claimed-but-missing-team clubs need neither query, their state is
  // already fully determined.
  const resolvableTeamIds = [...teamsByClubId.values()].flatMap((list) => list.filter((t) => t.active).map((t) => t.id))
  const availability = await resolveAvailability(supabase, resolvableTeamIds, criteria.date)
  const meetingCounts = await resolveMeetingCounts(supabase, requestingTeam.teamId, resolvableTeamIds, seasonId)

  return rankCandidates(withDistance, criteria, maxResults, {
    claimedByDirectoryId,
    partnershipByClubId,
    teamsByClubId,
    availability,
    meetingCounts,
    compatibleTypes,
    compatibleTypeIds,
  })
}

/**
 * Availability for a specific date, for a batch of real team ids -- reads
 * ONLY the canonical fixtures/fixture_requests/scheduling_groups tables,
 * never a separate store. A confirmed fixture (any status except
 * Cancelled) on the date = BOOKED. A pending, not-yet-responded request
 * naming the team for that date = PENDING_COMMITMENT (a deliberate product
 * rule, not a hard block -- the candidate could still decline it). Shared
 * scheduling-group membership means a commitment against ANY member team
 * blocks every member team, not just the one literally queried.
 */
async function resolveAvailability(
  supabase: Awaited<ReturnType<typeof createClient>>,
  teamIds: string[],
  date: string
): Promise<Map<string, FixtureAvailabilityState>> {
  const result = new Map<string, FixtureAvailabilityState>()
  if (teamIds.length === 0) return result

  const { data: groupMembers } = await supabase.from("scheduling_group_members").select("group_id, team_id").in("team_id", teamIds)
  const groupIdByTeam = new Map((groupMembers ?? []).map((m) => [m.team_id, m.group_id]))
  const teamIdsByGroup = new Map<string, string[]>()
  for (const m of groupMembers ?? []) {
    const list = teamIdsByGroup.get(m.group_id) ?? []
    list.push(m.team_id)
    teamIdsByGroup.set(m.group_id, list)
  }
  // Every team sharing a scheduling group with a queried team must also be
  // checked for a conflict, even if it wasn't itself in the input list.
  const allGroupTeamIds = [...new Set([...teamIdsByGroup.values()].flat())]
  const checkTeamIds = [...new Set([...teamIds, ...allGroupTeamIds])]

  const { data: fixturesOnDate } = await supabase
    .from("fixtures")
    .select("owning_team_id, opponent_team_id, status")
    .eq("kickoff_date", date)
    .neq("status", "Cancelled")
    .or(`owning_team_id.in.(${checkTeamIds.join(",")}),opponent_team_id.in.(${checkTeamIds.join(",")})`)

  const bookedTeamIds = new Set<string>()
  for (const f of fixturesOnDate ?? []) {
    if (f.owning_team_id) bookedTeamIds.add(f.owning_team_id)
    if (f.opponent_team_id) bookedTeamIds.add(f.opponent_team_id)
  }

  const { data: pendingRequests } = await supabase
    .from("fixture_requests")
    .select("requesting_team_id, target_team_id, status, group_id, fixture_request_groups!inner(proposed_date)")
    .eq("status", "sent")
    .eq("fixture_request_groups.proposed_date", date)
    .or(`requesting_team_id.in.(${checkTeamIds.join(",")}),target_team_id.in.(${checkTeamIds.join(",")})`)

  const pendingTeamIds = new Set<string>()
  for (const r of pendingRequests ?? []) {
    if (r.requesting_team_id) pendingTeamIds.add(r.requesting_team_id)
    if (r.target_team_id) pendingTeamIds.add(r.target_team_id)
  }

  for (const teamId of teamIds) {
    const groupId = groupIdByTeam.get(teamId)
    const groupMates = groupId ? (teamIdsByGroup.get(groupId) ?? [teamId]) : [teamId]
    const anyBooked = groupMates.some((t) => bookedTeamIds.has(t))
    const anyPending = groupMates.some((t) => pendingTeamIds.has(t))
    result.set(teamId, anyBooked ? "BOOKED" : anyPending ? "PENDING_COMMITMENT" : "AVAILABLE")
  }
  return result
}

/** Season-scoped meeting counts between the requesting team and each candidate team, using the resolved season_id (stable across an age-group rollover -- the count is by team_id, not by today's display name). */
async function resolveMeetingCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  requestingTeamId: string,
  candidateTeamIds: string[],
  seasonId: string | null
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (candidateTeamIds.length === 0 || !seasonId) return counts

  const { data: fixturesThisSeason } = await supabase
    .from("fixtures")
    .select("owning_team_id, opponent_team_id")
    .eq("season_id", seasonId)
    .neq("status", "Cancelled")
    .or(
      `and(owning_team_id.eq.${requestingTeamId},opponent_team_id.in.(${candidateTeamIds.join(",")})),and(opponent_team_id.eq.${requestingTeamId},owning_team_id.in.(${candidateTeamIds.join(",")}))`
    )

  for (const f of fixturesThisSeason ?? []) {
    const opponent = f.owning_team_id === requestingTeamId ? f.opponent_team_id : f.owning_team_id
    if (opponent) counts.set(opponent, (counts.get(opponent) ?? 0) + 1)
  }
  return counts
}
