import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { CompactLabelInput } from "./compact-label"
import { normalizedSquad } from "./compact-label"

/**
 * The ONE canonical, CLOSED list of teams a club can run -- the same list
 * the signup claim step shows under "Which teams does your club run?" and
 * the same 24 rows the database's `canonical_team_types` table enforces
 * (supabase/migrations/20260904200000_canonical_team_catalogue.sql). A
 * club admin never types a team name, and never invents a team identity:
 * they tick one of these 24, optionally add a second or third squad at an
 * age-grade level, and the display name is derived from the structured
 * fields every time -- see compact-label.ts, which this module feeds.
 * `key` matches canonical_team_types.key exactly, so a UI selection maps
 * onto the real database row by identifier, never by re-deriving it from
 * a label string.
 *
 * `allowAdditionalSquads` mirrors the signup picker's "tick B and/or C"
 * behaviour: the base tick is the club's only/first team at that level
 * (squad_designation stays null, so it renders as plain "U12", never
 * "U12 A"); B and C are for a genuine second/third team. Senior and Colts
 * identities are already fully fixed (an ordinal, or "Junior"/"Senior") so
 * they never offer a B/C toggle.
 *
 * Gender for the two ungendered age-grade groups ("Mini & youth", "Youth")
 * is inferred, not asked twice: U6-U11 defaults to `mixed` (the common
 * mini-rugby default, and the only band `teams_gender_category_check`
 * permits it for); U12-U16 defaults to `boys`, because U12+ can never be
 * `mixed` (same constraint) and Girls already has its own explicit
 * category group -- so the plain, non-Girls U12+ tick can only mean Boys.
 * Both resolve to a gender that compact-label.ts never prints ("mixed"/
 * "boys" are silent), so ticking "Under 12" produces "U12", not "U12
 * Boys". This is display/default classification only (kept on the row for
 * fixture-eligibility/rollover, per the closed catalogue's own design
 * note) -- it does not fork which of the 24 identities a team is.
 */
export interface TeamCategoryOption {
  /** Matches canonical_team_types.key exactly (e.g. "u12", "girls_u12", "junior_colts", "mens_1st"). */
  key: string
  /** Exactly the label shown at signup, e.g. "Under 12", "Under 12 Girls", "Men's 1st Team", "Junior Colts". */
  label: string
  /** The compact, club-page display label (no "Under", e.g. "U12", "Girls U12", "Junior Colts", "Men's 1st Team"). */
  compactLabel: string
  category: "senior" | "youth" | "colts"
  ageGroup: string | null
  gender: "boys" | "girls" | "mixed" | "mens" | "womens" | null
  /** Fixed squad_designation for a senior option (its ordinal); youth options resolve this via the B/C toggle instead. */
  fixedSquadDesignation: string | null
  allowAdditionalSquads: boolean
}

export interface TeamCategoryGroup {
  label: string
  options: TeamCategoryOption[]
}

const MINI_YOUTH_AGES = ["Under 6", "Under 7", "Under 8", "Under 9", "Under 10", "Under 11"]
const YOUTH_AGES = ["Under 12", "Under 13", "Under 14", "Under 15", "Under 16"]
const GIRLS_AGES = ["Under 12", "Under 13", "Under 14", "Under 15", "Under 16"]
const SENIOR_ORDINALS = ["1st", "2nd", "3rd"]

function ageLabelToCode(label: string): string {
  return `U${label.replace("Under ", "")}`
}

/**
 * The INITIAL, bootstrap/seed catalogue -- exactly the 24 rows
 * `20260904200000_canonical_team_catalogue.sql` seeds `canonical_team_types`
 * with. This is deliberately hardcoded once, here, matching the migration's
 * own seed data -- but it is NOT the live source of truth for any UI
 * anymore. Use `loadTeamCategoryGroups()` (queries `canonical_team_types`
 * live) everywhere a real catalogue is needed; a Site Admin adding a 25th
 * global type (via the Team Directory, 20260904500000) appears automatically
 * to every consumer of that live query with zero code changes -- it would
 * NOT appear here, since this constant is only ever read as the documented
 * initial bootstrap set (or a last-resort fallback if the live query
 * itself fails).
 */
export const BOOTSTRAP_TEAM_CATEGORY_GROUPS: TeamCategoryGroup[] = [
  {
    label: "Mini & youth",
    options: MINI_YOUTH_AGES.map((label) => {
      const code = ageLabelToCode(label)
      return {
        key: code.toLowerCase(),
        label,
        compactLabel: code,
        category: "youth" as const,
        ageGroup: code,
        gender: "mixed" as const,
        fixedSquadDesignation: null,
        allowAdditionalSquads: true,
      }
    }),
  },
  {
    label: "Youth",
    options: YOUTH_AGES.map((label) => {
      const code = ageLabelToCode(label)
      return {
        key: code.toLowerCase(),
        label,
        compactLabel: code,
        category: "youth" as const,
        ageGroup: code,
        gender: "boys" as const,
        fixedSquadDesignation: null,
        allowAdditionalSquads: true,
      }
    }),
  },
  {
    label: "Colts",
    options: [
      { key: "junior_colts", label: "Junior Colts", ageGroup: "JuniorColts" },
      { key: "senior_colts", label: "Senior Colts", ageGroup: "SeniorColts" },
    ].map((c) => ({
      key: c.key,
      label: c.label,
      compactLabel: c.label,
      category: "colts" as const,
      ageGroup: c.ageGroup,
      gender: null,
      fixedSquadDesignation: null,
      allowAdditionalSquads: false,
    })),
  },
  {
    label: "Senior men's",
    options: SENIOR_ORDINALS.map((ordinal) => ({
      key: `mens_${ordinal.replace(/\D/g, "")}${ordinal.replace(/\d/g, "")}`,
      label: `Men's ${ordinal} Team`,
      compactLabel: `Men's ${ordinal}`,
      category: "senior" as const,
      ageGroup: null,
      gender: "mens" as const,
      fixedSquadDesignation: ordinal,
      allowAdditionalSquads: false,
    })),
  },
  {
    label: "Senior women's",
    options: SENIOR_ORDINALS.map((ordinal) => ({
      key: `womens_${ordinal.replace(/\D/g, "")}${ordinal.replace(/\d/g, "")}`,
      label: `Women's ${ordinal} Team`,
      compactLabel: `Women's ${ordinal}`,
      category: "senior" as const,
      ageGroup: null,
      gender: "womens" as const,
      fixedSquadDesignation: ordinal,
      allowAdditionalSquads: false,
    })),
  },
  {
    label: "Girls",
    options: GIRLS_AGES.map((label) => {
      const code = ageLabelToCode(label)
      return {
        key: `girls_${code.toLowerCase()}`,
        label: `${label} Girls`,
        compactLabel: `Girls ${code}`,
        category: "youth" as const,
        ageGroup: code,
        gender: "girls" as const,
        fixedSquadDesignation: null,
        allowAdditionalSquads: true,
      }
    }),
  },
]

/** The additional-squad letters offered under a ticked category, matching signup exactly (B and C only -- the base tick is the unlettered first team). */
export const ADDITIONAL_SQUAD_LETTERS = ["B", "C"] as const

type CanonicalTeamTypeRow = Pick<
  Database["public"]["Tables"]["canonical_team_types"]["Row"],
  "key" | "label" | "category" | "age_group" | "gender" | "fixed_squad_designation" | "allows_squads" | "sort_order"
>

const GROUP_ORDER = ["Mini & youth", "Youth", "Colts", "Senior men's", "Senior women's", "Girls"]

function groupLabelForRow(row: CanonicalTeamTypeRow): string {
  if (row.category === "colts") return "Colts"
  if (row.category === "senior") return row.gender === "womens" ? "Senior women's" : "Senior men's"
  if (row.gender === "girls") return "Girls"
  if (row.gender === "mixed") return "Mini & youth"
  return "Youth"
}

/**
 * The signup wizard's own display phrasing ("Under 12", "Under 12 Girls")
 * -- distinct from `canonical_team_types.label`'s compact form ("U12",
 * "Girls U12") -- derived generically from age_group/gender so a newly
 * added youth age_group needs no further code here. Senior/Colts already
 * use their own `label` verbatim for both purposes (e.g. "Men's 1st Team",
 * "Junior Colts").
 */
function signupLabelForRow(row: Pick<CanonicalTeamTypeRow, "category" | "age_group" | "gender" | "label">): string {
  if (row.category !== "youth") return row.label
  const readableAge = `Under ${row.age_group?.replace(/^U/, "") ?? ""}`
  return row.gender === "girls" ? `${readableAge} Girls` : readableAge
}

function rowToOption(row: CanonicalTeamTypeRow): TeamCategoryOption {
  return {
    key: row.key,
    label: signupLabelForRow(row),
    compactLabel: row.label,
    category: row.category as TeamCategoryOption["category"],
    ageGroup: row.age_group,
    gender: row.gender as TeamCategoryOption["gender"],
    fixedSquadDesignation: row.fixed_squad_designation,
    allowAdditionalSquads: row.allows_squads,
  }
}

/**
 * Builds the same `TeamCategoryGroup[]` shape as `BOOTSTRAP_TEAM_CATEGORY_
 * GROUPS`, but from LIVE `canonical_team_types` rows -- including any
 * global type a Site Admin has added since the initial 24 (Team Directory,
 * 20260904500000). Grouping is computed from each row's own
 * category/gender, never a hardcoded per-row list, so a new row lands in
 * the right bucket automatically.
 */
export function buildTeamCategoryGroups(rows: CanonicalTeamTypeRow[]): TeamCategoryGroup[] {
  const byGroup = new Map<string, TeamCategoryOption[]>()
  for (const row of [...rows].sort((a, b) => a.sort_order - b.sort_order)) {
    const groupLabel = groupLabelForRow(row)
    const existing = byGroup.get(groupLabel) ?? []
    existing.push(rowToOption(row))
    byGroup.set(groupLabel, existing)
  }
  const orderedLabels = [...GROUP_ORDER, ...Array.from(byGroup.keys()).filter((l) => !GROUP_ORDER.includes(l))]
  return orderedLabels.filter((label) => byGroup.has(label)).map((label) => ({ label, options: byGroup.get(label)! }))
}

/**
 * Fetches the LIVE catalogue from `canonical_team_types` -- the one
 * function every server-rendered catalogue consumer (Add Team, Edit Team,
 * claim/signup) should call instead of reading
 * `BOOTSTRAP_TEAM_CATEGORY_GROUPS` directly, so a Site-Admin-added global
 * type appears everywhere with zero further code changes. Falls back to
 * the bootstrap set only if the query itself fails (never silently drops
 * to an empty picker).
 *
 * Defaults to ACTIVE-only (what Add Team and signup should ever OFFER for
 * a brand-new identity). Pass `includeInactive: true` for a context that
 * needs to represent an EXISTING team's own identity even after its
 * global type was later deactivated -- Edit Team's `findOptionForFields`
 * lookup, specifically -- otherwise a perfectly intact, still-active club
 * team would wrongly show "doesn't match the standard list" the moment a
 * Site Admin deactivates its type, even though deactivation explicitly
 * guarantees existing club-team history is untouched.
 */
export async function loadTeamCategoryGroups(supabase: SupabaseClient<Database>, options?: { includeInactive?: boolean }): Promise<TeamCategoryGroup[]> {
  let query = supabase
    .from("canonical_team_types")
    .select("key, label, category, age_group, gender, fixed_squad_designation, allows_squads, sort_order")
    .order("sort_order")
  if (!options?.includeInactive) query = query.eq("is_active", true)
  const { data, error } = await query
  if (error || !data) return BOOTSTRAP_TEAM_CATEGORY_GROUPS
  return buildTeamCategoryGroups(data)
}

export function resolveStructuredFields(option: TeamCategoryOption, squadLetter: string | null): CompactLabelInput & { squadDesignation: string | null } {
  const squadDesignation = option.fixedSquadDesignation ?? (squadLetter || null)
  return {
    category: option.category,
    ageGroup: option.ageGroup,
    gender: option.gender,
    squadDesignation,
  }
}

/**
 * The signup claim step's checklist shape ({label, categories, allowMultiple})
 * derived from a live (or bootstrap) `TeamCategoryGroup[]` rather than
 * duplicated -- signup ticks a category label (e.g. "Under 12 Girls") and,
 * separately, B/C letters; it never needs the structured fields directly
 * (those are resolved once a real `teams` row is created via
 * `internal.seed_teams_from_proposal`), so this view only needs the label
 * list.
 */
export function toSignupTeamCategoryGroups(groups: TeamCategoryGroup[]): { label: string; categories: string[]; allowMultiple: boolean }[] {
  return groups.map((group) => ({
    label: group.label,
    categories: group.options.map((o) => o.label),
    allowMultiple: group.options[0]?.allowAdditionalSquads ?? false,
  }))
}

export function findCategoryOption(groups: TeamCategoryGroup[], label: string): TeamCategoryOption | null {
  for (const group of groups) {
    const found = group.options.find((o) => o.label === label)
    if (found) return found
  }
  return null
}

export function findCategoryOptionByKey(groups: TeamCategoryGroup[], key: string): TeamCategoryOption | null {
  for (const group of groups) {
    const found = group.options.find((o) => o.key === key)
    if (found) return found
  }
  return null
}

/**
 * Reverse lookup for Edit Team: given an existing row's own category/
 * age_group/gender, find the matching catalog option (to preselect it) and
 * the squad letter that reproduces its current squad_designation, if any.
 * A team whose fields don't match any canonical option (a legacy or
 * test-fixture row, e.g. squad_designation values outside B/C) returns
 * null -- Edit Team then requires picking a real option before saving,
 * which is the intended, gentle forcing function back onto the locked
 * list rather than silently preserving an off-catalog combination forever.
 */
export function findOptionForFields(
  groups: TeamCategoryGroup[],
  fields: {
    category: string
    ageGroup: string | null
    gender: string | null
    squadDesignation: string | null
  }
): { option: TeamCategoryOption; squadLetter: string | null } | null {
  for (const group of groups) {
    const candidates = group.options.filter((o) => o.category === fields.category && o.ageGroup === fields.ageGroup && o.gender === fields.gender)
    if (candidates.length === 0) continue
    if (candidates[0].category === "colts") return { option: candidates[0], squadLetter: null }
    if (candidates[0].allowAdditionalSquads) {
      const letter = fields.squadDesignation
      if (letter !== null && !(ADDITIONAL_SQUAD_LETTERS as readonly string[]).includes(letter)) return null
      return { option: candidates[0], squadLetter: letter }
    }
    // Senior group: several options share category/gender but differ by
    // ordinal (1st/2nd/3rd) -- the row's squad_designation must match one
    // of them exactly, not just fall through to the first.
    const exact = candidates.find((o) => o.fixedSquadDesignation === fields.squadDesignation)
    return exact ? { option: exact, squadLetter: null } : null
  }
  return null
}

// ============================================================
// Add Team availability -- the closed catalogue plus "which of the 24
// does this specific club not yet have" (never re-offer an identity the
// club already has active; route an inactive/folded one to reactivation;
// gate B/C behind their primary squad actually being active first).
// ============================================================

export interface ExistingClubTeam {
  canonicalTypeKey: string | null
  squadDesignation: string | null
  active: boolean
  teamId: string
}

export type SquadAvailability =
  | { state: "addable" }
  | { state: "active"; teamId: string }
  | { state: "inactive"; teamId: string }
  | { state: "blocked_primary_inactive" }

export interface TeamOptionAvailability {
  option: TeamCategoryOption
  primary: SquadAvailability
  /** Only meaningful when option.allowAdditionalSquads; keyed by "B"/"C". */
  additionalSquads: Record<string, SquadAvailability>
}

/**
 * Pure function (no DB access) so it can be unit-tested and reused
 * identically between the server action that validates a submission and
 * the page that renders what to offer -- one algorithm, not two.
 */
export function computeTeamAvailability(groups: TeamCategoryGroup[], existingTeams: ExistingClubTeam[]): TeamOptionAvailability[] {
  return groups.flatMap((group) =>
    group.options.map((option) => {
      const forThisType = existingTeams.filter((t) => t.canonicalTypeKey === option.key)
      const primaryRow = forThisType.find((t) => normalizedSquad(t.squadDesignation) === null)
      const primary: SquadAvailability = primaryRow
        ? primaryRow.active
          ? { state: "active", teamId: primaryRow.teamId }
          : { state: "inactive", teamId: primaryRow.teamId }
        : { state: "addable" }

      const additionalSquads: Record<string, SquadAvailability> = {}
      if (option.allowAdditionalSquads) {
        const primaryIsActive = primaryRow?.active === true
        for (const letter of ADDITIONAL_SQUAD_LETTERS) {
          const row = forThisType.find((t) => t.squadDesignation === letter)
          if (row) {
            additionalSquads[letter] = row.active ? { state: "active", teamId: row.teamId } : { state: "inactive", teamId: row.teamId }
          } else {
            additionalSquads[letter] = primaryIsActive ? { state: "addable" } : { state: "blocked_primary_inactive" }
          }
        }
      }

      return { option, primary, additionalSquads }
    })
  )
}
