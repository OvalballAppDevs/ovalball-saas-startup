"use client"

import { useState, useTransition } from "react"

import { ClubAvatar } from "@/components/club/club-avatar"
import { cn } from "@/lib/utils"

import { submitFixtureResultAction } from "./result-actions"

export interface FixtureResultData {
  status: string
  homeScore: number | null
  awayScore: number | null
  amendmentHomeScore: number | null
  amendmentAwayScore: number | null
  myHomeAway: string | null
  kickoffPassed: boolean
  isCancelled: boolean
  rugbyCode: "union" | "league"
  deadlineAt: string | null
  /** True when MY club is the one that submitted the pending score -- there is nothing for me to confirm or dispute until the OTHER side responds. */
  submittedByMe: boolean
}

function wldFor(myHomeAway: string | null, homeScore: number | null, awayScore: number | null): "W" | "L" | "D" | null {
  if ((myHomeAway !== "Home" && myHomeAway !== "Away") || homeScore === null || awayScore === null) return null
  const mine = myHomeAway === "Home" ? homeScore : awayScore
  const theirs = myHomeAway === "Home" ? awayScore : homeScore
  if (mine > theirs) return "W"
  if (mine < theirs) return "L"
  return "D"
}

const WLD_STYLES: Record<"W" | "L" | "D", string> = {
  W: "bg-pitch-100 text-pitch-800",
  L: "bg-red-100 text-red-800",
  D: "bg-amber-100 text-amber-800",
}
const WLD_WORD: Record<"W" | "L" | "D", string> = { W: "Win", L: "Loss", D: "Draw" }

const TRY_POINTS: Record<"union" | "league", number> = { union: 5, league: 4 }

function deadlineLabel(deadlineAt: string | null): string | null {
  if (!deadlineAt) return null
  const ms = new Date(deadlineAt).getTime() - Date.now()
  if (ms <= 0) return "Awaiting automatic reconciliation"
  const hours = Math.ceil(ms / (1000 * 60 * 60))
  if (hours <= 1) return "Less than 1 hour left to respond"
  if (hours < 24) return `${hours} hours left to respond`
  return "24 hours left to respond"
}

/**
 * Home stays visually left/home and Away stays right/away regardless of
 * which club is viewing -- homeClubName/awayClubName/homeClubLogoUrl/
 * awayClubLogoUrl are resolved by the PAGE from the real home_away value,
 * never swapped here by viewer perspective.
 */
export function FixtureResultPanel({
  fixtureId,
  result,
  homeClubName,
  awayClubName,
  homeClubLogoUrl,
  awayClubLogoUrl,
}: {
  fixtureId: string
  result: FixtureResultData
  homeClubName: string
  awayClubName: string
  homeClubLogoUrl: string | null
  awayClubLogoUrl: string | null
}) {
  const [pending, startTransition] = useTransition()
  const [homeInput, setHomeInput] = useState("")
  const [awayInput, setAwayInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  if (result.isCancelled) return null
  if (result.status === "none" && !result.kickoffPassed) return null // never a result-entry control before real kickoff

  const wld = result.status === "final" || result.status === "external_recorded" ? wldFor(result.myHomeAway, result.homeScore, result.awayScore) : null
  const canRespond = result.status === "awaiting_confirmation" && result.myHomeAway !== null && !result.submittedByMe
  const deadline = deadlineLabel(result.deadlineAt)

  function handleSubmit(home: number, away: number) {
    setError(null)
    startTransition(async () => {
      const res = await submitFixtureResultAction(fixtureId, home, away)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setShowForm(false)
      setHomeInput("")
      setAwayInput("")
    })
  }

  function handleConfirm() {
    if (result.homeScore === null || result.awayScore === null) return
    handleSubmit(result.homeScore, result.awayScore)
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink/60">Result</p>
        <div className="flex items-center gap-2">
          {result.status === "none" && <span className="text-sm text-ink/50">Result pending</span>}
          {result.status === "awaiting_confirmation" && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              Result pending &middot; awaiting confirmation
            </span>
          )}
          {result.status === "disputed" && (
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">Result disputed</span>
          )}
          {result.status === "unverified" && (
            <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-medium text-ink/60">
              Unverified result &middot; not an official record
            </span>
          )}
          {result.status === "amendment_pending" && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
              Result pending &middot; amendment proposed
            </span>
          )}
          {(result.status === "final" || result.status === "external_recorded") && wld && (
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", WLD_STYLES[wld])} aria-label={WLD_WORD[wld]}>
              {wld} &middot; {WLD_WORD[wld]}
            </span>
          )}
          {result.status === "external_recorded" && <span className="text-xs text-ink/45">External opponent &middot; not mutually confirmed</span>}
        </div>
      </div>

      {result.homeScore !== null && result.awayScore !== null && (
        <div className="mt-4 flex items-center justify-center gap-6 sm:gap-10">
          <div className="flex flex-1 flex-col items-center gap-2 text-center">
            <ClubAvatar logoUrl={homeClubLogoUrl} name={homeClubName} size="md" />
            <p className="max-w-[9rem] truncate text-sm font-medium text-ink">{homeClubName}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="font-display text-display-l text-ink">{result.homeScore}</span>
            <span className="text-sm font-medium text-ink/30">v</span>
            <span className="font-display text-display-l text-ink">{result.awayScore}</span>
          </div>
          <div className="flex flex-1 flex-col items-center gap-2 text-center">
            <ClubAvatar logoUrl={awayClubLogoUrl} name={awayClubName} size="md" />
            <p className="max-w-[9rem] truncate text-sm font-medium text-ink">{awayClubName}</p>
          </div>
        </div>
      )}

      {deadline && (result.status === "awaiting_confirmation" || result.status === "disputed") && (
        <p className="mt-2 text-center text-xs text-ink/45">{deadline}</p>
      )}

      {result.status === "amendment_pending" && result.amendmentHomeScore !== null && result.amendmentAwayScore !== null && (
        <p className="mt-2 text-center text-sm text-ink/60">
          Proposed amendment: {result.amendmentHomeScore} &ndash; {result.amendmentAwayScore} (original {result.homeScore} &ndash;{" "}
          {result.awayScore} preserved until confirmed)
        </p>
      )}

      {!showForm && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {canRespond ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={handleConfirm}
                className="rounded-md bg-pitch-600 px-3.5 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-pitch-600/90 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                Confirm Result
              </button>
              <button
                type="button"
                onClick={() => {
                  setHomeInput(String(result.homeScore ?? ""))
                  setAwayInput(String(result.awayScore ?? ""))
                  setShowForm(true)
                }}
                className="rounded-md border border-destructive/30 px-3.5 py-1.5 text-sm font-medium text-destructive outline-none transition-colors hover:bg-destructive/5 focus-visible:ring-2 focus-visible:ring-destructive/40"
              >
                Dispute
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1">
              {result.status === "awaiting_confirmation" && result.submittedByMe && (
                <p className="text-xs text-ink/45">You submitted this score &mdash; waiting for the other side to confirm or dispute it.</p>
              )}
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
              >
                {result.status === "none"
                  ? "Enter result"
                  : result.status === "final"
                    ? "Request Result Change"
                    : result.status === "awaiting_confirmation" && result.submittedByMe
                      ? "Revise your score"
                      : "Submit score"}
              </button>
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="mt-3 flex flex-col gap-2 border-t border-ink/8 pt-3">
          <p className="text-xs text-ink/50">
            {result.rugbyCode === "union"
              ? `Enter total points. A try is worth ${TRY_POINTS.union} points in Rugby Union -- conversions, penalties, and drop goals all count toward the total, so it does not need to be a multiple of ${TRY_POINTS.union}.`
              : `Enter total points. A try is worth ${TRY_POINTS.league} points in Rugby League -- conversions and penalties all count toward the total, so it does not need to be a multiple of ${TRY_POINTS.league}.`}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink/50">Home ({homeClubName}) score</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={homeInput}
                onChange={(e) => setHomeInput(e.target.value)}
                className="w-20 rounded-md border border-ink/15 px-2.5 py-1.5 text-sm outline-none focus-visible:border-pitch-600"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink/50">Away ({awayClubName}) score</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={awayInput}
                onChange={(e) => setAwayInput(e.target.value)}
                className="w-20 rounded-md border border-ink/15 px-2.5 py-1.5 text-sm outline-none focus-visible:border-pitch-600"
              />
            </label>
            <button
              type="button"
              disabled={pending || homeInput === "" || awayInput === ""}
              onClick={() => handleSubmit(Number(homeInput), Number(awayInput))}
              className="rounded-md bg-pitch-600 px-3.5 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-pitch-600/90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              {pending ? "Submitting…" : "Submit"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="text-sm font-medium text-ink/50 hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
