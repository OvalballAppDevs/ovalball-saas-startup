"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

export type RecoveryResult = { ok: true } | { ok: false; error: string }

/**
 * REDEEMING A RECOVERY CODE (Phase 2 G).
 *
 * One generic refusal whatever went wrong -- wrong code, already used, or throttled. The database
 * records which it actually was, so an operator can see a run of attempts; the person trying is told
 * only that it did not work, because the difference is exactly what somebody guessing would want.
 *
 * On success: every factor is deleted and the session STAYS AT AAL1. A recovery code is a way back to
 * the enrolment page, never a way past it.
 */
export async function useRecoveryCode(code: string): Promise<RecoveryResult> {
  const GENERIC = "That code can't be used."

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sign in to continue." }

  const service = createServiceRoleClient()
  const { data: consumed, error } = await service.rpc("redeem_recovery_code_for", {
    p_user_id: user.id,
    p_code: code,
  })
  if (error || consumed !== true) return { ok: false, error: GENERIC }

  // Only now, and only because a code was genuinely consumed: remove the factors so the person can
  // enrol a new authenticator. Done with the admin API because the session cannot remove its own
  // factor without presenting one.
  const { data: factors } = await service.auth.admin.mfa.listFactors({ userId: user.id })
  for (const factor of factors?.factors ?? []) {
    await service.auth.admin.mfa.deleteFactor({ id: factor.id, userId: user.id })
  }

  return { ok: true }
}
