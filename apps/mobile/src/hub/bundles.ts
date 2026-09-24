import { useCallback } from "react"

import { getGameKnowledgeBundle, type GameKnowledgeBundle } from "@ovalball/contracts/rugby-hub/game-knowledge-data"
import { getGlossaryBundle, type GlossaryBundle } from "@ovalball/contracts/rugby-hub/glossary-data"
import { getOfficiatingBundle, type OfficiatingBundle } from "@ovalball/contracts/rugby-hub/officiating-data"
import { getCompetitionBundle, type CompetitionBundle } from "@ovalball/contracts/rugby-hub/teams-competitions-data"
import { getInternationalBundle, type InternationalBundle } from "@ovalball/contracts/rugby-hub/international-data"
import { getClubsBundle, type ClubBundle } from "@ovalball/contracts/rugby-hub/clubs-data"
import { getPeopleBundle, type PeopleBundle } from "@ovalball/contracts/rugby-hub/people-data"
import { getDevelopmentBundle, type DevelopmentBundle } from "@ovalball/contracts/rugby-hub/development-data"
import { getCoachingBundle, type CoachingBundle } from "@ovalball/contracts/rugby-hub/coaching-data"
import { getParentsBundle, type ParentsBundle } from "@ovalball/contracts/rugby-hub/parents-data"
import { getHeritageTimeline, type HeritageTimeline } from "@ovalball/contracts/rugby-hub/heritage-data"
import { getPositionExplorerBundle, type PositionExplorerBundle } from "@ovalball/contracts/rugby-hub/position-explorer-data"
import { getSkillsExplorerBundle, type SkillsExplorerBundle } from "@ovalball/contracts/rugby-hub/skills-explorer-data"

import { supabase } from "../auth/supabase"
import { useHubData, type HubData } from "./cache"
import { positionsCacheKey, skillsCacheKey } from "./cache-keys"
import { useHubIdentity } from "./identity"

/**
 * THE HUB'S READERS, EACH ONE THE WEBSITE'S.
 *
 * Every hook below calls the contracts reader the matching web page calls,
 * with the app's own authenticated client, and nothing else: no second query,
 * no reshaping, no mobile-only column. The bundle a screen renders is
 * therefore the bundle the browser renders, and a fix to a reader reaches
 * both. Identity-aware bundles (Positions, Skills) are keyed on the resolved
 * regulatory identity so a change of team re-reads them.
 */

export function useGameKnowledge(): HubData<GameKnowledgeBundle> {
  return useHubData("game", useCallback(() => getGameKnowledgeBundle(supabase), []))
}

export function useGlossary(): HubData<GlossaryBundle> {
  return useHubData("glossary", useCallback(() => getGlossaryBundle(supabase), []))
}

export function useOfficiating(): HubData<OfficiatingBundle> {
  return useHubData("officiating", useCallback(() => getOfficiatingBundle(supabase), []))
}

export function useCompetitions(): HubData<CompetitionBundle> {
  return useHubData("competitions", useCallback(() => getCompetitionBundle(supabase), []))
}

export function useInternational(): HubData<InternationalBundle> {
  return useHubData("international", useCallback(() => getInternationalBundle(supabase), []))
}

export function useClubs(): HubData<ClubBundle> {
  return useHubData("clubs", useCallback(() => getClubsBundle(supabase), []))
}

export function usePeople(): HubData<PeopleBundle> {
  return useHubData("people", useCallback(() => getPeopleBundle(supabase), []))
}

export function useDevelopment(): HubData<DevelopmentBundle> {
  return useHubData("development", useCallback(() => getDevelopmentBundle(supabase), []))
}

export function useCoaching(): HubData<CoachingBundle> {
  return useHubData("coaching", useCallback(() => getCoachingBundle(supabase), []))
}

export function useParents(): HubData<ParentsBundle> {
  return useHubData("parents", useCallback(() => getParentsBundle(supabase), []))
}

export function useHeritage(): HubData<HeritageTimeline> {
  return useHubData("story", useCallback(() => getHeritageTimeline(supabase), []))
}

/**
 * The Position Explorer for ONE code. The viewer's regulatory identity is
 * passed only when their own team's identity resolves to THIS code with a
 * direct or derived mapping -- the website's rule -- so the age-stage banner
 * is theirs when browsing their own code and absent when exploring the other.
 */
export function usePositions(code: "union" | "league"): HubData<PositionExplorerBundle> & { ownContext: boolean } {
  const { identity, loading } = useHubIdentity()
  const own = !!identity && identity.rugbyCode === code && (identity.mappingType === "DIRECT" || identity.mappingType === "DERIVED_COMPOSITE")
  const regulatoryIdentityId = own ? identity.regulatoryIdentityId : null
  const key = loading ? null : positionsCacheKey(code, regulatoryIdentityId)
  const data = useHubData(
    key,
    useCallback(() => getPositionExplorerBundle(supabase, code, regulatoryIdentityId), [code, regulatoryIdentityId])
  )
  return { ...data, ownContext: own }
}

/** The Skills Explorer, with the viewer's identity so the contact gate is the governing body's answer for THEIR age grade. */
export function useSkills(): HubData<SkillsExplorerBundle> {
  const { identity, loading } = useHubIdentity()
  const regulatoryIdentityId = identity?.regulatoryIdentityId ?? null
  const key = loading ? null : skillsCacheKey(regulatoryIdentityId)
  return useHubData(
    key,
    useCallback(() => getSkillsExplorerBundle(supabase, regulatoryIdentityId), [regulatoryIdentityId])
  )
}

/** expo-router hands a param back as a string or an array; a Hub key is always one string. */
export function oneParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return typeof value === "string" && value.length > 0 ? value : null
}

export function codeParam(value: string | string[] | undefined): "union" | "league" | null {
  const v = oneParam(value)
  return v === "union" || v === "league" ? v : null
}

export function codeFilterParam(value: string | string[] | undefined): "all" | "union" | "league" {
  return codeParam(value) ?? "all"
}

export const CODE_LABEL: Record<"union" | "league", string> = { union: "Rugby Union", league: "Rugby League" }
export const CODE_FILTERS: { value: "all" | "union" | "league"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "union", label: "Rugby Union" },
  { value: "league", label: "Rugby League" },
]
