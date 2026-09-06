"use server"

import { hasAllRequiredConsents } from "@/lib/legal/required-consents"
import { createClient } from "@/lib/supabase/server"
import { CURRENT_TERMS_VERSION } from "@/lib/signup/terms"
import { writeSignupRecords } from "@/lib/signup/complete-signup"
import type { SignupFormState } from "@/lib/signup/types"

export type CompleteAuthenticatedSignupResult = { ok: true } | { ok: false; error: string }

/**
 * Finishes onboarding for someone who is ALREADY authenticated but has no
 * Ovalball profile yet -- in practice, a first-time Google/Facebook/Apple
 * user, who arrives with a session before Ovalball has collected anything.
 *
 * Security properties, all server-derived:
 *
 *  - The acting user comes from the session via getUser(), never from the
 *    client. A caller cannot record consent, a profile or a club request
 *    "on behalf of" anyone else, because no user id crosses the wire.
 *  - The terms version is CURRENT_TERMS_VERSION on this server, never a
 *    value the client chose. A stale or invented version cannot be
 *    submitted.
 *  - accepted_at is the database's own default now(); it is not accepted
 *    from the client and cannot be backdated.
 *  - Re-submission is safe: writeSignupRecords is only reached when no
 *    profile exists, and terms_acceptances is unique on
 *    (user_id, terms_version), so a double click cannot produce a second
 *    consent row.
 *
 * This is not a second onboarding system: it writes through exactly the
 * same writeSignupRecords sequence the magic-link path uses.
 */
export async function completeAuthenticatedSignup(
  formState: SignupFormState
): Promise<CompleteAuthenticatedSignupResult> {
  // Every required policy, checked on the server. A client that omits one
  // (or invents an extra) cannot create an account without it.
  if (!hasAllRequiredConsents(formState.consents)) {
    return { ok: false, error: "Please accept each of the required policies to continue." }
  }
  if (formState.club.kind === "unselected") {
    return { ok: false, error: "A club selection is required." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, error: "Your session has expired. Please sign in again." }
  }

  // Already onboarded -- treat as success rather than an error so a repeat
  // submission (double click, back button, retried request) is idempotent.
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle()
  if (existingProfile) {
    return { ok: true }
  }

  const result = await writeSignupRecords(supabase, user, {
    personal: formState.personal,
    club: formState.club,
    rugbyCode: formState.rugbyCode,
    // Server-side constant, deliberately not formState.
    termsVersion: CURRENT_TERMS_VERSION,
  })

  if (!result.completed) {
    return { ok: false, error: result.error ?? "We couldn't finish setting up your account." }
  }
  return { ok: true }
}
