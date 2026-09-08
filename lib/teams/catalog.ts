import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { CompactLabelInput } from "./compact-label"
import { fullTeamLabel, normalizedSquad } from "./compact-label"
import { DIRECTORY_GROUPS, groupKeyFor } from "./directory-taxonomy"

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
/**
 * Local alias rather than an import: `lib/signup/types.ts` re-exports from
 * THIS module, so importing its `RugbyCode` back would be circular. Several
 * other modules define the same two-member union for the same reason.
 */
export type RugbyCode = "union" | "league"

export const RUGBY_CODES: readonly RugbyCode[] = ["union", "league"] as const

export interface TeamCategoryOption {
  /** Matches canonical_team_types.key exactly (e.g. "u12", "girls_u12", "junior_colts", "mens_1st"). */
  key: string
  /**
   * The rugby codes this identity may be offered for as a NEW team.
   *
   * The catalogue is one shared list across both codes, but the codes do not
   * regulate the same age grades. RFU Regulation 15.6 defines girls' union
   * rugby as four dual age bands (U12/U11, U14/U13, U16/U15, U18/U17), so
   * Girls U13 and Girls U15 are not union identities -- while the RFL's girls
   * structure has never been established, so they stay offerable in league.
   *
   * Sourced from `canonical_team_types_by_code.is_offered`, which resolves
   * `regulatory_team_type_mappings.mapping_state = 'NOT_OFFERED'` per code.
   * Positive default: anything not explicitly withheld is offered, so an
   * unresearched combination is never silently narrowed.
   */
  offeredForCodes: RugbyCode[]
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

/**
 * There is deliberately NO hardcoded team catalogue in this file.
 *
 * A `BOOTSTRAP_TEAM_CATEGORY_GROUPS` constant used to live here, mirroring the
 * migration's seed rows and standing in as a last-resort fallback if the live
 * query failed. It was removed because it had become a genuine second source
 * of truth and had already drifted: it still listed the girls single-year
 * grades that Rugby Union does not offer, and knew nothing of U17, U18, U19,
 * Men's Open Age or Women's Open Age.
 *
 * A stale fallback is worse than none. Offering a Union club "Girls U13"
 * because a hardcoded array said so produces a confusing failure at insert
 * time, when the database correctly refuses it. So `loadTeamCategoryGroups`
 * now FAILS CLOSED and returns an empty catalogue if it cannot read the live
 * one -- callers show an honest "catalogue unavailable" state rather than a
 * wrong menu.
 *
 * The canonical Team Directory (`canonical_team_types` projected per code
 * through `canonical_team_types_by_code`) is the only authority for what team
 * identities exist and which code may be offered them.
 */

/** The additional-squad letters offered under a ticked category, matching signup exactly (B and C only -- the base tick is the unlettered first team). */
export const ADDITIONAL_SQUAD_LETTERS = ["B", "C"] as const

type CanonicalTeamTypeRow = Pick<
  Database["public"]["Tables"]["canonical_team_types"]["Row"],
  "key" | "label" | "category" | "age_group" | "gender" | "fixed_squad_designation" | "allows_squads" | "sort_order"
>

// The SAME grouping Site Admin's Team Directory and a club's own Teams page
// use. Add Team previously had its own third set of headings ("Mini & youth",
// "Senior men's"), so a club saw its side filed under one word here and a
// different word two screens away.
const GROUP_ORDER = DIRECTORY_GROUPS.filter((g) => g.key !== "retired").map((g) => g.title)

function groupLabelForRow(row: CanonicalTeamTypeRow): string {
  const key = groupKeyFor({
    id: row.key,
    category: row.category,
    ageGroup: row.age_group,
    gender: row.gender,
    squadDesignation: row.fixed_squad_designation,
    isActive: true,
    sortOrder: row.sort_order ?? 0,
  })
  return DIRECTORY_GROUPS.find((g) => g.key === key)?.title ?? "Youth"
}

/**
 * The signup wizard shows a team by its display name, like everywhere else.
 *
 * It used to write its own phrasing here ("Under 12", "Under 12 Girls"), which
 * made signup a fourth place the naming rules lived. It now derives from the
 * same structured identity as every other surface, so a change to the standard
 * reaches signup without anyone remembering this function exists.
 */
function signupLabelForRow(
  row: Pick<CanonicalTeamTypeRow, "category" | "age_group" | "gender" | "label" | "fixed_squad_designation">,
  rugbyCode?: RugbyCode
): string {
  return fullTeamLabel({
    category: row.category,
    ageGroup: row.age_group,
    gender: row.gender,
    squadDesignation: row.fixed_squad_designation,
    rugbyCode: rugbyCode ?? null,
  })
}

function rowToOption(row: CanonicalTeamTypeRow, offeredForCodes: RugbyCode[], rugbyCode?: RugbyCode): TeamCategoryOption {
  return {
    key: row.key,
    label: signupLabelForRow(row, rugbyCode),
    compactLabel: row.label,
    category: row.category as TeamCategoryOption["category"],
    ageGroup: row.age_group,
    gender: row.gender as TeamCategoryOption["gender"],
    fixedSquadDesignation: row.fixed_squad_designation,
    allowAdditionalSquads: row.allows_squads,
    offeredForCodes,
  }
}

/**
 * Narrows a catalogue to the identities a club of one code may be offered.
 *
 * Pure and exported so the SAME rule runs in the two places that need it at
 * different moments: server pages that already know the club's code filter on
 * load, while the signup wizard cannot -- it fetches the catalogue
 * anonymously before the visitor has picked a code, so it holds every option
 * and filters here once `rugbyCode` is chosen in the client. One rule, two
 * call sites, no second round trip.
 *
 * Groups left with no options are dropped, so a picker never renders an empty
 * "Girls" heading.
 */
export function filterGroupsForCode(groups: TeamCategoryGroup[], rugbyCode: RugbyCode): TeamCategoryGroup[] {
  return groups
    .map((group) => ({ ...group, options: group.options.filter((o) => o.offeredForCodes.includes(rugbyCode)) }))
    .filter((group) => group.options.length > 0)
}

/**
 * Builds the same `TeamCategoryGroup[]` shape as `BOOTSTRAP_TEAM_CATEGORY_
 * GROUPS`, but from LIVE `canonical_team_types` rows -- including any
 * global type a Site Admin has added since the initial 24 (Team Directory,
 * 20260904500000). Grouping is computed from each row's own
 * category/gender, never a hardcoded per-row list, so a new row lands in
 * the right bucket automatically.
 */
export function buildTeamCategoryGroups(
  rows: CanonicalTeamTypeRow[],
  offeredByKey?: Map<string, RugbyCode[]>,
  // Senior naming differs by code -- union numbers its sides, league runs Open
  // Age -- so a catalogue built without a code names a league club's senior
  // side "Men's 1st Team". The code is threaded through rather than guessed.
  rugbyCode?: RugbyCode
): TeamCategoryGroup[] {
  const byGroup = new Map<string, TeamCategoryOption[]>()
  for (const row of [...rows].sort((a, b) => a.sort_order - b.sort_order)) {
    const groupLabel = groupLabelForRow(row)
    const existing = byGroup.get(groupLabel) ?? []
    // Positive default when availability is unknown: offered for both codes.
    // A missing entry must never be read as "withheld" -- silence narrowing
    // availability is the exact failure this whole design exists to prevent.
    existing.push(rowToOption(row, offeredByKey?.get(row.key) ?? [...RUGBY_CODES], rugbyCode))
    byGroup.set(groupLabel, existing)
  }
  const orderedLabels = [...GROUP_ORDER, ...Array.from(byGroup.keys()).filter((l) => !GROUP_ORDER.includes(l))]
  return orderedLabels.filter((label) => byGroup.has(label)).map((label) => ({ label, options: byGroup.get(label)! }))
}

/**
 * Fetches the LIVE catalogue from `canonical_team_types` -- the one
 * function every server-rendered catalogue consumer (Add Team, Edit Team,
 * claim/signup) should call instead of reading
 * a hardcoded list, so a Site-Admin-added global type appears everywhere
 * with zero further code changes. Returns an empty catalogue if the query
 * fails -- see the note above on why this fails closed.
 *
 * Defaults to ACTIVE-only (what Add Team and signup should ever OFFER for
 * a brand-new identity). Pass `includeInactive: true` for a context that
 * needs to represent an EXISTING team's own identity even after its
 * global type was later deactivated -- Edit Team's `findOptionForFields`
 * lookup, specifically -- otherwise a perfectly intact, still-active club
 * team would wrongly show "doesn't match the standard list" the moment a
 * Site Admin deactivates its type, even though deactivation explicitly
 * guarantees existing club-team history is untouched.
 *
 * Pass `rugbyCode` to get only what THAT code may offer. Availability comes
 * from `canonical_team_types_by_code`, which resolves
 * `regulatory_team_type_mappings.mapping_state = 'NOT_OFFERED'` per code --
 * so union does not offer Girls U13/U15 (RFU Regulation 15.6 dual age bands)
 * while league still does (the RFL structure is unresearched, and absence of
 * research is not evidence of absence).
 *
 * `includeInactive: true` deliberately ALSO ignores per-code offering: that
 * mode exists to represent identities that already exist, and an existing
 * team must keep resolving even on a type its code no longer offers. Do not
 * combine it with `rugbyCode` expecting a filtered list.
 */
export async function loadTeamCategoryGroups(
  supabase: SupabaseClient<Database>,
  options?: { includeInactive?: boolean; rugbyCode?: RugbyCode }
): Promise<TeamCategoryGroup[]> {
  let query = supabase
    .from("canonical_team_types")
    .select("key, label, category, age_group, gender, fixed_squad_designation, allows_squads, sort_order")
    .order("sort_order")
  if (!options?.includeInactive) query = query.eq("is_active", true)
  const { data, error } = await query
  // Fail closed. A wrong catalogue is worse than no catalogue: it offers
  // identities the club's code cannot use, which the database then refuses.
  if (error || !data) return []

  // Per-code availability, in one extra read. If this fails we fall back to
  // "offered for both codes" rather than to an empty catalogue -- the DB
  // trigger on teams is the real enforcement point, so a degraded picker
  // shows too much rather than too little, and the insert is still refused.
  const { data: availability } = await supabase.from("canonical_team_types_by_code").select("key, rugby_code, is_offered")
  const offeredByKey = new Map<string, RugbyCode[]>()
  for (const row of availability ?? []) {
    // View columns type as nullable even though the underlying expressions
    // never are; skip rather than coerce, so a genuinely null row could only
    // ever widen availability, never narrow it.
    if (!row.is_offered || !row.key || !row.rugby_code) continue
    const existing = offeredByKey.get(row.key) ?? []
    existing.push(row.rugby_code as RugbyCode)
    offeredByKey.set(row.key, existing)
  }

  const groups = buildTeamCategoryGroups(data, availability && availability.length > 0 ? offeredByKey : undefined, options?.rugbyCode)
  return options?.rugbyCode && !options.includeInactive ? filterGroupsForCode(groups, options.rugbyCode) : groups
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
