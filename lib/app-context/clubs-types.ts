/**
 * Client-safe Famous Clubs types and pure helpers -- split from
 * clubs-data.ts ("server-only") for the same reason as every other
 * *-types.ts file in this codebase.
 */

export type { RugbyCode, TeamGender, TeamHonour, InternationalRelatedLink } from "./international-types"
export { TEAM_GENDER_LABEL, HONOUR_TYPE_LABEL, internationalRugbyCodeLabel } from "./international-types"
export type { SourceTier, TeamRoleType } from "./people-types"
export { SOURCE_TIER_LABEL, TEAM_ROLE_LABEL } from "./people-types"

import type { RugbyCode, TeamGender, TeamHonour, InternationalRelatedLink } from "./international-types"
import type { SourceTier, TeamRoleType } from "./people-types"

export interface ClubPersonLink {
  personTitle: string
  personKey: string
  roleType: TeamRoleType
  href: string
}

export interface ClubSource {
  tier: SourceTier
  title: string
  url: string | null
  retrievedOn: string | null
}

export interface FamousClub {
  id: string
  contentKey: string
  title: string
  summary: string
  body: string | null
  rugbyCode: RugbyCode
  teamGender: TeamGender | null
  aliases: string[]
}

export interface ClubBundle {
  clubs: FamousClub[]
  honoursByClub: Map<string, TeamHonour[]>
  relatedByClub: Map<string, InternationalRelatedLink[]>
  heritageByClub: Map<string, InternationalRelatedLink[]>
  peopleByClub: Map<string, ClubPersonLink[]>
  sourcesByClub: Map<string, ClubSource[]>
}

export function findClubByKey(bundle: ClubBundle, contentKey: string): FamousClub | null {
  return bundle.clubs.find((c) => c.contentKey === contentKey) ?? null
}
