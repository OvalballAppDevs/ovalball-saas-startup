import { test } from "node:test"
import assert from "node:assert/strict"

import { pageFixtures } from "../../../apps/mobile/src/agenda/fixture-list"
import { resultOutcome } from "../../../apps/mobile/src/agenda/presentation"
import { NO_FILTER, applyFilter, countActive, isFiltered, type AgendaFilter } from "../../../apps/mobile/src/agenda/filter"
import { gameTypeOptions } from "../../../packages/contracts/src/agenda/filters"
import type { AgendaItem } from "../../../packages/contracts/src/agenda/load"
import { routeForIntent } from "../../../apps/mobile/src/links/destinations"

/**
 * OWNER CORRECTION PASS -- MOBILE FIXTURES AGENDA REDESIGN. Pure-logic regression pins for: the
 * five-at-a-time paging behind "View all", Win/Loss/Draw wording, the new Fixture Type filter
 * dimension, and the staff-only cancelled-hidden default measured against a BASELINE rather than
 * `NO_FILTER` (so a default nobody chose never lights up the Filter button as an active filter).
 */
function side(clubName: string) {
  return { directoryId: null, clubName, teamName: "Men's 1st Team", compactName: "Men's 1st", rugbyCode: "union" as const, crestUrl: null, kit: null }
}

function fixture(partial: Partial<AgendaItem> & { key: string }): AgendaItem {
  return {
    kind: "fixture",
    eventId: partial.key,
    date: "2026-10-02",
    time: "14:00",
    meetTime: null,
    us: side("Ovalball UAT RUFC"),
    them: side("Preston Grasshoppers RFC"),
    homeAway: "Home",
    venue: "UAT North Fields",
    pitch: null,
    status: "Booked",
    gameType: "League Fixture",
    result: null,
    playerId: null,
    childFirstName: null,
    attendance: null,
    teamId: "team-1",
    clubId: "club-1",
    href: null,
    ...partial,
  } as AgendaItem
}

test("pageFixtures: five at a time, and 'View all' (expanded) reveals the rest", () => {
  const items = Array.from({ length: 8 }, (_, i) => fixture({ key: `f${i}` }))
  const collapsed = pageFixtures(items, false)
  assert.equal(collapsed.shown.length, 5)
  assert.equal(collapsed.hasMore, true)

  const expanded = pageFixtures(items, true)
  assert.equal(expanded.shown.length, 8)
  assert.equal(expanded.hasMore, false)
})

test("pageFixtures: fewer than five never claims there is more", () => {
  const items = [fixture({ key: "a" }), fixture({ key: "b" })]
  const page = pageFixtures(items, false)
  assert.equal(page.shown.length, 2)
  assert.equal(page.hasMore, false)
})

test("resultOutcome: Win/Loss/Draw derived from our own already-normalised score, never fabricated for a fixture with no result", () => {
  assert.equal(resultOutcome({ ourScore: 24, theirScore: 18 })?.label, "Win")
  assert.equal(resultOutcome({ ourScore: 12, theirScore: 18 })?.label, "Loss")
  assert.equal(resultOutcome({ ourScore: 10, theirScore: 10 })?.label, "Draw")
  assert.equal(resultOutcome(null), null)
})

test("gameTypeOptions: only match types genuinely present in the authorised rows are offered, never the full canonical list, never one for training or an unset type", () => {
  const rows = [
    fixture({ key: "a", gameType: "League Fixture" }),
    fixture({ key: "b", gameType: "Friendly" }),
    fixture({ key: "c", gameType: "League Fixture" }),
    fixture({ key: "d", gameType: null }),
    fixture({ key: "e", kind: "training", gameType: null, them: null }),
  ]
  assert.deepEqual(gameTypeOptions(rows).map((o) => o.name), ["Friendly", "League Fixture"])
})

test("applyFilter: gameType narrows to exactly that canonical value, training is never matched by a fixture-type filter", () => {
  const rows = [
    fixture({ key: "a", gameType: "League Fixture" }),
    fixture({ key: "b", gameType: "Friendly" }),
    fixture({ key: "training", kind: "training", gameType: null, them: null }),
  ]
  const filter: AgendaFilter = { ...NO_FILTER, gameType: "League Fixture" }
  assert.deepEqual(applyFilter(rows, filter).map((r) => r.key), ["a"])
})

test("isFiltered/countActive against a baseline: a staff default (cancelled hidden) is never counted as an active filter someone chose", () => {
  const staffBaseline: AgendaFilter = { ...NO_FILTER, includeCancelled: false }
  // Freshly landed on the screen: filter === baseline exactly.
  assert.equal(isFiltered(staffBaseline, staffBaseline), false)
  assert.equal(countActive(staffBaseline, staffBaseline), 0)

  // The person explicitly turns cancelled back on: now a genuine departure from the baseline.
  const turnedOn: AgendaFilter = { ...staffBaseline, includeCancelled: true }
  assert.equal(isFiltered(turnedOn, staffBaseline), true)
  assert.equal(countActive(turnedOn, staffBaseline), 1)

  // Every existing caller that never passes a baseline keeps comparing against NO_FILTER exactly as before.
  assert.equal(isFiltered(staffBaseline), true, "measured against the bare NO_FILTER (the old, still-default behaviour), hiding cancelled IS a departure")
})

test("ADD_RESULT is in the one routing table, never a hand-built path", () => {
  assert.deepEqual(routeForIntent({ kind: "ADD_RESULT", fixtureId: "fx-1" }), {
    pathname: "/fixtures/[fixtureId]/add-result",
    params: { fixtureId: "fx-1" },
  })
})

test("applyFilter: cancelled hidden removes exactly the cancelled rows, whatever the baseline that produced the setting", () => {
  const rows = [fixture({ key: "a", status: "Booked" }), fixture({ key: "b", status: "Cancelled" })]
  assert.deepEqual(applyFilter(rows, { ...NO_FILTER, includeCancelled: false }).map((r) => r.key), ["a"])
  assert.deepEqual(
    applyFilter(rows, { ...NO_FILTER, includeCancelled: true }).map((r) => r.key).sort(),
    ["a", "b"]
  )
})
