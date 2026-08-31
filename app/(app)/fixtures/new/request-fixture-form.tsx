"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createFixtureRequest } from "./actions"
import { searchOpponentClubs, type OpponentSearchResult } from "./search-opponents"

interface Team {
  id: string
  displayName: string
}

interface TeamSelection {
  selected: boolean
  venuePreference: "home" | "away" | "either"
  kickoffTime: string
  note: string
}

interface InitialOpponent {
  directoryId: string
  clubId: string
  name: string
}

interface SuggestedTargetTeam {
  id: string
  displayName: string
}

export function RequestFixtureForm({
  clubId,
  teams,
  initialOpponent = null,
  initialDate = null,
  suggestedTargetTeam = null,
}: {
  clubId: string
  teams: Team[]
  initialOpponent?: InitialOpponent | null
  initialDate?: string | null
  suggestedTargetTeam?: SuggestedTargetTeam | null
}) {
  const [step, setStep] = useState<"details" | "review">("details")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<OpponentSearchResult[]>([])
  const [searching, startSearch] = useTransition()
  const [opponent, setOpponent] = useState<OpponentSearchResult | null>(
    initialOpponent
      ? { directoryId: initialOpponent.directoryId, clubId: initialOpponent.clubId, name: initialOpponent.name, town: null }
      : null
  )
  const [editingOpponent, setEditingOpponent] = useState(!initialOpponent)
  const [targetTeam, setTargetTeam] = useState(suggestedTargetTeam)
  const [date, setDate] = useState(initialDate ?? "")
  const [selections, setSelections] = useState<Record<string, TeamSelection>>(
    Object.fromEntries(teams.map((t) => [t.id, { selected: false, venuePreference: "either", kickoffTime: "", note: "" }]))
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function updateSelection(teamId: string, patch: Partial<TeamSelection>) {
    setSelections((prev) => ({ ...prev, [teamId]: { ...prev[teamId], ...patch } }))
  }

  function handleQueryChange(value: string) {
    setQuery(value)
    setOpponent(null)
    startSearch(async () => {
      const r = await searchOpponentClubs(value)
      setResults(r)
    })
  }

  const selectedTeams = teams.filter((t) => selections[t.id]?.selected)
  const canReview = Boolean(opponent) && Boolean(date) && selectedTeams.length > 0

  async function handleSubmit() {
    if (!opponent) return
    setSubmitting(true)
    setError(null)
    const result = await createFixtureRequest({
      requestingClubId: clubId,
      opponentDirectoryId: opponent.directoryId,
      opponentClubId: opponent.clubId,
      rawOpponentText: opponent.name,
      proposedDate: date,
      notes: null,
      teams: selectedTeams.map((t) => ({
        teamId: t.id,
        venuePreference: selections[t.id].venuePreference,
        preferredKickoffTime: selections[t.id].kickoffTime || null,
        note: selections[t.id].note || null,
        // Only attach the suggested opposing team when exactly one of our
        // own teams is in this batch -- with several selected there's no
        // single correct target for all of them, so each is left for the
        // responding side to resolve on accept, same as the normal flow.
        targetTeamId: targetTeam && selectedTeams.length === 1 ? targetTeam.id : null,
      })),
    })
    setSubmitting(false)
    if (result && !result.ok) {
      setError(result.error)
    }
    // On success the action itself redirects (throws NEXT_REDIRECT), so
    // there is no success branch to handle here.
  }

  if (step === "review") {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-6">
        <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Review request</p>
        <h2 className="mt-2 font-display text-display-l text-ink">
          vs {opponent?.name}
          {targetTeam && selectedTeams.length === 1 ? ` ${targetTeam.displayName}` : ""}
        </h2>
        <p className="mt-1 text-sm text-ink/55">
          {date ? new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""}
        </p>

        <ul className="mt-5 flex flex-col gap-2">
          {selectedTeams.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-lg border border-ink/10 px-4 py-3">
              <span className="text-sm font-medium text-ink">{t.displayName}</span>
              <span className="text-sm text-ink/60">
                {selections[t.id].venuePreference === "home" ? "Home" : selections[t.id].venuePreference === "away" ? "Away" : "Either"}
                {selections[t.id].kickoffTime ? ` · ${selections[t.id].kickoffTime}` : ""}
              </span>
            </li>
          ))}
        </ul>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <div className="mt-6 flex items-center gap-3">
          <Button type="button" variant="ghost" className="h-10" onClick={() => setStep("details")} disabled={submitting}>
            Back
          </Button>
          <Button type="button" className="h-10" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Sending…" : "Send request"}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-6">
      <div>
        <Label htmlFor="opponent-search" className="text-ink/80">
          Partner club
        </Label>
        {opponent && !editingOpponent ? (
          <div className="mt-1.5 flex items-center justify-between rounded-lg border border-ink/15 bg-mint-100/40 px-3.5 py-2.5">
            <div>
              <p className="text-sm font-medium text-ink">{opponent.name}</p>
              {targetTeam && (
                <p className="text-xs text-ink/55">Checking availability for their {targetTeam.displayName}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingOpponent(true)
                setOpponent(null)
                setQuery("")
                setTargetTeam(null)
              }}
              className="shrink-0 text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
            >
              Change
            </button>
          </div>
        ) : (
          <Input
            id="opponent-search"
            value={opponent ? opponent.name : query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search by club name"
            className="mt-1.5 h-11 border-ink/15 bg-white"
          />
        )}
        {editingOpponent && !opponent && query.trim().length >= 2 && (
          <div className="mt-2 flex flex-col gap-1 rounded-lg border border-ink/10 bg-white p-1">
            {searching && <p className="px-3 py-2 text-sm text-ink/45">Searching…</p>}
            {!searching && results.length === 0 && <p className="px-3 py-2 text-sm text-ink/45">No clubs found.</p>}
            {results.map((r) => (
              <button
                key={r.directoryId}
                type="button"
                onClick={() => {
                  setOpponent(r)
                  setQuery(r.name)
                  setResults([])
                  setEditingOpponent(false)
                }}
                className="rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-ink/5"
              >
                {r.name}
                {r.town ? <span className="text-ink/45"> · {r.town}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <Label htmlFor="fixture-date" className="text-ink/80">
          Date
        </Label>
        <Input
          id="fixture-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1.5 h-11 w-48 border-ink/15 bg-white"
        />
      </div>

      <div className="mt-5">
        <p className="text-sm font-medium text-ink/80">Select your team(s)</p>
        <div className="mt-2 flex flex-col gap-2">
          {teams.map((t) => {
            const sel = selections[t.id]
            return (
              <div key={t.id} className="rounded-lg border border-ink/10 px-4 py-3">
                <label className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={sel.selected}
                    onChange={(e) => updateSelection(t.id, { selected: e.target.checked })}
                    className="size-4 accent-pitch-600"
                  />
                  <span className="text-sm font-medium text-ink">{t.displayName}</span>
                </label>
                {sel.selected && (
                  <div className="mt-3 flex flex-wrap items-center gap-4 pl-6">
                    <div className="flex items-center gap-3">
                      {(["home", "away", "either"] as const).map((v) => (
                        <label key={v} className="flex items-center gap-1.5 text-sm text-ink/70">
                          <input
                            type="radio"
                            name={`venue-${t.id}`}
                            checked={sel.venuePreference === v}
                            onChange={() => updateSelection(t.id, { venuePreference: v })}
                            className="accent-pitch-600"
                          />
                          {v === "home" ? "Home" : v === "away" ? "Away" : "Either"}
                        </label>
                      ))}
                    </div>
                    <Input
                      type="time"
                      value={sel.kickoffTime}
                      onChange={(e) => updateSelection(t.id, { kickoffTime: e.target.value })}
                      className="h-9 w-32 border-ink/15 bg-white text-sm"
                      placeholder="Kick-off"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-6">
        <Button type="button" className="h-10" disabled={!canReview} onClick={() => setStep("review")}>
          Review request
        </Button>
      </div>
    </div>
  )
}
