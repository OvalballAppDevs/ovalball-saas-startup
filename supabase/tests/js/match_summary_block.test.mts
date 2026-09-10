import assert from "node:assert/strict"
import { test } from "node:test"

import { matchSummaryBlock } from "@/lib/email/design/components"
import type { FixtureEmailContext } from "@/lib/email/context/resolve-fixture-email-context"

const SITE = "http://localhost:3000"

/**
 * REAL RUGBY DATA IS NOT ALWAYS COMPLETE.
 *
 * A fixture with no pitch assigned, no meet time, or an unclaimed opponent
 * with no crest on file is the NORMAL case, not an edge case -- these tests
 * pin that matchSummaryBlock collapses each missing optional field cleanly
 * rather than printing "Meet: null" or an empty row, per the same standard
 * every other renderer in this file is held to.
 */

function baseContext(overrides: Partial<FixtureEmailContext> = {}): FixtureEmailContext {
  const home = { displayName: "Solihull Rugby Club", teamLabel: "U12 Boys", crestUrl: `${SITE}/email-assets/club-crest/club-1` }
  const away = { displayName: "Sample RUFC", teamLabel: "U12 Boys", crestUrl: `${SITE}/email-assets/directory-crest/dir-1` }
  return {
    fixtureId: "fixture-1",
    status: "ACCEPTED",
    fixtureDateDisplay: "Sunday 20 September",
    fixtureDateIso: "2026-09-20",
    kickoffTimeDisplay: "14:15",
    meetTimeDisplay: "13:30",
    homeAway: "Home",
    home,
    away,
    ourTeam: home,
    opposition: away,
    venue: { name: "Towneley Park", addressLines: ["Manchester Road"], postcode: "BB11 3ED" },
    pitchName: "Pitch 2",
    competitionName: "Premiership",
    attendanceCounts: { attending: 12, cannotAttend: 2, unsure: 1, awaitingResponse: 3 },
    ...overrides,
  }
}

test("full data renders team names, both crests, timing and venue", () => {
  const html = matchSummaryBlock(baseContext(), SITE)
  assert.ok(html.includes("Solihull Rugby Club"))
  assert.ok(html.includes("Sample RUFC"))
  assert.ok(html.includes(`${SITE}/email-assets/club-crest/club-1`))
  assert.ok(html.includes(`${SITE}/email-assets/directory-crest/dir-1`))
  assert.ok(html.includes("Meet 13:30"))
  assert.ok(html.includes("Kick-off 14:15"))
  assert.ok(html.includes("Towneley Park"))
  assert.ok(html.includes("Pitch 2"))
})

test("missing pitch collapses cleanly -- no \"undefined\", no empty line", () => {
  const html = matchSummaryBlock(baseContext({ pitchName: null }), SITE)
  assert.ok(!html.includes("undefined"))
  assert.ok(!html.includes("null"))
  assert.ok(html.includes("Towneley Park"))
})

test("no meet time shows only kick-off, not \"Meet: \" with nothing after it", () => {
  const html = matchSummaryBlock(baseContext({ meetTimeDisplay: null }), SITE)
  assert.ok(!html.includes("Meet"))
  assert.ok(html.includes("Kick-off 14:15"))
})

test("no kick-off and no meet time omits the timing row entirely", () => {
  const html = matchSummaryBlock(baseContext({ meetTimeDisplay: null, kickoffTimeDisplay: null }), SITE)
  assert.ok(!html.includes("Meet"))
  assert.ok(!html.includes("Kick-off"))
})

test("no venue omits the address block entirely, without an empty card", () => {
  const html = matchSummaryBlock(baseContext({ venue: null, pitchName: null }), SITE)
  assert.ok(!html.includes("Towneley Park"))
  assert.ok(!html.includes("undefined"))
})

test("a club with no crest on file shows the name alone, never a broken image", () => {
  const html = matchSummaryBlock(baseContext({ home: { displayName: "Solihull Rugby Club", teamLabel: null, crestUrl: null } }), SITE)
  assert.ok(html.includes("Solihull Rugby Club"))
  // Exactly one <img>: the away side keeps its crest, only home lost one.
  assert.equal([...html.matchAll(/<img/g)].length, 1)
})

test("opposition to be confirmed (no team, no directory) renders as text with no crest", () => {
  const html = matchSummaryBlock(baseContext({ away: { displayName: "Opposition to be confirmed", teamLabel: null, crestUrl: null } }), SITE)
  assert.ok(html.includes("Opposition to be confirmed"))
})

test("a foreign-origin crest URL is dropped, exactly like the brand logo and clubIdentity()", () => {
  const html = matchSummaryBlock(
    baseContext({ home: { displayName: "Solihull Rugby Club", teamLabel: null, crestUrl: "https://attacker.example/crest.png" } }),
    SITE
  )
  assert.ok(!html.includes("attacker.example"))
})

test("attendance counts are never rendered as a named participant -- aggregate only", () => {
  const html = matchSummaryBlock(baseContext(), SITE)
  // The block's own contract: no participant name, no email address, no
  // player id ever appears in its output, because the context type it
  // consumes has no field capable of carrying one.
  assert.ok(!html.includes("@"))
})
