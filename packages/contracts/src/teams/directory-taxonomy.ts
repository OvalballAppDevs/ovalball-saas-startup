import { fullTeamLabel, compactTeamLabel } from "./compact-label"

/**
 * How team identities are grouped, wherever they are listed.
 *
 * Site Admin's Team Directory and a club's own Teams page use this same
 * taxonomy, because they are looking at the same thing and a club reading
 * "Minis, Juniors, Youth" in one place and an ungrouped list in the other is
 * two products. One source for what a team is called, one for how teams are
 * arranged.
 *
 * WHAT IS REGULATORY AND WHAT IS NOT
 *
 * Two of these groupings are structural facts, and are safe to rely on:
 *
 *   Minis        mixed age grades. The database constraint on teams itself
 *                only permits gender 'mixed' at U6-U11, so "mixed" and "mini"
 *                are the same set by construction, not by convention.
 *   Girls        the girls pathway, which RFU Regulation 15.6 runs in its own
 *                dual age bands and the RFL runs single-year.
 *   Adult Men /  category 'senior', split by gender.
 *   Adult Women
 *
 * One is NOT. The split of the boys pathway into JUNIORS and YOUTH has no
 * governing-body definition behind it in Ovalball's regulatory model: the RFU
 * regulates "Age Grade Rugby" as a single U7-U18 band, and nothing in
 * regulatory_identities or regulatory_facts draws a line inside it. The
 * boundary below is therefore PRESENTATION_ONLY -- a navigation aid so a Site
 * Admin is not reading a list of thirteen near-identical rows -- and must
 * never be used to decide eligibility, progression or anything else.
 *
 * If a governing body ever does define these bands, this is the one place to
 * change, and the PRESENTATION_ONLY marker is how you will know it mattered.
 */

export type DirectoryGroupKey = "minis" | "juniors" | "youth" | "colts" | "mens" | "womens" | "girls" | "retired"

export interface DirectoryGroup {
  key: DirectoryGroupKey
  title: string
  /** Why this grouping exists, shown to the administrator reading the list. */
  note: string
  /** True where the grouping is an Ovalball navigation aid, not a governing-body classification. */
  presentationOnly: boolean
}

export const DIRECTORY_GROUPS: DirectoryGroup[] = [
  { key: "minis", title: "Minis", note: "Mixed rugby, played by boys and girls together.", presentationOnly: false },
  { key: "juniors", title: "Juniors", note: "The first age grades after mixed rugby separates.", presentationOnly: true },
  { key: "youth", title: "Youth", note: "The later age grades, up to the end of the youth pathway.", presentationOnly: true },
  { key: "colts", title: "Colts", note: "The bridge between the youth pathway and senior rugby.", presentationOnly: false },
  { key: "mens", title: "Men's", note: "Senior men's rugby.", presentationOnly: false },
  { key: "womens", title: "Women's", note: "Senior women's rugby.", presentationOnly: false },
  { key: "girls", title: "Girls", note: "The girls pathway runs in its own age bands.", presentationOnly: false },
  { key: "retired", title: "Retired", note: "No longer offered. Kept so existing history still resolves.", presentationOnly: false },
]

/** PRESENTATION_ONLY. See the module comment: no governing body draws this line. */
const JUNIOR_AGE_GRADES = new Set(["U12", "U13", "U14"])

/**
 * The shape both a canonical identity and a club's own team satisfy: the
 * structured fields, and nothing else. A club team's squad letter goes in
 * `squadDesignation` exactly as a canonical type's fixed designation does.
 */
export interface DirectoryIdentityRow {
  id: string
  category: string
  ageGroup: string | null
  gender: string | null
  squadDesignation: string | null
  isActive: boolean
  sortOrder: number
}

export interface DirectoryIdentity extends DirectoryIdentityRow {
  /** The rugby identifier: U12, Girls U14, Men's 1st. */
  compact: string
  /** What the team is called: Under 12 Boys, Under 14 Girls, Men's 1st Team. */
  display: string
}

export function groupKeyFor(row: DirectoryIdentityRow): DirectoryGroupKey {
  if (!row.isActive) return "retired"
  if (row.category === "colts") return "colts"
  if (row.category === "senior") return row.gender === "womens" ? "womens" : "mens"
  if (row.gender === "girls") return "girls"
  if (row.gender === "mixed") return "minis"
  return row.ageGroup && JUNIOR_AGE_GRADES.has(row.ageGroup) ? "juniors" : "youth"
}

export function presentIdentity(
  row: DirectoryIdentityRow,
  /** Null only where a club has no recorded code; the labels then fall back to their code-neutral form. */
  rugbyCode: "union" | "league" | null | undefined,
  /** A club may give a B or C squad its own name; the canonical identity is untouched. */
  alias?: string | null
): DirectoryIdentity {
  const input = {
    category: row.category,
    ageGroup: row.ageGroup,
    gender: row.gender,
    squadDesignation: row.squadDesignation,
    rugbyCode,
    alias: alias ?? null,
  }
  return { ...row, compact: compactTeamLabel(input), display: fullTeamLabel(input) }
}

/** Grouped and ordered for reading. Empty groups are dropped. */
export function buildDirectory(
  rows: DirectoryIdentityRow[],
  rugbyCode: "union" | "league" | null | undefined,
  aliasById?: Map<string, string | null>
): { group: DirectoryGroup; identities: DirectoryIdentity[] }[] {
  const byKey = new Map<DirectoryGroupKey, DirectoryIdentity[]>()
  for (const row of [...rows].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const key = groupKeyFor(row)
    byKey.set(key, [...(byKey.get(key) ?? []), presentIdentity(row, rugbyCode, aliasById?.get(row.id))])
  }
  return DIRECTORY_GROUPS.filter((g) => (byKey.get(g.key) ?? []).length > 0).map((group) => ({
    group,
    identities: byKey.get(group.key) ?? [],
  }))
}
