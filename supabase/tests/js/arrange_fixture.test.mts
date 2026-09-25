import { test } from "node:test"
import assert from "node:assert/strict"

import { arrangeFixtureAvailabilityLabel, buildArrangeFixtureSummary, describeArrangeFixtureHost } from "../../../packages/contracts/src/fixtures/arrange-fixture"

/**
 * CLUBHOUSE PROGRAMME SECTION 8 -- ARRANGE A FIXTURE: pure display-semantics logic pinned directly.
 * Authority and mutation live entirely in the database (fixture_request_groups_insert_scoped /
 * fixture_requests_insert_scoped RLS plus the two Section 8 triggers -- proven by
 * `supabase/tests/arrange_fixture_authority.sql`); this module only ever decides what a person is
 * TOLD, never what is allowed.
 */

test("describeArrangeFixtureHost: 'home' means WE host, named by our own club", () => {
  const host = describeArrangeFixtureHost("home", "Ovalball UAT RUFC", "Burnley RUFC")
  assert.equal(host.outcome, "we_host")
  assert.equal(host.statement, "Ovalball UAT RUFC will host.")
})

test("describeArrangeFixtureHost: 'away' means THEY host, named by the opponent's club, not ours", () => {
  const host = describeArrangeFixtureHost("away", "Ovalball UAT RUFC", "Burnley RUFC")
  assert.equal(host.outcome, "they_host")
  assert.equal(host.statement, "Burnley RUFC will host.")
})

test("describeArrangeFixtureHost: 'away' with no opponent club name yet gives no statement, never a guess", () => {
  const host = describeArrangeFixtureHost("away", "Ovalball UAT RUFC", null)
  assert.equal(host.outcome, "they_host")
  assert.equal(host.statement, null)
})

test("describeArrangeFixtureHost: 'either' is a genuine open question, never faked as a side or as TBD", () => {
  const host = describeArrangeFixtureHost("either", "Ovalball UAT RUFC", "Burnley RUFC")
  assert.equal(host.outcome, "not_yet_agreed")
  assert.equal(host.statement, null)
})

test("arrangeFixtureAvailabilityLabel: never softens to 'Available' -- the labels are exactly Section 7's own vocabulary", () => {
  assert.equal(arrangeFixtureAvailabilityLabel("no_known_clash"), "No known clash")
  assert.equal(arrangeFixtureAvailabilityLabel("busy"), "Busy")
  assert.equal(arrangeFixtureAvailabilityLabel("tentative"), "Tentative")
  assert.equal(arrangeFixtureAvailabilityLabel("unknown"), "Unknown")
  assert.equal(arrangeFixtureAvailabilityLabel(null), null)
})

test("buildArrangeFixtureSummary: one projection carries the host statement and the availability label together", () => {
  const summary = buildArrangeFixtureSummary({
    ourTeamLabel: "Under 12 Boys",
    opponentLabel: "Burnley RUFC Under 12 Boys",
    dateLabel: "Saturday 17 October",
    kickoffTime: "10:30",
    venuePreference: "away",
    ourClubName: "Ovalball UAT RUFC",
    opponentClubName: "Burnley RUFC",
    availabilityContext: "no_known_clash",
  })
  assert.equal(summary.ourTeamLabel, "Under 12 Boys")
  assert.equal(summary.opponentLabel, "Burnley RUFC Under 12 Boys")
  assert.equal(summary.dateLabel, "Saturday 17 October")
  assert.equal(summary.kickoffLabel, "10:30")
  assert.equal(summary.host.outcome, "they_host")
  assert.equal(summary.host.statement, "Burnley RUFC will host.")
  assert.equal(summary.availabilityLabel, "No known clash")
})

test("buildArrangeFixtureSummary: an omitted availability context is genuinely absent, never defaulted to a claim", () => {
  const summary = buildArrangeFixtureSummary({
    ourTeamLabel: "Under 12 Boys",
    opponentLabel: "Burnley RUFC Under 12 Boys",
    dateLabel: "Saturday 17 October",
    kickoffTime: null,
    venuePreference: "home",
    ourClubName: "Ovalball UAT RUFC",
    opponentClubName: "Burnley RUFC",
  })
  assert.equal(summary.availabilityLabel, null)
  assert.equal(summary.kickoffLabel, null)
})
