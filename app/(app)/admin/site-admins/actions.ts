"use server"

import { revalidatePath } from "next/cache"

import { dispatchEmailEvent } from "@/lib/email/dispatch"
import { toPublicSubmissionError } from "@/lib/errors/public-error"
import { createClient } from "@/lib/supabase/server"

import { requireSiteAdmin } from "../require-site-admin"
import { profileLabel as PROFILE_LABEL_FN } from "./profiles"

export type ActionResult = { ok: true } | { ok: false; error: string }

function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
}

export type InviteSiteAdminResult = { ok: true; inviteLink: string } | { ok: false; error: string }

/**
 * Only a Full Site Admin may issue these -- RLS
 * (site_admin_invitations_insert_full_admin: internal.is_full_site_admin())
 * is the real boundary; requireSiteAdmin here just gives a real error
 * instead of a confusing RLS rejection. The row itself never grants
 * anything -- accept_site_admin_invitation() (called from
 * /invite/site-admin/[token]) is the only path from here to a real
 * site_admins row, and it requires the recipient's own authenticated
 * session email to match. No real email is sent this session -- see
 * lib/email/dispatch.ts -- so the invite link is returned directly.
 */
export async function inviteSiteAdmin(email: string, adminRole: string): Promise<InviteSiteAdminResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const trimmedEmail = email.trim().toLowerCase()
  if (!trimmedEmail) return { ok: false, error: "An email address is required." }

  const { data: invitation, error } = await supabase
    .from("site_admin_invitations")
    .insert({ invited_email: trimmedEmail, admin_role: adminRole, invited_by: auth.user.id })
    .select("id, token")
    .single()

  if (error || !invitation) {
    console.error("inviteSiteAdmin failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }

  const inviteLink = `${getSiteUrl()}/invite/site-admin/${invitation.token}`
  const profileLabel = PROFILE_LABEL_FN(adminRole)

  await dispatchEmailEvent({ type: "site_admin_invitation", to: trimmedEmail, data: { profileLabel, inviteLink } })

  revalidatePath("/admin/site-admins")
  return { ok: true, inviteLink }
}

export async function revokeSiteAdminInvitation(invitationId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("revoke_site_admin_invitation", { p_invitation_id: invitationId })
  if (error) {
    console.error("revokeSiteAdminInvitation failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/site-admins")
  return { ok: true }
}

/**
 * Changes an EXISTING active Site Admin's profile -- distinct from
 * inviting (which grants access for the first time). The lockout trigger
 * (internal.prevent_last_full_admin_lockout) still applies against this
 * write, so demoting the last remaining Full Site Admin is blocked
 * server-side regardless of what this action allows.
 */
export async function changeSiteAdminRole(targetUserId: string, adminRole: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.from("site_admins").update({ admin_role: adminRole }).eq("user_id", targetUserId)
  if (error) {
    console.error("changeSiteAdminRole failed:", error)
    return { ok: false, error: error.message.includes("last remaining Full Site Admin") ? error.message : toPublicSubmissionError() }
  }
  revalidatePath("/admin/site-admins")
  return { ok: true }
}

/**
 * Grants or revokes the diagnostic_club_access capability on an existing
 * Site Admin -- Full Site Admin only, matching set_site_admin_diagnostic_
 * capability's own RLS-equivalent check (internal.is_full_site_admin()).
 * Never touches admin_role or status, so the lockout trigger
 * (internal.prevent_last_full_admin_lockout) is entirely unaffected --
 * this is an orthogonal, narrower capability, not a standing change.
 */
export async function setDiagnosticAccess(targetUserId: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("set_site_admin_diagnostic_capability", { p_user_id: targetUserId, p_enabled: enabled })
  if (error) {
    console.error("setDiagnosticAccess failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/site-admins")
  return { ok: true }
}

/**
 * Grants or revokes the manage_team_catalogue capability on an existing
 * Site Admin -- Full Site Admin only, matching set_site_admin_team_
 * catalogue_capability's own RLS-equivalent check
 * (internal.is_full_site_admin()). A genuine, narrow, per-person grant --
 * no Site Admin profile (including Full) can write to the global Team
 * Directory without this being explicitly on.
 */
export async function setTeamCatalogueAccess(targetUserId: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("set_site_admin_team_catalogue_capability", { p_user_id: targetUserId, p_enabled: enabled })
  if (error) {
    console.error("setTeamCatalogueAccess failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/site-admins")
  return { ok: true }
}

/**
 * Grants or revokes the manage_competitions capability on an existing
 * Site Admin -- Full Site Admin only, mirroring setTeamCatalogueAccess
 * exactly. A genuine, narrow, per-person grant -- no Site Admin profile
 * (including Full) can write to the global Competition Directory without
 * this being explicitly on.
 */
export async function setCompetitionsAccess(targetUserId: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("set_site_admin_competitions_capability", { p_user_id: targetUserId, p_enabled: enabled })
  if (error) {
    console.error("setCompetitionsAccess failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/site-admins")
  return { ok: true }
}

/**
 * Grants or revokes the manage_fixture_support capability on an existing
 * Site Admin -- Full Site Admin only, mirroring setCompetitionsAccess
 * exactly. Closes the prior blanket Site-Admin access to every fixture
 * conversation: without this specific grant, a Site Admin can no longer
 * read or post into a fixture's conversation at all.
 */
export async function setFixtureSupportAccess(targetUserId: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("set_site_admin_fixture_support_capability", { p_user_id: targetUserId, p_enabled: enabled })
  if (error) {
    console.error("setFixtureSupportAccess failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/site-admins")
  return { ok: true }
}

/**
 * Grants or revokes the manage_global_lookups capability on an existing
 * Site Admin -- Full Site Admin only, mirroring setFixtureSupportAccess
 * exactly. Lets this Site Admin add/edit/deactivate any club's venues and
 * pitches from the Site Admin Lookup Administration parent view -- every
 * Site Admin can still SELECT this data regardless (matches the existing
 * open venues_select/club_pitches_select read policies).
 */
export async function setGlobalLookupsAccess(targetUserId: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("set_site_admin_global_lookups_capability", { p_user_id: targetUserId, p_enabled: enabled })
  if (error) {
    console.error("setGlobalLookupsAccess failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/site-admins")
  return { ok: true }
}

/**
 * Grants or revokes the manage_seasons capability on an existing Site
 * Admin -- Full Site Admin only, mirroring setGlobalLookupsAccess exactly.
 * Without this, a narrow Site Admin can still VIEW Seasons (matches the
 * existing open seasons_select_all read policy) but cannot add, edit,
 * archive, or delete one -- see supabase/migrations/20260924100000_site_admin_seasons_crud.sql.
 */
export async function setSeasonsAccess(targetUserId: string, enabled: boolean): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.rpc("set_site_admin_seasons_capability", { p_user_id: targetUserId, p_enabled: enabled })
  if (error) {
    console.error("setSeasonsAccess failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/site-admins")
  return { ok: true }
}

/**
 * Revokes an already-active Site Admin from this list page directly --
 * the same effect as revokeSiteAdmin in admin/users/[userId]/actions.ts
 * (kept there too, for the per-user detail page), gated identically:
 * Full Site Admin only, no self-revoke, and the lockout trigger still
 * blocks removing the last remaining Full Site Admin either way.
 */
export async function revokeActiveSiteAdmin(targetUserId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  if (auth.user.id === targetUserId) {
    return { ok: false, error: "You cannot revoke your own Site Admin access." }
  }

  const { error } = await supabase
    .from("site_admins")
    .update({ status: "revoked", revoked_by: auth.user.id, revoked_at: new Date().toISOString() })
    .eq("user_id", targetUserId)

  if (error) {
    console.error("revokeActiveSiteAdmin failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/site-admins")
  revalidatePath(`/admin/users/${targetUserId}`)
  return { ok: true }
}
