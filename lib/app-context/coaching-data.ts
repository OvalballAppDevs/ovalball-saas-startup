import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type { CoachingBundle, CoachingConcept, CoachingFamily, CoachingRegulatoryFact, CoachingRelatedLink, CoachingSkillLink, CoachingSource } from "./coaching-types"

export type {
  RugbyCode,
  CoachingFamily,
  CoachingSkillLink,
  CoachingRelatedLink,
  CoachingRegulatoryFact,
  CoachingSource,
  CoachingConcept,
  CoachingBundle,
  SourceTier,
} from "./coaching-types"
export {
  COACHING_FAMILY_ORDER,
  COACHING_FAMILY_LABEL,
  COACHING_FAMILY_BLURB,
  COACHING_INTENTS,
  SOURCE_TIER_LABEL,
  findCoachingConceptByKey,
  filterCoachingByCode,
  coachingJourney,
  groupCoachingByFamily,
  coachingRugbyCodeLabel,
} from "./coaching-types"

/**
 * Coaching Knowledge data layer. Adds ZERO new tables: a coaching concept is
 * an ordinary hub_content_items row (content_type 'COACHING_CONCEPT',
 * coaching_family set), and every relationship runs through a junction that
 * already existed and was already generic —
 *
 *   hub_skill_content_links        coaching concept <-> skill
 *   hub_content_relationships      coaching <-> development / game / officiating / coaching
 *   hub_regulatory_fact_references coaching concept -> real VERIFIED Law
 *   hub_content_sources            provenance
 *
 * What is NOT read here, and never may be: training_sessions, training_plans,
 * training_plan_schedule_rules, training_communications,
 * player_fixture_attendance, teams, clubs, players, profiles, auth.users,
 * fixtures, coach assignments and coach notes. Coaching Knowledge explains
 * how coaching works. It holds no session, no attendance, no plan, no coach
 * record and no player record, and there is no query path by which it could.
 *
 * Positions are deliberately absent: hub_content_item_positions is generic
 * and available, but nothing renders the position -> content direction and
 * coaching concepts are role-agnostic, so links there would be graph padding.
 */
export async function getCoachingBundle(supabase: SupabaseClient<Database>): Promise<CoachingBundle> {
  const { data: rows } = await supabase
    .from("hub_content_items")
    .select("*")
    .eq("content_type", "COACHING_CONCEPT")
    .eq("status", "PUBLISHED")
    .order("title", { ascending: true })

  const concepts: CoachingConcept[] = (rows ?? []).map((r) => ({
    id: r.id,
    contentKey: r.content_key,
    title: r.title,
    summary: r.summary,
    body: r.body,
    whyItMatters: r.why_it_matters,
    family: (r.coaching_family ?? "COACHING_APPROACH") as CoachingFamily,
    rugbyCode: r.rugby_code as CoachingConcept["rugbyCode"],
    aliases: r.aliases ?? [],
    journeyOrder: r.journey_order,
  }))

  const conceptIds = concepts.map((c) => c.id)
  if (conceptIds.length === 0) {
    return { concepts, skillsByConcept: new Map(), relatedByConcept: new Map(), regulatoryFactsByConcept: new Map(), sourcesByConcept: new Map() }
  }

  const [{ data: skillLinkRows }, { data: outboundRows }, { data: inboundRows }, { data: sourceRows }] = await Promise.all([
    supabase.from("hub_skill_content_links").select("content_item_id, hub_skills(skill_key, display_name)").in("content_item_id", conceptIds),
    supabase.from("hub_content_relationships").select("content_item_id, related_content_item_id").in("content_item_id", conceptIds),
    supabase.from("hub_content_relationships").select("content_item_id, related_content_item_id").in("related_content_item_id", conceptIds),
    supabase.from("hub_content_sources").select("content_item_id, source_tier, source_title, source_url, retrieved_on").in("content_item_id", conceptIds),
  ])

  const skillsByConcept = new Map<string, CoachingSkillLink[]>()
  for (const row of (skillLinkRows ?? []) as unknown as { content_item_id: string; hub_skills: { skill_key: string; display_name: string } | null }[]) {
    if (!row.hub_skills) continue
    const list = skillsByConcept.get(row.content_item_id) ?? []
    list.push({ skillKey: row.hub_skills.skill_key, displayName: row.hub_skills.display_name })
    skillsByConcept.set(row.content_item_id, list)
  }
  for (const list of skillsByConcept.values()) list.sort((a, b) => a.displayName.localeCompare(b.displayName))

  /**
   * Relationships are read in BOTH directions, the same decision Player
   * Development made and for the same reason: hub_content_relationships
   * stores one row per connection, and coaching concepts genuinely chain, so
   * reading outward only would leave the concepts at the end of a chain with
   * nothing related at all. A read decision inside the existing mechanism —
   * no extra column, no mirrored rows to keep in sync.
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

  const relatedByConcept = new Map<string, CoachingRelatedLink[]>()
  for (const [conceptId, targetIds] of relatedIdsByConcept) {
    const links: CoachingRelatedLink[] = []
    for (const targetId of targetIds) {
      if (targetId === conceptId) continue
      const target = targetById.get(targetId)
      if (!target) continue
      const link = resolveCoachingRelatedLink(target)
      if (link) links.push(link)
    }
    if (links.length > 0) {
      links.sort((a, b) => a.kindLabel.localeCompare(b.kindLabel) || a.title.localeCompare(b.title))
      relatedByConcept.set(conceptId, links)
    }
  }

  const sourcesByConcept = new Map<string, CoachingSource[]>()
  for (const row of (sourceRows ?? []) as unknown as {
    content_item_id: string
    source_tier: CoachingSource["tier"]
    source_title: string
    source_url: string | null
    retrieved_on: string | null
  }[]) {
    const list = sourcesByConcept.get(row.content_item_id) ?? []
    list.push({ tier: row.source_tier, title: row.source_title, url: row.source_url, retrievedOn: row.retrieved_on })
    sourcesByConcept.set(row.content_item_id, list)
  }

  const regulatoryFactsByConcept = await getRegulatoryFactsForCoaching(supabase, conceptIds)

  return { concepts, skillsByConcept, relatedByConcept, regulatoryFactsByConcept, sourcesByConcept }
}

/** A coaching concept relates outward across four content types — resolve each to its own destination rather than flattening them into one undifferentiated list. */
function resolveCoachingRelatedLink(target: { content_key: string; title: string; content_type: string }): CoachingRelatedLink | null {
  if (target.content_type === "COACHING_CONCEPT") return { title: target.title, href: `/rugby-hub/coaching/${target.content_key}`, kindLabel: "Coaching" }
  if (target.content_type === "PLAYER_DEVELOPMENT_CONCEPT") return { title: target.title, href: `/rugby-hub/development/${target.content_key}`, kindLabel: "Development" }
  if (target.content_type === "GAME_CONCEPT") return { title: target.title, href: `/rugby-hub/game/${target.content_key}`, kindLabel: "How the game works" }
  if (target.content_type === "OFFICIATING_CONCEPT") return { title: target.title, href: `/rugby-hub/officiating/${target.content_key}`, kindLabel: "Officiating" }
  return null
}

/** Same RLS reasoning as every other Hub domain: regulatory_facts has no public-read policy, so real Law text reaches here only through the existing sanctioned RPC, which is generic despite its skill-flavoured name. */
async function getRegulatoryFactsForCoaching(supabase: SupabaseClient<Database>, conceptIds: string[]): Promise<Map<string, CoachingRegulatoryFact[]>> {
  const map = new Map<string, CoachingRegulatoryFact[]>()
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
