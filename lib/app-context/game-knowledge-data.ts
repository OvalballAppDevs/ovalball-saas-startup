import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type { GameConcept, GameConceptPosition, GameConceptRegulatoryFact, GameConceptRelatedLink, GameConceptSkill, GameKnowledgeBundle } from "./game-knowledge-types"

export type {
  RugbyCode,
  GameConceptPosition,
  GameConceptSkill,
  GameConceptRegulatoryFact,
  GameConceptRelatedLink,
  GameConcept,
  GameKnowledgeBundle,
} from "./game-knowledge-types"
export { findConceptByKey, journeySteps, groupConceptsByFamily, CONCEPT_FAMILY_LABEL, conceptRugbyCodeLabel } from "./game-knowledge-types"

/**
 * Game Knowledge data layer. Reuses the existing general-knowledge content
 * graph exactly as it stands -- hub_content_items (content_type
 * 'GAME_CONCEPT'), hub_content_relationships (CONCEPT_RELATED /
 * RELATED_KNOWLEDGE -- the latter already existed for exactly this: a
 * concept related to non-concept content, e.g. a skill's own regulatory
 * note), hub_skill_content_links (concept <-> skill, already generic),
 * hub_content_item_positions (concept <-> position, the one new junction
 * this slice added), hub_regulatory_fact_references (concept <-> real
 * VERIFIED fact). One call fetches the whole bundle in a fixed small
 * number of queries regardless of concept count -- the same shape as
 * getSkillsExplorerBundle.
 */
export async function getGameKnowledgeBundle(supabase: SupabaseClient<Database>): Promise<GameKnowledgeBundle> {
  const { data: rows } = await supabase
    .from("hub_content_items")
    .select("*")
    .eq("content_type", "GAME_CONCEPT")
    .eq("status", "PUBLISHED")
    .order("journey_order", { ascending: true })

  const concepts: GameConcept[] = (rows ?? []).map((r) => ({
    id: r.id,
    contentKey: r.content_key,
    title: r.title,
    summary: r.summary,
    rugbyCode: r.rugby_code as GameConcept["rugbyCode"],
    conceptFamily: r.concept_family ?? "FUNDAMENTALS",
    journeyOrder: r.journey_order,
    whyItMatters: r.why_it_matters,
    whatHappens: r.what_happens,
    whatToWatchFor: r.what_to_watch_for,
    whatHappensNext: r.what_happens_next,
    unionLeagueDifference: r.union_league_difference,
  }))

  const conceptIds = concepts.map((c) => c.id)
  if (conceptIds.length === 0) {
    return { concepts, positionsByConcept: new Map(), skillsByConcept: new Map(), relatedByConcept: new Map(), regulatoryFactsByConcept: new Map() }
  }

  const [{ data: positionLinkRows }, { data: skillLinkRows }, { data: relationshipRows }] = await Promise.all([
    supabase.from("hub_content_item_positions").select("content_item_id, hub_positions(id, position_key, rugby_code, display_name, shirt_number)").in("content_item_id", conceptIds),
    supabase.from("hub_skill_content_links").select("content_item_id, hub_skills(id, skill_key, display_name)").in("content_item_id", conceptIds),
    supabase.from("hub_content_relationships").select("content_item_id, related_content_item_id, relationship_type").in("content_item_id", conceptIds),
  ])

  const positionsByConcept = new Map<string, GameConceptPosition[]>()
  for (const row of (positionLinkRows ?? []) as unknown as {
    content_item_id: string
    hub_positions: { id: string; position_key: string; rugby_code: string; display_name: string; shirt_number: number | null } | null
  }[]) {
    if (!row.hub_positions) continue
    const list = positionsByConcept.get(row.content_item_id) ?? []
    list.push({
      positionId: row.hub_positions.id,
      positionKey: row.hub_positions.position_key,
      rugbyCode: row.hub_positions.rugby_code as "union" | "league",
      displayName: row.hub_positions.display_name,
      shirtNumber: row.hub_positions.shirt_number,
    })
    positionsByConcept.set(row.content_item_id, list)
  }

  const skillsByConcept = new Map<string, GameConceptSkill[]>()
  for (const row of (skillLinkRows ?? []) as unknown as { content_item_id: string; hub_skills: { id: string; skill_key: string; display_name: string } | null }[]) {
    if (!row.hub_skills) continue
    const list = skillsByConcept.get(row.content_item_id) ?? []
    list.push({ skillId: row.hub_skills.id, skillKey: row.hub_skills.skill_key, displayName: row.hub_skills.display_name })
    skillsByConcept.set(row.content_item_id, list)
  }

  // "Related" can point at another GAME_CONCEPT (deep-link within Game
  // Knowledge) or at ordinary content that only a skill's page actually
  // renders (e.g. the scrum/lineout concept relates to the same content
  // item the scrum-and-lineout-technique skill cites for its regulatory
  // sourcing) -- resolve both without duplicating either destination's
  // own content here.
  const relatedTargetIds = Array.from(new Set((relationshipRows ?? []).map((r) => r.related_content_item_id)))
  const conceptByContentId = new Map(concepts.map((c) => [c.id, c]))
  const nonConceptTargetIds = relatedTargetIds.filter((id) => !conceptByContentId.has(id))

  const { data: nonConceptRows } =
    nonConceptTargetIds.length > 0
      ? await supabase.from("hub_content_items").select("id, title").in("id", nonConceptTargetIds).eq("status", "PUBLISHED")
      : { data: [] as { id: string; title: string }[] }
  const { data: nonConceptSkillLinks } =
    nonConceptTargetIds.length > 0
      ? await supabase.from("hub_skill_content_links").select("content_item_id, hub_skills(skill_key)").in("content_item_id", nonConceptTargetIds)
      : { data: [] as { content_item_id: string; hub_skills: { skill_key: string } | null }[] }
  const skillKeyByNonConceptId = new Map<string, string>()
  for (const row of (nonConceptSkillLinks ?? []) as unknown as { content_item_id: string; hub_skills: { skill_key: string } | null }[]) {
    if (row.hub_skills) skillKeyByNonConceptId.set(row.content_item_id, row.hub_skills.skill_key)
  }
  const nonConceptTitleById = new Map((nonConceptRows ?? []).map((r) => [r.id, r.title]))

  const relatedByConcept = new Map<string, GameConceptRelatedLink[]>()
  for (const row of relationshipRows ?? []) {
    const target = conceptByContentId.get(row.related_content_item_id)
    let link: GameConceptRelatedLink | null = null
    if (target) {
      link = { title: target.title, href: `/rugby-hub/game/${target.contentKey}` }
    } else {
      const skillKey = skillKeyByNonConceptId.get(row.related_content_item_id)
      const title = nonConceptTitleById.get(row.related_content_item_id)
      if (skillKey && title) link = { title, href: `/rugby-hub/skills/${skillKey}` }
    }
    if (!link) continue
    const list = relatedByConcept.get(row.content_item_id) ?? []
    list.push(link)
    relatedByConcept.set(row.content_item_id, list)
  }

  const regulatoryFactsByConcept = await getRegulatoryFactsForConcepts(supabase, conceptIds)

  return { concepts, positionsByConcept, skillsByConcept, relatedByConcept, regulatoryFactsByConcept }
}

/** Same RLS reasoning as the Skills Explorer resolvers: regulatory_facts has no public-read policy, so real fact text reaches here only through the existing sanctioned get_hub_skill_content_regulatory_facts RPC -- already fully generic, not skill-specific despite its name. */
async function getRegulatoryFactsForConcepts(supabase: SupabaseClient<Database>, conceptIds: string[]): Promise<Map<string, GameConceptRegulatoryFact[]>> {
  const map = new Map<string, GameConceptRegulatoryFact[]>()
  if (conceptIds.length === 0) return map
  const results = await Promise.all(
    conceptIds.map(async (id) => {
      const { data } = await supabase.rpc("get_hub_skill_content_regulatory_facts", { p_content_item_id: id })
      return { id, facts: data ?? [] }
    })
  )
  for (const { id, facts } of results) {
    if (facts.length > 0) map.set(id, facts.map((f) => ({ factKey: f.fact_key, valueText: f.value_text })))
  }
  return map
}
