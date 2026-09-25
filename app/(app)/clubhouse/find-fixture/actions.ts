"use server"

import { readClubhouseMarkers, readFindFixtureCandidateAvailability, type ClubMapMarker } from "@ovalball/contracts/clubhouse"

import { createClient } from "@/lib/supabase/server"

export interface FindFixtureCandidateRow {
  team_id: string
  club_id: string
  display_name: string
  age_group: string | null
  gender: string | null
}

export interface FindFixtureRawData {
  markers: ClubMapMarker[]
  candidateRows: FindFixtureCandidateRow[]
}

/**
 * ONE FETCH PER TEAM SELECTION, EVERYTHING AFTER IS LOCAL. Exactly the same two-round-trip shape the
 * native Find a Fixture screen uses: the existing shared marker population (`readClubhouseMarkers`) and
 * the batched compatibility RPC (`find_fixture_candidate_teams`). Distance, sort and the partner toggle
 * are then pure, client-side recombinations of this same unfiltered data (`buildFindFixtureCandidates`
 * / `applyClubhouseDistanceFilter` / `sortFindFixtureCandidates`, all from
 * `packages/contracts/src/clubhouse/find-fixture.ts`) -- exactly the pattern
 * `partner-clubs-explorer.tsx` already uses for its own search/filter, never a server round trip per
 * criterion change. `find_fixture_candidate_teams` itself re-checks the caller's real fixture authority
 * for the named team server-side; this action does not check permissions itself.
 */
export async function getFindFixtureData(teamId: string, viewerClubId: string | null, viewerTeamId: string | null): Promise<FindFixtureRawData> {
  const supabase = await createClient()
  const [markers, { data: candidateRows, error }] = await Promise.all([
    readClubhouseMarkers(supabase, viewerClubId, viewerTeamId),
    supabase.rpc("find_fixture_candidate_teams", { p_team_id: teamId }),
  ])
  if (error) throw new Error(error.message)
  return { markers, candidateRows: candidateRows ?? [] }
}

export interface FindFixtureAvailabilityRow {
  opponent_team_id: string
  the_date: string
  status: string
}

/**
 * Section 7's own batched search -- one round trip for every compatible PARTNER team across up to 6
 * dates, fired only once the caller has actually chosen a date (see find-fixture-client.tsx). Never
 * returns a non-partner club; `find_fixture_candidate_availability` itself enforces that server-side.
 */
export async function getFindFixtureAvailability(teamId: string, dates: string[]): Promise<FindFixtureAvailabilityRow[]> {
  const supabase = await createClient()
  return readFindFixtureCandidateAvailability(supabase, teamId, dates)
}
