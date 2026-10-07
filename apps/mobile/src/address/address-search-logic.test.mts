import { test } from "node:test"
import assert from "node:assert/strict"

import { developerDetailForFailure, looksLikePostcodeFragment, mapPostcodesIoResult, normaliseOutcode, normalisePostcode, userMessageForFailure } from "@ovalball/contracts/address"

import { addressSummaryLine, hintForSuggestResult, isCurrentRequest, locationSummaryLine, locationToDraftFields, mapCaptionForLocation } from "./address-search-logic"

// ---------------------------------------------------------------------------
// Postcode normalisation. Spacing and case must be irrelevant on the way in,
// and the canonical form must come back out.
// ---------------------------------------------------------------------------

test("normalisePostcode: spaced, unspaced, lower and mixed case all reach one canonical form", () => {
  for (const raw of ["BB11 2JT", "BB112JT", "bb11 2jt", "bb112jt", "  bB11   2Jt "]) {
    assert.equal(normalisePostcode(raw), "BB11 2JT", `failed for ${JSON.stringify(raw)}`)
  }
})

test("normalisePostcode: handles every UK outward-code shape", () => {
  assert.equal(normalisePostcode("m11ae"), "M1 1AE")
  assert.equal(normalisePostcode("cr26xh"), "CR2 6XH")
  assert.equal(normalisePostcode("dn551pt"), "DN55 1PT")
  assert.equal(normalisePostcode("ec1a1bb"), "EC1A 1BB")
  assert.equal(normalisePostcode("w1a0ax"), "W1A 0AX")
})

test("normalisePostcode: refuses anything that is not a complete postcode, rather than guessing", () => {
  for (const raw of ["", "BB11", "23 Rosehill Road", "Rosehill Road", "Burnley", "BB11 2", "ZZZZZZZ"]) {
    assert.equal(normalisePostcode(raw), null, `should not have normalised ${JSON.stringify(raw)}`)
  }
})

test("looksLikePostcodeFragment: gates the suggest call to postcode-shaped text", () => {
  assert.equal(looksLikePostcodeFragment("BB1"), true)
  assert.equal(looksLikePostcodeFragment("bb11"), true)
  assert.equal(looksLikePostcodeFragment("M1"), true)
  // A street name is not a postcode fragment -- asking postcodes.io for it would guarantee an empty
  // list and teach a person the search is broken.
  assert.equal(looksLikePostcodeFragment("Rosehill Road"), false)
  assert.equal(looksLikePostcodeFragment("Burnley"), false)
  assert.equal(looksLikePostcodeFragment("B"), false)
})

// ---------------------------------------------------------------------------
// Provider mapping. Ovalball owns `country`; the provider owns the nation.
// ---------------------------------------------------------------------------

test("mapPostcodesIoResult: maps a full record and keeps nation separate from country", () => {
  const loc = mapPostcodesIoResult({
    postcode: "BB11 2JT",
    latitude: 53.781544,
    longitude: -2.253339,
    admin_district: "Burnley",
    admin_county: "Lancashire",
    region: "North West",
    country: "England",
  })
  assert.ok(loc)
  assert.equal(loc.postcode, "BB11 2JT")
  assert.equal(loc.latitude, 53.781544)
  assert.equal(loc.longitude, -2.253339)
  assert.equal(loc.adminDistrict, "Burnley")
  assert.equal(loc.county, "Lancashire")
  assert.equal(loc.nation, "England")
  // NOT "England" -- Ovalball's own column has always held this, and they are different facts.
  assert.equal(loc.country, "United Kingdom")
})

test("mapPostcodesIoResult: a genuinely absent county stays null rather than being invented", () => {
  const loc = mapPostcodesIoResult({ postcode: "M1 1AE", latitude: 53.4, longitude: -2.2, admin_district: "Manchester", admin_county: null, region: "North West", country: "England" })
  assert.ok(loc)
  assert.equal(loc.county, null)
  assert.equal(loc.adminDistrict, "Manchester")
})

test("mapPostcodesIoResult: no coordinate means no location -- never a 0,0 fallback", () => {
  assert.equal(mapPostcodesIoResult({ postcode: "BB11 2JT", latitude: null, longitude: -2.25 }), null)
  assert.equal(mapPostcodesIoResult({ postcode: "BB11 2JT", latitude: 53.78, longitude: null }), null)
  assert.equal(mapPostcodesIoResult({ latitude: 53.78, longitude: -2.25 }), null)
})

// ---------------------------------------------------------------------------
// Draft mapping. The provider never gets to touch a building or a street.
// ---------------------------------------------------------------------------

const BURNLEY = { postcode: "BB11 2JT", latitude: 53.781544, longitude: -2.253339, adminDistrict: "Burnley", county: "Lancashire", region: "North West", nation: "England", country: "United Kingdom" }

test("locationToDraftFields: carries postcode and coordinates, and never line1/line2", () => {
  const fields = locationToDraftFields(BURNLEY)
  assert.equal(fields.postcode, "BB11 2JT")
  assert.equal(fields.latitude, 53.781544)
  assert.equal(fields.longitude, -2.253339)
  assert.equal(fields.county, "Lancashire")
  assert.ok(!("line1" in fields), "a postcode resolution must never supply an address line")
  assert.ok(!("line2" in fields))
})

// ---------------------------------------------------------------------------
// THE admin_district RULE. postcodes.io has no postal-town field; admin_district
// is a LOCAL AUTHORITY. BB10 2LS is a Burnley address whose admin_district is
// "Pendle" -- writing that into venues.town would replace a correct postal town
// with the name of a council. These tests exist so that can never come back.
// ---------------------------------------------------------------------------

test("admin_district is NEVER mapped to town on the canonical location", () => {
  const loc = mapPostcodesIoResult({ postcode: "BB10 2LS", latitude: 53.819394, longitude: -2.234962, admin_district: "Pendle", admin_county: "Lancashire", region: "North West", country: "England" })
  assert.ok(loc)
  assert.equal(loc.adminDistrict, "Pendle")
  // The whole point: there is no `town` on a CanonicalLocation for a provider value to land in.
  assert.ok(!("town" in loc), "CanonicalLocation must not carry a provider-supplied town")
})

test("a resolution never writes a town into a draft, so a correct postal town survives", () => {
  const pendle = { postcode: "BB10 2LS", latitude: 53.819394, longitude: -2.234962, adminDistrict: "Pendle", county: "Lancashire", region: "North West", nation: "England", country: "United Kingdom" }
  const fields = locationToDraftFields(pendle)
  assert.ok(!("town" in fields), "a resolved postcode must never supply a town")
  // What it DOES legitimately carry:
  assert.equal(fields.postcode, "BB10 2LS")
  assert.equal(fields.latitude, 53.819394)
  assert.equal(fields.county, "Lancashire")
})

test("locationToDraftFields: a null county is omitted, so it cannot blank what a person typed", () => {
  const fields = locationToDraftFields({ ...BURNLEY, adminDistrict: null, county: null })
  assert.equal(fields.county, undefined)
  assert.equal(fields.postcode, "BB11 2JT")
})

test("locationSummaryLine: shows only what the provider genuinely confirmed", () => {
  assert.equal(locationSummaryLine(BURNLEY), "Burnley, Lancashire, BB11 2JT")
  assert.equal(locationSummaryLine({ ...BURNLEY, county: null }), "Burnley, BB11 2JT")
})

test("mapCaptionForLocation: never claims the pin is the exact building", () => {
  const caption = mapCaptionForLocation(BURNLEY)
  assert.match(caption, /Approximate/)
  assert.match(caption, /BB11 2JT/)
})

test("addressSummaryLine: built from Ovalball's own stored fields, skipping empties", () => {
  assert.equal(addressSummaryLine({ line1: "Clubhouse", line2: "Belvedere Road", town: "Burnley", county: "Lancashire", postcode: "BB10 2LS" }), "Clubhouse, Belvedere Road, Burnley, Lancashire, BB10 2LS")
  assert.equal(addressSummaryLine({ line1: "Belvedere Road", line2: "", town: "Burnley", county: "", postcode: "BB10 2LS" }), "Belvedere Road, Burnley, BB10 2LS")
})

// ---------------------------------------------------------------------------
// Failure vocabulary. Distinguishable internally, simple on screen, and never
// a mention of an API key -- postcodes.io does not use one.
// ---------------------------------------------------------------------------

test("userMessageForFailure: each failure gets a polished sentence, and none mentions a key", () => {
  const cases = [
    { failure: { status: "not_found" } as const, expect: /couldn't find that postcode/i },
    { failure: { status: "provider_error", httpStatus: 503 } as const, expect: /temporarily unavailable/i },
    { failure: { status: "network_error" } as const, expect: /temporarily unavailable/i },
    { failure: { status: "malformed_response" } as const, expect: /temporarily unavailable/i },
  ]
  for (const { failure, expect } of cases) {
    const message = userMessageForFailure(failure)
    assert.match(message, expect)
    assert.ok(!/api.?key/i.test(message), `"${message}" must not mention an API key`)
    assert.ok(!/not connected|not configured/i.test(message), `"${message}" must not claim the service is unconfigured`)
    assert.ok(!/\d{3}/.test(message), `"${message}" must not leak an HTTP status to a person`)
  }
})

test("userMessageForFailure: an invalid query explains itself in its own words", () => {
  assert.equal(userMessageForFailure({ status: "invalid_query", reason: "That doesn't look like a complete UK postcode." }), "That doesn't look like a complete UK postcode.")
})

test("developerDetailForFailure: keeps the category and the status a person never sees", () => {
  assert.match(developerDetailForFailure("resolve", { status: "provider_error", httpStatus: 503 }), /provider_error.*httpStatus=503/)
  assert.match(developerDetailForFailure("suggest", { status: "network_error" }), /network_error/)
  assert.match(developerDetailForFailure("resolve", { status: "not_found" }), /not_found/)
})

test("hintForSuggestResult: an empty ok list reads as 'not found', not as silence", () => {
  assert.equal(hintForSuggestResult({ status: "ok", suggestions: [{ postcode: "BB11 1AD", adminDistrict: "Burnley" }] }), null)
  assert.match(hintForSuggestResult({ status: "ok", suggestions: [] }) ?? "", /couldn't find/i)
  assert.match(hintForSuggestResult({ status: "network_error" }) ?? "", /temporarily unavailable/i)
})

// ---------------------------------------------------------------------------
// Outward codes and terminated postcodes -- the two postcodes.io capabilities
// that let the system say something true where it previously said nothing.
// ---------------------------------------------------------------------------

test("normaliseOutcode: accepts an outward code alone, and never a full postcode", () => {
  assert.equal(normaliseOutcode("bb11"), "BB11")
  assert.equal(normaliseOutcode("m1"), "M1")
  assert.equal(normaliseOutcode("ec1a"), "EC1A")
  // A complete postcode is NOT an outcode -- it must take the precise path, not the centroid one.
  assert.equal(normaliseOutcode("BB11 2JT"), null)
  assert.equal(normaliseOutcode("BB112JT"), null)
  assert.equal(normaliseOutcode("Burnley"), null)
  assert.equal(normaliseOutcode(""), null)
})

test("a terminated postcode is told apart from a typo, and names its year", () => {
  const message = userMessageForFailure({ status: "terminated", postcode: "E1W 1UU", yearTerminated: 2015 })
  assert.match(message, /E1W 1UU/)
  assert.match(message, /2015/)
  assert.match(message, /no longer in use|withdrawn/i)
  // Crucially NOT the "couldn't find" wording, which would imply the person mistyped it.
  assert.ok(!/couldn't find/i.test(message))
})

test("developerDetailForFailure: a terminated postcode keeps its postcode and year", () => {
  assert.match(developerDetailForFailure("resolve", { status: "terminated", postcode: "E1W 1UU", yearTerminated: 2015 }), /terminated.*postcode=E1W 1UU.*year=2015/)
})

test("mapCaptionForLocation: an outcode says 'area', a postcode says 'location' -- neither says building", () => {
  assert.match(mapCaptionForLocation(BURNLEY, "outcode"), /Approximate area/)
  assert.match(mapCaptionForLocation(BURNLEY, "postcode"), /Approximate location/)
  for (const p of ["outcode", "postcode"] as const) {
    assert.ok(!/building|exact|precise/i.test(mapCaptionForLocation(BURNLEY, p)))
  }
})

// ---------------------------------------------------------------------------
// Stale-response guard.
// ---------------------------------------------------------------------------

test("isCurrentRequest: a slower earlier response is refused once a newer one exists", () => {
  assert.equal(isCurrentRequest(2, 2), true)
  assert.equal(isCurrentRequest(1, 2), false)
})
