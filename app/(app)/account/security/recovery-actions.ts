"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type CancelResult = { ok: true } | { ok: false; error: string }

/**
 * Stopping a recovery somebody started against your account.
 *
 * The RPC is the boundary: it accepts the target, a guardian of a child target, or somebody holding
 * site.users.security.manage, and refuses everybody else. Naming a stranger's request id achieves
 * nothing.
 */
export async function cancelRecovery(requestId: string): Promise<CancelResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_privileged_recovery", {
    p_request_id: requestId,
    p_reason: "cancelled by the account holder",
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/account/security")
  return { ok: true }
}
