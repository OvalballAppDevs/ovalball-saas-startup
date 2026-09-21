"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/**
 * CONVERGENCE STEP 13 / IDENTITY-AUTH SLICE 9.
 *
 * Both calls are thin. Every decision -- the capability, recent AAL2, the reason, the thirty-minute
 * window, whether this session may act or only look -- belongs to the RPC, because the browser is
 * never told whose authority it is using. There is no header to set and nothing here to forge.
 */

export type ImpersonationResult = { ok: true } | { ok: false; message: string }

function fail(error: { code?: string; message: string }): ImpersonationResult {
  if (error.code === "42501" || error.code === "P0001" || error.code === "P0002") {
    return { ok: false, message: error.message }
  }
  return { ok: false, message: "That could not be started. Please try again." }
}

export async function startActingAs(targetUserId: string, reason: string): Promise<ImpersonationResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("start_impersonation", {
    p_target_user_id: targetUserId,
    p_reason: reason,
  })
  if (error) return fail(error)
  revalidatePath("/", "layout")
  return { ok: true }
}

export async function stopActingAs(): Promise<void> {
  const supabase = await createClient()
  // Ending is deliberately forgiving: ending nothing is not an error, so the banner's button always
  // does the safe thing even if the session expired a moment ago.
  await supabase.rpc("end_impersonation", {})
  revalidatePath("/", "layout")
}
