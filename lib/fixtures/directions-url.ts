/**
 * Building a directions link, safely.
 *
 * Pure and dependency-free so it has standalone regression coverage: this
 * produces a URL the product hands a user and asks them to follow, which is
 * exactly the kind of string that must not be assembled casually.
 *
 * TWO RULES.
 *
 * The destination host is a CONSTANT here. It is never taken from the
 * fixture, the venue, or anything else a user or an importer can write --
 * that is what turns a "Directions" button into an open redirect. There is
 * deliberately no per-fixture maps URL field to honour.
 *
 * Everything variable goes through URLSearchParams, so an address containing
 * `&`, `#`, a quote or a newline is encoded rather than escaping into the
 * query. Coordinates are preferred over text when the venue has them: they
 * are unambiguous, and they cannot carry an injection payload at all.
 */

const MAPS_ORIGIN = "https://www.google.com/maps/dir/"

export interface DirectionsTarget {
  name?: string | null
  addressLines?: string[]
  postcode?: string | null
  latitude?: number | null
  longitude?: number | null
}

function isUsableCoordinate(lat: number | null | undefined, lon: number | null | undefined): boolean {
  if (lat === null || lat === undefined || lon === null || lon === undefined) return false
  if (Number.isNaN(lat) || Number.isNaN(lon)) return false
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false
  // 0,0 is in the Atlantic. It is far more likely to be an unset default than
  // a real venue, and sending a parent there is worse than sending them
  // nowhere.
  if (lat === 0 && lon === 0) return false
  return true
}

/**
 * Returns null when there is genuinely nothing to navigate to, so the caller
 * can omit the action rather than render a button that goes somewhere useless.
 */
export function buildDirectionsUrl(target: DirectionsTarget): string | null {
  const params = new URLSearchParams({ api: "1" })

  if (isUsableCoordinate(target.latitude, target.longitude)) {
    params.set("destination", `${target.latitude},${target.longitude}`)
    return `${MAPS_ORIGIN}?${params.toString()}`
  }

  // No coordinates: fall back to the canonical postal address. Postcode last
  // and always included when present -- it is the part that actually resolves
  // in the UK.
  const parts = [target.name, ...(target.addressLines ?? []), target.postcode].filter((p): p is string => Boolean(p && p.trim()))
  if (parts.length === 0) return null

  params.set("destination", parts.join(", "))
  return `${MAPS_ORIGIN}?${params.toString()}`
}

/** The one-line address a card renders. Never a concatenation with empty segments left in. */
export function formatVenueAddress(target: DirectionsTarget): string | null {
  const parts = [...(target.addressLines ?? []), target.postcode].filter((p): p is string => Boolean(p && p.trim()))
  return parts.length > 0 ? parts.join(", ") : null
}
