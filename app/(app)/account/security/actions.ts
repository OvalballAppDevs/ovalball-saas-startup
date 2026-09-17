"use server"

import { revalidatePath } from "next/cache"

import { checkPassword } from "@/lib/auth/password-policy"
import { createClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase/service-role"

import { MAX_TOTP_FACTORS } from "./constants"

/**
 * ACCOUNT SECURITY (Phase 2 F, G, H).
 *
 * Everything here is about the caller's OWN account. None of it takes a user id: the identity comes
 * from the verified session, so there is nothing to aim at somebody else.
 *
 * Secrets pass through and are never kept. The TOTP secret is returned by GoTrue once, shown once, and
 * never written to an Ovalball table. Recovery codes are generated, returned once, and only their HMACs
 * are stored. Nothing here logs either.
 */

export type ActionResult = { ok: true } | { ok: false; error: string }

export type EnrolStart =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: string }

/** Begin enrolment. The QR and the text secret are shown once and never again. */
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
  // as a failure the person cannot act on. `totp` is the verified list, so the unfinished ones are
  // found through `all`.
  for (const stale of (existing?.all ?? []).filter((f) => f.factor_type === "totp" && f.status !== "verified")) {
    await supabase.auth.mfa.unenroll({ factorId: stale.id })
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Authenticator ${verified.length + 1}`,
  })
  if (error || !data) return { ok: false, error: "We couldn't start setup. Please try again." }

  return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

export type EnrolFinish = { ok: true; recoveryCodes: string[] } | { ok: false; error: string }

/**
 * Verify the first code, which is what makes the factor real. Recovery codes are generated at the same
 * moment and returned ONCE: F says the person is shown them and confirms they are saved.
 */
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

  // Recovery codes are minted by the database, which keeps only their HMACs.
  const service = createServiceRoleClient()
  const { data: codes, error: codesError } = await service.rpc("generate_recovery_codes_for", {
    p_user_id: user.id,
  })
  if (codesError || !codes) return { ok: false, error: "Your authenticator is set up, but we couldn't create recovery codes. Open Security to try again." }

  await service.rpc("record_security_change", { p_user_id: user.id, p_change: "MFA_ENROLLED" })
  revalidatePath("/account/security")
  return { ok: true, recoveryCodes: codes as string[] }
}

/** A replacement set. Regenerating invalidates every previous code (G). */
export async function regenerateRecoveryCodes(): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sign in to continue." }

  // R: recovery-code regeneration is an account-security change, so a recent code is required.
  const { data: assurance } = await supabase.rpc("my_session_assurance")
  const a = assurance as { recent_aal2?: boolean } | null
  if (a && a.recent_aal2 === false) {
    return { ok: false, error: "Enter a code from your authenticator first." }
  }

  const service = createServiceRoleClient()
  const { data, error } = await service.rpc("generate_recovery_codes_for", { p_user_id: user.id })
  if (error || !data) return { ok: false, error: "We couldn't create new codes. Please try again." }
  revalidatePath("/account/security")
  return { ok: true, codes: data as string[] }
}

/** Removing a factor. The LAST one cannot be removed -- replace, don't remove (F). */
export async function removeTotpFactor(factorId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sign in to continue." }

  const { data: factors } = await supabase.auth.mfa.listFactors()
  const verified = (factors?.totp ?? []).filter((f) => f.status === "verified")
  if (verified.length <= 1 && verified.some((f) => f.id === factorId)) {
    return { ok: false, error: "This is your only authenticator. Add another one before removing it." }
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) return { ok: false, error: "We couldn't remove that authenticator." }

  const service = createServiceRoleClient()
  await service.rpc("record_security_change", { p_user_id: user.id, p_change: "MFA_FACTOR_REMOVED" })
  revalidatePath("/account/security")
  return { ok: true }
}

/** Sign out everywhere else. H: this is what "Sign Out Other Devices" actually has to do. */
export async function signOutOtherDevices(): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sign in to continue." }

  const { data: assurance } = await supabase.rpc("my_session_assurance")
  const a = assurance as { recent_aal2?: boolean } | null
  if (a && a.recent_aal2 === false) {
    return { ok: false, error: "Enter a code from your authenticator first." }
  }

  const service = createServiceRoleClient()
  // Deleting the session rows is what makes this real: session_ok checks the row exists, so a stolen
  // refresh token stops working on its next request rather than when its JWT happens to expire.
  // Keep the session the person is using; end the rest.
  const { data: sessionRows } = await supabase.rpc("my_sessions")
  const current = (sessionRows ?? []).find((r: { is_current: boolean }) => r.is_current) as
    | { session_id: string }
    | undefined
  const { error } = await service.rpc("revoke_my_other_sessions", {
    p_user_id: user.id,
    p_keep_session_id: current?.session_id ?? undefined,
  })
  if (error) return { ok: false, error: "We couldn't sign out your other devices." }
  revalidatePath("/account/security")
  return { ok: true }
}

/** Setting or changing a password. The policy is checked here, on the server, before GoTrue sees it. */
export async function setAccountPassword(password: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Sign in to continue." }

  const verdict = await checkPassword(password)
  if (!verdict.ok) return { ok: false, error: verdict.message }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    // GoTrue's own refusals (its native length rule, reuse rules) are surfaced plainly; there is
    // nothing secret in them and the person needs to know what to change.
    return { ok: false, error: error.message }
  }

  const service = createServiceRoleClient()
  await service.rpc("record_security_change", { p_user_id: user.id, p_change: "PASSWORD_SET" })
  revalidatePath("/account/security")
  return { ok: true }
}
