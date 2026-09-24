import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { REASON_REQUIRED_OPERATIONS, type ReasonRequiredOperation } from "../required-reasons"
import { CLUB_ROLE_LABEL, TEAM_PERMISSION_LABEL, type ClubRole, type TeamStaffPermission } from "../role-labels"

type Client = SupabaseClient<Database>

/**
 * CLUB PEOPLE & MEMBERSHIPS, for both clients (CA-M3).
 *
 * PEOPLE IS NOT "USERS". A club's People product is its MEMBERSHIPS -- accounts that belong to
 * the club with a primary club role (Club Admin, Fixture Secretary, Member), the team roles they
 * hold (Team Admin, Manager, Coach on a side), any additional club-wide role (Volunteer; a
 * Safeguarding Officer appears but is appointed elsewhere), the membership's state (active,
 * suspended, pending) and the staff invitations still open. Players and guardians are not rows
 * here: they are their own products with their own authority.
 *
 * READ: `club_people` -- one paged, searchable, filterable read model (people.member.view; an
 * email only under people.member.view_contact). WRITES: the existing membership operations, each
 * with its own authority and its own reason rule, which BOTH clients now consult from the one
 * shared list (`REASON_REQUIRED_OPERATIONS`): set_primary_club_role, transition_club_membership,
 * set_team_access, remove_team_access, assign_role, transition_role_assignment,
 * decide_club_join_request. No permission editing lives here (CA-M4).
 */

export type PeopleFilter = "all" | "staff" | "members" | "suspended" | "pending" | "invited"

export const PEOPLE_FILTERS: { key: PeopleFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "staff", label: "Staff" },
  { key: "members", label: "Members" },
  { key: "pending", label: "Pending" },
  { key: "suspended", label: "Suspended" },
]

export type MembershipState = "ACTIVE" | "SUSPENDED" | "PENDING" | "INVITED"

export interface TeamRoleRow {
  /** The role_assignments id the team_permissions view projects -- what remove_team_access takes. */
  id: string
  teamId: string
  teamDisplayName: string
  permission: TeamStaffPermission
}

export interface AdditionalRoleRow {
  id: string
  roleKey: string
  label: string
  state: "ACTIVE" | "SUSPENDED"
  confirmationState: "PENDING_CONFIRMATION" | "CONFIRMED" | null
}

export interface ClubPerson {
  kind: "member" | "invited"
  membershipId: string | null
  userId: string | null
  firstName: string | null
  surname: string | null
  /** Null unless the caller holds people.member.view_contact. */
  email: string | null
  avatarStoragePath: string | null
  role: ClubRole | null
  state: MembershipState
  since: string | null
  teamRoles: TeamRoleRow[]
  additionalRoles: AdditionalRoleRow[]
  invitationId: string | null
  invitationEmail: string | null
  invitationRole: string | null
  invitationExpiresAt: string | null
  isSelf: boolean
}

export interface ClubPeoplePage {
  people: ClubPerson[]
  total: number
}

export function personName(p: Pick<ClubPerson, "firstName" | "surname" | "invitationEmail">): string {
  const name = [p.firstName, p.surname].filter(Boolean).join(" ").trim()
  return name || p.invitationEmail || "Unknown"
}

export async function readClubPeople(supabase: Client, clubId: string, options: { search?: string; filter?: PeopleFilter; limit?: number; offset?: number } = {}): Promise<ClubPeoplePage> {
  const { data, error } = await supabase.rpc("club_people", {
    p_club_id: clubId,
    p_search: options.search?.trim() || undefined,
    p_filter: options.filter ?? "all",
    p_limit: options.limit ?? 50,
    p_offset: options.offset ?? 0,
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

function mapPerson(r: Row): ClubPerson {
  return {
    kind: r.kind as ClubPerson["kind"],
    membershipId: r.membership_id,
    userId: r.user_id,
    firstName: r.first_name,
    surname: r.surname,
    email: r.email,
    avatarStoragePath: r.avatar_storage_path,
    role: (r.role as ClubRole) ?? null,
    state: r.state as MembershipState,
    since: r.since,
    teamRoles: ((r.team_roles as unknown as { id: string; team_id: string; team_display_name: string; permission: string }[]) ?? []).map((t) => ({ id: t.id, teamId: t.team_id, teamDisplayName: t.team_display_name, permission: t.permission as TeamStaffPermission })),
    additionalRoles: ((r.additional_roles as unknown as { id: string; role_key: string; label: string; state: string; confirmation_state: string | null }[]) ?? []).map((a) => ({ id: a.id, roleKey: a.role_key, label: a.label, state: a.state as AdditionalRoleRow["state"], confirmationState: a.confirmation_state as AdditionalRoleRow["confirmationState"] })),
    invitationId: r.invitation_id,
    invitationEmail: r.invitation_email,
    invitationRole: r.invitation_role,
    invitationExpiresAt: r.invitation_expires_at,
    isSelf: r.is_self,
  }
}

export interface AssignableRole {
  roleKey: string
  label: string
  scope: string
}

export async function readAssignableRoles(supabase: Client, clubId: string): Promise<AssignableRole[]> {
  const { data, error } = await supabase.rpc("club_assignable_roles", { p_club_id: clubId })
  if (error) throw error
  return (data ?? []).map((r) => ({ roleKey: r.role_key, label: r.label, scope: r.scope }))
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

export async function setPrimaryClubRole(supabase: Client, membershipId: string, role: ClubRole, reason: string): Promise<void> {
  const { error } = await supabase.rpc("set_primary_club_role", { p_membership_id: membershipId, p_role: role, p_reason: reason.trim() || undefined })
  if (error) throw error
}

export type MembershipTransition = "SUSPENDED" | "ACTIVE" | "REVOKED"

export async function transitionMembership(supabase: Client, membershipId: string, to: MembershipTransition, reason: string): Promise<void> {
  const { error } = await supabase.rpc("transition_club_membership", { p_membership_id: membershipId, p_to_state: to, p_reason: reason.trim() || undefined, p_allow_no_club_admin: false })
  if (error) throw error
}

export async function setTeamAccess(supabase: Client, membershipId: string, teamId: string, permission: TeamStaffPermission, reason: string): Promise<void> {
  const { error } = await supabase.rpc("set_team_access", { p_membership_id: membershipId, p_team_id: teamId, p_permission: permission, p_reason: reason.trim() || undefined })
  if (error) throw error
}

export async function removeTeamAccess(supabase: Client, teamPermissionId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("remove_team_access", { p_team_permission_id: teamPermissionId, p_reason: reason.trim() || undefined })
  if (error) throw error
}

export async function assignAdditionalRole(supabase: Client, membershipId: string, roleKey: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("assign_role", { p_membership_id: membershipId, p_role_key: roleKey, p_team_id: undefined, p_reason: reason.trim() || undefined })
  if (error) throw error
}

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
  /**
   * people.role.assign_club -- the key the membership operations actually evaluate (through
   * internal.club_people_authority) for a role change, a suspension, a restore, a removal and a
   * join-request decision. The catalogue's finer keys below are shown as well, and a control is
   * offered only when both say yes.
   */
  assignClub: boolean
  /** people.membership.suspend */
  suspend: boolean
  /** people.membership.revoke */
  revoke: boolean
  /** people.role.assign_team */
  assignTeam: boolean
  /** people.join_request.review */
  reviewJoinRequests: boolean
}

export async function readPeopleCapabilities(supabase: Client, clubId: string): Promise<PeopleCapabilities> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  const none: PeopleCapabilities = { view: false, viewContact: false, assignClub: false, suspend: false, revoke: false, assignTeam: false, reviewJoinRequests: false }
  if (error) return none
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return {
    view: allowed.has("people.member.view"),
    viewContact: allowed.has("people.member.view_contact"),
    assignClub: allowed.has("people.role.assign_club"),
    suspend: allowed.has("people.membership.suspend"),
    revoke: allowed.has("people.membership.revoke"),
    assignTeam: allowed.has("people.role.assign_team"),
    reviewJoinRequests: allowed.has("people.join_request.review"),
  }
}

export const MEMBERSHIP_STATE_LABEL: Record<MembershipState, string> = { ACTIVE: "Active", SUSPENDED: "Suspended", PENDING: "Awaiting Approval", INVITED: "Invited" }

export function clubRoleLabel(role: ClubRole | null): string {
  return role ? CLUB_ROLE_LABEL[role] : "Member"
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
