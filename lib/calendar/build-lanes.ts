import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { MyTeam } from "@/lib/app-context/my-teams"
import { activeManageableClubId, type SwitchableContext } from "@/lib/app-context/active-context"
import { manageableTeams, type SessionContext } from "@/lib/app-context/session-context"
import { compactTeamLabel, fullTeamLabel } from "@/lib/teams/compact-label"
import { miniRugbyGroupLabel } from "@/lib/mini-rugby/group-label"
import type { Database } from "@/types/database.types"

import type { Lane } from "@/app/(app)/calendar/week-board"

export interface CalendarLanes {
  fullLanes: Lane[]
  /** team_id -> the shared scheduling group it belongs to, if any. */
  teamToGroup: Map<string, { id: string; label: string }>
  seenGroupIds: Set<string>
  groupIds: string[]
  hasClubFixtureAuthority: boolean
  manageableTeamIds: Set<string>
}

/**
 * The one lane-builder Week and Agenda both call (Master Architecture Pass
 * reconciliation, "one shared filter model" / "Agenda inherits Calendar's
 * team-filters"). Rolls each active scheduling group's member teams into
 * ONE lane (never duplicated per component team), then one lane per
 * remaining team, carrying the canonical category/ageGroup/gender/
 * squadDesignation fields TeamFilterBar's grouping module needs -- never
 * re-derived from a free-text label.
 */
export async function buildCalendarLanes(
  supabase: SupabaseClient<Database>,
  scopedTeams: MyTeam[],
  ctx: SessionContext,
  boardContext: SwitchableContext
): Promise<CalendarLanes> {
  const teamIds = scopedTeams.map((t) => t.id)
  let lanes: Omit<Lane, "primaryTeamId" | "canCreate">[] = []
  const teamToGroup = new Map<string, { id: string; label: string }>()
  if (teamIds.length > 0) {
    const { data: groupMemberships } = await supabase
      .from("scheduling_group_members")
      .select("team_id, scheduling_groups!inner(id, display_tag, alias, active)")
      .in("team_id", teamIds)
      .eq("scheduling_groups.active", true)
    for (const gm of groupMemberships ?? []) {
      // Section 15/16: "Mini-Rugby Group", never "Shared" -- and the
      // club's alias (if set) always follows the structural tag, never
      // replaces it.
      if (gm.scheduling_groups) {
        const g = gm.scheduling_groups
        teamToGroup.set(gm.team_id, { id: g.id, label: miniRugbyGroupLabel({ displayTag: g.display_tag, alias: g.alias }) })
      }
    }
  }
  const seenGroupIds = new Set<string>()
  for (const t of scopedTeams) {
    const group = teamToGroup.get(t.id)
    if (group) {
      if (seenGroupIds.has(group.id)) continue
      seenGroupIds.add(group.id)
      lanes.push({
        id: `group:${group.id}`,
        label: group.label,
        fullLabel: group.label,
        kind: "group",
        memberTeamIds: scopedTeams.filter((mt) => teamToGroup.get(mt.id)?.id === group.id).map((mt) => mt.id),
        category: null,
        ageGroup: null,
        gender: null,
        squadDesignation: null,
      })
    } else {
      lanes.push({
        id: `team:${t.id}`,
        label: compactTeamLabel(t),
        fullLabel: fullTeamLabel(t),
        kind: "team",
        memberTeamIds: [t.id],
        category: t.category,
        ageGroup: t.ageGroup,
        gender: t.gender,
        squadDesignation: t.squadDesignation,
      })
    }
  }
  lanes = lanes.sort((a, b) => a.label.localeCompare(b.label))
  const groupIds = Array.from(seenGroupIds)

  // Scoped to the ACTIVE context, not "does this session hold club-wide
  // fixture authority ANYWHERE" -- see calendar/page.tsx's own historical
  // comment on this exact leak (a multi-role account switched into Parent
  // View still saw "+" create affordances on every lane).
  const activeManageableClub = activeManageableClubId(ctx, boardContext)
  const manageableTeamIds = new Set(manageableTeams(ctx).map((t) => t.teamId))
  const hasClubFixtureAuthority = Boolean(activeManageableClub)
  const fullLanes: Lane[] = lanes.map((l) => {
    const primaryTeamId = l.memberTeamIds[0] ?? null
    const canCreate = hasClubFixtureAuthority || l.memberTeamIds.some((id) => manageableTeamIds.has(id))
    return { ...l, primaryTeamId, canCreate }
  })

  return { fullLanes, teamToGroup, seenGroupIds, groupIds, hasClubFixtureAuthority, manageableTeamIds }
}
