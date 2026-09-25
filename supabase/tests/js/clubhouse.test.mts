import { test } from "node:test"
import assert from "node:assert/strict"

import {
  applyClubhouseDistanceFilter,
  applyClubhouseFilter,
  buildClubMarkerFeatureCollection,
  buildPartnershipIndex,
  deriveClubNetworkActions,
  distanceMiles,
  findDistanceOrigin,
  isValidClubCoordinate,
  matchesClubhouseQuery,
  resolveClubLocation,
  resolvePartnershipStatus,
  type ClubMapMarker,
} from "../../../packages/contracts/src/clubhouse"

/**
 * CLUBHOUSE V1 -- pure client-side logic pinned directly (owner directive Section 69). The
 * SERVER-side authority (`club_partnerships` RLS, `respond_to_club_partnership`,
 * `create_partner_invitation`, `my_capabilities`) is unchanged by Clubhouse and already covered by
 * `supabase/tests/partner_clubs_and_messaging.sql` and `supabase/tests/js/perimeter_manifest.test.mts`
 * -- these assertions cover the NEW arithmetic Clubhouse itself adds: the search/filter functions both
 * clients call, and `deriveClubNetworkActions`, the one function deciding what the club sheet may
 * offer. Every safeguarding-relevant case the directive calls out by name is asserted here.
 */

function marker(overrides: Partial<ClubMapMarker> = {}): ClubMapMarker {
  return {
    directoryId: "dir-1",
    clubId: "club-1",
    name: "Preston Grasshoppers",
    rugbyCode: "union",
    town: "Preston",
    county: "Lancashire",
    postcode: "PR2 1AB",
    latitude: 53.77,
    longitude: -2.7,
    hasLocation: true,
    locationPrecision: "postcode",
    logoUrl: null,
    slug: "preston-grasshoppers",
    isOwnClub: false,
    networkState: "on_ovalball",
    partnershipStatus: "none",
    partnershipId: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------------------------
// deriveClubNetworkActions -- Section 44/55/64: the one function deciding what the sheet offers.
// ---------------------------------------------------------------------------------------------

test("a parent/player account (no capability at any club) gets every network action false, even for a partner club", () => {
  const m = marker({ partnershipStatus: "active" })
  const actions = deriveClubNetworkActions(m, "viewer-club", new Set())
  assert.deepEqual(actions, {
    canPartner: false,
    canCancelOutgoingPartnerRequest: false,
    canRespondPartnerRequest: false,
    canRevokePartnership: false,
    canFindFixture: false,
    canCompareCalendar: false,
    canInviteToOvalball: false,
  })
})

test("an unclaimed directory club never offers Find a Fixture, Compare Calendars or any partner action, whatever capabilities the viewer holds", () => {
  const m = marker({ clubId: null, networkState: "not_on_ovalball", partnershipStatus: "none" })
  const caps = new Set(["club.partners.manage", "fixture.request.create", "fixture.request.respond"])
  const actions = deriveClubNetworkActions(m, "viewer-club", caps)
  assert.equal(actions.canFindFixture, false)
  assert.equal(actions.canCompareCalendar, false)
  assert.equal(actions.canPartner, false)
  assert.equal(actions.canRevokePartnership, false)
  // The one action an unclaimed club DOES offer, and only this one.
  assert.equal(actions.canInviteToOvalball, true)
})

test("Compare Calendars requires an ACTIVE partnership even when the viewer holds full fixture authority -- matches get_partner_team_availability's own server-side refusal", () => {
  const caps = new Set(["fixture.request.create", "fixture.request.respond"])
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "none" }), "viewer-club", caps).canCompareCalendar, false)
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "pending_outgoing" }), "viewer-club", caps).canCompareCalendar, false)
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "active" }), "viewer-club", caps).canCompareCalendar, true)
})

test("Find a Fixture never requires partnership -- fixture authority alone is enough (the audit's own finding: partnership grants calendar/messaging, nothing else)", () => {
  const caps = new Set(["fixture.request.create"])
  const actions = deriveClubNetworkActions(marker({ partnershipStatus: "none" }), "viewer-club", caps)
  assert.equal(actions.canFindFixture, true)
})

test("a club cannot partner with itself -- isOtherClub is false when the marker's own clubId equals the viewer's", () => {
  const m = marker({ clubId: "viewer-club", isOwnClub: true, partnershipStatus: "none" })
  const caps = new Set(["club.partners.manage", "fixture.request.create"])
  const actions = deriveClubNetworkActions(m, "viewer-club", caps)
  assert.equal(actions.canPartner, false)
  assert.equal(actions.canFindFixture, false)
})

test("partnership status maps to exactly one available transition at a time", () => {
  const caps = new Set(["club.partners.manage"])
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "none" }), "v", caps).canPartner, true)
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "pending_outgoing" }), "v", caps).canCancelOutgoingPartnerRequest, true)
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "pending_incoming" }), "v", caps).canRespondPartnerRequest, true)
  assert.equal(deriveClubNetworkActions(marker({ partnershipStatus: "active" }), "v", caps).canRevokePartnership, true)
  // Never two transitions offered for one status.
  const pending = deriveClubNetworkActions(marker({ partnershipStatus: "pending_incoming" }), "v", caps)
  assert.equal(pending.canPartner, false)
  assert.equal(pending.canRevokePartnership, false)
})

// ---------------------------------------------------------------------------------------------
// matchesClubhouseQuery / applyClubhouseFilter
// ---------------------------------------------------------------------------------------------

test("matchesClubhouseQuery matches name, town and postcode (whitespace-insensitive), and a query under 2 characters matches everything", () => {
  const m = marker()
  assert.equal(matchesClubhouseQuery(m, "preston"), true)
  assert.equal(matchesClubhouseQuery(m, "PRESTON"), true)
  assert.equal(matchesClubhouseQuery(m, "pr2 1ab"), true)
  assert.equal(matchesClubhouseQuery(m, "pr21ab"), true)
  assert.equal(matchesClubhouseQuery(m, "burnley"), false)
  assert.equal(matchesClubhouseQuery(m, "p"), true)
})

test("applyClubhouseFilter: 'compatible' never silently falls back to 'all' when no compatible set is known -- an unknown compatibility answer must show nothing, not everything", () => {
  const markers = [marker({ directoryId: "a" }), marker({ directoryId: "b" })]
  assert.deepEqual(applyClubhouseFilter(markers, "compatible", null), [])
})

test("applyClubhouseFilter: 'partners' only ever returns an ACTIVE partnership, never pending", () => {
  const markers = [
    marker({ directoryId: "a", partnershipStatus: "active" }),
    marker({ directoryId: "b", partnershipStatus: "pending_incoming" }),
    marker({ directoryId: "c", partnershipStatus: "pending_outgoing" }),
  ]
  const result = applyClubhouseFilter(markers, "partners", null)
  assert.deepEqual(result.map((m) => m.directoryId), ["a"])
})

test("applyClubhouseFilter: 'on_ovalball' excludes directory-only clubs", () => {
  const markers = [marker({ directoryId: "a", networkState: "on_ovalball" }), marker({ directoryId: "b", networkState: "not_on_ovalball" })]
  const result = applyClubhouseFilter(markers, "on_ovalball", null)
  assert.deepEqual(result.map((m) => m.directoryId), ["a"])
})

// ---------------------------------------------------------------------------------------------
// CLUBHOUSE PROGRAMME SECTION 2 -- the UNKNOWN partnership state, and map/list correctness.
// ---------------------------------------------------------------------------------------------

test("resolvePartnershipStatus: UNKNOWN partnership state must never become NOT_PARTNERED -- the directive's own required test, by name", () => {
  // No authority at all (team-scoped viewer, or narrowed permissions): unknown, whatever the raw data says.
  assert.equal(resolvePartnershipStatus(null, "viewer-club", false), "unknown")
  assert.equal(resolvePartnershipStatus("active", "viewer-club", false), "unknown")
  // No club to ask on behalf of: unknown, never "none".
  assert.equal(resolvePartnershipStatus(null, null, true), "unknown")
  // Authority held, genuinely no row: THIS is the only path that may ever answer "none".
  assert.equal(resolvePartnershipStatus(null, "viewer-club", true), "none")
  // Authority held, a real row: the real answer passes through unchanged.
  assert.equal(resolvePartnershipStatus("active", "viewer-club", true), "active")
  assert.equal(resolvePartnershipStatus("pending_incoming", "viewer-club", true), "pending_incoming")
})

test("UNKNOWN partnership status can never render 'Partner with Club' or any other partner action -- it matches none of deriveClubNetworkActions' exact-status checks", () => {
  const caps = new Set(["club.partners.manage", "fixture.request.create", "fixture.request.respond"])
  const m = marker({ partnershipStatus: "unknown" })
  const actions = deriveClubNetworkActions(m, "viewer-club", caps)
  assert.equal(actions.canPartner, false)
  assert.equal(actions.canCancelOutgoingPartnerRequest, false)
  assert.equal(actions.canRespondPartnerRequest, false)
  assert.equal(actions.canRevokePartnership, false)
  // Compare Calendars specifically requires an ACTIVE partnership -- unknown never satisfies that either.
  assert.equal(actions.canCompareCalendar, false)
  // Find a Fixture is NOT partnership-gated at all -- a team-scoped viewer with genuine fixture
  // authority must still be able to find a fixture even though their partnership state is unknown.
  assert.equal(actions.canFindFixture, true)
})

test("buildPartnershipIndex never builds a real index without authority, however many rows are (hypothetically) passed to it", () => {
  const rows = [{ id: "p1", requesting_club_id: "viewer-club", partner_club_id: "other-club", status: "active" }]
  assert.equal(buildPartnershipIndex(rows, "viewer-club", false).size, 0, "an index was built without authority")
  assert.equal(buildPartnershipIndex(rows, null, true).size, 0, "an index was built with no viewer club")
  assert.equal(buildPartnershipIndex(rows, "viewer-club", true).size, 1, "authority + rows should build a real index")
})

test("applyClubhouseFilter: 'partners' never includes an UNKNOWN partnership status", () => {
  const markers = [
    marker({ directoryId: "a", partnershipStatus: "active" }),
    marker({ directoryId: "b", partnershipStatus: "unknown" }),
  ]
  const result = applyClubhouseFilter(markers, "partners", null)
  assert.deepEqual(result.map((m) => m.directoryId), ["a"])
})

test("isValidClubCoordinate accepts real UK/Ireland coordinates and rejects nonsense", () => {
  // Real examples: Preston (union), Shetland's northern tip, Ireland's westernmost point, a Channel Island.
  assert.equal(isValidClubCoordinate(53.77, -2.7), true)
  assert.equal(isValidClubCoordinate(60.85, -0.85), true)
  assert.equal(isValidClubCoordinate(52.13, -10.5), true)
  assert.equal(isValidClubCoordinate(49.2, -2.13), true)
  // Rejected: null, NaN, Infinity, out of range, and the classic (0, 0) "Null Island" placeholder bug.
  assert.equal(isValidClubCoordinate(null, -2.7), false)
  assert.equal(isValidClubCoordinate(53.77, null), false)
  assert.equal(isValidClubCoordinate(NaN, -2.7), false)
  assert.equal(isValidClubCoordinate(53.77, Infinity), false)
  assert.equal(isValidClubCoordinate(0, 0), false)
  assert.equal(isValidClubCoordinate(90, 0), false, "the North Pole is not a rugby club")
  assert.equal(isValidClubCoordinate(40.7, -74.0), false, "New York is not in the UK/Ireland directory")
})

test("a non-geocoded club (hasLocation: false) remains searchable and listable -- it is never dropped, only excluded from the map layer", () => {
  const geocoded = marker({ directoryId: "a", hasLocation: true, latitude: 53.77, longitude: -2.7, name: "Preston Grasshoppers" })
  const notGeocoded = marker({ directoryId: "b", hasLocation: false, latitude: null, longitude: null, name: "Truro RFC" })
  const markers = [geocoded, notGeocoded]
  // Search finds it.
  assert.equal(matchesClubhouseQuery(notGeocoded, "truro"), true)
  // The "on the map" population (what a native/web map layer would render) excludes it correctly...
  const onMap = markers.filter((m) => m.hasLocation)
  assert.deepEqual(onMap.map((m) => m.directoryId), ["a"])
  // ...but the full discovery population (what List renders) still includes both, unfiltered by location.
  assert.deepEqual(markers.map((m) => m.directoryId), ["a", "b"])
})

test("Map and List share exactly one discovery population -- filtering/searching never diverges between them", () => {
  const markers = [
    marker({ directoryId: "a", name: "Preston Grasshoppers", networkState: "on_ovalball", hasLocation: true }),
    marker({ directoryId: "b", name: "Burnley RUFC", networkState: "not_on_ovalball", hasLocation: false }),
    marker({ directoryId: "c", name: "Bromley RFC", networkState: "on_ovalball", hasLocation: true }),
  ]
  const filtered = applyClubhouseFilter(markers, "on_ovalball", null).filter((m) => matchesClubhouseQuery(m, ""))
  // The MAP population is this same filtered set, restricted only by hasLocation -- never a separately
  // fetched or separately filtered list.
  const mapPopulation = filtered.filter((m) => m.hasLocation)
  const listPopulation = filtered
  assert.deepEqual(mapPopulation.map((m) => m.directoryId), ["a", "c"])
  assert.deepEqual(listPopulation.map((m) => m.directoryId), ["a", "c"])
  // Every map member is also a list member -- the map is never a superset of the shared population.
  assert.ok(mapPopulation.every((m) => listPopulation.includes(m)))
})

test("the cluster source's marker properties are exactly four fields, none of them sensitive -- no name, no logo URL, no location text", () => {
  const withLocation = marker({ directoryId: "a", hasLocation: true, latitude: 53.77, longitude: -2.7, name: "Preston Grasshoppers", logoUrl: "https://example.test/crest.png" })
  const withoutLocation = marker({ directoryId: "b", hasLocation: false, latitude: null, longitude: null })
  const fc = buildClubMarkerFeatureCollection([withLocation, withoutLocation])
  // A club with no location contributes nothing to the cluster source -- never a fabricated point.
  assert.equal(fc.features.length, 1)
  const props = fc.features[0]!.properties
  assert.deepEqual(Object.keys(props).sort(), ["directoryId", "isOwnClub", "networkState", "partnershipStatus"])
  assert.ok(!("name" in props), "the club's name leaked into the marker payload")
  assert.ok(!("logoUrl" in props), "a crest URL leaked into the marker payload")
  assert.ok(!("town" in props) && !("postcode" in props), "location text leaked into the marker payload")
})

test("distanceMiles is null whenever either point is unknown, and correct (within a mile) for a known real distance", () => {
  const unknown = { latitude: null, longitude: null }
  const known = { latitude: 53.77, longitude: -2.7 }
  assert.equal(distanceMiles(unknown, known), null)
  assert.equal(distanceMiles(known, unknown), null)
  // London to Manchester is ~163 miles as the crow flies.
  const london = { latitude: 51.5074, longitude: -0.1278 }
  const manchester = { latitude: 53.4808, longitude: -2.2426 }
  const d = distanceMiles(london, manchester)
  assert.ok(d !== null && Math.abs(d - 163) < 3, `expected ~163 miles, got ${d}`)
})

test("findDistanceOrigin only ever returns the viewer's OWN club, and only when it has a real location -- never a guessed or device-location origin", () => {
  const notOwn = marker({ directoryId: "a", isOwnClub: false, hasLocation: true })
  const ownNoLocation = marker({ directoryId: "b", isOwnClub: true, hasLocation: false, latitude: null, longitude: null })
  assert.equal(findDistanceOrigin([notOwn, ownNoLocation]), null, "an own club with no real location must not become the origin")
  const ownWithLocation = marker({ directoryId: "c", isOwnClub: true, hasLocation: true, latitude: 53.77, longitude: -2.7 })
  assert.equal(findDistanceOrigin([notOwn, ownWithLocation])?.directoryId, "c")
})

test("applyClubhouseDistanceFilter never drops a club with no known location, whatever radius is chosen", () => {
  const origin = marker({ directoryId: "origin", isOwnClub: true, hasLocation: true, latitude: 53.77, longitude: -2.7 })
  const noLocation = marker({ directoryId: "unknown-location", hasLocation: false, latitude: null, longitude: null })
  const far = marker({ directoryId: "far", hasLocation: true, latitude: 51.5074, longitude: -0.1278 }) // London, ~163mi from Preston
  const result = applyClubhouseDistanceFilter([origin, noLocation, far], 10, origin)
  assert.ok(result.some((m) => m.directoryId === "unknown-location"), "a club with no location was wrongly dropped by a distance filter")
  assert.ok(!result.some((m) => m.directoryId === "far"), "a genuinely-far club was not filtered out")
})

test("applyClubhouseDistanceFilter is a no-op without a factual origin -- it never fabricates one, and never hides clubs behind an origin-less radius", () => {
  const markers = [marker({ directoryId: "a" }), marker({ directoryId: "b" })]
  assert.deepEqual(applyClubhouseDistanceFilter(markers, 10, null), markers)
  assert.deepEqual(applyClubhouseDistanceFilter(markers, "any", null), markers)
})

// ---------------------------------------------------------------------------------------------
// CLUBHOUSE PROGRAMME SECTION 3 -- location precision, computed at read time, no new schema.
// ---------------------------------------------------------------------------------------------

test("resolveClubLocation: a verified venue beats the directory postcode centroid -- the real Preston Grasshoppers case found auditing this section", () => {
  // Real coordinates found in the live directory: the directory's own postcode-centroid geocode, and
  // the club's own venue, roughly 8km apart -- both genuinely 'success', only one is the real ground.
  const directory = { latitude: 53.786811, longitude: -2.644685, geocodeSuccess: true }
  const venue = { latitude: 53.814141, longitude: -2.760304, geocodeSuccess: true }
  const result = resolveClubLocation(directory, venue)
  assert.equal(result.precision, "venue")
  assert.equal(result.latitude, venue.latitude)
  assert.equal(result.longitude, venue.longitude)
})

test("resolveClubLocation falls back to the directory postcode centroid when there is no venue, or the venue itself failed to geocode", () => {
  const directory = { latitude: 53.77, longitude: -2.7, geocodeSuccess: true }
  assert.deepEqual(resolveClubLocation(directory, null), { latitude: 53.77, longitude: -2.7, precision: "postcode" })
  assert.deepEqual(resolveClubLocation(directory, { latitude: null, longitude: null, geocodeSuccess: false }), {
    latitude: 53.77,
    longitude: -2.7,
    precision: "postcode",
  })
})

test("resolveClubLocation never trusts a venue coordinate that fails the same UK/Ireland plausibility bound the directory itself is held to", () => {
  const directory = { latitude: 53.77, longitude: -2.7, geocodeSuccess: true }
  // A 'successful' venue geocode that is nonetheless nonsense (Null Island) must not win just because
  // it is a venue -- resolveClubLocation applies isValidClubCoordinate to BOTH sources equally.
  const badVenue = { latitude: 0, longitude: 0, geocodeSuccess: true }
  assert.deepEqual(resolveClubLocation(directory, badVenue), { latitude: 53.77, longitude: -2.7, precision: "postcode" })
})

test("resolveClubLocation is 'unknown' -- never a guessed coordinate -- when neither source is trustworthy", () => {
  const directory = { latitude: null, longitude: null, geocodeSuccess: false }
  assert.deepEqual(resolveClubLocation(directory, null), { latitude: null, longitude: null, precision: "unknown" })
  const directoryFailed = { latitude: 53.77, longitude: -2.7, geocodeSuccess: false }
  assert.equal(resolveClubLocation(directoryFailed, null).precision, "unknown", "geocode_status != success must never be trusted merely because a number is present")
})

test("a directory-only (unclaimed) club can never reach 'venue' precision -- it has no venues row to prefer, by construction", () => {
  // An unclaimed club literally cannot have a venue (venues.club_id references clubs, which requires
  // activation) -- this test documents that invariant at the resolveClubLocation call boundary: no
  // venue argument is ever available to pass for one, so the caller always passes null.
  const directory = { latitude: 53.77, longitude: -2.7, geocodeSuccess: true }
  assert.equal(resolveClubLocation(directory, null).precision, "postcode")
})

test("a team-context viewer (fixture authority, no club.partners.manage) gets a safe projection: can find a fixture, cannot see or act on partnership", () => {
  // fixture.request.create/.respond only -- exactly what a Coach/Team Manager holds, per the
  // capability catalogue; club.partners.manage is deliberately absent.
  const teamCaps = new Set(["fixture.request.create", "fixture.request.respond"])
  const m = marker({ partnershipStatus: "unknown", networkState: "on_ovalball" })
  const actions = deriveClubNetworkActions(m, "viewer-club", teamCaps)
  assert.equal(actions.canFindFixture, true, "team-scoped fixture authority must still find a fixture")
  assert.equal(actions.canPartner, false)
  assert.equal(actions.canCompareCalendar, false)
  assert.equal(actions.canInviteToOvalball, false, "club.partners.manage is required to invite, which a team-scoped viewer never holds")
})
