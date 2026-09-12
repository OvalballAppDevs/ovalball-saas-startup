import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import type { HonourRoleType, PeopleBundle, PersonHonour, PersonRelatedLink, PersonRole, PersonSource, PersonTeamLink, RugbyPerson, SourceTier, TeamRoleType } from "./people-types"

export type { PersonRole, TeamRoleType, HonourRoleType, SourceTier, PersonRelatedLink, PersonTeamLink, PersonHonour, PersonSource, RugbyPerson, PeopleBundle } from "./people-types"
export { ROLE_LABEL, TEAM_ROLE_LABEL, HONOUR_ROLE_LABEL, SOURCE_TIER_LABEL, findPersonByKey, personSearchLabel, personYearRange } from "./people-types"

/**
 * People & Rugby Legends data layer. RUGBY_PERSON reuses hub_content_items
 * exactly as every other Hub content_type does; hub_person_team_
 * relationships, hub_person_honour_relationships and hub_content_sources
 * are the three new small tables (hub_content_heritage_links is reused
 * unchanged). One call fetches the whole bundle in a fixed small number of
 * batched queries regardless of corpus size -- no N+1 per person.
 */
export async function getPeopleBundle(supabase: SupabaseClient<Database>): Promise<PeopleBundle> {
  const { data: personRows } = await supabase.from("hub_content_items").select("*").eq("content_type", "RUGBY_PERSON").eq("status", "PUBLISHED").order("title", { ascending: true })

  const people: RugbyPerson[] = (personRows ?? []).map((r) => ({
    id: r.id,
    contentKey: r.content_key,
    title: r.title,
    summary: r.summary,
    body: r.body,
    roles: (r.roles ?? []) as PersonRole[],
    aliases: r.aliases ?? [],
    birthYear: r.birth_year,
    deathYear: r.death_year,
  }))

  const personIds = people.map((p) => p.id)

  if (personIds.length === 0) {
    return { people, teamLinksByPerson: new Map(), honoursByPerson: new Map(), heritageByPerson: new Map(), sourcesByPerson: new Map(), relatedByPerson: new Map() }
  }

  const [{ data: teamLinkRows }, { data: honourLinkRows }, { data: heritageLinkRows }, { data: sourceRows }, { data: relationshipRows }] = await Promise.all([
    supabase.from("hub_person_team_relationships").select("person_id, role_type, notes, team:hub_content_items!hub_person_team_relationships_team_id_fkey(title, content_key, status)").in("person_id", personIds),
    supabase
      .from("hub_person_honour_relationships")
      .select("person_id, role_type, notes, honour:hub_team_honours(honour_type, year_label, team:hub_content_items!hub_team_honours_team_id_fkey(title, content_key, status), competition:hub_content_items!hub_team_honours_competition_id_fkey(title, content_key, status))")
      .in("person_id", personIds),
    supabase.from("hub_content_heritage_links").select("content_item_id, heritage_entries(entry_key, title)").in("content_item_id", personIds),
    supabase.from("hub_content_sources").select("content_item_id, source_tier, source_title, source_url, retrieved_on").in("content_item_id", personIds),
    supabase.from("hub_content_relationships").select("content_item_id, related_content_item_id").in("content_item_id", personIds),
  ])

  const teamLinksByPerson = new Map<string, PersonTeamLink[]>()
  for (const row of (teamLinkRows ?? []) as unknown as { person_id: string; role_type: TeamRoleType; notes: string | null; team: { title: string; content_key: string; status: string } | null }[]) {
    if (!row.team || row.team.status !== "PUBLISHED") continue
    const list = teamLinksByPerson.get(row.person_id) ?? []
    list.push({ teamTitle: row.team.title, teamKey: row.team.content_key, roleType: row.role_type, notes: row.notes })
    teamLinksByPerson.set(row.person_id, list)
  }

  const honoursByPerson = new Map<string, PersonHonour[]>()
  for (const row of (honourLinkRows ?? []) as unknown as {
    person_id: string
    role_type: HonourRoleType
    notes: string | null
    honour: { honour_type: string; year_label: string; team: { title: string; content_key: string; status: string } | null; competition: { title: string; content_key: string; status: string } | null } | null
  }[]) {
    if (!row.honour || !row.honour.team || !row.honour.competition) continue
    if (row.honour.team.status !== "PUBLISHED" || row.honour.competition.status !== "PUBLISHED") continue
    const list = honoursByPerson.get(row.person_id) ?? []
    list.push({
      competitionTitle: row.honour.competition.title,
      competitionKey: row.honour.competition.content_key,
      teamTitle: row.honour.team.title,
      teamKey: row.honour.team.content_key,
      honourType: row.honour.honour_type,
      yearLabel: row.honour.year_label,
      roleType: row.role_type,
      notes: row.notes,
    })
    honoursByPerson.set(row.person_id, list)
  }
  for (const list of honoursByPerson.values()) list.sort((a, b) => b.yearLabel.localeCompare(a.yearLabel))

  const heritageByPerson = new Map<string, PersonRelatedLink[]>()
  for (const row of (heritageLinkRows ?? []) as unknown as { content_item_id: string; heritage_entries: { entry_key: string; title: string } | null }[]) {
    if (!row.heritage_entries) continue
    const list = heritageByPerson.get(row.content_item_id) ?? []
    list.push({ title: row.heritage_entries.title, href: `/rugby-hub/story/${row.heritage_entries.entry_key}` })
    heritageByPerson.set(row.content_item_id, list)
  }

  const sourcesByPerson = new Map<string, PersonSource[]>()
  for (const row of (sourceRows ?? []) as unknown as { content_item_id: string; source_tier: SourceTier; source_title: string; source_url: string | null; retrieved_on: string | null }[]) {
    const list = sourcesByPerson.get(row.content_item_id) ?? []
    list.push({ tier: row.source_tier, title: row.source_title, url: row.source_url, retrievedOn: row.retrieved_on })
    sourcesByPerson.set(row.content_item_id, list)
  }

  const relatedTargetIds = Array.from(new Set((relationshipRows ?? []).map((r) => r.related_content_item_id)))
  const { data: relatedContentRows } =
    relatedTargetIds.length > 0
      ? await supabase.from("hub_content_items").select("id, title, content_key, content_type").in("id", relatedTargetIds).eq("status", "PUBLISHED")
      : { data: [] as { id: string; title: string; content_key: string; content_type: string }[] }
  const relatedById = new Map((relatedContentRows ?? []).map((r) => [r.id, r]))

  function resolveRelatedLink(target: { title: string; content_key: string; content_type: string }): PersonRelatedLink | null {
    if (target.content_type === "OFFICIATING_CONCEPT") return { title: target.title, href: `/rugby-hub/officiating/${target.content_key}` }
    if (target.content_type === "GAME_CONCEPT") return { title: target.title, href: `/rugby-hub/game/${target.content_key}` }
    if (target.content_type === "COMPETITION_GUIDE") return { title: target.title, href: `/rugby-hub/competitions/${target.content_key}` }
    if (target.content_type === "RUGBY_TEAM") return { title: target.title, href: `/rugby-hub/international/teams/${target.content_key}` }
    return null
  }

  const relatedByPerson = new Map<string, PersonRelatedLink[]>()
  for (const row of relationshipRows ?? []) {
    const target = relatedById.get(row.related_content_item_id)
    const link = target ? resolveRelatedLink(target) : null
    if (!link) continue
    const list = relatedByPerson.get(row.content_item_id) ?? []
    list.push(link)
    relatedByPerson.set(row.content_item_id, list)
  }

  return { people, teamLinksByPerson, honoursByPerson, heritageByPerson, sourcesByPerson, relatedByPerson }
}
