"use client"

import { useMemo, useState } from "react"
import { ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"

import { decideDispensation, requestDispensation, revokeDispensation, type DispensationStage } from "./actions"

export interface DispensationTeamOption {
  id: string
  displayName: string
}

export interface DispensationPlayerOption {
  playerId: string
  playerName: string
  currentTeamId: string
  currentTeamName: string
}

export type DispensationStatus = "requested" | "source_team_approved" | "club_approved" | "approved" | "rejected" | "expired" | "revoked"

export interface DispensationRow {
  id: string
  playerName: string
  sourceTeamId: string
  sourceTeamName: string
  targetTeamName: string
  seasonName: string
  eligibilityRuleReference: string
  governingBodyReference: string | null
  status: DispensationStatus
  canDecideSourceTeam: boolean
  canDecideClub: boolean
}

const STATUS_LABEL: Record<DispensationStatus, string> = {
  requested: "Awaiting source-team approval",
  source_team_approved: "Awaiting club approval",
  club_approved: "Awaiting governing-body approval",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  revoked: "Revoked",
}

/**
 * RESUME SEASON HANDOVER Section 25: the full staged dispensation chain
 * (source team -> club -> governing body) as real UI. No stage can be
 * skipped -- each button only appears when the record is actually at
 * that stage -- and approving the final stage only ever RECORDS a
 * reference the club holds; the copy is explicit that Ovalball itself
 * never grants governing-body approval.
 */
export function DispensationPanel({
  seasonId,
  seasonName,
  teams,
  players,
  rows,
}: {
  seasonId: string | null
  seasonName: string | null
  teams: DispensationTeamOption[]
  players: DispensationPlayerOption[]
  rows: DispensationRow[]
}) {
  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white p-6">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4 text-forest-800" />
        <h2 className="font-display text-lg text-ink">Team dispensations</h2>
      </div>
      <p className="mt-1.5 text-sm text-ink/55">
        A longer-term move outside ordinary age-grade eligibility for {seasonName ?? "the current season"}. Ovalball records each approval stage -- it
        never grants governing-body approval itself.
      </p>

      {seasonId && <DispensationRequestForm seasonId={seasonId} teams={teams} players={players} />}

      <div className="mt-6 space-y-3 border-t border-ink/10 pt-4">
        {rows.length === 0 ? <p className="text-sm text-ink/50">No dispensations yet.</p> : rows.map((row) => <DispensationRowItem key={row.id} row={row} />)}
      </div>
    </div>
  )
}

function DispensationRequestForm({ seasonId, teams, players }: { seasonId: string; teams: DispensationTeamOption[]; players: DispensationPlayerOption[] }) {
  const [targetTeamId, setTargetTeamId] = useState(teams[0]?.id ?? "")
  const [playerKey, setPlayerKey] = useState("")
  const [eligibility, setEligibility] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const eligiblePlayers = useMemo(() => players.filter((p) => p.currentTeamId !== targetTeamId), [players, targetTeamId])

  async function submit() {
    const player = eligiblePlayers.find((p) => `${p.playerId}:${p.currentTeamId}` === playerKey)
    if (!player || !eligibility.trim()) {
      setError("Choose a player and state the eligibility rule this dispensation relies on.")
      return
    }
    setPending(true)
    setError(null)
    setSuccess(null)
    const res = await requestDispensation(player.playerId, player.currentTeamId, targetTeamId, seasonId, eligibility.trim())
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setSuccess(`Dispensation requested for ${player.playerName}. ${player.currentTeamName} must approve first.`)
    setEligibility("")
    setPlayerKey("")
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-ink/10 bg-chalk/60 p-4">
      <p className="text-xs font-medium tracking-wide text-ink/55 uppercase">Request a dispensation</p>
      <div className="flex flex-wrap gap-2">
        <select
          value={targetTeamId}
          onChange={(e) => setTargetTeamId(e.target.value)}
          className="h-9 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              Onto {t.displayName}
            </option>
          ))}
        </select>
        <select
          value={playerKey}
          onChange={(e) => setPlayerKey(e.target.value)}
          className="h-9 min-w-[220px] rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
        >
          <option value="">Choose the player...</option>
          {eligiblePlayers.map((p) => (
            <option key={`${p.playerId}:${p.currentTeamId}`} value={`${p.playerId}:${p.currentTeamId}`}>
              {p.playerName} ({p.currentTeamName})
            </option>
          ))}
        </select>
      </div>
      <input
        value={eligibility}
        onChange={(e) => setEligibility(e.target.value)}
        placeholder='Eligibility rule reference (e.g. "GOVERNING-BODY CONFIRMATION REQUIRED" if not yet verified)'
        className="h-9 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      {success && <p className="text-sm text-forest-800">{success}</p>}
      <Button size="sm" disabled={pending} onClick={() => void submit()}>
        {pending ? "Requesting..." : "Request dispensation"}
      </Button>
    </div>
  )
}

function DispensationRowItem({ row }: { row: DispensationRow }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState(row.status)
  const [govRef, setGovRef] = useState("")

  async function decide(stage: DispensationStage, approve: boolean, governingBodyReference: string | null) {
    setPending(true)
    setError(null)
    const res = await decideDispensation(row.id, stage, approve, governingBodyReference, null)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setStatus(!approve ? "rejected" : stage === "source_team" ? "source_team_approved" : stage === "club" ? "club_approved" : "approved")
  }

  async function revoke() {
    setPending(true)
    setError(null)
    const res = await revokeDispensation(row.id, "Revoked by club")
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setStatus("revoked")
  }

  return (
    <div className="rounded-lg border border-ink/10 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">
            {row.playerName}: {row.sourceTeamName} → {row.targetTeamName}
          </p>
          <p className="text-xs text-ink/55">
            {row.seasonName} · {row.eligibilityRuleReference}
            {row.governingBodyReference && ` · Ref: ${row.governingBodyReference}`}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            status === "approved" ? "bg-mint-100/70 text-forest-950" : status.endsWith("approved") ? "bg-amber-50 text-amber-900" : "bg-ink/5 text-ink/60"
          }`}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      {row.canDecideSourceTeam && status === "requested" && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => void decide("source_team", true, null)}>
            Approve as source team
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void decide("source_team", false, null)}>
            Reject
          </Button>
        </div>
      )}
      {row.canDecideClub && status === "source_team_approved" && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => void decide("club", true, null)}>
            Approve as club
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void decide("club", false, null)}>
            Reject
          </Button>
        </div>
      )}
      {row.canDecideClub && status === "club_approved" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={govRef}
            onChange={(e) => setGovRef(e.target.value)}
            placeholder="Governing-body reference / certificate number"
            className="h-9 min-w-[220px] rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
          <Button size="sm" disabled={pending || !govRef.trim()} onClick={() => void decide("governing_body", true, govRef.trim())}>
            Record governing-body approval
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void decide("governing_body", false, null)}>
            Reject
          </Button>
        </div>
      )}
      {row.canDecideClub && status === "approved" && (
        <div className="mt-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => void revoke()}>
            Revoke
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}
