/**
 * Client-safe International Rugby types and pure helpers -- split from
 * international-data.ts ("server-only") for the same reason as every
 * other *-types.ts file in this codebase.
 */

export type RugbyCode = "union" | "league"
export type TeamType = "NATIONAL_TEAM" | "REPRESENTATIVE_TEAM" | "CLUB_TEAM"
export type TeamGender = "mens" | "womens" | "mixed"

export const TEAM_TYPE_LABEL: Record<TeamType, string> = {
  NATIONAL_TEAM: "National Team",
  REPRESENTATIVE_TEAM: "Representative Team",
  CLUB_TEAM: "Club",
}

export const TEAM_GENDER_LABEL: Record<TeamGender, string> = {
  mens: "Men's",
  womens: "Women's",
  mixed: "Mixed",
}

export const HONOUR_TYPE_LABEL: Record<string, string> = {
  CHAMPION: "Champions",
  RUNNER_UP: "Runners-up",
  GRAND_SLAM: "Grand Slam",
  TRIPLE_CROWN: "Triple Crown",
}

export interface InternationalRelatedLink {
  title: string
  href: string
}

export interface InternationalTeam {
  id: string
  contentKey: string
  title: string
  summary: string
  body: string | null
  rugbyCode: RugbyCode
  teamType: TeamType
  teamGender: TeamGender | null
  sourceNote: string | null
  sourceUrl: string | null
  sourceRetrievedOn: string | null
}

export interface TeamHonour {
  id: string
  competitionTitle: string
  competitionKey: string
  honourType: string
  yearLabel: string
  notes: string | null
  sourceNote: string | null
  sourceUrl: string | null
  sourceRetrievedOn: string | null
}

export interface InternationalCompetition {
  id: string
  contentKey: string
  title: string
  summary: string
  body: string | null
  rugbyCode: RugbyCode | null
}

export interface InternationalBundle {
  teams: InternationalTeam[]
  competitions: InternationalCompetition[]
  honoursByTeam: Map<string, TeamHonour[]>
  relatedByTeam: Map<string, InternationalRelatedLink[]>
  relatedByCompetition: Map<string, InternationalRelatedLink[]>
  heritageByContentItem: Map<string, InternationalRelatedLink[]>
}

export function findTeamByKey(bundle: InternationalBundle, contentKey: string): InternationalTeam | null {
  return bundle.teams.find((t) => t.contentKey === contentKey) ?? null
}

export function findCompetitionByKey(bundle: InternationalBundle, contentKey: string): InternationalCompetition | null {
  return bundle.competitions.find((c) => c.contentKey === contentKey) ?? null
}

export function internationalRugbyCodeLabel(code: RugbyCode | null): string | null {
  if (code === "union") return "Rugby Union"
  if (code === "league") return "Rugby League"
  return null
}
