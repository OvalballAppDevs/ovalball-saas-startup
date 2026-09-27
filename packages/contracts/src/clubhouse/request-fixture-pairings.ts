import { teamCategoryVocabulary, type ClubTeam } from "../club/teams"
import type { CompatibleTeam } from "./club-detail"
import { findFixtureWeekLabel, otherWeekCommitmentsForOpponent, type CandidateAvailabilityBatchRow, type GameWeekCommitmentRow } from "./find-fixture"
import type { ClubPartnershipStatus } from "./map-read-model"

/**
 * THE REQUEST FIXTURES PAIRING LIST (owner correction pass, Sections 2/16): the ONE shared computation
 * behind both the Public Club Profile's own read-only Availability rows and the dedicated Request
 * Fixtures composer's selectable rows -- never two separately-maintained lists. That split is exactly
 * how the composer used to lose every pairing but the first one: the profile screen's own Availability
 * tab already built the full, correct list, but the handoff to the (general, single-opponent)
 * `/fixtures/new` composer manually read only `compatibleTeams[0]`, discarding the rest. Pinning the
 * ONE function both screens call removes the seam where that could happen again.
 */

export interface RequestFixtureAvailabilityContext {
  date: string
  availability: readonly CandidateAvailabilityBatchRow[]
  weekRows: readonly GameWeekCommitmentRow[]
}

/** "Which of a candidate opposition team's dates are genuinely clear" -- one calculation shared by
 * every caller that needs a per-team week status, so the Availability tab and the Request Fixtures
 * composer's own disabled-row explanations can never quietly disagree. */
export function candidateWeekStatusLabel(teamId: string, context: RequestFixtureAvailabilityContext, partnershipStatus: ClubPartnershipStatus): { primary: string; detail: string | null } {
  const exact = context.availability.find((r) => r.opponent_team_id === teamId && r.the_date === context.date)
  const dateState = exact ? (exact.status === "busy" ? "busy" : "tentative") : partnershipStatus === "active" ? "no_known_clash" : "unknown"
  const otherWeekCommitments = otherWeekCommitmentsForOpponent(teamId, context.date, context.weekRows)
  return findFixtureWeekLabel({ dateState, otherWeekCommitments })
}

/** The only shape this module's pairing logic actually needs from a viewer's own team -- deliberately
 * a `Pick`, not the full `ClubTeam`, so a caller (or a test) never has to fabricate roster fields
 * (`fullLabel`, `rugbyCode`, ...) this logic has no use for. */
export type ViewerTeamLike = Pick<ClubTeam, "id" | "displayName" | "category" | "ageGroup" | "gender">

/** Real rugby-natural matching -- same age grade and gender for a youth side, same gender alone for a
 * senior side (both sides' own `ageGroup` is null there) -- never a guess, the exact rule the server's
 * own compatibility check already applies. Returns null only if the viewer's roster hasn't loaded yet,
 * or genuinely has no matching side. */
export function pairViewerTeamForOpponent<T extends ViewerTeamLike>(opponent: CompatibleTeam, viewerTeams: readonly T[] | null): T | null {
  if (!viewerTeams) return null
  if (opponent.ageGroup) return viewerTeams.find((t) => t.ageGroup === opponent.ageGroup && t.gender === opponent.gender) ?? null
  return viewerTeams.find((t) => t.category === "senior" && t.gender === opponent.gender) ?? null
}

export interface ExistingFixtureRequestLike {
  ourTeamId: string
  otherClub: string
  status: string
  direction: "incoming" | "outgoing"
}

/** A real, already-outstanding fixture request for this exact team against this exact club -- checked
 * before ever offering a second Request action, which the canonical duplicate-request guard would
 * refuse anyway. `sent`/`counter_proposed` are the two "still live, waiting on somebody" states. */
export function existingFixtureRequestFor<T extends ExistingFixtureRequestLike>(
  viewerTeamId: string,
  clubName: string,
  requests: { incoming: readonly T[]; outgoing: readonly T[] } | null
): T | null {
  if (!requests) return null
  return [...requests.outgoing, ...requests.incoming].find((r) => r.ourTeamId === viewerTeamId && r.otherClub === clubName && (r.status === "sent" || r.status === "counter_proposed")) ?? null
}

export type RequestFixtureRowStatus = "clear" | "busy" | "pending" | "unknown"

export interface RequestFixturePairing {
  myTeamId: string
  myTeamLabel: string
  myTeamCategory: string
  opponentTeamId: string
  opponentTeamLabel: string
  status: RequestFixtureRowStatus
  /** A short, already-plain-language explanation for a row that cannot be selected -- never rendered
   * at all when nothing further is truthfully known. */
  detail: string | null
}

export function buildRequestFixturePairings<TTeam extends ViewerTeamLike, TRequest extends ExistingFixtureRequestLike>({
  compatibleTeams,
  availabilityContext,
  viewerTeams,
  existingRequests,
  clubName,
  partnershipStatus,
}: {
  compatibleTeams: readonly CompatibleTeam[]
  availabilityContext: RequestFixtureAvailabilityContext
  viewerTeams: readonly TTeam[] | null
  existingRequests: { incoming: readonly TRequest[]; outgoing: readonly TRequest[] } | null
  clubName: string
  partnershipStatus: ClubPartnershipStatus
}): RequestFixturePairing[] {
  return compatibleTeams.flatMap((opponentTeam): RequestFixturePairing[] => {
    const ourTeam = pairViewerTeamForOpponent(opponentTeam, viewerTeams)
    if (!ourTeam) return []
    const base = {
      myTeamId: ourTeam.id,
      myTeamLabel: ourTeam.displayName,
      myTeamCategory: teamCategoryVocabulary(ourTeam),
      opponentTeamId: opponentTeam.teamId,
      opponentTeamLabel: opponentTeam.displayName,
    }
    const existing = existingFixtureRequestFor(ourTeam.id, clubName, existingRequests)
    if (existing) {
      return [{ ...base, status: "pending", detail: existing.direction === "incoming" ? "Request received" : "Request pending" }]
    }
    const label = candidateWeekStatusLabel(opponentTeam.teamId, availabilityContext, partnershipStatus)
    const status: RequestFixtureRowStatus = label.primary === "No known clash" ? "clear" : label.primary === "Availability unknown" ? "unknown" : "busy"
    return [{ ...base, status, detail: status === "busy" ? "Fixture booked this week" : null }]
  })
}
