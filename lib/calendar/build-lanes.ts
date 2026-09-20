import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { MyTeam } from "@/lib/app-context/my-teams"
import { activeManageableClubId, type SwitchableContext } from "@/lib/app-context/active-context"
import type { SessionContext } from "@/lib/app-context/session-context"
import { actingTeamIds, singleFixtureTeamIdsAcrossClubs, teamGroupMemberships } from "@/lib/fixtures/fixture-team-authority"
import { compactTeamLabel, fullTeamLabel } from "@/lib/teams/compact-label"
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
  let lanes: Omit<Lane, "primaryTeamId" | "canCreate" | "hasActivity">[] = []
  const teamToGroup = new Map<string, { id: string; label: string }>()
  // Section 15/16: "Mini-Rugby Group", never "Shared" -- labelled by the one
  // canonical group label, through the same membership read the Planner uses.
  for (const [teamId, groups] of await teamGroupMemberships(supabase, teamIds)) {
    const g = groups[groups.length - 1]
    if (g) teamToGroup.set(teamId, g)
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
  // WHICH TEAMS THIS PERSON MAY CREATE A SINGLE FIXTURE FOR -- read from the
  // database's single-fixture team authority (public.single_fixture_team_ids),
  // which is override-aware, rather than re-derived from the session's own
  // team_permissions. It is deliberately NOT the Season Planner's authority:
  // bulk planning is club administration.
  // A Site Admin's platform-wide bypass follows the active context
  // (actingTeamIds), which also keeps a read-only diagnostic board free of
  // create affordances.
  const manageableTeamIds = actingTeamIds(
    ctx,
    boardContext,
    await singleFixtureTeamIdsAcrossClubs(supabase, await teamClubIds(supabase, teamIds)),
  )
  const hasClubFixtureAuthority = Boolean(activeManageableClub)

  // WHICH LANES HAVE ANYTHING IN THEM.
  //
  // A club running eighteen sides, four of which have never had a fixture
  // booked, was offered all eighteen equally in the team filter -- so the
  // choice a person actually wanted was buried among choices that would show
  // them an empty week whichever one they picked.
  //
  // This resolves the FACT (does this lane have any fixture or training session
  // at all) and nothing more. The decision about what to do with it belongs to
  // the filter, which keeps every lane reachable behind an explicit control --
  // a legitimate team must never vanish from the product for being quiet, and
  // a newly created team with nothing scheduled yet is the normal case, not an
  // error. Deliberately not season-scoped: a lane with fixtures next month is
  // not a quiet lane merely because this week is empty.
  const activeTeamIds = await teamIdsWithActivity(supabase, teamIds)

  const fullLanes: Lane[] = lanes.map((l) => {
    const primaryTeamId = l.memberTeamIds[0] ?? null
    const canCreate = hasClubFixtureAuthority || l.memberTeamIds.some((id) => manageableTeamIds.has(id))
    return { ...l, primaryTeamId, canCreate, hasActivity: l.memberTeamIds.some((id) => activeTeamIds.has(id)) }
  })

  return { fullLanes, teamToGroup, seenGroupIds, groupIds, hasClubFixtureAuthority, manageableTeamIds }
}

/**
 * The teams among these that have any fixture or training session recorded.
 *
 * Two bounded reads keyed on ids already in hand, not a per-lane count: the
 * question is "is there anything", so `select id ... in (...)` and a Set is
 * enough, and a count per lane would be one round trip per team on a page that
 * already renders a season.
 *
 * Both reads go through the caller's own client, so RLS applies: a lane whose
 * fixtures this viewer cannot see reads as quiet for them, which is correct --
 * it is exactly as empty as the board they are about to be shown.
 */
async function teamIdsWithActivity(supabase: SupabaseClient<Database>, teamIds: string[]): Promise<Set<string>> {
  if (teamIds.length === 0) return new Set()
  const [fixtures, training] = await Promise.all([
    supabase.from("fixtures").select("owning_team_id, opponent_team_id").or(`owning_team_id.in.(${teamIds.join(",")}),opponent_team_id.in.(${teamIds.join(",")})`),
    supabase.from("training_sessions").select("team_id").in("team_id", teamIds),
  ])
  const withActivity = new Set<string>()
  for (const row of fixtures.data ?? []) {
    if (row.owning_team_id) withActivity.add(row.owning_team_id)
    if (row.opponent_team_id) withActivity.add(row.opponent_team_id)
  }
  for (const row of training.data ?? []) {
    if (row.team_id) withActivity.add(row.team_id)
  }
  return withActivity
}

/** The clubs the scoped teams belong to -- usually exactly one. */
async function teamClubIds(supabase: SupabaseClient<Database>, teamIds: string[]): Promise<string[]> {
  if (teamIds.length === 0) return []
  const { data } = await supabase.from("teams").select("club_id").in("id", teamIds)
  return [...new Set((data ?? []).map((t) => t.club_id).filter((c): c is string => Boolean(c)))]
}
