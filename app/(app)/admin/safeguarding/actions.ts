"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { requireSiteAdmin } from "../require-site-admin"
import { CANONICAL_SAFEGUARDING_KEY, SAFEGUARDING_GRANTABLE_CAPABILITIES, type SafeguardingCapabilityKey } from "./capabilities"

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Since Identity/Auth Slice 3 these four capabilities come with the Safeguarding Officer role (Phase 2
 * J.12: a bundle default instead of a per-officer grant). What Ovalball decides here is the exception:
 * switching one OFF records a Site-level withhold through the canonical set_capability_override, and
 * switching it back ON removes that withhold, returning the officer to what their role gives. The RPCs
 * decide the authority themselves; this action only narrows which keys the screen may name.
 */
export async function setSafeguardingCapability(
  targetUserId: string,
  clubId: string,
  capabilityKey: SafeguardingCapabilityKey,
  enabled: boolean
): Promise<ActionResult> {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!SAFEGUARDING_GRANTABLE_CAPABILITIES.includes(capabilityKey)) {
    return { ok: false, error: "Not a Safeguarding Officer capability." }
  }

  if (!enabled) {
    const { error } = await supabase.rpc("set_capability_override", {
      p_user_id: targetUserId,
      p_capability_key: capabilityKey,
      p_scope_type: "club",
      p_club_id: clubId,
      p_team_id: null as unknown as string,
      p_effect: "deny",
      p_reason: "Withheld by Ovalball from the Safeguarding Officer role",
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { data: overrideRow, error: lookupError } = await supabase
      .from("capability_overrides")
      .select("id")
      .eq("user_id", targetUserId)
      .eq("capability_key", CANONICAL_SAFEGUARDING_KEY[capabilityKey])
      .eq("scope_type", "club")
      .eq("club_id", clubId)
      .eq("effect", "deny")
      .eq("status", "active")
      .maybeSingle()
    if (lookupError) return { ok: false, error: lookupError.message }
    if (overrideRow) {
      const { error } = await supabase.rpc("revoke_capability_override", {
        p_override_id: overrideRow.id,
        p_reason: "Restored to the Safeguarding Officer role default",
      })
      if (error) return { ok: false, error: error.message }
    }
  }

  revalidatePath("/admin/safeguarding")
  return { ok: true }
}
