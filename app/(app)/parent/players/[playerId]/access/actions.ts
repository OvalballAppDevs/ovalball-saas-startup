"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type SetPermissionResult = { ok: true } | { ok: false; error: string }

/**
 * Thin wrapper over set_guardian_player_permission() -- that RPC is the
 * entire boundary (guardian_player_permissions_insert_scoped: only an
 * active guardian of this exact player, recording only their OWN
 * decision). Never re-implements the deny-by-default/all-guardians-must-
 * grant aggregation here -- internal.guardian_permission_effective() (read
 * via get_player_permission_summary) is the single source of truth for
 * that, this action only ever writes ONE guardian's ONE decision.
 */
export async function setPlayerPermission(playerId: string, permissionKey: string, granted: boolean): Promise<SetPermissionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_guardian_player_permission", {
    p_player_id: playerId,
    p_permission_key: permissionKey,
    p_granted: granted,
  })
  if (error) return { ok: false, error: "We couldn't save that change. Please try again." }
  revalidatePath(`/parent/players/${playerId}/access`)
  return { ok: true }
}
