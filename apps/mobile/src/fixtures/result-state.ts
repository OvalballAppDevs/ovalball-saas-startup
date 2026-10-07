import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database, FixtureResultState, FixtureResultStatus } from "@ovalball/contracts"

type Client = SupabaseClient<Database>

/**
 * ONE FIXTURE'S RESULT, AS THE RESULT SCREEN NEEDS IT -- the fixture's own result columns, read under
 * the same RLS every other fixture read uses. Home and away scores stay home and away here; the screen
 * places them against the right crests.
 */
export interface FixtureResultRead {
  state: FixtureResultState
  submittedAt: string | null
  deadlineAt: string | null
  resolutionReason: string | null
  /** The clubs on each side of the fixture, by home and away, so the screen can tell whose turn it is. */
  homeClubId: string | null
  awayClubId: string | null
}

const KNOWN: FixtureResultStatus[] = ["none", "awaiting_confirmation", "disputed", "unverified", "amendment_pending", "final", "external_recorded"]

export async function loadFixtureResult(supabase: Client, fixtureId: string): Promise<FixtureResultRead | null> {
  const { data, error } = await supabase
    .from("fixtures")
    .select(
      "status, kickoff_date, kickoff_time, home_away, home_score, away_score, result_status, result_submitted_by_club_id, result_submitted_at, result_deadline_at, result_amendment_proposed_home_score, result_amendment_proposed_away_score, result_amendment_proposed_by_club_id, result_site_admin_resolved_at, result_site_admin_resolution_reason, owning:teams!fixtures_owning_team_id_fkey(club_id), opponent:teams!fixtures_opponent_team_id_fkey(club_id)"
    )
    .eq("id", fixtureId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as unknown as {
    status: string | null
    kickoff_date: string | null
    kickoff_time: string | null
    home_away: string | null
    home_score: number | null
    away_score: number | null
    result_status: string | null
    result_submitted_by_club_id: string | null
    result_submitted_at: string | null
    result_deadline_at: string | null
    result_amendment_proposed_home_score: number | null
    result_amendment_proposed_away_score: number | null
    result_amendment_proposed_by_club_id: string | null
    result_site_admin_resolved_at: string | null
    result_site_admin_resolution_reason: string | null
    owning: { club_id: string | null } | null
    opponent: { club_id: string | null } | null
  }

  const owningClub = row.owning?.club_id ?? null
  const opponentClub = row.opponent?.club_id ?? null
  const owningIsHome = row.home_away !== "Away"
  const status = (KNOWN as string[]).includes(row.result_status ?? "") ? (row.result_status as FixtureResultStatus) : "none"

  return {
    state: {
      status,
      homeScore: row.home_score,
      awayScore: row.away_score,
      submittedByClubId: row.result_submitted_by_club_id,
      amendmentHomeScore: row.result_amendment_proposed_home_score,
      amendmentAwayScore: row.result_amendment_proposed_away_score,
      amendmentByClubId: row.result_amendment_proposed_by_club_id,
      resolvedBySiteAdmin: row.result_site_admin_resolved_at !== null,
      cancelled: row.status === "Cancelled",
      kickoffPassed: kickoffHasPassed(row.kickoff_date, row.kickoff_time),
    },
    submittedAt: row.result_submitted_at,
    deadlineAt: row.result_deadline_at,
    resolutionReason: row.result_site_admin_resolution_reason,
    homeClubId: owningIsHome ? owningClub : opponentClub,
    awayClubId: owningIsHome ? opponentClub : owningClub,
  }
}

/** Display-only: the server's own kick-off gate (`fixture_result_eligible`) is what refuses an early score. */
function kickoffHasPassed(date: string | null, time: string | null): boolean {
  if (!date) return false
  const at = new Date(`${date}T${time ?? "00:00:00"}`)
  return Number.isNaN(at.getTime()) ? false : at.getTime() <= Date.now()
}
