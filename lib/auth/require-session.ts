import "server-only"

import type { SupabaseClient, User } from "@supabase/supabase-js"

import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/types/database.types"

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
  | { ok: true; userId: string; user: User; aal: "aal1" | "aal2"; group: string }
  | { ok: false; reason: "SIGN_IN_REQUIRED" | "ACCOUNT_UNAVAILABLE" | "MFA_REQUIRED" | "VERIFY_AGAIN" }

export type RequireSessionOptions = {
  /** Require a second factor even when this person's group is not being enforced yet. */
  aal?: "aal1" | "aal2"
  /** Require a TOTP verified within this many minutes (Phase 2 "R"). */
  recentMinutes?: number
  /**
   * For the surfaces whose whole PURPOSE is to reach AAL2 -- /security/enrol and /security/verify.
   *
   * This exists to prevent a lockout that would only appear at T1. Once an enforcement group is
   * switched on, `enforcement_required` is true for exactly the people who have not enrolled yet, so
   * an unqualified requireSession on the enrolment page would refuse them at the one page that could
   * fix it, and `sessionRefusal` would send them straight back to it. Nobody in that group could ever
   * enrol. Identity, session liveness and account state are still enforced here; only the assurance
   * gate is stood down, and only where standing it up would be circular.
   */
  allowAalElevation?: boolean
}

/**
 * `client` lets a caller that already has a request-scoped Supabase client hand it over. This is not
 * a micro-optimisation: `createClient()` is deliberately one instance per request and `getUser()`
 * re-validates against the auth server, so a boundary that made its own client would add a second
 * network round trip to every page load for an answer the caller already has. The decision carries
 * the verified `user` back for the same reason -- so nothing downstream calls `getUser()` again.
 */
export async function requireSession(
  options: RequireSessionOptions = {},
  client?: SupabaseClient<Database>,
): Promise<SessionDecision> {
  const supabase = client ?? (await createClient())

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
  // Either this person's group is being enforced, or the caller asked for AAL2 for this operation --
  // unless this IS the surface that exists to get them there.
  if (!options.allowAalElevation && (assurance.enforcement_required || options.aal === "aal2") && !atAal2) {
    return { ok: false, reason: "MFA_REQUIRED" }
  }
  if (options.recentMinutes && !assurance.recent_aal2) {
    return { ok: false, reason: "VERIFY_AGAIN" }
  }

  return {
    ok: true,
    userId: user.id,
    user,
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
