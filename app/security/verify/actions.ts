"use server"

import { guardAction } from "@/lib/auth/action-boundary"
import { createClient } from "@/lib/supabase/server"

export type VerifyResult = { ok: true } | { ok: false; error: string }

/**
 * The TOTP challenge. A wrong code says so plainly -- there is no enumeration risk in telling somebody
 * who is already signed in that their own code was wrong, and pretending otherwise would just make a
 * mistyped digit baffling.
 *
 * Every failure is recorded, because a run of them against one account is the signal that matters.
 */
export async function verifyTotpChallenge(factorId: string, code: string): Promise<VerifyResult> {
  const supabase = await createClient()
  // D.2 layer 2: identity AND session liveness AND account state AND assurance,
  // not identity alone. A direct POST meets this whether or not a layout ran.
  const gate = await guardAction({ allowAalElevation: true }, supabase)
  if (!gate.ok) return { ok: false, error: gate.error }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
  if (challengeError || !challenge) return { ok: false, error: "We couldn't start the check. Try again." }

  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: code.replace(/\s/g, ""),
  })

  if (error) {
    await supabase.rpc("record_my_mfa_failure")
    return { ok: false, error: "That code wasn't right. Try the next one your app shows." }
  }
  return { ok: true }
}
