"use server"

import { headers } from "next/headers"

import { TURNSTILE_FAILURE_MESSAGE, verifyTurnstileToken } from "@/lib/auth/turnstile"
import { getSiteUrl } from "@/lib/site-url"
import { createClient } from "@/lib/supabase/server"

export type ResetRequestResult = { ok: true } | { ok: false; message: string }

/**
 * PASSWORD RESET REQUEST (Phase 2 G, E).
 *
 * G: "/forgot-password -> CAPTCHA -> recovery email -> set password (E) -> TOTP challenge -> AAL2",
 * with generic responses and a `password.reset_requested` event.
 *
 * THE ONE THING THIS MUST NEVER DO is tell the caller whether the address has an account. E is
 * explicit: "Reset request always responds 'If an account exists we've sent a link'." This endpoint
 * is public and causes an email to be delivered to an address the caller chose, so it is both an
 * enumeration risk and an abuse surface -- which is why Turnstile runs BEFORE anything else, exactly
 * as /login does.
 *
 * So `{ ok: true }` is returned for an address with an account, for an address without one, and for
 * a GoTrue response that distinguishes them. The only `{ ok: false }` is the security check and a
 * genuine operational failure, neither of which says anything about the address.
 */
export async function requestPasswordReset(
  email: string,
  turnstileToken: string | null = null,
): Promise<ResetRequestResult> {
  const headerList = await headers()
  const verification = await verifyTurnstileToken(turnstileToken, {
    remoteIp: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    expectedHostname: headerList.get("host")?.split(":")[0] ?? null,
  })
  if (!verification.ok) return { ok: false, message: TURNSTILE_FAILURE_MESSAGE }

  const trimmed = email.trim().toLowerCase()
  // Not an account check -- just "this is not an email address at all", which reveals nothing.
  if (!trimmed || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    return { ok: true }
  }

  const supabase = await createClient()

  // The mark Phase 2 G asks for. The RPC returns void whether or not the address matches, and writes
  // only to security_events, which no browser role can read.
  await supabase.rpc("record_password_reset_requested", { p_email: trimmed })

  // GoTrue's own recovery. It does not distinguish existing from unknown addresses in its response
  // either, and any error it does return is operational rather than an identity signal -- so it is
  // logged server-side and collapsed into the same answer.
  const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
    redirectTo: `${getSiteUrl()}/auth/callback?next=${encodeURIComponent("/account/reset-password")}`,
  })
  if (error) {
    console.error("requestPasswordReset: GoTrue refused", error.code ?? error.message)
  }

  return { ok: true }
}
