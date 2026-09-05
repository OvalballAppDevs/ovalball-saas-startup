"use client"

import { useState } from "react"
import { GraduationCap } from "lucide-react"

import { Button } from "@/components/ui/button"

import { markGraduatingPlayerLeft, placeGraduatingPlayer } from "./actions"

export interface GraduationTargetTeamOption {
  id: string
  displayName: string
}

export interface GraduationQueueRow {
  id: string
  playerName: string
  previousTeamName: string
}

/**
 * RESUME SEASON HANDOVER Section 21-22: a real review surface for
 * player_graduation_queue -- no fake "Holding" team is ever created,
 * pending_placement is the queue's own honest status. place_graduating_
 * player enforces the real DOB/dispensation gate (Section 28) entirely
 * server-side; this UI's only job is to surface whatever it says,
 * never to pre-filter or second-guess which teams are "allowed".
 */
export function GraduationQueue({ rows, targetTeams }: { rows: GraduationQueueRow[]; targetTeams: GraduationTargetTeamOption[] }) {
  if (rows.length === 0) return null

  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white p-6">
      <div className="flex items-center gap-2">
        <GraduationCap className="size-4 text-forest-800" />
        <h2 className="font-display text-lg text-ink">Graduating players</h2>
      </div>
      <p className="mt-1.5 text-sm text-ink/55">
        Players from a graduated cohort wait here until you place them on a team or record that they&apos;ve left the club.
      </p>

      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <GraduationRow key={row.id} row={row} targetTeams={targetTeams} />
        ))}
      </div>
    </div>
  )
}

function GraduationRow({ row, targetTeams }: { row: GraduationQueueRow; targetTeams: GraduationTargetTeamOption[] }) {
  const [selectedTeam, setSelectedTeam] = useState(targetTeams[0]?.id ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<"placed" | "left" | null>(null)

  if (done === "placed") {
    return (
      <div className="rounded-lg border border-pitch-600/25 bg-mint-100/40 px-4 py-3 text-sm text-ink">
        <strong className="font-medium">{row.playerName}</strong> placed on {targetTeams.find((t) => t.id === selectedTeam)?.displayName ?? "the selected team"}.
      </div>
    )
  }
  if (done === "left") {
    return (
      <div className="rounded-lg border border-ink/10 bg-chalk/60 px-4 py-3 text-sm text-ink/70">
        <strong className="font-medium text-ink">{row.playerName}</strong> recorded as not continuing at this club.
      </div>
    )
  }

  async function place() {
    if (!selectedTeam) {
      setError("Choose a team first.")
      return
    }
    setPending(true)
    setError(null)
    const res = await placeGraduatingPlayer(row.id, selectedTeam)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setDone("placed")
  }

  async function markLeft() {
    setPending(true)
    setError(null)
    const res = await markGraduatingPlayerLeft(row.id)
    setPending(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setDone("left")
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-chalk/60 p-4">
      <p className="text-sm font-medium text-ink">{row.playerName}</p>
      <p className="text-xs text-ink/55">Previous team: {row.previousTeamName}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={selectedTeam}
          onChange={(e) => setSelectedTeam(e.target.value)}
          className="h-9 rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
        >
          {targetTeams.length === 0 && <option value="">No teams available</option>}
          {targetTeams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={pending || !selectedTeam} onClick={() => void place()}>
          Place on this team
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => void markLeft()}>
          Left the club
        </Button>
      </div>

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  )
}
