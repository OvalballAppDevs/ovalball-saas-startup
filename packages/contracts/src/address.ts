/**
 * THE ONE CANONICAL OVALBALL LOCATION CONTRACT.
 *
 * Provider: postcodes.io, and only postcodes.io. It is a public, keyless API -- there is no account,
 * no API key, no secret and therefore no "not configured" state anywhere in this system. Anything
 * that asks for a credential to search an address is a bug, not a missing setup step.
 *
 * WHAT THIS DELIBERATELY IS NOT. postcodes.io serves postcode and geographic truth; it has no
 * Royal Mail / PAF property records, so it cannot say that "23 Rosehill Road" is a particular house.
 * This contract therefore never returns a property. It resolves a POSTCODE to its real geography and
 * coordinates, and Ovalball stores the venue's own address lines alongside that. A house number or
 * street that a person types is THEIR text, stored as Ovalball data -- never presented as something a
 * provider confirmed, and never manufactured by gluing a number onto a guessed road.
 *
 * WHO OWNS WHICH FIELD -- and note what is deliberately MISSING from the provider's column:
 *
 *   postcodes.io owns   postcode (canonical spacing), latitude, longitude, adminDistrict, county
 *                       (admin_county), region, nation
 *   Ovalball owns       line1, line2, TOWN, and `country`
 *
 * TOWN IS OVALBALL'S, NOT THE PROVIDER'S. postcodes.io returns `admin_district`, which is the LOCAL
 * AUTHORITY, and a local authority is not a postal town. BB10 2LS is a Burnley address whose
 * admin_district is "Pendle"; writing that into `venues.town` would replace a correct postal town
 * with the name of a council. postcodes.io has no postal-town field at all, so this contract does not
 * pretend otherwise: `adminDistrict` is returned as CONTEXT for a person to read beside a postcode,
 * and is never mapped to `town`. Where Ovalball needs a town, it keeps the one it already has or the
 * one a person types.
 *
 * `county` IS mapped, because `admin_county` genuinely is a county -- but it is null across every
 * metropolitan district and all of Scotland/Wales/NI, and a null is reported as a null.
 *
 * `country` is deliberately NOT postcodes.io's value. postcodes.io answers with the nation
 * ("England", "Scotland", "Wales", "Northern Ireland"); `venues.country` has always held
 * "United Kingdom" and is what an address line prints. Both facts are real and they are different
 * facts, so they are carried in two fields rather than one being quietly overwritten with the other.
 */

/** The resolved geography for one postcode. Coordinates are the postcode's own position -- the centre
 * of its delivery point cluster -- and must never be described to a person as an exact building
 * location. `town`/`county`/`region` are nullable because postcodes.io genuinely returns null for
 * them in places (most metropolitan districts have no administrative county at all); a null is
 * reported as a null rather than back-filled with a plausible guess. */
export interface CanonicalLocation {
  postcode: string
  latitude: number
  longitude: number
  /** The LOCAL AUTHORITY (postcodes.io `admin_district`). Context only -- never a postal town, and
   * never written into `venues.town`. See the header note for why. */
  adminDistrict: string | null
  county: string | null
  region: string | null
  /** England / Scotland / Wales / Northern Ireland, straight from postcodes.io. */
  nation: string | null
  /** Ovalball's own value, always "United Kingdom" -- see the header note. */
  country: string
}

/** The failure vocabulary. Every one of these is distinguishable internally, because collapsing them
 * into a single "couldn't reach address lookup" is exactly what once hid a real gateway fault for an
 * entire debugging session. The user-facing wording stays simple -- see `userMessageForFailure`. */
export type LocationFailure =
  | { status: "not_found" }
  /** The postcode was real and has since been withdrawn by Royal Mail. Worth telling a person
   * apart from "no such postcode": a club directory full of historic addresses will legitimately
   * contain these, and "we couldn't find that" would wrongly imply a typo. */
  | { status: "terminated"; postcode: string; yearTerminated: number }
  | { status: "invalid_query"; reason: string }
  | { status: "provider_error"; httpStatus: number }
  | { status: "network_error" }
  | { status: "malformed_response" }

/** A suggestion carries the place with the postcode. A list of bare postcodes is close to useless --
 * "BB11 1AD, BB11 1AE, BB11 1AP" tells a person nothing about which one is theirs -- so the search
 * endpoint (`/postcodes?q=`) is used in place of `/autocomplete`, because it returns whole records
 * rather than strings. `town` is the administrative district, which is the local authority and not
 * always the postal town; it is shown as context, never written over a town a person already has. */
export interface PostcodeSuggestion {
  postcode: string
  /** The local authority, shown beside the postcode so two candidates can be told apart. Context for
   * a human eye only -- it is not a postal town and nothing writes it to one. */
  adminDistrict: string | null
}

export type LocationSuggestResult = { status: "ok"; suggestions: PostcodeSuggestion[] } | LocationFailure
/** How coarse the coordinate is. "postcode" is a full postcode's own position; "outcode" is an
 * outward code's centroid, which can be a mile or more out. Neither is a building. Carried explicitly
 * so a caller can say so rather than implying a precision it does not have. */
export type LocationPrecision = "postcode" | "outcode"

export type LocationResolveResult = { status: "ok"; location: CanonicalLocation; precision: LocationPrecision } | LocationFailure

/** A full UK postcode: an outward code, then a fixed three-character inward code (digit + 2 letters).
 * Spacing and case are irrelevant on the way in -- "BB11 2JT", "BB112JT", "bb11 2jt" and "bb112jt"
 * are the same postcode and must behave identically. */
const FULL_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i

/** Returns the canonical, correctly spaced, upper-case form, or null when the text is not a complete
 * postcode. Never throws, and never "corrects" text into a postcode it does not actually match. */
export function normalisePostcode(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "").trim()
  const match = compact.match(FULL_POSTCODE)
  if (!match) return null
  return `${match[1].toUpperCase()} ${match[2].toUpperCase()}`
}

/** Enough of a postcode to be worth asking for suggestions: at least an outward code's opening. This
 * gates the autocomplete call so a single stray character does not fire a request per keystroke. */
export function looksLikePostcodeFragment(raw: string): boolean {
  const compact = raw.replace(/\s+/g, "").trim()
  return compact.length >= 2 && /^[A-Z]{1,2}\d/i.test(compact)
}

/** An outward code on its own -- "BB11", "M1", "EC1A". Not a full postcode, but postcodes.io can
 * still place it on a map via `/outcodes/{outcode}`, which is enough to move the map to the right
 * town while a person is still typing. Deliberately separate from `normalisePostcode`, so an outcode
 * can never be mistaken for a complete postcode. */
const OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/i

export function normaliseOutcode(raw: string): string | null {
  const compact = raw.replace(/\s+/g, "").trim()
  return OUTCODE.test(compact) ? compact.toUpperCase() : null
}

/** The polished sentence a person sees. Deliberately never mentions an API key, because postcodes.io
 * does not use one, and never shows an HTTP status, which a person cannot act on. */
export function userMessageForFailure(failure: LocationFailure): string {
  switch (failure.status) {
    case "not_found":
      return "We couldn't find that postcode."
    case "terminated":
      return `${failure.postcode} is no longer in use — it was withdrawn in ${failure.yearTerminated}.`
    case "invalid_query":
      return failure.reason
    case "provider_error":
    case "network_error":
    case "malformed_response":
      return "Address lookup is temporarily unavailable. Try again."
  }
}

/** The developer-facing line. Carries the category and status that the sentence above deliberately
 * omits. There is no secret in this system to leak -- postcodes.io is keyless -- and no user data is
 * included beyond the postcode being looked up. */
export function developerDetailForFailure(operation: string, failure: LocationFailure): string {
  const extra =
    failure.status === "provider_error"
      ? ` httpStatus=${failure.httpStatus}`
      : failure.status === "invalid_query"
        ? ` reason=${failure.reason}`
        : failure.status === "terminated"
          ? ` postcode=${failure.postcode} year=${failure.yearTerminated}`
          : ""
  return `[address-lookup] ${operation}: ${failure.status}${extra}`
}

/** The raw postcodes.io record, as much of it as Ovalball reads. */
export interface PostcodesIoResult {
  postcode?: string
  latitude?: number | null
  longitude?: number | null
  admin_district?: string | null
  admin_county?: string | null
  region?: string | null
  country?: string | null
}

/** The ONE mapping from the provider's payload to Ovalball's shape. The web server module imports
 * this directly; the Edge Function restates it, because Deno cannot import from this workspace, and
 * the two are pinned together by this module's own tests. Returns null rather than a half-built
 * location when the provider omits a coordinate -- a location without a position is not a location,
 * and inventing 0,0 or a regional guess would be exactly the fabrication this system forbids. */
export function mapPostcodesIoResult(r: PostcodesIoResult): CanonicalLocation | null {
  if (typeof r.latitude !== "number" || typeof r.longitude !== "number" || typeof r.postcode !== "string") return null
  return {
    postcode: r.postcode,
    latitude: r.latitude,
    longitude: r.longitude,
    // admin_district -> adminDistrict, NOT -> town. The provider has no postal-town field.
    adminDistrict: r.admin_district ?? null,
    county: r.admin_county ?? null,
    region: r.region ?? null,
    nation: r.country ?? null,
    country: "United Kingdom",
  }
}

/** Coordinates -> the postcodes nearest to them. Exposed at service level for future Ovalball
 * features (dropping a pin on a map, resolving a venue's position back to a postcode). No UI consumes
 * it yet, deliberately -- it is here so that when one does, it does not grow its own provider call. */
export type ReverseGeocodeResult = { status: "ok"; locations: CanonicalLocation[] } | LocationFailure

/** A postcode -> its neighbours, nearest first. Same reasoning as reverse geocoding: exposed, not
 * yet consumed, so a future "clubs near here" cannot justify a second implementation. */
export type NearestResult = { status: "ok"; locations: CanonicalLocation[] } | LocationFailure

// =====================================================================================================
// PROPERTY-LEVEL ADDRESS SEARCH (Google Places API New).
//
// postcodes.io answers postcode questions; it has no property records. Google Places answers "23
// Rosehill Road" with a real building, its own coordinate, and -- crucially -- a genuine `postal_town`.
// That last field is why a Places resolution MAY set `town` where a postcodes.io one may not: Google
// distinguishes the postal town (Burnley) from the administrative area (Lancashire), where postcodes.io
// only ever had the local authority (Pendle).
//
// THE KEY IS SERVER-SIDE ONLY. Places is billed per request, so a key in a client bundle is somebody
// else's bill. It lives in the Edge Function's secret and the web server's env, never in EXPO_PUBLIC_*.
// =====================================================================================================

/** One selectable property from the search list. `placeId` is opaque and passed straight back to
 * `resolveAddress`; it is never stored and never shown. */
export interface AddressSuggestion {
  placeId: string
  /** The full one-line prediction, e.g. "23 Rosehill Road, Burnley, UK". */
  label: string
  /** The leading, most specific part -- the building and street -- for the first line of a result row. */
  primary: string
  /** What places it: town, county, country. Empty when the prediction has no secondary part. */
  secondary: string
}

/** A resolved property. Unlike `CanonicalLocation` this DOES carry address lines and a town, because
 * Google genuinely supplies them. Anything the provider did not return stays null rather than being
 * inferred -- a street-level prediction legitimately has no postcode, and that is reported as null. */
export interface CanonicalAddress {
  line1: string | null
  line2: string | null
  /** Google's `postal_town` -- a real postal town, not a council. */
  town: string | null
  /** `administrative_area_level_2`. */
  county: string | null
  postcode: string | null
  /** Where the postcode came from. Google supplies one for a specific building but not for a whole
   * street; in that case postcodes.io reverse-geocodes the coordinate and this reads
   * `reverse_geocoded`, meaning "nearest to the selected point", not "confirmed for this property". */
  postcodeSource: "provider" | "reverse_geocoded" | null
  /** `administrative_area_level_1` -- England / Scotland / Wales / Northern Ireland. */
  nation: string | null
  country: string
  /** The building's own coordinate, not a centroid. Null only if the provider omitted it. */
  latitude: number | null
  longitude: number | null
  /** Google's place id, stored as provenance in `venues.address_provider_ref`. Never shown to a user. */
  providerRef: string
}

export type AddressSuggestResult = { status: "ok"; suggestions: AddressSuggestion[] } | LocationFailure
export type AddressResolveResult = { status: "ok"; address: CanonicalAddress } | LocationFailure

/** Google returns the address as a flat list of typed components. This is the ONE place that list
 * becomes an Ovalball address, so web, mobile and the Edge Function cannot drift on what a "town" is.
 *
 * UK ADDRESS ORDER. A British address puts the most specific part first and works outwards:
 *
 *     Flat 3                 <- subpremise
 *     Turf Moor              <- premise (the named building)
 *     52-56 Harry Potts Way  <- street_number + route
 *     Burnley                <- postal_town
 *
 * So the parts are assembled in that order and the first becomes line 1, with the remainder joined
 * into line 2. An earlier version put the STREET on line 1 and pushed the building name to line 2,
 * which reads backwards for a named ground -- "52-56 Harry Potts Way / Turf Moor" rather than
 * "Turf Moor / 52-56 Harry Potts Way". A plain numbered house is unaffected: it has only one part,
 * "23 Rosehill Road", and that is exactly what line 1 gets. */
export interface GoogleAddressComponent {
  longText?: string
  shortText?: string
  types?: string[]
}

export function mapGooglePlace(place: {
  id?: string
  addressComponents?: GoogleAddressComponent[]
  location?: { latitude?: number; longitude?: number }
}): CanonicalAddress | null {
  if (typeof place.id !== "string") return null
  const components = place.addressComponents ?? []
  const pick = (type: string): string | null => components.find((c) => (c.types ?? []).includes(type))?.longText ?? null

  const streetNumber = pick("street_number")
  const route = pick("route")
  const premise = pick("premise")
  const subpremise = pick("subpremise")
  const streetLine = streetNumber && route ? `${streetNumber} ${route}` : route
  // Most specific first -- see the note above. `.filter(Boolean)` drops whatever Google did not return.
  const parts = [subpremise, premise, streetLine].filter((p): p is string => !!p && p.trim().length > 0)
  const line1 = parts[0] ?? null
  const line2 = parts.length > 1 ? parts.slice(1).join(", ") : null

  return {
    line1,
    line2,
    // `postal_town` is the postal town proper. `locality` is the fallback Google uses outside the UK
    // and in a few UK edge cases; `admin_district`-style values are deliberately NOT consulted.
    town: pick("postal_town") ?? pick("locality"),
    county: pick("administrative_area_level_2"),
    postcode: pick("postal_code"),
    postcodeSource: pick("postal_code") ? "provider" : null,
    nation: pick("administrative_area_level_1"),
    country: pick("country") ?? "United Kingdom",
    latitude: typeof place.location?.latitude === "number" ? place.location.latitude : null,
    longitude: typeof place.location?.longitude === "number" ? place.location.longitude : null,
    providerRef: place.id,
  }
}

/** Splits a Places prediction into the two lines a result row shows. */
export function splitPredictionText(label: string): { primary: string; secondary: string } {
  const parts = label.split(",").map((p) => p.trim()).filter(Boolean)
  return { primary: parts[0] ?? label, secondary: parts.slice(1).join(", ") }
}
