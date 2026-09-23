/**
 * THE PARENT'S MATCH CENTRE — WHICH HAT, WHERE, AND WHAT THE WEATHER IS.
 *
 * Four defects the owner found on a physical phone, and every one of them had the
 * same shape: a surface asking a narrower question than the platform could answer.
 *
 *   The capabilities were asked about the PERSON and not the HAT, so a club admin
 *   reading their daughter's match as a parent kept their coach's controls.
 *
 *   The venue was read from `venue_id` ALONE, so a fixture whose ground is its own
 *   address said "the venue hasn't been confirmed yet" about a match the Calendar
 *   was describing two taps away.
 *
 *   The forecast resolved its coordinates the same narrow way, so no such fixture
 *   could ever have weather.
 *
 * None of it was an authority hole -- a genuine parent is refused every one of
 * these writes, which `participant_route_authority.sql` proves at the server.
 */

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  NO_MATCH_CENTRE_CAPABILITIES,
  forecastLocation,
  homeClubIdFor,
  narrowCapabilitiesToContext,
  venueNameFromAddress,
  type MatchCentreCapabilities,
  type ResolvedVenue,
} from "@ovalball/contracts"

const STAFF: MatchCentreCapabilities = { canViewParticipants: true, canMessage: true, canManageFixture: true }

// ------------------------------------------------- one person, several hats

test("a club admin reading as a parent is offered none of their staff controls", () => {
  for (const kind of ["parent", "family", "player"] as const) {
    assert.deepEqual(narrowCapabilitiesToContext(STAFF, kind), NO_MATCH_CENTRE_CAPABILITIES)
  }
})

test("and gets every one of them back in the context they actually hold them in", () => {
  for (const kind of ["team", "club", "site_admin", "governing"] as const) {
    assert.deepEqual(narrowCapabilitiesToContext(STAFF, kind), STAFF)
  }
})

test("the narrowing can only ever remove", () => {
  // Nothing here can turn a false into a true, which is what makes it safe to
  // apply on a client. The database remains the authority either way.
  const none = NO_MATCH_CENTRE_CAPABILITIES
  for (const kind of ["parent", "family", "player", "team", "club", "site_admin", null] as const) {
    const out = narrowCapabilitiesToContext(none, kind)
    assert.deepEqual(out, none, `${kind} was granted something the server refused`)
  }
})

test("an unresolved context changes nothing, because the server already answered", () => {
  assert.deepEqual(narrowCapabilitiesToContext(STAFF, null), STAFF)
})

test("the Match Centre asks which hat, and the announce and console rows follow it", () => {
  const load = readFileSync("apps/mobile/src/match-centre/load.ts", "utf8")
  assert.match(load, /narrowCapabilitiesToContext\(/)
  assert.match(load, /contextKind: ActiveContextKind \| null = null/)
  const screen = readFileSync("apps/mobile/src/fixtures/match-centre.tsx", "utf8")
  assert.match(screen, /loadMatchCentre\(supabase, id, active\?\.kind \?\? null\)/)
  // Both controls are gated on the narrowed capability, not on a role name.
  assert.match(screen, /\{view\.canManageFixture && \(audience\.team !== null/)
  assert.match(screen, /\{view\.canManageFixture && \(/)
})

// ---------------------------------------------------------- where it is played

const venueRow: ResolvedVenue = {
  name: "Ovalball UAT Ground",
  address: "Belvedere Road, Burnley, Lancashire, BB10 2LS",
  postcode: "BB10 2LS",
  latitude: 53.819394,
  longitude: -2.234962,
  geocodeStatus: "success",
  source: "fixture_venue",
  coordinateSource: "venue",
}

test("the home side is the owning club at home and the opposition away", () => {
  assert.equal(homeClubIdFor({ homeAway: "Home", owningClubId: "ours", opponentClubId: "theirs" }), "ours")
  assert.equal(homeClubIdFor({ homeAway: "Away", owningClubId: "ours", opponentClubId: "theirs" }), "theirs")
})

test("an unsettled orientation has no home ground, because a festival is nobody's", () => {
  for (const homeAway of ["TBD", "Not Applicable", null]) {
    assert.equal(homeClubIdFor({ homeAway, owningClubId: "ours", opponentClubId: "theirs" }), null)
  }
})

test("a ground's name comes out of the address a secretary typed", () => {
  assert.equal(
    venueNameFromAddress("Ovalball UAT Opposition RFC, Lightfoot Lane, Preston, PR4 0TA"),
    "Ovalball UAT Opposition RFC"
  )
  // No comma: the whole line is the name, and nothing is discarded either way.
  assert.equal(venueNameFromAddress("Prairie Playing Fields"), "Prairie Playing Fields")
  assert.equal(venueNameFromAddress("  Lightfoot Green  "), "Lightfoot Green")
})

test("the resolver reads all three ways a fixture records where it is played", () => {
  const module = readFileSync("packages/contracts/src/fixtures/venue.ts", "utf8")
  assert.match(module, /input\.venueId/, "the chosen venue is not consulted")
  assert.match(module, /input\.venueAddress/, "the fixture's own address is not consulted")
  assert.match(module, /is_default_home/, "the home side's default ground is not consulted")
  assert.match(module, /club_directory/, "a Directory-only opponent has no ground")
})

test("the Match Centre shows the ground's NAME, and Directions keeps the address", () => {
  const panel = readFileSync("apps/mobile/src/components/match-conditions.tsx", "utf8")
  assert.match(panel, /\{venueName \?\? "Venue to be confirmed"\}/)
  // The address is not printed beneath the name any more...
  assert.ok(!/\{addressLines\.join\(", "\)\}/.test(panel), "the postal address is printed on the page")
  // ...but Directions still receives every line of it.
  assert.match(panel, /const destination = \[venueName, \.\.\.addressLines, postcode\]/)
})

test("both clients resolve the venue through the one module", () => {
  const app = readFileSync("apps/mobile/src/match-centre/load.ts", "utf8")
  const route = readFileSync("app/api/fixtures/[fixtureId]/forecast/route.ts", "utf8")
  assert.match(app, /resolveFixtureVenue\(supabase, \{/)
  assert.match(route, /resolveFixtureVenue\(supabase, \{/)
  // So the page cannot name a ground the weather was never asked about.
  assert.ok(!/\.from\("venues"\)/.test(route), "the route still reads a venue of its own")
})

// -------------------------------------------------------------- the forecast

test("only coordinates with their own provenance are offered to the sky", () => {
  assert.deepEqual(forecastLocation(venueRow), { latitude: 53.819394, longitude: -2.234962 })
  // A number somebody typed pins a rugby club on a football ground three
  // kilometres away, and the sky answers confidently about the wrong place.
  assert.equal(forecastLocation({ ...venueRow, geocodeStatus: "pending" }), null)
  assert.equal(forecastLocation({ ...venueRow, geocodeStatus: "failed" }), null)
  assert.equal(forecastLocation({ ...venueRow, latitude: null }), null)
  assert.equal(forecastLocation(null), null)
})

test("free text names a ground and locates nothing, so the coordinates come from the home side", () => {
  const module = readFileSync("packages/contracts/src/fixtures/venue.ts", "utf8")
  // Two questions, two best answers, and the provenance says which is which.
  assert.match(module, /coordinateSource: "venue" \| "directory" \| null/)
  assert.match(module, /const located = await homeSideLocation\(supabase, input\)/)
  assert.match(module, /source: "fixture_address"/)
})

test("the forecast route asks the resolver, not venue_id", () => {
  const route = readFileSync("app/api/fixtures/[fixtureId]/forecast/route.ts", "utf8")
  assert.match(route, /const location = forecastLocation\(venue\)/)
  assert.match(route, /latitude: location\?\.latitude \?\? null/)
  assert.ok(!/fixture\.venue_id\n/.test(route.split("resolveFixtureVenue")[0].split("select(")[1] ?? ""), "the route still branches on venue_id alone")
})

// --------------------------------------------------- a child is not an adult

test("a child's picture has exactly one source, and a guardian's is never it", () => {
  const resolver = readFileSync("packages/contracts/src/family/avatars.ts", "utf8")
  assert.match(resolver, /from\("player-avatars"\)/, "a child's picture is read from the wrong bucket")
  assert.ok(!/from\("avatars"\)/.test(resolver), "a child's picture could come from an adult account bucket")
  // The projection copies the player's own path and has no other input.
  const projection = readFileSync("packages/contracts/src/family/projection.ts", "utf8")
  assert.match(projection, /child\.avatarStoragePath \? \(avatarUrls\.get\(child\.avatarStoragePath\) \?\? null\) : null/)
  // And the scope copies it from the PLAYER row, never from a profile.
  const scope = readFileSync("packages/contracts/src/session-context.ts", "utf8")
  assert.match(scope, /avatarStoragePath: player\.avatar_storage_path \?\? null/)
})

test("every player surface draws the same child through the same projection", () => {
  for (const [file, expected] of [
    ["apps/mobile/src/components/child-mark.tsx", /member\.avatarUrl/],
    ["apps/mobile/src/components/child-filter.tsx", /child\.avatarUrl/],
    ["apps/mobile/src/components/participant/match-card.tsx", /url=\{child\.avatarUrl\}/],
  ] as const) {
    assert.match(readFileSync(file, "utf8"), expected, `${file} resolves a child's picture its own way`)
  }
})

test("no player surface reaches for the signed-in person's picture", () => {
  for (const file of [
    "apps/mobile/src/components/child-mark.tsx",
    "apps/mobile/src/components/participant/match-card.tsx",
  ]) {
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
    assert.ok(!/person\.avatarUrl|useAppContexts/.test(src), `${file} can reach the account's own avatar`)
  }
})
