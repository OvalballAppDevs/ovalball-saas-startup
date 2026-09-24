import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * CLUB STAFF INVITATIONS (CA-M10): the canonical invitation architecture, read and written from the
 * phone exactly as the website's People page does it. `issue_invitation` (kind CLUB_STAFF) decides
 * whether this person may invite, which roles they may give, and sends the email; `resend_invitation`
 * and `revoke_invitation` are the two things to do to an open one. The token and the code never reach
 * a client: the read model is `invitations_admin_view`, which is the secret-free projection, and the
 * People read model already lists open invitations as rows.
 *
 * `people.invitation.create` needs recent authentication (R): a refusal for that reason is a step-up,
 * not an error, and the screen holds the intent through it.
 */
export interface StaffRoleOption {
  roleKey: string
  label: string
  /** A role given at a team rather than the club. */
  heldAtTeam: boolean
}

export async function readStaffRoleOptions(supabase: Client): Promise<StaffRoleOption[]> {
  const { data, error } = await supabase.rpc("invitation_staff_role_options")
  if (error) throw error
  return (data ?? []).map((r) => ({ roleKey: r.role_key, label: r.label, heldAtTeam: r.held_at_team === true }))
}

export interface InvitationCapabilities {
  create: boolean
  revoke: boolean
}

export async function readInvitationCapabilities(supabase: Client, clubId: string): Promise<InvitationCapabilities> {
  const { data } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  const allowed = new Set((data ?? []).filter((r) => r.allowed === true).map((r) => r.capability_key))
  return { create: allowed.has("people.invitation.create"), revoke: allowed.has("people.invitation.revoke") }
}

export async function inviteClubStaff(
  supabase: Client,
  input: { clubId: string; email: string; clubRoles: string[]; teamRoles?: { id: string; roles: string[] }[] }
): Promise<{ invitationId: string | null; alreadyExisted: boolean }> {
  if (input.clubRoles.length === 0 && !(input.teamRoles && input.teamRoles.length > 0)) throw new Error("Choose a club role, a team role, or both.")
  const { data, error } = await supabase.rpc("issue_invitation", {
    p_kind: "CLUB_STAFF",
    p_club_id: input.clubId,
    p_email: input.email.trim(),
    p_intended_outcome: { roles: input.clubRoles, declared_role: null },
    p_team_roles: input.teamRoles && input.teamRoles.length > 0 ? input.teamRoles : undefined,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { invitationId: row?.invitation_id ?? null, alreadyExisted: row?.already_existed === true }
}

export async function resendInvitation(supabase: Client, invitationId: string): Promise<void> {
  const { error } = await supabase.rpc("resend_invitation", { p_invitation_id: invitationId })
  if (error) throw error
}

export async function revokeInvitation(supabase: Client, invitationId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: invitationId, p_reason: reason })
  if (error) throw error
}
