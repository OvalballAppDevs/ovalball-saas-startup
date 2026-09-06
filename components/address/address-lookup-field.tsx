"use client"

import { useCallback, useRef, useState } from "react"

import { Autocomplete } from "@/components/ui/autocomplete"

import type { AddressCandidate, AddressLookupResult } from "@/lib/address-lookup/lookup"

/**
 * Type -> suggestions -> explicit selection -> populate. Never applies
 * anything on its own: onSelect fills the form fields the same way typing
 * would, so the caller's own Save action remains the only thing that writes.
 *
 * Previously this was a text box plus a Search BUTTON: nothing happened
 * until you clicked it, which is the "address entry is buggy / suggestions
 * don't appear" report. It now searches automatically after three
 * characters and a debounce, through the shared Autocomplete primitive --
 * the same one Site Admin's club lookup uses, so the two behave identically
 * and there is one implementation to keep accessible.
 *
 * Provider-agnostic and caller-scoped: `search` is passed in rather than
 * imported, so each caller supplies its own authorization boundary around
 * lib/address-lookup/lookup.ts (Site Admin's club_directory editor and Club
 * Admin's venue editor need different checks around the same provider).
 *
 * The provider is server-only and its key never reaches the browser. When
 * no key is configured the provider reports `not_configured`, and this
 * surfaces that as an honest hint pointing at manual entry rather than an
 * empty list that looks like "no such address".
 */
export function AddressLookupField({
  search,
  onSelect,
}: {
  search: (query: string) => Promise<AddressLookupResult>
  onSelect: (address: { address: string; town: string; county: string; postcode: string }) => void
}) {
  const [hint, setHint] = useState<string | null>(null)
  // Held in a ref so setting it does not re-run the debounce effect.
  const lastStatus = useRef<AddressLookupResult["status"] | null>(null)

  const runSearch = useCallback(
    async (query: string): Promise<AddressCandidate[]> => {
      const result = await search(query)
      lastStatus.current = result.status

      if (result.status === "ok") {
        setHint(null)
        return result.candidates
      }
      if (result.status === "not_configured") {
        setHint("Address lookup isn't connected in this environment — enter the address manually below.")
        return []
      }
      if (result.status === "country_not_supported") {
        setHint(result.reason)
        return []
      }
      setHint(result.message)
      return []
    },
    [search]
  )

  return (
    <div className="rounded-lg border border-dashed border-ink/15 p-4">
      <p className="text-sm font-medium text-ink">Look up address</p>
      <p className="mt-1 mb-2 text-xs text-ink/50">
        Start typing a postcode or address — suggestions appear as you type. Nothing is applied
        until you pick one.
      </p>

      <Autocomplete<AddressCandidate>
        label="Postcode or address"
        placeholder="e.g. BB11 or 1 Belvedere Road…"
        minChars={3}
        hint={hint ?? undefined}
        emptyMessage="No addresses found for that search."
        onSearch={runSearch}
        optionKey={(c) => [c.line1, c.line2, c.postcode].filter(Boolean).join("|")}
        optionLabel={(c) => [c.line1, c.line2, c.town, c.postcode].filter(Boolean).join(", ")}
        renderOption={(c) => (
          <>
            <span className="block truncate">{[c.line1, c.line2].filter(Boolean).join(", ")}</span>
            <span className="block truncate text-xs text-ink/50">
              {[c.town, c.county, c.postcode].filter(Boolean).join(", ")}
            </span>
          </>
        )}
        onSelect={(c) =>
          onSelect({
            // line1..line3 are joined because `venues.address` is a single
            // text column today. The provider's structured lines are not
            // discarded lightly -- see the structured-address gap recorded
            // in docs/CLUB_SETUP_AND_VENUES.md.
            address: [c.line1, c.line2, c.line3].filter(Boolean).join(", "),
            town: c.town,
            county: c.county ?? "",
            postcode: c.postcode,
          })
        }
      />
    </div>
  )
}
