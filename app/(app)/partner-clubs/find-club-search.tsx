"use client"

import { useState, useTransition } from "react"
import { Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { requestPartnership } from "./actions"
import { searchActivatedClubs, type ActivatedClubSearchResult } from "./search-clubs"

const RUGBY_CODE_LABEL: Record<string, string> = { union: "Union", league: "League" }

/**
 * relatedClubIds: clubs the caller already has an active or pending
 * relationship with (either direction) -- disabled in results rather than
 * hidden, so "why can't I request this one" stays visible instead of the
 * club silently disappearing.
 */
export function FindClubSearch({ ownClubId, relatedClubIds }: { ownClubId: string; relatedClubIds: string[] }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ActivatedClubSearchResult[]>([])
  const [searching, startSearch] = useTransition()
  const [requestingId, setRequestingId] = useState<string | null>(null)
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  function handleQueryChange(value: string) {
    setQuery(value)
    setError(null)
    startSearch(async () => {
      const r = await searchActivatedClubs(value, ownClubId)
      setResults(r)
    })
  }

  async function handleRequest(clubId: string) {
    setRequestingId(clubId)
    setError(null)
    const result = await requestPartnership(clubId)
    setRequestingId(null)
    if (result.ok) {
      setSentIds((prev) => new Set(prev).add(clubId))
    } else {
      setError(result.error)
    }
  }

  return (
    <div>
      <Label htmlFor="find-club-search" className="sr-only">
        Search by club name
      </Label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink/35" />
        <Input
          id="find-club-search"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search by club name"
          className="h-12 border-ink/15 bg-white pl-10"
        />
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {query.trim().length >= 2 && (
        <ul className="mt-3 flex flex-col gap-2" aria-live="polite">
          {searching && <li className="px-1 py-2 text-sm text-ink/45">Searching…</li>}
          {!searching && results.length === 0 && <li className="px-1 py-2 text-sm text-ink/45">No clubs found.</li>}
          {results.map((club) => {
            const related = relatedClubIds.includes(club.clubId)
            const sent = sentIds.has(club.clubId)
            return (
              <li
                key={club.directoryId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{club.name}</p>
                  <p className="text-xs text-ink/50">
                    {[club.town, club.county].filter(Boolean).join(", ") || "Location unknown"} ·{" "}
                    {RUGBY_CODE_LABEL[club.rugbyCode] ?? club.rugbyCode}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={related || sent ? "outline" : "default"}
                  className="h-9 shrink-0"
                  disabled={related || sent || requestingId === club.clubId}
                  onClick={() => handleRequest(club.clubId)}
                >
                  {related ? "Already related" : sent ? "Requested" : requestingId === club.clubId ? "Sending…" : "Request partnership"}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
