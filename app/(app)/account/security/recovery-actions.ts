"use server"

import { revalidatePath } from "next/cache"

import { guardAction } from "@/lib/auth/action-boundary"
import { toPublicSubmissionError } from "@/lib/errors/public-error"
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
  // D.2 layer 2. The RPC really is the boundary and that has not changed -- but this action had no
  // server-side check of its own at all, so a direct POST from a revoked or suspended session reached
  // the database before anything said no. It now meets the same gate as every other protected action.
  const gate = await guardAction({}, supabase)
  if (!gate.ok) return { ok: false, error: gate.error }

  const { error } = await supabase.rpc("cancel_privileged_recovery", {
    p_request_id: requestId,
    p_reason: "cancelled by the account holder",
  })
  // The raw Postgres message used to be returned to the browser. On a security surface that is a free
  // read of internal function and column names, so it is logged server-side and collapsed here.
  if (error) {
    console.error("cancelRecovery refused:", error.code ?? error.message)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/account/security")
  return { ok: true }
}
