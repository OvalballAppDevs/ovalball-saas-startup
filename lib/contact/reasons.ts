import type { SupportCategory } from "@/lib/support/types"

/**
 * The reasons offered on the public Contact page.
 *
 * Contact is deliberately NOT a second support system: every submission
 * becomes an ordinary support ticket in the same `support_tickets` table,
 * visible in the same Site Admin Support Register, with the same reference
 * scheme. What differs is only the vocabulary at the door -- a visitor
 * contacting Ovalball for the first time thinks in terms of "my club is
 * interested", not "Club Management" -- so this list is written for that
 * visitor and mapped onto the existing ticket categories server-side.
 *
 * The mapping is one-way and lives on the server. A caller chooses a reason
 * key; it never chooses a category, a subject line or, crucially, a
 * recipient. There is no recipient parameter anywhere in this path: a
 * ticket is a database row, so there is nothing for a client to redirect.
 */
export const CONTACT_REASONS = [
  "general",
  "club_interest",
  "account_support",
  "privacy",
  "safeguarding",
  "technical",
  "other",
] as const

export type ContactReason = (typeof CONTACT_REASONS)[number]

export const CONTACT_REASON_LABELS: Record<ContactReason, string> = {
  general: "General enquiry",
  club_interest: "Club interested in Ovalball",
  account_support: "Account support",
  privacy: "Privacy / data rights",
  safeguarding: "Safeguarding / online safety",
  technical: "Technical problem",
  other: "Other",
}

/**
 * Which existing ticket category each reason files under.
 *
 * Several reasons collapse onto `other` because the support category set is
 * constrained by a CHECK constraint on `support_tickets` plus three RPCs,
 * and widening it is a schema change this surface does not need: the
 * reason's own label is written verbatim into the ticket subject (see
 * `contactSubject`), so nothing a visitor selected is ever lost -- it is
 * legible at a glance in the Support Register even where the category is
 * coarse.
 */
export const CONTACT_REASON_CATEGORY: Record<ContactReason, SupportCategory> = {
  general: "other",
  club_interest: "other",
  account_support: "account_login",
  privacy: "privacy_account_data",
  safeguarding: "other",
  technical: "bug",
  other: "other",
}

/**
 * The ticket subject for a contact submission.
 *
 * The Contact form has no subject field of its own (four fields only, by
 * design -- name, email, reason, message), so the reason label becomes the
 * subject. Safeguarding is prefixed so it cannot be missed in a list view:
 * it maps to the coarse `other` category, and a safeguarding report sitting
 * unmarked among general enquiries is exactly the failure worth spending a
 * prefix to avoid.
 */
export function contactSubject(reason: ContactReason): string {
  const label = CONTACT_REASON_LABELS[reason]
  return reason === "safeguarding" ? `SAFEGUARDING — ${label}` : `Contact — ${label}`
}

export function isContactReason(value: string): value is ContactReason {
  return (CONTACT_REASONS as readonly string[]).includes(value)
}
