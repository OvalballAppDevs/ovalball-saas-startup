"use server"

import { headers } from "next/headers"

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
