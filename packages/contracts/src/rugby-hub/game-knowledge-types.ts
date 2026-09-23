/**
 * Client-safe Game Knowledge types and pure helpers -- split from
 * game-knowledge-data.ts ("server-only") for the same reason as every
 * other *-types.ts file in this codebase: a client component importing a
 * runtime value from a server-only module pulls the whole module in.
 */

export type RugbyCode = "union" | "league"

export interface GameConceptPosition {
  positionId: string
  positionKey: string
  rugbyCode: RugbyCode
  displayName: string
  shirtNumber: number | null
}

export interface GameConceptSkill {
  skillId: string
  skillKey: string
  displayName: string
}

export interface GameConceptRegulatoryFact {
  factKey: string
  valueText: string | null
}

export interface GameConceptRelatedLink {
  title: string
  href: string
}

export interface GameConcept {
  id: string
  contentKey: string
  title: string
  summary: string
  rugbyCode: RugbyCode | null
  conceptFamily: string
  journeyOrder: number | null
  whyItMatters: string | null
  whatHappens: string | null
  whatToWatchFor: string | null
  whatHappensNext: string | null
  unionLeagueDifference: string | null
}

export interface GameKnowledgeBundle {
  concepts: GameConcept[]
  positionsByConcept: Map<string, GameConceptPosition[]>
  skillsByConcept: Map<string, GameConceptSkill[]>
  relatedByConcept: Map<string, GameConceptRelatedLink[]>
  regulatoryFactsByConcept: Map<string, GameConceptRegulatoryFact[]>
}

export function findConceptByKey(bundle: GameKnowledgeBundle, contentKey: string): GameConcept | null {
  return bundle.concepts.find((c) => c.contentKey === contentKey) ?? null
}

/** Journey concepts ordered for the beginner path -- a code-specific pair (same journeyOrder) both appear, letting the page show whichever fits the viewer's context or both. */
export function journeySteps(bundle: GameKnowledgeBundle): { order: number; concepts: GameConcept[] }[] {
  const withOrder = bundle.concepts.filter((c): c is GameConcept & { journeyOrder: number } => c.journeyOrder != null)
  const byOrder = new Map<number, GameConcept[]>()
  for (const c of withOrder) {
    const list = byOrder.get(c.journeyOrder) ?? []
    list.push(c)
    byOrder.set(c.journeyOrder, list)
  }
  return Array.from(byOrder.entries())
    .sort(([a], [b]) => a - b)
    .map(([order, concepts]) => ({ order, concepts }))
}

export function groupConceptsByFamily(concepts: GameConcept[]): { family: string; concepts: GameConcept[] }[] {
  const groups = new Map<string, GameConcept[]>()
  for (const c of concepts) {
    const list = groups.get(c.conceptFamily) ?? []
    list.push(c)
    groups.set(c.conceptFamily, list)
  }
  return Array.from(groups.entries()).map(([family, list]) => ({ family, concepts: list }))
}

export const CONCEPT_FAMILY_LABEL: Record<string, string> = {
  FUNDAMENTALS: "Fundamentals",
  POSSESSION_AND_CONTINUITY: "Possession and Continuity",
  ATTACK_AND_DEFENCE: "Attack and Defence",
  RESTARTS_AND_SET_PIECES: "Restarts and Set Pieces",
  LAWS_IN_PLAY: "Laws in Play",
  GAME_FLOW: "Game Flow",
}

/** Data-driven label for a concept's own rugby_code -- never inferred from contentKey or hardcoded per concept. Null for the common, genuinely code-universal case. */
export function conceptRugbyCodeLabel(rugbyCode: RugbyCode | null): string | null {
  if (rugbyCode === "union") return "Rugby Union"
  if (rugbyCode === "league") return "Rugby League"
  return null
}
