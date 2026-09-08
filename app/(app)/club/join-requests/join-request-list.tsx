"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

import { approveJoinRequest, declineJoinRequest } from "./actions"

export interface PlaceableTeam {
  id: string
  label: string
}

export interface JoinRequestRow {
  id: string
  playerName: string
  clubId: string
  clubName: string
  /** What Ovalball resolved when the player asked -- "Adult Men's Rugby", "Under 12 Girls". */
  resolvedCategory: string | null
  requestedOn: string
  teams: PlaceableTeam[]
}

/**
 * Accepting a player means choosing which of the club's sides they join.
 *
 * The squad picker is the point. Ovalball has established the category a player
 * is eligible for; the club establishes the team. Pre-selecting one would be
 * this screen making a selection decision on a manager's behalf, so nothing is
 * chosen until somebody chooses it.
 *
 * ALREADY RESOLVED IS A REAL ANSWER, NOT AN ERROR. Two managers can open this
 * page at the same time. When the second one clicks Accept, the server tells
 * them the request is already settled, and the row is refreshed to the truth
 * rather than left showing a decision that is no longer theirs to make.
 */
export function JoinRequestList({ requests }: { requests: JoinRequestRow[] }) {
  return (
    <ul className="mt-8 flex flex-col gap-3">
      {requests.map((request) => (
        <li key={request.id}>
          <JoinRequestCard request={request} />
        </li>
      ))}
    </ul>
  )
}

function JoinRequestCard({ request }: { request: JoinRequestRow }) {
  const router = useRouter()
  const [teamId, setTeamId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvedElsewhere, setResolvedElsewhere] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState("")

  async function handleApprove() {
    if (!teamId) {
      setError("Choose which of your teams this player joins.")
      return
    }
    setBusy(true)
    setError(null)
    const result = await approveJoinRequest(request.id, teamId)
    setBusy(false)
    if (result.ok) {
      router.refresh()
      return
    }
    if (result.alreadyResolved) {
      setResolvedElsewhere(true)
      router.refresh()
      return
    }
    setError(result.error)
  }

  async function handleDecline() {
    setBusy(true)
    setError(null)
    const result = await declineJoinRequest(request.id, reason)
    setBusy(false)
    if (result.ok) {
      router.refresh()
      return
    }
    if (result.alreadyResolved) {
      setResolvedElsewhere(true)
      router.refresh()
      return
    }
    setError(result.error)
  }

  if (resolvedElsewhere) {
    return (
      <div className="rounded-lg border border-ink/10 bg-ink/[0.02] px-4 py-3.5" aria-live="polite">
        <p className="text-sm font-medium text-ink">{request.playerName}</p>
        <p className="mt-1 text-sm text-ink-muted">
          Someone else at {request.clubName} has already dealt with this request. Nothing further is needed from you.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{request.playerName}</p>
          {request.resolvedCategory && (
            <p className="mt-0.5 text-sm text-ink-muted">
              Eligible for <span className="font-medium text-ink">{request.resolvedCategory}</span>
            </p>
          )}
        </div>
        <p className="shrink-0 text-xs text-ink-muted">
          Asked {new Date(request.requestedOn).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive-text">
          {error}
        </p>
      )}

      {declining ? (
        <div className="mt-4">
          <label htmlFor={`reason-${request.id}`} className="text-sm font-medium text-ink/80">
            Why? <span className="font-normal text-ink-muted">(optional, and the player will read it)</span>
          </label>
          <input
            id={`reason-${request.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. our squads are full this season"
            className="mt-2 h-11 w-full max-w-md rounded-lg border border-ink/15 px-3 text-sm outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="destructive" className="h-11" disabled={busy} onClick={handleDecline}>
              {busy ? "Sending…" : `Decline ${request.playerName}`}
            </Button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              className="min-h-11 text-sm text-ink-muted underline underline-offset-2 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`team-${request.id}`} className="text-sm font-medium text-ink/80">
              Which team?
            </label>
            <select
              id={`team-${request.id}`}
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="mt-1.5 block h-11 min-w-[14rem] rounded-lg border border-ink/15 bg-white px-3 text-sm outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <option value="">Choose a team…</option>
              {request.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" className="h-11" disabled={busy || !teamId} onClick={handleApprove}>
            {busy ? "Accepting…" : "Accept"}
          </Button>
          <button
            type="button"
            onClick={() => setDeclining(true)}
            className="min-h-11 text-sm text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Decline
          </button>
        </div>
      )}
    </div>
  )
}
