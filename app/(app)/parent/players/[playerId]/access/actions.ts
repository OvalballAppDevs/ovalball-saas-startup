"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { requirePlayerCapability } from "@/lib/auth/require-capability"

export type SetPermissionResult = { ok: true } | { ok: false; error: string }

/**
 * Thin wrapper over set_guardian_player_permission() -- that RPC is the
 * entire boundary (family.permission.manage for this exact child, recorded
 * only as the guardian's OWN decision); the early check here only refuses
 * sooner. Never re-implements the deny-by-default/all-guardians-must-
 * grant aggregation here -- internal.guardian_permission_effective() (read
 * via get_player_permission_summary) is the single source of truth for
 * that, this action only ever writes ONE guardian's ONE decision.
 */
export async function setPlayerPermission(playerId: string, permissionKey: string, granted: boolean): Promise<SetPermissionResult> {
  const supabase = await createClient()
  const allowed = await requirePlayerCapability(supabase, "family.permission.manage", playerId)
  if (!allowed.ok) return allowed
  const { error } = await supabase.rpc("set_guardian_player_permission", {
    p_player_id: playerId,
    p_permission_key: permissionKey,
    p_granted: granted,
  })
  if (error) return { ok: false, error: "We couldn't save that change. Please try again." }
  revalidatePath(`/parent/players/${playerId}/access`)
  return { ok: true }
}
