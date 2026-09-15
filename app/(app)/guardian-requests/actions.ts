"use server"

import { revalidatePath } from "next/cache"

import { toPublicGuardianRequestError } from "@/lib/errors/public-error"
import { createClient } from "@/lib/supabase/server"

export type DecisionResult = { ok: true } | { ok: false; error: string }

/**
 * Approving is the moment a guardian relationship comes into existence.
 *
 * Authority is NOT decided here. approve_guardian_link_request re-checks
 * internal.can_decide_guardian_link_request server-side: family.relationship
 * .approve at the request's club, or at the child's team for a first child;
 * an additional guardian at club level only; never the person who asked or
 * the person asked about (Phase 2 N.1). The request's scope is only known to
 * the database, so this action only forwards the id.
 */
export async function approveGuardianLinkRequest(requestId: string): Promise<DecisionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("approve_guardian_link_request", { p_request_id: requestId })
  if (error) {
    console.error("approve_guardian_link_request failed:", error)
    return { ok: false, error: toPublicGuardianRequestError(error) }
  }
  revalidatePath("/guardian-requests")
  return { ok: true }
}

export async function rejectGuardianLinkRequest(requestId: string, note: string): Promise<DecisionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("reject_guardian_link_request", { p_request_id: requestId, p_note: note.trim() || undefined })
  if (error) {
    console.error("reject_guardian_link_request failed:", error)
    return { ok: false, error: toPublicGuardianRequestError(error) }
  }
  revalidatePath("/guardian-requests")
  return { ok: true }
}
