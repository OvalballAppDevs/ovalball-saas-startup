"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

import { MAX_TOTP_FACTORS } from "@/app/(app)/account/security/constants"

/**
 * ENROLMENT, IN ITS OWN MODULE.
 *
 * Deliberately not imported from the Account -> Security actions. That module also handles setting a
 * password, so it pulls in the password validator, which is `server-only` -- and this file is imported
 * by a client component. Keeping the two apart means the enrolment page's client boundary drags in
 * nothing it does not need, which is both the reason it works and a reason it keeps working.
 *
 * Everything here runs on the caller's own session. No user id is passed and no elevated client is
 * used: the database functions read auth.uid() themselves.
 */

export type EnrolStart =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: string }

export async function startTotpEnrolment(): Promise<EnrolStart> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sign in to continue." }

  const { data: existing } = await supabase.auth.mfa.listFactors()
  const verified = (existing?.totp ?? []).filter((f) => f.status === "verified")
  if (verified.length >= MAX_TOTP_FACTORS) {
    return { ok: false, error: `You can have up to ${MAX_TOTP_FACTORS} authenticators. Remove one first.` }
  }

  // An abandoned attempt from a previous visit would otherwise collide on the friendly name and read
  // as a failure the person cannot act on.
  for (const stale of (existing?.all ?? []).filter((f) => f.factor_type === "totp" && f.status !== "verified")) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id })
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${verified.length + 1} (${Date.now().toString(36)})`,
  })
  if (error || !data) {
    return { ok: false, error: error?.message ?? "We couldn't start setup. Please try again." }
  }

  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

export type EnrolFinish = { ok: true; recoveryCodes: string[] } | { ok: false; error: string }

/** Verifying the first code is what makes the factor real; the recovery codes follow immediately. */
export async function confirmTotpEnrolment(factorId: string, code: string): Promise<EnrolFinish> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sign in to continue." }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
  if (challengeError || !challenge) return { ok: false, error: "We couldn't start the check. Try again." }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code: code.replace(/\s/g, ""),
  })
  if (verifyError) return { ok: false, error: "That code wasn't right. Try the next one your app shows." }

  const { data: codes, error: codesError } = await supabase.rpc("issue_my_first_recovery_codes")
  if (codesError || !codes) {
    return {
      ok: false,
      error: "Your authenticator is set up, but we couldn't create recovery codes. Open Security to try again.",
    }
  }

  await supabase.rpc("record_my_security_change", { p_change: "MFA_ENROLLED" })
  revalidatePath("/account/security")
  return { ok: true, recoveryCodes: codes as string[] }
}
