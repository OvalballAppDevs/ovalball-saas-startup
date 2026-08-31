import { redirect } from "next/navigation"
import Link from "next/link"

import { getMyTeams } from "@/lib/app-context/my-teams"
import { canManageClubFixturesAnywhere, getSessionContext } from "@/lib/app-context/session-context"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"

import { RequestRow, type RequestRowData } from "./request-row"

export default async function FixturesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const myTeams = await getMyTeams(supabase, ctx)
  const teamIds = myTeams.map((t) => t.id)

  const requests: RequestRowData[] = []

  if (teamIds.length > 0) {
    const { data: outgoing } = await supabase
      .from("fixture_requests")
      .select(
        "id, venue_preference, teams!fixture_requests_requesting_team_id_fkey(display_name), fixture_request_groups(proposed_date, raw_opponent_text)"
      )
      .in("requesting_team_id", teamIds)
      .eq("status", "sent")

    for (const r of outgoing ?? []) {
      requests.push({
        id: r.id,
        direction: "outgoing",
        teamDisplayName: r.teams?.display_name ?? "Team",
        opponentText: r.fixture_request_groups?.raw_opponent_text ?? "",
        proposedDate: r.fixture_request_groups?.proposed_date ?? "",
        venuePreference: r.venue_preference,
      })
    }

    const { data: incoming } = await supabase
      .from("fixture_requests")
      .select(
        "id, venue_preference, teams!fixture_requests_target_team_id_fkey(display_name), fixture_request_groups(proposed_date, raw_opponent_text)"
      )
      .in("target_team_id", teamIds)
      .eq("status", "sent")

    for (const r of incoming ?? []) {
      requests.push({
        id: r.id,
        direction: "incoming",
        teamDisplayName: r.teams?.display_name ?? "Team",
        opponentText: r.fixture_request_groups?.raw_opponent_text ?? "",
        proposedDate: r.fixture_request_groups?.proposed_date ?? "",
        venuePreference: r.venue_preference,
      })
    }
  }

  requests.sort((a, b) => a.proposedDate.localeCompare(b.proposedDate))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Fixtures</p>
          <h1 className="mt-2 font-display text-display-l text-ink">Requests</h1>
          <p className="mt-2 max-w-md text-sm text-ink/55">
            Fixtures your teams have proposed or been asked to play, still awaiting a response.
          </p>
        </div>
        {canManageClubFixturesAnywhere(ctx) && myTeams.length > 0 && (
          <Button className="h-10 shrink-0" nativeButton={false} render={<Link href="/fixtures/new" />}>
            Request a fixture
          </Button>
        )}
      </div>

      {requests.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
          <p className="text-sm font-medium text-ink">Nothing waiting on you</p>
          <p className="mt-1 text-sm text-ink/55">
            Fixture requests will appear here once a partner club shares availability to request against.
          </p>
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {requests.map((r) => (
            <RequestRow key={r.id} request={r} />
          ))}
        </ul>
      )}
    </div>
  )
}
