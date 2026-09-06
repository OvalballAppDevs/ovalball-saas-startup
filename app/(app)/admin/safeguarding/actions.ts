"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { requireSiteAdmin } from "../require-site-admin"

export type ActionResult = { ok: true } | { ok: false; error: string }

const SAFEGUARDING_GRANTABLE_CAPABILITIES = [
  "club.dispensation.view",
  "club.dispensation.notify",
  "club.transfer.safeguarding_view",
  "club.transfer.safeguarding_notify",
] as const

export type SafeguardingCapabilityKey = (typeof SAFEGUARDING_GRANTABLE_CAPABILITIES)[number]

/**
 * Reuses the EXISTING, generic set_capability_override/revoke_capability_
 * override RPCs directly -- no new grant/revoke RPC was built for
 * Safeguarding Officer capabilities (spec section 10/13). Restricted here
 * to exactly the four capability keys this feature defines, so this
 * server action itself cannot be used to grant an arbitrary, unrelated
 * platform capability through the Safeguarding Officer UI (spec section
 * 9's own "do not implement Safeguarding Officer can view/edit
 * everything" and section 10's "map to real capabilities" instruction) --
 * though the real, unconditional boundary is set_capability_override's
 * own Site-Admin-only authorization check, which applies identically no
 * matter which capability key is named.
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

  if (enabled) {
    // p_team_id has no SQL-level default (unlike p_reason), so it must be
    // passed explicitly -- the generated RPC arg type is stricter than the
    // real column nullability here (a known imprecision in the generated
    // types, not a real constraint), hence the cast.
    const { error } = await supabase.rpc("set_capability_override", {
      p_user_id: targetUserId,
      p_capability_key: capabilityKey,
      p_scope_type: "club",
      p_club_id: clubId,
      p_team_id: null as unknown as string,
      p_effect: "grant",
      p_reason: "Safeguarding Officer capability grant",
    })
    if (error) return { ok: false, error: error.message }
  } else {
    const { data: overrideRow, error: lookupError } = await supabase
      .from("capability_overrides")
      .select("id")
      .eq("user_id", targetUserId)
      .eq("capability_key", capabilityKey)
      .eq("scope_type", "club")
      .eq("club_id", clubId)
      .eq("effect", "grant")
      .eq("status", "active")
      .maybeSingle()
    if (lookupError) return { ok: false, error: lookupError.message }
    if (overrideRow) {
      const { error } = await supabase.rpc("revoke_capability_override", { p_override_id: overrideRow.id })
      if (error) return { ok: false, error: error.message }
    }
  }

  revalidatePath("/admin/safeguarding")
  return { ok: true }
}
