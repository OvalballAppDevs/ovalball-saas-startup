import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type { GlossaryBundle, GlossaryPosition, GlossaryRegulatoryFact, GlossaryRelatedLink, GlossarySkill, GlossaryTerm } from "./glossary-types"

export type { RugbyCode, GlossaryRelatedLink, GlossaryPosition, GlossarySkill, GlossaryRegulatoryFact, GlossaryTerm, GlossaryBundle } from "./glossary-types"
export { findTermByKey, groupTermsByLetter, rugbyCodeLabel } from "./glossary-types"

/**
 * Glossary data layer. hub_glossary_terms already existed as a complete
 * canonical table before this slice -- this reuses it exactly, plus the
 * three relationship tables this slice added (hub_glossary_content_links,
 * hub_glossary_positions, hub_glossary_skills), hub_glossary_relationships
 * (already existed), and hub_regulatory_fact_references (RULE_GLOSSARY,
 * already existed). One call fetches the whole bundle in a fixed small
 * number of batched queries regardless of term count -- the same shape as
 * getGameKnowledgeBundle / getSkillsExplorerBundle.
 */
export async function getGlossaryBundle(supabase: SupabaseClient<Database>): Promise<GlossaryBundle> {
  const { data: rows } = await supabase.from("hub_glossary_terms").select("*").eq("status", "PUBLISHED").order("display_term", { ascending: true })

  const terms: GlossaryTerm[] = (rows ?? []).map((r) => ({
    id: r.id,
    termKey: r.term_key,
    displayTerm: r.display_term,
    aliases: r.aliases ?? [],
    rugbyCode: r.rugby_code as GlossaryTerm["rugbyCode"],
    plainLanguageDefinition: r.plain_language_definition,
    detailContentItemId: r.detail_content_item_id,
  }))

  const termIds = terms.map((t) => t.id)
  if (termIds.length === 0) {
    return { terms, relatedTermsByTerm: new Map(), contentLinksByTerm: new Map(), positionsByTerm: new Map(), skillsByTerm: new Map(), regulatoryFactsByTerm: new Map(), detailLinkByTerm: new Map() }
  }

  const detailContentItemIds = terms.filter((t) => t.detailContentItemId != null).map((t) => t.detailContentItemId as string)

  const [{ data: relationshipRows }, { data: contentLinkRows }, { data: positionLinkRows }, { data: skillLinkRows }, { data: detailRows }] = await Promise.all([
    supabase.from("hub_glossary_relationships").select("glossary_term_id, related_glossary_term_id").in("glossary_term_id", termIds),
    supabase.from("hub_glossary_content_links").select("glossary_term_id, hub_content_items(id, title, content_key, content_type)").in("glossary_term_id", termIds),
    supabase.from("hub_glossary_positions").select("glossary_term_id, hub_positions(id, position_key, rugby_code, display_name)").in("glossary_term_id", termIds),
    supabase.from("hub_glossary_skills").select("glossary_term_id, hub_skills(id, skill_key, display_name)").in("glossary_term_id", termIds),
    detailContentItemIds.length > 0
      ? supabase.from("hub_content_items").select("id, title, content_key, content_type").eq("status", "PUBLISHED").in("id", detailContentItemIds)
      : Promise.resolve({ data: [] as { id: string; title: string; content_key: string; content_type: string }[] }),
  ])

  const termById = new Map(terms.map((t) => [t.id, t]))

  const relatedTermsByTerm = new Map<string, GlossaryRelatedLink[]>()
  for (const row of relationshipRows ?? []) {
    const target = termById.get(row.related_glossary_term_id)
    if (!target) continue
    const list = relatedTermsByTerm.get(row.glossary_term_id) ?? []
    list.push({ title: target.displayTerm, href: `/rugby-hub/glossary/${target.termKey}` })
    relatedTermsByTerm.set(row.glossary_term_id, list)
  }

  // A content link's destination depends on the target's own content_type --
  // GAME_CONCEPT has its own canonical route; any other hub_content_items
  // row (the rare case) is only reachable through the skill that links it,
  // exactly as game-knowledge-data.ts already resolves the same ambiguity
  // for its own "related" links. A link to a content_type this resolver
  // cannot address is dropped rather than pointed somewhere generic.
  const contentRows = (contentLinkRows ?? []) as unknown as {
    glossary_term_id: string
    hub_content_items: { id: string; title: string; content_key: string; content_type: string } | null
  }[]
  const detailItems = (detailRows ?? []) as { id: string; title: string; content_key: string; content_type: string }[]

  // Both "Related Game Knowledge" targets and a term's own detail article
  // are hub_content_items rows, so they share one destination resolver:
  // GAME_CONCEPT has its own canonical route; anything else is only
  // reachable through the skill that links it (mirrors the same ambiguity
  // game-knowledge-data.ts already resolves for its own "related" links).
  // An item this resolver cannot address is dropped rather than pointed
  // somewhere generic.
  const allContentItems = [...contentRows.map((r) => r.hub_content_items).filter((i): i is NonNullable<typeof i> => i != null), ...detailItems]
  const nonConceptIds = Array.from(new Set(allContentItems.filter((i) => i.content_type !== "GAME_CONCEPT" && i.content_type !== "OFFICIATING_CONCEPT").map((i) => i.id)))
  const { data: nonConceptSkillLinks } =
    nonConceptIds.length > 0
      ? await supabase.from("hub_skill_content_links").select("content_item_id, hub_skills(skill_key)").in("content_item_id", nonConceptIds)
      : { data: [] as { content_item_id: string; hub_skills: { skill_key: string } | null }[] }
  const skillKeyByNonConceptId = new Map<string, string>()
  for (const row of (nonConceptSkillLinks ?? []) as unknown as { content_item_id: string; hub_skills: { skill_key: string } | null }[]) {
    if (row.hub_skills) skillKeyByNonConceptId.set(row.content_item_id, row.hub_skills.skill_key)
  }

  function resolveContentItemLink(item: { id: string; title: string; content_key: string; content_type: string }): GlossaryRelatedLink | null {
    if (item.content_type === "GAME_CONCEPT") return { title: item.title, href: `/rugby-hub/game/${item.content_key}` }
    if (item.content_type === "OFFICIATING_CONCEPT") return { title: item.title, href: `/rugby-hub/officiating/${item.content_key}` }
    const skillKey = skillKeyByNonConceptId.get(item.id)
    return skillKey ? { title: item.title, href: `/rugby-hub/skills/${skillKey}` } : null
  }

  const contentLinksByTerm = new Map<string, GlossaryRelatedLink[]>()
  for (const row of contentRows) {
    const item = row.hub_content_items
    const link = item ? resolveContentItemLink(item) : null
    if (!link) continue
    const list = contentLinksByTerm.get(row.glossary_term_id) ?? []
    list.push(link)
    contentLinksByTerm.set(row.glossary_term_id, list)
  }

  const detailLinkByItemId = new Map(detailItems.map((item) => [item.id, resolveContentItemLink(item)]))
  const detailLinkByTerm = new Map<string, GlossaryRelatedLink>()
  for (const term of terms) {
    if (!term.detailContentItemId) continue
    const link = detailLinkByItemId.get(term.detailContentItemId)
    if (link) detailLinkByTerm.set(term.id, link)
  }

  const positionsByTerm = new Map<string, GlossaryPosition[]>()
  for (const row of (positionLinkRows ?? []) as unknown as {
    glossary_term_id: string
    hub_positions: { id: string; position_key: string; rugby_code: string; display_name: string } | null
  }[]) {
    if (!row.hub_positions) continue
    const list = positionsByTerm.get(row.glossary_term_id) ?? []
    list.push({ positionId: row.hub_positions.id, positionKey: row.hub_positions.position_key, rugbyCode: row.hub_positions.rugby_code as "union" | "league", displayName: row.hub_positions.display_name })
    positionsByTerm.set(row.glossary_term_id, list)
  }

  const skillsByTerm = new Map<string, GlossarySkill[]>()
  for (const row of (skillLinkRows ?? []) as unknown as { glossary_term_id: string; hub_skills: { id: string; skill_key: string; display_name: string } | null }[]) {
    if (!row.hub_skills) continue
    const list = skillsByTerm.get(row.glossary_term_id) ?? []
    list.push({ skillId: row.hub_skills.id, skillKey: row.hub_skills.skill_key, displayName: row.hub_skills.display_name })
    skillsByTerm.set(row.glossary_term_id, list)
  }

  const regulatoryFactsByTerm = await getRegulatoryFactsForTerms(supabase, termIds)

  return { terms, relatedTermsByTerm, contentLinksByTerm, positionsByTerm, skillsByTerm, regulatoryFactsByTerm, detailLinkByTerm }
}

/** Same RLS reasoning as the Game Knowledge / Skills Explorer resolvers: regulatory_facts has no public-read policy, so real fact text reaches here only through the sanctioned get_hub_glossary_term_regulatory_facts RPC. */
async function getRegulatoryFactsForTerms(supabase: SupabaseClient<Database>, termIds: string[]): Promise<Map<string, GlossaryRegulatoryFact[]>> {
  const map = new Map<string, GlossaryRegulatoryFact[]>()
  if (termIds.length === 0) return map
  const results = await Promise.all(
    termIds.map(async (id) => {
      const { data } = await supabase.rpc("get_hub_glossary_term_regulatory_facts", { p_glossary_term_id: id })
      return { id, facts: data ?? [] }
    })
  )
  for (const { id, facts } of results) {
    if (facts.length > 0) map.set(id, facts.map((f) => ({ factKey: f.fact_key, valueText: f.value_text })))
  }
  return map
}
