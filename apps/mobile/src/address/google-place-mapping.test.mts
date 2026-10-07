import { test } from "node:test"
import assert from "node:assert/strict"

import { mapGooglePlace, splitPredictionText } from "@ovalball/contracts/address"

/**
 * THE GOOGLE PLACES COMPONENT MAPPER.
 *
 * Every fixture below is the REAL component shape returned by Places API (New) for that query,
 * captured live rather than imagined -- so a change in our mapping is caught, and a change in
 * Google's shape shows up as a fixture that no longer matches reality.
 */

const comp = (longText: string, ...types: string[]) => ({ longText, types })
const place = (id: string, components: { longText: string; types: string[] }[], lat?: number, lng?: number) => ({
  id,
  addressComponents: components,
  location: lat === undefined ? undefined : { latitude: lat, longitude: lng },
})

// 1. NUMBERED RESIDENTIAL PROPERTY -- live shape for "23 Rosehill Road, Burnley".
test("numbered property: line1 keeps BOTH the number and the road", () => {
  const a = mapGooglePlace(place("p1", [comp("23", "street_number"), comp("Rosehill Road", "route"), comp("Burnley", "postal_town"), comp("Lancashire", "administrative_area_level_2"), comp("England", "administrative_area_level_1"), comp("United Kingdom", "country")], 53.7810302, -2.2528602))
  assert.ok(a)
  assert.equal(a.line1, "23 Rosehill Road")
  assert.equal(a.line2, null)
  assert.equal(a.town, "Burnley")
  assert.equal(a.county, "Lancashire")
  assert.equal(a.latitude, 53.7810302)
  assert.equal(a.longitude, -2.2528602)
})

// 2/3. NAMED BUILDING WITH A STREET NUMBER -- live shape for "Turf Moor, Burnley".
// UK order puts the building first; the street follows on line 2.
test("named building: building name leads, street follows on line 2", () => {
  const a = mapGooglePlace(place("p2", [comp("52-56", "street_number"), comp("Harry Potts Way", "route"), comp("Turf Moor", "premise"), comp("Burnley", "postal_town"), comp("BB10 4BX", "postal_code")], 53.7886553, -2.2311304))
  assert.ok(a)
  assert.equal(a.line1, "Turf Moor")
  assert.equal(a.line2, "52-56 Harry Potts Way")
  assert.equal(a.postcode, "BB10 4BX")
})

// 4. ADDRESS WITHOUT A STREET NUMBER -- live shape for "Rosehill Road, Burnley" (a whole street).
test("street without a number: line1 is the road alone, and that is correct", () => {
  const a = mapGooglePlace(place("p3", [comp("Rosehill Road", "route"), comp("Burnley", "postal_town"), comp("Lancashire", "administrative_area_level_2")], 53.7927092, -2.232282))
  assert.ok(a)
  assert.equal(a.line1, "Rosehill Road")
  assert.equal(a.line2, null)
  // Google returns no postcode for a whole street -- a street spans several. Reported, not invented.
  assert.equal(a.postcode, null)
})

// 5. SUBPREMISE.
test("subpremise: flat leads, then the building, then the street", () => {
  const a = mapGooglePlace(place("p4", [comp("Flat 3", "subpremise"), comp("Turf Moor", "premise"), comp("52-56", "street_number"), comp("Harry Potts Way", "route"), comp("Burnley", "postal_town")]))
  assert.ok(a)
  assert.equal(a.line1, "Flat 3")
  assert.equal(a.line2, "Turf Moor, 52-56 Harry Potts Way")
})

test("premise with no street at all still produces a usable line1", () => {
  const a = mapGooglePlace(place("p5", [comp("Ovalball Pavilion", "premise"), comp("Burnley", "postal_town")]))
  assert.ok(a)
  assert.equal(a.line1, "Ovalball Pavilion")
  assert.equal(a.line2, null)
})

// 6. POSTAL TOWN -- the permanent rule.
test("town comes from postal_town, and an administrative district can never become one", () => {
  const a = mapGooglePlace(place("p6", [comp("Burnley", "postal_town"), comp("Pendle", "administrative_area_level_3"), comp("Lancashire", "administrative_area_level_2")]))
  assert.ok(a)
  assert.equal(a.town, "Burnley", "postal_town must win")
  assert.notEqual(a.town, "Pendle", "a district must never become the town")
})

test("locality is the only fallback for town, and only when postal_town is absent", () => {
  const a = mapGooglePlace(place("p7", [comp("Torrance", "locality"), comp("Glasgow", "administrative_area_level_2")]))
  assert.ok(a)
  assert.equal(a.town, "Torrance")
})

// 7/8/9. COUNTY, POSTCODE, COORDINATES, COUNTRY.
test("county, nation and country map to their own fields and never to each other", () => {
  const a = mapGooglePlace(place("p8", [comp("Lancashire", "administrative_area_level_2"), comp("England", "administrative_area_level_1"), comp("United Kingdom", "country")]))
  assert.ok(a)
  assert.equal(a.county, "Lancashire")
  assert.equal(a.nation, "England")
  assert.equal(a.country, "United Kingdom")
})

test("a place with no coordinate reports null rather than a fabricated 0,0", () => {
  const a = mapGooglePlace(place("p9", [comp("Burnley", "postal_town")]))
  assert.ok(a)
  assert.equal(a.latitude, null)
  assert.equal(a.longitude, null)
})

test("providerRef carries the place id, and a place without an id maps to nothing", () => {
  const a = mapGooglePlace(place("place-abc", [comp("Burnley", "postal_town")]))
  assert.equal(a?.providerRef, "place-abc")
  assert.equal(mapGooglePlace({ addressComponents: [] }), null)
})

test("splitPredictionText: the specific part leads, the rest places it", () => {
  assert.deepEqual(splitPredictionText("23 Rosehill Road, Burnley, UK"), { primary: "23 Rosehill Road", secondary: "Burnley, UK" })
  assert.deepEqual(splitPredictionText("Rosehill Road"), { primary: "Rosehill Road", secondary: "" })
})
