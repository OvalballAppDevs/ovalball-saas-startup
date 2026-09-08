import "server-only"

import { EMAIL_EVENT_KEYS, type EmailEventKey } from "./catalogue"

/**
 * THE CODE-OWNED HALF OF THE CANONICAL EMAIL TEMPLATE REGISTRY.
 *
 * Every registered transactional email has a contract here saying three things
 * a Site Admin may not change:
 *
 *   1. which VARIABLES its copy may use, by exact name;
 *   2. what the DEFAULT copy is, so a never-edited event still sends and a
 *      broken override has something safe to fall back to;
 *   3. whether it has a call to action, whose DESTINATION is always built
 *      server-side from canonical routing.
 *
 * WHY VARIABLES ARE AN ALLOWLIST AND NOT AN OBJECT
 *
 * The template engine is never handed a domain object. It is handed a map
 * built specifically for the event, containing only the keys listed here. That
 * is the difference between "{{club_name}} renders the club's name" and
 * "{{player.date_of_birth}} renders whatever happens to be reachable" -- and
 * the second is not a bug you find in review, it is a data breach you find in
 * an inbox. An unknown name is rejected at save time and, if one somehow
 * survives, renders as nothing rather than reaching for a value.
 *
 * WHY THE CTA DESTINATION IS NOT EDITABLE
 *
 * A Site Admin may change what the button SAYS. Where it goes is generated
 * from the event's own data through the canonical origin resolver, because an
 * editable destination turns every transactional email Ovalball sends into a
 * phishing vector that arrives correctly branded, correctly authenticated, and
 * from a domain the recipient already trusts.
 */

export interface EmailVariable {
  /** The exact merge tag name, without braces. */
  name: string
  /** What it is, in the words a Site Admin reads next to the field. */
  description: string
  /** A safe, obviously-fake example used for preview. Never real data. */
  sample: string
}

export interface EmailTemplateContract {
  /** How this appears in Site Admin. Title Case: it is a destination name. */
  name: string
  category: EmailCategory
  /** Plain-English answer to "when does this actually go out?". */
  trigger: string
  /**
   * The category label shown in the email's brand band.
   *
   * CODE-OWNED, and deliberately not part of the editable content. It names
   * the KIND of message -- Welcome, Safeguarding, Support -- which is a fact
   * about the event rather than a matter of wording. A Site Admin may rewrite
   * a safeguarding email's heading; being able to file it under "Welcome to
   * Ovalball" is a different power, and not one this screen grants.
   */
  eyebrow: string
  /** Whether this event has a call-to-action button at all. */
  hasCta: boolean
  variables: EmailVariable[]
  /** The registered Ovalball copy. The fallback, and what "Restore default" restores. */
  default: EmailTemplateContent
}

export interface EmailTemplateContent {
  subject: string
  preheader: string
  heading: string
  body: string
  ctaLabel: string | null
}

export type EmailCategory =
  | "Account & Access"
  | "Club"
  | "Guardian & Player"
  | "Safeguarding"
  | "Support"
  | "Referral"

/** Variables every email may use, because the shell always has them. */
const COMMON: EmailVariable[] = []

export const EMAIL_TEMPLATE_CONTRACTS: Record<EmailEventKey, EmailTemplateContract> = {
  club_invitation: {
    name: "Club Invitation",
    category: "Account & Access",
    trigger: "Sent when a club invites somebody to join it on Ovalball.",
    eyebrow: "Club Invitation",
    hasCta: true,
    variables: [
      { name: "club_name", description: "The inviting club's name.", sample: "Solihull Rugby Club" },
      { name: "role_label", description: "The role they are being invited into, if one was chosen.", sample: "Club Administrator" },
    ],
    default: {
      subject: "You've been invited to join {{club_name}} on Ovalball",
      preheader: "{{club_name}} has invited you to their club on Ovalball.",
      heading: "Join {{club_name}} on Ovalball",
      body: "{{club_name}} uses Ovalball to run fixtures, teams and matchdays. They've invited you to join them.",
      ctaLabel: "Accept your invitation",
    },
  },

  guardian_invitation: {
    name: "Parent or Guardian Invitation",
    category: "Guardian & Player",
    trigger: "Sent when a club invites a parent or guardian to link to their child's team.",
    eyebrow: "Guardian Invitation",
    hasCta: true,
    // Deliberately no child name, date of birth or team detail beyond the club.
    // A guardian invitation reaches an address nobody has verified yet, so it
    // says a club has invited you and nothing about a specific child.
    variables: [
      { name: "club_name", description: "The inviting club's name.", sample: "Solihull Rugby Club" },
    ],
    default: {
      subject: "{{club_name}} has invited you as a parent or guardian",
      preheader: "Link your Ovalball account to your child's team at {{club_name}}.",
      heading: "You've been invited by {{club_name}}",
      body: "{{club_name}} uses Ovalball to organise fixtures, training and availability. Accepting this invitation links your Ovalball account so you can respond for your child.",
      ctaLabel: "Accept your invitation",
    },
  },

  player_account_invitation: {
    name: "Player Account Invitation",
    category: "Guardian & Player",
    trigger: "Sent when a guardian invites a player to create their own Ovalball login.",
    eyebrow: "Player Account",
    hasCta: true,
    variables: [
      // No club variable: this invitation is sent by a guardian and the send
      // path has no single club in hand, so offering {{club_name}} would let
      // an administrator write copy that renders blank in a real send.
      { name: "player_first_name", description: "The player's first name.", sample: "Callum" },
    ],
    default: {
      subject: "Your own Ovalball login",
      preheader: "Set up your own Ovalball account.",
      heading: "Set up your Ovalball login",
      body: "You can now have your own Ovalball login to see your fixtures and set your availability.",
      ctaLabel: "Set up your login",
    },
  },

  safeguarding_officer_invitation: {
    name: "Safeguarding Officer Invitation",
    category: "Safeguarding",
    trigger: "Sent when a club invites somebody to be its Safeguarding Officer.",
    eyebrow: "Safeguarding",
    hasCta: true,
    variables: [
      { name: "club_name", description: "The inviting club's name.", sample: "Solihull Rugby Club" },
    ],
    default: {
      subject: "{{club_name}} has asked you to be their Safeguarding Officer",
      preheader: "Confirm your safeguarding role at {{club_name}}.",
      heading: "Safeguarding Officer at {{club_name}}",
      body: "{{club_name}} has recorded you as their Safeguarding Officer on Ovalball. Accepting confirms the role and gives you the access it needs.",
      ctaLabel: "Confirm your role",
    },
  },

  safeguarding_officer_message: {
    name: "Safeguarding Officer Message",
    category: "Safeguarding",
    trigger:
      "Sent when somebody messages a Safeguarding Officer who has no active Ovalball account, to the club's own recorded contact address.",
    eyebrow: "Safeguarding",
    hasCta: false,
    variables: [
      { name: "club_name", description: "The club the officer acts for.", sample: "Solihull Rugby Club" },
    ],
    default: {
      subject: "A safeguarding message from Ovalball",
      preheader: "Somebody has sent you a safeguarding message through Ovalball.",
      heading: "You have a safeguarding message",
      body: "This message was sent to you as {{club_name}}'s Safeguarding Officer.",
      ctaLabel: null,
    },
  },

  site_admin_invitation: {
    name: "Site Admin Invitation",
    category: "Account & Access",
    trigger: "Sent when an existing Site Admin invites somebody to administer Ovalball.",
    eyebrow: "Site Administration",
    hasCta: true,
    variables: [],
    default: {
      subject: "You've been invited to administer Ovalball",
      preheader: "Accept your Ovalball Site Administrator invitation.",
      heading: "Ovalball Site Administrator",
      body: "You've been invited to help administer Ovalball.",
      ctaLabel: "Accept your invitation",
    },
  },

  partner_club_invitation: {
    name: "Partner Club Invitation",
    category: "Referral",
    trigger: "Sent when a club invites another club to join Ovalball.",
    eyebrow: "Partner Clubs",
    hasCta: true,
    variables: [
      { name: "club_name", description: "The club sending the invitation.", sample: "Solihull Rugby Club" },
      { name: "invited_club_name", description: "The club being invited.", sample: "Sample RUFC" },
    ],
    default: {
      subject: "{{club_name}} thinks {{invited_club_name}} should be on Ovalball",
      preheader: "{{club_name}} has invited your club to Ovalball.",
      heading: "{{club_name}} has invited your club",
      body: "{{club_name}} uses Ovalball to run their fixtures, teams and matchdays, and thinks {{invited_club_name}} would get on with it too.",
      ctaLabel: "See what Ovalball does",
    },
  },

  club_claim_submitted: {
    name: "Club Claim Submitted",
    category: "Club",
    trigger: "Sent to the Ovalball operations inbox when a club claim needs review.",
    eyebrow: "Club Claim",
    hasCta: true,
    variables: [
      { name: "club_name", description: "The club being claimed.", sample: "Solihull Rugby Club" },
    ],
    default: {
      subject: "Club claim to review: {{club_name}}",
      preheader: "A club claim is waiting for Site Admin review.",
      heading: "A club claim needs review",
      body: "{{club_name}} has been claimed and is waiting for due diligence.",
      ctaLabel: "Open Site Admin",
    },
  },

  club_welcome: {
    name: "Club Welcome",
    category: "Club",
    trigger: "Sent to the person who claimed a club, once a Site Admin approves that claim.",
    eyebrow: "Welcome to Ovalball",
    hasCta: true,
    variables: [
      { name: "first_name", description: "The claimant's first name.", sample: "Callum" },
      { name: "club_name", description: "The newly activated club.", sample: "Solihull Rugby Club" },
    ],
    default: {
      subject: "Welcome to Ovalball, {{club_name}}",
      preheader: "{{club_name}} is now set up on Ovalball.",
      heading: "Welcome to Ovalball, {{club_name}}",
      body:
        "Hi {{first_name}},\n\nYour club is now part of Ovalball.\n\nOvalball brings your club, teams, fixtures and rugby administration together in one connected place, helping everyone stay closer to the game.",
      ctaLabel: "Open Ovalball",
    },
  },

  support_ticket_reply: {
    name: "Support Reply",
    category: "Support",
    trigger: "Sent when Ovalball replies to a support request raised from the public site.",
    eyebrow: "Support",
    hasCta: false,
    variables: [
      { name: "reference", description: "The support ticket reference.", sample: "SUP-1042" },
    ],
    default: {
      subject: "Re: your Ovalball support request",
      preheader: "Ovalball has replied to your support request.",
      heading: "We've replied to your request",
      body: "Here's our reply to your support request.",
      ctaLabel: null,
    },
  },

  referral_reward_earned: {
    name: "Referral Reward Earned",
    category: "Referral",
    trigger: "Sent when a club a member referred pays its first subscription.",
    eyebrow: "Referral Reward",
    hasCta: true,
    variables: [
      { name: "referred_club_name", description: "The club that joined.", sample: "Sample RUFC" },
    ],
    default: {
      subject: "You've earned a free month of Ovalball",
      preheader: "{{referred_club_name}} joined Ovalball through your invitation.",
      heading: "You've earned a free month",
      body: "{{referred_club_name}} has joined Ovalball through your club's invitation, so your next month is on us.",
      ctaLabel: "See your subscription",
    },
  },
}

/** Every merge tag an event may legitimately use. */
export function allowedVariables(key: EmailEventKey): EmailVariable[] {
  return [...COMMON, ...EMAIL_TEMPLATE_CONTRACTS[key].variables]
}

/**
 * Every `{{tag}}` in a piece of copy that the event's contract does not allow.
 *
 * This is what makes an object path such as `{{player.date_of_birth}}` or
 * `{{process.env.SECRET}}` a save-time validation failure rather than a
 * question about what the renderer happens to do with it.
 */
export function unknownVariables(key: EmailEventKey, ...content: Array<string | null>): string[] {
  const allowed = new Set(allowedVariables(key).map((v) => v.name))
  const found = new Set<string>()
  for (const piece of content) {
    if (!piece) continue
    for (const match of piece.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
      const name = match[1]
      if (!allowed.has(name)) found.add(name)
    }
  }
  return [...found]
}

/** Sample values for preview. Obviously fake, and never read from real records. */
export function sampleVariables(key: EmailEventKey): Record<string, string> {
  const out: Record<string, string> = {}
  for (const variable of allowedVariables(key)) out[variable.name] = variable.sample
  return out
}

export function templateContract(key: EmailEventKey): EmailTemplateContract {
  return EMAIL_TEMPLATE_CONTRACTS[key]
}

/** Every registered event has a contract -- asserted here so a new event cannot be half-added. */
export const CONTRACTED_EVENT_KEYS: EmailEventKey[] = EMAIL_EVENT_KEYS.filter(
  (key) => key in EMAIL_TEMPLATE_CONTRACTS
)
