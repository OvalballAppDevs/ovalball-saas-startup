"use server"

import { toPublicAuthError } from "@/lib/errors/public-error"
import { createClient } from "@/lib/supabase/server"
import { CURRENT_TERMS_VERSION } from "@/lib/signup/terms"
import type { SignupFormState } from "@/lib/signup/types"

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
export async function submitSignup(formState: SignupFormState): Promise<SubmitSignupResult> {
  if (!formState.termsAccepted) {
    return { ok: false, error: "Terms and Conditions must be accepted." }
  }
  if (formState.club.kind === "unselected") {
    return { ok: false, error: "A club selection is required." }
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

function getSiteUrl(): string {
  // NEXT_PUBLIC_SITE_URL is the deployed origin in production; falls back to
  // localhost for local development where that env var isn't set.
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
}
