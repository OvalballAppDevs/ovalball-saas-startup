import "server-only"

import { createClient } from "@/lib/supabase/server"

/**
 * THE SERVER SIDE OF THE SESSION GATE.
 *
 * The database already refuses: `internal.session_ok()` is folded into `internal.can()`, into
 * `has_site_capability()`, and into a RESTRICTIVE policy on every non-public table. This function does
 * not replace any of that and must never be mistaken for it. It exists so a page or a Server Action can
 * refuse EARLY and say something useful, instead of letting a person fill in a form and then meeting a
 * bare database error.
 *
 * So: this is UX and defence in depth, never the boundary. If this file were deleted the product would
 * become rude, not insecure.
 *
 * It reads the VERIFIED user (`getUser`, which re-validates with the auth server) rather than the
 * session the browser hands over, and it reads the assurance from the same place the database does.
 */

export type SessionDecision =
  | { ok: true; userId: string; aal: "aal1" | "aal2"; group: string }
  | { ok: false; reason: "SIGN_IN_REQUIRED" | "ACCOUNT_UNAVAILABLE" | "MFA_REQUIRED" | "VERIFY_AGAIN" }

export type RequireSessionOptions = {
  /** Require a second factor even when this person's group is not being enforced yet. */
  aal?: "aal1" | "aal2"
  /** Require a TOTP verified within this many minutes (Phase 2 "R"). */
  recentMinutes?: number
}

export async function requireSession(options: RequireSessionOptions = {}): Promise<SessionDecision> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: "SIGN_IN_REQUIRED" }

  // The database is the authority on all three of these, and is asked rather than re-implemented here.
  // Re-deriving "is this account usable" in TypeScript would be a second answer to a question that
  // already has one, and the two would drift.
  const { data, error } = await supabase.rpc("my_session_assurance")
  if (error || !data) return { ok: false, reason: "ACCOUNT_UNAVAILABLE" }

  const assurance = data as {
    account_usable: boolean
    session_live: boolean
    aal: string | null
    enforcement_required: boolean
    recent_aal2: boolean
    enforcement_group: string
  }

  if (!assurance.session_live) return { ok: false, reason: "SIGN_IN_REQUIRED" }
  if (!assurance.account_usable) return { ok: false, reason: "ACCOUNT_UNAVAILABLE" }

  const atAal2 = assurance.aal === "aal2"
  // Either this person's group is being enforced, or the caller asked for AAL2 for this operation.
  if ((assurance.enforcement_required || options.aal === "aal2") && !atAal2) {
    return { ok: false, reason: "MFA_REQUIRED" }
  }
  if (options.recentMinutes && !assurance.recent_aal2) {
    return { ok: false, reason: "VERIFY_AGAIN" }
  }

  return {
    ok: true,
    userId: user.id,
    aal: atAal2 ? "aal2" : "aal1",
    group: assurance.enforcement_group,
  }
}

/** What to say, and where to send them. Distinguishing these is Phase 2's explicit UX requirement. */
export function sessionRefusal(reason: Exclude<SessionDecision, { ok: true }>["reason"]): {
  message: string
  href: string
} {
  switch (reason) {
    case "SIGN_IN_REQUIRED":
      return { message: "Sign in to continue.", href: "/login" }
    case "ACCOUNT_UNAVAILABLE":
      return { message: "This account is not available. Contact Ovalball if you think that is wrong.", href: "/login" }
    case "MFA_REQUIRED":
      return { message: "Set up your authenticator to continue.", href: "/security/enrol" }
    case "VERIFY_AGAIN":
      return { message: "Enter a code from your authenticator to continue.", href: "/security/verify" }
  }
}
