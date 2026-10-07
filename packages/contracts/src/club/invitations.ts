import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { sortTeamsInRugbyAgeOrder, type ClubTeam } from "./teams"

type Client = SupabaseClient<Database>

/**
 * CLUB STAFF INVITATIONS (CA-M10; People & Invitations): the one way somebody new is invited to be
 * staff, a club administrator, a volunteer or a member -- from Home's Add to Club, People, Access
 * Control and a team's Staff tab alike. `issue_invitation` (kind CLUB_STAFF) decides whether this
 * person may invite and which roles they may give; it sends no email itself (the website's server
 * action sends one; the phone hands the link to the person's own WhatsApp, Messages or mail app).
 * `resend_invitation` and `revoke_invitation` are the two things to do to an open one. The token and the code never reach
 * a client: the read model is `invitations_admin_view`, which is the secret-free projection, and the
 * People read model already lists open invitations as rows.
 *
 * `people.invitation.create` needs recent authentication (R): a refusal for that reason is a step-up,
 * not an error, and the screen holds the intent through it.
 */
export interface StaffRoleOption {
  roleKey: string
  label: string
  /** A role only ever given at a team (Coach, Team Manager, First Aider, Team Safeguarding Lead). */
  heldAtTeam: boolean
  /** May be given at a team (the team roles, and Volunteer). */
  allowedAtTeam: boolean
}

export async function readStaffRoleOptions(supabase: Client): Promise<StaffRoleOption[]> {
  const { data, error } = await supabase.rpc("invitation_staff_role_options")
  if (error) throw error
  return (data ?? []).map((r) => ({ roleKey: r.role_key, label: r.label, heldAtTeam: r.held_at_team === true, allowedAtTeam: r.allowed_at_team === true }))
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

/**
 * THE CREDENTIAL, ONCE. `issue_invitation` returns the plaintext link token and the human code exactly
 * once; the website shows them as a link, a code and a QR of the link (CA-M11.1: so does the phone).
 * Neither client stores them: they are held in component state while the share panel is open and are
 * gone when it closes. An already-open invitation returns no secret at all.
 */
export interface IssuedInvitation {
  invitationId: string | null
  alreadyExisted: boolean
  token: string | null
  code: string | null
  expiresAt: string | null
}

/** One team in an invitation: the roles given there, and the title each is to carry ("Physio" on a Volunteer). */
export interface InvitationTeamRoles {
  id: string
  roles: string[]
  titles?: Record<string, string>
}

export async function inviteClubStaff(
  supabase: Client,
  input: { clubId: string; email: string; clubRoles: string[]; declaredRole?: string | null; inviteeName?: string | null; teamRoles?: InvitationTeamRoles[] }
): Promise<IssuedInvitation> {
  if (input.clubRoles.length === 0 && !(input.teamRoles && input.teamRoles.length > 0)) throw new Error("Choose a club role, a team role, or both.")
  const teamRoles = (input.teamRoles ?? [])
    .filter((t) => t.roles.length > 0)
    .map((t) => ({ id: t.id, roles: t.roles, ...(t.titles && Object.keys(t.titles).length > 0 ? { titles: t.titles } : {}) }))
  const { data, error } = await supabase.rpc("issue_invitation", {
    p_kind: "CLUB_STAFF",
    p_club_id: input.clubId,
    p_email: input.email.trim().toLowerCase(),
    p_intended_outcome: { roles: input.clubRoles, declared_role: input.declaredRole?.trim() || null, invitee_name: input.inviteeName?.trim() || null },
    p_team_roles: teamRoles.length > 0 ? teamRoles : undefined,
  })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return {
    invitationId: row?.invitation_id ?? null,
    alreadyExisted: row?.already_existed === true,
    token: row?.token ?? null,
    code: row?.code ?? null,
    expiresAt: row?.expires_at ?? null,
  }
}

/** A resend is a REGENERATE: the server rotates the link and the code and resets the expiry. The previous ones stop working. */
export async function resendInvitation(supabase: Client, invitationId: string): Promise<{ token: string | null; code: string | null; expiresAt: string | null }> {
  const { data, error } = await supabase.rpc("resend_invitation", { p_invitation_id: invitationId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { token: row?.token ?? null, code: row?.code ?? null, expiresAt: row?.expires_at ?? null }
}

/** The club's teams, for the per-team role rows of the invitation form (the website offers one row per team). */
/** The club's active teams in rugby age order (senior sides, then U18 down to U6), never alphabetical. */
export async function readInvitableTeams(supabase: Client, clubId: string): Promise<{ id: string; displayName: string }[]> {
  const { data, error } = await supabase.from("teams").select("id, display_name, category, age_group").eq("club_id", clubId).eq("active", true)
  if (error) throw error
  const rows = (data ?? []).map((t) => ({ id: t.id, displayName: t.display_name, category: t.category as ClubTeam["category"], ageGroup: t.age_group }))
  return sortTeamsInRugbyAgeOrder(rows).map(({ id, displayName }) => ({ id, displayName }))
}

export async function revokeInvitation(supabase: Client, invitationId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: invitationId, p_reason: reason })
  if (error) throw error
}
