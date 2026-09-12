/**
 * Client-safe Officiating types and pure helpers -- split from
 * officiating-data.ts ("server-only") for the same reason as every other
 * *-types.ts file in this codebase: a client component importing a runtime
 * value from a server-only module pulls the whole module in.
 */

export type RugbyCode = "union" | "league"

export interface OfficiatingPosition {
  positionId: string
  positionKey: string
  rugbyCode: RugbyCode
  displayName: string
}

export interface OfficiatingSkill {
  skillId: string
  skillKey: string
  displayName: string
}

export interface OfficiatingRegulatoryFact {
  factKey: string
  valueText: string | null
}

export interface OfficiatingRelatedLink {
  title: string
  href: string
}

export interface OfficiatingConcept {
  id: string
  contentKey: string
  title: string
  summary: string
  rugbyCode: RugbyCode | null
  officiatingFamily: string
  whyItMatters: string | null
  whatHappens: string | null
  whatToWatchFor: string | null
  whatHappensNext: string | null
  unionLeagueDifference: string | null
  howItIsSignalled: string | null
  commonMisunderstanding: string | null
}

export interface OfficiatingBundle {
  concepts: OfficiatingConcept[]
  positionsByConcept: Map<string, OfficiatingPosition[]>
  skillsByConcept: Map<string, OfficiatingSkill[]>
  relatedByConcept: Map<string, OfficiatingRelatedLink[]>
  glossaryByConcept: Map<string, OfficiatingRelatedLink[]>
  regulatoryFactsByConcept: Map<string, OfficiatingRegulatoryFact[]>
}

export function findConceptByKey(bundle: OfficiatingBundle, contentKey: string): OfficiatingConcept | null {
  return bundle.concepts.find((c) => c.contentKey === contentKey) ?? null
}

export function groupConceptsByFamily(concepts: OfficiatingConcept[]): { family: string; concepts: OfficiatingConcept[] }[] {
  const groups = new Map<string, OfficiatingConcept[]>()
  for (const c of concepts) {
    const list = groups.get(c.officiatingFamily) ?? []
    list.push(c)
    groups.set(c.officiatingFamily, list)
  }
  const order = ["MATCH_OFFICIALS", "DECISIONS_AND_SIGNALS", "DISCIPLINE_AND_SANCTIONS", "COMMUNICATION", "RESPECT_AND_BEHAVIOUR", "BECOMING_AN_OFFICIAL"]
  return order.filter((f) => groups.has(f)).map((family) => ({ family, concepts: groups.get(family)! }))
}

export const OFFICIATING_FAMILY_LABEL: Record<string, string> = {
  MATCH_OFFICIALS: "Meet the Officials",
  DECISIONS_AND_SIGNALS: "Why That Decision?",
  DISCIPLINE_AND_SANCTIONS: "Discipline and Sanctions",
  COMMUNICATION: "Captain and Referee Communication",
  RESPECT_AND_BEHAVIOUR: "Respect the Referee",
  BECOMING_AN_OFFICIAL: "Becoming an Official",
}

/** Data-driven label for a concept's own rugby_code -- never inferred from contentKey or hardcoded per concept. Null for the common, genuinely code-universal case. */
export function officiatingRugbyCodeLabel(rugbyCode: RugbyCode | null): string | null {
  if (rugbyCode === "union") return "Rugby Union"
  if (rugbyCode === "league") return "Rugby League"
  return null
}
