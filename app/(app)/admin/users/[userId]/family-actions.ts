"use server"

import { revalidatePath } from "next/cache"

import { requireSiteCapability } from "@/lib/auth/require-capability"
import { createClient } from "@/lib/supabase/server"

export type FamilyActionResult = { ok: true } | { ok: false; error: string }

/**
 * Ovalball's own family relationship controls (Identity/Auth Slice 4a, Phase 2 N.1 and AN-7): put a guardian
 * relationship on hold, lift a hold, or end it -- each with a reason. site.family.manage decides; the early check
 * here only refuses sooner, and transition_guardian_relationship re-checks everything.
 */
async function transition(guardianId: string, toState: "SUSPENDED" | "ACTIVE" | "REVOKED", reason: string, confidential: boolean | null, userId: string): Promise<FamilyActionResult> {
  const supabase = await createClient()
  const allowed = await requireSiteCapability(supabase, "site.family.manage")
  if (!allowed.ok) return allowed
  const trimmed = reason.trim()
  if (!trimmed) return { ok: false, error: "Please give a reason." }
  const { error } = await supabase.rpc("transition_guardian_relationship", {
    p_guardian_id: guardianId,
    p_to_state: toState,
    p_reason: trimmed,
    p_confidential: confidential ?? undefined,
  })
  if (error) {
    console.error("transition_guardian_relationship failed:", error)
    return { ok: false, error: error.code === "42501" ? "You are not authorised to do that." : error.message }
  }
  revalidatePath(`/admin/users/${userId}`)
  return { ok: true }
}

export async function holdGuardianRelationship(userId: string, guardianId: string, reason: string, confidential: boolean): Promise<FamilyActionResult> {
  return transition(guardianId, "SUSPENDED", reason, confidential, userId)
}

export async function liftGuardianRelationshipHold(userId: string, guardianId: string, reason: string): Promise<FamilyActionResult> {
  return transition(guardianId, "ACTIVE", reason, null, userId)
}

export async function endGuardianRelationship(userId: string, guardianId: string, reason: string): Promise<FamilyActionResult> {
  return transition(guardianId, "REVOKED", reason, null, userId)
}
