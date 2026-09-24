import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { REQUEST_FIELDS, projectRequest, type RequestRow, type TeamFixtureRequest } from "../team/requests"

type Client = SupabaseClient<Database>

/**
 * FIXTURE REQUESTS ACROSS A CLUB (CA-M10): what other clubs have asked any of our sides, and what our
 * sides have asked. The same rows, the same projection and the same operations as the Team workspace
 * (`accept_fixture_request`, the policy-covered decline) -- read across every side the club runs, and
 * each row naming which of ours it concerns. RLS decides which rows come back: a person who holds
 * `fixture.request.respond` at the club reads them all; one who holds it at one side reads that side's.
 */
export interface ClubFixtureRequest extends TeamFixtureRequest {
  ourTeamId: string
  ourTeam: string
}

export async function readClubFixtureRequests(
  supabase: Client,
  teams: { id: string; name: string }[]
): Promise<{ incoming: ClubFixtureRequest[]; outgoing: ClubFixtureRequest[] }> {
  const ids = teams.map((t) => t.id)
  if (ids.length === 0) return { incoming: [], outgoing: [] }
  const name = new Map(teams.map((t) => [t.id, t.name]))
  const [{ data: incoming, error: e1 }, { data: outgoing, error: e2 }] = await Promise.all([
    supabase.from("fixture_requests").select(REQUEST_FIELDS).in("target_team_id", ids).order("created_at", { ascending: false }).limit(100),
    supabase.from("fixture_requests").select(REQUEST_FIELDS).in("requesting_team_id", ids).order("created_at", { ascending: false }).limit(100),
  ])
  if (e1) throw e1
  if (e2) throw e2
  const project = (rows: RequestRow[], ours: (r: RequestRow) => string | null): ClubFixtureRequest[] =>
    rows.flatMap((r) => {
      const teamId = ours(r)
      if (!teamId) return []
      return [{ ...projectRequest(r, teamId), ourTeamId: teamId, ourTeam: name.get(teamId) ?? "Our side" }]
    })
  return {
    incoming: project((incoming ?? []) as unknown as RequestRow[], (r) => r.target_team_id),
    outgoing: project((outgoing ?? []) as unknown as RequestRow[], (r) => r.requesting_team_id),
  }
}
