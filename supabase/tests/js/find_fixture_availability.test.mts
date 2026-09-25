import { test } from "node:test"
import assert from "node:assert/strict"

import { buildFindFixtureAvailability, countNoKnownClashDates, type ClubMapMarker, type FindFixtureCandidate } from "../../../packages/contracts/src/clubhouse"

/**
 * CLUBHOUSE PROGRAMME SECTION 7 -- AVAILABILITY DISCOVERY: pure client-side logic pinned directly. The
 * canonical blocking RULE (which fixtures/training/club events/competition matches count, the
 * partners-only privacy boundary) lives entirely server-side and is proven by
 * `supabase/tests/availability_discovery.sql` -- these assertions cover the arithmetic this section adds
 * on top: turning the server's minimal, partner-only, blocked-dates-only response into an honest
 * per-date state for every compatible team, including the ones the server never even mentions.
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
    partnershipStatus: "active",
    partnershipId: "p1",
    ...overrides,
  }
}

function candidate(overrides: Partial<FindFixtureCandidate> = {}): FindFixtureCandidate {
  return { ...marker(), compatibleTeams: [{ teamId: "team-1", displayName: "Under 12 Boys", ageGroup: "U12", gender: "MALE" }], ...overrides }
}

const DATES = ["2026-10-03", "2026-10-10", "2026-10-17"]

test("buildFindFixtureAvailability: a partner club with no blocking rows for any requested date reads no_known_clash on every date, never a fabricated 'available'", () => {
  const result = buildFindFixtureAvailability([candidate()], DATES, [])
  assert.equal(result.length, 1)
  assert.deepEqual(
    result[0]!.dates.map((d) => d.state),
    ["no_known_clash", "no_known_clash", "no_known_clash"]
  )
})

test("buildFindFixtureAvailability: a busy row maps to 'busy' on exactly that date, no_known_clash elsewhere", () => {
  const result = buildFindFixtureAvailability([candidate()], DATES, [{ opponent_team_id: "team-1", the_date: "2026-10-10", status: "busy" }])
  assert.deepEqual(
    result[0]!.dates.map((d) => d.state),
    ["no_known_clash", "busy", "no_known_clash"]
  )
})

test("buildFindFixtureAvailability: a request_pending row maps to 'tentative', distinct from busy", () => {
  const result = buildFindFixtureAvailability([candidate()], DATES, [{ opponent_team_id: "team-1", the_date: "2026-10-17", status: "request_pending" }])
  assert.equal(result[0]!.dates[2]!.state, "tentative")
})

test("buildFindFixtureAvailability: a NON-partner candidate is 'unknown' on every date, even when the (hypothetical) rows would otherwise say busy -- it is never even consulted", () => {
  const nonPartner = candidate({ partnershipStatus: "none" })
  const result = buildFindFixtureAvailability([nonPartner], DATES, [{ opponent_team_id: "team-1", the_date: "2026-10-10", status: "busy" }])
  assert.deepEqual(
    result[0]!.dates.map((d) => d.state),
    ["unknown", "unknown", "unknown"]
  )
})

test("buildFindFixtureAvailability: a pending-partnership (not yet active) candidate is also 'unknown', not treated as a partner", () => {
  const pending = candidate({ partnershipStatus: "pending_outgoing" })
  const result = buildFindFixtureAvailability([pending], DATES, [])
  assert.ok(result[0]!.dates.every((d) => d.state === "unknown"))
})

test("buildFindFixtureAvailability: one row per COMPATIBLE TEAM, not per club -- a club with two compatible teams gets two independent rows", () => {
  const twoTeamCandidate = candidate({
    compatibleTeams: [
      { teamId: "team-1", displayName: "Under 12 Boys", ageGroup: "U12", gender: "MALE" },
      { teamId: "team-2", displayName: "Under 12 Girls", ageGroup: "U12", gender: "FEMALE" },
    ],
  })
  const result = buildFindFixtureAvailability([twoTeamCandidate], DATES, [{ opponent_team_id: "team-2", the_date: "2026-10-03", status: "busy" }])
  assert.equal(result.length, 2)
  const team1 = result.find((r) => r.teamId === "team-1")!
  const team2 = result.find((r) => r.teamId === "team-2")!
  assert.equal(team1.dates[0]!.state, "no_known_clash", "team-1's own row is unaffected by team-2's busy row")
  assert.equal(team2.dates[0]!.state, "busy")
})

test("buildFindFixtureAvailability: dates are returned in the exact order requested, one entry per requested date", () => {
  const result = buildFindFixtureAvailability([candidate()], DATES, [])
  assert.deepEqual(
    result[0]!.dates.map((d) => d.date),
    DATES
  )
})

test("countNoKnownClashDates: factual arithmetic, never a subjective score", () => {
  const availability = buildFindFixtureAvailability([candidate()], DATES, [{ opponent_team_id: "team-1", the_date: "2026-10-10", status: "busy" }])[0]!
  assert.equal(countNoKnownClashDates(availability), 2)
})

test("countNoKnownClashDates: 'unknown' and 'tentative' never count as a clear date", () => {
  const nonPartner = candidate({ partnershipStatus: "none" })
  const unknownAvailability = buildFindFixtureAvailability([nonPartner], DATES, [])[0]!
  assert.equal(countNoKnownClashDates(unknownAvailability), 0)

  const tentativeAvailability = buildFindFixtureAvailability([candidate()], DATES, [
    { opponent_team_id: "team-1", the_date: "2026-10-03", status: "request_pending" },
    { opponent_team_id: "team-1", the_date: "2026-10-10", status: "request_pending" },
    { opponent_team_id: "team-1", the_date: "2026-10-17", status: "request_pending" },
  ])[0]!
  assert.equal(countNoKnownClashDates(tentativeAvailability), 0)
})
