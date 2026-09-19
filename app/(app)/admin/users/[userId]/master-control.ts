"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { toPublicSubmissionError } from "@/lib/errors/public-error"

import { requireSiteAdmin } from "../../require-site-admin"

/**
 * SLICE 7e -- the seventeen master-control RPCs that had no caller.
 *
 * Slice 7a–7c built twenty-three of these and wired six. The other seventeen
 * were reachable only from SQL, which meant the two-administrator rule could
 * not be performed through the product at all, the three provenance timelines
 * answered a question no screen asked, and "revoke this person's sessions"
 * was a thing the platform could do and nobody could ask it to.
 *
 * Every action here is the same four lines: confirm the caller is operating as
 * a Site Admin, insist on a reason long enough to mean something, call the RPC,
 * revalidate. Nothing here decides authority. The preamble inside each RPC
 * re-asks for the capability, a TOTP code presented in the last ten minutes and
 * the reason, and refuses a self-target -- so a mistake in this file can make an
 * operation unavailable but cannot make one permitted.
 *
 * WHY THE REFUSALS ARE SHOWN VERBATIM. The canonical functions classify every
 * refusal a person is meant to read with an explicit SQLSTATE: 42501 for
 * authority, 23514 for a rule (age gates, the last-Club-Admin guard, the
 * Safeguarding Officer nomination rule), 22023 for a malformed argument, P0002
 * for a row that is not there. Anything else is an internal fault, and gets the
 * generic message. That allowlist is why "This would leave the club with no
 * Club Admin" reaches the screen while a constraint name never does.
 */

export type ActionResult = { ok: true; note?: string } | { ok: false; error: string }

const MIN_REASON = 10

/** The four SQLSTATEs the canonical functions use for a refusal written to be read. */
const SPEAKABLE = new Set(["42501", "23514", "22023", "P0002"])

async function call(
  targetUserId: string,
  reason: string,
  operation: string,
  // PromiseLike, not Promise: supabase-js returns a thenable builder rather than
  // a real Promise, and typing this as Promise silently rejects every call site.
  run: (
    supabase: Awaited<ReturnType<typeof createClient>>,
    reason: string
  ) => PromiseLike<{ error: { code?: string; message: string } | null }>,
  extraPaths: string[] = []
): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  const trimmed = reason.trim()
  if (trimmed.length < MIN_REASON) {
    return { ok: false, error: `Give a fuller reason — at least ${MIN_REASON} characters, so the record makes sense later.` }
  }

  const { error } = await run(supabase, trimmed)
  if (error) {
    console.error(`${operation} failed:`, error)
    if (error.code && SPEAKABLE.has(error.code)) return { ok: false, error: error.message }
    return { ok: false, error: toPublicSubmissionError() }
  }

  revalidatePath(`/admin/users/${targetUserId}`)
  revalidatePath("/admin/users")
  for (const path of extraPaths) revalidatePath(path)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 3. Account & Security
// ---------------------------------------------------------------------------

/**
 * Ends every live session for the account. Runs inside the definer rather than
 * handing the work to a service-role client, so no elevated client sits in the
 * request path -- which is also why there is nothing to do here but ask.
 */
export async function revokeSessions(userId: string, _values: Record<string, string>, reason: string): Promise<ActionResult> {
  return call(userId, reason, "site_revoke_sessions", (supabase, r) =>
    supabase.rpc("site_revoke_sessions", { p_user_id: userId, p_reason: r })
  )
}

/**
 * Bounded by L2: no Site Admin path sets, sees or chooses a password. This marks
 * the account as needing a reset and ends its sessions; the person then resets
 * it themselves through recovery. There is deliberately no "set a password for
 * them" anywhere in this product.
 */
export async function forcePasswordReset(userId: string, _values: Record<string, string>, reason: string): Promise<ActionResult> {
  return call(userId, reason, "site_force_password_reset", (supabase, r) =>
    supabase.rpc("site_force_password_reset", { p_user_id: userId, p_reason: r })
  )
}

// ---------------------------------------------------------------------------
// 4. Club Memberships
// ---------------------------------------------------------------------------

export async function addClubMembership(userId: string, values: Record<string, string>, reason: string): Promise<ActionResult> {
  const clubId = values.clubId
  if (!clubId) return { ok: false, error: "Choose a club." }
  return call(
    userId,
    reason,
    "site_add_club_membership",
    (supabase, r) => supabase.rpc("site_add_club_membership", { p_user_id: userId, p_club_id: clubId, p_reason: r }),
    ["/people"]
  )
}

export async function transitionClubMembership(
  userId: string,
  membershipId: string,
  values: Record<string, string>,
  reason: string
): Promise<ActionResult> {
  const to = values.toState
  if (!to) return { ok: false, error: "Choose what the membership should become." }
  return call(
    userId,
    reason,
    "site_transition_club_membership",
    (supabase, r) =>
      supabase.rpc("site_transition_club_membership", { p_membership_id: membershipId, p_to_state: to, p_reason: r }),
    ["/people"]
  )
}

// ---------------------------------------------------------------------------
// 5. Club Roles
// ---------------------------------------------------------------------------

export async function assignClubRole(userId: string, values: Record<string, string>, reason: string): Promise<ActionResult> {
  const clubId = values.clubId
  const roleKey = values.roleKey
  if (!clubId || !roleKey) return { ok: false, error: "Choose a club and a role." }
  return call(
    userId,
    reason,
    "site_assign_club_role",
    (supabase, r) =>
      supabase.rpc("site_assign_club_role", { p_user_id: userId, p_club_id: clubId, p_role_key: roleKey, p_reason: r }),
    ["/people"]
  )
}

/**
 * `p_allow_no_club_admin` is the override for the last-Club-Admin guard. It is
 * a separate, deliberate tick rather than something this action decides, because
 * the guard exists to stop a club being left with nobody who can administer it
 * -- and the override is recorded in the audit line either way.
 */
export async function revokeRoleAssignment(
  userId: string,
  assignmentId: string,
  values: Record<string, string>,
  reason: string
): Promise<ActionResult> {
  return call(
    userId,
    reason,
    "site_revoke_role_assignment",
    (supabase, r) =>
      supabase.rpc("site_revoke_role_assignment", {
        p_assignment_id: assignmentId,
        p_reason: r,
        p_allow_no_club_admin: values.allowNoClubAdmin === "yes",
      }),
    ["/people"]
  )
}

// ---------------------------------------------------------------------------
// 6. Team Memberships
// ---------------------------------------------------------------------------

export async function assignTeamRole(userId: string, values: Record<string, string>, reason: string): Promise<ActionResult> {
  const teamId = values.teamId
  const roleKey = values.roleKey
  if (!teamId || !roleKey) return { ok: false, error: "Choose a team and a role." }
  return call(
    userId,
    reason,
    "site_assign_team_role",
    (supabase, r) =>
      supabase.rpc("site_assign_team_role", { p_user_id: userId, p_team_id: teamId, p_role_key: roleKey, p_reason: r }),
    [`/teams/${teamId}`]
  )
}

/**
 * A player's place in a team, not a staff role. The RPC calls
 * internal.assert_player_team_pathway_compatible on an add, so a Site Admin
 * cannot put a child in an age grade or pathway the governing body's rules
 * refuse -- platform authority does not outrank an RFU age-grade rule.
 */
export async function setPlayerTeamMembership(
  userId: string,
  values: Record<string, string>,
  reason: string
): Promise<ActionResult> {
  const playerId = values.playerId
  const teamId = values.teamId
  const action = values.action
  if (!playerId || !teamId || !action) return { ok: false, error: "Choose a player, a team and what to do." }
  return call(
    userId,
    reason,
    "site_set_player_team_membership",
    (supabase, r) =>
      supabase.rpc("site_set_player_team_membership", {
        p_player_id: playerId,
        p_team_id: teamId,
        p_action: action,
        p_reason: r,
      }),
    [`/teams/${teamId}`]
  )
}

// ---------------------------------------------------------------------------
// 7. Family
// ---------------------------------------------------------------------------

/**
 * For a family link the family cannot repair themselves. The RPC refuses
 * CLUB_VERIFIED outright -- a Site Admin attests SITE_VERIFIED on their own
 * authority or records UNVERIFIED, and never claims a club checked something it
 * did not.
 */
export async function linkGuardian(userId: string, values: Record<string, string>, reason: string): Promise<ActionResult> {
  const playerId = values.playerId
  const relationshipType = values.relationshipType
  if (!playerId || !relationshipType) return { ok: false, error: "Choose a child and the relationship." }
  return call(userId, reason, "site_link_guardian", (supabase, r) =>
    supabase.rpc("site_link_guardian", {
      p_guardian_user_id: userId,
      p_player_id: playerId,
      p_relationship_type: relationshipType,
      p_reason: r,
      p_verification_state: values.verificationState || "SITE_VERIFIED",
    })
  )
}

/** Revokes the relationship; never deletes it, so the record that it existed survives for safeguarding. */
export async function endGuardianRelationship(
  userId: string,
  relationshipId: string,
  _values: Record<string, string>,
  reason: string
): Promise<ActionResult> {
  return call(userId, reason, "site_end_guardian_relationship", (supabase, r) =>
    supabase.rpc("site_end_guardian_relationship", { p_relationship_id: relationshipId, p_reason: r })
  )
}

// ---------------------------------------------------------------------------
// 8. Capability Overrides
// ---------------------------------------------------------------------------

/**
 * A per-person exception to the whole capability model, which is exactly the
 * operation that should cost a recent authenticator code and a readable reason.
 * An expiry is offered because most exceptions are temporary and the ones that
 * are not should be a role, not an override.
 */
export async function setCapabilityOverride(
  userId: string,
  values: Record<string, string>,
  reason: string
): Promise<ActionResult> {
  const capabilityKey = values.capabilityKey
  const scopeType = values.scopeType
  const effect = values.effect
  if (!capabilityKey || !scopeType || !effect) return { ok: false, error: "Choose a capability, a scope and an effect." }
  if (scopeType === "club" && !values.clubId) return { ok: false, error: "A club-scoped override needs a club." }
  if (scopeType === "team" && !values.teamId) return { ok: false, error: "A team-scoped override needs a team." }
  return call(
    userId,
    reason,
    "site_set_capability_override",
    (supabase, r) =>
      supabase.rpc("site_set_capability_override", {
        p_user_id: userId,
        p_capability_key: capabilityKey,
        p_scope_type: scopeType,
        // The generated Args type marks these `string` because the function
        // declares no default for them, but a site-scoped override genuinely
        // has no club and no team and PostgREST wants an explicit null.
        p_club_id: (values.clubId || null) as string,
        p_team_id: (values.teamId || null) as string,
        p_effect: effect,
        p_reason: r,
        p_expires_at: (values.expiresAt ? new Date(`${values.expiresAt}T23:59:59Z`).toISOString() : null) as string | undefined,
      }),
    ["/admin/permissions"]
  )
}

// ---------------------------------------------------------------------------
// 9. Invitations
// ---------------------------------------------------------------------------

/**
 * Authorises at site scope and then delegates to public.revoke_invitation, which
 * re-decides authority for itself -- the Slice 5 revocation stays the only code
 * that revokes an invitation.
 */
export async function revokeInvitation(
  userId: string,
  invitationId: string,
  _values: Record<string, string>,
  reason: string
): Promise<ActionResult> {
  return call(userId, reason, "site_revoke_invitation", (supabase, r) =>
    supabase.rpc("site_revoke_invitation", { p_invitation_id: invitationId, p_reason: r })
  )
}

/**
 * ROTATES the account-setup invitation: the live one is revoked before the next
 * is issued, because two live setup links for one person is two ways in and the
 * older one is the one nobody is watching. Per AN-8 the new token is never
 * returned to this screen.
 */
export async function resendAccountSetup(userId: string, _values: Record<string, string>, reason: string): Promise<ActionResult> {
  return call(userId, reason, "site_resend_account_setup", (supabase, r) =>
    supabase.rpc("site_resend_account_setup", { p_user_id: userId, p_reason: r })
  )
}

// ---------------------------------------------------------------------------
// 10. Site Admin
// ---------------------------------------------------------------------------

/**
 * Raises a PENDING request and grants nothing. The second administrator decides
 * it on /admin/site-admins -- not here, because a person's own record is not the
 * place their own elevation gets approved.
 */
export async function requestSiteAdminGrant(userId: string, values: Record<string, string>, reason: string): Promise<ActionResult> {
  const profileKey = values.profileKey
  if (!profileKey) return { ok: false, error: "Choose the Site Admin profile being asked for." }
  return call(
    userId,
    reason,
    "site_request_site_admin_grant",
    (supabase, r) =>
      supabase.rpc("site_request_site_admin_grant", { p_target_user_id: userId, p_profile_key: profileKey, p_reason: r }),
    ["/admin/site-admins"]
  )
}

/**
 * A move UP to SITE_FULL goes through the two-administrator gate inside the RPC,
 * because it grants the authority the rule exists to protect. A move down or
 * sideways is a reduction and one administrator may do it.
 */
export async function changeSiteAdminProfile(userId: string, values: Record<string, string>, reason: string): Promise<ActionResult> {
  const profileKey = values.profileKey
  if (!profileKey) return { ok: false, error: "Choose a profile." }
  return call(
    userId,
    reason,
    "site_change_site_admin_profile",
    (supabase, r) => supabase.rpc("site_change_site_admin_profile", { p_user_id: userId, p_profile_key: profileKey, p_reason: r }),
    ["/admin/site-admins"]
  )
}
