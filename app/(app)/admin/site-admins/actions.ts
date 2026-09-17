"use server"

import { revalidatePath } from "next/cache"

import { sendEmailEvent } from "@/lib/email/send"
import { toPublicSubmissionError } from "@/lib/errors/public-error"
import { createClient } from "@/lib/supabase/server"

import { requireSiteAdmin } from "../require-site-admin"
import { profileLabel as PROFILE_LABEL_FN } from "./profiles"
import { getSiteUrl } from "@/lib/site-url"

export type ActionResult = { ok: true } | { ok: false; error: string }


export type InviteSiteAdminResult = { ok: true; inviteLink: string } | { ok: false; error: string }

/**
 * The canonical Site Admin invitation.
 *
 * `public.issue_invitation` is the authority -- the SITE_ADMIN kind requires
 * `site.admins.manage` through the canonical site capability check, not a bare `is_site_admin()`.
 * `requireSiteAdmin` here only gives a real error instead of a confusing rejection.
 *
 * The row grants nothing by existing. Redemption, reached from /join, is the only path from here to
 * a real `site_admins` row: it requires the recipient's own authenticated session email to match,
 * and -- because this is the widest authority Ovalball has -- it requires a date of birth on file
 * showing they are an adult (D-S5-1). No real email is sent this session, see lib/email/send.ts, so
 * the invite link is returned directly too and an invitation still works with no mail provider.
 */
const MIN_REASON = 10

export async function inviteSiteAdmin(email: string, adminRole: string): Promise<InviteSiteAdminResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  const trimmedEmail = email.trim().toLowerCase()
  if (!trimmedEmail) return { ok: false, error: "An email address is required." }

  const { data, error } = await supabase
    .rpc("issue_invitation", {
      p_kind: "SITE_ADMIN",
      p_email: trimmedEmail,
      p_intended_outcome: { admin_role: adminRole },
    })
    .maybeSingle()

  if (error || !data) {
    console.error("inviteSiteAdmin failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }

  if (data.already_existed || !data.token) {
    return { ok: false, error: "That person already has a Site Admin invitation waiting to be accepted." }
  }

  const inviteLink = `${getSiteUrl()}/join?t=${encodeURIComponent(data.token)}`
  const profileLabel = PROFILE_LABEL_FN(adminRole)

  await sendEmailEvent({
    supabase,
    eventKey: "site_admin_invitation",
    idempotencyKey: `site_admin_invitation:${data.invitation_id}`,
    recipient: { kind: "access_invitation", invitationId: data.invitation_id },
    data: { profileLabel, inviteToken: data.token },
  })

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
 * Changes an EXISTING active Site Admin's profile -- distinct from granting
 * access for the first time.
 *
 * SLICE 7c: this used to be a direct update of public.site_admins from the
 * browser. No browser role can write that table any more, because the
 * two-person grant rule lives in a SECURITY DEFINER function and a rule is
 * worth nothing while the caller can write the table instead.
 *
 * public.site_change_site_admin_profile carries the asymmetry that matters:
 * moving somebody UP TO SITE_FULL is a grant of the authority the rule
 * exists to protect, so it goes through the two-admin gate and fails here
 * unless a second Full Site Admin has already approved it. Moving them down
 * or sideways is a reduction, and one administrator may do it.
 *
 * internal.prevent_last_full_admin_lockout still fires underneath either
 * way, so the last remaining Full Site Admin cannot be quietly demoted.
 */
export async function changeSiteAdminRole(
  targetUserId: string,
  profileKey: string,
  reason: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }
  if (reason.trim().length < MIN_REASON) {
    return { ok: false, error: `Give a fuller reason — at least ${MIN_REASON} characters, so the record makes sense later.` }
  }

  const { error } = await supabase.rpc("site_change_site_admin_profile", {
    p_user_id: targetUserId,
    p_profile_key: profileKey,
    p_reason: reason.trim(),
  })
  if (error) {
    console.error("changeSiteAdminRole failed:", error)
    // These carry the sentence the administrator needs -- the two-admin
    // refusal, the lockout guard -- and none of them leak anything.
    if (error.code === "42501" || error.code === "22023" || error.code === "23514" || error.message.includes("last remaining Full Site Admin")) {
      return { ok: false, error: error.message }
    }
    return { ok: false, error: toPublicSubmissionError() }
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
export async function revokeActiveSiteAdmin(targetUserId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  if (auth.user.id === targetUserId) {
    return { ok: false, error: "You cannot revoke your own Site Admin access." }
  }
  if (reason.trim().length < MIN_REASON) {
    return { ok: false, error: `Give a fuller reason — at least ${MIN_REASON} characters, so the record makes sense later.` }
  }

  // Revoking deliberately needs only one administrator: taking authority
  // away is the safe direction, and requiring two people to stop somebody is
  // how an incident gets worse while a form is filled in. The RPC also ends
  // every live session, so the authority does not outlive the decision.
  const { error } = await supabase.rpc("site_revoke_site_admin", {
    p_user_id: targetUserId,
    p_reason: reason.trim(),
  })

  if (error) {
    console.error("revokeActiveSiteAdmin failed:", error)
    if (error.code === "42501" || error.code === "23514" || error.message.includes("last remaining Full Site Admin")) {
      return { ok: false, error: error.message }
    }
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/admin/site-admins")
  revalidatePath(`/admin/users/${targetUserId}`)
  return { ok: true }
}
