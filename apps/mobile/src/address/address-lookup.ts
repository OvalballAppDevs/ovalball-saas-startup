import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@ovalball/contracts/database"
import { type AddressResolveResult, type AddressSuggestResult, type LocationFailure, type LocationResolveResult, type LocationSuggestResult, developerDetailForFailure } from "@ovalball/contracts/address"

/**
 * THE CANONICAL OVALBALL LOCATION SERVICE -- mobile transport.
 *
 * Calls the `address-lookup` Edge Function, which is the one place the postcodes.io payload becomes
 * an Ovalball `CanonicalLocation` (see that function's header for why it is retained even though
 * postcodes.io needs no key). There is NO credential anywhere in this path: postcodes.io is public,
 * so nothing here can be "not configured", and no secret exists to keep out of the bundle.
 *
 * It resolves POSTCODES. It never returns a property, and nothing downstream may invent one.
 */

type Client = SupabaseClient<Database>

/** A failed `functions.invoke` is the transport itself failing -- the function unreachable, or the
 * device offline. The function's own answers (not_found, invalid_query, provider_error...) come back
 * as DATA with a 200, and are passed through untouched, so a real "we couldn't find that postcode"
 * is never mistaken for a connectivity problem. */
function transportFailure(operation: string, error: unknown): LocationFailure {
  const name = (error as { name?: string } | null)?.name ?? ""
  const status = typeof (error as { context?: { status?: unknown } } | null)?.context?.status === "number" ? ((error as { context: { status: number } }).context.status as number) : null
  const failure: LocationFailure = status !== null ? { status: "provider_error", httpStatus: status } : { status: "network_error" }
  if (__DEV__) console.warn(`${developerDetailForFailure(operation, failure)} transport=${name || "unknown"}`)
  return failure
}

export async function suggestPostcodes(supabase: Client, query: string): Promise<LocationSuggestResult> {
  const { data, error } = await supabase.functions.invoke("address-lookup", { body: { mode: "suggest", q: query } })
  if (error) return transportFailure("suggest", error)
  return data as LocationSuggestResult
}

export async function resolvePostcode(supabase: Client, postcode: string): Promise<LocationResolveResult> {
  const { data, error } = await supabase.functions.invoke("address-lookup", { body: { mode: "resolve", postcode } })
  if (error) return transportFailure("resolve", error)
  return data as LocationResolveResult
}

/** PROPERTY-LEVEL SEARCH (Google Places, via the Edge Function that holds the key).
 *
 * `sessionToken` is a cost control, not a detail: Google bills autocomplete per request unless the
 * requests form a session ending in a resolve that carries the same token. The caller generates one
 * token per search and hands the same one to `resolveAddress`, so an eight-keystroke search is billed
 * as one session rather than eight lookups. */
export async function suggestAddresses(supabase: Client, query: string, sessionToken: string): Promise<AddressSuggestResult> {
  const { data, error } = await supabase.functions.invoke("address-lookup", { body: { mode: "address-suggest", q: query, sessionToken } })
  if (error) return transportFailure("address-suggest", error)
  return data as AddressSuggestResult
}

export async function resolveAddress(supabase: Client, placeId: string, sessionToken: string): Promise<AddressResolveResult> {
  const { data, error } = await supabase.functions.invoke("address-lookup", { body: { mode: "address-resolve", placeId, sessionToken } })
  if (error) return transportFailure("address-resolve", error)
  return data as AddressResolveResult
}
