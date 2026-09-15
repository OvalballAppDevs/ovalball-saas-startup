"use server"

import { revalidatePath } from "next/cache"

import { resolveClubCrestEmailUrl } from "@/lib/email/club-crest"
import { sendEmailEvent } from "@/lib/email/send"
import { createClient } from "@/lib/supabase/server"
import { getSiteUrl } from "@/lib/site-url"

export type InviteResult = { ok: true; inviteLink: string } | { ok: false; error: string }

export interface InviteInput {
  clubId: string
  clubName: string
  email: string
  declaredRole: string
  clubRole: "CLUB_ADMIN" | "FIXTURE_SECRETARY" | null
  teamAssignments: { teamId: string; teamPermission: "team_admin" | "coach" | "manager" | "view_only" }[]
}


/**
 * Creates the invitation row (+ per-team rows) only -- RLS
 * (invitations_insert_club_scoped) requires the caller to already be that
 * club's admin, so this grants nothing beyond what the caller could already
 * do directly. The row itself never grants access; accept_invitation()
 * (called from /invite/[token]) is the only path from here to a real
 * permission, and it requires the recipient's own authenticated session
 * email to match. No real email is sent this session -- see
 * lib/email/send.ts -- and the invite link is returned directly for the
 * inviter to share by hand.
 */
export async function createInvitation(input: InviteInput): Promise<InviteResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const { data: invitation, error } = await supabase
    .from("invitations")
    .insert({
      club_id: input.clubId,
      created_by: user.id,
      invited_email: input.email.trim().toLowerCase(),
      declared_role: input.declaredRole || null,
      club_role: input.clubRole,
    })
    .select("id, token")
    .single()

  if (error || !invitation) {
    return { ok: false, error: error?.message ?? "Could not create the invitation." }
  }

  if (input.teamAssignments.length > 0) {
    const { error: teamsError } = await supabase.from("invitation_teams").insert(
      input.teamAssignments.map((t) => ({
        invitation_id: invitation.id,
        team_id: t.teamId,
        team_permission: t.teamPermission,
      }))
    )
    if (teamsError) {
      return { ok: false, error: teamsError.message }
    }
  }

  const inviteLink = `${getSiteUrl()}/invite/${invitation.token}`

  // Recipient is resolved from the invitation ROW, not from `input.email`:
  // the address is a property of the invitation this action just created
  // under its own authorization, never an argument the browser can aim.
  await sendEmailEvent({
    supabase,
    eventKey: "club_invitation",
    idempotencyKey: `club_invitation:${invitation.id}`,
    recipient: { kind: "club_invitation", invitationId: invitation.id },
    data: {
      clubName: input.clubName,
      clubLogoUrl: await resolveClubCrestEmailUrl(supabase, input.clubId),
      inviteToken: invitation.token,
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
