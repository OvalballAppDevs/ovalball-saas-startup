"use server"

import { createClient } from "@/lib/supabase/server"

export type RecoveryResult = { ok: true } | { ok: false; error: string }

/**
 * REDEEMING A RECOVERY CODE (Phase 2 G).
 *
 * One generic refusal whatever went wrong -- wrong code, already used, or throttled. The database
 * records which it actually was, so an operator can see a run of attempts; the person trying is told
 * only that it did not work, because the difference is exactly what somebody guessing would want.
 *
 * NO ELEVATED CLIENT. This runs on the caller's own session and the function reads auth.uid(), so
 * there is no user id to pass and nothing to aim at another account. An earlier version reached for
 * the service-role client, which lib/supabase/service-role.ts warns against in as many words -- it
 * bypasses every RLS policy in the project and has no session of its own.
 *
 * On success every factor is deleted and the session STAYS AT AAL1. A recovery code is a way back to
 * the enrolment page, never a way past it.
 */
export async function useRecoveryCode(code: string): Promise<RecoveryResult> {
  const GENERIC = "That code can't be used."

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("redeem_my_recovery_code", { p_code: code })
  if (error || data !== true) return { ok: false, error: GENERIC }
  return { ok: true }
}
