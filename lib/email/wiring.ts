import type { EmailEventKey } from "./catalogue"

/**
 * Which catalogued emails something in the product actually sends.
 *
 * WHY THIS IS WRITTEN DOWN RATHER THAN DETECTED AT RUNTIME
 *
 * Nothing at runtime can tell the difference between "this email has no
 * trigger" and "this email's trigger has not fired yet". Both look identical
 * from the delivery ledger on a quiet Tuesday, and the difference matters a
 * great deal to a Site Admin deciding whether their careful rewording of the
 * referral email will ever reach a human being.
 *
 * So it is declared here and CHECKED against the real call sites by
 * scripts/verify-email-wiring.mjs, which fails if this list and the code
 * disagree in either direction. A list that can drift silently is worse than
 * no list, because it is believed.
 *
 * An event missing from here is not a defect. referral_reward_earned has a
 * finished template and no trigger because the referral programme itself is
 * not built yet -- Email Configuration says so on its face rather than
 * implying the email works.
 */
export const WIRED_EVENT_KEYS: readonly EmailEventKey[] = [
  "club_invitation",
  "guardian_invitation",
  "player_account_invitation",
  "safeguarding_officer_invitation",
  "safeguarding_officer_message",
  "site_admin_invitation",
  "partner_club_invitation",
  "club_claim_submitted",
  "club_welcome",
  "support_ticket_reply",
]
