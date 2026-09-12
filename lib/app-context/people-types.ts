/**
 * Client-safe People & Rugby Legends types and pure helpers -- split from
 * people-data.ts ("server-only") for the same reason as every other
 * *-types.ts file in this codebase.
 */

export type PersonRole = "PLAYER" | "COACH" | "REFEREE" | "ADMINISTRATOR" | "PIONEER"
export type TeamRoleType = "PLAYED_FOR" | "CAPTAINED" | "COACHED" | "REPRESENTED"
export type HonourRoleType = "CAPTAIN" | "PLAYER" | "HEAD_COACH"
export type SourceTier = "GOVERNING_BODY" | "MUSEUM_OR_ARCHIVE" | "ACADEMIC" | "ENCYCLOPEDIA" | "POPULAR_HISTORY" | "CONTEMPORARY_REPORT"

export const ROLE_LABEL: Record<PersonRole, string> = {
  PLAYER: "Player",
  COACH: "Coach",
  REFEREE: "Referee",
  ADMINISTRATOR: "Administrator",
  PIONEER: "Pioneer",
}

export const TEAM_ROLE_LABEL: Record<TeamRoleType, string> = {
  PLAYED_FOR: "Played for",
  CAPTAINED: "Captained",
  COACHED: "Coached",
  REPRESENTED: "Represented",
}

export const HONOUR_ROLE_LABEL: Record<HonourRoleType, string> = {
  CAPTAIN: "Captain",
  PLAYER: "Player",
  HEAD_COACH: "Head Coach",
}

export const SOURCE_TIER_LABEL: Record<SourceTier, string> = {
  GOVERNING_BODY: "Governing body",
  MUSEUM_OR_ARCHIVE: "Museum or archive",
  ACADEMIC: "Academic",
  ENCYCLOPEDIA: "Encyclopedia",
  POPULAR_HISTORY: "Popular history",
  CONTEMPORARY_REPORT: "Contemporary report",
}

export interface PersonRelatedLink {
  title: string
  href: string
}

export interface PersonTeamLink {
  teamTitle: string
  teamKey: string
  roleType: TeamRoleType
  notes: string | null
}

export interface PersonHonour {
  competitionTitle: string
  competitionKey: string
  teamTitle: string
  teamKey: string
  honourType: string
  yearLabel: string
  roleType: HonourRoleType
  notes: string | null
}

export interface PersonSource {
  tier: SourceTier
  title: string
  url: string | null
  retrievedOn: string | null
}

export interface RugbyPerson {
  id: string
  contentKey: string
  title: string
  summary: string
  body: string | null
  roles: PersonRole[]
  aliases: string[]
  birthYear: number | null
  deathYear: number | null
}

export interface PeopleBundle {
  people: RugbyPerson[]
  teamLinksByPerson: Map<string, PersonTeamLink[]>
  honoursByPerson: Map<string, PersonHonour[]>
  heritageByPerson: Map<string, PersonRelatedLink[]>
  sourcesByPerson: Map<string, PersonSource[]>
  relatedByPerson: Map<string, PersonRelatedLink[]>
}

export function findPersonByKey(bundle: PeopleBundle, contentKey: string): RugbyPerson | null {
  return bundle.people.find((p) => p.contentKey === contentKey) ?? null
}

/**
 * One clear display label per person for dense surfaces (search results,
 * landing cards) -- multi-role people show every role on their detail
 * page, but a search result needs a single word. Priority order matches
 * the approved instruction exactly: REFEREE first (never mistaken for a
 * player), then COACH-only, then PLAYER, then ADMINISTRATOR, then
 * PIONEER. Never "Legend" -- that stays purely editorial framing on the
 * landing page, never a taxonomy value.
 */
export function personSearchLabel(roles: PersonRole[]): string {
  if (roles.includes("REFEREE")) return ROLE_LABEL.REFEREE
  if (roles.includes("COACH") && !roles.includes("PLAYER")) return ROLE_LABEL.COACH
  if (roles.includes("PLAYER")) return ROLE_LABEL.PLAYER
  if (roles.includes("ADMINISTRATOR")) return ROLE_LABEL.ADMINISTRATOR
  if (roles.includes("PIONEER")) return ROLE_LABEL.PIONEER
  return "Rugby Person"
}

export function personYearRange(birthYear: number | null, deathYear: number | null): string | null {
  if (birthYear === null && deathYear === null) return null
  if (birthYear !== null && deathYear !== null) return `${birthYear}–${deathYear}`
  if (birthYear !== null) return `b. ${birthYear}`
  return `d. ${deathYear}`
}
