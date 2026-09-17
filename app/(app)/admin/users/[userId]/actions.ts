"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { toPublicSubmissionError } from "@/lib/errors/public-error"

import { requireSiteAdmin } from "../../require-site-admin"

export type ActionResult = { ok: true } | { ok: false; error: string }

export interface PersonalDetails {
  dateOfBirth: string | null
  addressLine1: string | null
  addressLine2: string | null
  addressLine3: string | null
  town: string | null
  county: string | null
  country: string | null
  postcode: string | null
}

/**
 * Deliberately its own query, separate from the admin_user_overview list
 * view, which never selects these columns at all -- per the brief's own
 * caution ("do not put DOB/home address in the default grids"), this data
 * is reachable only one profile at a time, from this detail-page action,
 * gated by the exact same RLS (profiles_select_self_or_admin) either way.
 */
export async function getPersonalDetails(userId: string): Promise<PersonalDetails | null> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) return null

  const { data } = await supabase
    .from("profiles")
    .select("date_of_birth, address_line_1, address_line_2, address_line_3, town, county, country, postcode")
    .eq("id", userId)
    .maybeSingle()

  if (!data) return null
  return {
    dateOfBirth: data.date_of_birth,
    addressLine1: data.address_line_1,
    addressLine2: data.address_line_2,
    addressLine3: data.address_line_3,
    town: data.town,
    county: data.county,
    country: data.country,
    postcode: data.postcode,
  }
}

/**
 * Revoke is deliberately separate from changeAccessProfile
 * (admin/clubs/[directoryId]/actions.ts) -- global platform authority, not
 * a club-scoped permission, and never reachable through the club-access
 * form by construction. There is no direct "grant" here: a Site Admin is
 * only ever granted through the Site Admin Management invitation flow
 * (/admin/site-admins), which requires expiry, recipient-binding, and
 * authenticated acceptance -- a one-click direct grant would bypass exactly
 * the safeguards that flow exists for. Revoke has no equivalent acceptance
 * step to bypass, so it stays here as an immediate action. A Site Admin
 * cannot revoke their own access through this action (a safety rail against
 * accidental self-lockout, on top of the last-full-admin lockout trigger).
 */

/**
 * Account-level suspend/reinstate -- genuinely blocks protected actions, not
 * a shadow flag: internal.is_account_active() is composed into the resolver
 * chain nearly every meaningful RLS write policy funnels through. No
 * service-role key is available to this app, so this never touches
 * auth.users or login itself -- a suspended person can still authenticate,
 * but every protected action fails exactly as if they had no membership.
 *
 * SLICE 7: this used to call set_account_status(), which decided authority
 * by comparing site_admins.admin_role against the strings 'full' and
 * 'user_access'. That is the presentation role -- the word the Site Admins
 * screen displays -- and reading it skipped capability_decision entirely,
 * and with it the recent-authenticator requirement, the session liveness
 * check and any per-person capability override. It also took no reason and
 * emitted no security event of its own, so an account could be suspended
 * with nothing on the record saying why.
 *
 * It now calls public.site_set_account_state, which carries the Q.3 master
 * control preamble: the named capability, a recent authenticator code, a
 * reason of at least ten characters, and a refusal to act on your own
 * account. The reason is not decoration -- it is what the audit line says
 * to whoever reads it months later, which is why the form below requires
 * it rather than defaulting it.
 *
 * The capability asked for depends on the state, deliberately: DISABLED
 * needs site.users.disable (SITE_FULL only) while SUSPENDED needs
 * site.users.security.manage (SITE_FULL and SITE_SUPPORT). Switching an
 * account off permanently is a larger act than suspending it.
 */
const MIN_REASON = 10

async function setAccountState(
  targetUserId: string,
  state: "ACTIVE" | "SUSPENDED" | "DISABLED",
  reason: string,
): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full", "user_access"])
  if (!auth.ok) return { ok: false, error: auth.error }

  // Checked here so the person gets a useful message instead of a database
  // error, and checked again in site_set_account_state because this one is
  // only a courtesy -- the boundary is the RPC.
  if (auth.user.id === targetUserId) {
    return { ok: false, error: "You cannot change your own account's status." }
  }
  if (reason.trim().length < MIN_REASON) {
    return { ok: false, error: `Give a fuller reason — at least ${MIN_REASON} characters, so the record makes sense later.` }
  }

  const { error } = await supabase.rpc("site_set_account_state", {
    p_user_id: targetUserId,
    p_state: state,
    p_reason: reason.trim(),
  })

  if (error) {
    console.error("setAccountState failed:", error)
    // 42501 is the preamble refusing: the capability, the authenticator code
    // or the self-target. Its message is written for the person reading it
    // and carries nothing sensitive, so it is surfaced rather than swallowed.
    if (error.code === "42501" || error.code === "22023") {
      return { ok: false, error: error.message }
    }
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath(`/admin/users/${targetUserId}`)
  revalidatePath("/admin/users")
  return { ok: true }
}

export async function suspendUser(targetUserId: string, reason: string): Promise<ActionResult> {
  return setAccountState(targetUserId, "SUSPENDED", reason)
}

export async function reactivateUser(targetUserId: string, reason: string): Promise<ActionResult> {
  return setAccountState(targetUserId, "ACTIVE", reason)
}

export async function disableUser(targetUserId: string, reason: string): Promise<ActionResult> {
  return setAccountState(targetUserId, "DISABLED", reason)
}

/**
 * SLICE 7c: public.site_admins is no longer writable by any browser role,
 * so this goes through the canonical revocation, which also ends every live
 * session for the person -- a revoked administrator holding an open session
 * is exactly the case a capability check alone does not cover.
 */
export async function revokeSiteAdmin(targetUserId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ["full"])
  if (!auth.ok) return { ok: false, error: auth.error }

  if (auth.user.id === targetUserId) {
    return { ok: false, error: "You cannot revoke your own Site Admin access." }
  }
  if (reason.trim().length < MIN_REASON) {
    return { ok: false, error: `Give a fuller reason — at least ${MIN_REASON} characters, so the record makes sense later.` }
  }

  const { error } = await supabase.rpc("site_revoke_site_admin", {
    p_user_id: targetUserId,
    p_reason: reason.trim(),
  })

  if (error) {
    console.error("revokeSiteAdmin failed:", error)
    if (error.code === "42501" || error.code === "23514" || error.message.includes("last remaining Full Site Admin")) {
      return { ok: false, error: error.message }
    }
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath(`/admin/users/${targetUserId}`)
  revalidatePath("/admin/users")
  return { ok: true }
}
