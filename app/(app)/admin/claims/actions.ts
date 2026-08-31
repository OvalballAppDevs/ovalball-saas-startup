"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type ClaimActionResult = { ok: true } | { ok: false; error: string }

/**
 * Both actions call the SECURITY DEFINER functions from
 * supabase/migrations/20260831090000_role_vocabulary_and_claim_approval.sql,
 * which independently re-check is_site_admin() themselves -- this action
 * doesn't (and doesn't need to) authorize anything itself, it only forwards
 * the call through the caller's own authenticated session. A non-admin
 * calling this gets the function's own rejection, not a client-side one.
 */
export async function approveClaim(claimId: string, notes: string): Promise<ClaimActionResult> {
  const supabase = await createClient()
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
  const { error } = await supabase.rpc("reject_club_claim", {
    p_claim_id: claimId,
    p_notes: notes || undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/admin/claims")
  return { ok: true }
}
