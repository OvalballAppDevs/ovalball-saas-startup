import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { fullTeamLabel } from "@/lib/teams/compact-label"
import { createClient } from "@/lib/supabase/server"

import { RequestCard, type CompetitionRequest } from "./request-card"

export const metadata = { title: "Competition Requests" }

/**
 * COMPETITION REQUESTS -- THE CLUB'S SIDE OF AN ISSUED DRAW.
 *
 * Every match a competition has issued to this club (acting as its Club Admin
 * or Fixture Secretary) or to the team this person runs (acting as that team's
 * staff). Confirm puts it on the calendar as agreed; Request Change says what
 * should move; Decline says why. The organiser sees the answer straight away.
 * Only the club's own people answer for it -- never a Site Admin on its behalf.
 */
export default async function CompetitionRequestsPage({ searchParams }: { searchParams: Promise<{ match?: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const { match: focusMatch } = await searchParams

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeManageableClubId(ctx, activeContext)
  const teamId = activeContext.kind === "team" ? activeContext.id : null
  if (!clubId && !teamId) redirect("/fixtures")

  let query = supabase
    .from("competition_match_verifications")
    .select(
      "id, status, message, proposed_date, proposed_kickoff_time, proposed_venue_id, proposed_pitch_id, match_id, participant_id, team_id, club_id, competition_matches(id, match_date, kickoff_time, venue_text, status, round_number, home_participant_id, away_participant_id, venues(name), competition_editions(competitions(name)))",
    )
    .order("created_at", { ascending: false })
    .limit(300)
  query = clubId ? query.eq("club_id", clubId) : query.eq("team_id", teamId!)
  const { data: rows } = await query

  const participantIds = [...new Set((rows ?? []).flatMap((r) => [r.competition_matches?.home_participant_id, r.competition_matches?.away_participant_id]).filter((x): x is string => Boolean(x)))]
  const { data: participants } =
    participantIds.length > 0
      ? await supabase.from("competition_participants").select("id, club_directory(name), teams(rugby_code, category, age_group, gender, squad_designation)").in("id", participantIds)
      : { data: [] }
  // The answering club's own grounds, so a Request Change can propose one of them.
  const clubIds = [...new Set((rows ?? []).map((r) => r.club_id))]
  const [{ data: venueRows }, { data: pitchRows }] =
    clubIds.length > 0
      ? await Promise.all([
          supabase.from("venues").select("id, name, club_id").in("club_id", clubIds).eq("active", true).order("name"),
          supabase.from("club_pitches").select("id, display_name, venue_id, club_id").in("club_id", clubIds).eq("active", true).order("sort_order"),
        ])
      : [{ data: [] }, { data: [] }]
  const groundsOf = (club: string) =>
    (venueRows ?? [])
      .filter((v) => v.club_id === club)
      .map((v) => ({ id: v.id, name: v.name, pitches: (pitchRows ?? []).filter((p) => p.venue_id === v.id).map((p) => ({ id: p.id, name: p.display_name })) }))
  const nameOf = new Map(
    (participants ?? []).map((p) => [
      p.id,
      [p.club_directory?.name, p.teams ? fullTeamLabel({ category: p.teams.category, ageGroup: p.teams.age_group, gender: p.teams.gender, squadDesignation: p.teams.squad_designation, rugbyCode: p.teams.rugby_code }) : null].filter(Boolean).join(" "),
    ]),
  )

  const requests: CompetitionRequest[] = (rows ?? []).map((r) => {
    const m = r.competition_matches
    return {
      verificationId: r.id,
      matchId: r.match_id,
      status: r.status,
      message: r.message,
      proposedDate: r.proposed_date,
      proposedKickoff: r.proposed_kickoff_time?.slice(0, 5) ?? null,
      proposedVenue: r.proposed_venue_id ? ((venueRows ?? []).find((v) => v.id === r.proposed_venue_id)?.name ?? null) : null,
      proposedPitch: r.proposed_pitch_id ? ((pitchRows ?? []).find((p) => p.id === r.proposed_pitch_id)?.display_name ?? null) : null,
      grounds: groundsOf(r.club_id),
      competitionName: m?.competition_editions?.competitions?.name ?? "Competition",
      home: m?.home_participant_id ? (nameOf.get(m.home_participant_id) ?? "TBC") : "TBC",
      away: m?.away_participant_id ? (nameOf.get(m.away_participant_id) ?? "TBC") : "TBC",
      ours: r.participant_id === m?.home_participant_id ? "home" : "away",
      date: m?.match_date ?? null,
      kickoff: m?.kickoff_time?.slice(0, 5) ?? null,
      venue: m?.venues?.name ?? m?.venue_text ?? null,
      matchStatus: m?.status ?? null,
      round: m?.round_number ?? null,
    }
  })
  const open = requests.filter((r) => r.status === "awaiting" && r.matchStatus !== "cancelled")
  const answered = requests.filter((r) => !open.includes(r))

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <h1 className="font-display text-3xl text-ink">Competition Requests</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">Matches competitions have issued to {clubId ? "your club" : "your team"}. Confirm them, ask for a change, or decline with a reason.</p>

      <section aria-labelledby="open-title" className="mt-6">
        <h2 id="open-title" className="text-sm font-semibold text-ink">
          Waiting for You ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-6 text-sm text-ink-muted">Nothing is waiting for an answer.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {open.map((r) => (
              <li key={r.verificationId}>
                <RequestCard request={r} focus={r.matchId === focusMatch} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {answered.length > 0 && (
        <section aria-labelledby="answered-title" className="mt-8">
          <h2 id="answered-title" className="text-sm font-semibold text-ink">
            Answered
          </h2>
          <ul className="mt-2 flex flex-col gap-2">
            {answered.map((r) => (
              <li key={r.verificationId}>
                <RequestCard request={r} focus={r.matchId === focusMatch} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
