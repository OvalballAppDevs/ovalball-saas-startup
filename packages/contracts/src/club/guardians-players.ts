import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { loadStaffPlayers, staffPlayerAgeState, type StaffPlayer } from "../team/players"
import { readClubTeams, type ClubTeam } from "./teams"

type Client = SupabaseClient<Database>

/**
 * GUARDIANS & PLAYERS -- the club's administration of players and the adults responsible for them,
 * for both clients (CA-M11.1).
 *
 * THE WEBSITE IS THE SPECIFICATION. Every read here converges the reads its six surfaces make
 * (/club/settings/guardians, /guardian-requests, /club/join-requests, /club/player-moves, the team
 * roster and the rollover "ask their guardian" control), and every write is a thin wrapper over the
 * SAME canonical server operation with the SAME arguments the website's server action passes. No
 * relationship, player or move model exists on a client; nothing here is authority.
 *
 * WHAT A CLUB ADMINISTRATOR NEVER SEES. A date of birth reaches staff only as "what was typed" --
 * `guardian_link_requests_for_approval.submitted_date_of_birth` and a duplicate review's submitted
 * date -- exactly as the website shows them; a player's own record is read through `player_staff_view`
 * (names, an age grade, flags) and never `players`. A player's gender (`playing_pathway`) is never
 * read: the club may ASK the guardian for it (`request_player_playing_pathway`) and may not answer.
 * A guardian's email is read through `get_team_guardian_directory` alone, which the database limits
 * to family.relationship.approve at the club (or site.family.manage).
 *
 * AUTHORITY is asked of the server once per screen (`my_capabilities` at club scope) to decide what
 * to OFFER; every operation is judged again by the database, and a Club Admin inherits nothing from a
 * Safeguarding Officer here -- there is no safeguarding record in this domain at all.
 */

// ---------------------------------------------------------------------------------------------------
// Capabilities -- the catalogue keys each job asks, probed in one round trip
// ---------------------------------------------------------------------------------------------------

export const GUARDIANS_PLAYERS_KEYS = {
  /** Approve or decline a guardian link; also gates the guardian directory (with emails). */
  relationshipApprove: "family.relationship.approve",
  /** End a guardian's relationship with a child (club scope only). */
  relationshipRemove: "family.relationship.remove",
  /** Decide whether two player records are the same child. */
  duplicateResolve: "family.duplicate.resolve",
  /** Accept or decline a player asking to join the club. */
  joinRequestReview: "team.join_request.review",
  /** Archive, restore and move a player's place; decide a pending place. */
  rosterManage: "team.roster.manage",
  callupRequest: "fixture.callup.request",
  callupApprove: "fixture.callup.approve",
  dispensationRequest: "fixture.dispensation.request",
  dispensationApproveClub: "fixture.dispensation.approve_club",
  /** Ask a player's guardian to record the player's gender. The club never records it. */
  pathwayRequest: "player.pathway.request",
  profileView: "player.profile.view",
} as const

export type GuardiansPlayersCapabilities = Record<keyof typeof GUARDIANS_PLAYERS_KEYS, boolean>

export function noGuardiansPlayersCapabilities(): GuardiansPlayersCapabilities {
  return Object.fromEntries(Object.keys(GUARDIANS_PLAYERS_KEYS).map((k) => [k, false])) as GuardiansPlayersCapabilities
}

export async function readGuardiansPlayersCapabilities(supabase: Client, clubId: string): Promise<GuardiansPlayersCapabilities> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) return noGuardiansPlayersCapabilities()
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return Object.fromEntries(Object.entries(GUARDIANS_PLAYERS_KEYS).map(([k, key]) => [k, allowed.has(key)])) as GuardiansPlayersCapabilities
}

/** Whether the section is offered at all: the website gates /club/settings/guardians on this one key. */
export function canOpenGuardiansPlayers(caps: GuardiansPlayersCapabilities): boolean {
  return caps.relationshipApprove
}

// ---------------------------------------------------------------------------------------------------
// The player directory -- the website's /club/settings/guardians list, club-wide
// ---------------------------------------------------------------------------------------------------

export interface PlayerPlace {
  /** The player_team_memberships id: what archive, restore and move address. */
  membershipId: string
  teamId: string
  teamLabel: string
  compactTeamLabel: string
  status: "active" | "ended"
}

export interface PlayerGuardian {
  /** The guardians row id: what remove_guardian_relationship takes. */
  guardianId: string
  guardianUserId: string
  name: string
  /** Present only when the caller holds family.relationship.approve at the club; null otherwise. */
  email: string | null
  relationshipType: string | null
}

export interface DirectoryPlayer {
  playerId: string
  name: string
  firstName: string
  ageGrade: string | null
  isAdult: boolean
  hasLogin: boolean
  /** True when the player has no recorded gender, so the club may ask their guardian for it. */
  needsGender: boolean
  places: PlayerPlace[]
  guardians: PlayerGuardian[]
  /**
   * True only for a minor (or an unknown-age youth-protected player) with no active guardian -- the
   * website's GUARDIAN REQUIRED flag. An adult with no guardian is normal and never flagged.
   */
  needsGuardian: boolean
}

export interface ClubPlayerDirectory {
  teams: ClubTeam[]
  players: DirectoryPlayer[]
}

type MembershipRow = { id: string; player_id: string; team_id: string; status: string; ended_at: string | null }

function placeStatus(status: string): PlayerPlace["status"] {
  return status === "active" ? "active" : "ended"
}

/**
 * The website's read, shared: active places on the club's active teams, names through the staff
 * projection, guardians through the per-team directory operation. `includeEnded` adds the places a
 * restore can bring back (the detail screen's "Archived" state).
 */
export async function readClubPlayerDirectory(supabase: Client, clubId: string, caps: GuardiansPlayersCapabilities, options: { includeEnded?: boolean } = {}): Promise<ClubPlayerDirectory> {
  const directory = await readClubTeams(supabase, clubId)
  const teams = directory.teams.filter((t) => t.active)
  const teamIds = teams.map((t) => t.id)
  if (teamIds.length === 0) return { teams, players: [] }
  const byTeam = new Map(teams.map((t) => [t.id, t]))

  const statuses = options.includeEnded ? ["active", "ended"] : ["active"]
  const [{ data: membershipRows, error }, guardianResults] = await Promise.all([
    supabase.from("player_team_memberships").select("id, player_id, team_id, status, ended_at").in("team_id", teamIds).in("status", statuses),
    // Guardian names and emails come from the one operation the database limits to family.relationship.approve
    // at the club; without it the list is names of players only, exactly as the website's page would be unreachable.
    caps.relationshipApprove ? Promise.all(teamIds.map((teamId) => supabase.rpc("get_team_guardian_directory", { p_team_id: teamId }))) : Promise.resolve([]),
  ])
  if (error) throw error
  const memberships = (membershipRows ?? []) as MembershipRow[]

  const staff = await loadStaffPlayers(supabase, memberships.map((m) => m.player_id))

  const guardiansByPlayer = new Map<string, PlayerGuardian[]>()
  for (const result of guardianResults) {
    for (const row of result.data ?? []) {
      if (!row.player_id || !row.guardian_id) continue
      const list = guardiansByPlayer.get(row.player_id) ?? []
      if (!list.some((g) => g.guardianId === row.guardian_id)) {
        list.push({
          guardianId: row.guardian_id,
          guardianUserId: row.guardian_user_id ?? "",
          name: [row.guardian_first_name, row.guardian_surname].filter(Boolean).join(" ") || "Unknown",
          email: row.guardian_email ?? null,
          relationshipType: row.relationship_type ?? null,
        })
      }
      guardiansByPlayer.set(row.player_id, list)
    }
  }

  const players = new Map<string, DirectoryPlayer>()
  for (const m of memberships) {
    const player = staff.get(m.player_id)
    const team = byTeam.get(m.team_id)
    if (!player || !team) continue
    const place: PlayerPlace = { membershipId: m.id, teamId: team.id, teamLabel: team.fullLabel, compactTeamLabel: team.compactLabel, status: placeStatus(m.status) }
    const existing = players.get(player.id)
    if (existing) {
      existing.places.push(place)
      continue
    }
    players.set(player.id, {
      playerId: player.id,
      name: player.displayName,
      firstName: player.firstName,
      ageGrade: player.ageGrade,
      isAdult: player.isAdult,
      hasLogin: player.hasLogin,
      needsGender: !player.hasPlayingPathway,
      places: [place],
      guardians: guardiansByPlayer.get(player.id) ?? [],
      needsGuardian: false,
    })
  }
  for (const p of players.values()) {
    const activeTeams = p.places.filter((pl) => pl.status === "active").map((pl) => byTeam.get(pl.teamId)!).map((t) => ({ category: t.category, ageGroup: t.ageGroup }))
    const ageState = staffPlayerAgeState(staff.get(p.playerId), activeTeams)
    p.needsGuardian = activeTeams.length > 0 && p.guardians.length === 0 && (ageState === "minor" || ageState === "unknown_youth_protected")
    p.places.sort((a, b) => (a.status === b.status ? a.teamLabel.localeCompare(b.teamLabel) : a.status === "active" ? -1 : 1))
  }
  return { teams, players: [...players.values()].sort((a, b) => a.name.localeCompare(b.name)) }
}

/** The directory turned round: one row per guardian, with the children they are linked to at this club. */
export interface DirectoryGuardian {
  guardianUserId: string
  name: string
  email: string | null
  children: { playerId: string; playerName: string; guardianId: string; relationshipType: string | null }[]
}

export function guardiansFromDirectory(players: DirectoryPlayer[]): DirectoryGuardian[] {
  const map = new Map<string, DirectoryGuardian>()
  for (const p of players) {
    for (const g of p.guardians) {
      const key = g.guardianUserId || g.guardianId
      const row = map.get(key) ?? { guardianUserId: g.guardianUserId, name: g.name, email: g.email, children: [] }
      if (!row.children.some((c) => c.playerId === p.playerId)) row.children.push({ playerId: p.playerId, playerName: p.name, guardianId: g.guardianId, relationshipType: g.relationshipType })
      map.set(key, row)
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------------------------------
// Guardian link requests -- the website's /guardian-requests queue, scoped by the database
// ---------------------------------------------------------------------------------------------------

export type GuardianLinkRequestKind = "FIRST_CHILD" | "ADDITIONAL_GUARDIAN" | "SELF_ADDED_CHILD"

export interface GuardianLinkRequest {
  requestId: string
  kind: GuardianLinkRequestKind
  clubName: string
  /** The child, as the request names them: the target player for an additional guardian, else the submitted name. */
  childName: string
  requesterName: string
  invitedEmail: string | null
  /** WHAT WAS TYPED on the request, never the player's record. Shown as the website shows it. */
  submittedDateOfBirth: string | null
  matchedPlayerId: string | null
  matchedPlayerName: string | null
  matchedTeamName: string | null
  subjectResponse: string | null
  createdAt: string
  /** An additional guardian must accept before the club can approve; rejecting is always possible. */
  canApprove: boolean
}

type LinkRow = Database["public"]["Functions"]["guardian_link_requests_for_approval"]["Returns"][number]

function mapLinkRequest(r: LinkRow): GuardianLinkRequest {
  const kind = r.kind as GuardianLinkRequestKind
  return {
    requestId: r.request_id,
    kind,
    clubName: r.club_name ?? "Club",
    childName: kind === "ADDITIONAL_GUARDIAN" ? (r.target_player_name ?? "A player") : `${r.submitted_first_name ?? ""} ${r.submitted_surname ?? ""}`.trim() || "A child",
    requesterName: r.requester_name ?? "Unknown",
    invitedEmail: r.invited_email ?? null,
    submittedDateOfBirth: kind === "ADDITIONAL_GUARDIAN" ? null : (r.submitted_date_of_birth ?? null),
    matchedPlayerId: r.matched_player_id ?? null,
    matchedPlayerName: r.matched_player_name ?? null,
    matchedTeamName: r.matched_team_name ?? null,
    subjectResponse: r.subject_response ?? null,
    createdAt: r.created_at,
    canApprove: kind !== "ADDITIONAL_GUARDIAN" || r.subject_response === "ACCEPTED",
  }
}

/** Only rows the caller may decide come back: the operation applies internal.can_decide_guardian_link_request itself. */
export async function readGuardianLinkRequests(supabase: Client, clubId: string): Promise<GuardianLinkRequest[]> {
  const { data, error } = await supabase.rpc("guardian_link_requests_for_approval", { p_club_id: clubId })
  if (error) throw error
  return (data ?? []).map(mapLinkRequest)
}

/** The same operation the website's action calls, with the id alone: the request's scope is only known to the database. */
export async function approveGuardianLinkRequest(supabase: Client, requestId: string): Promise<void> {
  const { error } = await supabase.rpc("approve_guardian_link_request", { p_request_id: requestId })
  if (error) throw error
}

export async function rejectGuardianLinkRequest(supabase: Client, requestId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("reject_guardian_link_request", { p_request_id: requestId, p_note: note.trim() || undefined })
  if (error) throw error
}

// ---------------------------------------------------------------------------------------------------
// Guardian relationships -- remove, replace, ask for gender
// ---------------------------------------------------------------------------------------------------

/**
 * Club level only, a reason mandatory server-side too. `orphaned` says whether the player now has no
 * active guardian, so the screen can raise the same GUARDIAN REQUIRED warning the website raises.
 */
export async function removeGuardianRelationship(supabase: Client, guardianId: string, reason: string): Promise<{ orphaned: boolean }> {
  const { data, error } = await supabase.rpc("remove_guardian_relationship", { p_guardian_id: guardianId, p_reason: reason.trim() }).single()
  if (error) throw error
  return { orphaned: data?.orphaned === true }
}

export interface ReplacementInvitation {
  invitationId: string
  token: string
}

/**
 * A replacement is an invitation bound to this exact player, never a direct attach. The operation
 * returns the token; the WEBSITE then emails it through a server-only module a phone cannot call, so
 * a native caller shows the canonical link once instead and says plainly that no email was sent.
 */
export async function sendReplacementGuardianInvitation(supabase: Client, playerId: string, teamId: string, email: string): Promise<ReplacementInvitation> {
  const { data, error } = await supabase.rpc("send_replacement_guardian_invitation", { p_player_id: playerId, p_team_id: teamId, p_invited_email: email.trim() }).single()
  if (error) throw error
  return { invitationId: data.invitation_id, token: data.token }
}

/** The canonical acceptance address the website renders for a replacement invitation. */
export function replacementInvitationLink(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/$/, "")}/guardian-invite/${token}`
}

/** The club may ASK a guardian for a player's gender; it may not answer. Returns how many guardians were asked. */
export async function askGuardianForGender(supabase: Client, playerId: string): Promise<number> {
  const { data, error } = await supabase.rpc("request_player_playing_pathway", { p_player_id: playerId })
  if (error) throw error
  return data ?? 0
}

// ---------------------------------------------------------------------------------------------------
// Duplicate player reviews -- the website's /club/settings/guardians queue
// ---------------------------------------------------------------------------------------------------

export interface DuplicateReview {
  reviewId: string
  teamLabel: string
  submittedName: string
  /** WHAT WAS TYPED by the applicant; the existing player's own date of birth stays with their family. */
  submittedDateOfBirth: string | null
  matchedPlayerId: string
  matchedName: string
  matchedAgeGrade: string | null
  createdAt: string | null
}

export async function readDuplicateReviews(supabase: Client, teams: ClubTeam[]): Promise<DuplicateReview[]> {
  const teamIds = teams.map((t) => t.id)
  if (teamIds.length === 0) return []
  const { data, error } = await supabase
    .from("player_duplicate_reviews")
    .select("id, team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id, created_at")
    .in("team_id", teamIds)
    .eq("status", "pending")
    .order("created_at")
  if (error) throw error
  const rows = data ?? []
  const staff = await loadStaffPlayers(supabase, rows.map((r) => r.matched_player_id))
  const byTeam = new Map(teams.map((t) => [t.id, t]))
  return rows.map((r) => ({
    reviewId: r.id,
    teamLabel: byTeam.get(r.team_id)?.fullLabel ?? "Team",
    submittedName: `${r.submitted_first_name} ${r.submitted_surname}`,
    submittedDateOfBirth: r.submitted_date_of_birth ?? null,
    matchedPlayerId: r.matched_player_id,
    matchedName: staff.get(r.matched_player_id)?.displayName || "Unknown",
    matchedAgeGrade: staff.get(r.matched_player_id)?.ageGrade ?? null,
    createdAt: r.created_at ?? null,
  }))
}

/** "Same child": links the original applicant to the existing player. Terminal; the operation takes no reason. */
export async function resolveDuplicateAsExisting(supabase: Client, reviewId: string): Promise<void> {
  const { error } = await supabase.rpc("resolve_player_duplicate_review_as_existing", { p_review_id: reviewId })
  if (error) throw error
}

/** "Different child": creates the new player from what the applicant already submitted. Terminal. */
export async function resolveDuplicateAsNew(supabase: Client, reviewId: string): Promise<void> {
  const { error } = await supabase.rpc("resolve_player_duplicate_review_as_new", { p_review_id: reviewId })
  if (error) throw error
}

// ---------------------------------------------------------------------------------------------------
// Pending team places -- a child a parent added directly, waiting for the club to confirm the team
// ---------------------------------------------------------------------------------------------------

export interface PendingTeamPlace {
  membershipId: string
  playerId: string
  playerName: string
  playerAgeGrade: string | null
  teamLabel: string
  guardianName: string
}

export async function readPendingTeamPlaces(supabase: Client, teams: ClubTeam[]): Promise<PendingTeamPlace[]> {
  const teamIds = teams.map((t) => t.id)
  if (teamIds.length === 0) return []
  const { data, error } = await supabase.from("player_team_memberships").select("id, player_id, team_id").in("team_id", teamIds).eq("status", "pending")
  if (error) throw error
  const rows = data ?? []
  if (rows.length === 0) return []
  const staff = await loadStaffPlayers(supabase, rows.map((r) => r.player_id))
  // The adult who added the child: their relationship is PENDING_APPROVAL (or already ACTIVE) -- names only.
  const { data: links } = await supabase.from("guardians").select("player_id, guardian_user_id").in("player_id", rows.map((r) => r.player_id)).in("state", ["ACTIVE", "PENDING_APPROVAL"])
  const userIds = (links ?? []).map((g) => g.guardian_user_id)
  const { data: profiles } = userIds.length > 0 ? await supabase.from("profiles").select("id, first_name, surname").in("id", userIds) : { data: [] }
  const nameByUser = new Map((profiles ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ")]))
  const guardianByPlayer = new Map<string, string>()
  for (const g of links ?? []) guardianByPlayer.set(g.player_id, nameByUser.get(g.guardian_user_id) || "A parent")
  const byTeam = new Map(teams.map((t) => [t.id, t]))
  return rows
    .filter((r) => staff.has(r.player_id))
    .map((r) => ({
      membershipId: r.id,
      playerId: r.player_id,
      playerName: staff.get(r.player_id)!.displayName,
      playerAgeGrade: staff.get(r.player_id)!.ageGrade,
      teamLabel: byTeam.get(r.team_id)?.fullLabel ?? "Team",
      guardianName: guardianByPlayer.get(r.player_id) ?? "A parent",
    }))
}

// ---------------------------------------------------------------------------------------------------
// Players asking to join the club -- the website's /club/join-requests
// ---------------------------------------------------------------------------------------------------

export interface PlayerJoinRequest {
  requestId: string
  playerId: string
  playerName: string
  clubId: string
  clubName: string
  /** What Ovalball resolved when the player asked -- "Under 12 Girls". The club chooses the side. */
  resolvedCategory: string | null
  requestedAt: string
}

export async function readPlayerJoinRequests(supabase: Client, clubId: string): Promise<PlayerJoinRequest[]> {
  const { data, error } = await supabase
    .from("player_club_join_requests")
    .select("id, player_id, club_id, resolved_category, status, created_at, clubs(club_directory(name))")
    .eq("club_id", clubId)
    .eq("status", "pending")
    .order("created_at")
  if (error) throw error
  const rows = data ?? []
  const staff = await loadStaffPlayers(supabase, rows.map((r) => r.player_id))
  return rows.map((r) => ({
    requestId: r.id,
    playerId: r.player_id,
    playerName: staff.get(r.player_id)?.displayName || "Unknown player",
    clubId: r.club_id,
    clubName: (r.clubs?.club_directory as unknown as { name: string } | null)?.name ?? "This club",
    resolvedCategory: r.resolved_category,
    requestedAt: r.created_at,
  }))
}

export type JoinRequestOutcome = { ok: true } | { ok: false; alreadyResolved: true; error: string }

const ALREADY_RESOLVED = "already been resolved"

/**
 * Two managers may resolve the same request; the first legitimate one settles it. "Already resolved"
 * is a real answer, not a failure, so it is returned as one. Any other refusal is thrown.
 */
export async function approvePlayerJoinRequest(supabase: Client, requestId: string, teamId: string): Promise<JoinRequestOutcome> {
  const { error } = await supabase.rpc("approve_player_club_join_request", { p_request_id: requestId, p_team_id: teamId })
  if (error && error.message.includes(ALREADY_RESOLVED)) return { ok: false, alreadyResolved: true, error: error.message }
  if (error) throw error
  return { ok: true }
}

export async function declinePlayerJoinRequest(supabase: Client, requestId: string, reason: string): Promise<JoinRequestOutcome> {
  const { error } = await supabase.rpc("decline_player_club_join_request", { p_request_id: requestId, p_reason: reason.trim() || undefined })
  if (error && error.message.includes(ALREADY_RESOLVED)) return { ok: false, alreadyResolved: true, error: error.message }
  if (error) throw error
  return { ok: true }
}

// ---------------------------------------------------------------------------------------------------
// A player's place -- archive, restore, move
// ---------------------------------------------------------------------------------------------------

/**
 * MOVE TO ANOTHER SIDE. `move_player_team_membership` is canonical, granted through team.roster.manage
 * on BOTH sides and race-tested -- and the website has no control for it. The phone offers it as the
 * operation it is: ends the current place and opens one on the other side in one transaction, with the
 * reason the server records (optional there; the screen asks for one).
 */
export async function movePlayerTeamPlace(supabase: Client, membershipId: string, targetTeamId: string, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc("move_player_team_membership", { p_membership_id: membershipId, p_target_team_id: targetTeamId, p_reason: reason.trim() || undefined })
  if (error) throw error
  return data as string
}

// ---------------------------------------------------------------------------------------------------
// Player moves -- call-ups for one fixture, dispensations for a season (the website's /club/player-moves)
// ---------------------------------------------------------------------------------------------------

export type CallUpStatus = "awaiting_eligibility" | "requested" | "approved" | "rejected" | "revoked"
export type DispensationStatus = "requested" | "source_team_approved" | "club_approved" | "approved" | "rejected" | "expired" | "revoked"
export type DispensationStage = "source_team" | "club" | "governing_body"
export type CallUpAction = "approve" | "reject" | "revoke"

export const CALL_UP_STATUS_LABEL: Record<CallUpStatus, string> = {
  awaiting_eligibility: "Waiting on age-grade approval",
  requested: "Awaiting source-team decision",
  approved: "Approved",
  rejected: "Rejected",
  revoked: "Revoked",
}

export const DISPENSATION_STATUS_LABEL: Record<DispensationStatus, string> = {
  requested: "Awaiting source-team approval",
  source_team_approved: "Awaiting club approval",
  club_approved: "Awaiting governing-body approval",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  revoked: "Revoked",
}

export interface MoveTeamOption {
  id: string
  label: string
  category: string
  ageGroup: string | null
  gender: string | null
}

export interface MoveFixtureOption {
  id: string
  owningTeamId: string
  kickoffDate: string
  opponentLabel: string
}

export interface MovePlayerOption {
  playerId: string
  playerName: string
  currentTeamId: string
  currentTeamName: string
  category: string
  ageGroup: string | null
  gender: string | null
}

export interface ClubCallUp {
  id: string
  playerName: string
  sourceTeamId: string
  sourceTeamName: string
  targetTeamName: string
  fixtureDate: string | null
  fixtureOpponent: string | null
  eligibilityRuleReference: string
  status: CallUpStatus
  /** The SOURCE team decides; drawn only where the source side is one of this club's. The server refuses regardless. */
  canDecide: boolean
}

export interface ClubDispensation {
  id: string
  playerName: string
  sourceTeamId: string
  sourceTeamName: string
  targetTeamName: string
  seasonName: string
  eligibilityRuleReference: string
  governingBodyReference: string | null
  status: DispensationStatus
  canDecideSourceTeam: boolean
}

export interface ClubPlayerMoves {
  teams: MoveTeamOption[]
  fixtures: MoveFixtureOption[]
  players: MovePlayerOption[]
  /** The canonical season covering today for the club's code, from the Seasons register; null when none is recorded. */
  season: { id: string; name: string } | null
  callUps: ClubCallUp[]
  dispensations: ClubDispensation[]
}

/** Same age grade means the player is ordinarily eligible; anything else previews the computed requirement. */
export function sameAgeGroup(a: { category: string; ageGroup: string | null; gender: string | null }, b: { category: string; ageGroup: string | null; gender: string | null }): boolean {
  return a.category === b.category && a.ageGroup === b.ageGroup && (a.gender ?? "") === (b.gender ?? "")
}

export async function readClubPlayerMoves(supabase: Client, clubId: string, caps: GuardiansPlayersCapabilities, todayIso: string): Promise<ClubPlayerMoves> {
  const [directory, { data: club }] = await Promise.all([readClubTeams(supabase, clubId), supabase.from("clubs").select("id, club_directory(rugby_code)").eq("id", clubId).maybeSingle()])
  const teams = directory.teams.filter((t) => t.active)
  const teamIds = teams.map((t) => t.id)
  const rugbyCode = club?.club_directory?.rugby_code ?? directory.rugbyCode ?? "union"
  const none: ClubPlayerMoves = { teams: [], fixtures: [], players: [], season: null, callUps: [], dispensations: [] }
  if (teamIds.length === 0) return none
  const idList = teamIds.join(",")

  const [{ data: memberships }, { data: fixtureRows }, { data: season }, { data: callUpRows }, { data: dispensationRows }] = await Promise.all([
    supabase.from("player_team_memberships").select("player_id, team_id").eq("status", "active").is("ended_at", null).in("team_id", teamIds),
    supabase.from("fixtures").select("id, owning_team_id, kickoff_date, raw_opposition_text").in("owning_team_id", teamIds).gte("kickoff_date", todayIso).neq("status", "Cancelled").order("kickoff_date"),
    // The one season register: the season whose canonical dates cover today, never a computed cutoff.
    supabase.from("seasons").select("id, name").eq("rugby_code", rugbyCode).eq("is_regression_fixture", false).lte("starts_on", todayIso).gte("ends_on", todayIso).limit(1).maybeSingle(),
    caps.callupRequest || caps.callupApprove
      ? supabase
          .from("fixture_player_call_up")
          .select("id, status, eligibility_rule_reference, source_team_id, target_team_id, player_id, created_at, source_team:source_team_id(display_name), target_team:target_team_id(display_name), fixtures(kickoff_date, raw_opposition_text)")
          .or(`source_team_id.in.(${idList}),target_team_id.in.(${idList})`)
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: null }),
    caps.dispensationRequest || caps.dispensationApproveClub
      ? supabase
          .from("player_team_dispensation")
          .select("id, status, eligibility_rule_reference, governing_body_reference, source_team_id, target_team_id, player_id, created_at, source_team:source_team_id(display_name), target_team:target_team_id(display_name), seasons(name)")
          .or(`source_team_id.in.(${idList}),target_team_id.in.(${idList})`)
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: null }),
  ])

  const byTeam = new Map(teams.map((t) => [t.id, t]))
  const memberRows = (memberships ?? []) as { player_id: string; team_id: string }[]
  const callUps = (callUpRows ?? []) as unknown as {
    id: string
    status: string
    eligibility_rule_reference: string
    source_team_id: string
    target_team_id: string
    player_id: string
    source_team: { display_name: string | null } | null
    target_team: { display_name: string | null } | null
    fixtures: { kickoff_date: string | null; raw_opposition_text: string | null } | null
  }[]
  const dispensations = (dispensationRows ?? []) as unknown as {
    id: string
    status: string
    eligibility_rule_reference: string
    governing_body_reference: string | null
    source_team_id: string
    target_team_id: string
    player_id: string
    source_team: { display_name: string | null } | null
    target_team: { display_name: string | null } | null
    seasons: { name: string | null } | null
  }[]
  const staff = await loadStaffPlayers(supabase, [...memberRows.map((m) => m.player_id), ...callUps.map((r) => r.player_id), ...dispensations.map((r) => r.player_id)])
  const clubTeamIds = new Set(teamIds)

  return {
    teams: teams.map((t) => ({ id: t.id, label: t.fullLabel, category: t.category, ageGroup: t.ageGroup, gender: t.gender })),
    fixtures: (fixtureRows ?? []).map((f) => ({ id: f.id, owningTeamId: f.owning_team_id, kickoffDate: f.kickoff_date, opponentLabel: f.raw_opposition_text })),
    players: memberRows
      .filter((m) => staff.has(m.player_id) && byTeam.has(m.team_id))
      .map((m) => {
        const t = byTeam.get(m.team_id)!
        return { playerId: m.player_id, playerName: staff.get(m.player_id)!.displayName, currentTeamId: t.id, currentTeamName: t.fullLabel, category: t.category, ageGroup: t.ageGroup, gender: t.gender }
      })
      .sort((a, b) => a.playerName.localeCompare(b.playerName)),
    season: season ? { id: season.id, name: season.name } : null,
    callUps: callUps.map((r) => ({
      id: r.id,
      playerName: staff.get(r.player_id)?.displayName || "A player",
      sourceTeamId: r.source_team_id,
      sourceTeamName: r.source_team?.display_name ?? "Another team",
      targetTeamName: r.target_team?.display_name ?? "Another team",
      fixtureDate: r.fixtures?.kickoff_date ?? null,
      fixtureOpponent: r.fixtures?.raw_opposition_text ?? null,
      eligibilityRuleReference: r.eligibility_rule_reference,
      status: r.status as CallUpStatus,
      canDecide: clubTeamIds.has(r.source_team_id),
    })),
    dispensations: dispensations.map((r) => ({
      id: r.id,
      playerName: staff.get(r.player_id)?.displayName || "A player",
      sourceTeamId: r.source_team_id,
      sourceTeamName: r.source_team?.display_name ?? "Another team",
      targetTeamName: r.target_team?.display_name ?? "Another team",
      seasonName: r.seasons?.name ?? "Unknown season",
      eligibilityRuleReference: r.eligibility_rule_reference,
      governingBodyReference: r.governing_body_reference ?? null,
      status: r.status as DispensationStatus,
      canDecideSourceTeam: clubTeamIds.has(r.source_team_id),
    })),
  }
}

export interface MovementEligibilityPreview {
  requirement: string
  reason: string
  governingBody: string | null
  restrictions: string | null
}

/** The computed requirement for a player from another age grade, before anything is requested. */
export async function previewMovementEligibility(supabase: Client, playerId: string, sourceTeamId: string, targetTeamId: string): Promise<MovementEligibilityPreview | null> {
  const { data, error } = await supabase.rpc("preview_player_movement_eligibility", { p_player_id: playerId, p_source_team_id: sourceTeamId, p_target_team_id: targetTeamId }).single()
  if (error || !data) return null
  return { requirement: data.requirement, reason: data.reason, governingBody: data.governing_body ?? null, restrictions: data.restrictions ?? null }
}

export async function requestCallUp(supabase: Client, input: { fixtureId: string; playerId: string; sourceTeamId: string; targetTeamId: string; eligibilityRuleReference: string }): Promise<string> {
  const { data, error } = await supabase.rpc("request_player_call_up", {
    p_fixture_id: input.fixtureId,
    p_player_id: input.playerId,
    p_source_team_id: input.sourceTeamId,
    p_target_team_id: input.targetTeamId,
    p_eligibility_rule_reference: input.eligibilityRuleReference.trim(),
  })
  if (error) throw error
  return data as string
}

export async function decideClubCallUp(supabase: Client, callUpId: string, action: CallUpAction, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc("decide_player_call_up", { p_call_up_id: callUpId, p_action: action, p_reason: reason?.trim() || undefined })
  if (error) throw error
}

export async function requestDispensation(supabase: Client, input: { playerId: string; sourceTeamId: string; targetTeamId: string; seasonId: string; eligibilityRuleReference: string }): Promise<string> {
  const { data, error } = await supabase.rpc("request_player_dispensation", {
    p_player_id: input.playerId,
    p_source_team_id: input.sourceTeamId,
    p_target_team_id: input.targetTeamId,
    p_season_id: input.seasonId,
    p_eligibility_rule_reference: input.eligibilityRuleReference.trim(),
  })
  if (error) throw error
  return data as string
}

/** Each stage in turn; approving the final stage only RECORDS a governing-body reference the club holds. */
export async function decideDispensation(supabase: Client, dispensationId: string, stage: DispensationStage, approve: boolean, governingBodyReference: string | null, reason: string | null): Promise<void> {
  const { error } = await supabase.rpc("decide_player_dispensation", {
    p_id: dispensationId,
    p_stage: stage,
    p_approve: approve,
    p_governing_body_reference: governingBodyReference?.trim() || undefined,
    p_reason: reason?.trim() || undefined,
  })
  if (error) throw error
}

export async function revokeDispensation(supabase: Client, dispensationId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_player_dispensation", { p_id: dispensationId, p_reason: reason.trim() })
  if (error) throw error
}

// ---------------------------------------------------------------------------------------------------
// Errors -- the server's own sentence for the outcomes it writes, one rule for both clients
// ---------------------------------------------------------------------------------------------------

export function guardiansPlayersErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "23514" || e.code === "23505" || e.code === "P0001" || e.code === "P0002") return e.message || fallback
  return fallback
}

export type { StaffPlayer }
export type { ClubTeam }
