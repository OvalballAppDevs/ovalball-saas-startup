"use client"

import { useCallback } from "react"

import { Autocomplete } from "@/components/ui/autocomplete"

import { searchTeams, type TeamSearchResult } from "./actions"

/**
 * Canonical team selection by stable `team_id`, never a name string.
 *
 * Club-aware by construction: every suggestion shows the owning club and
 * town, so "Men's 1st Team" at two different clubs is never ambiguous and
 * a Site Admin never has to infer ownership from a duplicate name.
 *
 * Converged onto the shared Autocomplete primitive. It already searched as
 * you typed, but with no debounce (a request per keystroke, and a slow
 * early response could overwrite a later one) and no keyboard support. It
 * now behaves exactly like the club lookup and the venue address field --
 * one primitive, one set of accessibility guarantees.
 */
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
  const runSearch = useCallback((q: string) => searchTeams(q), [])

  if (selected) {
    return (
      <div>
        <span className="text-sm text-ink/70">{label}</span>
        <div className="mt-1.5 flex items-center justify-between gap-3 rounded-lg border border-pitch-600/40 bg-pitch-600/5 px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{selected.teamName}</p>
            <p className="truncate text-xs text-ink/50">
              {selected.clubName}
              {selected.town ? `, ${selected.town}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="shrink-0 rounded text-xs font-medium text-ink/50 underline outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Change
          </button>
        </div>
      </div>
    )
  }

  return (
    <Autocomplete<TeamSearchResult>
      label={label}
      placeholder={placeholder}
      minChars={2}
      emptyMessage="No team matches that search."
      onSearch={runSearch}
      optionKey={(t) => t.teamId}
      optionLabel={(t) => `${t.teamName}, ${t.clubName}${t.town ? `, ${t.town}` : ""}`}
      renderOption={(t) => (
        <>
          <span className="block truncate font-medium text-ink">{t.teamName}</span>
          <span className="block truncate text-xs text-ink/50">
            {t.clubName}
            {t.town ? `, ${t.town}` : ""}
          </span>
        </>
      )}
      onSelect={(t) => onSelect(t)}
    />
  )
}
