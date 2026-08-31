"use server"

import { revalidatePath } from "next/cache"

import { dispatchEmailEvent } from "@/lib/email/dispatch"
import { createClient } from "@/lib/supabase/server"

export type InviteResult = { ok: true; inviteLink: string } | { ok: false; error: string }

export interface InviteInput {
  clubId: string
  clubName: string
  email: string
  declaredRole: string
  clubRole: "CLUB_ADMIN" | "FIXTURE_SECRETARY" | null
  teamAssignments: { teamId: string; teamPermission: "team_admin" | "coach" | "manager" | "view_only" }[]
}

function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
}

/**
 * Creates the invitation row (+ per-team rows) only -- RLS
 * (invitations_insert_club_scoped) requires the caller to already be that
 * club's admin, so this grants nothing beyond what the caller could already
 * do directly. The row itself never grants access; accept_invitation()
 * (called from /invite/[token]) is the only path from here to a real
 * permission, and it requires the recipient's own authenticated session
 * email to match. No real email is sent this session -- see
 * lib/email/dispatch.ts -- so the invite link is returned directly for the
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

  await dispatchEmailEvent({
    type: "club_invitation",
    to: input.email,
    data: { clubName: input.clubName, inviteLink },
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
 * club_memberships_update_scoped (is_site_admin() or is_club_admin(club_id))
 * is the real boundary -- a plain UPDATE, not a new function, since
 * changing an EXISTING member's club-wide role needs no atomic multi-table
 * write the way approving a claim does.
 */
export async function updateMembershipRole(
  membershipId: string,
  role: "BASIC_USER" | "CLUB_ADMIN" | "FIXTURE_SECRETARY"
): Promise<MembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("club_memberships").update({ role }).eq("id", membershipId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/people")
  return { ok: true }
}

/**
 * Revokes club-wide access (status -> revoked), never a hard delete -- the
 * row (and its audit_log history) survives, matching how teams are
 * archived rather than deleted. Their team_permissions rows are left
 * as-is; team_permissions_select/insert/update all already require the
 * membership's own status to be checked by the caller where it matters
 * (can_manage_team joins through an active club_memberships row), so a
 * revoked membership's stale team grants stop being effective without
 * needing to be separately deleted here.
 */
export async function revokeMembership(membershipId: string): Promise<MembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("club_memberships").update({ status: "revoked" }).eq("id", membershipId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/people")
  return { ok: true }
}

/**
 * team_permissions_delete_scoped (added this pass -- see
 * 20260831150000_team_permissions_delete.sql) is the real boundary.
 */
export async function removeTeamAssignment(teamPermissionId: string): Promise<MembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("team_permissions").delete().eq("id", teamPermissionId)
  if (error) return { ok: false, error: error.message }
  revalidatePath("/people")
  return { ok: true }
}
