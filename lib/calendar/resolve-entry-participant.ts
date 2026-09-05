import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { miniRugbyGroupLabel } from "@/lib/mini-rugby/group-label"
import type { Database } from "@/types/database.types"

import type { Lane } from "@/app/(app)/calendar/week-board"

export { resolveMyFixtureSide, type MyFixtureSide } from "./resolve-my-fixture-side"

/**
 * Extends a base lane set (built from a club's CURRENT live group
 * membership, via buildCalendarLanes) with any Mini-Rugby Group actually
 * referenced by a real, already-authorized fixture/training row on MY
 * side that isn't already covered -- e.g. a genuinely overlapping second
 * group a component team also belongs to, or a group a team has since
 * left. Every id passed in is, by construction, a group belonging to MY
 * OWN club (resolveMyFixtureSide only ever reads the side that is mine,
 * and the group-vs-group data model requires a group's club_id to match
 * its own anchor team's club_id) -- never the opposing club's group.
 * Never fabricates a lane: every one added here is a real
 * scheduling_groups row the caller has just legitimately seen
 * referenced on their own fixture.
 */
export async function extendLanesWithReferencedGroups(
  supabase: SupabaseClient<Database>,
  baseLanes: Lane[],
  referencedGroupIds: (string | null)[],
  hasClubFixtureAuthority: boolean,
  manageableTeamIds: Set<string>
): Promise<{ lanes: Lane[]; groupLabelById: Map<string, string> }> {
  const groupLabelById = new Map<string, string>()
  for (const l of baseLanes) {
    if (l.kind === "group") groupLabelById.set(l.id.replace("group:", ""), l.label)
  }
  const missingIds = Array.from(new Set(referencedGroupIds.filter((id): id is string => Boolean(id)))).filter((id) => !groupLabelById.has(id))
  if (missingIds.length === 0) return { lanes: baseLanes, groupLabelById }

  const [{ data: groups }, { data: members }] = await Promise.all([
    supabase.from("scheduling_groups").select("id, display_tag, alias").in("id", missingIds),
    supabase.from("scheduling_group_members").select("group_id, team_id").in("group_id", missingIds),
  ])
  const membersByGroup = new Map<string, string[]>()
  for (const m of members ?? []) membersByGroup.set(m.group_id, [...(membersByGroup.get(m.group_id) ?? []), m.team_id])

  const extraLanes: Lane[] = []
  for (const g of groups ?? []) {
    const label = miniRugbyGroupLabel({ displayTag: g.display_tag, alias: g.alias })
    groupLabelById.set(g.id, label)
    const memberTeamIds = membersByGroup.get(g.id) ?? []
    extraLanes.push({
      id: `group:${g.id}`,
      label,
      fullLabel: label,
      kind: "group",
      memberTeamIds,
      primaryTeamId: memberTeamIds[0] ?? null,
      canCreate: hasClubFixtureAuthority || memberTeamIds.some((id) => manageableTeamIds.has(id)),
      category: null,
      ageGroup: null,
      gender: null,
      squadDesignation: null,
    })
  }
  return { lanes: [...baseLanes, ...extraLanes], groupLabelById }
}

/**
 * Display-only labels for the OPPOSING side's Mini-Rugby Group, when the
 * fixture I'm viewing has one -- e.g. "U6/U7 Tags" as my opponent's name.
 * scheduling_groups has an unconditional SELECT policy (already public to
 * any authenticated caller, matching how an opponent club's own team
 * names are already shown), so this never needs membership expansion or
 * creates a lane -- it is read-only display text for a side that is never
 * mine to filter/manage.
 */
export async function loadOpponentGroupLabels(supabase: SupabaseClient<Database>, groupIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(groupIds.filter((id): id is string => Boolean(id))))
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from("scheduling_groups").select("id, display_tag, alias").in("id", ids)
  return new Map((data ?? []).map((g) => [g.id, miniRugbyGroupLabel({ displayTag: g.display_tag, alias: g.alias })]))
}
