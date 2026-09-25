import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import type { FindFixtureCandidate } from "./find-fixture"

type Client = SupabaseClient<Database>

/**
 * CLUBHOUSE PROGRAMME SECTION 7 -- AVAILABILITY DISCOVERY.
 *
 * Answers "which compatible clubs/teams have a viable date?" -- never "who is available," a claim
 * Ovalball has no domain for (no team anywhere ever declares "we are free on X"; see EXPLICIT
 * AVAILABILITY in the section doc). The four states below are the strongest truthful distinctions the
 * canonical scheduling data actually supports:
 *
 *   - "busy": a real, known commitment on that date (an active fixture, a projected-or-pending
 *     competition match, training, or a club event that reaches that team) -- server-coarsened, never
 *     naming which kind (Section 7's own correction to team_scheduling_availability).
 *   - "tentative": a pending (sent/counter_proposed, not yet accepted) fixture request touching that
 *     date -- a real but non-final hold, deliberately distinct from "busy" so a tentative slot never
 *     reads as more blocked than it truthfully is.
 *   - "no_known_clash": Ovalball has real visibility into this team's schedule (an active partnership)
 *     and found no blocking commitment on that date. NEVER "available" -- an empty calendar is not a
 *     declaration of availability, only an absence of a known clash.
 *   - "unknown": Ovalball has no calendar-sharing agreement with this club, or the team is directory-
 *     only. The honest answer, never softened into anything more positive.
 */
export type FindFixtureAvailabilityState = "no_known_clash" | "busy" | "tentative" | "unknown"

export interface FindFixtureDateAvailability {
  date: string
  state: FindFixtureAvailabilityState
}

export interface FindFixtureCandidateAvailability {
  teamId: string
  dates: FindFixtureDateAvailability[]
}

export interface FindFixtureAvailabilityResult {
  candidates: FindFixtureCandidateAvailability[]
}

type CandidateAvailabilityRow = { opponent_team_id: string; the_date: string; status: string }

/**
 * THE PURE PROJECTION. `find_fixture_candidate_availability` only ever returns partner-club rows and
 * only ever the blocked dates (never a row for a clear date, never a row for a non-partner club) --
 * this function is what turns that minimal server response, plus the caller's ALREADY-KNOWN partnership
 * state from Section 6's own marker read model, into the honest per-date state for every compatible
 * team. A non-partner candidate is never even looked up in `rows` -- it is unconditionally "unknown"
 * for every date, because Ovalball genuinely cannot see its calendar.
 */
export function buildFindFixtureAvailability(candidates: readonly FindFixtureCandidate[], dates: readonly string[], rows: readonly CandidateAvailabilityRow[]): FindFixtureCandidateAvailability[] {
  const stateByTeamDate = new Map<string, "busy" | "tentative">()
  for (const row of rows) {
    if (row.status === "busy" || row.status === "request_pending") {
      stateByTeamDate.set(`${row.opponent_team_id}|${row.the_date}`, row.status === "busy" ? "busy" : "tentative")
    }
  }

  const result: FindFixtureCandidateAvailability[] = []
  for (const candidate of candidates) {
    const isPartner = candidate.partnershipStatus === "active"
    for (const team of candidate.compatibleTeams) {
      result.push({
        teamId: team.teamId,
        dates: dates.map((date) => ({
          date,
          state: isPartner ? (stateByTeamDate.get(`${team.teamId}|${date}`) ?? "no_known_clash") : "unknown",
        })),
      })
    }
  }
  return result
}

/** Factual arithmetic, never a score: how many of the requested dates this team has NO_KNOWN_CLASH on. */
export function countNoKnownClashDates(availability: FindFixtureCandidateAvailability): number {
  return availability.dates.filter((d) => d.state === "no_known_clash").length
}

/**
 * THE ONE I/O ENTRY POINT. One round trip for every compatible-partner team across up to 6 dates,
 * regardless of how many candidates Section 6 found -- never one call per candidate. Authorises
 * entirely server-side (the same team-scoped fixture authority `find_fixture_candidate_teams` already
 * requires); a non-partner or incompatible team is never even considered, server-side, not merely
 * hidden client-side.
 */
export async function readFindFixtureCandidateAvailability(supabase: Client, teamId: string, dates: readonly string[]): Promise<CandidateAvailabilityRow[]> {
  const { data, error } = await supabase.rpc("find_fixture_candidate_availability", { p_team_id: teamId, p_dates: [...dates] })
  if (error) throw error
  return data ?? []
}
