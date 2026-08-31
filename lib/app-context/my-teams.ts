import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { SessionContext } from "./session-context"

export interface MyTeam {
  id: string
  displayName: string
}

/**
 * Every team this session should see as "mine" for calendar/dashboard
 * purposes: explicit team_permissions assignments, plus every active team
 * at a club where they hold club-wide fixture authority (CLUB_ADMIN /
 * FIXTURE_SECRETARY). Shared by dashboard-data.ts and the calendar page so
 * "which teams count as mine" is defined exactly once.
 */
export async function getMyTeams(supabase: SupabaseClient<Database>, ctx: SessionContext): Promise<MyTeam[]> {
  const clubWideClubIds = ctx.clubMemberships
    .filter((m) => m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY")
    .map((m) => m.clubId)

  const teams = new Map<string, MyTeam>()
  for (const tp of ctx.teamPermissions) {
    teams.set(tp.teamId, { id: tp.teamId, displayName: tp.teamDisplayName })
  }

  if (clubWideClubIds.length > 0) {
    const { data: clubTeams } = await supabase
      .from("teams")
      .select("id, display_name")
      .in("club_id", clubWideClubIds)
      .eq("active", true)
    for (const t of clubTeams ?? []) {
      teams.set(t.id, { id: t.id, displayName: t.display_name })
    }
  }

  return Array.from(teams.values())
}
