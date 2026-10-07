import { compareAgeGroups } from "@ovalball/contracts/club/tournaments"

import type { DraftAgeGroup } from "./create-context"

/**
 * THE AGE-GROUP SELECTION RULES, held apart from the screen so they can be tested without a renderer.
 *
 * Two of them are not obvious from looking at the grid, and both exist to protect the organiser's
 * work rather than to make the tile light up:
 *
 *   1. THE LIST STAYS IN GRADE ORDER. Sorted once, here, so Teams, Review and the tournament itself
 *      all read U9 before U10 without each one sorting for itself -- and `compareAgeGroups` sorts
 *      numerically, because as text "U10" comes before "U9".
 *
 *   2. DESELECTING KEEPS WHAT WAS IN THE GRADE. Once teams are configured under a grade, an
 *      accidental tap would take them with it. `detached` holds the removed grade so re-selecting
 *      puts back exactly what was there, not an empty grade.
 */

export type DetachedAgeGroups = Map<string, DraftAgeGroup>

export function toggleAgeGroup(current: DraftAgeGroup[], ageGroup: string, detached: DetachedAgeGroups): DraftAgeGroup[] {
  const existing = current.find((a) => a.ageGroup === ageGroup)
  if (existing) {
    detached.set(ageGroup, existing)
    return current.filter((a) => a.ageGroup !== ageGroup)
  }
  const restored = detached.get(ageGroup)
  detached.delete(ageGroup)
  return [...current, restored ?? { ageGroup, ourTeamIds: null, sides: [] }].sort((a, b) => compareAgeGroups(a.ageGroup, b.ageGroup))
}

export function clearAgeGroups(current: DraftAgeGroup[], detached: DetachedAgeGroups): DraftAgeGroup[] {
  for (const a of current) detached.set(a.ageGroup, a)
  return []
}

/** "3 Age Groups Selected". TITLE CASE, because the content standard puts card headings that name a
 * region or a task in Title Case, and this line heads the selection summary rather than describing
 * it in a sentence. Singular when it is one: "1 Age Groups Selected" is the tell of a count no
 * person ever read. */
export function ageGroupCountLabel(count: number): string {
  return count === 1 ? "1 Age Group Selected" : `${count} Age Groups Selected`
}

/** "2 teams", and "1 team". Shown on a grade where the club already fields a side. */
export function ourTeamsLabel(count: number): string {
  return count === 1 ? "1 team" : `${count} teams`
}
