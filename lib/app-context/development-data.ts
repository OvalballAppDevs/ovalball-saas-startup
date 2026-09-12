import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type {
  DevelopmentBundle,
  DevelopmentConcept,
  DevelopmentFamily,
  DevelopmentPositionLink,
  DevelopmentRegulatoryFact,
  DevelopmentRelatedLink,
  DevelopmentSkillLink,
  DevelopmentSource,
} from "./development-types"

export type {
  RugbyCode,
  DevelopmentFamily,
  DevelopmentSkillLink,
  DevelopmentPositionLink,
  DevelopmentRelatedLink,
  DevelopmentRegulatoryFact,
  DevelopmentSource,
  DevelopmentConcept,
  DevelopmentBundle,
  SourceTier,
} from "./development-types"
export {
  DEVELOPMENT_FAMILY_ORDER,
  DEVELOPMENT_FAMILY_LABEL,
  DEVELOPMENT_FAMILY_BLURB,
  SOURCE_TIER_LABEL,
  findDevelopmentConceptByKey,
  filterConceptsByCode,
  developmentJourney,
  groupConceptsByFamily,
  developmentRugbyCodeLabel,
} from "./development-types"

/**
 * Player Development data layer. Adds ZERO new tables: a development concept
 * is an ordinary hub_content_items row (content_type
 * 'PLAYER_DEVELOPMENT_CONCEPT', development_family set), and every
 * relationship it has runs through a junction that already existed and was
 * already generic --
 *
 *   hub_skill_content_links      concept <-> skill      (already generic; Game Knowledge uses it)
 *   hub_content_item_positions   concept <-> position   (already generic; GAME_CONCEPT and OFFICIATING_CONCEPT use it)
 *   hub_content_relationships    concept <-> concept    (RELATED_KNOWLEDGE, already cross-type)
 *   hub_regulatory_fact_references  concept -> real VERIFIED fact
 *   hub_content_sources          concept -> provenance
 *
 * Note what is NOT read here, and never may be: players, profiles, auth
 * users, guardians, memberships, attendance, fixtures, coach notes and
 * assessments. Player Development describes how learning rugby works. It
 * does not describe, score, rank, track or compare any individual player,
 * and it has no query path by which it could.
 */
export async function getDevelopmentBundle(supabase: SupabaseClient<Database>): Promise<DevelopmentBundle> {
  const { data: rows } = await supabase
    .from("hub_content_items")
    .select("*")
    .eq("content_type", "PLAYER_DEVELOPMENT_CONCEPT")
    .eq("status", "PUBLISHED")
    .order("title", { ascending: true })

  const concepts: DevelopmentConcept[] = (rows ?? []).map((r) => ({
    id: r.id,
    contentKey: r.content_key,
    title: r.title,
    summary: r.summary,
    body: r.body,
    whyItMatters: r.why_it_matters,
    family: (r.development_family ?? "FOUNDATIONS") as DevelopmentFamily,
    rugbyCode: r.rugby_code as DevelopmentConcept["rugbyCode"],
    aliases: r.aliases ?? [],
    journeyOrder: r.journey_order,
  }))

  const conceptIds = concepts.map((c) => c.id)
  if (conceptIds.length === 0) {
    return {
      concepts,
      skillsByConcept: new Map(),
      positionsByConcept: new Map(),
      relatedByConcept: new Map(),
      regulatoryFactsByConcept: new Map(),
      sourcesByConcept: new Map(),
    }
  }

  const [{ data: skillLinkRows }, { data: positionLinkRows }, { data: outboundRows }, { data: inboundRows }, { data: sourceRows }] = await Promise.all([
    supabase.from("hub_skill_content_links").select("content_item_id, hub_skills(skill_key, display_name)").in("content_item_id", conceptIds),
    supabase.from("hub_content_item_positions").select("content_item_id, hub_positions(position_key, rugby_code, display_name, shirt_number)").in("content_item_id", conceptIds),
    supabase.from("hub_content_relationships").select("content_item_id, related_content_item_id").in("content_item_id", conceptIds),
    supabase.from("hub_content_relationships").select("content_item_id, related_content_item_id").in("related_content_item_id", conceptIds),
    supabase.from("hub_content_sources").select("content_item_id, source_tier, source_title, source_url, retrieved_on").in("content_item_id", conceptIds),
  ])

  const skillsByConcept = new Map<string, DevelopmentSkillLink[]>()
  for (const row of (skillLinkRows ?? []) as unknown as { content_item_id: string; hub_skills: { skill_key: string; display_name: string } | null }[]) {
    if (!row.hub_skills) continue
    const list = skillsByConcept.get(row.content_item_id) ?? []
    list.push({ skillKey: row.hub_skills.skill_key, displayName: row.hub_skills.display_name })
    skillsByConcept.set(row.content_item_id, list)
  }
  for (const list of skillsByConcept.values()) list.sort((a, b) => a.displayName.localeCompare(b.displayName))

  const positionsByConcept = new Map<string, DevelopmentPositionLink[]>()
  for (const row of (positionLinkRows ?? []) as unknown as {
    content_item_id: string
    hub_positions: { position_key: string; rugby_code: string; display_name: string; shirt_number: number | null } | null
  }[]) {
    if (!row.hub_positions) continue
    const list = positionsByConcept.get(row.content_item_id) ?? []
    list.push({
      positionKey: row.hub_positions.position_key,
      rugbyCode: row.hub_positions.rugby_code as "union" | "league",
      displayName: row.hub_positions.display_name,
      shirtNumber: row.hub_positions.shirt_number,
    })
    positionsByConcept.set(row.content_item_id, list)
  }

  /**
   * Relationships are read in BOTH directions. hub_content_relationships
   * stores one row per connection, and the earlier domains only ever read
   * outward -- which is fine when a page is the natural origin of its links.
   * Development concepts genuinely chain (foundations lead into technique,
   * technique into decisions), so reading outward only would leave the
   * concepts that sit at the END of a chain -- warm-up habits, speed and
   * agility, preparing for match day -- as dead ends with nothing related at
   * all. This is a read decision inside the existing mechanism, not a new
   * mechanism: no extra column, no mirrored rows to keep in sync.
   */
  const relatedIdsByConcept = new Map<string, Set<string>>()
  for (const row of outboundRows ?? []) {
    const set = relatedIdsByConcept.get(row.content_item_id) ?? new Set<string>()
    set.add(row.related_content_item_id)
    relatedIdsByConcept.set(row.content_item_id, set)
  }
  for (const row of inboundRows ?? []) {
    const set = relatedIdsByConcept.get(row.related_content_item_id) ?? new Set<string>()
    set.add(row.content_item_id)
    relatedIdsByConcept.set(row.related_content_item_id, set)
  }

  const allTargetIds = Array.from(new Set(Array.from(relatedIdsByConcept.values()).flatMap((s) => Array.from(s))))
  const { data: targetRows } =
    allTargetIds.length > 0
      ? await supabase.from("hub_content_items").select("id, content_key, title, content_type").in("id", allTargetIds).eq("status", "PUBLISHED")
      : { data: [] as { id: string; content_key: string; title: string; content_type: string }[] }
  const targetById = new Map((targetRows ?? []).map((r) => [r.id, r]))

  const relatedByConcept = new Map<string, DevelopmentRelatedLink[]>()
  for (const [conceptId, targetIds] of relatedIdsByConcept) {
    const links: DevelopmentRelatedLink[] = []
    for (const targetId of targetIds) {
      if (targetId === conceptId) continue
      const target = targetById.get(targetId)
      if (!target) continue
      const link = resolveRelatedLink(target)
      if (link) links.push(link)
    }
    if (links.length > 0) {
      links.sort((a, b) => a.title.localeCompare(b.title))
      relatedByConcept.set(conceptId, links)
    }
  }

  const sourcesByConcept = new Map<string, DevelopmentSource[]>()
  for (const row of (sourceRows ?? []) as unknown as {
    content_item_id: string
    source_tier: DevelopmentSource["tier"]
    source_title: string
    source_url: string | null
    retrieved_on: string | null
  }[]) {
    const list = sourcesByConcept.get(row.content_item_id) ?? []
    list.push({ tier: row.source_tier, title: row.source_title, url: row.source_url, retrievedOn: row.retrieved_on })
    sourcesByConcept.set(row.content_item_id, list)
  }

  const regulatoryFactsByConcept = await getRegulatoryFactsForConcepts(supabase, conceptIds)

  return { concepts, skillsByConcept, positionsByConcept, relatedByConcept, regulatoryFactsByConcept, sourcesByConcept }
}

/** A development concept relates outward across content types -- resolve each to its own destination rather than flattening them all into one look. */
function resolveRelatedLink(target: { content_key: string; title: string; content_type: string }): DevelopmentRelatedLink | null {
  if (target.content_type === "PLAYER_DEVELOPMENT_CONCEPT") return { title: target.title, href: `/rugby-hub/development/${target.content_key}`, kindLabel: "Development" }
  if (target.content_type === "GAME_CONCEPT") return { title: target.title, href: `/rugby-hub/game/${target.content_key}`, kindLabel: "How the game works" }
  if (target.content_type === "OFFICIATING_CONCEPT") return { title: target.title, href: `/rugby-hub/officiating/${target.content_key}`, kindLabel: "Officiating" }
  return null
}

/** Same RLS reasoning as the Skills Explorer and Game Knowledge resolvers: regulatory_facts has no public-read policy, so real fact text reaches here only through the existing sanctioned RPC -- already fully generic despite its skill-flavoured name. */
async function getRegulatoryFactsForConcepts(supabase: SupabaseClient<Database>, conceptIds: string[]): Promise<Map<string, DevelopmentRegulatoryFact[]>> {
  const map = new Map<string, DevelopmentRegulatoryFact[]>()
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
