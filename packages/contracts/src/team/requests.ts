import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { loadStaffPlayers } from "./players"

type Client = SupabaseClient<Database>

/**
 * THE THINGS A TEAM IS ASKED (CA-M7): fixture requests from other clubs, call-ups for its players from
 * sibling teams, and the join codes it hands out. None of these is a new domain -- each is the website's
 * own table and operation, read through the caller's authenticated client and refused by RLS or the
 * operation itself where the caller has no business.
 */

// ---------------------------------------------------------------------------
// Fixture requests
// ---------------------------------------------------------------------------

export type FixtureRequestStatus = "draft" | "sent" | "accepted" | "declined" | "counter_proposed" | "cancelled" | "expired"

export interface TeamFixtureRequest {
  id: string
  direction: "incoming" | "outgoing"
  status: FixtureRequestStatus
  proposedDate: string | null
  preferredKickoffTime: string | null
  venuePreference: "home" | "away" | "either" | null
  /** The other side, as a club name and, where known, their team. */
  otherClub: string
  otherTeam: string | null
  gameType: string | null
  note: string | null
  createdAt: string
  decidedAt: string | null
  /**
   * CA-M11.5 negotiation (Section 9). `canNegotiate` mirrors counter_fixture_request's own scope
   * boundary (an ordinary team-to-team request, never a scheduling group or a request confirming an
   * existing fixture) -- the control is never even offered where the RPC would refuse it outright.
   * `isMyTurn` is true only when THIS team is the side that did NOT make the current standing proposal
   * -- the same responder logic the RPC itself computes, mirrored here so Accept/Decline/Suggest
   * Another are only ever offered to the side that can actually use them. `updatedAt` is passed back as
   * p_expected_updated_at for stale-proposal protection (Section 63).
   */
  canNegotiate: boolean
  isMyTurn: boolean
  updatedAt: string
  counteredDate: string | null
  counteredKickoffTime: string | null
  counteredVenuePreference: "home" | "away" | "either" | null
  counterNote: string | null
}

export const REQUEST_FIELDS =
  "id, status, venue_preference, preferred_kickoff_time, note, created_at, decided_at, updated_at, requesting_team_id, target_team_id, existing_fixture_id, countered_date, countered_kickoff_time, countered_venue_preference, counter_note, last_proposed_by_team_id, requester:teams!fixture_requests_requesting_team_id_fkey(display_name, clubs(club_directory(name))), target:teams!fixture_requests_target_team_id_fkey(display_name, clubs(club_directory(name))), fixture_request_groups(proposed_date, raw_opponent_text, game_type)"

export type RequestRow = {
  id: string
  status: string
  venue_preference: string | null
  preferred_kickoff_time: string | null
  note: string | null
  created_at: string
  decided_at: string | null
  updated_at: string
  requesting_team_id: string | null
  target_team_id: string | null
  existing_fixture_id: string | null
  countered_date: string | null
  countered_kickoff_time: string | null
  countered_venue_preference: string | null
  counter_note: string | null
  last_proposed_by_team_id: string | null
  requester: { display_name: string | null; clubs: { club_directory: { name: string | null } | null } | null } | null
  target: { display_name: string | null; clubs: { club_directory: { name: string | null } | null } | null } | null
  fixture_request_groups: { proposed_date: string | null; raw_opponent_text: string | null; game_type: string | null } | null
}

export function projectRequest(r: RequestRow, teamId: string): TeamFixtureRequest {
  const incoming = r.target_team_id === teamId
  const other = incoming ? r.requester : r.target
  const canNegotiate = r.requesting_team_id !== null && r.target_team_id !== null && r.existing_fixture_id === null
  const currentProposerTeamId = r.last_proposed_by_team_id ?? r.requesting_team_id
  const respondingTeamId = currentProposerTeamId === r.requesting_team_id ? r.target_team_id : r.requesting_team_id
  const isMyTurn = (r.status === "sent" || r.status === "counter_proposed") && respondingTeamId === teamId
  return {
    id: r.id,
    direction: incoming ? "incoming" : "outgoing",
    status: r.status as FixtureRequestStatus,
    proposedDate: r.fixture_request_groups?.proposed_date ?? null,
    preferredKickoffTime: r.preferred_kickoff_time,
    venuePreference: (r.venue_preference as TeamFixtureRequest["venuePreference"]) ?? null,
    otherClub: other?.clubs?.club_directory?.name ?? (incoming ? "Another club" : r.fixture_request_groups?.raw_opponent_text ?? "Another club"),
    otherTeam: other?.display_name ?? null,
    gameType: r.fixture_request_groups?.game_type ?? null,
    note: r.note,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    canNegotiate,
    isMyTurn,
    updatedAt: r.updated_at,
    counteredDate: r.countered_date,
    counteredKickoffTime: r.countered_kickoff_time,
    counteredVenuePreference: (r.countered_venue_preference as TeamFixtureRequest["counteredVenuePreference"]) ?? null,
    counterNote: r.counter_note,
  }
}

/**
 * Both directions for one team, most recent first. Pending in both directions is not the same job: a
 * request RECEIVED is waiting on us; a request SENT is waiting on somebody else. `sent` is the one state
 * that means "waiting for an answer" -- the check constraint has no `pending`.
 */
export async function readTeamFixtureRequests(supabase: Client, teamId: string): Promise<{ incoming: TeamFixtureRequest[]; outgoing: TeamFixtureRequest[] }> {
  const [{ data: incoming, error: e1 }, { data: outgoing, error: e2 }] = await Promise.all([
    supabase.from("fixture_requests").select(REQUEST_FIELDS).eq("target_team_id", teamId).order("created_at", { ascending: false }).limit(50),
    supabase.from("fixture_requests").select(REQUEST_FIELDS).eq("requesting_team_id", teamId).order("created_at", { ascending: false }).limit(50),
  ])
  if (e1) throw e1
  if (e2) throw e2
  return {
    incoming: ((incoming ?? []) as unknown as RequestRow[]).map((r) => projectRequest(r, teamId)),
    outgoing: ((outgoing ?? []) as unknown as RequestRow[]).map((r) => projectRequest(r, teamId)),
  }
}

/** `accept_fixture_request` re-checks `fixture.request.respond` for the responding side itself. */
export async function acceptFixtureRequest(supabase: Client, requestId: string): Promise<void> {
  const { error } = await supabase.rpc("accept_fixture_request", { p_request_id: requestId })
  if (error) throw error
}

/**
 * Declining is a plain status update the `fixture_requests_update_scoped` policy already covers -- either
 * side may decline or withdraw. No atomic multi-table write is needed the way acceptance requires.
 */
export async function declineFixtureRequest(supabase: Client, requestId: string, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from("fixture_requests")
    .update({ status: "declined", decided_by: userId, decided_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "sent")
    .select("id")
  if (error) throw error
  // A policy that filters rather than errors leaves the row untouched; say so rather than reporting a decline that did not happen.
  if (!data || data.length === 0) throw Object.assign(new Error("You can't answer this request."), { code: "42501" })
}

/**
 * CA-M11.5: "Suggest Another" -- propose an alternative date/kick-off/venue rather than accepting or
 * declining outright. Only the side that did NOT make the current standing proposal may call this;
 * `counter_fixture_request` itself re-checks `fixture.request.respond` for that side. `expectedUpdatedAt`
 * is optional stale-write protection: pass the row's own `updated_at` from the view the caller is acting
 * on, and a concurrent change surfaces as a distinct, catchable error rather than silently overwriting it.
 */
export interface CounterFixtureRequestInput {
  requestId: string
  date: string
  kickoffTime: string | null
  venuePreference: "home" | "away" | "either"
  note?: string | null
  expectedUpdatedAt?: string | null
}

export async function counterFixtureRequest(supabase: Client, input: CounterFixtureRequestInput): Promise<void> {
  const { error } = await supabase.rpc("counter_fixture_request", {
    p_request_id: input.requestId,
    p_date: input.date,
    // Nullable at the database (an alternative kick-off is optional); the generated Args type only
    // reflects "has a default", which p_kickoff_time does not, so the cast below is a codegen gap, not
    // a real runtime constraint -- confirmed against the migration's own lack of a not-null guard on it.
    p_kickoff_time: input.kickoffTime as unknown as string,
    p_venue_preference: input.venuePreference,
    p_note: input.note?.trim() || undefined,
    p_expected_updated_at: input.expectedUpdatedAt ?? undefined,
  })
  if (error) throw error
}

/**
 * CA-M11.5: the negotiation history for one request -- who proposed, countered, accepted or declined and
 * when -- read from the existing generic `audit_log` rather than a second history table.
 * `fixture_request_history` re-checks the same view authority as reading the request itself.
 */
export interface FixtureRequestHistoryEntry {
  changedAt: string
  changedByClubName: string | null
  statusBefore: string | null
  statusAfter: string | null
  dateAfter: string | null
  kickoffTimeAfter: string | null
  noteAfter: string | null
}

export async function readFixtureRequestHistory(supabase: Client, requestId: string): Promise<FixtureRequestHistoryEntry[]> {
  const { data, error } = await supabase.rpc("fixture_request_history", { p_request_id: requestId })
  if (error) throw error
  return ((data ?? []) as unknown as {
    changed_at: string
    changed_by_club_name: string | null
    status_before: string | null
    status_after: string | null
    date_after: string | null
    kickoff_time_after: string | null
    note_after: string | null
  }[]).map((r) => ({
    changedAt: r.changed_at,
    changedByClubName: r.changed_by_club_name,
    statusBefore: r.status_before,
    statusAfter: r.status_after,
    dateAfter: r.date_after,
    kickoffTimeAfter: r.kickoff_time_after,
    noteAfter: r.note_after,
  }))
}

// ---------------------------------------------------------------------------
// Call-ups ("Player Requests"): a sibling team asking for one of this team's players for one fixture.
// ---------------------------------------------------------------------------

export type CallUpStatus = "awaiting_eligibility" | "requested" | "approved" | "rejected" | "revoked"

export const CALL_UP_STATUS_LABEL: Record<CallUpStatus, string> = {
  awaiting_eligibility: "Waiting on age-grade approval",
  requested: "Waiting for a decision",
  approved: "Approved",
  rejected: "Declined",
  revoked: "Withdrawn",
}

export interface TeamCallUp {
  id: string
  status: CallUpStatus
  playerId: string
  playerName: string
  sourceTeamId: string
  sourceTeamName: string
  targetTeamId: string
  targetTeamName: string
  fixtureDate: string | null
  fixtureOpponent: string | null
  eligibilityRuleReference: string
  createdAt: string
  /** Only the SOURCE team decides. The database refuses the target regardless; this is what to draw. */
  canDecide: boolean
}

export async function readTeamCallUps(supabase: Client, teamId: string): Promise<TeamCallUp[]> {
  const { data, error } = await supabase
    .from("fixture_player_call_up")
    .select("id, status, eligibility_rule_reference, source_team_id, target_team_id, player_id, created_at, source_team:source_team_id(display_name), target_team:target_team_id(display_name), fixtures(kickoff_date, raw_opposition_text)")
    .or(`source_team_id.eq.${teamId},target_team_id.eq.${teamId}`)
    .order("created_at", { ascending: false })
    .limit(50)
  if (error) throw error
  const rows = (data ?? []) as unknown as {
    id: string
    status: string
    eligibility_rule_reference: string
    source_team_id: string
    target_team_id: string
    player_id: string
    created_at: string
    source_team: { display_name: string | null } | null
    target_team: { display_name: string | null } | null
    fixtures: { kickoff_date: string | null; raw_opposition_text: string | null } | null
  }[]
  const players = await loadStaffPlayers(supabase, rows.map((r) => r.player_id))
  return rows.map((r) => ({
    id: r.id,
    status: r.status as CallUpStatus,
    playerId: r.player_id,
    playerName: players.get(r.player_id)?.displayName || "A player",
    sourceTeamId: r.source_team_id,
    sourceTeamName: r.source_team?.display_name ?? "Another team",
    targetTeamId: r.target_team_id,
    targetTeamName: r.target_team?.display_name ?? "Another team",
    fixtureDate: r.fixtures?.kickoff_date ?? null,
    fixtureOpponent: r.fixtures?.raw_opposition_text ?? null,
    eligibilityRuleReference: r.eligibility_rule_reference,
    createdAt: r.created_at,
    canDecide: r.source_team_id === teamId && r.status === "requested",
  }))
}

export type CallUpDecision = "approve" | "reject"

export async function decideCallUp(supabase: Client, callUpId: string, decision: CallUpDecision, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc("decide_player_call_up", { p_call_up_id: callUpId, p_action: decision, p_reason: reason?.trim() || undefined })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Join codes: a credential for this team. Issuing one asks team.join_code.manage; redeeming one grants
// nothing (it creates a join request the club then reviews).
// ---------------------------------------------------------------------------

export interface TeamJoinCode {
  id: string
  codeHint: string
  useCount: number
  maxUses: number
  expiresAt: string | null
  createdAt: string | null
}

export async function readTeamJoinCodes(supabase: Client, teamId: string): Promise<TeamJoinCode[]> {
  const { data, error } = await supabase
    .from("invitations_admin_view")
    .select("id, code_hint, use_count, max_uses, expires_at, created_at")
    .eq("kind", "TEAM_JOIN_CODE")
    .eq("team_id", teamId)
    .eq("state", "ISSUED")
    .order("created_at", { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id as string,
    codeHint: (row.code_hint as string) ?? "",
    useCount: (row.use_count as number) ?? 0,
    maxUses: (row.max_uses as number) ?? 0,
    expiresAt: (row.expires_at as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
  }))
}

/** The plain code is returned ONCE, at issue; afterwards only its hint is ever readable. */
export async function issueTeamJoinCode(supabase: Client, teamId: string): Promise<{ code: string | null; token: string | null; expiresAt: string | null }> {
  const { data, error } = await supabase.rpc("issue_invitation", { p_kind: "TEAM_JOIN_CODE", p_team_id: teamId })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as { code?: string | null; token?: string | null; expires_at?: string | null } | null
  // CA-M11.1: the TOKEN is what the link and the QR carry (the website shows all three); returned once, never stored.
  return { code: row?.code ?? null, token: row?.token ?? null, expiresAt: row?.expires_at ?? null }
}

export async function revokeTeamJoinCode(supabase: Client, invitationId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: invitationId, p_reason: reason.trim() })
  if (error) throw error
}
