"use server"

import { revalidatePath } from "next/cache"

import { checkPassword } from "@/lib/auth/password-policy"
import { guardAction } from "@/lib/auth/action-boundary"
import { toPublicSubmissionError } from "@/lib/errors/public-error"
import { createClient } from "@/lib/supabase/server"
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

/** A replacement set. Regenerating invalidates every previous code (G). */
export async function regenerateRecoveryCodes(): Promise<{ ok: true; codes: string[] } | { ok: false; error: string }> {
  const supabase = await createClient()
  // D.2 layer 2: identity AND session liveness AND account state AND assurance,
  // not identity alone. A direct POST meets this whether or not a layout ran.
  const gate = await guardAction({}, supabase)
  if (!gate.ok) return { ok: false, error: gate.error }

  // R is enforced INSIDE the function, not here: a check in a Server Action is a courtesy, and the
  // database is the boundary.
  const { data, error } = await supabase.rpc("regenerate_my_recovery_codes")
  if (error || !data) {
    return { ok: false, error: error?.message ?? "We couldn't create new codes. Please try again." }
  }
  revalidatePath("/account/security")
  return { ok: true, codes: data as string[] }
}

/** Removing a factor. The LAST one cannot be removed -- replace, don't remove (F). */
export async function removeTotpFactor(factorId: string): Promise<ActionResult> {
  const supabase = await createClient()
  // D.2 layer 2: identity AND session liveness AND account state AND assurance,
  // not identity alone. A direct POST meets this whether or not a layout ran.
  const gate = await guardAction({}, supabase)
  if (!gate.ok) return { ok: false, error: gate.error }

  const { data: factors } = await supabase.auth.mfa.listFactors()
  const verified = (factors?.totp ?? []).filter((f) => f.status === "verified")
  if (verified.length <= 1 && verified.some((f) => f.id === factorId)) {
    return { ok: false, error: "This is your only authenticator. Add another one before removing it." }
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) return { ok: false, error: "We couldn't remove that authenticator." }

  await supabase.rpc("record_my_security_change", { p_change: "MFA_FACTOR_REMOVED" })
  revalidatePath("/account/security")
  return { ok: true }
}

/** Sign out everywhere else. H: this is what "Sign Out Other Devices" actually has to do. */
export async function signOutOtherDevices(): Promise<ActionResult> {
  const supabase = await createClient()
  // D.2 layer 2: identity AND session liveness AND account state AND assurance,
  // not identity alone. A direct POST meets this whether or not a layout ran.
  const gate = await guardAction({}, supabase)
  if (!gate.ok) return { ok: false, error: gate.error }

  // Deleting the session rows is what makes this real: session_ok checks the row exists, so a stolen
  // refresh token stops working on its next request rather than when its JWT happens to expire. The
  // function works out which session is the current one from the caller's own token.
  const { error } = await supabase.rpc("sign_out_my_other_devices")
  if (error) {
    // 42501 is the RPC's own deliberate, user-facing refusal ("Enter a code from your authenticator
    // first."), which is exactly what this person needs to read. Anything else is an unplanned
    // Postgres exception naming internal functions and columns, and is logged rather than shown.
    if (error.code === "42501") return { ok: false, error: error.message }
    console.error("signOutOtherDevices refused:", error.code ?? error.message)
    return { ok: false, error: toPublicSubmissionError() }
  }
  revalidatePath("/account/security")
  return { ok: true }
}

/** Setting or changing a password. The policy is checked here, on the server, before GoTrue sees it. */
export async function setAccountPassword(password: string): Promise<ActionResult> {
  const supabase = await createClient()
  // D.2 layer 2: identity AND session liveness AND account state AND assurance,
  // not identity alone. A direct POST meets this whether or not a layout ran.
  const gate = await guardAction({}, supabase)
  if (!gate.ok) return { ok: false, error: gate.error }

  const verdict = await checkPassword(password)
  if (!verdict.ok) return { ok: false, error: verdict.message }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    // PROVIDER_MESSAGE: this is GoTrue, not Postgres. Its refusals are its native length and reuse
    // rules -- "Password should be at least 12 characters" -- which name nothing internal and are
    // precisely what the person needs in order to choose a different password.
    return { ok: false, error: error.message }
  }

  await supabase.rpc("record_my_security_change", { p_change: "PASSWORD_SET" })
  revalidatePath("/account/security")
  return { ok: true }
}
