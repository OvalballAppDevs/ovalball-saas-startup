/**
 * WHY A PERSON CAN DO A THING, IN PRODUCT LANGUAGE.
 *
 * `public.explain_access` already answers this properly: it re-runs the SAME
 * `internal.capability_decision` the enforcement path runs, and hands back the
 * rule that decided it, a reason code, the decisive source and the full trail.
 * It has been granted to `authenticated` since the capability engine landed and
 * has never had a screen. So a Club Admin looking at somebody's access could
 * see WHAT they hold and never WHY they hold it -- which is the question
 * actually asked when an administrator opens a permissions page.
 *
 * This file is the one place a `reason_code` becomes a sentence. It is
 * PRESENTATION ONLY: it never decides anything, it never re-derives a decision,
 * and a code it does not recognise falls back to the decisive rule the database
 * named rather than to a guess. Adding a second copy of these sentences at a
 * call site would be a second answer to "why", which is the defect this whole
 * step exists to remove.
 */

export interface AccessDecision {
  allowed: boolean
  decisiveRule: string | null
  reasonCode: string | null
  /** Admin-only detail from the decision -- role key, override id, team, and so on. */
  decisiveSource: Record<string, unknown> | null
  trail: unknown[]
}

/**
 * UK English sentence case, because these are explanations rather than titles.
 * Each one names the MECHANISM, not the outcome: "their Club Admin role" is
 * actionable, "they are allowed" is not.
 */
const REASON_SENTENCE: Record<string, { allowed: string; denied: string }> = {
  ROLE_BUNDLE: {
    allowed: "a role they hold at this club includes it",
    denied: "no role they hold at this club includes it",
  },
  EXPLICIT_ALLOW: {
    allowed: "someone granted it to them directly, on top of their role",
    denied: "someone granted it to them directly, on top of their role",
  },
  EXPLICIT_DENY: {
    allowed: "someone took it away from them directly",
    denied: "someone took it away from them directly, overriding their role",
  },
  DEFAULT_DENY: {
    allowed: "nothing grants it",
    denied: "nothing they hold grants it, and nothing needs to be removed",
  },
  SITE_CAPABILITY: {
    allowed: "they are a Site Admin, so this is decided at platform level rather than by this club",
    denied: "this is decided at platform level rather than by this club",
  },
  MEMBERSHIP_INACTIVE: { allowed: "", denied: "their membership of this club is not active" },
  MEMBERSHIP_SUSPENDED: { allowed: "", denied: "their membership of this club is suspended" },
  ROLE_SUSPENDED: { allowed: "", denied: "the role that would grant it is suspended" },
  CLUB_INACTIVE: { allowed: "", denied: "this club is not active" },
  ACCOUNT_INACTIVE: { allowed: "", denied: "their account is not active" },
  MINOR_PROHIBITED: { allowed: "", denied: "this is never available to a child's account" },
  ADULT_PLAYER: { allowed: "they are the adult player this is about", denied: "they are not the person this is about" },
  OUT_OF_SCOPE: { allowed: "", denied: "this permission does not apply at this level" },
  SCOPE_NOT_IMPLEMENTED: { allowed: "", denied: "this permission does not apply at this level" },
  UNKNOWN_CAPABILITY: { allowed: "", denied: "Ovalball does not recognise that permission" },
  CAPABILITY_RETIRED: { allowed: "", denied: "that permission has been retired" },
  SESSION: { allowed: "", denied: "their session is not currently valid" },
  NO_SUBJECT: { allowed: "", denied: "there is no such person" },
  IMPERSONATION_VIEW_ONLY: { allowed: "", denied: "support access can look but not change anything" },
  IMPERSONATION_BLOCKED: { allowed: "", denied: "support access may not do this at all" },
  SCOPE_MALFORMED: { allowed: "", denied: "the question was not asked about a real club or team" },
  SCOPE_TAMPERED: { allowed: "", denied: "the question was not asked about a real club or team" },
}

/**
 * One sentence saying whether the person may do it and what decided that.
 *
 * `decisiveRule` is the database's own name for the rule and is used verbatim
 * when no sentence exists for the code -- an unrecognised code must still
 * produce a true answer, never an invented one.
 */
export function explainDecision(name: string, capabilityLabel: string, decision: AccessDecision): string {
  const wording = decision.reasonCode ? REASON_SENTENCE[decision.reasonCode] : undefined
  const because = (decision.allowed ? wording?.allowed : wording?.denied) || decision.decisiveRule || null
  const verdict = decision.allowed ? `${name} can ${capabilityLabel}` : `${name} cannot ${capabilityLabel}`
  return because ? `${verdict}, because ${because}.` : `${verdict}.`
}

/**
 * The short label under the sentence: what a Club Admin would DO about it.
 * Deliberately never a control -- naming the lever is the job; pressing it
 * belongs to the surface that owns that lever.
 */
export function decisionRemedy(decision: AccessDecision): string | null {
  switch (decision.reasonCode) {
    case "EXPLICIT_ALLOW":
      return decision.allowed ? "Clear the extra permission to fall back to their role." : null
    case "EXPLICIT_DENY":
      return "Clear the override to fall back to their role."
    case "ROLE_BUNDLE":
      return decision.allowed ? "Change their club role to change this." : "Give them a role that includes it, or grant it directly."
    case "DEFAULT_DENY":
      return decision.allowed ? null : "Grant it directly, or give them a role that includes it."
    case "MEMBERSHIP_INACTIVE":
    case "MEMBERSHIP_SUSPENDED":
      return "Restore their club membership first."
    case "SITE_CAPABILITY":
      return "This club cannot change it."
    default:
      return null
  }
}
