import { LEGAL_VERSION } from "@/lib/legal/metadata"

/**
 * The three things a new Ovalball account must confirm at signup -- and,
 * importantly, the DIFFERENT legal events they represent.
 *
 * Presenting them as three ticks is a UI decision. Recording them as three
 * identical events would be a legal error, so `kind` carries the
 * distinction all the way through to storage:
 *
 *   agreement       Terms of Service. A contract. Recorded in
 *                   public.terms_acceptances, which exists for exactly this
 *                   and whose own comment says so.
 *
 *   acknowledgement Privacy Notice and Safeguarding Policy. Confirmation
 *                   that a published document was read. NOT consent to
 *                   processing -- Ovalball does not rely on consent as the
 *                   lawful basis for what the Privacy Notice describes, and
 *                   describing it as consent would misstate that basis.
 *                   Recorded in public.policy_acknowledgements.
 *
 * An earlier version of this file wrote all three into terms_acceptances as
 * "privacy@1.0" / "safeguarding@1.0". That was wrong: it recorded an
 * acknowledgement as a Terms agreement, so the audit trail would have
 * answered "what did this person agree to?" incorrectly. Hence the split.
 */
export type ConsentKind = "agreement" | "acknowledgement"

export interface RequiredConsent {
  /** Stable policy identity. Never derived from a page title. */
  id: "terms" | "privacy" | "safeguarding"
  label: string
  href: string
  /** What the tick legally IS -- decides where it is recorded. */
  kind: ConsentKind
  /** The published version being agreed to / acknowledged. */
  version: string
  /** Wording for the checkbox, matched to the legal event. */
  statement: string
}

export const REQUIRED_CONSENTS: RequiredConsent[] = [
  {
    id: "terms",
    label: "Terms of Service",
    href: "/legal/terms",
    kind: "agreement",
    version: LEGAL_VERSION,
    statement: "I agree to the",
  },
  {
    id: "privacy",
    label: "Privacy Notice",
    href: "/legal/privacy",
    kind: "acknowledgement",
    version: LEGAL_VERSION,
    statement: "I have read the",
  },
  {
    id: "safeguarding",
    label: "Safeguarding Policy",
    href: "/legal/safeguarding",
    kind: "acknowledgement",
    version: LEGAL_VERSION,
    statement: "I have read the",
  },
]

export type ConsentId = RequiredConsent["id"]

export const REQUIRED_CONSENT_IDS: ConsentId[] = REQUIRED_CONSENTS.map((c) => c.id)

/** True only when every required policy has been individually confirmed. */
export function hasAllRequiredConsents(accepted: Record<string, boolean> | undefined): boolean {
  if (!accepted) return false
  return REQUIRED_CONSENT_IDS.every((id) => accepted[id] === true)
}

/**
 * The Terms version to record in terms_acceptances -- the plain published
 * version, exactly as that table has always stored it.
 */
export function termsAgreementVersion(): string {
  const terms = REQUIRED_CONSENTS.find((c) => c.kind === "agreement")
  if (!terms) throw new Error("No Terms agreement is configured.")
  return terms.version
}

/** The acknowledgement rows to record in policy_acknowledgements. */
export function policyAcknowledgements(): { policy_id: string; policy_version: string }[] {
  return REQUIRED_CONSENTS.filter((c) => c.kind === "acknowledgement").map((c) => ({
    policy_id: c.id,
    policy_version: c.version,
  }))
}
