import "server-only"

import {
  type AddressResolveResult,
  type AddressSuggestResult,
  type LocationResolveResult,
  type LocationSuggestResult,
  type PostcodesIoResult,
  mapGooglePlace,
  mapPostcodesIoResult,
  normalisePostcode,
  splitPredictionText,
} from "@ovalball/contracts/address"

/**
 * THE CANONICAL OVALBALL LOCATION SERVICE -- web side.
 *
 * Provider: postcodes.io. Public, keyless, no account, no secret. This module reads NO environment
 * variable and has no "not configured" state: `GETADDRESS_API_KEY` is gone from the runtime entirely
 * (it survives only in the historical migration that once mentioned it, which is left alone rather
 * than rewritten).
 *
 * WHY THIS IS server-only DESPITE NEEDING NO KEY. Not to hide a credential -- there isn't one -- but
 * so the normalisation is applied in exactly one place per client. The response shape, the postcode
 * validation and the failure vocabulary all come from `@ovalball/contracts/address`, the same
 * contract the mobile Edge Function serves, so web and mobile cannot drift on what a location is or
 * on what "not found" means.
 *
 * IT RESOLVES POSTCODES, NOT PROPERTIES. postcodes.io holds no Royal Mail/PAF property records, so
 * nothing here can return "23 Rosehill Road" as a confirmed address, and nothing may synthesise one.
 * The venue's own address lines are Ovalball's data, typed and confirmed by a person.
 */

const POSTCODES_IO = "https://api.postcodes.io"

/** Candidate POSTCODES for a partial query -- never properties. */
export async function suggestPostcodes(query: string): Promise<LocationSuggestResult> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return { status: "invalid_query", reason: "Type at least two characters." }
  try {
    // `/postcodes?q=` rather than `/autocomplete`: it returns whole records, so each suggestion can
    // carry its district and a person has something to choose between. Same single request.
    const res = await fetch(`${POSTCODES_IO}/postcodes?q=${encodeURIComponent(trimmed)}&limit=10`)
    if (!res.ok) return { status: "provider_error", httpStatus: res.status }
    const body = (await res.json()) as { result?: PostcodesIoResult[] | null }
    // A 200 with result:null is postcodes.io's "nothing matched" -- a real answer, not a broken one.
    if (body.result === null || body.result === undefined) return { status: "ok", suggestions: [] }
    if (!Array.isArray(body.result)) return { status: "malformed_response" }
    return { status: "ok", suggestions: body.result.filter((r) => typeof r.postcode === "string").map((r) => ({ postcode: r.postcode as string, adminDistrict: r.admin_district ?? null })) }
  } catch {
    return { status: "network_error" }
  }
}

/** Was this a real postcode Royal Mail has since withdrawn? Only asked once an ordinary lookup has
 * already missed, so it costs nothing on the normal path -- and it turns a misleading "we couldn't
 * find that" into the truth for the historic addresses a club directory is full of. */
async function terminatedFailure(canonical: string): Promise<LocationResolveResult | null> {
  try {
    const res = await fetch(`${POSTCODES_IO}/terminated_postcodes/${encodeURIComponent(canonical.replace(/\s/g, ""))}`)
    if (!res.ok) return null
    const body = (await res.json()) as { result?: { postcode?: string; year_terminated?: number } | null }
    if (!body.result || typeof body.result.year_terminated !== "number") return null
    return { status: "terminated", postcode: body.result.postcode ?? canonical, yearTerminated: body.result.year_terminated }
  } catch {
    return null
  }
}

/** One postcode -> its real geography and coordinates. */
export async function resolvePostcode(raw: string): Promise<LocationResolveResult> {
  const canonical = normalisePostcode(raw)
  if (!canonical) return { status: "invalid_query", reason: "That doesn't look like a complete UK postcode." }
  try {
    const res = await fetch(`${POSTCODES_IO}/postcodes/${encodeURIComponent(canonical.replace(/\s/g, ""))}`)
    if (res.status === 404) return (await terminatedFailure(canonical)) ?? { status: "not_found" }
    if (!res.ok) return { status: "provider_error", httpStatus: res.status }
    const body = (await res.json()) as { result?: PostcodesIoResult | null }
    if (!body.result) return (await terminatedFailure(canonical)) ?? { status: "not_found" }
    const location = mapPostcodesIoResult(body.result)
    if (!location) return { status: "malformed_response" }
    return { status: "ok", location, precision: "postcode" }
  } catch {
    return { status: "network_error" }
  }
}

// =====================================================================================================
// PROPERTY-LEVEL ADDRESS SEARCH (Google Places API New) -- the canonical interactive path.
//
// Identical provider rules and identical mapping to the mobile Edge Function, because both call
// `mapGooglePlace` from the shared contract. The key is read from the server environment and never
// reaches the browser: this module is `server-only` and its callers are server actions.
// =====================================================================================================

const PLACES = "https://places.googleapis.com/v1"
const placesKey = () => process.env.GOOGLE_PLACES_API_KEY ?? ""

export async function suggestAddresses(query: string, sessionToken: string): Promise<AddressSuggestResult> {
  if (!placesKey()) return { status: "invalid_query", reason: "Address search is not configured in this environment." }
  const trimmed = query.trim()
  if (trimmed.length < 3) return { status: "invalid_query", reason: "Type at least three characters." }
  try {
    const body: Record<string, unknown> = { input: trimmed, includedRegionCodes: ["gb"] }
    if (sessionToken) body.sessionToken = sessionToken
    const res = await fetch(`${PLACES}/places:autocomplete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": placesKey() },
      body: JSON.stringify(body),
    })
    if (!res.ok) return { status: "provider_error", httpStatus: res.status }
    const data = (await res.json()) as { suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string } } }[] }
    const suggestions = (data.suggestions ?? [])
      .map((x) => x.placePrediction)
      .filter((p): p is { placeId: string; text?: { text?: string } } => typeof p?.placeId === "string")
      .map((p) => {
        const label = p.text?.text ?? ""
        return { placeId: p.placeId, label, ...splitPredictionText(label) }
      })
    return { status: "ok", suggestions }
  } catch {
    return { status: "network_error" }
  }
}

export async function resolveAddress(placeId: string, sessionToken: string): Promise<AddressResolveResult> {
  if (!placesKey()) return { status: "invalid_query", reason: "Address search is not configured in this environment." }
  if (!placeId.trim()) return { status: "invalid_query", reason: "No address was selected." }
  try {
    const url = new URL(`${PLACES}/places/${encodeURIComponent(placeId)}`)
    if (sessionToken) url.searchParams.set("sessionToken", sessionToken)
    const res = await fetch(url.toString(), { headers: { "X-Goog-Api-Key": placesKey(), "X-Goog-FieldMask": "id,addressComponents,location" } })
    if (res.status === 404) return { status: "not_found" }
    if (!res.ok) return { status: "provider_error", httpStatus: res.status }
    const address = mapGooglePlace(await res.json())
    if (!address) return { status: "malformed_response" }

    // Same two-provider cooperation as mobile: Google gives no postcode for a whole street, so
    // postcodes.io reverse-geocodes the coordinate it DID give, labelled as such.
    if (!address.postcode && address.latitude !== null && address.longitude !== null) {
      try {
        const rev = await fetch(`${POSTCODES_IO}/postcodes?lat=${address.latitude}&lon=${address.longitude}&limit=1`)
        if (rev.ok) {
          const body = (await rev.json()) as { result?: { postcode?: string }[] | null }
          const nearest = body.result?.[0]?.postcode
          if (typeof nearest === "string") {
            address.postcode = nearest
            address.postcodeSource = "reverse_geocoded"
          }
        }
      } catch {
        // A failed fill is not a failed resolution.
      }
    }
    return { status: "ok", address }
  } catch {
    return { status: "network_error" }
  }
}
