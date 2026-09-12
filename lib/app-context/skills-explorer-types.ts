/**
 * Types and pure, side-effect-free helpers shared between the server data
 * layer (skills-explorer-data.ts, "server-only") and client components --
 * see position-explorer-types.ts for why this split exists (a client
 * component importing anything, even a type, from a "server-only" module
 * pulls the whole module, guard included, into the client bundle).
 */

export interface TechniqueStep {
  label: string
  text: string
}

export interface SkillPosition {
  positionId: string
  positionKey: string
  rugbyCode: "union" | "league"
  displayName: string
  shirtNumber: number | null
}

export interface SkillRelationship {
  skillId: string
  relationshipType: "PREREQUISITE" | "RELATED"
}

export interface RegulatoryFactRef {
  factKey: string
  authorityName: string | null
  valueText: string | null
  sourceKey: string | null
}

export interface SkillTrainingContent {
  contentKey: string
  /** The linked item's own content_type. hub_skill_content_links has always been type-agnostic; carrying the type through is what lets a skill page send the reader to the right destination instead of rendering every linked item as an undifferentiated citation. */
  contentType: string
  title: string
  summary: string
  regulatoryFacts: RegulatoryFactRef[]
}

/**
 * The linked content a skill page can send the reader TO, as opposed to
 * merely cite. Player Development concepts are the first such case: a skill
 * teaches the technique, and the development concept above it explains what
 * is actually being learned, so the reverse direction of the link is a real
 * journey rather than a footnote.
 */
export function skillDevelopmentLinks(content: SkillTrainingContent[]): SkillTrainingContent[] {
  return content.filter((c) => c.contentType === "PLAYER_DEVELOPMENT_CONCEPT")
}

/**
 * Coaching concepts linked to this skill. A coach arriving at a skill page
 * wants to know how to TEACH it, which is a different question from how a
 * player practises it — so these are a destination with their own section,
 * not a citation in the Sources list.
 */
export function skillCoachingLinks(content: SkillTrainingContent[]): SkillTrainingContent[] {
  return content.filter((c) => c.contentType === "COACHING_CONCEPT")
}

/** Linked content with no destination of its own -- rendered as the citation it is. */
export function skillCitedContent(content: SkillTrainingContent[]): SkillTrainingContent[] {
  return content.filter((c) => c.contentType !== "PLAYER_DEVELOPMENT_CONCEPT" && c.contentType !== "COACHING_CONCEPT")
}

export interface SkillSummary {
  id: string
  skillKey: string
  displayName: string
  skillFamily: string
  /** NULL = genuinely code-universal (the common case). 'union'/'league' only when the skill genuinely does not exist in the other code -- mirrors hub_positions.rugby_code, read directly off the row, never inferred from skillKey. */
  rugbyCode: "union" | "league" | null
  summary: string
  whyItMatters: string | null
  whenYouUseIt: string | null
  keyCues: string | null
  commonMistakes: string | null
  howToImprove: string | null
  gameExamples: string | null
  techniqueSteps: TechniqueStep[] | null
  /** True only when the viewer's own resolved regulatory identity falls under a real, sourced "contact not yet permitted" fact -- never a hardcoded age number. See getSkillsExplorerBundle. */
  contactNotYetPermitted: boolean
}

export interface SkillsExplorerBundle {
  skills: SkillSummary[]
  positionsBySkill: Map<string, SkillPosition[]>
  relatedBySkill: Map<string, SkillRelationship[]>
  trainingContentBySkill: Map<string, SkillTrainingContent[]>
}

export function findSkillByKey(bundle: SkillsExplorerBundle, skillKey: string): SkillSummary | null {
  return bundle.skills.find((s) => s.skillKey === skillKey) ?? null
}

/**
 * A skill pair can legitimately carry both a PREREQUISITE and a RELATED
 * row (they mean different things: "learn this first" vs "connected
 * concept"), but the UI shows one chip per related skill, not one per
 * relationship row -- so this dedupes by the related skill's id, keeping
 * PREREQUISITE (the more specific, more useful label) whenever both exist
 * for the same pair.
 */
export function relatedSkillsOf(bundle: SkillsExplorerBundle, skill: SkillSummary): { skill: SkillSummary; relationshipType: SkillRelationship["relationshipType"] }[] {
  const rels = bundle.relatedBySkill.get(skill.id) ?? []
  const bySkillId = new Map<string, SkillRelationship["relationshipType"]>()
  for (const r of rels) {
    const existing = bySkillId.get(r.skillId)
    if (!existing || (existing !== "PREREQUISITE" && r.relationshipType === "PREREQUISITE")) {
      bySkillId.set(r.skillId, r.relationshipType)
    }
  }
  return Array.from(bySkillId.entries())
    .map(([skillId, relationshipType]) => {
      const related = bundle.skills.find((s) => s.id === skillId)
      return related ? { skill: related, relationshipType } : null
    })
    .filter((x): x is { skill: SkillSummary; relationshipType: SkillRelationship["relationshipType"] } => !!x)
}

/** Groups skills by their real skill_family -- never an invented UI taxonomy. Only families with at least one published skill appear. */
export function groupSkillsByFamily(skills: SkillSummary[]): { family: string; skills: SkillSummary[] }[] {
  const groups = new Map<string, SkillSummary[]>()
  for (const s of skills) {
    const list = groups.get(s.skillFamily) ?? []
    list.push(s)
    groups.set(s.skillFamily, list)
  }
  return Array.from(groups.entries()).map(([family, list]) => ({ family, skills: list }))
}

/** Data-driven label for a skill's own rugby_code -- never inferred from skill_key or hardcoded per skill. Null for the common, genuinely code-universal case. */
export function skillRugbyCodeLabel(rugbyCode: "union" | "league" | null): string | null {
  if (rugbyCode === "union") return "Rugby Union"
  if (rugbyCode === "league") return "Rugby League"
  return null
}

export const SKILL_FAMILY_LABEL: Record<string, string> = {
  HANDLING: "Handling",
  RUNNING_EVASION: "Movement",
  CONTACT: "Contact",
  BREAKDOWN: "Breakdown",
  SET_PIECE: "Set Piece",
  KICKING: "Kicking",
  DEFENCE: "Defence",
  ATTACK_SHAPE: "Attack",
  COMMUNICATION: "Communication",
  DECISION_MAKING: "Decision Making",
  LEADERSHIP: "Leadership",
  OTHER: "Other",
}
