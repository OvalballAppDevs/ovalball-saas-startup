"use client"

import { useCallback, useRef, useState } from "react"

import { Autocomplete } from "@/components/ui/autocomplete"

import { type AddressResolveResult, type AddressSuggestResult, type AddressSuggestion, type CanonicalAddress, normalisePostcode, userMessageForFailure } from "@ovalball/contracts/address"

/**
 * THE SITEWIDE CANONICAL LOCATION SEARCH -- web. Type -> postcode suggestions -> explicit selection
 * -> resolve -> populate. It never applies anything on its own: `onResolve` fills the form fields the
 * same way typing would, so the caller's own Save action remains the only thing that writes.
 *
 * POSTCODE-FIRST, BECAUSE THAT IS WHAT CAN BE ANSWERED HONESTLY. The provider is postcodes.io, which
 * holds no Royal Mail / PAF property records. The list below therefore contains real POSTCODES, never
 * invented houses, and picking one resolves its true geography and coordinates. The building name and
 * street stay Ovalball's own data, confirmed by the person in the fields beside this control.
 *
 * NO CREDENTIAL EXISTS ANYWHERE IN THIS PATH. postcodes.io is public and keyless, so there is no
 * "not configured" state to surface and nothing to keep out of the browser. The search still goes
 * through a server action so that one normalisation, one validation and one failure vocabulary apply
 * -- shared with mobile via `@ovalball/contracts/address`.
 *
 * Caller-scoped: `search`/`resolve` are passed in rather than imported, so each caller supplies its
 * own authorization boundary (Site Admin's club_directory editor and Club Admin's venue editor need
 * different checks around the same service).
 */
export function AddressLookupField({
  search,
  resolve,
  onResolve,
}: {
  search: (query: string, sessionToken: string) => Promise<AddressSuggestResult>
  resolve: (placeId: string, sessionToken: string) => Promise<AddressResolveResult>
  onResolve: (address: CanonicalAddress) => void
}) {
  const [hint, setHint] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  // One Google billing session per search, reused by every keystroke and the final resolve.
  const sessionToken = useRef(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

  const runSearch = useCallback(
    async (query: string): Promise<AddressSuggestion[]> => {
      const result = await search(query, sessionToken.current)
      if (result.status === "ok") {
        // A bare postcode legitimately finds the street, not the houses -- Places is a place search,
        // not a Royal Mail address file. Say what to do next rather than looking broken.
        setHint(normalisePostcode(query) ? "That postcode finds the street. Add a house number or building name to pick the exact property." : null)
        return result.suggestions
      }
      setHint(userMessageForFailure(result))
      return []
    },
    [search]
  )

  async function handleSelect(placeId: string) {
    setResolving(true)
    setHint(null)
    try {
      const result = await resolve(placeId, sessionToken.current)
      if (result.status === "ok") {
        onResolve(result.address)
        // A new selection ends the billing session; the next search starts a fresh one.
        sessionToken.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
        setHint(result.address.postcodeSource === "reverse_geocoded" ? `Postcode ${result.address.postcode} was found from the map location — please check it.` : null)
        return
      }
      setHint(userMessageForFailure(result))
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-ink/15 p-4">
      <p className="text-sm font-medium text-ink">Look up address</p>
      <p className="mt-1 mb-2 text-xs text-ink-muted">
        Start typing a building name, street or postcode — suggestions appear as you type. Picking one fills in the full address and the map. Nothing is applied until you pick one.
      </p>

      <Autocomplete<AddressSuggestion>
        label="Address or postcode"
        placeholder="e.g. 23 Rosehill Road, Burnley"
        minChars={3}
        hint={resolving ? "Confirming address…" : (hint ?? undefined)}
        emptyMessage={hint ? "" : "We couldn't find that address."}
        onSearch={runSearch}
        optionKey={(s) => s.placeId}
        optionLabel={(s) => s.label}
        renderOption={(s) => (
          <>
            <span className="block truncate">{s.primary}</span>
            {s.secondary && <span className="block truncate text-xs text-ink-muted">{s.secondary}</span>}
          </>
        )}
        onSelect={(s) => void handleSelect(s.placeId)}
      />
    </div>
  )
}
