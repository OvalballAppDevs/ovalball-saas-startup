/**
 * Client-safe Coaching Knowledge types and pure helpers — split from
 * coaching-data.ts ("server-only") for the same reason as every other
 * *-types.ts file in this codebase.
 *
 * Coaching Knowledge is the layer explaining how a COACH creates learning.
 * Skills own technique, Player Development owns what a player is developing,
 * and the Training Centre owns real sessions, attendance and plans. Nothing
 * here is operational: no session, no attendance, no coach record, no
 * qualification, and nothing any coach or player is measured against.
 */

export type { SourceTier } from "./people-types"
export { SOURCE_TIER_LABEL } from "./people-types"

import type { SourceTier } from "./people-types"

export type RugbyCode = "union" | "league"

export type CoachingFamily = "COACHING_APPROACH" | "SESSION_DESIGN" | "PRACTICE_DESIGN" | "COMMUNICATION" | "INCLUSION" | "SAFETY" | "REFLECTION"

/** Presentation order: how you coach, then how you plan, then how you talk, then who you include, then safety, then getting better. Not a ranking and not a syllabus. */
export const COACHING_FAMILY_ORDER: CoachingFamily[] = ["COACHING_APPROACH", "SESSION_DESIGN", "PRACTICE_DESIGN", "COMMUNICATION", "INCLUSION", "SAFETY", "REFLECTION"]

/** Named for a volunteer coach, not for a sports-pedagogy textbook. */
export const COACHING_FAMILY_LABEL: Record<CoachingFamily, string> = {
  COACHING_APPROACH: "Coaching Approach",
  SESSION_DESIGN: "Planning Sessions",
  PRACTICE_DESIGN: "Designing Practice",
  COMMUNICATION: "Communication and Feedback",
  INCLUSION: "Coaching Everyone",
  SAFETY: "Coaching Safely",
  REFLECTION: "Improving Your Coaching",
}

export const COACHING_FAMILY_BLURB: Record<CoachingFamily, string> = {
  COACHING_APPROACH: "What good coaching actually looks like, and how much to step back.",
  SESSION_DESIGN: "Getting the shape of an evening right before you worry about the detail.",
  PRACTICE_DESIGN: "Building activities that make players think, not just move.",
  COMMUNICATION: "Saying less, asking more, and watching before you speak.",
  INCLUSION: "Running one session that works for everybody in it.",
  SAFETY: "Coaching contact and challenge within what the governing body allows.",
  REFLECTION: "Getting better across a season, not just tonight.",
}

/** The "I want to…" entry points. Pure navigation: each is a question a coach already has, answered by sending them to a concept. No questionnaire, no stored answer, no assessment. */
export const COACHING_INTENTS: { question: string; conceptKey: string }[] = [
  { question: "I need to plan a session", conceptKey: "planning-a-simple-session" },
  { question: "I want players to make more decisions", conceptKey: "coaching-decision-making" },
  { question: "I need to coach mixed ability", conceptKey: "coaching-mixed-ability-groups" },
  { question: "I want to give better feedback", conceptKey: "giving-effective-feedback" },
  { question: "I need to coach contact safely", conceptKey: "coaching-contact-safely" },
  { question: "I'm coaching players new to rugby", conceptKey: "coaching-players-new-to-rugby" },
  { question: "My session keeps running out of time", conceptKey: "setting-a-clear-session-purpose" },
  { question: "Players are standing around too much", conceptKey: "keeping-players-active-and-involved" },
]

export interface CoachingSkillLink {
  skillKey: string
  displayName: string
}

export interface CoachingRelatedLink {
  title: string
  href: string
  /** What the destination is, so a coach can see where a link goes before following it. */
  kindLabel: string
}

export interface CoachingRegulatoryFact {
  factKey: string
  valueText: string | null
}

export interface CoachingSource {
  tier: SourceTier
  title: string
  url: string | null
  retrievedOn: string | null
}

export interface CoachingConcept {
  id: string
  contentKey: string
  title: string
  summary: string
  body: string | null
  whyItMatters: string | null
  family: CoachingFamily
  /** NULL = genuinely code-universal (the common case). Only set where coaching genuinely differs between the codes. */
  rugbyCode: RugbyCode | null
  aliases: string[]
  /** Position on the New to Coaching path, from the data. NULL for most concepts. */
  journeyOrder: number | null
}

export interface CoachingBundle {
  concepts: CoachingConcept[]
  skillsByConcept: Map<string, CoachingSkillLink[]>
  relatedByConcept: Map<string, CoachingRelatedLink[]>
  regulatoryFactsByConcept: Map<string, CoachingRegulatoryFact[]>
  sourcesByConcept: Map<string, CoachingSource[]>
}

export function findCoachingConceptByKey(bundle: CoachingBundle, contentKey: string): CoachingConcept | null {
  return bundle.concepts.find((c) => c.contentKey === contentKey) ?? null
}

/** A code-universal concept shows under every filter; a code-specific one only under its own code. */
export function filterCoachingByCode(concepts: CoachingConcept[], code: "all" | RugbyCode): CoachingConcept[] {
  if (code === "all") return concepts
  return concepts.filter((c) => c.rugbyCode === null || c.rugbyCode === code)
}

/** The New to Coaching path, in the order the data gives. Deliberately all code-universal so it is honest for a Union and a League coach alike. */
export function coachingJourney(concepts: CoachingConcept[]): CoachingConcept[] {
  return concepts.filter((c) => c.journeyOrder != null).sort((a, b) => (a.journeyOrder ?? 0) - (b.journeyOrder ?? 0))
}

export function groupCoachingByFamily(concepts: CoachingConcept[]): { family: CoachingFamily; concepts: CoachingConcept[] }[] {
  return COACHING_FAMILY_ORDER.map((family) => ({ family, concepts: concepts.filter((c) => c.family === family) })).filter((g) => g.concepts.length > 0)
}

/** Data-driven label for a concept's own rugby_code — null for the common, genuinely code-universal case. */
export function coachingRugbyCodeLabel(rugbyCode: RugbyCode | null): string | null {
  if (rugbyCode === "union") return "Rugby Union"
  if (rugbyCode === "league") return "Rugby League"
  return null
}
