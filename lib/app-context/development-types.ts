/**
 * Client-safe Player Development types and pure helpers -- split from
 * development-data.ts ("server-only") for the same reason as every other
 * *-types.ts file in this codebase: a client component importing a runtime
 * value from a server-only module pulls the whole module, guard included,
 * into the client bundle.
 *
 * Player Development is the meta-layer ABOVE Skills. A skill answers "how do
 * I do this technique"; a development concept answers "what am I actually
 * learning, and how does learning work". Nothing here rates, ranks, scores,
 * tracks or compares a player, and nothing here reads a player record --
 * see development-data.ts for the query proof.
 */

export type { SourceTier } from "./people-types"
export { SOURCE_TIER_LABEL } from "./people-types"

import type { SourceTier } from "./people-types"

export type RugbyCode = "union" | "league"

export type DevelopmentFamily = "FOUNDATIONS" | "TECHNICAL" | "TACTICAL" | "PHYSICAL" | "MENTAL"

/** Presentation order of the families -- broadest and earliest first. Not a ranking, and not a sequence a player must complete. */
export const DEVELOPMENT_FAMILY_ORDER: DevelopmentFamily[] = ["FOUNDATIONS", "TECHNICAL", "TACTICAL", "PHYSICAL", "MENTAL"]

export const DEVELOPMENT_FAMILY_LABEL: Record<DevelopmentFamily, string> = {
  FOUNDATIONS: "Foundations",
  TECHNICAL: "Technical",
  TACTICAL: "Tactical",
  PHYSICAL: "Physical",
  MENTAL: "Mental",
}

export const DEVELOPMENT_FAMILY_BLURB: Record<DevelopmentFamily, string> = {
  FOUNDATIONS: "How learning rugby actually works, before any one technique.",
  TECHNICAL: "Joining separate techniques into something that holds up in a real game.",
  TACTICAL: "Reading what is in front of you and choosing well.",
  PHYSICAL: "How young bodies develop, and why rugby is taught in stages.",
  MENTAL: "Confidence, composure and finding your way through the age grades.",
}

export interface DevelopmentSkillLink {
  skillKey: string
  displayName: string
}

export interface DevelopmentPositionLink {
  positionKey: string
  rugbyCode: RugbyCode
  displayName: string
  shirtNumber: number | null
}

export interface DevelopmentRelatedLink {
  title: string
  href: string
  /** What the destination is, so the page can say so rather than presenting every link as the same thing. */
  kindLabel: string
}

export interface DevelopmentRegulatoryFact {
  factKey: string
  valueText: string | null
}

export interface DevelopmentSource {
  tier: SourceTier
  title: string
  url: string | null
  retrievedOn: string | null
}

export interface DevelopmentConcept {
  id: string
  contentKey: string
  title: string
  summary: string
  body: string | null
  whyItMatters: string | null
  family: DevelopmentFamily
  /** NULL = genuinely code-universal (the common case). 'union'/'league' only where the concept genuinely does not exist in the other code -- read off the row, never inferred from contentKey. */
  rugbyCode: RugbyCode | null
  aliases: string[]
  /** Position on the beginner path, from the data. NULL for the majority, which are reached by family, skill, position or search instead. */
  journeyOrder: number | null
}

export interface DevelopmentBundle {
  concepts: DevelopmentConcept[]
  skillsByConcept: Map<string, DevelopmentSkillLink[]>
  positionsByConcept: Map<string, DevelopmentPositionLink[]>
  relatedByConcept: Map<string, DevelopmentRelatedLink[]>
  regulatoryFactsByConcept: Map<string, DevelopmentRegulatoryFact[]>
  sourcesByConcept: Map<string, DevelopmentSource[]>
}

export function findDevelopmentConceptByKey(bundle: DevelopmentBundle, contentKey: string): DevelopmentConcept | null {
  return bundle.concepts.find((c) => c.contentKey === contentKey) ?? null
}

/** Concepts visible for a code filter. A code-universal concept is shown under every filter; a code-specific one only under its own code. */
export function filterConceptsByCode(concepts: DevelopmentConcept[], code: "all" | RugbyCode): DevelopmentConcept[] {
  if (code === "all") return concepts
  return concepts.filter((c) => c.rugbyCode === null || c.rugbyCode === code)
}

/** The beginner path, in the order the data gives. Deliberately all code-universal, so the same path is honest in both codes. */
export function developmentJourney(concepts: DevelopmentConcept[]): DevelopmentConcept[] {
  return concepts.filter((c) => c.journeyOrder != null).sort((a, b) => (a.journeyOrder ?? 0) - (b.journeyOrder ?? 0))
}

export function groupConceptsByFamily(concepts: DevelopmentConcept[]): { family: DevelopmentFamily; concepts: DevelopmentConcept[] }[] {
  return DEVELOPMENT_FAMILY_ORDER.map((family) => ({ family, concepts: concepts.filter((c) => c.family === family) })).filter((g) => g.concepts.length > 0)
}

/** Data-driven label for a concept's own rugby_code -- null for the common, genuinely code-universal case. */
export function developmentRugbyCodeLabel(rugbyCode: RugbyCode | null): string | null {
  if (rugbyCode === "union") return "Rugby Union"
  if (rugbyCode === "league") return "Rugby League"
  return null
}
