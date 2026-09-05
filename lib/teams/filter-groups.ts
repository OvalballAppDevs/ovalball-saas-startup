/**
 * Calendar team-filter grouping/sorting -- Master Architecture Pass
 * addendum reconciliation, "Calendar Filters". One canonical grouping
 * module, consumed identically by Month, Week, and Agenda (never a
 * separately reinvented ordering per view). Groups and sorts from
 * STRUCTURED canonical team metadata (category/age_group/gender/
 * squad_designation) exclusively -- never by parsing a display label,
 * which this same session's own duplicate-team audit proved is
 * unreliable (several real rows share a display_name like "U12" while
 * differing only in a populated-vs-null `gender` column).
 */

export type FilterGroupKey = "minis_juniors" | "colts" | "mens" | "womens" | "girls" | "other"

export const FILTER_GROUP_ORDER: FilterGroupKey[] = ["minis_juniors", "colts", "girls", "womens", "mens", "other"]

export const FILTER_GROUP_LABEL: Record<FilterGroupKey, string> = {
  minis_juniors: "Minis + Juniors",
  colts: "Colts",
  mens: "Men's",
  womens: "Women's",
  girls: "Girls",
  other: "Other",
}

export interface FilterableLane {
  id: string
  label: string
  fullLabel: string
  kind: "team" | "group"
  category: string | null
  ageGroup: string | null
  gender: string | null
  squadDesignation: string | null
}

export interface FilterGroup<T extends FilterableLane> {
  key: FilterGroupKey
  label: string
  lanes: T[]
}

const AGE_ORDER: Record<string, number> = {
  U18: 18,
  U17: 17,
  U16: 16,
  U15: 15,
  U14: 14,
  U13: 13,
  U12: 12,
  U11: 11,
  U10: 10,
  U9: 9,
  U8: 8,
  U7: 7,
  U6: 6,
}

function ageRank(ageGroup: string | null): number {
  if (!ageGroup) return -1
  return AGE_ORDER[ageGroup] ?? -1
}

/** "1st" -> 1, "2nd" -> 2, ... -- the only squad_designation shape senior teams use; null (no designation at all) sorts first. */
function ordinalRank(squadDesignation: string | null): number {
  if (!squadDesignation) return 0
  const n = Number.parseInt(squadDesignation, 10)
  return Number.isFinite(n) ? n : 999
}

/** null/primary first, then alphabetical (B, C, D, ...) -- primary never displays as "A", so it has no designation to sort by other than "comes first". */
function squadLetterRank(squadDesignation: string | null): number {
  if (!squadDesignation) return 0
  return squadDesignation.charCodeAt(0)
}

function groupKeyFor(lane: FilterableLane): FilterGroupKey {
  // Shared mini-rugby scheduling groups have no single team identity to
  // classify by -- Section 2's own instruction ("place shared mini groups
  // deliberately inside Minis + Juniors, do not allow them to float
  // alphabetically") settles this by product convention: every scheduling
  // group in this codebase combines young mini-rugby-age component teams
  // (see lib/app-context's own "shared scheduling group" comments
  // throughout Calendar/Teams).
  if (lane.kind === "group") return "minis_juniors"

  if (lane.gender === "girls") return "girls"
  if (lane.category === "colts") return "colts"
  if (lane.category === "senior" && lane.gender === "mens") return "mens"
  if (lane.category === "senior" && lane.gender === "womens") return "womens"
  if (lane.category === "youth") return "minis_juniors"
  return "other"
}

function compareWithinGroup(key: FilterGroupKey, a: FilterableLane, b: FilterableLane): number {
  if (key === "mens" || key === "womens") {
    return ordinalRank(a.squadDesignation) - ordinalRank(b.squadDesignation) || a.fullLabel.localeCompare(b.fullLabel)
  }
  if (key === "colts") {
    // SeniorColts before JuniorColts -- older first, consistent with the
    // rest of this module's age-descending convention (colts has no
    // structured numeric age_group of its own to rank by).
    const rank = (ag: string | null) => (ag === "SeniorColts" ? 1 : ag === "JuniorColts" ? 0 : -1)
    return rank(b.ageGroup) - rank(a.ageGroup) || a.fullLabel.localeCompare(b.fullLabel)
  }
  if (key === "minis_juniors" || key === "girls") {
    // Group (shared scheduling group) lanes sort after every individual
    // age-group team in the bucket -- a deliberate, documented default
    // (Section 2 asks only that they land inside Minis + Juniors, not
    // exactly where); individual teams sort by age descending, then
    // primary/B/C.
    if (a.kind === "group" && b.kind === "group") return a.fullLabel.localeCompare(b.fullLabel)
    if (a.kind === "group") return 1
    if (b.kind === "group") return -1
    return ageRank(b.ageGroup) - ageRank(a.ageGroup) || squadLetterRank(a.squadDesignation) - squadLetterRank(b.squadDesignation) || a.fullLabel.localeCompare(b.fullLabel)
  }
  return a.fullLabel.localeCompare(b.fullLabel)
}

/**
 * Groups and sorts an already-resolved lane list into the five product
 * buckets (Section 1/2), skipping any bucket with zero lanes. The one
 * function Month/Week/Agenda all call -- see each view's own filter
 * component for how the result is rendered (desktop grouped chips vs
 * mobile sheet).
 */
export function groupAndSortLanes<T extends FilterableLane>(lanes: T[]): FilterGroup<T>[] {
  const buckets = new Map<FilterGroupKey, T[]>()
  for (const lane of lanes) {
    const key = groupKeyFor(lane)
    const list = buckets.get(key) ?? []
    list.push(lane)
    buckets.set(key, list)
  }
  const result: FilterGroup<T>[] = []
  for (const key of FILTER_GROUP_ORDER) {
    const list = buckets.get(key)
    if (!list || list.length === 0) continue
    result.push({ key, label: FILTER_GROUP_LABEL[key], lanes: [...list].sort((a, b) => compareWithinGroup(key, a, b)) })
  }
  return result
}
