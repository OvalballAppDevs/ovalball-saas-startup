"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { Award, Check, Trophy, Users } from "lucide-react"

import {
  castAwardVote,
  closeAward,
  giveKudos,
  openAward,
  removeKudos,
  setTeamAwardCategory,
  withdrawAwardVote,
  withdrawKudos,
} from "@/app/(app)/fixtures/[fixtureId]/community-actions"
import type { AdminCategory, MatchAward, MatchCommunity, RecognitionSquadMember } from "@/lib/app-context/match-community"
import { cn } from "@/lib/utils"

/**
 * CONVERGENCE STEP 11 -- what a team did together, after the match.
 *
 * WHAT THIS IS NOT, AND THE SHAPE FOLLOWS FROM IT.
 *
 * It is not a leaderboard. No child is ever shown a ranking, a total or a position: an award that
 * has closed names the player who won it and says nothing about anybody else, and the counts exist
 * for the staff who ran it and nowhere on this page. There is nothing negative to give, because the
 * only vocabulary is positive and it is a fixed list.
 *
 * IT SITS BELOW THE RUGBY. The hero says what happened, the operational sections say who was
 * involved, and recognition comes after both -- an upcoming match shows none of it at all, because
 * there is nothing yet to recognise.
 *
 * ELIGIBILITY IS NOT A DESIGN DECISION. Every control here is rendered from a server-decided flag
 * and refused again by the server when pressed. Hiding a button is a courtesy to the person, never
 * the thing that stops them.
 */

interface Props {
  fixtureId: string
  community: MatchCommunity
  /** Display names for the sides, so an award can say whose it is without the viewer guessing. */
  teamNames: Record<string, string>
}

export function CommunityPanel({ fixtureId, community, teamNames }: Props) {
  const { awards, kudos, kudosKinds, squadByTeam, givableTeamIds, admin, report } = community
  if (awards.length === 0 && givableTeamIds.length === 0 && admin.length === 0 && !report) return null

  return (
    <section aria-labelledby="mc-community-heading" className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Trophy className="size-4 text-ink-muted" aria-hidden="true" />
        <h2 id="mc-community-heading" className="font-display text-base text-ink">
          After the Match
        </h2>
      </div>

      {report && (
        <p className="mb-4 text-sm">
          <Link href={`/teams/${report.teamId}/news/${report.articleId}`} className="text-ink underline hover:no-underline">
            {report.title}
          </Link>
          <span className="text-ink-muted"> — the match report</span>
        </p>
      )}

      {awards.length > 0 && (
        <ul className="flex flex-col gap-3">
          {awards.map((award) => (
            <AwardRow
              key={award.awardId}
              fixtureId={fixtureId}
              award={award}
              teamName={teamNames[award.teamId] ?? "the team"}
              squad={squadByTeam[award.teamId] ?? []}
            />
          ))}
        </ul>
      )}

      {admin.length > 0 && <StaffBlock fixtureId={fixtureId} admin={admin} teamNames={teamNames} />}

      {givableTeamIds.length > 0 && (
        <KudosBlock
          fixtureId={fixtureId}
          staffTeamIds={admin.map((a) => a.teamId)}
          teamIds={givableTeamIds}
          squadByTeam={squadByTeam}
          teamNames={teamNames}
          kudosKinds={kudosKinds}
          kudos={kudos}
        />
      )}
    </section>
  )
}

function AwardRow({
  fixtureId,
  award,
  teamName,
  squad,
}: {
  fixtureId: string
  award: MatchAward
  teamName: string
  squad: RecognitionSquadMember[]
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [choice, setChoice] = useState<string | null>(award.myVotePlayerId)

  return (
    <li className="rounded-xl border border-line px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-medium text-ink">
          <Award className="mr-1.5 -mt-0.5 inline size-3.5 text-ink-muted" aria-hidden="true" />
          {award.displayName}
        </h3>
        <span className="text-xs text-ink-muted">{teamName}</span>
      </div>

      {award.status === "CLOSED" ? (
        <p className="mt-2 text-sm text-ink">
          {award.outcome === "WINNER" && (
            <>
              <Trophy className="mr-1.5 -mt-0.5 inline size-3.5 text-ink-muted" aria-hidden="true" />
              {award.winnerName}
            </>
          )}
          {/* A tie is reported as a tie. Inventing a winner by a rule nobody agreed would be worse
              than saying what actually happened. */}
          {award.outcome === "TIE" && "It finished level, so this one is shared."}
          {award.outcome === "NO_VOTES" && "Nobody chose this time."}
          {award.canManage && award.totalVotes !== null && (
            <span className="ml-2 text-xs text-ink-muted">
              {award.totalVotes} {award.totalVotes === 1 ? "vote" : "votes"} · staff only
            </span>
          )}
        </p>
      ) : award.canVote ? (
        <div className="mt-2">
          <fieldset>
            <legend className="mb-1.5 text-xs text-ink-muted">Your choice</legend>
            <div className="flex flex-wrap gap-1.5">
              {squad.map((member) => {
                const selected = choice === member.playerId
                return (
                  <button
                    key={member.playerId}
                    type="button"
                    aria-pressed={selected}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setError(null)
                        const previous = choice
                        // Pressing your existing choice again takes it back, rather than
                        // pretending a second identical vote is a different one.
                        const result = selected
                          ? await withdrawAwardVote(fixtureId, award.awardId)
                          : await castAwardVote(fixtureId, award.awardId, member.playerId)
                        if (result.ok) setChoice(selected ? null : member.playerId)
                        else {
                          setChoice(previous)
                          setError(result.message)
                        }
                      })
                    }
                    className={cn(
                      "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm",
                      selected ? "border-forest-700 bg-forest-700 text-chalk" : "border-line text-ink hover:bg-surface-muted"
                    )}
                  >
                    {selected && <Check className="size-3.5" aria-hidden="true" />}
                    {member.displayName}
                  </button>
                )
              })}
            </div>
          </fieldset>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">Voting is open.</p>
      )}

      {award.canManage && award.status === "OPEN" && (
        <div className="mt-3">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null)
                const result = await closeAward(fixtureId, award.awardId)
                if (!result.ok) setError(result.message)
              })
            }
            className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm text-ink hover:bg-surface-muted"
          >
            Close Voting
          </button>
        </div>
      )}
    </li>
  )
}

function KudosBlock({
  fixtureId,
  staffTeamIds,
  teamIds,
  squadByTeam,
  teamNames,
  kudosKinds,
  kudos,
}: {
  fixtureId: string
  staffTeamIds: string[]
  teamIds: string[]
  squadByTeam: Record<string, RecognitionSquadMember[]>
  teamNames: Record<string, string>
  kudosKinds: MatchCommunity["kudosKinds"]
  kudos: MatchCommunity["kudos"]
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [player, setPlayer] = useState<string>("")
  const [kind, setKind] = useState<string>("")
  const teamId = teamIds[0]
  const squad = squadByTeam[teamId] ?? []

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="mb-2 flex items-center gap-2">
        <Users className="size-4 text-ink-muted" aria-hidden="true" />
        <h3 className="text-sm font-medium text-ink">Kudos</h3>
        <span className="text-xs text-ink-muted">{teamNames[teamId]}</span>
      </div>
      <p className="mb-3 text-sm text-ink-muted">
        Say thank you to somebody who made a difference. There is no score in this and nothing to win.
      </p>

      {kudos.length > 0 && (
        <ul className="mb-4 flex flex-col gap-1.5">
          {kudos.map((k) => (
            <li key={`${k.playerId}-${k.kudosKey}`} className="text-sm text-ink">
              <span className="font-medium">{k.playerName}</span>
              <span className="text-ink-muted"> — {k.label}</span>
              {k.givenCount > 1 && <span className="text-ink-muted"> ×{k.givenCount}</span>}
              {k.mine && (
                <>
                  <span className="ml-1.5 text-xs text-ink-muted">(including yours)</span>
                  <KudosWithdrawButton fixtureId={fixtureId} playerId={k.playerId} />
                </>
              )}
              {staffTeamIds.includes(k.teamId) && (
                <KudosRemoveButton fixtureId={fixtureId} teamId={k.teamId} playerId={k.playerId} kudosKey={k.kudosKey} />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Player
          <select
            value={player}
            onChange={(e) => setPlayer(e.target.value)}
            className="min-h-11 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
          >
            <option value="">Choose a player</option>
            {squad.map((m) => (
              <option key={m.playerId} value={m.playerId}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          For
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="min-h-11 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
          >
            <option value="">Choose recognition</option>
            {kudosKinds.map((k) => (
              <option key={k.kudosKey} value={k.kudosKey}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={pending || !player || !kind}
          onClick={() =>
            start(async () => {
              setError(null)
              const result = await giveKudos(fixtureId, teamId, player, kind)
              if (result.ok) {
                setPlayer("")
                setKind("")
              } else setError(result.message)
            })
          }
          className="inline-flex min-h-11 items-center rounded-full bg-forest-700 px-4 text-sm text-chalk disabled:opacity-50"
        >
          Give Kudos
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}

/**
 * WHAT THE TEAM RUNS, AND WHAT IT CALLS IT.
 *
 * Only staff for that side ever see this -- the server returns an empty set to everybody else, so
 * there is nothing to hide in React. An award cannot be opened until the team has switched it on,
 * which is why this exists on a match where nothing has happened yet.
 *
 * The name is a DISPLAY override. The canonical category, and with it who is entitled to vote, is
 * untouched by whatever a club types here.
 */
function StaffBlock({
  fixtureId,
  admin,
  teamNames,
}: {
  fixtureId: string
  admin: AdminCategory[]
  teamNames: Record<string, string>
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2 text-sm font-medium text-ink">Awards This Team Runs</h3>
      <p className="mb-3 text-sm text-ink-muted">
        Staff only. Switching an award on lets you open it after a match; the name is what your club calls it.
      </p>
      <ul className="flex flex-col gap-2">
        {admin.map((row) => (
          <li key={`${row.teamId}-${row.categoryKey}`} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-40 text-ink">{row.displayName}</span>
            <span className="text-xs text-ink-muted">{teamNames[row.teamId] ?? ""}</span>
            {!row.available ? (
              // Named rather than silently missing: the opposition has to be on Ovalball for its
              // coaches to be able to choose anything.
              <span className="text-xs text-ink-muted">Not available — the opposition is not on Ovalball</span>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending}
                  aria-pressed={row.enabled}
                  onClick={() =>
                    start(async () => {
                      setError(null)
                      const result = await setTeamAwardCategory(
                        fixtureId,
                        row.teamId,
                        row.categoryKey,
                        !row.enabled,
                        row.displayNameOverride
                      )
                      if (!result.ok) setError(result.message)
                    })
                  }
                  className={cn(
                    "inline-flex min-h-11 items-center rounded-full border px-3 text-xs",
                    row.enabled ? "border-forest-700 bg-forest-700 text-chalk" : "border-line text-ink"
                  )}
                >
                  {row.enabled ? "On" : "Off"}
                </button>
                {row.enabled && !row.awardId && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        setError(null)
                        const result = await openAward(fixtureId, row.teamId, row.categoryKey)
                        if (!result.ok) setError(result.message)
                      })
                    }
                    className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-xs text-ink hover:bg-surface-muted"
                  >
                    Open Voting
                  </button>
                )}
                {row.awardStatus && <span className="text-xs text-ink-muted">{row.awardStatus === "OPEN" ? "Open" : "Closed"}</span>}
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}

/** Staff taking recognition down. Removed rows keep who removed them and stop being displayed. */
export function KudosRemoveButton({
  fixtureId,
  teamId,
  playerId,
  kudosKey,
}: {
  fixtureId: string
  teamId: string
  playerId: string
  kudosKey: string
}) {
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await removeKudos(fixtureId, teamId, playerId, kudosKey)))}
      className="ml-2 text-xs text-ink-muted underline hover:text-ink"
    >
      Remove
    </button>
  )
}

/** A giver taking their own thank-you back. Deleted rather than marked removed: there is no
 *  moderation history worth keeping about somebody changing their own mind. */
export function KudosWithdrawButton({ fixtureId, playerId }: { fixtureId: string; playerId: string }) {
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await withdrawKudos(fixtureId, playerId)))}
      className="ml-2 text-xs text-ink-muted underline hover:text-ink"
    >
      Take Mine Back
    </button>
  )
}
