import "server-only"

/**
 * The canonical email event catalogue, mirroring public.email_events.
 *
 * This file is the TypeScript half of a contract whose other half is the
 * database table. A regression test asserts the two agree, because a
 * catalogue that drifts from the table is how an event starts sending under
 * a classification nobody chose.
 *
 * WHY CLASSIFICATION MATTERS MORE THAN IT LOOKS
 *
 * Marketing consent and operational delivery are different things, and
 * conflating them is how a safeguarding message ends up gated on a
 * newsletter checkbox. So every event states, once, which of three kinds it
 * is -- and the policy engine in `send.ts` reads only this, never a flag
 * passed by a caller.
 */

export type EmailClassification =
  /** Operational, and delivered regardless of preference. Reserved for things a club cannot opt out of and still be safely run. */
  | "MANDATORY_OPERATIONAL"
  /** Operational, but the recipient may switch it off for its topic. */
  | "OPTIONAL_OPERATIONAL"
  /** Sent to someone with no Ovalball account: an invitation, or a safeguarding fallback. No preference can exist, so none is consulted. */
  | "TRANSACTIONAL_IDENTITY"

/**
 * Which server-side resolver produces the address.
 *
 * There is no `to` anywhere in this system. A caller names an ENTITY; the
 * resolver reads that entity's canonical contact from the database under the
 * caller's own session. That is what makes an arbitrary-recipient relay
 * structurally impossible rather than a rule every call site must remember.
 */
export type RecipientKind =
  | "club_invitation"
  | "guardian_invitation"
  | "player_account_invitation"
  | "safeguarding_officer"
  | "site_admin_invitation"
  | "site_admin_inbox"
  | "support_ticket"
  | "partner_invitation"
  | "club_billing_contact"

export interface EmailEventDefinition {
  classification: EmailClassification
  /** null only for TRANSACTIONAL_IDENTITY -- the recipient has no account, so no topic preference exists. */
  topicKey: string | null
  recipientKind: RecipientKind
  description: string
}

export const EMAIL_EVENTS = {
  club_invitation: {
    classification: "TRANSACTIONAL_IDENTITY",
    topicKey: null,
    recipientKind: "club_invitation",
    description: "Someone has been invited to join a club on Ovalball.",
  },
  guardian_invitation: {
    classification: "TRANSACTIONAL_IDENTITY",
    topicKey: null,
    recipientKind: "guardian_invitation",
    description: "A parent/guardian has been invited to link to a player.",
  },
  player_account_invitation: {
    classification: "TRANSACTIONAL_IDENTITY",
    topicKey: null,
    recipientKind: "player_account_invitation",
    description: "A player has been invited to create their own Ovalball login.",
  },
  safeguarding_officer_invitation: {
    classification: "TRANSACTIONAL_IDENTITY",
    topicKey: null,
    recipientKind: "safeguarding_officer",
    description: "A club has invited someone to be its Safeguarding Officer.",
  },
  site_admin_invitation: {
    classification: "TRANSACTIONAL_IDENTITY",
    topicKey: null,
    recipientKind: "site_admin_invitation",
    description: "Someone has been invited to become an Ovalball Site Administrator.",
  },
  partner_club_invitation: {
    classification: "TRANSACTIONAL_IDENTITY",
    topicKey: null,
    recipientKind: "partner_invitation",
    description:
      "A club has invited another club to join Ovalball. This is the referral invitation.",
  },
  safeguarding_officer_message: {
    classification: "TRANSACTIONAL_IDENTITY",
    topicKey: null,
    recipientKind: "safeguarding_officer",
    description:
      "A message to a Safeguarding Officer who has no active Ovalball account, sent to the club's own recorded contact.",
  },
  club_claim_submitted: {
    classification: "MANDATORY_OPERATIONAL",
    topicKey: "access_invitations",
    recipientKind: "site_admin_inbox",
    description: "A club claim needs Site Admin review.",
  },
  support_ticket_reply: {
    classification: "MANDATORY_OPERATIONAL",
    topicKey: "support_moderation",
    recipientKind: "support_ticket",
    description:
      "A reply to a support request raised from the public site, where the requester has no account to read it in.",
  },
  referral_reward_earned: {
    classification: "MANDATORY_OPERATIONAL",
    topicKey: "platform_billing",
    recipientKind: "club_billing_contact",
    description:
      "A referred club paid its first subscription, so the referring club earned a free month.",
  },
} as const satisfies Record<string, EmailEventDefinition>

export type EmailEventKey = keyof typeof EMAIL_EVENTS

export function emailEventDefinition(key: EmailEventKey): EmailEventDefinition {
  return EMAIL_EVENTS[key]
}

export const EMAIL_EVENT_KEYS = Object.keys(EMAIL_EVENTS) as EmailEventKey[]
