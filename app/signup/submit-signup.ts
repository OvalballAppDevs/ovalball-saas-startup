"use server"

import { headers } from "next/headers"

import { hasAllRequiredConsents } from "@/lib/legal/required-consents"
import { toPublicAuthError } from "@/lib/errors/public-error"
import { TURNSTILE_FAILURE_MESSAGE, verifyTurnstileToken } from "@/lib/auth/turnstile"
import { createClient } from "@/lib/supabase/server"
import { storeSignupFlowId } from "@/lib/signup/signup-binding"
import { CURRENT_TERMS_VERSION } from "@/lib/signup/terms"
import type { SignupFormState } from "@/lib/signup/types"
import type { Json } from "@/types/database.types"
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
 * session exists yet for a brand-new signup.
 *
 * SO-4: THE ANSWERS NO LONGER TRAVEL IN user_metadata. They used to be passed
 * as `data` on `signInWithOtp`, which GoTrue writes onto the auth row before
 * anybody has authenticated -- and anyone can start a signup for any address,
 * so anyone could author that metadata against somebody else's account. They now
 * go into `public.auth_flow_states` through `create_auth_flow_state`, a table
 * with RLS on and no policies, reachable only through its two definer functions.
 * The browser gets back an opaque flow id in an httpOnly cookie and nothing
 * else; /auth/callback exchanges it, once, for the payload.
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

  // The context goes to the server, and only its key comes back.
  // Cast at the boundary only. The wizard's types are richer than `Json`, and
  // the shape is re-checked on the way back out in complete-signup.ts, which is
  // where a malformed payload actually matters.
  const payload = {
    personal: formState.personal,
    rugbyCode: formState.rugbyCode,
    club: formState.club,
    termsVersion: CURRENT_TERMS_VERSION,
  } as unknown as Json
  const { data: flowId, error: flowError } = await supabase.rpc("create_auth_flow_state", {
    p_kind: "SIGNUP",
    p_payload: payload,
  })
  if (flowError || !flowId) {
    console.error("create_auth_flow_state failed:", flowError)
    return { ok: false, error: toPublicAuthError(flowError ?? new Error("no flow id"), "signup") }
  }
  await storeSignupFlowId(flowId)

  // NO `data` AT ALL. Not a smaller payload, not a reference -- nothing. The
  // whole point of SO-4 is that `user_metadata` stops being an onboarding
  // carrier, and leaving even an identifier there would keep the shape alive.
  const { error } = await supabase.auth.signInWithOtp({
    email: formState.email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${getSiteUrl()}/auth/callback?next=/welcome`,
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

