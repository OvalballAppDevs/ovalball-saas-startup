import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import { getMyTeams } from "./my-teams"
import { canManageClubFixturesAnywhere, type SessionContext } from "./session-context"

export interface FixtureRow {
  id: string
  teamDisplayName: string
  kickoffDate: string
  kickoffTime: string | null
  homeAway: string
  status: string
  opposition: string
  venueAddress: string | null
  needsAction: boolean
}

export interface PendingRequestRow {
  id: string
  direction: "outgoing" | "incoming"
  proposedDate: string
  opponentText: string
  teamDisplayName: string
  venuePreference: string
}

export interface DashboardData {
  clubDisplayName: string
  thisWeekFixtures: FixtureRow[]
  outstandingRequests: PendingRequestRow[]
  myTeamCount: number
}

const ACTIONABLE_STATUSES = new Set(["Planned", "To Be Determined"])

/**
 * "What needs my attention this week" -- the one query the dashboard is
 * built around. Scoped entirely by the session's real team/club authority
 * (see myTeamIds below), never by a client-supplied filter -- even though
 * fixtures themselves are publicly readable (fixtures_select_all), this
 * still only ever shows the signed-in user *their* teams, matching "do not
 * present every club team" from the brief.
 */
export async function getDashboardData(
  supabase: SupabaseClient<Database>,
  ctx: SessionContext
): Promise<DashboardData> {
  const myTeamIds = (await getMyTeams(supabase, ctx)).map((t) => t.id)

  if (myTeamIds.length === 0) {
    return {
      clubDisplayName: ctx.clubMemberships[0]?.clubName ?? "Ovalball",
      thisWeekFixtures: [],
      outstandingRequests: [],
      myTeamCount: 0,
    }
  }

  const today = new Date()
  const weekAhead = new Date(today)
  weekAhead.setDate(weekAhead.getDate() + 7)
  const todayStr = today.toISOString().slice(0, 10)
  const weekAheadStr = weekAhead.toISOString().slice(0, 10)

  const { data: fixtures } = await supabase
    .from("fixtures")
    .select(
      "id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, venue_address, teams!fixtures_owning_team_id_fkey(display_name)"
    )
    .in("owning_team_id", myTeamIds)
    .gte("kickoff_date", todayStr)
    .lte("kickoff_date", weekAheadStr)
    .order("kickoff_date", { ascending: true })

  const thisWeekFixtures: FixtureRow[] = (fixtures ?? []).map((f) => ({
    id: f.id,
    teamDisplayName: f.teams?.display_name ?? "Team",
    kickoffDate: f.kickoff_date,
    kickoffTime: f.kickoff_time,
    homeAway: f.home_away,
    status: f.status,
    opposition: f.raw_opposition_text,
    venueAddress: f.venue_address,
    needsAction: ACTIONABLE_STATUSES.has(f.status),
  }))

  const hasClubFixtureAuthority = canManageClubFixturesAnywhere(ctx)
  const outstandingRequests: PendingRequestRow[] = []

  const { data: outgoing } = await supabase
    .from("fixture_requests")
    .select("id, venue_preference, requesting_team_id, teams!fixture_requests_requesting_team_id_fkey(display_name), fixture_request_groups(proposed_date, raw_opponent_text)")
    .in("requesting_team_id", myTeamIds)
    .eq("status", "sent")

  for (const r of outgoing ?? []) {
    outstandingRequests.push({
      id: r.id,
      direction: "outgoing",
      proposedDate: r.fixture_request_groups?.proposed_date ?? "",
      opponentText: r.fixture_request_groups?.raw_opponent_text ?? "",
      teamDisplayName: r.teams?.display_name ?? "Team",
      venuePreference: r.venue_preference,
    })
  }

  if (myTeamIds.length > 0 || hasClubFixtureAuthority) {
    const { data: incoming } = await supabase
      .from("fixture_requests")
      .select("id, venue_preference, target_team_id, teams!fixture_requests_target_team_id_fkey(display_name), fixture_request_groups(proposed_date, raw_opponent_text)")
      .in("target_team_id", myTeamIds)
      .eq("status", "sent")

    for (const r of incoming ?? []) {
      outstandingRequests.push({
        id: r.id,
        direction: "incoming",
        proposedDate: r.fixture_request_groups?.proposed_date ?? "",
        opponentText: r.fixture_request_groups?.raw_opponent_text ?? "",
        teamDisplayName: r.teams?.display_name ?? "Team",
        venuePreference: r.venue_preference,
      })
    }
  }

  return {
    clubDisplayName: ctx.clubMemberships[0]?.clubName ?? "Ovalball",
    thisWeekFixtures,
    outstandingRequests,
    myTeamCount: myTeamIds.length,
  }
}
