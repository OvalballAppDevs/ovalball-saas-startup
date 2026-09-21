"use server"

import { revalidatePath } from "next/cache"

import { invitationJoinUrl } from "@/lib/invitations/share"
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
 * CONVERGENCE STEP 16 — INVITING SOMEBODY TO ACT FOR THE ORGANISATION.
 *
 * THIS REPLACED A GRANT, AND THAT IS THE WHOLE POINT. Step 15 gave a role to an address that already
 * had an Ovalball account and answered NO_ACCOUNT when it did not — which told a governing-body
 * administrator whether any given address is registered on Ovalball. There is now ONE path that works
 * either way, so the product never has to distinguish and there is nothing left to learn from the
 * answer. `grant_governing_body_role_by_email` was dropped rather than left unused.
 *
 * The invitation is the canonical one: hashed token and code, a 7-day lifetime, single use, bound to
 * the invited address and redeemable only by a session whose CONFIRMED email matches it. So the link
 * this returns is not a bearer credential — forwarding it to somebody else does not give them access.
 */
export async function inviteBodyOfficer(
  bodyId: string,
  email: string,
  roleKey: string
): Promise<{ ok: true; joinUrl: string | null; alreadyExisted: boolean } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc("invite_governing_body_officer", { p_body_id: bodyId, p_email: email, p_role_key: roleKey })
    .maybeSingle()
  if (error || !data) return { ok: false, error: error?.message ?? "That invitation could not be created." }
  revalidatePath(`/governing/${bodyId}/people`)
  return {
    ok: true,
    // Null when an open invitation to that address already existed: the token is not re-issued, because
    // the live one is still valid. "Send Again" rotates it deliberately.
    joinUrl: data.token ? invitationJoinUrl(data.token) : null,
    alreadyExisted: data.already_existed ?? false,
  }
}

/** Rotates the secret and returns a fresh link — the canonical remedy for a link sent to the wrong place. */
export async function resendBodyInvitation(
  bodyId: string,
  invitationId: string
): Promise<{ ok: true; joinUrl: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("resend_invitation", { p_invitation_id: invitationId }).maybeSingle()
  if (error || !data?.token) return { ok: false, error: error?.message ?? "That invitation could not be sent again." }
  revalidatePath(`/governing/${bodyId}/people`)
  return { ok: true, joinUrl: invitationJoinUrl(data.token) }
}

/** Canonical revocation, reached through the same authority that revokes a club invitation. */
export async function revokeBodyInvitation(
  bodyId: string,
  invitationId: string,
  reason: string
): Promise<GoverningActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: invitationId, p_reason: reason })
  if (error) return { ok: false, error: error.message }
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
