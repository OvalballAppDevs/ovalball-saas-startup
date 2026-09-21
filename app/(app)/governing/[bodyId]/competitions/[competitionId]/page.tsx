import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, Eye, ListOrdered, Trophy } from "lucide-react"

import { GoverningEmpty, GoverningPageHeader, GoverningSection } from "@/components/governing/workspace"
import { computeStandings, DEFAULT_POINTS } from "@/lib/competitions/standings"
import { loadBodyCompetitionMatches, loadBodyCompetitions, loadGoverningBody } from "@/lib/governing/body"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Competition" }

/**
 * CONVERGENCE STEP 16 — WHAT ACTUALLY HAPPENED IN A COMPETITION THE ORGANISATION RUNS.
 *
 * COMPETITION MATCH IS THE TRUTH, and this page reads nothing else. It never looks at a club fixture,
 * which is why a match between two clubs that are not on Ovalball appears here exactly like any other:
 * the organiser owns the match whether or not either side is a tenant.
 *
 * THE TABLE IS NOT COMPUTED HERE. `lib/competitions/standings.ts` already computes standings from these
 * rows for the public competition page, with the organiser's own points rule out of the stage settings.
 * A second computation in this component would be a second answer, and the one that disagreed would be
 * whichever the reader happened to open.
 */
export default async function GoverningCompetitionPage({
  params,
}: {
  params: Promise<{ bodyId: string; competitionId: string }>
}) {
  const { bodyId, competitionId } = await params
  const supabase = await createClient()
  const body = await loadGoverningBody(supabase, bodyId)
  if (!body) notFound()

  const [competitions, matches] = await Promise.all([
    loadBodyCompetitions(supabase, bodyId),
    loadBodyCompetitionMatches(supabase, competitionId),
  ])
  const competition = competitions.find((c) => c.competitionId === competitionId)
  if (!competition) notFound()

  // The organiser's own points rule, from the league stage's settings — the same place the public page
  // reads it. Default only where the organiser has not set one.
  const { data: stages } = competition.editionId
    ? await supabase.from("competition_stages").select("kind, settings").eq("edition_id", competition.editionId)
    : { data: [] }
  const league = (stages ?? []).find((s) => s.kind === "league")
  const rule = ((league?.settings as { points?: typeof DEFAULT_POINTS } | null)?.points) ?? DEFAULT_POINTS

  // PARTICIPANTS ARE DERIVED FROM THE MATCHES, deliberately: a team the draw has not reached yet has
  // nothing to show in a table, and the entered count above already says how many are in.
  const participantMap = new Map<string, string>()
  for (const m of matches) {
    if (m.homeParticipantId) participantMap.set(m.homeParticipantId, m.homeLabel ?? "A team")
    if (m.awayParticipantId) participantMap.set(m.awayParticipantId, m.awayLabel ?? "A team")
  }
  const leagueMatches = matches.filter((m) => m.stageKind === "league" || m.stageKind === null)
  const standings =
    league && participantMap.size > 0
      ? computeStandings(
          [...participantMap].map(([id, label]) => ({ id, label })),
          leagueMatches.map((m) => ({
            homeParticipantId: m.homeParticipantId,
            awayParticipantId: m.awayParticipantId,
            homeScore: m.homeScore,
            awayScore: m.awayScore,
            status: m.status,
          })),
          rule
        )
      : []

  const played = matches.filter((m) => m.homeScore !== null)
  const awaiting = matches.filter((m) => m.verificationState === "awaiting" || m.verificationState === "change_requested")
  const externalOnly = matches.filter((m) => m.isExternalOnly).length

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <Link
        href={`/governing/${bodyId}/competitions`}
        className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Competitions
      </Link>

      <GoverningPageHeader
        body={body}
        title={competition.name}
        description={`${competition.seasonName ?? "No season registered"} · ${played.length} of ${matches.length} matches played`}
        action={
          <Link
            href={`/competitions/${competition.slug}`}
            className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink hover:underline"
          >
            <Eye className="size-3.5" aria-hidden="true" />
            Public page
          </Link>
        }
      />

      {/* WHAT THE CLUBS HAVE ANSWERED. Here because it is the organiser's job, and until Step 16 the
          organisation could not see it at all: the verification rows were unreadable to a body and its
          officers were not even notified when a club replied. */}
      {awaiting.length > 0 && (
        <GoverningSection id="gc-awaiting" title="Waiting on the Clubs" count={`${awaiting.length}`}>
          <ul className="flex flex-col gap-1.5">
            {awaiting.map((m) => (
              <li key={m.matchId} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="min-w-0 truncate text-ink">
                  {m.homeLabel ?? "To be drawn"} v {m.awayLabel ?? "To be drawn"}
                </span>
                <span className="shrink-0 text-xs text-amber-800">
                  {m.verificationState === "change_requested" ? "A change was requested" : "Not answered yet"}
                </span>
              </li>
            ))}
          </ul>
        </GoverningSection>
      )}

      {/* THE TABLE. */}
      {standings.length > 0 && (
        <GoverningSection
          id="gc-standings"
          title="Table"
          icon={<ListOrdered className="size-4 text-ink-muted" aria-hidden="true" />}
          count={`${rule.win} for a win, ${rule.draw} for a draw`}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">
                League table for {competition.name}, {competition.seasonName}
              </caption>
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-muted">
                  <th scope="col" className="py-1.5 pr-2 font-medium">#</th>
                  <th scope="col" className="py-1.5 pr-2 font-medium">Team</th>
                  <th scope="col" className="py-1.5 pr-2 text-right font-medium">P</th>
                  <th scope="col" className="py-1.5 pr-2 text-right font-medium">W</th>
                  <th scope="col" className="py-1.5 pr-2 text-right font-medium">D</th>
                  <th scope="col" className="py-1.5 pr-2 text-right font-medium">L</th>
                  <th scope="col" className="py-1.5 pr-2 text-right font-medium">Diff</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((r) => (
                  <tr key={r.participantId} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5 pr-2 text-ink-muted">{r.position}</td>
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink">{r.label}</th>
                    <td className="py-1.5 pr-2 text-right text-ink-muted">{r.played}</td>
                    <td className="py-1.5 pr-2 text-right text-ink-muted">{r.won}</td>
                    <td className="py-1.5 pr-2 text-right text-ink-muted">{r.drawn}</td>
                    <td className="py-1.5 pr-2 text-right text-ink-muted">{r.lost}</td>
                    <td className="py-1.5 pr-2 text-right text-ink-muted">
                      {r.difference > 0 ? `+${r.difference}` : r.difference}
                    </td>
                    <td className="py-1.5 text-right font-medium text-ink">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GoverningSection>
      )}

      {/* THE MATCHES. */}
      <GoverningSection
        id="gc-matches"
        title="Matches"
        icon={<Trophy className="size-4 text-ink-muted" aria-hidden="true" />}
        count={matches.length > 0 ? `${matches.length}` : undefined}
      >
        {matches.length === 0 ? (
          <GoverningEmpty>
            No matches have been drawn yet.
            {competition.canOrganise && competition.editionId
              ? " The draw is made in the Competition Creator."
              : ""}
          </GoverningEmpty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {matches.map((m) => (
              <li key={m.matchId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">
                    {m.homeLabel ?? "To be drawn"} <span className="text-ink-muted">v</span> {m.awayLabel ?? "To be drawn"}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {m.matchDate
                      ? new Date(`${m.matchDate}T00:00:00`).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "No date yet"}
                    {m.kickoffTime ? ` · ${m.kickoffTime.slice(0, 5)}` : ""}
                    {m.venueLabel ? ` · ${m.venueLabel}` : ""}
                    {m.roundNumber ? ` · Round ${m.roundNumber}` : ""}
                    {/* Said plainly, because it is the case a fixture projection could never show. */}
                    {m.isExternalOnly ? " · neither club is on Ovalball" : ""}
                  </p>
                </div>
                <p className="shrink-0 text-sm">
                  {m.homeScore !== null && m.awayScore !== null ? (
                    <span className="font-medium text-ink">
                      {m.homeScore} &ndash; {m.awayScore}
                    </span>
                  ) : m.status === "cancelled" ? (
                    <span className="text-ink-muted">Cancelled</span>
                  ) : (
                    <span className="text-ink-muted">No result yet</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        {externalOnly > 0 && (
          <p className="mt-3 text-xs text-ink-muted">
            {externalOnly} {externalOnly === 1 ? "match is" : "matches are"} between clubs that are not on Ovalball. They
            are part of this competition and counted in the table, because the competition&apos;s own record is what
            decides that — not whether a club happens to be a tenant.
          </p>
        )}
      </GoverningSection>
    </div>
  )
}
