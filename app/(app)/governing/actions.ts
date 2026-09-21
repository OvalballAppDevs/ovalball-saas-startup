"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/**
 * CONVERGENCE STEP 15 — the three Governing Body writes.
 *
 * Each one is a thin pass to a SECURITY DEFINER function that decides authority for itself. Nothing
 * here checks a role before calling: the database refuses a caller who holds none, and a check in this
 * file would be a second, weaker authority that could drift away from the first. The error the person
 * reads is the database's own sentence, so what they are told matches what actually happened.
 */

export type GoverningActionResult = { ok: true } | { ok: false; error: string }

/**
 * Giving somebody access, by the email address of the Ovalball account they already have.
 *
 * NO_ACCOUNT is an ordinary answer rather than a failure: inviting a person who is not on Ovalball yet
 * needs the canonical invitation system, whose kinds have no governing-body shape, and a private token
 * invented here instead would be the defect. The page says so plainly.
 */
export async function grantBodyAccess(
  bodyId: string,
  email: string,
  roleKey: string,
  reason: string | null
): Promise<GoverningActionResult | { ok: false; noAccount: true }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("grant_governing_body_role_by_email", {
    p_body_id: bodyId,
    p_email: email,
    p_role_key: roleKey,
    p_reason: reason ?? undefined,
  })
  if (error) return { ok: false, error: error.message }
  if (data?.[0]?.outcome === "NO_ACCOUNT") return { ok: false, noAccount: true }
  revalidatePath(`/governing/${bodyId}/people`)
  return { ok: true }
}

export async function revokeBodyAccess(bodyId: string, userId: string, reason: string | null): Promise<GoverningActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("revoke_governing_body_role", {
    p_body_id: bodyId,
    p_user_id: userId,
    p_reason: reason ?? undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/governing/${bodyId}/people`)
  return { ok: true }
}

/**
 * Starting a competition for the organisation.
 *
 * Returns the new edition so the page can hand straight over to the existing Competition Creator —
 * the whole point of Step 15's competition seam is that a governing body uses the competition product
 * Ovalball already has, rather than a second one built beside it.
 *
 * `needsAttention` carries the honest case: the canonical season register has no current or upcoming
 * season in this rugby code, so the competition exists and has no edition yet. That is surfaced, never
 * papered over with a guessed season.
 */
export async function createBodyCompetition(
  bodyId: string,
  name: string
): Promise<{ ok: true; editionId: string | null; needsAttention: string | null } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_governing_body_competition", { p_body_id: bodyId, p_name: name })
  if (error) return { ok: false, error: error.message }
  const row = data?.[0]
  revalidatePath(`/governing/${bodyId}/competitions`)
  revalidatePath(`/governing/${bodyId}`)
  return { ok: true, editionId: row?.edition_id ?? null, needsAttention: row?.needs_attention ?? null }
}
