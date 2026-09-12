"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type DelegationResult = { ok: true } | { ok: false; error: string }

/**
 * Grants or withholds ONE capability for ONE person at club scope.
 *
 * Both calls go to the canonical set_capability_override /
 * revoke_capability_override, which decide the authority themselves -- a
 * club administrator may only reach their own club, only the operational
 * capabilities, and never the delegation authority itself. This action adds
 * no permission of its own and cannot become a way around one.
 */
export async function setClubCapability(
  userId: string,
  capabilityKey: string,
  clubId: string,
  effect: "grant" | "deny",
): Promise<DelegationResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_capability_override", {
    p_user_id: userId,
    p_capability_key: capabilityKey,
    p_scope_type: "club",
    p_club_id: clubId,
    // Club scope names no team; the RPC refuses a team id here.
    p_team_id: null as unknown as string,
    p_effect: effect,
    p_reason: "Set from the club's permissions screen",
  })
  if (error) return { ok: false, error: error.message || "That permission could not be saved." }
  revalidatePath("/club/permissions")
  return { ok: true }
}

/** Removes an explicit decision, returning the person to whatever their role gives them. */
export async function clearClubCapability(overrideId: string): Promise<DelegationResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("revoke_capability_override", { p_override_id: overrideId })
  if (error) return { ok: false, error: error.message || "That permission could not be reset." }
  revalidatePath("/club/permissions")
  return { ok: true }
}
