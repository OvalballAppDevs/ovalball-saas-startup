import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type { OfficiatingBundle, OfficiatingConcept, OfficiatingPosition, OfficiatingRegulatoryFact, OfficiatingRelatedLink, OfficiatingSkill } from "./officiating-types"

export type { RugbyCode, OfficiatingPosition, OfficiatingSkill, OfficiatingRegulatoryFact, OfficiatingRelatedLink, OfficiatingConcept, OfficiatingBundle } from "./officiating-types"
export { findConceptByKey, groupConceptsByFamily, OFFICIATING_FAMILY_LABEL, officiatingRugbyCodeLabel } from "./officiating-types"

/**
 * Officiating data layer. Reuses the existing general-knowledge content
 * graph exactly as it stands, exactly as Game Knowledge did before it --
 * hub_content_items (content_type 'OFFICIATING_CONCEPT'),
 * hub_content_relationships (RELATED_KNOWLEDGE / CONCEPT_RELATED),
 * hub_skill_content_links, hub_content_item_positions,
 * hub_glossary_content_links, hub_regulatory_fact_references. Zero new
 * tables, zero new RPCs beyond the two already-sanctioned regulatory-fact
 * resolvers. One call fetches the whole bundle in a fixed small number of
 * batched queries regardless of concept count.
 */
export async function getOfficiatingBundle(supabase: SupabaseClient<Database>): Promise<OfficiatingBundle> {
  const { data: rows } = await supabase
    .from("hub_content_items")
    .select("*")
    .eq("content_type", "OFFICIATING_CONCEPT")
    .eq("status", "PUBLISHED")
    .order("officiating_family", { ascending: true })

  const concepts: OfficiatingConcept[] = (rows ?? []).map((r) => ({
    id: r.id,
    contentKey: r.content_key,
    title: r.title,
    summary: r.summary,
    rugbyCode: r.rugby_code as OfficiatingConcept["rugbyCode"],
    officiatingFamily: r.officiating_family ?? "MATCH_OFFICIALS",
    whyItMatters: r.why_it_matters,
    whatHappens: r.what_happens,
    whatToWatchFor: r.what_to_watch_for,
    whatHappensNext: r.what_happens_next,
    unionLeagueDifference: r.union_league_difference,
    howItIsSignalled: r.how_it_is_signalled,
    commonMisunderstanding: r.common_misunderstanding,
  }))

  const conceptIds = concepts.map((c) => c.id)
  if (conceptIds.length === 0) {
    return { concepts, positionsByConcept: new Map(), skillsByConcept: new Map(), relatedByConcept: new Map(), glossaryByConcept: new Map(), regulatoryFactsByConcept: new Map() }
  }

  const [{ data: positionLinkRows }, { data: skillLinkRows }, { data: relationshipRows }, { data: glossaryLinkRows }] = await Promise.all([
    supabase.from("hub_content_item_positions").select("content_item_id, hub_positions(id, position_key, rugby_code, display_name)").in("content_item_id", conceptIds),
    supabase.from("hub_skill_content_links").select("content_item_id, hub_skills(id, skill_key, display_name)").in("content_item_id", conceptIds),
    supabase.from("hub_content_relationships").select("content_item_id, related_content_item_id, relationship_type").in("content_item_id", conceptIds),
    supabase.from("hub_glossary_content_links").select("content_item_id, hub_glossary_terms(term_key, display_term, status)").in("content_item_id", conceptIds),
  ])

  const positionsByConcept = new Map<string, OfficiatingPosition[]>()
  for (const row of (positionLinkRows ?? []) as unknown as { content_item_id: string; hub_positions: { id: string; position_key: string; rugby_code: string; display_name: string } | null }[]) {
    if (!row.hub_positions) continue
    const list = positionsByConcept.get(row.content_item_id) ?? []
    list.push({ positionId: row.hub_positions.id, positionKey: row.hub_positions.position_key, rugbyCode: row.hub_positions.rugby_code as "union" | "league", displayName: row.hub_positions.display_name })
    positionsByConcept.set(row.content_item_id, list)
  }

  const skillsByConcept = new Map<string, OfficiatingSkill[]>()
  for (const row of (skillLinkRows ?? []) as unknown as { content_item_id: string; hub_skills: { id: string; skill_key: string; display_name: string } | null }[]) {
    if (!row.hub_skills) continue
    const list = skillsByConcept.get(row.content_item_id) ?? []
    list.push({ skillId: row.hub_skills.id, skillKey: row.hub_skills.skill_key, displayName: row.hub_skills.display_name })
    skillsByConcept.set(row.content_item_id, list)
  }

  const glossaryByConcept = new Map<string, OfficiatingRelatedLink[]>()
  for (const row of (glossaryLinkRows ?? []) as unknown as { content_item_id: string; hub_glossary_terms: { term_key: string; display_term: string; status: string } | null }[]) {
    if (!row.hub_glossary_terms || row.hub_glossary_terms.status !== "PUBLISHED") continue
    const list = glossaryByConcept.get(row.content_item_id) ?? []
    list.push({ title: row.hub_glossary_terms.display_term, href: `/rugby-hub/glossary/${row.hub_glossary_terms.term_key}` })
    glossaryByConcept.set(row.content_item_id, list)
  }

  // "Related" can point at another OFFICIATING_CONCEPT, a GAME_CONCEPT, or
  // ordinary content only reachable through the skill that links it --
  // resolves all three without duplicating any destination's own content.
  const relatedTargetIds = Array.from(new Set((relationshipRows ?? []).map((r) => r.related_content_item_id)))
  const { data: relatedContentRows } =
    relatedTargetIds.length > 0
      ? await supabase.from("hub_content_items").select("id, title, content_key, content_type").in("id", relatedTargetIds).eq("status", "PUBLISHED")
      : { data: [] as { id: string; title: string; content_key: string; content_type: string }[] }
  const relatedById = new Map((relatedContentRows ?? []).map((r) => [r.id, r]))

  const otherIds = (relatedContentRows ?? []).filter((r) => r.content_type !== "OFFICIATING_CONCEPT" && r.content_type !== "GAME_CONCEPT").map((r) => r.id)
  const { data: otherSkillLinks } =
    otherIds.length > 0 ? await supabase.from("hub_skill_content_links").select("content_item_id, hub_skills(skill_key)").in("content_item_id", otherIds) : { data: [] as { content_item_id: string; hub_skills: { skill_key: string } | null }[] }
  const skillKeyByOtherId = new Map<string, string>()
  for (const row of (otherSkillLinks ?? []) as unknown as { content_item_id: string; hub_skills: { skill_key: string } | null }[]) {
    if (row.hub_skills) skillKeyByOtherId.set(row.content_item_id, row.hub_skills.skill_key)
  }

  const relatedByConcept = new Map<string, OfficiatingRelatedLink[]>()
  for (const row of relationshipRows ?? []) {
    const target = relatedById.get(row.related_content_item_id)
    if (!target) continue
    let link: OfficiatingRelatedLink | null = null
    if (target.content_type === "OFFICIATING_CONCEPT") link = { title: target.title, href: `/rugby-hub/officiating/${target.content_key}` }
    else if (target.content_type === "GAME_CONCEPT") link = { title: target.title, href: `/rugby-hub/game/${target.content_key}` }
    else {
      const skillKey = skillKeyByOtherId.get(target.id)
      if (skillKey) link = { title: target.title, href: `/rugby-hub/skills/${skillKey}` }
    }
    if (!link) continue
    const list = relatedByConcept.get(row.content_item_id) ?? []
    list.push(link)
    relatedByConcept.set(row.content_item_id, list)
  }

  const regulatoryFactsByConcept = await getRegulatoryFactsForConcepts(supabase, conceptIds)

  return { concepts, positionsByConcept, skillsByConcept, relatedByConcept, glossaryByConcept, regulatoryFactsByConcept }
}

/** Same RLS reasoning as every other Rugby Hub resolver: regulatory_facts has no public-read policy, so real fact text reaches here only through the existing sanctioned get_hub_skill_content_regulatory_facts RPC -- already fully generic, keyed by content_item_id, not skill-specific despite its name. */
async function getRegulatoryFactsForConcepts(supabase: SupabaseClient<Database>, conceptIds: string[]): Promise<Map<string, OfficiatingRegulatoryFact[]>> {
  const map = new Map<string, OfficiatingRegulatoryFact[]>()
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
