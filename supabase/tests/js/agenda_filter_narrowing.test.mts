/**
 * THE FILTER NARROWS, AND SAYS SO.
 *
 * `applyAgendaFilters` and the app's `applyFilter` are the same rule written for
 * two state shapes, and both are pure array filters over rows the loader already
 * returned -- so the thing worth proving is not authority (there is no query
 * here to widen) but that each control removes exactly what it claims and
 * nothing else, on BOTH clients.
 *
 * WHAT PROMPTED IT. The owner asked for a "Show Cancelled Fixtures" tick box and
 * for the team chips to read "U12, U13" rather than "Under 12 Boys". Both are one
 * line of code and both are the kind of one line that is quietly wrong in one
 * client and right in the other -- which is the only reason a filter needs a
 * test at all.
 */

import assert from "node:assert/strict"
import { test } from "node:test"

import {
  applyAgendaFilters,
  defaultFilterState,
  hasActiveFilters,
  parseFilterState,
  filterQuery,
  teamOptions,
} from "@ovalball/contracts/agenda/filters"
import type { AgendaItem } from "@ovalball/contracts/agenda/load"

const TODAY = "2026-09-23"

function side(teamName: string, compactName: string | null) {
  return { directoryId: null, clubName: "Ovalball UAT RUFC", teamName, compactName, rugbyCode: "union", crestUrl: null, kit: null }
}

function fixture(partial: Partial<AgendaItem> & { key: string; teamId: string }): AgendaItem {
  return {
    kind: "fixture",
    eventId: partial.key,
    date: "2026-10-02",
    time: "10:30",
    meetTime: null,
    us: side("Under 12 Boys", "U12"),
    them: null,
    homeAway: "Home",
    venue: null,
    pitch: null,
    status: "Booked",
    result: null,
    playerId: null,
    childFirstName: null,
    attendance: null,
    clubId: "club-1",
    href: null,
    ...partial,
  } as AgendaItem
}

const ROWS: AgendaItem[] = [
  fixture({ key: "a", teamId: "t12" }),
  fixture({ key: "b", teamId: "t13", us: side("Under 13 Boys", "U13"), date: "2026-10-09" }),
  fixture({ key: "c", teamId: "t12", status: "Cancelled", date: "2026-10-16" }),
  fixture({ key: "d", teamId: "t14", us: side("Under 14 Girls", "Girls U14"), date: "2026-10-23" }),
  fixture({ key: "training", teamId: "t12", kind: "training", them: null, status: null, date: "2026-10-06" }),
]

test("cancelled fixtures are shown by default", () => {
  const state = defaultFilterState(TODAY)
  assert.equal(state.includeCancelled, true, "a called-off match is the reason somebody does NOT travel")
  assert.ok(applyAgendaFilters(ROWS, state, TODAY).some((i) => i.key === "c"))
  assert.equal(hasActiveFilters(state), false, "showing everything is not a filter")
})

test("hiding cancelled removes exactly the cancelled fixtures", () => {
  const state = { ...defaultFilterState(TODAY), includeCancelled: false }
  const kept = applyAgendaFilters(ROWS, state, TODAY)
  assert.deepEqual(
    kept.map((i) => i.key).sort(),
    ["a", "b", "d", "training"],
    "only the Cancelled row goes -- training and every live fixture stay"
  )
  assert.equal(hasActiveFilters(state), true, "and the interface says something is narrowing the view")
})

test("hiding cancelled survives the round trip through a URL", () => {
  const state = { ...defaultFilterState(TODAY), includeCancelled: false }
  const query = filterQuery(state, TODAY)
  assert.ok(query.includes("cancelled=0"))
  // parseFilterState takes the anchor parser rather than owning one -- the web
  // and the app resolve "which day am I looking at" differently, and the filter
  // module deliberately does not pick.
  const parsed = parseFilterState(
    Object.fromEntries(new URLSearchParams(query.split("?")[1])),
    TODAY,
    (v, fallback) => v ?? fallback
  )
  assert.equal(parsed.includeCancelled, false)
  // And the default is not written into the URL, so a plain agenda link stays clean.
  assert.equal(filterQuery(defaultFilterState(TODAY), TODAY).includes("cancelled"), false)
})

test("the team filter offers the COMPACT canonical label", () => {
  const options = teamOptions(ROWS)
  assert.deepEqual(
    options.map((o) => o.name),
    ["Girls U14", "U12", "U13"],
    "filter chips are the dense surface the canonical naming rule names the compact form for"
  )
})

test("a team with no compact identity falls back to the display name, never to a shortened one", () => {
  const rows = [fixture({ key: "x", teamId: "tx", us: side("Under 15 Boys", null) })]
  assert.deepEqual(teamOptions(rows).map((o) => o.name), ["Under 15 Boys"])
})

test("the team filter narrows to one side and takes nothing else with it", () => {
  const state = { ...defaultFilterState(TODAY), teamId: "t12" }
  assert.deepEqual(applyAgendaFilters(ROWS, state, TODAY).map((i) => i.key).sort(), ["a", "c", "training"])
})

test("cancelled and team narrow together without either forgetting the other", () => {
  const state = { ...defaultFilterState(TODAY), teamId: "t12", includeCancelled: false }
  assert.deepEqual(applyAgendaFilters(ROWS, state, TODAY).map((i) => i.key).sort(), ["a", "training"])
})

test("a filter can only ever remove", () => {
  const state = { ...defaultFilterState(TODAY), teamId: "nobody", includeCancelled: false, includeTraining: false }
  const kept = applyAgendaFilters(ROWS, state, TODAY)
  assert.equal(kept.length, 0)
  assert.ok(kept.every((i) => ROWS.includes(i)), "nothing arrives that the loader did not return")
})
