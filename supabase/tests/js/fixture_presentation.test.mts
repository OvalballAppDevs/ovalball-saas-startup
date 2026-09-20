import { test } from "node:test"
import assert from "node:assert/strict"

import { FIXTURE_SIDE_SEPARATOR, fixtureSides, fixtureTitle, fixtureTitleFromSides, matchTypeLabel } from "@/lib/fixtures/presentation"
import {
  describeFixtureWindow,
  isCalendarDate,
  parseFixtureWindow,
  stepWindow,
  windowContains,
  windowFor,
} from "@/lib/fixtures/date-window"

/**
 * HOW A FIXTURE IS NAMED, AND HOW A PERIOD IS NAVIGATED.
 *
 * Both were previously decided per screen -- six surfaces each with their own
 * idea of which side goes first, and no surface at all able to express "this
 * week". These assert the rules themselves, so a regression shows up here
 * rather than on one of the six.
 */

// ---------------------------------------------------------------------------
// The home side is named first. Always.
// ---------------------------------------------------------------------------

test("a home fixture names our side first", () => {
  assert.equal(fixtureTitle({ homeAway: "Home", ownLabel: "Under 12 Mixed", oppositionLabel: "Fylde" }), "Under 12 Mixed v Fylde")
})

test("an away fixture names the OPPOSITION first -- the defect this rule exists for", () => {
  assert.equal(fixtureTitle({ homeAway: "Away", ownLabel: "Under 12 Mixed", oppositionLabel: "Fylde" }), "Fylde v Under 12 Mixed")
})

test("an undecided side keeps our own team leading rather than guessing away", () => {
  for (const value of ["TBD", "Not Applicable", null, undefined, ""]) {
    assert.equal(
      fixtureTitle({ homeAway: value, ownLabel: "Under 12 Mixed", oppositionLabel: "Fylde" }),
      "Under 12 Mixed v Fylde",
      `home_away=${JSON.stringify(value)} should not reverse the sides`,
    )
  }
})

test("the reversal is reported, so a surface can reorder crests without recomputing the rule", () => {
  assert.equal(fixtureSides({ homeAway: "Away", ownLabel: "A", oppositionLabel: "B" }).ownTeamIsAway, true)
  assert.equal(fixtureSides({ homeAway: "Home", ownLabel: "A", oppositionLabel: "B" }).ownTeamIsAway, false)
})

test("a missing opposition is named as unconfirmed, never as an empty gap", () => {
  const sides = fixtureSides({ homeAway: "Home", ownLabel: "Under 12 Mixed", oppositionLabel: null })
  assert.equal(sides.awayLabel, "Opposition to be confirmed")
  assert.ok(!sides.title.includes("v  "))
})

test("whitespace-only labels are treated as missing rather than printed", () => {
  const sides = fixtureSides({ homeAway: "Away", ownLabel: "   ", oppositionLabel: "  Fylde " })
  assert.equal(sides.title, "Fylde v Our team")
})

test("the separator is one constant, and it is a lower-case spaced v", () => {
  assert.equal(FIXTURE_SIDE_SEPARATOR, " v ")
  assert.ok(!fixtureTitle({ homeAway: "Home", ownLabel: "A", oppositionLabel: "B" }).includes("vs"))
})

test("absolute sides need no owning team to orient around", () => {
  assert.equal(fixtureTitleFromSides("Fylde", "Preston"), "Fylde v Preston")
  assert.equal(fixtureTitleFromSides(null, "Preston"), "Home side to be confirmed v Preston")
})

// ---------------------------------------------------------------------------
// Match type is presentation only. A fixture without one is not a Friendly.
// ---------------------------------------------------------------------------

test("a missing match type is null, never a default", () => {
  assert.equal(matchTypeLabel(null), null)
  assert.equal(matchTypeLabel(""), null)
  assert.equal(matchTypeLabel("   "), null)
  assert.equal(matchTypeLabel("League Fixture"), "League Fixture")
})

// ---------------------------------------------------------------------------
// The date window. A view window, never a season.
// ---------------------------------------------------------------------------

test("a week runs Monday to Sunday, so a rugby weekend stays in one window", () => {
  // 2026-09-20 is a Sunday.
  const w = windowFor("week", "2026-09-20")
  assert.equal(w.from, "2026-09-14")
  assert.equal(w.to, "2026-09-20")
  // The Saturday before it is in the SAME window as that Sunday.
  assert.equal(windowFor("week", "2026-09-19").from, "2026-09-14")
})

test("a Monday anchors its own week rather than the previous one", () => {
  const w = windowFor("week", "2026-09-14")
  assert.equal(w.from, "2026-09-14")
  assert.equal(w.to, "2026-09-20")
})

test("a month window is the calendar month, including its last day", () => {
  assert.deepEqual(windowFor("month", "2026-02-17"), { kind: "month", from: "2026-02-01", to: "2026-02-28" })
  // A leap year is the month's business, not a hard-coded 28.
  assert.equal(windowFor("month", "2028-02-17").to, "2028-02-29")
})

test("stepping moves one whole period and keeps its shape", () => {
  const week = windowFor("week", "2026-09-20")
  assert.deepEqual(stepWindow(week, 1), { kind: "week", from: "2026-09-21", to: "2026-09-27" })
  assert.deepEqual(stepWindow(week, -1), { kind: "week", from: "2026-09-07", to: "2026-09-13" })

  const month = windowFor("month", "2026-12-10")
  assert.deepEqual(stepWindow(month, 1), { kind: "month", from: "2027-01-01", to: "2027-01-31" })
  assert.deepEqual(stepWindow(month, -1), { kind: "month", from: "2026-11-01", to: "2026-11-30" })
})

test("a window is only in force when both ends are real dates the right way round", () => {
  assert.equal(parseFixtureWindow(null, null), null)
  assert.equal(parseFixtureWindow("2026-09-14", null), null)
  assert.equal(parseFixtureWindow("2026-09-14", "banana"), null)
  assert.equal(parseFixtureWindow("2026-02-30", "2026-03-05"), null)
  assert.equal(parseFixtureWindow("2026-09-20", "2026-09-14"), null)
  assert.ok(parseFixtureWindow("2026-09-14", "2026-09-20"))
})

test("the period KIND is derived from the dates, so a hand-edited URL cannot lie about it", () => {
  assert.equal(parseFixtureWindow("2026-02-01", "2026-02-28")!.kind, "month")
  // Not a whole month: it reads as a range rather than a month, and stepping
  // it RECOVERS a proper Monday-start week rather than perpetuating whatever
  // shape somebody pasted in. 2026-02-01 is a Sunday, so a week on lands in
  // the week beginning Monday 2 February.
  const odd = parseFixtureWindow("2026-02-01", "2026-02-20")!
  assert.equal(odd.kind, "week")
  assert.deepEqual(stepWindow(odd, 1), { kind: "week", from: "2026-02-02", to: "2026-02-08" })
})

test("a window states itself without repeating what both ends share", () => {
  assert.equal(describeFixtureWindow({ kind: "week", from: "2026-09-14", to: "2026-09-20" }), "14 – 20 Sep 2026")
  assert.equal(describeFixtureWindow({ kind: "week", from: "2026-09-28", to: "2026-10-04" }), "28 Sep – 4 Oct 2026")
  assert.equal(describeFixtureWindow({ kind: "week", from: "2026-12-28", to: "2027-01-03" }), "28 Dec 2026 – 3 Jan 2027")
  assert.equal(describeFixtureWindow({ kind: "month", from: "2026-09-01", to: "2026-09-30" }), "Sep 2026")
})

test("containment is inclusive at both ends", () => {
  const w = windowFor("week", "2026-09-16")
  assert.ok(windowContains(w, "2026-09-14"))
  assert.ok(windowContains(w, "2026-09-20"))
  assert.ok(!windowContains(w, "2026-09-13"))
  assert.ok(!windowContains(w, "2026-09-21"))
})

test("a calendar date is a real day, not merely a well-shaped string", () => {
  assert.ok(isCalendarDate("2026-09-20"))
  assert.ok(!isCalendarDate("2026-02-30"))
  assert.ok(!isCalendarDate("2026-13-01"))
  assert.ok(!isCalendarDate("26-09-20"))
  assert.ok(!isCalendarDate(""))
  assert.ok(!isCalendarDate(null))
})

// ---------------------------------------------------------------------------
// Calendar's team filter: quiet lanes are FILED, never removed.
// ---------------------------------------------------------------------------

import { partitionLanesByActivity, type FilterableLane } from "@/lib/teams/filter-groups"

const lane = (id: string, hasActivity?: boolean): FilterableLane => ({
  id,
  label: id,
  fullLabel: id,
  kind: "team",
  category: "youth",
  ageGroup: "U12",
  gender: "boys",
  squadDesignation: null,
  ...(hasActivity === undefined ? {} : { hasActivity }),
})

test("a lane with nothing scheduled is filed, not dropped", () => {
  const { busy, quiet } = partitionLanesByActivity([lane("a", true), lane("b", false)], null)
  assert.deepEqual(busy.map((l) => l.id), ["a"])
  assert.deepEqual(quiet.map((l) => l.id), ["b"])
  // Nothing is lost: every lane is in exactly one of the two.
  assert.equal(busy.length + quiet.length, 2)
})

test("the lane you are currently filtered to is never filed away, however quiet", () => {
  const { busy, quiet } = partitionLanesByActivity([lane("a", true), lane("b", false)], "b")
  assert.deepEqual(busy.map((l) => l.id).sort(), ["a", "b"])
  assert.equal(quiet.length, 0)
})

test("a lane whose activity was never resolved is treated as busy -- silence is not evidence", () => {
  const { busy, quiet } = partitionLanesByActivity([lane("a"), lane("b", false)], null)
  assert.deepEqual(busy.map((l) => l.id), ["a"])
  assert.deepEqual(quiet.map((l) => l.id), ["b"])
})

test("every lane survives the partition -- this filter files, it never deletes", () => {
  const lanes = [lane("a", true), lane("b", false), lane("c", false), lane("d")]
  const { busy, quiet } = partitionLanesByActivity(lanes, null)
  assert.deepEqual([...busy, ...quiet].map((l) => l.id).sort(), ["a", "b", "c", "d"])
})
