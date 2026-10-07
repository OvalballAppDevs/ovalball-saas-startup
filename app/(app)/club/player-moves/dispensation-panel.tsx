"use client"

import { useMemo, useState } from "react"

import { RequestDispensationForm } from "@/components/dispensations/request-dispensation-form"

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

const SELECT =
  "h-11 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-600/30 sm:w-auto"

/**
 * ASK FOR A DISPENSATION FROM PLAYER MOVES -- a player the club can see, and the team they would play for.
 * The one request form does the rest (20270742000000): it asks, it never grants, and the club's
 * Safeguarding Officer or a Club Admin decides on the record it opens. The server refuses a player who
 * already fits, a second live request, and anybody who may not ask.
 */
export function DispensationRequestPanel({ teams, players }: { teams: DispensationTeamOption[]; players: DispensationPlayerOption[] }) {
  const [teamId, setTeamId] = useState("")
  const [playerKey, setPlayerKey] = useState("")
  const choices = useMemo(() => players.filter((p) => p.currentTeamId !== teamId), [players, teamId])
  const player = choices.find((p) => `${p.playerId}:${p.currentTeamId}` === playerKey) ?? null
  const team = teams.find((t) => t.id === teamId) ?? null

  return (
    <div className="mt-4 rounded-lg border border-ink/10 bg-chalk/60 p-4">
      <h3 className="text-sm font-semibold text-ink">Request a Dispensation</h3>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <label className="sr-only" htmlFor="dispensation-team">
          Team
        </label>
        <select id="dispensation-team" value={teamId} onChange={(e) => {
            setTeamId(e.target.value)
            setPlayerKey("")
          }} className={SELECT}>
          <option value="">Choose the team…</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="dispensation-player">
          Player
        </label>
        <select id="dispensation-player" value={playerKey} disabled={!teamId} onChange={(e) => setPlayerKey(e.target.value)} className={`${SELECT} sm:min-w-[240px]`}>
          <option value="">Choose the player…</option>
          {choices.map((p) => (
            <option key={`${p.playerId}:${p.currentTeamId}`} value={`${p.playerId}:${p.currentTeamId}`}>
              {p.playerName} ({p.currentTeamName})
            </option>
          ))}
        </select>
      </div>
      {player && team && (
        <RequestDispensationForm
          key={`${player.playerId}:${team.id}`}
          playerId={player.playerId}
          playerName={player.playerName}
          teamId={team.id}
          teamLabel={team.displayName}
          sourceTeamId={player.currentTeamId}
          startOpen
        />
      )}
    </div>
  )
}
