"use server"

import { revalidatePath } from "next/cache"

import { resolveClubCrestEmailUrl } from "@/lib/email/club-crest"
import { sendEmailEvent } from "@/lib/email/send"
import { toPublicSubmissionError } from "@/lib/errors/public-error"
import { createClient } from "@/lib/supabase/server"
import { getSiteUrl } from "@/lib/site-url"

export type InviteResult = { ok: true; inviteLink: string } | { ok: false; error: string }

export interface InviteInput {
  clubId: string
  clubName: string
  email: string
  declaredRole: string
  /** A role key from `invitationStaffRoleOptions`, never a word invented at the call site. */
  clubRole: string | null
  teamAssignments: { teamId: string; roleKey: string }[]
}

export type StaffRoleOption = { roleKey: string; label: string; heldAtTeam: boolean }

/**
 * What a staff invitation may carry, from the role catalogue. The database narrows it to the O.1
 * ceiling and to roles the catalogue marks visible, so the form and the issuer cannot disagree about
 * what a staff invitation can produce.
 */
export async function invitationStaffRoleOptions(): Promise<StaffRoleOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("invitation_staff_role_options")
  if (error) {
    console.error("invitation_staff_role_options failed:", error)
    return []
  }
  return (data ?? []).map((row) => ({
    roleKey: row.role_key,
    label: row.label,
    heldAtTeam: row.held_at_team,
  }))
}


/**
 * The canonical club staff invitation.
 *
 * `public.issue_invitation` is the authority: it checks that the caller may invite for this club,
 * that every role is within what O.1 allows a staff invitation to carry, and that every team named
 * is an active team of THIS club. The link token and the human code are returned once, at issue, and
 * only their hashes are stored -- so this is the only moment either exists, and nothing can read
 * them back afterwards.
 *
 * The invitation grants nothing by existing. Redemption, reached from /join, is the only path from
 * here to a membership or a role, and it requires the recipient's own authenticated session to match
 * the address the invitation was sent to.
 */

export async function createInvitation(input: InviteInput): Promise<InviteResult> {
  const supabase = await createClient()

  const clubRoles = input.clubRole ? [input.clubRole] : []

  // Teams are grouped by the role they are being given, because one invitation can legitimately make
  // somebody Coach of one team and Team Manager of another -- and flattening that would hand both
  // roles to both teams. Nothing here validates the role: `issue_invitation` does, against the same
  // catalogue the options came from.
  const teamRoles: { id: string; roles: string[] }[] = []
  for (const assignment of input.teamAssignments) {
    const existing = teamRoles.find((t) => t.id === assignment.teamId)
    if (existing) existing.roles.push(assignment.roleKey)
    else teamRoles.push({ id: assignment.teamId, roles: [assignment.roleKey] })
  }

  if (clubRoles.length === 0 && teamRoles.length === 0) {
    return { ok: false, error: "Choose a club role, a team role, or both." }
  }

  const { data, error } = await supabase
    .rpc("issue_invitation", {
      p_kind: "CLUB_STAFF",
      p_club_id: input.clubId,
      p_email: input.email.trim().toLowerCase(),
      p_intended_outcome: { roles: clubRoles, declared_role: input.declaredRole || null },
      p_team_roles: teamRoles.length > 0 ? teamRoles : undefined,
    })
    .maybeSingle()

  if (error || !data) {
    console.error("createInvitation failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }

  // An identical invitation already out there is returned rather than reissued, and deliberately
  // without a second live secret -- so the honest answer is that one is already on its way.
  if (data.already_existed || !data.token) {
    return { ok: false, error: "That person already has an invitation to this club waiting to be accepted." }
  }

  const inviteLink = `${getSiteUrl()}/join?t=${encodeURIComponent(data.token)}`

  // Recipient is resolved from the invitation ROW, not from `input.email`: the address is a property
  // of the invitation this action just created under its own authorization, never an argument the
  // browser can aim.
  await sendEmailEvent({
    supabase,
    eventKey: "club_invitation",
    idempotencyKey: `club_invitation:${data.invitation_id}`,
    recipient: { kind: "access_invitation", invitationId: data.invitation_id },
    data: {
      clubName: input.clubName,
      clubLogoUrl: await resolveClubCrestEmailUrl(supabase, input.clubId),
      inviteToken: data.token,
      roleLabel: input.declaredRole || null,
    },
  })

  revalidatePath("/people")
  return { ok: true, inviteLink }
}

export async function revokeInvitation(invitationId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.from("invitations").update({ status: "revoked" }).eq("id", invitationId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/people")
  return { ok: true }
}

export type MembershipActionResult = { ok: true } | { ok: false; error: string }

/**
 * set_primary_club_role is the boundary: it checks the caller is this club's
 * Club Admin (or a Full Site Admin), never leaves the club without a Club
 * Admin, and records the change as role assignments with a security event.
 */
export async function updateMembershipRole(
  membershipId: string,
  role: "BASIC_USER" | "CLUB_ADMIN" | "FIXTURE_SECRETARY"
): Promise<MembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_primary_club_role", { p_membership_id: membershipId, p_role: role })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/people")
  return { ok: true }
}

/**
 * Removes someone from the club: the membership becomes REVOKED history
 * (never deleted, never switched back on) and every role it held ends with
 * it. transition_club_membership requires the reason and refuses to remove
 * the club's last Club Admin.
 */
export async function revokeMembership(membershipId: string, reason: string): Promise<MembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("transition_club_membership", {
    p_membership_id: membershipId,
    p_to_state: "REVOKED",
    p_reason: reason,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/people")
  return { ok: true }
}

/** Ends a person's Coach, Team Manager and Team Admin roles on one team. */
export async function removeTeamAssignment(teamPermissionId: string): Promise<MembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("remove_team_access", { p_team_permission_id: teamPermissionId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/people")
  return { ok: true }
}

/**
 * Approves or declines a request to join the club. decide_club_join_request
 * checks the caller's authority, refuses a request that has already been
 * decided, and requires a reason to decline.
 */
export async function decideJoinRequest(
  requestId: string,
  decision: "APPROVE" | "DECLINE",
  reason: string
): Promise<MembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("decide_club_join_request", {
    p_request_id: requestId,
    p_decision: decision,
    p_reason: reason.trim() || undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/people")
  return { ok: true }
}
