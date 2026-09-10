"use client"

import { useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Check, Mail, Users } from "lucide-react"

import { Button } from "@/components/ui/button"

import { combinedSchedule, type TournamentCentreContext } from "@/lib/tournaments/view-model"
import { respondTournamentInvitation } from "@/app/(app)/tournaments/actions"
import { cn } from "@/lib/utils"

import { TournamentOpposition } from "./opposition"
import { TournamentPitches } from "./pitches-panel"
import { CombinedSchedule, TeamSchedule } from "./schedule"

/**
 * TOURNAMENT CENTRE -- ONE SHARED ROLE-AWARE SURFACE.
 *
 * There is no Parent, Player, Team Admin or Club Admin Tournament Centre. This
 * one component tree renders for every viewer; what changes is the DATA the
 * server sent and the capability flags on it (`canManageTournament` for the
 * occasion, `canManageEntry` per team). A redesign here therefore reaches
 * every role automatically, which is the whole point.
 *
 * THE SWITCHER. A club at a festival with two teams has two different days,
 * and a parent watching one child does not want to read the other team's
 * schedule to find their own. So the teams are tabs, the selection lives in
 * the URL (`?team=`), and the club-wide combined view is one more tab rather
 * than a separate page -- "which of ours is on Pitch 1 at 11:20" is the same
 * question asked at club level.
 *
 * The URL carries the SELECTION, never the authority: an entry id in the query
 * string chooses which tab is open and nothing else. Every capability on this
 * page was decided server-side before the payload was built.
 */
export function TournamentCentreView({ tournament }: { tournament: TournamentCentreContext }) {
  const router = useRouter()
  const params = useSearchParams()

  const entries = tournament.entries
  const requested = params.get("team")
  const multiTeam = entries.length > 1
  // WHICH TAB OPENS. An explicit ?team= always wins. Otherwise the viewer's
  // OWN team does -- a parent at a two-team festival should land on their
  // child's morning, not on the side that happened to sort first.
  const mine = entries.find((e) => e.isMine)
  // "all" is only meaningful when there is more than one team to combine.
  const selected =
    multiTeam && requested === "all"
      ? "all"
      : (entries.find((e) => e.id === requested)?.id ?? mine?.id ?? entries[0]?.id ?? null)

  function select(next: string) {
    const q = new URLSearchParams(params.toString())
    q.set("team", next)
    router.replace(`?${q.toString()}`, { scroll: false })
  }

  const activeEntry = entries.find((e) => e.id === selected) ?? null

  return (
    <div className="flex flex-col gap-4">
      {tournament.invitations.length > 0 && <InvitationPanel tournament={tournament} />}
      {tournament.pitches.length > 0 && <TournamentPitches reservations={tournament.pitches} isMultiDay={tournament.isMultiDay} />}

      {entries.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-ink/15 bg-white p-6 text-center">
          <Users className="mx-auto size-6 text-ink-subtle" aria-hidden="true" />
          <p className="mt-2 font-medium text-ink">No teams entered yet</p>
          <p className="mt-1 text-sm text-ink-muted">
            {tournament.canManageTournament
              ? "Add the teams going to this tournament and their opponents will follow."
              : "Nobody from the club has been entered into this tournament yet."}
          </p>
        </section>
      ) : (
        <>
          {multiTeam && (
            <nav aria-label="Teams at this tournament">
              {/* SELECTED IS NEVER COLOUR ALONE: the active tab carries a tick,
                  a heavier weight and an underline, and reports aria-current. */}
              <ul className="flex flex-wrap gap-1 border-b border-ink/10">
                {entries.map((e) => {
                  const active = selected === e.id
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        aria-current={active ? "true" : undefined}
                        onClick={() => select(e.id)}
                        className={cn(
                          "-mb-px inline-flex h-11 items-center gap-1.5 border-b-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                          active ? "border-forest-800 font-semibold text-ink" : "border-transparent text-ink-muted hover:text-ink"
                        )}
                      >
                        {active && <Check className="size-3.5" aria-hidden="true" />}
                        {e.teamName}
                      </button>
                    </li>
                  )
                })}
                <li>
                  <button
                    type="button"
                    aria-current={selected === "all" ? "true" : undefined}
                    onClick={() => select("all")}
                    className={cn(
                      "-mb-px inline-flex h-11 items-center gap-1.5 border-b-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400",
                      selected === "all" ? "border-forest-800 font-semibold text-ink" : "border-transparent text-ink-muted hover:text-ink"
                    )}
                  >
                    {selected === "all" && <Check className="size-3.5" aria-hidden="true" />}
                    Everyone
                  </button>
                </li>
              </ul>
            </nav>
          )}

          {selected === "all" ? (
            <CombinedSchedule rows={combinedSchedule(entries)} />
          ) : activeEntry ? (
            <>
              <TournamentOpposition entry={activeEntry} />
              <TeamSchedule entry={activeEntry} />
            </>
          ) : null}
        </>
      )}

      {tournament.notes && (
        <section aria-labelledby="tc-notes" className="rounded-2xl border border-ink/10 bg-white p-4 sm:p-5">
          <h2 id="tc-notes" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
            Tournament Details
          </h2>
          <p className="mt-2 text-sm whitespace-pre-line text-ink">{tournament.notes}</p>
        </section>
      )}
    </div>
  )
}

/**
 * AN INVITATION TO SOMEBODY ELSE'S TOURNAMENT.
 *
 * Shown only to the people entitled to answer it -- the server decided that
 * before the payload was built, and respond_tournament_invitation re-checks it
 * -- and shown here rather than in a Calendar pop-over, because the invitation
 * is a fact about this tournament and belongs where the tournament is.
 */
function InvitationPanel({ tournament }: { tournament: TournamentCentreContext }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <section aria-labelledby="tc-invites" className="rounded-2xl border border-forest-800/20 bg-forest-800/[0.04] p-4 sm:p-5">
      <h2 id="tc-invites" className="flex items-center gap-1.5 text-sm font-medium tracking-[0.04em] text-forest-900 uppercase">
        <Mail className="size-3.5" aria-hidden="true" />
        Invitation
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {tournament.invitations.map((i) => (
          <li key={i.participantId} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-ink">
              {tournament.hostName} has invited <span className="font-medium">{i.clubName} {i.teamTypeLabel}</span>.
            </span>
            <span className="flex items-center gap-2">
              <Button
                type="button"
                className="h-11 sm:h-10"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await respondTournamentInvitation(tournament.id, i.participantId, true)
                    if (!r.ok) setError(r.error)
                    else router.refresh()
                  })
                }
              >
                Accept
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-11 sm:h-10"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await respondTournamentInvitation(tournament.id, i.participantId, false)
                    if (!r.ok) setError(r.error)
                    else router.refresh()
                  })
                }
              >
                Decline
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-text">{error}</p>}
    </section>
  )
}
