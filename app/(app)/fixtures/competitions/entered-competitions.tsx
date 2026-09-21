import Link from "next/link"
import { AlertTriangle, ArrowRight, CheckCircle2, ListOrdered } from "lucide-react"

import { clubActionSentence, organiserSentence, type ClubCompetitionEntry } from "@/lib/competitions/club-entries"

/**
 * CONVERGENCE STEP 16 — THE COMPETITIONS THIS CLUB IS IN.
 *
 * The other half of the relationship. Steps 14–15 gave a governing body a competition product; a club
 * taking part in the county cup could see individual match requests and had nowhere that said WHICH
 * COMPETITIONS WE ARE IN, in which season, with which teams, and — the fact that was missing entirely —
 * WHO RUNS IT.
 *
 * DELIBERATELY NO ENTER OR WITHDRAW CONTROL. `competition_participants.status` is
 * ('entered','withdrawn') and only the organiser writes it; a club's canonical act is answering each
 * MATCH, which is what Competition Requests is for. Tournaments do have entry consent
 * (`respond_tournament_invitation`), which is what shows that competitions not having it is a decision
 * rather than an omission. A button here would be a promise the model cannot keep.
 */
export function EnteredCompetitions({ entries }: { entries: ClubCompetitionEntry[] }) {
  if (entries.length === 0) return null

  const needingAnswer = entries.reduce((n, e) => n + e.awaitingResponse, 0)

  return (
    <section aria-labelledby="entered-competitions" className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="entered-competitions" className="font-display text-xl text-ink">
          Competitions You&apos;re In
        </h2>
        <p className="text-sm text-ink-muted">
          {entries.length} {entries.length === 1 ? "competition" : "competitions"}
          {needingAnswer > 0 ? ` · ${needingAnswer} ${needingAnswer === 1 ? "match needs" : "matches need"} an answer` : ""}
        </p>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">
        Competitions your teams have been entered in by their organiser. Entering and withdrawing a team is
        the organiser&apos;s to do; answering each match is yours.
      </p>

      <ul className="mt-4 flex flex-col gap-2">
        {entries.map((e) => {
          const action = clubActionSentence(e)
          return (
            <li
              key={`${e.competitionId}:${e.editionId}`}
              className="rounded-lg border border-ink/10 bg-white px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{e.competitionName}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {e.seasonName} · {organiserSentence(e)}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {e.enteredTeams.length > 0 ? e.enteredTeams.join(" · ") : `${e.enteredCount} team entered`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm">
                  <Link
                    href={`/competitions/${e.competitionSlug}`}
                    className="inline-flex items-center gap-1 text-ink-muted hover:text-ink hover:underline"
                  >
                    <ListOrdered className="size-3.5" aria-hidden="true" />
                    Results &amp; Table
                  </Link>
                  {e.awaitingResponse > 0 && (
                    <Link
                      href="/fixtures/competitions/requests"
                      className="inline-flex items-center gap-1 font-medium text-forest-800 hover:underline"
                    >
                      Answer {e.awaitingResponse}
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </div>

              {/* WHAT NEEDS DOING, or that nothing does -- from the canonical verification rows only. */}
              <p className="mt-2 flex items-center gap-1.5 text-xs">
                {action ? (
                  <>
                    <AlertTriangle className="size-3.5 shrink-0 text-amber-700" aria-hidden="true" />
                    <span className="text-amber-800">{action}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-3.5 shrink-0 text-forest-800" aria-hidden="true" />
                    <span className="text-ink-muted">
                      {e.totalMatches === 0
                        ? "No matches drawn yet"
                        : `${e.played} of ${e.totalMatches} of your matches played`}
                    </span>
                  </>
                )}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
