"use server"

import { headers } from "next/headers"

import { hasAllRequiredConsents } from "@/lib/legal/required-consents"
import { toPublicAuthError } from "@/lib/errors/public-error"
import { TURNSTILE_FAILURE_MESSAGE, verifyTurnstileToken } from "@/lib/auth/turnstile"
import { createClient } from "@/lib/supabase/server"
import { CURRENT_TERMS_VERSION } from "@/lib/signup/terms"
import type { SignupFormState } from "@/lib/signup/types"
import { getSiteUrl } from "@/lib/site-url"

export type SubmitSignupResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * STEP 4's "Confirm and continue" action. This is the only place the
 * wizard's collected data leaves the browser as a whole -- everything up to
 * here has been pure client-side form state (see signup-shell.tsx).
 *
 * There is deliberately no profiles/club_claims/club_join_requests/
 * directory_requests INSERT here: RLS on all four of those tables restricts
 * INSERT to the `authenticated` role checked against auth.uid(), and no
 * session exists yet for a brand-new signup. Instead, the whole wizard
 * payload is passed as `data` on signInWithOtp, which Supabase stores as
 * user_metadata on the (possibly brand-new) auth.users row immediately,
 * independent of email confirmation. /auth/callback reads that metadata
 * once exchangeCodeForSession has produced a real session, and performs the
 * actual inserts then, as the now-authenticated user -- see the comment
 * there for the full sequence.
 *
 * This still uses only the publishable-key server client (never a service
 * role) and never sets any permission/role itself; it only sends an email.
 */
export async function submitSignup(
  formState: SignupFormState,
  turnstileToken: string | null = null
): Promise<SubmitSignupResult> {
  // Every required policy, checked on the server. A client that omits one
  // (or invents an extra) cannot create an account without it.
  if (!hasAllRequiredConsents(formState.consents)) {
    return { ok: false, error: "Please accept each of the required policies to continue." }
  }
  if (formState.club.kind === "unselected") {
    return { ok: false, error: "A club selection is required." }
  }

  // Verified before the OTP is sent: this action delivers an email to an
  // address the caller chose, so it is gated by the same human check as the
  // login form, on top of Supabase's own rate limiting.
  const headerList = await headers()
  const verification = await verifyTurnstileToken(turnstileToken, {
    remoteIp: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    expectedHostname: headerList.get("host")?.split(":")[0] ?? null,
  })
  if (!verification.ok) {
    return { ok: false, error: TURNSTILE_FAILURE_MESSAGE }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithOtp({
    email: formState.email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${getSiteUrl()}/auth/callback?next=/welcome`,
      data: {
        ovalballSignupPayload: {
          personal: formState.personal,
          rugbyCode: formState.rugbyCode,
          club: formState.club,
          termsVersion: CURRENT_TERMS_VERSION,
        },
      },
    },
  })

  if (error) {
    // Genuine operational failure (rate limit, validation, GoTrue outage) --
    // logged in full server-side, never echoed to the client raw. See
    // lib/errors/public-error.ts.
    console.error("submitSignup failed:", error)
    return { ok: false, error: toPublicAuthError(error, "signup") }
  }

  return { ok: true }
}

