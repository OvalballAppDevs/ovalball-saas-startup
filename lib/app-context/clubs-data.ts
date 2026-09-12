import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type { ClubBundle, ClubPersonLink, ClubSource, FamousClub, InternationalRelatedLink } from "./clubs-types"
import type { TeamHonour } from "./international-types"
import type { TeamRoleType } from "./people-types"

export type { ClubPersonLink, ClubSource, FamousClub, ClubBundle } from "./clubs-types"
export { TEAM_GENDER_LABEL, HONOUR_TYPE_LABEL, SOURCE_TIER_LABEL, TEAM_ROLE_LABEL, internationalRugbyCodeLabel, findClubByKey } from "./clubs-types"

/**
 * Famous Clubs data layer. Reuses hub_content_items (RUGBY_TEAM,
 * team_type = 'CLUB_TEAM') exactly as International Rugby's NATIONAL_TEAM/
 * REPRESENTATIVE_TEAM rows already do -- zero new tables. Honours,
 * Heritage links and sources reuse the exact same tables International
 * Rugby and People already built. The one new fetch direction this domain
 * needs is person <- club (People's own hub_person_team_relationships
 * queries person -> team; a club page needs the reverse join).
 */
export async function getClubsBundle(supabase: SupabaseClient<Database>): Promise<ClubBundle> {
  const { data: clubRows } = await supabase.from("hub_content_items").select("*").eq("content_type", "RUGBY_TEAM").eq("team_type", "CLUB_TEAM").eq("status", "PUBLISHED").order("title", { ascending: true })

  const clubs: FamousClub[] = (clubRows ?? []).map((r) => ({
    id: r.id,
    contentKey: r.content_key,
    title: r.title,
    summary: r.summary,
    body: r.body,
    rugbyCode: r.rugby_code as FamousClub["rugbyCode"],
    teamGender: r.team_gender as FamousClub["teamGender"],
    aliases: r.aliases ?? [],
  }))

  const clubIds = clubs.map((c) => c.id)

  if (clubIds.length === 0) {
    return { clubs, honoursByClub: new Map(), relatedByClub: new Map(), heritageByClub: new Map(), peopleByClub: new Map(), sourcesByClub: new Map() }
  }

  const [{ data: honourRows }, { data: relationshipRows }, { data: heritageLinkRows }, { data: personLinkRows }, { data: sourceRows }] = await Promise.all([
    supabase.from("hub_team_honours").select("*, competition:hub_content_items!hub_team_honours_competition_id_fkey(title, content_key)").in("team_id", clubIds),
    supabase.from("hub_content_relationships").select("content_item_id, related_content_item_id").in("content_item_id", clubIds),
    supabase.from("hub_content_heritage_links").select("content_item_id, heritage_entries(entry_key, title)").in("content_item_id", clubIds),
    supabase.from("hub_person_team_relationships").select("team_id, role_type, person:hub_content_items!hub_person_team_relationships_person_id_fkey(title, content_key, status)").in("team_id", clubIds),
    supabase.from("hub_content_sources").select("content_item_id, source_tier, source_title, source_url, retrieved_on").in("content_item_id", clubIds),
  ])

  const honoursByClub = new Map<string, TeamHonour[]>()
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
    const list = honoursByClub.get(row.team_id) ?? []
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
    honoursByClub.set(row.team_id, list)
  }
  for (const list of honoursByClub.values()) list.sort((a, b) => b.yearLabel.localeCompare(a.yearLabel))

  const relatedTargetIds = Array.from(new Set((relationshipRows ?? []).map((r) => r.related_content_item_id)))
  const { data: relatedContentRows } =
    relatedTargetIds.length > 0
      ? await supabase.from("hub_content_items").select("id, title, content_key, content_type").in("id", relatedTargetIds).eq("status", "PUBLISHED")
      : { data: [] as { id: string; title: string; content_key: string; content_type: string }[] }
  const relatedById = new Map((relatedContentRows ?? []).map((r) => [r.id, r]))

  function resolveRelatedLink(target: { title: string; content_key: string; content_type: string }): InternationalRelatedLink | null {
    if (target.content_type === "COMPETITION_GUIDE") return { title: target.title, href: `/rugby-hub/competitions/${target.content_key}` }
    if (target.content_type === "RUGBY_TEAM") return { title: target.title, href: `/rugby-hub/international/teams/${target.content_key}` }
    return null
  }

  const relatedByClub = new Map<string, InternationalRelatedLink[]>()
  for (const row of relationshipRows ?? []) {
    const target = relatedById.get(row.related_content_item_id)
    const link = target ? resolveRelatedLink(target) : null
    if (!link) continue
    const list = relatedByClub.get(row.content_item_id) ?? []
    list.push(link)
    relatedByClub.set(row.content_item_id, list)
  }

  const heritageByClub = new Map<string, InternationalRelatedLink[]>()
  for (const row of (heritageLinkRows ?? []) as unknown as { content_item_id: string; heritage_entries: { entry_key: string; title: string } | null }[]) {
    if (!row.heritage_entries) continue
    const list = heritageByClub.get(row.content_item_id) ?? []
    list.push({ title: row.heritage_entries.title, href: `/rugby-hub/story/${row.heritage_entries.entry_key}` })
    heritageByClub.set(row.content_item_id, list)
  }

  const peopleByClub = new Map<string, ClubPersonLink[]>()
  for (const row of (personLinkRows ?? []) as unknown as { team_id: string; role_type: TeamRoleType; person: { title: string; content_key: string; status: string } | null }[]) {
    if (!row.person || row.person.status !== "PUBLISHED") continue
    const list = peopleByClub.get(row.team_id) ?? []
    list.push({ personTitle: row.person.title, personKey: row.person.content_key, roleType: row.role_type, href: `/rugby-hub/people/${row.person.content_key}` })
    peopleByClub.set(row.team_id, list)
  }

  const sourcesByClub = new Map<string, ClubSource[]>()
  for (const row of (sourceRows ?? []) as unknown as { content_item_id: string; source_tier: ClubSource["tier"]; source_title: string; source_url: string | null; retrieved_on: string | null }[]) {
    const list = sourcesByClub.get(row.content_item_id) ?? []
    list.push({ tier: row.source_tier, title: row.source_title, url: row.source_url, retrievedOn: row.retrieved_on })
    sourcesByClub.set(row.content_item_id, list)
  }

  return { clubs, honoursByClub, relatedByClub, heritageByClub, peopleByClub, sourcesByClub }
}
