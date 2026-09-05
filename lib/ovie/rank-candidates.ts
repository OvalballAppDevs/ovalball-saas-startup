import { fullTeamLabel } from "@/lib/teams/compact-label"

import type { FixtureAvailabilityState, OpponentSearchCriteria, OpponentSearchResult, PartnershipState, SafeOpponentCandidate } from "./types"

/**
 * The actual deterministic eligibility/exclusion/scoring rules --
 * deliberately kept in its own file, importing nothing that pulls in
 * `server-only` (opponent-search.ts itself starts with `import
 * "server-only"`, which throws on any import -- even of an unused export
 * -- outside a bundler, so this logic could never be isolated from that
 * file otherwise). This is what makes it directly `tsx`-testable with
 * hand-built candidate facts, no database or request scope required -- see
 * opponent-search.test-scenario.ts, which runs Section 28's TEST A
 * scenario against this exact function. findSuitableOpponents() in
 * opponent-search.ts is the only real caller; this is a pure extraction of
 * its existing logic, not a redesign or a second implementation.
 */
export function rankCandidates(
  withDistance: { id: string; name: string; distanceMiles: number | null }[],
  criteria: OpponentSearchCriteria,
  maxResults: number,
  lookups: {
    claimedByDirectoryId: Map<string, string>
    partnershipByClubId: Map<string, PartnershipState>
    teamsByClubId: Map<string, { id: string; active: boolean; canonical_team_type_id: string | null }[]>
    availability: Map<string, FixtureAvailabilityState>
    meetingCounts: Map<string, number>
    compatibleTypes: { id: string; category: string; ageGroup: string | null; gender: string | null }[]
    compatibleTypeIds: string[]
  }
): OpponentSearchResult {
  const { claimedByDirectoryId, partnershipByClubId, teamsByClubId, availability, meetingCounts, compatibleTypes, compatibleTypeIds } = lookups
  const results: SafeOpponentCandidate[] = []
  let excludedCount = 0

  for (const row of withDistance) {
    const clubId = claimedByDirectoryId.get(row.id) ?? null
    const partnershipState = clubId ? (partnershipByClubId.get(clubId) ?? "not_connected") : "not_connected"

    if (criteria.partnerPreference === "only" && partnershipState !== "partner") {
      excludedCount++
      continue
    }

    let fixtureAvailabilityState: FixtureAvailabilityState
    let resolvedTeam: { id: string; active: boolean; canonical_team_type_id: string | null } | undefined
    let canonicalTypeId: string = compatibleTypeIds[0]! // default to the requesting team's own identity when the club has never operated it at all (nothing to disambiguate from)

    if (!clubId) {
      fixtureAvailabilityState = "UNCLAIMED_CLUB"
      if (!criteria.includeUnclaimed) {
        excludedCount++
        continue
      }
    } else {
      const teams = teamsByClubId.get(clubId) ?? []
      resolvedTeam = teams.find((t) => t.active)
      const foldedTeam = teams.find((t) => !t.active)
      if (resolvedTeam) {
        canonicalTypeId = resolvedTeam.canonical_team_type_id ?? canonicalTypeId
        fixtureAvailabilityState = availability.get(resolvedTeam.id) ?? "AVAILABLE"
        if (fixtureAvailabilityState === "BOOKED") {
          excludedCount++
          continue // unavailable is a hard exclusion from the main list, not a low rank -- per the brief's "availability = mandatory/highest priority"
        }
      } else if (foldedTeam) {
        canonicalTypeId = foldedTeam.canonical_team_type_id ?? canonicalTypeId
        fixtureAvailabilityState = "TEAM_INACTIVE"
        if (!criteria.includeInactiveTeam) {
          excludedCount++
          continue
        }
      } else {
        fixtureAvailabilityState = "TEAM_MISSING"
        if (!criteria.includeMissingTeam) {
          excludedCount++
          continue
        }
      }
    }

    const meetingsThisSeason = resolvedTeam ? (meetingCounts.get(resolvedTeam.id) ?? 0) : 0
    if (criteria.maxPreviousMeetings != null && meetingsThisSeason >= criteria.maxPreviousMeetings) {
      excludedCount++
      continue
    }

    const canonicalType = compatibleTypes.find((t) => t.id === canonicalTypeId) ?? compatibleTypes[0]!
    const reasons: string[] = []
    if (row.distanceMiles != null) reasons.push(`${row.distanceMiles.toFixed(1)} miles away`)
    if (partnershipState === "partner") reasons.push("existing Partner Club")
    if (fixtureAvailabilityState === "UNCLAIMED_CLUB") reasons.push("not yet on Ovalball -- availability cannot be confirmed")
    else if (fixtureAvailabilityState === "TEAM_INACTIVE") reasons.push("on Ovalball, team currently inactive")
    else if (fixtureAvailabilityState === "TEAM_MISSING") reasons.push("on Ovalball, does not currently operate this team")
    else reasons.push(meetingsThisSeason === 0 ? "not played this season" : `${meetingsThisSeason} meeting${meetingsThisSeason === 1 ? "" : "s"} this season`)

    // Deterministic score: availability already gated hard exclusions
    // above, so among what remains: closer is better, partner is better,
    // fewer meetings is better, claimed+active is better than any other
    // state. Weights are intentionally simple integers, not a learned
    // model -- see opponent-search.ts's own module comment.
    let score = 0
    score += row.distanceMiles != null ? Math.max(0, 100 - row.distanceMiles) : 40
    score += partnershipState === "partner" ? 30 : partnershipState === "pending" ? 10 : 0
    score += Math.max(0, 20 - meetingsThisSeason * 10)
    score += fixtureAvailabilityState === "AVAILABLE" ? 20 : fixtureAvailabilityState === "PENDING_COMMITMENT" ? 5 : 0

    results.push({
      clubDirectoryId: row.id,
      clubDisplayName: row.name,
      canonicalTeamTypeId: canonicalTypeId,
      canonicalTeamLabel: fullTeamLabel({ category: canonicalType.category, ageGroup: canonicalType.ageGroup, gender: canonicalType.gender, squadDesignation: null }),
      approximateDistanceMiles: row.distanceMiles,
      membershipState: clubId ? "on_ovalball" : "not_on_ovalball",
      partnershipState,
      fixtureAvailabilityState,
      meetingsThisSeason,
      requestActionAvailable: true, // an unclaimed club can still be invited/recorded -- the write path itself decides the real action, search never blocks offering one
      score,
      reasons,
    })
  }

  results.sort((a, b) => b.score - a.score)
  return { candidates: results.slice(0, maxResults), excludedCount: excludedCount + Math.max(0, results.length - maxResults), criteria }
}
