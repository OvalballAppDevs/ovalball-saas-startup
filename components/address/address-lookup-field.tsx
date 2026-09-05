"use client"

import { useState } from "react"
import { Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import type { AddressCandidate, AddressLookupResult } from "@/lib/address-lookup/lookup"

/**
 * Search -> candidate list -> explicit selection -> populate. Never
 * applies anything on its own -- onSelect just fills the form fields the
 * same way typing would, so the caller's own Save action is still the
 * only thing that actually writes anywhere.
 *
 * Provider-agnostic and caller-scoped: `search` is passed in rather than
 * imported directly, so each caller supplies its own authorization
 * boundary around lib/address-lookup/lookup.ts's searchUkAddresses (Site
 * Admin's club_directory editor and Club Admin's venue editor need
 * different checks around the same underlying provider call).
 */
export function AddressLookupField({
  search,
  onSelect,
}: {
  search: (query: string) => Promise<AddressLookupResult>
  onSelect: (address: { address: string; town: string; county: string; postcode: string }) => void
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"idle" | "searching" | "done">("idle")
  const [candidates, setCandidates] = useState<AddressCandidate[]>([])
  const [message, setMessage] = useState<string | null>(null)

  async function handleSearch() {
    setStatus("searching")
    setMessage(null)
    setCandidates([])
    const result = await search(query)
    setStatus("done")
    if (result.status === "ok") {
      setCandidates(result.candidates)
      if (result.candidates.length === 0) setMessage("No addresses found for that search.")
    } else if (result.status === "not_configured") {
      setMessage("Address lookup isn't connected in this environment. Enter the address manually below.")
    } else if (result.status === "country_not_supported") {
      setMessage(result.reason)
    } else {
      setMessage(result.message)
    }
  }

  function handlePick(candidate: AddressCandidate) {
    onSelect({
      address: [candidate.line1, candidate.line2, candidate.line3].filter(Boolean).join(", "),
      town: candidate.town,
      county: candidate.county ?? "",
      postcode: candidate.postcode,
    })
    setCandidates([])
    setQuery("")
    setMessage(null)
  }

  return (
    <div className="rounded-lg border border-dashed border-ink/15 p-4">
      <p className="text-sm font-medium text-ink">Look up address</p>
      <p className="mt-1 text-xs text-ink/50">
        Search a postcode or address, then pick the right result. Never applied without your selection.
      </p>
      <div className="mt-2 flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Postcode or address…"
          className="h-9 border-ink/15 bg-white"
        />
        <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-1.5" disabled={status === "searching" || query.trim().length < 3} onClick={handleSearch}>
          <Search className="size-3.5" />
          {status === "searching" ? "Searching…" : "Search"}
        </Button>
      </div>
      {message && (
        <p className="mt-2 text-xs text-ink/55" role="status" aria-live="polite">
          {message}
        </p>
      )}
      {candidates.length > 0 && (
        <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
          {candidates.map((c, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => handlePick(c)}
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-ink outline-none hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                {[c.line1, c.line2, c.town, c.postcode].filter(Boolean).join(", ")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
