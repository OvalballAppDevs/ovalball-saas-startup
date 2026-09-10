import "server-only"

import { DYNAMIC_DATA_CATALOGUE, dynamicDataItem, type DynamicDataGroup, type DynamicDataItem } from "./dynamic-data/catalogue"
import { EMAIL_EVENT_KEYS, type EmailEventKey } from "./catalogue"

/**
 * THE CODE-OWNED HALF OF THE CANONICAL EMAIL TEMPLATE REGISTRY.
 *
 * Every registered transactional email has a contract here saying three things
 * a Site Admin may not change:
 *
 *   1. which DYNAMIC DATA its copy may use, by exact key -- resolved from
 *      lib/email/dynamic-data/catalogue.ts, the ONE catalogue. This file
 *      never carries its own copy of a label, a description or a sample:
 *      it only says WHICH catalogue keys this event's data can genuinely
 *      provide.
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

/** Re-exported so existing callers (and existing tests) that import the category type from here keep working -- there is exactly one group taxonomy, owned by the catalogue. */
export type EmailVariableCategory = DynamicDataGroup

/** What kind of value a variable substitutes. Every scalar today is text; the type exists so a future date/number is not a silent exception to this shape. */
export type EmailVariableType = "text"

export interface EmailVariable {
  /** The exact merge tag name, without braces. */
  name: string
  /** Short, human name for the Dynamic Data panel -- "Club name", not "club_name". */
  label: string
  category: EmailVariableCategory
  valueType: EmailVariableType
  /** What it is, in the words a Site Admin reads next to the field. */
  description: string
  /** A safe, obviously-fake example used for preview. Never real data. */
  sample: string
  /** Where this value genuinely comes from, in plain language -- shown so a Site Admin knows what they are trusting, not just what it looks like. */
  source: string
}

function toEmailVariable(i: DynamicDataItem): EmailVariable {
  return { name: i.key, label: i.label, category: i.group, valueType: "text", description: i.description, sample: i.sample, source: i.source }
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
  /**
   * Every scalar `{{token}}` this event's copy may use, by catalogue key.
   * `allowedVariables()` resolves each into its full metadata -- and also
   * pulls in any DEPRECATED key whose `replacedBy` points here, so a
   * published draft written against an old name keeps validating and
   * rendering.
   */
  variables: string[]
  /**
   * Every renderer-owned structured/image entry this event's shell shows
   * automatically -- "match_summary", "club_crest", and so on, by catalogue
   * key. Never a token: nothing here is inserted at a cursor, and nothing
   * here is Site-Admin-editable. Registered so the Dynamic Data panel can
   * show it as an informational entry and scripts/verify-dynamic-data-
   * catalogue.mjs can assert every renderer-owned block is declared exactly
   * once.
   */
  structuredBlocks: string[]
  /**
   * A small, curated subset of `variables`/`structuredBlocks` the Dynamic
   * Data panel shows first, before "More data" -- see docs/
   * EMAIL_DYNAMIC_DATA_CATALOGUE.md section AC. Never auto-inserted.
   */
  recommended: string[]
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

export const EMAIL_TEMPLATE_CONTRACTS: Record<EmailEventKey, EmailTemplateContract> = {
  club_invitation: {
    name: "Club Invitation",
    category: "Account & Access",
    trigger: "Sent when a club invites somebody to join it on Ovalball.",
    eyebrow: "Club Invitation",
    hasCta: true,
    variables: ["club_name", "role_label"],
    structuredBlocks: ["club_crest"],
    recommended: ["club_name"],
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
    variables: ["club_name"],
    structuredBlocks: ["club_crest"],
    recommended: ["club_name"],
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
    // No club variable: this invitation is sent by a guardian and the send
    // path has no single club in hand, so offering {{club_name}} would let
    // an administrator write copy that renders blank in a real send.
    variables: ["player_first_name"],
    structuredBlocks: [],
    recommended: ["player_first_name"],
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
    variables: ["club_name"],
    structuredBlocks: ["club_crest"],
    recommended: ["club_name"],
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
    variables: ["club_name"],
    structuredBlocks: [],
    recommended: ["club_name"],
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
    structuredBlocks: [],
    recommended: [],
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
    variables: ["club_name", "invited_club_name"],
    structuredBlocks: [],
    recommended: ["club_name", "invited_club_name"],
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
    variables: ["club_name"],
    structuredBlocks: [],
    recommended: ["club_name"],
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
    variables: ["recipient_first_name", "club_name"],
    structuredBlocks: ["club_crest"],
    recommended: ["recipient_first_name", "club_name"],
    default: {
      subject: "Welcome to Ovalball, {{club_name}}",
      preheader: "{{club_name}} is now set up on Ovalball.",
      heading: "Welcome to Ovalball, {{club_name}}",
      body:
        "Hi {{recipient_first_name}},\n\nYour club is now part of Ovalball.\n\nOvalball brings your club, teams, fixtures and rugby administration together in one connected place, helping everyone stay closer to the game.",
      ctaLabel: "Open Ovalball",
    },
  },

  support_ticket_reply: {
    name: "Support Reply",
    category: "Support",
    trigger: "Sent when Ovalball replies to a support request raised from the public site.",
    eyebrow: "Support",
    hasCta: false,
    variables: ["reference"],
    structuredBlocks: [],
    recommended: ["reference"],
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
    variables: ["referred_club_name"],
    structuredBlocks: [],
    recommended: ["referred_club_name"],
    default: {
      subject: "You've earned a free month of Ovalball",
      preheader: "{{referred_club_name}} joined Ovalball through your invitation.",
      heading: "You've earned a free month",
      body: "{{referred_club_name}} has joined Ovalball through your club's invitation, so your next month is on us.",
      ctaLabel: "See your subscription",
    },
  },

  match_cancelled: {
    name: "Match Cancelled",
    category: "Club",
    trigger: "Sent when a fixture is cancelled, to that fixture's effective participant population.",
    eyebrow: "Fixture Update",
    hasCta: true,
    variables: [
      "cancellation_reason",
      "fixture_our_team",
      "fixture_opposition_name",
      "fixture_date",
      "fixture_day",
      "fixture_kickoff_time",
      "fixture_meet_time",
      "fixture_venue_name",
      "fixture_venue_postcode",
      "fixture_competition_name",
      "fixture_status",
    ],
    // The team/opposition identity and crests live INSIDE the Match Summary
    // block, resolved from the fixture itself -- not a second, editable
    // club-crest slot alongside it.
    structuredBlocks: ["match_summary"],
    recommended: ["fixture_our_team", "fixture_opposition_name", "fixture_date", "fixture_kickoff_time", "fixture_venue_name"],
    default: {
      subject: "Match cancelled",
      preheader: "This fixture will no longer go ahead.",
      heading: "This match has been cancelled",
      body: "The details below will no longer go ahead. Reason: {{cancellation_reason}}",
      ctaLabel: "View Match Centre",
    },
  },
}

/**
 * Every merge tag an event may legitimately use, resolved from the ONE
 * catalogue -- plus any deprecated key whose replacement this event already
 * supports, so a published draft written before a rename still validates
 * and renders identically. A missing catalogue entry for a declared key is a
 * programming error caught by scripts/verify-dynamic-data-catalogue.mjs,
 * never silently dropped here.
 */
export function allowedVariables(key: EmailEventKey): EmailVariable[] {
  const declared = new Set(EMAIL_TEMPLATE_CONTRACTS[key].variables)
  const items: DynamicDataItem[] = []
  for (const k of declared) {
    const found = dynamicDataItem(k)
    if (found) items.push(found)
  }
  for (const candidate of Object.values(DYNAMIC_DATA_CATALOGUE)) {
    if (candidate.deprecated && declared.has(candidate.deprecated.replacedBy)) items.push(candidate)
  }
  return items.map(toEmailVariable)
}

/** Every renderer-owned structured/image entry this event's shell shows automatically, resolved from the catalogue. */
export function structuredBlocksFor(key: EmailEventKey): DynamicDataItem[] {
  return EMAIL_TEMPLATE_CONTRACTS[key].structuredBlocks
    .map((k) => dynamicDataItem(k))
    .filter((i): i is DynamicDataItem => i !== undefined)
}

/** The curated "recommended for this email" subset -- variables and structured blocks together, in the order declared. */
export function recommendedDataFor(key: EmailEventKey): DynamicDataItem[] {
  return EMAIL_TEMPLATE_CONTRACTS[key].recommended
    .map((k) => dynamicDataItem(k))
    .filter((i): i is DynamicDataItem => i !== undefined)
}

/**
 * Whether this event's shell shows a club crest automatically -- the same
 * question `structuredBlocks.includes("club_crest")` answers, kept as a
 * named helper because "does this email show a crest" is asked from enough
 * call sites (renderers, regression tests) that spelling out the catalogue
 * key at each one would be the kind of duplication this file exists to
 * avoid.
 */
export function hasClubCrest(key: EmailEventKey): boolean {
  return EMAIL_TEMPLATE_CONTRACTS[key].structuredBlocks.includes("club_crest")
}

/** Whether this event's shell shows the structured Match Summary block. */
export function hasMatchSummary(key: EmailEventKey): boolean {
  return EMAIL_TEMPLATE_CONTRACTS[key].structuredBlocks.includes("match_summary")
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
