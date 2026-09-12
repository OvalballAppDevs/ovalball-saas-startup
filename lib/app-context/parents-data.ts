import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type {
  ParentFamily,
  ParentGlossaryLink,
  ParentGuide,
  ParentPositionLink,
  ParentRegulatoryFact,
  ParentRelatedLink,
  ParentSkillLink,
  ParentSource,
  ParentsBundle,
} from "./parents-types"

export type {
  RugbyCode,
  ParentFamily,
  ParentRelatedLink,
  ParentGlossaryLink,
  ParentSkillLink,
  ParentPositionLink,
  ParentRegulatoryFact,
  ParentSource,
  ParentGuide,
  ParentsBundle,
  SourceTier,
} from "./parents-types"
export {
  PARENT_FAMILY_ORDER,
  PARENT_FAMILY_LABEL,
  PARENT_FAMILY_BLURB,
  PARENT_INTENTS,
  PARENT_AUTHORITY_LINKS,
  SOURCE_TIER_LABEL,
  findParentGuideByKey,
  parentJourney,
  groupParentGuidesByFamily,
} from "./parents-types"

/**
 * Parents & Guardians data layer. Adds ZERO new tables. A parent guide is an
 * ordinary hub_content_items row (content_type 'PARENT_GUIDE', parent_family
 * set), and every relationship runs through a junction that already existed
 * and was already generic —
 *
 *   hub_content_relationships      parent guide <-> officiating / game / development / coaching / parent
 *   hub_glossary_content_links     parent guide <-> glossary term  (already used by 3 content types)
 *   hub_skill_content_links        parent guide <-> skill
 *   hub_content_item_positions     parent guide <-> position
 *   hub_regulatory_fact_references parent guide -> real VERIFIED Law
 *   hub_content_sources            provenance
 *
 * What is NOT read here, and never may be: guardians, guardian_invitations,
 * guardian_player_permissions, guardian_link_requests, players, profiles,
 * auth users, registrations, consents, medical information, emergency
 * contacts, payments, attendance, availability and messaging. This domain
 * explains rugby to an adult. It holds no record of any actual family, and
 * there is no query path by which it could.
 */
export async function getParentsBundle(supabase: SupabaseClient<Database>): Promise<ParentsBundle> {
  const { data: rows } = await supabase
    .from("hub_content_items")
    .select("*")
    .eq("content_type", "PARENT_GUIDE")
    .eq("status", "PUBLISHED")
    .order("title", { ascending: true })

  const guides: ParentGuide[] = (rows ?? []).map((r) => ({
    id: r.id,
    contentKey: r.content_key,
    title: r.title,
    summary: r.summary,
    body: r.body,
    whyItMatters: r.why_it_matters,
    family: (r.parent_family ?? "GETTING_STARTED") as ParentFamily,
    rugbyCode: r.rugby_code as ParentGuide["rugbyCode"],
    aliases: r.aliases ?? [],
    journeyOrder: r.journey_order,
  }))

  const ids = guides.map((g) => g.id)
  const empty: ParentsBundle = {
    guides,
    relatedByGuide: new Map(),
    glossaryByGuide: new Map(),
    skillsByGuide: new Map(),
    positionsByGuide: new Map(),
    regulatoryFactsByGuide: new Map(),
    sourcesByGuide: new Map(),
  }
  if (ids.length === 0) return empty

  const [{ data: outbound }, { data: inbound }, { data: glossaryRows }, { data: skillRows }, { data: positionRows }, { data: sourceRows }] = await Promise.all([
    supabase.from("hub_content_relationships").select("content_item_id, related_content_item_id").in("content_item_id", ids),
    supabase.from("hub_content_relationships").select("content_item_id, related_content_item_id").in("related_content_item_id", ids),
    supabase.from("hub_glossary_content_links").select("content_item_id, hub_glossary_terms(term_key, display_term)").in("content_item_id", ids),
    supabase.from("hub_skill_content_links").select("content_item_id, hub_skills(skill_key, display_name)").in("content_item_id", ids),
    supabase.from("hub_content_item_positions").select("content_item_id, hub_positions(position_key, rugby_code, display_name)").in("content_item_id", ids),
    supabase.from("hub_content_sources").select("content_item_id, source_tier, source_title, source_url, retrieved_on").in("content_item_id", ids),
  ])

  /** Both directions, the same decision Player Development and Coaching made: a guide that is only ever a relationship TARGET would otherwise render nothing related. */
  const relatedIds = new Map<string, Set<string>>()
  for (const row of outbound ?? []) {
    const set = relatedIds.get(row.content_item_id) ?? new Set<string>()
    set.add(row.related_content_item_id)
    relatedIds.set(row.content_item_id, set)
  }
  for (const row of inbound ?? []) {
    const set = relatedIds.get(row.related_content_item_id) ?? new Set<string>()
    set.add(row.content_item_id)
    relatedIds.set(row.related_content_item_id, set)
  }

  const targetIds = Array.from(new Set(Array.from(relatedIds.values()).flatMap((s) => Array.from(s))))
  const { data: targetRows } =
    targetIds.length > 0
      ? await supabase.from("hub_content_items").select("id, content_key, title, content_type").in("id", targetIds).eq("status", "PUBLISHED")
      : { data: [] as { id: string; content_key: string; title: string; content_type: string }[] }
  const targetById = new Map((targetRows ?? []).map((r) => [r.id, r]))

  const relatedByGuide = new Map<string, ParentRelatedLink[]>()
  for (const [guideId, set] of relatedIds) {
    const links: ParentRelatedLink[] = []
    for (const targetId of set) {
      if (targetId === guideId) continue
      const target = targetById.get(targetId)
      if (!target) continue
      const link = resolveParentRelatedLink(target)
      if (link) links.push(link)
    }
    if (links.length > 0) {
      links.sort((a, b) => a.kindLabel.localeCompare(b.kindLabel) || a.title.localeCompare(b.title))
      relatedByGuide.set(guideId, links)
    }
  }

  const glossaryByGuide = new Map<string, ParentGlossaryLink[]>()
  for (const row of (glossaryRows ?? []) as unknown as { content_item_id: string; hub_glossary_terms: { term_key: string; display_term: string } | null }[]) {
    if (!row.hub_glossary_terms) continue
    const list = glossaryByGuide.get(row.content_item_id) ?? []
    list.push({ termKey: row.hub_glossary_terms.term_key, displayTerm: row.hub_glossary_terms.display_term })
    glossaryByGuide.set(row.content_item_id, list)
  }
  for (const list of glossaryByGuide.values()) list.sort((a, b) => a.displayTerm.localeCompare(b.displayTerm))

  const skillsByGuide = new Map<string, ParentSkillLink[]>()
  for (const row of (skillRows ?? []) as unknown as { content_item_id: string; hub_skills: { skill_key: string; display_name: string } | null }[]) {
    if (!row.hub_skills) continue
    const list = skillsByGuide.get(row.content_item_id) ?? []
    list.push({ skillKey: row.hub_skills.skill_key, displayName: row.hub_skills.display_name })
    skillsByGuide.set(row.content_item_id, list)
  }

  const positionsByGuide = new Map<string, ParentPositionLink[]>()
  for (const row of (positionRows ?? []) as unknown as {
    content_item_id: string
    hub_positions: { position_key: string; rugby_code: string; display_name: string } | null
  }[]) {
    if (!row.hub_positions) continue
    const list = positionsByGuide.get(row.content_item_id) ?? []
    list.push({ positionKey: row.hub_positions.position_key, rugbyCode: row.hub_positions.rugby_code as "union" | "league", displayName: row.hub_positions.display_name })
    positionsByGuide.set(row.content_item_id, list)
  }

  const sourcesByGuide = new Map<string, ParentSource[]>()
  for (const row of (sourceRows ?? []) as unknown as {
    content_item_id: string
    source_tier: ParentSource["tier"]
    source_title: string
    source_url: string | null
    retrieved_on: string | null
  }[]) {
    const list = sourcesByGuide.get(row.content_item_id) ?? []
    list.push({ tier: row.source_tier, title: row.source_title, url: row.source_url, retrievedOn: row.retrieved_on })
    sourcesByGuide.set(row.content_item_id, list)
  }

  const regulatoryFactsByGuide = await getRegulatoryFactsForGuides(supabase, ids)

  return { guides, relatedByGuide, glossaryByGuide, skillsByGuide, positionsByGuide, regulatoryFactsByGuide, sourcesByGuide }
}

/** A parent guide points outward across five domains — each resolves to its own destination, labelled so the reader knows whose answer they are about to get. */
function resolveParentRelatedLink(target: { content_key: string; title: string; content_type: string }): ParentRelatedLink | null {
  if (target.content_type === "PARENT_GUIDE") return { title: target.title, href: `/rugby-hub/parents/${target.content_key}`, kindLabel: "For Parents" }
  if (target.content_type === "OFFICIATING_CONCEPT") return { title: target.title, href: `/rugby-hub/officiating/${target.content_key}`, kindLabel: "Officiating" }
  if (target.content_type === "GAME_CONCEPT") return { title: target.title, href: `/rugby-hub/game/${target.content_key}`, kindLabel: "How the game works" }
  if (target.content_type === "PLAYER_DEVELOPMENT_CONCEPT") return { title: target.title, href: `/rugby-hub/development/${target.content_key}`, kindLabel: "Player Development" }
  if (target.content_type === "COACHING_CONCEPT") return { title: target.title, href: `/rugby-hub/coaching/${target.content_key}`, kindLabel: "Coaching" }
  return null
}

/** Same RLS reasoning as every other Hub domain: regulatory_facts has no public-read policy, so real Law text reaches here only through the existing sanctioned RPC. */
async function getRegulatoryFactsForGuides(supabase: SupabaseClient<Database>, ids: string[]): Promise<Map<string, ParentRegulatoryFact[]>> {
  const map = new Map<string, ParentRegulatoryFact[]>()
  if (ids.length === 0) return map
  const results = await Promise.all(
    ids.map(async (id) => {
      const { data } = await supabase.rpc("get_hub_skill_content_regulatory_facts", { p_content_item_id: id })
      return { id, facts: data ?? [] }
    })
  )
  for (const { id, facts } of results) {
    if (facts.length > 0) map.set(id, facts.map((f) => ({ factKey: f.fact_key, valueText: f.value_text })))
  }
  return map
}
