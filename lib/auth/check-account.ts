"use server"

import { createClient } from "@/lib/supabase/server"
import { toPublicAuthError } from "@/lib/errors/public-error"

export type SendSignInLinkResult =
  | { status: "sent" }
  | { status: "error"; message: string }

/**
 * /login's only auth entry point. Sends a real sign-in link when an
 * account exists for this email; sends nothing when it doesn't -- but
 * always reports back the same `{status:"sent"}`, never which case
 * occurred. That's deliberate: an earlier version of this file returned a
 * distinct "existing"/"new" result specifically so the UI could tell a
 * visitor "we found your account" or "no account for that email" --
 * exactly the account-existence oracle a privacy review flagged, since
 * anyone could type an arbitrary email into /login and learn from the
 * response alone whether that person has an Ovalball account. Removing
 * the oracle just means this function stops surfacing the distinction
 * that made it possible; a genuinely new user isn't stuck, because
 * /login's own "New to Ovalball? Create an account" link is unconditional,
 * not something that only appears once this function has confirmed there's
 * no account.
 *
 * The signal this still relies on internally is Supabase Auth's own:
 * signInWithOtp with shouldCreateUser:false either sends a real sign-in
 * email (account exists) or fails with a GoTrue error code identifying "no
 * account" -- a code, not a message string, so it can't be confused with
 * an unrelated failure. Verified directly against this project's local
 * GoTrue (v2.195.0) rather than trusted from documentation alone: it
 * returns `otp_disabled` ("Signups not allowed for otp") for this exact
 * case, not the `user_not_found` code an earlier pass of this file assumed
 * from the published error catalog. Both codes are treated identically to
 * every other success below -- collapsed into the same {status:"sent"} a
 * real send would produce. Any other error (over_email_send_rate_limit,
 * over_request_rate_limit, validation_failed, etc.) is a genuine
 * operational failure, not an identity signal, so it's still surfaced as
 * "error" rather than folded into "sent" -- telling someone their request
 * was rate-limited or malformed doesn't leak whether their email has an
 * account, and swallowing it would mean showing a false "check your email"
 * for a request that never went anywhere.
 *
 * This only ever runs as a Server Action (POST, same-origin, not a public
 * GET route), only ever on explicit user action (never per-keystroke), and
 * shares Supabase's own per-email/per-IP OTP rate limiting rather than
 * inventing a separate lookup path.
 */
export async function sendSignInLinkIfAccountExists(email: string): Promise<SendSignInLinkResult> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${getSiteUrl()}/auth/callback?next=/dashboard`,
    },
  })

  if (!error) return { status: "sent" }
  if (error.code === "user_not_found" || error.code === "otp_disabled") return { status: "sent" }
  // Genuine operational failure (rate limit, validation, GoTrue outage) --
  // logged in full server-side, never echoed to the client raw. See
  // lib/errors/public-error.ts for why: error.message here can be an
  // arbitrary GoTrue string, not something written to be user-facing.
  console.error("sendSignInLinkIfAccountExists failed:", error)
  return { status: "error", message: toPublicAuthError(error, "sign_in") }
}

function getSiteUrl(): string {
  // NEXT_PUBLIC_SITE_URL is the deployed origin in production; falls back to
  // localhost for local development where that env var isn't set. Mirrors
  // submit-signup.ts's copy of the same helper.
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
}
