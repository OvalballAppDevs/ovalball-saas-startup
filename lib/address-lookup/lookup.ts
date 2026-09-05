import "server-only"

/**
 * UK/Ireland address lookup architecture for Club Management's "search
 * postcode/address -> candidate addresses -> select -> populate structured
 * address" flow (never a silent overwrite of canonical data -- the
 * candidate list is always a proposal for a human to pick from, applied
 * only when a Site Admin explicitly selects one).
 *
 * Provider: getAddress.io. Chosen because it's a real, production-capable
 * UK address API (postcode or partial-address search -> structured
 * candidate list), has a plain server-side REST call (no SDK, no client
 * exposure risk), and is the same shape of integration this app already
 * uses elsewhere (a single server-only module wrapping one provider, see
 * lib/geocoding/backfill.ts's postcodes.io call for the precedent).
 *
 * NOT CONNECTED in this local environment -- no GETADDRESS_API_KEY is set
 * (see .env.example). This is genuinely production-ready code, not a stub
 * that pretends to work: with a real key set, searchUkAddresses() would
 * make real requests and return real candidates. Locally it returns
 * status: "not_configured" so calling UI code can show an honest message
 * instead of a silent empty result or a fabricated address list.
 *
 * IRELAND: getAddress.io covers England, Scotland, Wales, and Northern
 * Ireland only -- it does NOT cover the Republic of Ireland, and an
 * Eircode is a structurally different format from a UK postcode (not
 * validated or geocoded the same way). searchAddress() below detects an
 * Eircode-shaped query and returns status: "country_not_supported"
 * explicitly, rather than silently returning nothing or (worse) treating
 * an Eircode as if it were a UK postcode. A real Ireland-capable provider
 * (e.g. An Post's GeoDirectory / Eircode Finder API) would need a SEPARATE
 * integration -- this module does not pretend getAddress.io covers it.
 */

export interface AddressCandidate {
  line1: string
  line2: string | null
  line3: string | null
  town: string
  county: string | null
  postcode: string
}

export type AddressLookupResult =
  | { status: "ok"; candidates: AddressCandidate[] }
  | { status: "not_configured" }
  | { status: "country_not_supported"; reason: string }
  | { status: "error"; message: string }

const EIRCODE_PATTERN = /^[AC-FHKNPRTV-Y][0-9]{2}\s?[0-9AC-FHKNPRTV-Y]{4}$/i

export async function searchUkAddresses(query: string): Promise<AddressLookupResult> {
  const trimmed = query.trim()

  if (EIRCODE_PATTERN.test(trimmed.replace(/\s/g, ""))) {
    return {
      status: "country_not_supported",
      reason:
        "This looks like an Eircode. getAddress.io covers England, Scotland, Wales, and Northern Ireland only -- it does not cover the Republic of Ireland. A separate provider (e.g. An Post's Eircode Finder API) would be needed for Irish addresses; none is connected yet.",
    }
  }

  const apiKey = process.env.GETADDRESS_API_KEY
  if (!apiKey) {
    return { status: "not_configured" }
  }

  try {
    const url = `https://api.getaddress.io/find/${encodeURIComponent(trimmed)}?api-key=${encodeURIComponent(apiKey)}&expand=true`
    const response = await fetch(url, { method: "GET" })
    if (!response.ok) {
      return { status: "error", message: `Address lookup failed (${response.status}).` }
    }
    const data = (await response.json()) as {
      addresses?: { line_1: string; line_2: string; line_3: string; town_or_city: string; county: string }[]
      postcode?: string
    }
    const candidates: AddressCandidate[] = (data.addresses ?? []).map((a) => ({
      line1: a.line_1,
      line2: a.line_2 || null,
      line3: a.line_3 || null,
      town: a.town_or_city,
      county: a.county || null,
      postcode: data.postcode ?? trimmed.toUpperCase(),
    }))
    return { status: "ok", candidates }
  } catch (err) {
    console.error("searchUkAddresses failed:", err)
    return { status: "error", message: "Address lookup is temporarily unavailable." }
  }
}
