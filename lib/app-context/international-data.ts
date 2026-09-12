import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type { InternationalBundle, InternationalCompetition, InternationalRelatedLink, InternationalTeam, TeamHonour } from "./international-types"

export type { RugbyCode, TeamType, TeamGender, InternationalRelatedLink, InternationalTeam, TeamHonour, InternationalCompetition, InternationalBundle } from "./international-types"
export { TEAM_TYPE_LABEL, TEAM_GENDER_LABEL, HONOUR_TYPE_LABEL, findTeamByKey, findCompetitionByKey, internationalRugbyCodeLabel } from "./international-types"

/**
 * International Rugby data layer. RUGBY_TEAM reuses hub_content_items
 * exactly as GAME_CONCEPT/OFFICIATING_CONCEPT/COMPETITION_GUIDE already
 * do; international COMPETITION_GUIDE rows are fetched here too (the
 * international-specific subset, identified by content_key, never a new
 * competition entity); hub_team_honours and hub_content_heritage_links are
 * the two new small tables. One call fetches the whole bundle in a fixed
 * small number of batched queries regardless of team/honour count.
 */
const INTERNATIONAL_COMPETITION_KEYS = ["six-nations", "womens-six-nations", "rugby-world-cup", "womens-rugby-world-cup", "rugby-championship", "rugby-league-world-cup", "british-and-irish-lions-tours"]

export async function getInternationalBundle(supabase: SupabaseClient<Database>): Promise<InternationalBundle> {
  const [{ data: teamRows }, { data: competitionRows }] = await Promise.all([
    supabase.from("hub_content_items").select("*").eq("content_type", "RUGBY_TEAM").eq("status", "PUBLISHED").order("title", { ascending: true }),
    supabase.from("hub_content_items").select("*").eq("content_type", "COMPETITION_GUIDE").eq("status", "PUBLISHED").in("content_key", INTERNATIONAL_COMPETITION_KEYS),
  ])

  const teams: InternationalTeam[] = (teamRows ?? []).map((r) => ({
    id: r.id,
    contentKey: r.content_key,
    title: r.title,
    summary: r.summary,
    body: r.body,
    rugbyCode: r.rugby_code as InternationalTeam["rugbyCode"],
    teamType: (r.team_type ?? "NATIONAL_TEAM") as InternationalTeam["teamType"],
    teamGender: r.team_gender as InternationalTeam["teamGender"],
    sourceNote: r.source_note,
    sourceUrl: r.source_url,
    sourceRetrievedOn: r.source_retrieved_on,
  }))

  const competitions: InternationalCompetition[] = (competitionRows ?? []).map((r) => ({
    id: r.id,
    contentKey: r.content_key,
    title: r.title,
    summary: r.summary,
    body: r.body,
    rugbyCode: r.rugby_code as InternationalCompetition["rugbyCode"],
  }))

  const teamIds = teams.map((t) => t.id)
  const competitionIds = competitions.map((c) => c.id)
  const allContentIds = [...teamIds, ...competitionIds]

  if (allContentIds.length === 0) {
    return { teams, competitions, honoursByTeam: new Map(), relatedByTeam: new Map(), relatedByCompetition: new Map(), heritageByContentItem: new Map() }
  }

  const [{ data: honourRows }, { data: relationshipRows }, { data: heritageLinkRows }] = await Promise.all([
    teamIds.length > 0 && competitionIds.length > 0
      ? supabase.from("hub_team_honours").select("*, competition:hub_content_items!hub_team_honours_competition_id_fkey(title, content_key)").in("team_id", teamIds)
      : Promise.resolve({ data: [] as unknown[] }),
    supabase.from("hub_content_relationships").select("content_item_id, related_content_item_id").in("content_item_id", allContentIds),
    supabase.from("hub_content_heritage_links").select("content_item_id, heritage_entries(entry_key, title)").in("content_item_id", allContentIds),
  ])

  const honoursByTeam = new Map<string, TeamHonour[]>()
  for (const row of (honourRows ?? []) as unknown as {
    id: string
    team_id: string
    honour_type: string
    year_label: string
    notes: string | null
    source_note: string | null
    source_url: string | null
    source_retrieved_on: string | null
    competition: { title: string; content_key: string } | null
  }[]) {
    if (!row.competition) continue
    const list = honoursByTeam.get(row.team_id) ?? []
    list.push({
      id: row.id,
      competitionTitle: row.competition.title,
      competitionKey: row.competition.content_key,
      honourType: row.honour_type,
      yearLabel: row.year_label,
      notes: row.notes,
      sourceNote: row.source_note,
      sourceUrl: row.source_url,
      sourceRetrievedOn: row.source_retrieved_on,
    })
    honoursByTeam.set(row.team_id, list)
  }
  // Newest first within each team -- year_label is free text (not every
  // edition is a plain 4-digit year), so a plain string sort is the
  // correct, honest ordering rather than pretending every label parses as
  // a number.
  for (const list of honoursByTeam.values()) list.sort((a, b) => b.yearLabel.localeCompare(a.yearLabel))

  const relatedTargetIds = Array.from(new Set((relationshipRows ?? []).map((r) => r.related_content_item_id)))
  const { data: relatedContentRows } =
    relatedTargetIds.length > 0
      ? await supabase.from("hub_content_items").select("id, title, content_key, content_type").in("id", relatedTargetIds).eq("status", "PUBLISHED")
      : { data: [] as { id: string; title: string; content_key: string; content_type: string }[] }
  const relatedById = new Map((relatedContentRows ?? []).map((r) => [r.id, r]))

  function resolveRelatedLink(target: { title: string; content_key: string; content_type: string }): InternationalRelatedLink | null {
    if (target.content_type === "RUGBY_TEAM") return { title: target.title, href: `/rugby-hub/international/teams/${target.content_key}` }
    if (target.content_type === "COMPETITION_GUIDE") return { title: target.title, href: `/rugby-hub/competitions/${target.content_key}` }
    if (target.content_type === "GAME_CONCEPT") return { title: target.title, href: `/rugby-hub/game/${target.content_key}` }
    return null
  }

  const relatedByTeam = new Map<string, InternationalRelatedLink[]>()
  const relatedByCompetition = new Map<string, InternationalRelatedLink[]>()
  const teamIdSet = new Set(teamIds)
  for (const row of relationshipRows ?? []) {
    const target = relatedById.get(row.related_content_item_id)
    const link = target ? resolveRelatedLink(target) : null
    if (!link) continue
    const map = teamIdSet.has(row.content_item_id) ? relatedByTeam : relatedByCompetition
    const list = map.get(row.content_item_id) ?? []
    list.push(link)
    map.set(row.content_item_id, list)
  }

  const heritageByContentItem = new Map<string, InternationalRelatedLink[]>()
  for (const row of (heritageLinkRows ?? []) as unknown as { content_item_id: string; heritage_entries: { entry_key: string; title: string } | null }[]) {
    if (!row.heritage_entries) continue
    const list = heritageByContentItem.get(row.content_item_id) ?? []
    list.push({ title: row.heritage_entries.title, href: `/rugby-hub/story/${row.heritage_entries.entry_key}` })
    heritageByContentItem.set(row.content_item_id, list)
  }

  return { teams, competitions, honoursByTeam, relatedByTeam, relatedByCompetition, heritageByContentItem }
}
