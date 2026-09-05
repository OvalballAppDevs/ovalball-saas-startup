"use server"

import { revalidatePath } from "next/cache"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

export type ClaimActionResult = { ok: true } | { ok: false; error: string }

/**
 * Both actions call the SECURITY DEFINER functions from
 * supabase/migrations/20260831090000_role_vocabulary_and_claim_approval.sql,
 * which independently re-check is_site_admin() themselves -- that remains
 * the real boundary for "does this account genuinely hold Site Admin
 * authority at all". It cannot, however, know whether the account has
 * actively switched INTO Site Admin as its current context (that's a
 * Next.js cookie, never written to the database) -- the Site Admin
 * route-family guard addendum requires this action to check that half
 * itself, explicitly, before forwarding the call.
 */
export async function approveClaim(claimId: string, notes: string): Promise<ClaimActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }
  if (!(await requireActiveSiteAdmin(supabase, user)).ok) return { ok: false, error: "Site Admin access is required, in an active Site Admin context." }

  const { error } = await supabase.rpc("approve_club_claim", {
    p_claim_id: claimId,
    p_notes: notes || undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/claims")
  return { ok: true }
}

export async function rejectClaim(claimId: string, notes: string): Promise<ClaimActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }
  if (!(await requireActiveSiteAdmin(supabase, user)).ok) return { ok: false, error: "Site Admin access is required, in an active Site Admin context." }

  const { error } = await supabase.rpc("reject_club_claim", {
    p_claim_id: claimId,
    p_notes: notes || undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/claims")
  return { ok: true }
}
