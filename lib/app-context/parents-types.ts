/**
 * Client-safe Parents & Guardians types and pure helpers — split from
 * parents-data.ts ("server-only") for the same reason as every other
 * *-types.ts file in this codebase.
 *
 * Parents & Guardians is the parent-facing interpretation and navigation
 * layer. It is the canonical authority for nothing: Rules owns the Law,
 * Player Welfare owns welfare guidance, Safeguarding owns safeguarding,
 * Glossary owns definitions, and Skills, Player Development and Coaching
 * own the player's and coach's own sides. What lives here is the adult's
 * question and the route to the real answer.
 *
 * Nothing in this domain reads or records anything about a real family:
 * no guardian, no player, no registration, no consent, no medical record,
 * no payment, no attendance, no message. See parents-data.ts for the query
 * proof.
 */

export type { SourceTier } from "./people-types"
export { SOURCE_TIER_LABEL } from "./people-types"

import type { SourceTier } from "./people-types"

export type RugbyCode = "union" | "league"

export type ParentFamily =
  | "GETTING_STARTED"
  | "TRAINING_AND_MATCH_DAY"
  | "SUPPORTING_YOUR_PLAYER"
  | "WELFARE_AND_SAFETY"
  | "CLUB_CULTURE"
  | "PATHWAYS_AND_OPPORTUNITIES"
  | "PRACTICAL_RUGBY"

/** Ordered the way a family actually meets rugby: arrive, go to things, support a player, stay safe, understand the club, look further ahead, deal with the practicalities. */
export const PARENT_FAMILY_ORDER: ParentFamily[] = [
  "GETTING_STARTED",
  "TRAINING_AND_MATCH_DAY",
  "SUPPORTING_YOUR_PLAYER",
  "WELFARE_AND_SAFETY",
  "CLUB_CULTURE",
  "PATHWAYS_AND_OPPORTUNITIES",
  "PRACTICAL_RUGBY",
]

export const PARENT_FAMILY_LABEL: Record<ParentFamily, string> = {
  GETTING_STARTED: "Getting Started",
  TRAINING_AND_MATCH_DAY: "Training & Match Day",
  SUPPORTING_YOUR_PLAYER: "Supporting Your Player",
  WELFARE_AND_SAFETY: "Welfare & Safety",
  CLUB_CULTURE: "Coaches, Officials & Club Culture",
  PATHWAYS_AND_OPPORTUNITIES: "Pathways & Opportunities",
  PRACTICAL_RUGBY: "Practical Rugby",
}

export const PARENT_FAMILY_BLURB: Record<ParentFamily, string> = {
  GETTING_STARTED: "What happens first, what you need, and enough of the game to follow it.",
  TRAINING_AND_MATCH_DAY: "What a session and a match morning actually involve.",
  SUPPORTING_YOUR_PLAYER: "Being useful on the good days and the difficult ones.",
  WELFARE_AND_SAFETY: "Contact, head injuries and what a good club should feel like.",
  CLUB_CULTURE: "The touchline, the coach, the officials, and how selection works.",
  PATHWAYS_AND_OPPORTUNITIES: "Positions, pathways, academies and the girls' game — in proportion.",
  PRACTICAL_RUGBY: "Costs, festivals and tours, and helping out.",
}

/** "I need help with…" — real questions a parent already has, each answered by sending them somewhere. Navigation only: nothing is asked, nothing is stored, nothing is inferred about the reader. */
export const PARENT_INTENTS: { question: string; guideKey: string }[] = [
  { question: "My player is new to rugby", guideKey: "new-to-rugby-parents-start-here" },
  { question: "I don't understand what I'm watching", guideKey: "understanding-the-game-as-a-parent" },
  { question: "I don't know what to buy", guideKey: "what-a-new-player-needs" },
  { question: "I'm worried about contact", guideKey: "understanding-contact-rugby" },
  { question: "I want to talk to the coach", guideKey: "talking-with-your-players-coach" },
  { question: "My player wasn't selected", guideKey: "when-your-player-is-not-selected" },
  { question: "I want to understand pathways", guideKey: "understanding-rugby-pathways" },
  { question: "I'd like to help out", guideKey: "getting-involved-as-a-volunteer" },
]

export interface ParentRelatedLink {
  title: string
  href: string
  /** Which Hub domain owns the answer, so a parent can see where a link is taking them. */
  kindLabel: string
}

export interface ParentGlossaryLink {
  termKey: string
  displayTerm: string
}

export interface ParentSkillLink {
  skillKey: string
  displayName: string
}

export interface ParentPositionLink {
  positionKey: string
  rugbyCode: RugbyCode
  displayName: string
}

export interface ParentRegulatoryFact {
  factKey: string
  valueText: string | null
}

export interface ParentSource {
  tier: SourceTier | "SAFEGUARDING_AUTHORITY"
  title: string
  url: string | null
  retrievedOn: string | null
}

export interface ParentGuide {
  id: string
  contentKey: string
  title: string
  summary: string
  body: string | null
  whyItMatters: string | null
  family: ParentFamily
  /** NULL for every guide in v1: a parent's questions are the same in both codes, and where the answer differs the guide points at the regulatory layer instead of forking. */
  rugbyCode: RugbyCode | null
  aliases: string[]
  journeyOrder: number | null
}

export interface ParentsBundle {
  guides: ParentGuide[]
  relatedByGuide: Map<string, ParentRelatedLink[]>
  glossaryByGuide: Map<string, ParentGlossaryLink[]>
  skillsByGuide: Map<string, ParentSkillLink[]>
  positionsByGuide: Map<string, ParentPositionLink[]>
  regulatoryFactsByGuide: Map<string, ParentRegulatoryFact[]>
  sourcesByGuide: Map<string, ParentSource[]>
}

export function findParentGuideByKey(bundle: ParentsBundle, contentKey: string): ParentGuide | null {
  return bundle.guides.find((g) => g.contentKey === contentKey) ?? null
}

/** The newcomer path, ordered in the data. */
export function parentJourney(guides: ParentGuide[]): ParentGuide[] {
  return guides.filter((g) => g.journeyOrder != null).sort((a, b) => (a.journeyOrder ?? 0) - (b.journeyOrder ?? 0))
}

export function groupParentGuidesByFamily(guides: ParentGuide[]): { family: ParentFamily; guides: ParentGuide[] }[] {
  return PARENT_FAMILY_ORDER.map((family) => ({ family, guides: guides.filter((g) => g.family === family) })).filter((f) => f.guides.length > 0)
}

/** The two destinations that own the answers this domain most often defers to. Rendered as standing signposts rather than as content. */
export const PARENT_AUTHORITY_LINKS: { href: string; label: string; description: string }[] = [
  { href: "/rugby-hub/player-welfare", label: "Player Welfare", description: "Concussion and welfare guidance, straight from the governing bodies." },
  { href: "/rugby-hub/safeguarding", label: "Safeguarding", description: "Official safeguarding guidance, your club's welfare officer, and how to raise a concern." },
]
