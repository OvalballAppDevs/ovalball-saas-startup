import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { fullTeamLabel } from "@/lib/teams/compact-label"

import { JoinRequestList, type JoinRequestRow, type PlaceableTeam } from "./join-request-list"

export const metadata = { title: "Join Requests" }

/**
 * PLAYERS ASKING TO JOIN.
 *
 * One list of one kind of thing: a player waiting for the club to say yes.
 *
 * A club manager and a team manager both arrive here, and they are NOT two
 * approvals. They are two people who may resolve the same request, and the
 * first legitimate one to do so settles it -- which is why every row carries
 * the request id and the server refuses any second transition out of pending
 * rather than this page trying to hide rows fast enough.
 *
 * What a viewer can see is decided by RLS and what they can DO is decided by
 * the capability engine inside the approve/decline functions. This page renders
 * controls to match, but it is never the boundary.
 */
export default async function JoinRequestsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // RLS returns only the requests this person is entitled to see: their own
  // club's, as a manager. Nothing is filtered in the browser.
  const { data: rows } = await supabase
    .from("player_club_join_requests")
    .select("id, player_id, club_id, resolved_category, status, created_at, players(first_name, surname), clubs(club_directory(name))")
    .eq("status", "pending")
    .order("created_at")

  const clubIds = Array.from(new Set((rows ?? []).map((r) => r.club_id)))
  const { data: teamRows } =
    clubIds.length > 0
      ? await supabase
          .from("teams")
          .select("id, club_id, rugby_code, category, age_group, gender, squad_designation, canonical_team_type_id")
          .in("club_id", clubIds)
          .eq("active", true)
      : { data: [] }

  const teamsByClub = new Map<string, PlaceableTeam[]>()
  for (const t of teamRows ?? []) {
    const label = t.canonical_team_type_id
      ? fullTeamLabel({
          category: t.category,
          ageGroup: t.age_group,
          gender: t.gender,
          squadDesignation: t.squad_designation,
          rugbyCode: t.rugby_code,
        })
      : "Team"
    teamsByClub.set(t.club_id, [...(teamsByClub.get(t.club_id) ?? []), { id: t.id, label }])
  }
  for (const [k, v] of teamsByClub) teamsByClub.set(k, v.sort((a, b) => a.label.localeCompare(b.label)))

  const requests: JoinRequestRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    playerName: r.players ? `${r.players.first_name} ${r.players.surname}` : "Unknown player",
    clubId: r.club_id,
    clubName: (r.clubs?.club_directory as unknown as { name: string } | null)?.name ?? "This club",
    resolvedCategory: r.resolved_category,
    requestedOn: r.created_at,
    teams: teamsByClub.get(r.club_id) ?? [],
  }))

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Join Requests</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        Players who have asked to join. Accepting one puts them in the side you choose &mdash; Ovalball has worked out
        the category they are eligible for, not which of your teams they belong in.
      </p>

      {requests.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-8 text-center text-sm text-ink-muted">
          Nothing waiting. Requests from players appear here.
        </p>
      ) : (
        <JoinRequestList requests={requests} />
      )}
    </div>
  )
}
