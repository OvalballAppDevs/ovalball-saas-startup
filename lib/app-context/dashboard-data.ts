import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

import type { SwitchableContext } from "./active-context"
import { getTeamsForActiveContext } from "./my-teams"
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

export interface PlayerMovementRow {
  id: string
  playerName: string
  fromTeamName: string
  toTeamName: string
  date: string
}

export interface DashboardData {
  clubDisplayName: string
  thisWeekFixtures: FixtureRow[]
  outstandingRequests: PendingRequestRow[]
  myTeamCount: number
  /** Club Admin dashboard only (PLAYER REQUESTS Section 11) -- the most recent 5 APPROVED call-ups, never dispensation evidence. */
  recentPlayerMovements: PlayerMovementRow[]
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
  ctx: SessionContext,
  activeContext: SwitchableContext
): Promise<DashboardData> {
  const myTeamIds = (await getTeamsForActiveContext(supabase, ctx, activeContext)).map((t) => t.id)

  if (myTeamIds.length === 0) {
    return {
      clubDisplayName: activeContext.label,
      thisWeekFixtures: [],
      outstandingRequests: [],
      myTeamCount: 0,
      recentPlayerMovements: [],
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

  // Product decision: neither Parent/Guardian nor Player sees fixture
  // request negotiation at all (matches app/(app)/fixtures/page.tsx being
  // blocked outright for both contexts) -- skip the reads entirely rather
  // than fetch data this dashboard would then have to hide.
  if (activeContext.kind !== "parent" && activeContext.kind !== "player") {
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
  }

  // Club Admin's own recent-movements log -- club-wide contexts only,
  // never a team/parent/player view, matching "must never gain club-wide
  // visibility merely because the UI exists". Approved call-ups only:
  // dispensation evidence is deliberately never shown at this glance.
  let recentPlayerMovements: PlayerMovementRow[] = []
  if (activeContext.kind === "club" && hasClubFixtureAuthority) {
    const { data: movements } = await supabase
      .from("fixture_player_call_up")
      .select("id, decided_at, players(first_name, surname), source_team:source_team_id(display_name), target_team:target_team_id(display_name)")
      .in("source_team_id", myTeamIds)
      .eq("status", "approved")
      .order("decided_at", { ascending: false })
      .limit(5)

    recentPlayerMovements = (movements ?? []).map((m) => ({
      id: m.id,
      playerName: m.players ? `${m.players.first_name} ${m.players.surname}` : "Unknown player",
      fromTeamName: m.source_team?.display_name ?? "Unknown team",
      toTeamName: m.target_team?.display_name ?? "Unknown team",
      date: m.decided_at ?? "",
    }))
  }

  return {
    clubDisplayName: activeContext.label,
    thisWeekFixtures,
    outstandingRequests,
    myTeamCount: myTeamIds.length,
    recentPlayerMovements,
  }
}
