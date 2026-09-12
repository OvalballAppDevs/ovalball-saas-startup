import type { RugbyCode } from "./rugby-hub-data"

/**
 * Types and pure, side-effect-free helpers shared between the server data
 * layer (position-explorer-data.ts, which carries "server-only" and must
 * never be imported by a client component -- even for just a type or a
 * pure function, since the bundler pulls in the whole module including
 * that guard) and client components that need to look a position up out
 * of an already-fetched bundle without a second request.
 */

export type AgeStage = "NORMAL" | "EMERGING" | "NOT_APPLICABLE" | "UNASSESSED"

export interface PositionSummary {
  id: string
  positionKey: string
  rugbyCode: RugbyCode
  displayName: string
  alternativeNames: string[]
  shirtNumber: number | null
  positionFamily: string
  purpose: string
  roleWithBall: string | null
  roleWithoutBall: string | null
  attackResponsibilities: string | null
  defenceResponsibilities: string | null
  setPieceResponsibilities: string | null
  keySkillsSummary: string | null
  decisionMaking: string | null
  communication: string | null
  developmentPriorities: string | null
  commonMistakes: string | null
  strongPerformanceLooksLike: string | null
  ageGuidanceNote: string | null
  pitchAnchorX: number | null
  pitchAnchorY: number | null
  ageStage: AgeStage
  ageStageNote: string | null
}

export interface PositionSkill {
  positionId: string
  skillId: string
  skillKey: string
  displayName: string
  summary: string
  note: string | null
  hasDetailContent: boolean
}

export interface PositionExplorerBundle {
  rugbyCode: RugbyCode
  positions: PositionSummary[]
  skillsByPosition: Map<string, PositionSkill[]>
  relatedByPosition: Map<string, string[]> // positionId -> related positionIds
}

export function findPositionByKey(bundle: PositionExplorerBundle, positionKey: string): PositionSummary | null {
  return bundle.positions.find((p) => p.positionKey === positionKey) ?? null
}

export function relatedPositionsOf(bundle: PositionExplorerBundle, position: PositionSummary): PositionSummary[] {
  const ids = bundle.relatedByPosition.get(position.id) ?? []
  return ids.map((id) => bundle.positions.find((p) => p.id === id)).filter((p): p is PositionSummary => !!p)
}

/** Groups the code's positions by position_family in pitch/list display order (by average pitch_anchor_y within the group). Never a hardcoded per-code family list -- whatever families the data actually has, grouped and ordered by where they sit on the pitch. */
export function groupByFamily(positions: PositionSummary[]): { family: string; positions: PositionSummary[] }[] {
  const groups = new Map<string, PositionSummary[]>()
  for (const p of positions) {
    const list = groups.get(p.positionFamily) ?? []
    list.push(p)
    groups.set(p.positionFamily, list)
  }
  return Array.from(groups.entries())
    .map(([family, list]) => ({ family, positions: list }))
    .sort((a, b) => {
      const avg = (list: PositionSummary[]) => list.reduce((sum, p) => sum + (p.pitchAnchorY ?? 0.5), 0) / list.length
      return avg(a.positions) - avg(b.positions)
    })
}

export const POSITION_FAMILY_LABEL: Record<string, string> = {
  FRONT_ROW: "Front Row",
  SECOND_ROW: "Second Row",
  BACK_ROW: "Back Row",
  LOOSE_FORWARD: "Loose Forward",
  HALF_BACKS: "Half-Backs",
  MIDFIELD: "Midfield",
  BACK_THREE: "Back Three",
}
