"use client"

import { useState, useTransition } from "react"

import { cn } from "@/lib/utils"

import { submitFixtureResultAction } from "../../../messages/[kind]/[id]/result-actions"
import { FixtureResultAdminPanel } from "./fixture-result-admin-panel"

export interface HeroResultData {
  status: string
  homeScore: number | null
  awayScore: number | null
  amendmentHomeScore: number | null
  amendmentAwayScore: number | null
  kickoffPassed: boolean
  isCancelled: boolean
}

const STATE_LABEL: Record<string, { text: string; style: string }> = {
  awaiting_confirmation: { text: "Awaiting opposition confirmation", style: "bg-amber-100 text-amber-800" },
  final: { text: "Final", style: "bg-pitch-100 text-pitch-800" },
  disputed: { text: "Disputed", style: "bg-red-100 text-red-800" },
  amendment_pending: { text: "Amendment proposed", style: "bg-amber-100 text-amber-800" },
  external_recorded: { text: "Recorded — external opponent", style: "bg-ink/8 text-ink/60" },
}

/**
 * The scoreboard lives IN the hero (never a separate "Result" overview
 * card duplicating the same concept) -- neutral Home/Away framing, since
 * Site Admin is never "playing" a side the way a club official is on the
 * messages page's own W/L/D perspective view.
 */
export function FixtureHeroResult({ fixtureId, result }: { fixtureId: string; result: HeroResultData }) {
  const [showForm, setShowForm] = useState(false)
  const [home, setHome] = useState("")
  const [away, setAway] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (result.isCancelled) return null
  if (result.status === "none" && !result.kickoffPassed) return null

  const state = STATE_LABEL[result.status]

  function submit() {
    setError(null)
    startTransition(async () => {
      const res = await submitFixtureResultAction(fixtureId, Number(home), Number(away))
      if (!res.ok) {
        setError(res.error)
        return
      }
      setShowForm(false)
      setHome("")
      setAway("")
    })
  }

  return (
    <div className="mt-4 flex flex-col items-center gap-2 border-t border-ink/8 pt-4">
      {result.homeScore !== null && result.awayScore !== null && (
        <div className="flex items-center gap-4">
          <span className="font-display text-display-l text-ink">{result.homeScore}</span>
          <span className="text-sm font-medium text-ink/35">V</span>
          <span className="font-display text-display-l text-ink">{result.awayScore}</span>
        </div>
      )}
      {state && <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold tracking-[0.04em] uppercase", state.style)}>{state.text}</span>}

      {(result.status === "disputed" || result.status === "amendment_pending") && (
        <div className="mt-2 w-full max-w-md">
          <FixtureResultAdminPanel
            fixtureId={fixtureId}
            resultStatus={result.status}
            homeScore={result.homeScore}
            awayScore={result.awayScore}
            amendmentHomeScore={result.amendmentHomeScore}
            amendmentAwayScore={result.amendmentAwayScore}
          />
        </div>
      )}

      {(result.status === "none" || result.status === "awaiting_confirmation") && !showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="rounded-full bg-pitch-600 px-4 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-pitch-600/90 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          {result.status === "none" ? "Enter Result" : "Submit Result"}
        </button>
      )}

      {showForm && (
        <div className="mt-1 flex flex-wrap items-end justify-center gap-3">
          <label className="flex flex-col items-center gap-1">
            <span className="text-xs font-medium text-ink/50">Home</span>
            <input
              type="number"
              min={0}
              value={home}
              onChange={(e) => setHome(e.target.value)}
              className="w-16 rounded-md border border-ink/15 px-2 py-1.5 text-center text-sm outline-none focus-visible:border-pitch-600"
            />
          </label>
          <label className="flex flex-col items-center gap-1">
            <span className="text-xs font-medium text-ink/50">Away</span>
            <input
              type="number"
              min={0}
              value={away}
              onChange={(e) => setAway(e.target.value)}
              className="w-16 rounded-md border border-ink/15 px-2 py-1.5 text-center text-sm outline-none focus-visible:border-pitch-600"
            />
          </label>
          <button
            type="button"
            disabled={pending || home === "" || away === ""}
            onClick={submit}
            className="rounded-md bg-pitch-600 px-3.5 py-1.5 text-sm font-medium text-white outline-none hover:bg-pitch-600/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Submitting…" : "Submit Result"}
          </button>
          <button type="button" onClick={() => setShowForm(false)} className="text-sm font-medium text-ink/50 hover:text-ink">
            Cancel
          </button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
