import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type {
  SkillsExplorerBundle,
  SkillSummary,
  SkillPosition,
  SkillRelationship,
  SkillTrainingContent,
  TechniqueStep,
} from "./skills-explorer-types"

export type {
  TechniqueStep,
  SkillPosition,
  SkillRelationship,
  RegulatoryFactRef,
  SkillTrainingContent,
  SkillSummary,
  SkillsExplorerBundle,
} from "./skills-explorer-types"
export { findSkillByKey, relatedSkillsOf, groupSkillsByFamily, SKILL_FAMILY_LABEL, skillRugbyCodeLabel } from "./skills-explorer-types"

/**
 * Skills Explorer server data layer. Reads hub_skills (extended with
 * teaching-structured columns in this slice's own migration) /
 * hub_position_skills / hub_skill_relationships / hub_skill_content_links /
 * hub_regulatory_fact_references -- schema either already built (Rugby Hub
 * General-Knowledge, Position Explorer) or extended in place, never a
 * second skill store.
 *
 * One call (getSkillsExplorerBundle) fetches everything Skills Explorer
 * needs -- all published skills, which positions use each, related skills,
 * and any linked training content (including the tackling safety note) --
 * in a fixed small number of queries regardless of skill count. Contact
 * age-gating is resolved from the REAL regulatory_fact_applicability data
 * against the viewer's own regulatory identity -- never a hardcoded age
 * number in this file or in React.
 */

const CONTACT_NOT_PERMITTED_FACT_KEY = "RFU-REG15-2026-CONTACT-NOT-PERMITTED-U7-U8"

type SkillRow = Database["public"]["Tables"]["hub_skills"]["Row"]

function mapSkill(row: SkillRow, contactNotYetPermitted: boolean): SkillSummary {
  return {
    id: row.id,
    skillKey: row.skill_key,
    displayName: row.display_name,
    skillFamily: row.skill_family,
    rugbyCode: row.rugby_code as "union" | "league" | null,
    summary: row.summary,
    whyItMatters: row.why_it_matters,
    whenYouUseIt: row.when_you_use_it,
    keyCues: row.key_cues,
    commonMistakes: row.common_mistakes,
    howToImprove: row.how_to_improve,
    gameExamples: row.game_examples,
    techniqueSteps: (row.technique_steps as unknown as TechniqueStep[] | null) ?? null,
    contactNotYetPermitted,
  }
}

/**
 * A retired skill (e.g. set-piece-technique, superseded by
 * scrum-and-lineout-technique) never appears in getSkillsExplorerBundle --
 * it queries status='PUBLISHED' only. Its route still needs a real answer
 * rather than a silent 404, so this looks the raw key up on its own,
 * regardless of status, and resolves the successor's skill_key using the
 * existing hub_skills.superseded_by column. Returns null for a genuinely
 * unknown key (real 404) or a skill that isn't superseded.
 */
export async function resolveSupersededSkillKey(supabase: SupabaseClient<Database>, skillKey: string): Promise<string | null> {
  // hub_skills_public_read is PUBLISHED-only, so a direct select against the
  // SUPERSEDED row returns nothing for an ordinary viewer -- this narrow RPC
  // is the sanctioned way around that, same reasoning as the regulatory
  // resolvers above.
  const { data } = await supabase.rpc("get_hub_superseded_skill_redirect", { p_skill_key: skillKey })
  return data ?? null
}

/**
 * regulatoryIdentityId is optional -- explore mode (no resolved team
 * context) passes null, and no skill is contact-gated for that viewer
 * (the same "unassessed defaults to full display" principle Position
 * Explorer's age-stage resolver uses).
 */
export async function getSkillsExplorerBundle(supabase: SupabaseClient<Database>, regulatoryIdentityId: string | null): Promise<SkillsExplorerBundle> {
  const { data: skillRows } = await supabase.from("hub_skills").select("*").eq("status", "PUBLISHED").order("skill_family", { ascending: true })

  const skillIds = (skillRows ?? []).map((s) => s.id)

  const [{ data: positionLinkRows }, { data: relationshipRows }, { data: contentLinkRows }, contactGated] = await Promise.all([
    skillIds.length > 0
      ? supabase
          .from("hub_position_skills")
          .select("skill_id, hub_positions(id, position_key, rugby_code, display_name, shirt_number)")
          .in("skill_id", skillIds)
      : Promise.resolve({ data: [] as never[] }),
    skillIds.length > 0
      ? supabase.from("hub_skill_relationships").select("skill_id, related_skill_id, relationship_type").in("skill_id", skillIds)
      : Promise.resolve({ data: [] as { skill_id: string; related_skill_id: string; relationship_type: string }[] }),
    skillIds.length > 0
      ? supabase
          .from("hub_skill_content_links")
          .select("skill_id, hub_content_items(id, content_key, content_type, title, summary)")
          .in("skill_id", skillIds)
      : Promise.resolve({ data: [] as never[] }),
    resolveContactGate(supabase, regulatoryIdentityId),
  ])

  const positionsBySkill = new Map<string, SkillPosition[]>()
  for (const row of (positionLinkRows ?? []) as unknown as {
    skill_id: string
    hub_positions: { id: string; position_key: string; rugby_code: string; display_name: string; shirt_number: number | null } | null
  }[]) {
    if (!row.hub_positions) continue
    const list = positionsBySkill.get(row.skill_id) ?? []
    list.push({
      positionId: row.hub_positions.id,
      positionKey: row.hub_positions.position_key,
      rugbyCode: row.hub_positions.rugby_code as "union" | "league",
      displayName: row.hub_positions.display_name,
      shirtNumber: row.hub_positions.shirt_number,
    })
    positionsBySkill.set(row.skill_id, list)
  }

  const relatedBySkill = new Map<string, SkillRelationship[]>()
  for (const row of relationshipRows ?? []) {
    const list = relatedBySkill.get(row.skill_id) ?? []
    list.push({ skillId: row.related_skill_id, relationshipType: row.relationship_type as SkillRelationship["relationshipType"] })
    relatedBySkill.set(row.skill_id, list)
  }

  const contentItemRows = (contentLinkRows ?? []) as unknown as {
    skill_id: string
    hub_content_items: { id: string; content_key: string; content_type: string; title: string; summary: string } | null
  }[]
  const contentItemIds = contentItemRows.map((r) => r.hub_content_items?.id).filter((id): id is string => !!id)

  const factRefsByContentItem = await getRegulatoryFactRefsForContentItems(supabase, contentItemIds)

  const trainingContentBySkill = new Map<string, SkillTrainingContent[]>()
  for (const row of contentItemRows) {
    if (!row.hub_content_items) continue
    const list = trainingContentBySkill.get(row.skill_id) ?? []
    list.push({
      contentKey: row.hub_content_items.content_key,
      contentType: row.hub_content_items.content_type,
      title: row.hub_content_items.title,
      summary: row.hub_content_items.summary,
      regulatoryFacts: factRefsByContentItem.get(row.hub_content_items.id) ?? [],
    })
    trainingContentBySkill.set(row.skill_id, list)
  }

  const skills = (skillRows ?? []).map((row) => mapSkill(row, row.skill_key === "tackling-technique" && contactGated))

  return { skills, positionsBySkill, relatedBySkill, trainingContentBySkill }
}

/**
 * Resolves whether contact is genuinely not-yet-permitted for this
 * identity, from the real regulatory_fact_applicability data -- never a
 * hardcoded age. Returns false (never gate) if the identity is
 * null/unresolved. Goes through get_hub_regulatory_fact_applies rather
 * than selecting regulatory_facts/regulatory_fact_applicability directly:
 * neither table has a public-read RLS policy (both are
 * site.regulatory.view-gated, matching regulatory_content_sets), so a
 * direct select from an ordinary authenticated viewer silently returns
 * zero rows rather than an error -- this narrow RPC is the sanctioned way
 * around that, see this slice's own regulatory-resolvers migration.
 */
async function resolveContactGate(supabase: SupabaseClient<Database>, regulatoryIdentityId: string | null): Promise<boolean> {
  if (!regulatoryIdentityId) return false
  const { data } = await supabase.rpc("get_hub_regulatory_fact_applies", {
    p_fact_key: CONTACT_NOT_PERMITTED_FACT_KEY,
    p_regulatory_identity_id: regulatoryIdentityId,
  })
  return !!data
}

/** Same RLS reasoning as resolveContactGate: regulatory_facts has no public-read policy, so the fact text linked to each content item is fetched via get_hub_skill_content_regulatory_facts rather than an embedded select. */
async function getRegulatoryFactRefsForContentItems(supabase: SupabaseClient<Database>, contentItemIds: string[]) {
  const map = new Map<string, { factKey: string; authorityName: string | null; valueText: string | null; sourceKey: string | null }[]>()
  if (contentItemIds.length === 0) return map

  const results = await Promise.all(
    contentItemIds.map(async (contentItemId) => {
      const { data } = await supabase.rpc("get_hub_skill_content_regulatory_facts", { p_content_item_id: contentItemId })
      return { contentItemId, facts: data ?? [] }
    })
  )

  for (const { contentItemId, facts } of results) {
    map.set(
      contentItemId,
      facts.map((f) => ({ factKey: f.fact_key, authorityName: null, valueText: f.value_text, sourceKey: null }))
    )
  }
  return map
}
