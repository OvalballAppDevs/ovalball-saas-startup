"use client"

import { useState } from "react"

import { searchTeams, type TeamSearchResult } from "./actions"

/** Canonical team selection by stable id, never a name string -- shows club/town context so "Men's 1st Team" at two different clubs is never ambiguous, per the brief's own requirement. */
export function TeamSearchInput({
  label,
  selected,
  onSelect,
  placeholder = "Search club or team name…",
}: {
  label: string
  selected: TeamSearchResult | null
  onSelect: (team: TeamSearchResult | null) => void
  placeholder?: string
}) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<TeamSearchResult[]>([])
  const [searching, setSearching] = useState(false)

  async function handleChange(value: string) {
    setQuery(value)
    if (value.trim().length < 2) {
      setResults([])
      return
    }
    setSearching(true)
    const found = await searchTeams(value)
    setSearching(false)
    setResults(found)
  }

  if (selected) {
    return (
      <div>
        <span className="text-sm text-ink/70">{label}</span>
        <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-pitch-600/40 bg-pitch-600/5 px-3.5 py-2.5">
          <div>
            <p className="text-sm font-medium text-ink">{selected.teamName}</p>
            <p className="text-xs text-ink/50">
              {selected.clubName}
              {selected.town ? `, ${selected.town}` : ""}
            </p>
          </div>
          <button type="button" onClick={() => onSelect(null)} className="text-xs font-medium text-ink/50 underline hover:text-ink">
            Change
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <label className="text-sm text-ink/70">
        {label}
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />
      </label>
      {searching && <p className="mt-1 text-xs text-ink/40">Searching&hellip;</p>}
      {results.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1 rounded-lg border border-ink/10 bg-white p-1.5">
          {results.map((t) => (
            <li key={t.teamId}>
              <button
                type="button"
                onClick={() => {
                  onSelect(t)
                  setQuery("")
                  setResults([])
                }}
                className="flex w-full flex-col items-start rounded-md px-2.5 py-1.5 text-left outline-none hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                <span className="text-sm font-medium text-ink">{t.teamName}</span>
                <span className="text-xs text-ink/50">
                  {t.clubName}
                  {t.town ? `, ${t.town}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
