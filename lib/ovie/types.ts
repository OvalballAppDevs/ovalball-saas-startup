/**
 * Ovie Phase 1 -- shared types for the opponent-matching/availability
 * domain service (lib/ovie/opponent-search.ts) and the intent/orchestration
 * layer (lib/ovie/orchestrator.ts). Kept separate from both so either can be
 * imported without pulling in the other -- the search service is meant to
 * be usable by future non-Ovie consumers (Fixture Management, Calendar,
 * Tournament invitations) per the brief's own architecture note.
 */

export type FixtureAvailabilityState =
  | "AVAILABLE"
  | "PENDING_COMMITMENT"
  | "BOOKED"
  | "TEAM_INACTIVE"
  | "TEAM_MISSING"
  | "UNCLAIMED_CLUB"

export type MembershipState = "on_ovalball" | "not_on_ovalball"
export type PartnershipState = "partner" | "pending" | "not_connected"

/** The actor context every domain-service call requires -- privacy and permission decisions are made from this, never inferred from browser-supplied club/team ids alone. Built server-side from the real authenticated session before any search runs. */
export interface OvieActorContext {
  userId: string
  /** Every club this user has some standing at, each tagged with the real capability level -- used to decide which "own team" candidates are even offered, never trusted blindly from client input. */
  clubs: {
    clubId: string
    clubName: string
    /** true if this user can create a fixture request / send an invitation on this club's behalf (club-wide CLUB_ADMIN/FIXTURE_SECRETARY, or Site Admin). */
    canManageClubFixtures: boolean
  }[]
  /** Team-scoped authority (Coach/Team Manager/Team Admin) -- present even when the user also has club-wide authority, since a team-scoped-only user's own-team candidate list must be restricted to exactly these. */
  teamScopes: { teamId: string; clubId: string; canManageTeam: boolean }[]
  isSiteAdmin: boolean
  /** true only for a genuinely view-only account (Parent/Player) -- search/narration is still allowed, but no path to a write action is ever offered, checked again server-side at the write boundary regardless of what the UI shows. */
  viewOnly: boolean
}

export interface OpponentSearchCriteria {
  requestingClubId: string
  requestingTeamId: string
  rugbyCode: "union" | "league"
  date: string // ISO yyyy-mm-dd, always resolved to an absolute date before this point -- Ovie's language layer never passes a relative phrase this far down
  radiusMiles?: number // default 20 applied by the caller when the user said "nearby" with no number
  homeAwayPreference?: "home" | "away" | null
  competitionId?: string | null
  partnerPreference?: "prefer" | "only" | "ignore"
  excludeClubDirectoryIds?: string[]
  maxPreviousMeetings?: number | null
  maxResults?: number
  includeUnclaimed?: boolean
  includeInactiveTeam?: boolean
  includeMissingTeam?: boolean
}

/**
 * The ONLY shape that ever reaches the LLM or the browser for a candidate --
 * privacy-reduced by construction (built this way inside the domain
 * service, never assembled by trimming a richer object afterwards, so
 * there's no raw-row shape upstream of this to leak from). No staff
 * contact details, no player/parent data, no raw fixture list, no message
 * content -- see lib/ovie/opponent-search.ts's own module comment for the
 * full rule.
 */
export interface SafeOpponentCandidate {
  clubDirectoryId: string
  clubDisplayName: string
  /** Null when the club doesn't operate this canonical identity at all yet (TEAM_MISSING) -- still a real, resolvable Team Directory identity, just not one club_teams row. */
  canonicalTeamTypeId: string
  canonicalTeamLabel: string // fullTeamLabel() -- e.g. "Under 12"
  /** Null when the candidate has no resolved location (can't be distance-filtered/sorted, but still returned if reached some other way -- not expected in Phase 1's radius-based search). */
  approximateDistanceMiles: number | null
  membershipState: MembershipState
  partnershipState: PartnershipState
  fixtureAvailabilityState: FixtureAvailabilityState
  meetingsThisSeason: number
  requestActionAvailable: boolean
  score: number
  reasons: string[]
}

export interface OpponentSearchResult {
  candidates: SafeOpponentCandidate[]
  /** Set only when at least one candidate was found but the eligibility/availability pass rejected it, and it's useful to say so distinctly (e.g. "1 booked, 1 excluded for already meeting twice") -- never included as a real result. */
  excludedCount: number
  criteria: OpponentSearchCriteria
}

export interface OvieTurn {
  role: "user" | "assistant"
  content: string
}

/**
 * The conversation/state shapes below are deliberately kept in this
 * import-free module rather than in orchestrator.ts (which pulls in
 * `server-only`, Supabase, and the fixture-request write path) -- the
 * "Ask Ovie" client widget (components/ovie/ask-ovie.tsx) needs to hold
 * OvieConversationState in its own React state and needs a real (non-type)
 * EMPTY_OVIE_STATE value to initialise it, and importing either from a
 * server-only module would pull that whole server module graph into the
 * client bundle -- Next.js's build fails exactly this way if it's not kept
 * separate.
 */
export interface DraftFixtureRequest {
  venuePreference: "home" | "away" | "either"
  kickoffTime: string | null
  note: string | null
  /** Resolved ONLY when venuePreference is "home" -- the requesting club's own default venue, looked up server-side (never guessed, never asked of the model). Null for "away"/"either", or when the club has no default venue set yet. */
  venueId: string | null
  venueName: string | null
}

export interface OvieConversationState {
  history: OvieTurn[]
  criteria: Partial<OpponentSearchCriteria>
  requestingTeamLabel: string | null
  lastResults: SafeOpponentCandidate[]
  selected: SafeOpponentCandidate | null
  draft: DraftFixtureRequest | null
  status: "idle" | "awaiting_selection" | "awaiting_confirmation" | "sent"
}

export const EMPTY_OVIE_STATE: OvieConversationState = {
  history: [],
  criteria: {},
  requestingTeamLabel: null,
  lastResults: [],
  selected: null,
  draft: null,
  status: "idle",
}

export interface OvieTurnResult {
  state: OvieConversationState
  reply: string
  candidates: SafeOpponentCandidate[] | null
  confirmationCard: {
    clubDisplayName: string
    teamLabel: string
    date: string
    venuePreference: string
    kickoffTime: string | null
    venueName: string | null
  } | null
  sentSummary: string | null
  error: string | null
}
