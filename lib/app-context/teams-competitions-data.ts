import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type { CompetitionBundle, CompetitionGuide, CompetitionRelatedLink } from "./teams-competitions-types"

export type { RugbyCode, CompetitionRelatedLink, CompetitionGuide, CompetitionBundle } from "./teams-competitions-types"
export { findGuideByKey, competitionRugbyCodeLabel } from "./teams-competitions-types"

/**
 * Teams & Competitions data layer. Reuses the existing general-knowledge
 * content graph exactly as it stands -- hub_content_items (content_type
 * 'COMPETITION_GUIDE'), hub_content_relationships (RELATED_KNOWLEDGE),
 * hub_glossary_content_links. Zero new tables, zero new RPCs. The Hub
 * EXPLAINS competitions here; it never queries competitions,
 * competition_editions, competition_edition_teams, or any other
 * operational table.
 */
export async function getCompetitionBundle(supabase: SupabaseClient<Database>): Promise<CompetitionBundle> {
  const { data: rows } = await supabase.from("hub_content_items").select("*").eq("content_type", "COMPETITION_GUIDE").eq("status", "PUBLISHED").order("title", { ascending: true })

  const guides: CompetitionGuide[] = (rows ?? []).map((r) => ({
    id: r.id,
    contentKey: r.content_key,
    title: r.title,
    summary: r.summary,
    body: r.body,
    rugbyCode: r.rugby_code as CompetitionGuide["rugbyCode"],
    sourceNote: r.source_note,
    sourceUrl: r.source_url,
    sourceRetrievedOn: r.source_retrieved_on,
  }))

  const guideIds = guides.map((g) => g.id)
  if (guideIds.length === 0) {
    return { guides, relatedByGuide: new Map(), glossaryByGuide: new Map(), heritageByGuide: new Map() }
  }

  const [{ data: relationshipRows }, { data: glossaryLinkRows }, { data: heritageLinkRows }] = await Promise.all([
    supabase.from("hub_content_relationships").select("content_item_id, related_content_item_id").in("content_item_id", guideIds),
    supabase.from("hub_glossary_content_links").select("content_item_id, hub_glossary_terms(term_key, display_term, status)").in("content_item_id", guideIds),
    supabase.from("hub_content_heritage_links").select("content_item_id, heritage_entries(entry_key, title)").in("content_item_id", guideIds),
  ])

  const heritageByGuide = new Map<string, CompetitionRelatedLink[]>()
  for (const row of (heritageLinkRows ?? []) as unknown as { content_item_id: string; heritage_entries: { entry_key: string; title: string } | null }[]) {
    if (!row.heritage_entries) continue
    const list = heritageByGuide.get(row.content_item_id) ?? []
    list.push({ title: row.heritage_entries.title, href: `/rugby-hub/story/${row.heritage_entries.entry_key}` })
    heritageByGuide.set(row.content_item_id, list)
  }

  const glossaryByGuide = new Map<string, CompetitionRelatedLink[]>()
  for (const row of (glossaryLinkRows ?? []) as unknown as { content_item_id: string; hub_glossary_terms: { term_key: string; display_term: string; status: string } | null }[]) {
    if (!row.hub_glossary_terms || row.hub_glossary_terms.status !== "PUBLISHED") continue
    const list = glossaryByGuide.get(row.content_item_id) ?? []
    list.push({ title: row.hub_glossary_terms.display_term, href: `/rugby-hub/glossary/${row.hub_glossary_terms.term_key}` })
    glossaryByGuide.set(row.content_item_id, list)
  }

  // A related target may be another COMPETITION_GUIDE or (sparingly) a
  // GAME_CONCEPT -- resolved by content_type exactly as every other Hub
  // domain's own "related" resolver already does, never a generic
  // fallback route.
  const relatedTargetIds = Array.from(new Set((relationshipRows ?? []).map((r) => r.related_content_item_id)))
  const { data: relatedContentRows } =
    relatedTargetIds.length > 0
      ? await supabase.from("hub_content_items").select("id, title, content_key, content_type").in("id", relatedTargetIds).eq("status", "PUBLISHED")
      : { data: [] as { id: string; title: string; content_key: string; content_type: string }[] }
  const relatedById = new Map((relatedContentRows ?? []).map((r) => [r.id, r]))

  function resolveRelatedLink(target: { title: string; content_key: string; content_type: string }): CompetitionRelatedLink | null {
    if (target.content_type === "COMPETITION_GUIDE") return { title: target.title, href: `/rugby-hub/competitions/${target.content_key}` }
    if (target.content_type === "GAME_CONCEPT") return { title: target.title, href: `/rugby-hub/game/${target.content_key}` }
    if (target.content_type === "RUGBY_TEAM") return { title: target.title, href: `/rugby-hub/international/teams/${target.content_key}` }
    return null
  }

  const relatedByGuide = new Map<string, CompetitionRelatedLink[]>()
  for (const row of relationshipRows ?? []) {
    const target = relatedById.get(row.related_content_item_id)
    const link = target ? resolveRelatedLink(target) : null
    if (!link) continue
    const list = relatedByGuide.get(row.content_item_id) ?? []
    list.push(link)
    relatedByGuide.set(row.content_item_id, list)
  }

  return { guides, relatedByGuide, glossaryByGuide, heritageByGuide }
}
