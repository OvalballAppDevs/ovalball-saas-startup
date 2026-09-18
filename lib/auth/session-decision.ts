/**
 * THE SESSION DECISION, WITH NO IO AND NO SERVER-ONLY IMPORT.
 *
 * Its own module for the same reason `challenge-state.ts` and `password-policy-shared.ts` are:
 * `require-session.ts` is `server-only` and pulls in the Supabase server client, `next/headers` and
 * the whole request context, so nothing can unit-test the decision while it lives there. The rule
 * and the plumbing are different things, and only one of them is worth testing exhaustively.
 */

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
   * enrol. Identity, session liveness and account state are still enforced; only the assurance gate
   * is stood down, and only where standing it up would be circular.
   */
  allowAalElevation?: boolean
}

export type SessionRefusalReason =
  | "SIGN_IN_REQUIRED"
  | "ACCOUNT_UNAVAILABLE"
  | "MFA_REQUIRED"
  | "VERIFY_AGAIN"

/** Exactly what the database says about this session. The only input the decision depends on. */
export type SessionAssurance = {
  account_usable: boolean
  session_live: boolean
  aal: string | null
  enforcement_required: boolean
  recent_aal2: boolean
  enforcement_group: string
}

/**
 * THE DECISION, WITH NO IO IN IT.
 *
 * Pulled out of requireSession so it can be tested exhaustively. It was not, and a mutation campaign
 * found the hole: making `allowAalElevation` globally true -- which stands the assurance gate down
 * for every surface, not just the two that must reach AAL2 -- was noticed by nothing, because the
 * only permanent test was a structural one about which FILES may pass the option. Which files pass
 * it and whether the flag is honoured are different questions, and the second one needs this.
 */
export function decideSession(
  assurance: SessionAssurance,
  options: RequireSessionOptions = {},
): { ok: true; aal: "aal1" | "aal2"; group: string } | { ok: false; reason: SessionRefusalReason } {
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
  return { ok: true, aal: atAal2 ? "aal2" : "aal1", group: assurance.enforcement_group }
}


/** What to say, and where to send them. Distinguishing these is Phase 2's explicit UX requirement. */
export function sessionRefusal(reason: SessionRefusalReason): { message: string; href: string } {
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
