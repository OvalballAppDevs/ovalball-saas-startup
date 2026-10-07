import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { REASON_REQUIRED_OPERATIONS, type ReasonRequiredOperation } from "../required-reasons"
import {
  CLUB_ROLE_LABEL,
  canonicalRoleLabel,
  clubAccessToLegacyRole,
  roleDisplayLabel,
  TEAM_PERMISSION_LABEL,
  type ClubAccessKey,
  type ClubRole,
  type TeamStaffPermission,
} from "../role-labels"

type Client = SupabaseClient<Database>

/**
 * THE CLUB'S PEOPLE -- ONE REGISTER, for both clients (CA-M3, rebuilt by People & Invitations).
 *
 * WHO BELONGS: the club's members (accounts) in every live state; the players placed in the club's
 * teams (only to a caller who may already read every roster -- Club Admin, Safeguarding Officer, site
 * support); and the invitations still open. One person is one row: a player whose own account is a
 * member is the member's row, with their teams on it.
 *
 * WHAT THEY CAN DO vs WHAT THEY DO: `access` is the one seat (Club Admin, Fixture Secretary, Member);
 * `teamRoles`, `additionalRoles` and `clubTitle` are what they do. The filters keep the two apart --
 * Admins is club access, Staff is what people do -- and Deactivated is a lifecycle STATE, never a kind
 * of person: it is not mixed into All and is offered only where there is somebody in it.
 *
 * READ: `club_people`, one paged, searched, filtered read model (people.member.view; an email only
 * under people.member.view_contact). WRITES: each existing operation with its own authority and its
 * own reason rule, consulted from the one shared list (`REASON_REQUIRED_OPERATIONS`). Team roles are
 * ADDITIVE -- assign_role / transition_role_assignment, one role at a time. The old seat switch that
 * replaced a person's other Coach/Manager/Team Admin roles on a team is not called from here.
 */

/** The register's filter chips. Deactivated is not a chip: it is reached from its own quiet line. */
export type PeopleFilter = "all" | "players" | "staff" | "admins" | "pending" | "deactivated"

export const PEOPLE_FILTERS: { key: PeopleFilter; label: string; needsPlayers?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "players", label: "Players", needsPlayers: true },
  { key: "staff", label: "Staff" },
  { key: "admins", label: "Admins" },
  { key: "pending", label: "Pending" },
]

export type MembershipState = "ACTIVE" | "SUSPENDED" | "PENDING" | "INVITED"

/**
 * How each state reads. SUSPENDED is the membership's only reversible pause -- access gone, roles
 * paused, account and history kept, restorable -- which is what the club calls Deactivated.
 */
export const MEMBERSHIP_STATE_LABEL: Record<MembershipState, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Deactivated",
  PENDING: "Waiting for Approval",
  INVITED: "Invited",
}

export interface TeamRoleRow {
  /** The role_assignments id -- what transition_role_assignment and set_team_role_title take. */
  id: string
  teamId: string
  teamDisplayName: string
  roleKey: string
  /** The catalogue's label for the role. */
  label: string
  /** The team title, stored form (HEAD_COACH, ASSISTANT_COACH or the words typed). */
  title: string | null
  state: "ACTIVE" | "SUSPENDED"
  /** Legacy projection value (coach / manager / team_admin) for the readers that still use it. */
  permission: TeamStaffPermission | null
}

export interface AdditionalRoleRow {
  id: string
  roleKey: string
  label: string
  state: "ACTIVE" | "SUSPENDED"
  confirmationState: "PENDING_CONFIRMATION" | "CONFIRMED" | null
}

export interface PlayerTeamRow {
  teamId: string
  teamDisplayName: string
  state: "ACTIVE" | "PENDING"
}

export interface InvitationOfferTeam {
  id: string
  teamDisplayName: string
  roles: string[]
  titles: Record<string, string>
}

/** What an open invitation will grant when it is accepted, as the server stored it. */
export interface InvitationOffer {
  clubRoles: string[]
  teams: InvitationOfferTeam[]
  /** "PLAYER" for a personal invitation to a player (a single-use team code). */
  audience: string | null
}

export interface ClubPerson {
  kind: "member" | "player" | "invited"
  membershipId: string | null
  userId: string | null
  playerId: string | null
  firstName: string | null
  surname: string | null
  /** Null unless the caller holds people.member.view_contact. */
  email: string | null
  /** A member's avatar is the person's (profile) avatar; a player row's is the player's own. */
  avatarStoragePath: string | null
  /** Legacy seat value, kept for the readers that use it. */
  role: ClubRole | null
  /** The one level of club access. */
  access: ClubAccessKey | null
  state: MembershipState
  /** CLUB or SITE: a SITE-level deactivation is lifted only by Ovalball. */
  suspendedLevel: "CLUB" | "SITE" | null
  since: string | null
  /** What they do for the club, in the club's words. Grants nothing. */
  clubTitle: string | null
  teamRoles: TeamRoleRow[]
  additionalRoles: AdditionalRoleRow[]
  playerTeams: PlayerTeamRow[]
  invitationId: string | null
  invitationKind: "CLUB_STAFF" | "TEAM_JOIN_CODE" | null
  invitationEmail: string | null
  /** The invitation's own free-text role (its "role at the club"). */
  invitationRole: string | null
  invitationName: string | null
  invitationOffer: InvitationOffer | null
  invitedByName: string | null
  invitationSentAt: string | null
  invitationExpiresAt: string | null
  isSelf: boolean
}

export interface ClubPeoplePage {
  people: ClubPerson[]
  total: number
}

export function personName(p: Pick<ClubPerson, "firstName" | "surname" | "invitationEmail"> & { invitationName?: string | null }): string {
  const name = [p.firstName, p.surname].filter(Boolean).join(" ").trim()
  return name || p.invitationName || p.invitationEmail || "Unknown"
}

export interface ClubPeopleQuery {
  search?: string
  /** A chip, or one of the legacy words the server still answers (members = neither staff nor admin). */
  filter?: PeopleFilter | "members" | "invited"
  limit?: number
  offset?: number
  /** Only the holders of one role (CLUB_ADMIN, COACH, VOLUNTEER ...). */
  roleKey?: string
  /** Only the people with one title (club or team), compared without case. */
  title?: string
}

export async function readClubPeople(supabase: Client, clubId: string, options: ClubPeopleQuery = {}): Promise<ClubPeoplePage> {
  const { data, error } = await supabase.rpc("club_people", {
    p_club_id: clubId,
    p_search: options.search?.trim() || undefined,
    p_filter: options.filter ?? "all",
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
    p_role_key: options.roleKey || undefined,
    p_title: options.title?.trim() || undefined,
  })
  if (error) throw error
  const rows = data ?? []
  return { people: rows.map(mapPerson), total: rows[0]?.total_count != null ? Number(rows[0].total_count) : rows.length }
}

export async function readClubPerson(supabase: Client, clubId: string, membershipId: string): Promise<ClubPerson | null> {
  const { data, error } = await supabase.rpc("club_people", { p_club_id: clubId, p_membership_id: membershipId, p_limit: 1 })
  if (error) throw error
  const row = (data ?? [])[0]
  return row ? mapPerson(row) : null
}

type Row = Database["public"]["Functions"]["club_people"]["Returns"][number]

type RawTeamRole = { id: string; team_id: string; team_display_name: string; permission: string | null; role_key?: string; label?: string; title?: string | null; state?: string }
type RawOfferTeam = { id: string; team_display_name: string; roles?: string[]; titles?: Record<string, string> }

function mapPerson(r: Row): ClubPerson {
  const offer = (r.invitation_offer ?? null) as unknown as { club_roles?: string[]; teams?: RawOfferTeam[]; audience?: string } | null
  return {
    kind: r.kind as ClubPerson["kind"],
    membershipId: r.membership_id,
    userId: r.user_id,
    playerId: r.player_id,
    firstName: r.first_name,
    surname: r.surname,
    email: r.email,
    avatarStoragePath: r.avatar_storage_path,
    role: (r.role as ClubRole) ?? null,
    access: (r.access as ClubAccessKey) ?? null,
    state: r.state as MembershipState,
    suspendedLevel: (r.suspended_level as ClubPerson["suspendedLevel"]) ?? null,
    since: r.since,
    clubTitle: r.governance_title ?? null,
    teamRoles: ((r.team_roles as unknown as RawTeamRole[]) ?? []).map((t) => ({
      id: t.id,
      teamId: t.team_id,
      teamDisplayName: t.team_display_name,
      roleKey: t.role_key ?? legacyPermissionRole(t.permission),
      label: t.role_key ? canonicalRoleLabel(t.role_key) : (t.label ?? ""),
      title: t.title ?? null,
      state: (t.state as TeamRoleRow["state"]) ?? "ACTIVE",
      permission: (t.permission as TeamStaffPermission) ?? null,
    })),
    additionalRoles: ((r.additional_roles as unknown as { id: string; role_key: string; label: string; state: string; confirmation_state: string | null }[]) ?? []).map((a) => ({
      id: a.id,
      roleKey: a.role_key,
      label: canonicalRoleLabel(a.role_key),
      state: a.state as AdditionalRoleRow["state"],
      confirmationState: a.confirmation_state as AdditionalRoleRow["confirmationState"],
    })),
    playerTeams: ((r.player_teams as unknown as { team_id: string; team_display_name: string; state: string }[]) ?? []).map((p) => ({
      teamId: p.team_id,
      teamDisplayName: p.team_display_name,
      state: p.state as PlayerTeamRow["state"],
    })),
    invitationId: r.invitation_id,
    invitationKind: (r.invitation_kind as ClubPerson["invitationKind"]) ?? null,
    invitationEmail: r.invitation_email,
    invitationRole: r.invitation_role,
    invitationName: r.invitation_name ?? null,
    invitationOffer: offer
      ? {
          clubRoles: offer.club_roles ?? [],
          teams: (offer.teams ?? []).map((t) => ({ id: t.id, teamDisplayName: t.team_display_name, roles: t.roles ?? [], titles: t.titles ?? {} })),
          audience: offer.audience ?? null,
        }
      : null,
    invitedByName: r.invited_by_name ?? null,
    invitationSentAt: r.invitation_sent_at ?? null,
    invitationExpiresAt: r.invitation_expires_at,
    isSelf: r.is_self,
  }
}

function legacyPermissionRole(permission: string | null): string {
  return permission === "team_admin" ? "TEAM_ADMINISTRATION" : permission === "manager" ? "TEAM_MANAGER" : "COACH"
}

// ---------------------------------------------------------------------------
// How a person's roles read
// ---------------------------------------------------------------------------

/** "Assistant Coach · Women's 1st Team", "Team Manager · Under 12 Boys" -- one line per team role. */
export function teamRoleLine(role: Pick<TeamRoleRow, "roleKey" | "title" | "teamDisplayName">): string {
  return `${roleDisplayLabel(role.roleKey, role.title)} · ${role.teamDisplayName}`
}

/**
 * The one-line summary under a name in the register: what they do first (their first team role or
 * club title), else their access, else what they are waiting for.
 */
export function personSummary(p: ClubPerson): string {
  if (p.kind === "invited") return invitationSummary(p)
  if (p.kind === "player") {
    const team = p.playerTeams[0]
    return team ? `Player · ${team.teamDisplayName}${team.state === "PENDING" ? " (waiting for a place)" : ""}` : "Player"
  }
  const active = p.teamRoles.filter((t) => t.state === "ACTIVE")
  const parts: string[] = []
  if (active[0]) parts.push(teamRoleLine(active[0]))
  else if (p.clubTitle) parts.push(p.clubTitle)
  else if (p.access && p.access !== "MEMBER") parts.push(canonicalRoleLabel(p.access))
  else if (p.additionalRoles.some((a) => a.state === "ACTIVE")) parts.push(p.additionalRoles.filter((a) => a.state === "ACTIVE").map((a) => a.label).join(", "))
  else if (p.playerTeams[0]) parts.push(`Player · ${p.playerTeams[0].teamDisplayName}`)
  else parts.push(canonicalRoleLabel(p.access ?? "MEMBER"))
  if (active.length > 1) parts.push(`+${active.length - 1} more`)
  return parts.join("  ")
}

/** What an open invitation is for: "Coach · Under 12 Boys", "Club Admin", "Player · Women's 1st Team". */
export function invitationSummary(p: Pick<ClubPerson, "invitationOffer" | "invitationRole" | "invitationKind">): string {
  const offer = p.invitationOffer
  if (p.invitationKind === "TEAM_JOIN_CODE") return `Player${offer?.teams[0] ? ` · ${offer.teams[0].teamDisplayName}` : ""}`
  if (!offer) return p.invitationRole ?? "Invited"
  const team = offer.teams[0]
  if (team && team.roles[0]) {
    const first = `${roleDisplayLabel(team.roles[0], team.titles[team.roles[0]])} · ${team.teamDisplayName}`
    const more = offer.teams.reduce((n, t) => n + t.roles.length, 0) - 1
    return more > 0 ? `${first}  +${more} more` : first
  }
  const club = offer.clubRoles.find((r) => r !== "MEMBER") ?? offer.clubRoles[0]
  return club ? canonicalRoleLabel(club) : (p.invitationRole ?? "Invited")
}

// ---------------------------------------------------------------------------
// Who holds what (Access Control)
// ---------------------------------------------------------------------------

export interface AccessSummaryRow {
  key: string
  label: string
  people: number
}

export interface AccessSummary {
  clubAccess: AccessSummaryRow[]
  clubRoles: AccessSummaryRow[]
  clubTitles: AccessSummaryRow[]
  teamRoles: AccessSummaryRow[]
  teamTitles: AccessSummaryRow[]
  pendingInvitations: number
  waiting: number
  deactivated: number
  members: number
  /** Null when the caller may not see players. */
  players: number | null
}

export async function readAccessSummary(supabase: Client, clubId: string): Promise<AccessSummary> {
  const { data, error } = await supabase.rpc("club_access_summary", { p_club_id: clubId })
  if (error) throw error
  const rows = data ?? []
  const pick = (section: string) =>
    rows.filter((r) => r.section === section).map((r) => ({ key: r.item_key, label: section.endsWith("title") ? r.label : canonicalRoleLabel(r.item_key), people: Number(r.people ?? 0) }))
  const state = (key: string) => {
    const row = rows.find((r) => r.section === "state" && r.item_key === key)
    return row ? Number(row.people ?? 0) : null
  }
  return {
    clubAccess: pick("club_access"),
    clubRoles: pick("club_role"),
    clubTitles: pick("club_title").sort((a, b) => b.people - a.people || a.label.localeCompare(b.label)),
    teamRoles: pick("team_role"),
    teamTitles: pick("team_title").sort((a, b) => b.people - a.people || a.label.localeCompare(b.label)),
    pendingInvitations: state("PENDING_INVITATIONS") ?? 0,
    waiting: state("WAITING") ?? 0,
    deactivated: state("DEACTIVATED") ?? 0,
    members: state("MEMBERS") ?? 0,
    players: state("PLAYERS"),
  }
}

export interface AssignableRole {
  roleKey: string
  label: string
  scope: string
}

/** What the caller may give at the club, or -- given a team -- at that team. The server decides. */
export async function readAssignableRoles(supabase: Client, clubId: string, teamId?: string | null): Promise<AssignableRole[]> {
  const { data, error } = await supabase.rpc("club_assignable_roles", { p_club_id: clubId, p_team_id: teamId ?? undefined })
  if (error) throw error
  return (data ?? []).map((r) => ({ roleKey: r.role_key, label: canonicalRoleLabel(r.role_key), scope: r.scope }))
}

export interface PendingJoinRequest {
  requestId: string
  requestingUserId: string
  firstName: string | null
  surname: string | null
  requestedRole: string | null
  createdAt: string
}

/** Memberships waiting for a decision (club_join_requests). */
export async function readPendingJoinRequests(supabase: Client, clubId: string): Promise<PendingJoinRequest[]> {
  const { data, error } = await supabase.rpc("list_pending_club_join_requests", { p_club_id: clubId })
  if (error) throw error
  return (data ?? []).map((r) => ({ requestId: r.request_id, requestingUserId: r.requesting_user_id, firstName: r.first_name, surname: r.surname, requestedRole: r.requested_role, createdAt: r.created_at }))
}

// ---------------------------------------------------------------------------
// The reason rule, from the one shared list
// ---------------------------------------------------------------------------

export type ReasonRule = "required" | "optional"

/**
 * What a client asks for before calling an operation: "required" when the server always requires a
 * reason, "optional" when the server requires it only in some cases (the server still decides).
 *
 * One condition a client can settle for itself: changing a membership's access requires a reason
 * "always, except a person acting on their own membership", so a screen that knows it is acting on
 * somebody else asks for the reason up front rather than letting the server refuse an empty one.
 */
export function reasonRuleFor(rpc: string, context: { actingOnSelf?: boolean } = {}): ReasonRule {
  const op: ReasonRequiredOperation | undefined = REASON_REQUIRED_OPERATIONS.find((o) => o.rpc === rpc)
  if (!op) return "optional"
  if (op.when === "always") return "required"
  if (op.rpc === "transition_club_membership") return context.actingOnSelf ? "optional" : "required"
  return "optional"
}

// ---------------------------------------------------------------------------
// The operations (each its own authority, each its own reason rule)
// ---------------------------------------------------------------------------

/** Legacy-vocabulary seat change, kept for the web's existing caller. New code uses setClubAccess. */
export async function setPrimaryClubRole(supabase: Client, membershipId: string, role: ClubRole, reason: string): Promise<void> {
  const { error } = await supabase.rpc("set_primary_club_role", { p_membership_id: membershipId, p_role: role, p_reason: reason.trim() || undefined })
  if (error) throw error
}

/** The one level of club access -- Club Admin, Fixture Secretary or Member. */
export async function setClubAccess(supabase: Client, membershipId: string, access: ClubAccessKey, reason: string): Promise<void> {
  await setPrimaryClubRole(supabase, membershipId, clubAccessToLegacyRole(access), reason)
}

/** What they do for the club, in the club's words. Null clears it. Grants nothing. */
export async function setClubTitle(supabase: Client, membershipId: string, title: string | null): Promise<void> {
  // NULL clears the title; the generated Args type is non-nullable for a text param with no SQL default (a
  // known `supabase gen types` quirk), so the cast states the real, tested server signature.
  const { error } = await supabase.rpc("set_membership_governance_title", { p_membership_id: membershipId, p_title: (title?.trim() || null) as string })
  if (error) throw error
}

export type MembershipTransition = "SUSPENDED" | "ACTIVE" | "REVOKED"

export async function transitionMembership(supabase: Client, membershipId: string, to: MembershipTransition, reason: string): Promise<void> {
  const { error } = await supabase.rpc("transition_club_membership", { p_membership_id: membershipId, p_to_state: to, p_reason: reason.trim() || undefined, p_allow_no_club_admin: false })
  if (error) throw error
}

/** Deactivate Membership: access paused, roles paused, account and history kept, reversible. */
export function deactivateMembership(supabase: Client, membershipId: string, reason: string): Promise<void> {
  return transitionMembership(supabase, membershipId, "SUSPENDED", reason)
}

export function reactivateMembership(supabase: Client, membershipId: string, reason: string): Promise<void> {
  return transitionMembership(supabase, membershipId, "ACTIVE", reason)
}

/** Remove from Club: the relationship ends and every role with it. The Ovalball account is untouched. */
export function removeFromClub(supabase: Client, membershipId: string, reason: string): Promise<void> {
  return transitionMembership(supabase, membershipId, "REVOKED", reason)
}

/**
 * Give one role -- at the club (teamId null) or at one team -- and, for a team role, the title it is
 * to carry. Additive: nothing the person already holds is replaced.
 */
export async function giveRole(supabase: Client, membershipId: string, roleKey: string, teamId: string | null, reason: string, title?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("assign_role", { p_membership_id: membershipId, p_role_key: roleKey, p_team_id: teamId ?? undefined, p_reason: reason.trim() || undefined })
  if (error) throw error
  const assignmentId = data as unknown as string
  if (teamId && title && title.trim()) await setTeamRoleTitle(supabase, assignmentId, title)
  return assignmentId
}

/** A team role's title. Null clears it. Describes; never grants. */
export async function setTeamRoleTitle(supabase: Client, assignmentId: string, title: string | null): Promise<void> {
  const { error } = await supabase.rpc("set_team_role_title", { p_assignment_id: assignmentId, p_title: (title?.trim() || null) as string })
  if (error) throw error
}

/** Kept name for the club-wide role (Volunteer) given from a person's record. */
export function assignAdditionalRole(supabase: Client, membershipId: string, roleKey: string, reason: string): Promise<string> {
  return giveRole(supabase, membershipId, roleKey, null, reason)
}

/** End one role -- one assignment -- leaving every other role the person holds as it is. */
export async function endRoleAssignment(supabase: Client, assignmentId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("transition_role_assignment", { p_assignment_id: assignmentId, p_to_state: "REVOKED", p_reason: reason.trim() || undefined, p_allow_no_club_admin: false })
  if (error) throw error
}

export async function decideJoinRequest(supabase: Client, requestId: string, decision: "APPROVE" | "DECLINE", reason: string): Promise<void> {
  const { error } = await supabase.rpc("decide_club_join_request", { p_request_id: requestId, p_decision: decision, p_reason: reason.trim() || undefined })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Capabilities, asked of the server in one round trip
// ---------------------------------------------------------------------------

export interface PeopleCapabilities {
  /** people.member.view */
  view: boolean
  /** people.member.view_contact */
  viewContact: boolean
  /** team.roster.view at club -- whether players are rows in the register. */
  viewPlayers: boolean
  /**
   * people.role.assign_club -- the key a role change, an additional role and a join-request decision
   * evaluate (through internal.club_people_authority).
   */
  assignClub: boolean
  /** people.membership.suspend -- what a deactivation and a reactivation ask. */
  suspend: boolean
  /** people.membership.revoke -- what a removal asks. */
  revoke: boolean
  /** people.role.assign_team */
  assignTeam: boolean
  /** people.join_request.review */
  reviewJoinRequests: boolean
  /** people.invitation.create -- inviting somebody new as staff, an administrator or a member. */
  invite: boolean
  /** team.join_code.manage at club -- a team's joining link for players, and its poster. */
  joinCodes: boolean
  /** club.partners.manage or club.referrals.view -- the club may refer other clubs, or see its referrals. */
  refer: boolean
}

export async function readPeopleCapabilities(supabase: Client, clubId: string): Promise<PeopleCapabilities> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  const none: PeopleCapabilities = { view: false, viewContact: false, viewPlayers: false, assignClub: false, suspend: false, revoke: false, assignTeam: false, reviewJoinRequests: false, invite: false, joinCodes: false, refer: false }
  if (error) return none
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return {
    view: allowed.has("people.member.view"),
    viewContact: allowed.has("people.member.view_contact"),
    viewPlayers: allowed.has("team.roster.view"),
    assignClub: allowed.has("people.role.assign_club"),
    suspend: allowed.has("people.membership.suspend"),
    revoke: allowed.has("people.membership.revoke"),
    assignTeam: allowed.has("people.role.assign_team"),
    reviewJoinRequests: allowed.has("people.join_request.review"),
    invite: allowed.has("people.invitation.create"),
    joinCodes: allowed.has("team.join_code.manage"),
    refer: allowed.has("club.partners.manage") || allowed.has("club.referrals.view"),
  }
}

export function clubRoleLabel(role: ClubRole | null): string {
  return role ? CLUB_ROLE_LABEL[role] : "Member"
}

/** The club access level in words; a deactivated member keeps theirs, paused. */
export function clubAccessLabel(access: ClubAccessKey | null): string {
  return canonicalRoleLabel(access ?? "MEMBER")
}

export function teamPermissionLabel(permission: TeamStaffPermission): string {
  return TEAM_PERMISSION_LABEL[permission]
}

/** One error rule for both clients: the server's own sentence for the outcomes it writes for people. */
export function peopleErrorMessage(error: unknown, fallback: string): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  if (e.code === "42501" || e.code === "22023" || e.code === "23514" || e.code === "23505" || e.code === "P0001" || e.code === "P0002") return e.message || fallback
  return fallback
}
