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
 * Account-level suspend/reactivate -- genuinely blocks protected actions,
 * not a shadow flag: internal.is_account_active() is composed into
 * is_site_admin/is_club_admin/can_manage_team/can_manage_club_fixtures
 * (20260831230000), the four functions nearly every meaningful RLS write
 * policy in this project already funnels through. No service-role key is
 * available to this app, so this never touches auth.users/login itself --
 * a suspended user can still authenticate, but every protected action they
 * try will fail exactly as if they had no membership at all. A Site Admin
 * cannot suspend their own account (the same self-lockout guard as
 * revokeSiteAdmin).
 */
export async function suspendUser(targetUserId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'user_access'])
  if (!auth.ok) return { ok: false, error: auth.error }

  if (auth.user.id === targetUserId) {
    return { ok: false, error: "You cannot suspend your own account." }
  }

  const { error } = await supabase.from("profiles").update({ account_status: "suspended" }).eq("id", targetUserId)

  if (error) {
    console.error("suspendUser failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath(`/admin/users/${targetUserId}`)
  revalidatePath("/admin/users")
  return { ok: true }
}

export async function reactivateUser(targetUserId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full', 'user_access'])
  if (!auth.ok) return { ok: false, error: auth.error }

  const { error } = await supabase.from("profiles").update({ account_status: "active" }).eq("id", targetUserId)

  if (error) {
    console.error("reactivateUser failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath(`/admin/users/${targetUserId}`)
  revalidatePath("/admin/users")
  return { ok: true }
}

export async function revokeSiteAdmin(targetUserId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase, ['full'])
  if (!auth.ok) return { ok: false, error: auth.error }

  if (auth.user.id === targetUserId) {
    return { ok: false, error: "You cannot revoke your own Site Admin access." }
  }

  const { error } = await supabase
    .from("site_admins")
    .update({ status: "revoked", revoked_by: auth.user.id, revoked_at: new Date().toISOString() })
    .eq("user_id", targetUserId)

  if (error) {
    console.error("revokeSiteAdmin failed:", error)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath(`/admin/users/${targetUserId}`)
  revalidatePath("/admin/users")
  return { ok: true }
}
