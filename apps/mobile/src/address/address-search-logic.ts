import type { AddressSuggestResult, CanonicalAddress, CanonicalLocation, LocationPrecision, LocationSuggestResult } from "@ovalball/contracts/address"
import { normalisePostcode } from "@ovalball/contracts/address"
import { userMessageForFailure } from "@ovalball/contracts/address"

/**
 * CANONICAL LOCATION SEARCH -- pure logic, pulled out of `address-lookup-field.tsx` for fast unit
 * tests, the same pattern every other Ovalball wizard/field module in this app uses.
 *
 * The search is POSTCODE-FIRST because that is what the provider can honestly answer. A person types
 * a postcode (spaced, unspaced, upper or lower case), sees real candidate postcodes, picks one, and
 * gets its true geography and coordinates. Their venue's own building name and street stay Ovalball's
 * data, typed into the confirmation fields below -- never presented as provider-confirmed, and never
 * synthesised from a house number plus a guessed road.
 */

/** A monotonic request counter is the guard: a response is only applied if it is still the most
 * recently issued request when it comes back. Typing "BB1" then "BB11" fires two requests; if the
 * first (broader, slower) result lands after the second, this refuses it rather than letting a stale
 * list flash over the current one. */
export function isCurrentRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId
}

/** The hint under the search field for every non-"ok-with-results" outcome, so the field never just
 * goes quiet. Uses the contract's own wording, so web and mobile say the same thing. */
export function hintForSuggestResult(result: LocationSuggestResult): string | null {
  if (result.status === "ok") return result.suggestions.length === 0 ? "We couldn't find that postcode." : null
  return userMessageForFailure(result)
}

/** The fields a resolved location writes into a venue draft.
 *
 * DELIBERATELY PARTIAL. It sets ONLY what postcodes.io actually established -- the canonical postcode,
 * the coordinates, and the administrative county where the provider returned one. `line1`, `line2`
 * and `town` are NOT touched: the provider said nothing about a building or a street, and its
 * `admin_district` is a local authority rather than a postal town. A person resolving a postcode for
 * an existing venue keeps the address lines and the town they already had.
 *
 * `county` is only written when the provider returned one; a null never blanks what a person typed. */
export interface LocationDraftFields {
  /** NOT supplied by the provider. postcodes.io's `admin_district` is a local authority, not a postal
   * town, so a resolution never writes a town -- the venue keeps the one it has, or a person types it. */
  county?: string
  postcode: string
  latitude: number
  longitude: number
}

export function locationToDraftFields(location: CanonicalLocation): LocationDraftFields {
  const fields: LocationDraftFields = {
    postcode: location.postcode,
    latitude: location.latitude,
    longitude: location.longitude,
  }
  // `county` IS mapped, because admin_county genuinely is a county. `town` is deliberately absent:
  // see LocationDraftFields' own note and the contract header.
  if (location.county) fields.county = location.county
  return fields
}

/** The one-line summary the resolved-location card shows: what the provider genuinely confirmed,
 * in the order a person reads an address. Never includes a building or street, because the provider
 * did not supply one. */
export function locationSummaryLine(location: CanonicalLocation): string {
  return [location.adminDistrict, location.county, location.postcode].filter((s) => s && s.trim()).join(", ")
}

/** "BB11 2JT" -- the honest caption under the map. The pin is the postcode's own position, and this
 * says so rather than implying the exact building has been located. */
export function mapCaptionForLocation(location: CanonicalLocation, precision: LocationPrecision = "postcode"): string {
  return precision === "outcode" ? `Approximate area of ${location.postcode}` : `Approximate location of ${location.postcode}`
}

/** The collapsed field's summary once an address is set, built from Ovalball's OWN stored fields --
 * not from a provider response -- so re-opening an edit screen shows exactly what was saved. */
export function addressSummaryLine(fields: { line1: string; line2: string; town: string; county: string; postcode: string }): string {
  return [fields.line1, fields.line2, fields.town, fields.county, fields.postcode].filter((s) => s && s.trim()).join(", ")
}

/** The fields a resolved PROPERTY writes into a venue draft. Unlike a postcode resolution this may
 * set `line1`/`line2` and `town`, because Google genuinely supplies a building, a street and a real
 * `postal_town` -- none of which postcodes.io has. A null the provider returned is written as an empty
 * string for a plain text field rather than being invented. */
export interface AddressDraftFields {
  line1: string
  line2: string
  town: string
  county: string
  postcode: string
  latitude: number | null
  longitude: number | null
  providerRef: string
}

export function addressToDraftFields(address: CanonicalAddress): AddressDraftFields {
  return {
    line1: address.line1 ?? "",
    line2: address.line2 ?? "",
    town: address.town ?? "",
    county: address.county ?? "",
    postcode: address.postcode ?? "",
    latitude: address.latitude,
    longitude: address.longitude,
    providerRef: address.providerRef,
  }
}

/** Said under the field when the postcode was not the provider's own. It is the postcode nearest the
 * selected point, which for a street-level pick may not be the venue's, so the person is asked to
 * check rather than told it is confirmed. */
export function postcodeCaveat(address: CanonicalAddress): string | null {
  return address.postcodeSource === "reverse_geocoded" ? `Postcode ${address.postcode} was found from the map location — please check it.` : null
}

export function hintForAddressResult(result: AddressSuggestResult): string | null {
  if (result.status === "ok") return result.suggestions.length === 0 ? "We couldn't find that address." : null
  return userMessageForFailure(result)
}

/** WHAT GOOGLE CAN AND CANNOT DO WITH A BARE POSTCODE -- verified against the live API, not assumed.
 *
 * Asked for "BB11 2JT", Places API (New) Autocomplete returns ONE result: "Rosehill Road, Burnley
 * BB11 2JT". It does not enumerate the individual properties at that postcode, because Places is a
 * search over places, not a Royal Mail address file. Listing every delivery point at a postcode needs
 * a PAF-licensed provider, which Google is not.
 *
 * So rather than leave a person at a street wondering why their house is missing -- the exact
 * "postcode -> click -> generic road" complaint this work exists to fix -- the field says what to do
 * next. Typing the number then finds the property: "23 Rosehill Road" resolves precisely. */
export function barePostcodeGuidance(query: string): string | null {
  return normalisePostcode(query) ? "That postcode finds the street. Add a house number or building name to pick the exact property." : null
}
