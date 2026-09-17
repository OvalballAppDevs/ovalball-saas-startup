"use server"

import { headers } from "next/headers"

import { createClient } from "@/lib/supabase/server"

import { sendSignInLinkIfAccountExists } from "@/lib/auth/check-account"
import { TURNSTILE_FAILURE_MESSAGE, verifyTurnstileToken } from "@/lib/auth/turnstile"

export type SubmitLoginResult =
  | { ok: true }
  | { ok: false; reason: "error"; message: string }

/**
 * The only auth entry point on this page. sendSignInLinkIfAccountExists
 * never reveals whether the email it was given actually has an account --
 * see that file for why -- so this always returns `{ok:true}` for the same
 * request that used to distinguish "existing" from "no-account". A
 * genuinely new visitor isn't left stuck: the login form's own "New to
 * Ovalball? Create an account" link is always visible, not conditional on
 * this result.
 *
 * Human verification runs BEFORE the email is sent, which is the point:
 * this endpoint causes an email to be delivered to an address the caller
 * chose, so it is the most abusable surface in the product. Turnstile is a
 * complement to Supabase's own per-email and per-IP rate limits, not a
 * replacement for them -- both still apply.
 */
export async function submitLogin(
  email: string,
  turnstileToken: string | null = null
): Promise<SubmitLoginResult> {
  const headerList = await headers()
  const verification = await verifyTurnstileToken(turnstileToken, {
    remoteIp: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    expectedHostname: headerList.get("host")?.split(":")[0] ?? null,
  })
  if (!verification.ok) {
    return { ok: false, reason: "error", message: TURNSTILE_FAILURE_MESSAGE }
  }

  const result = await sendSignInLinkIfAccountExists(email)

  if (result.status === "error") return { ok: false, reason: "error", message: result.message }
  return { ok: true }
}

export type PasswordLoginResult =
  | { ok: true; needsMfa: boolean }
  | { ok: false; message: string }

/**
 * PASSWORD SIGN-IN (Phase 2 AG.2 T0, E).
 *
 * The primary way in from Slice 6 onwards. Magic link stays offered beside it, because retiring it is
 * a later, separately gated step (T6) and pulling it now would strand the people who have never had a
 * password -- which today is half of production.
 *
 * ONE MESSAGE FOR EVERY FAILURE. "Email or password is incorrect" whether the address is unknown, the
 * password is wrong, or the account is not usable (E, "Errors"). Saying which would turn this form into
 * a way to find out who has an Ovalball account.
 */
export async function submitPasswordLogin(
  email: string,
  password: string,
  turnstileToken: string | null = null
): Promise<PasswordLoginResult> {
  const GENERIC = "Email or password is incorrect."

  const headerList = await headers()
  const verification = await verifyTurnstileToken(turnstileToken, {
    remoteIp: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    expectedHostname: headerList.get("host")?.split(":")[0] ?? null,
  })
  if (!verification.ok) return { ok: false, message: TURNSTILE_FAILURE_MESSAGE }

  const trimmed = email.trim().toLowerCase()
  if (!trimmed || !password) return { ok: false, message: GENERIC }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email: trimmed, password })

  if (error || !data.user) {
    // Deliberately not distinguished, and deliberately not logged with the address attached.
    return { ok: false, message: GENERIC }
  }

  // A session that has a second factor to present starts at AAL1 and must go and present it. Asking
  // the auth server rather than guessing from the user record keeps this true for social identities too.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const needsMfa = Boolean(aal && aal.nextLevel === "aal2" && aal.nextLevel !== aal.currentLevel)

  return { ok: true, needsMfa }
}
