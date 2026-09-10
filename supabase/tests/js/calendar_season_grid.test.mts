import { test } from "node:test"
import assert from "node:assert/strict"

import { buildSeasonGrid, describeWeek, mondayOf, weekContaining, type SeasonGridEvent } from "@/lib/calendar/season-grid"

/**
 * THE SEASON GRID IS AN ARRANGEMENT, NEVER A SOURCE.
 *
 * These assert the properties the view's usefulness rests on: that a rest week
 * survives as a rest week, that home and away are counted separately because
 * that is what decides whether a family travels, that a match with no settled
 * side is counted honestly rather than guessed into one column, and that
 * nothing is invented or dropped.
 */

const ev = (over: Partial<SeasonGridEvent> & { id: string; date: string }): SeasonGridEvent => ({
  kind: "fixture",
  time: "10:30",
  homeAway: "Home",
  teamDisplayName: "Under 12 Boys",
  opposition: "Rossendale RUFC",
  laneId: "team-a",
  status: "Booked",
  venue: null,
  canEdit: false,
  ...over,
})

test("weeks start on Monday, so a Saturday match and its Tuesday session share a week", () => {
  assert.equal(mondayOf("2026-09-12"), "2026-09-07", "Saturday belongs to the Monday before it")
  assert.equal(mondayOf("2026-09-08"), "2026-09-07", "so does the Tuesday")
  assert.equal(mondayOf("2026-09-07"), "2026-09-07", "a Monday is its own week start")
  assert.equal(mondayOf("2026-09-13"), "2026-09-07", "and Sunday closes it, rather than opening a new one")
})

test("every week in the range appears, including the empty ones", () => {
  // The gaps ARE the rhythm. Dropping empty weeks would compress the season
  // and destroy the thing the view exists to show.
  const months = buildSeasonGrid("2026-09-01", "2026-09-30", [ev({ id: "f1", date: "2026-09-12" })])
  const weeks = months.flatMap((m) => m.weeks)
  assert.equal(weeks.length >= 4, true, `expected at least four weeks in September, got ${weeks.length}`)
  assert.equal(weeks.filter((w) => w.isRest).length >= 3, true, "the weeks with nothing on are still present")
  assert.equal(weeks.filter((w) => !w.isRest).length, 1)
})

test("home and away are counted separately, and an unsettled match is neither", () => {
  const months = buildSeasonGrid("2026-09-07", "2026-09-13", [
    ev({ id: "h", date: "2026-09-12", homeAway: "Home" }),
    ev({ id: "a", date: "2026-09-12", homeAway: "Away" }),
    ev({ id: "tbd", date: "2026-09-13", homeAway: "" }),
    ev({ id: "t", date: "2026-09-08", kind: "training", homeAway: "" }),
  ])
  const w = months[0].weeks[0]
  assert.equal(w.homeMatches, 1)
  assert.equal(w.awayMatches, 1)
  assert.equal(w.undecidedMatches, 1, "a fixture with no settled side is counted honestly, never guessed into home")
  assert.equal(w.trainingSessions, 1)
  assert.equal(w.isRest, false)
})

test("training is never classified as home or away", () => {
  const months = buildSeasonGrid("2026-09-07", "2026-09-13", [ev({ id: "t", date: "2026-09-08", kind: "training", homeAway: "" })])
  const w = months[0].weeks[0]
  assert.equal(w.homeMatches, 0)
  assert.equal(w.awayMatches, 0)
  assert.equal(w.undecidedMatches, 0, "training must not leak into the match counts at all")
  assert.equal(w.trainingSessions, 1)
})

test("a week straddling a month boundary appears exactly once", () => {
  // Filed under the month its MONDAY falls in.
  const months = buildSeasonGrid("2026-09-28", "2026-10-11", [ev({ id: "f", date: "2026-10-01" })])
  const all = months.flatMap((m) => m.weeks.map((w) => w.startIso))
  assert.equal(new Set(all).size, all.length, "no week is listed twice")
  const sept = months.find((m) => m.key === "2026-09")
  assert.equal(sept?.weeks.some((w) => w.startIso === "2026-09-28"), true, "the week beginning 28 September is a September week")
})

test("a season starting mid-week does not invent the month before it", () => {
  // A Union season starts 1 September, a Tuesday in 2026. That week opened on
  // Monday 31 August, and filing it by its Monday produced an "August 2026"
  // month header above the season -- a month the season does not contain,
  // holding one stub square that could never hold anything.
  const months = buildSeasonGrid("2026-09-01", "2027-06-30", [ev({ id: "f", date: "2026-09-12" })])
  assert.equal(months[0].key, "2026-09", `the first month must be the month the season starts in, got ${months[0].key}`)
  assert.equal(months.some((m) => m.key === "2026-08"), false, "no phantom month before the season")

  // The leading week itself is not dropped -- it is filed into September.
  assert.equal(months[0].weeks[0].startIso, "2026-08-31", "the week containing 1 September is still present")

  // And a week straddling a boundary INSIDE the range still files by its Monday.
  const sept = months.find((m) => m.key === "2026-09")
  assert.equal(sept?.weeks.some((w) => w.startIso === "2026-09-28"), true, "28 September is still a September week")
})

test("the grid arranges, it never invents or drops", () => {
  const events = [ev({ id: "a", date: "2026-09-12" }), ev({ id: "b", date: "2026-09-19" }), ev({ id: "c", date: "2026-10-03" })]
  const months = buildSeasonGrid("2026-09-01", "2026-10-31", events)
  const seen = months.flatMap((m) => m.weeks.flatMap((w) => w.events.map((e) => e.id)))
  assert.deepEqual(seen.sort(), ["a", "b", "c"], "every event appears exactly once, and nothing else appears")
})

test("events inside a week are ordered by date then time", () => {
  const months = buildSeasonGrid("2026-09-07", "2026-09-13", [
    ev({ id: "late", date: "2026-09-12", time: "14:00" }),
    ev({ id: "early", date: "2026-09-12", time: "10:30" }),
    ev({ id: "tue", date: "2026-09-08", time: "18:00" }),
  ])
  assert.deepEqual(months[0].weeks[0].events.map((e) => e.id), ["tue", "early", "late"])
})

test("teamCount reflects distinct teams, which is what club density is made of", () => {
  const months = buildSeasonGrid("2026-09-07", "2026-09-13", [
    ev({ id: "1", date: "2026-09-12", laneId: "u12" }),
    ev({ id: "2", date: "2026-09-12", laneId: "u14" }),
    ev({ id: "3", date: "2026-09-12", laneId: "u12" }),
  ])
  assert.equal(months[0].weeks[0].teamCount, 2)
  assert.equal(months[0].weeks[0].events.length, 3)
})

test("a week describes itself in words, home and away spelled out", () => {
  const months = buildSeasonGrid("2026-09-07", "2026-09-13", [
    ev({ id: "h", date: "2026-09-12", homeAway: "Home" }),
    ev({ id: "t", date: "2026-09-08", kind: "training", homeAway: "" }),
  ])
  const text = describeWeek(months[0].weeks[0])
  assert.match(text, /Week beginning 7 September/)
  assert.match(text, /1 home match/)
  assert.match(text, /1 training session/)

  const rest = buildSeasonGrid("2026-09-07", "2026-09-13", [])
  assert.match(describeWeek(rest[0].weeks[0]), /nothing scheduled/)
})

test("a malformed range yields nothing rather than looping", () => {
  assert.deepEqual(buildSeasonGrid("2026-09-30", "2026-09-01", []), [])
  assert.deepEqual(buildSeasonGrid("", "", []), [])
})

test("weekContaining finds today's week, and nothing outside the grid", () => {
  const months = buildSeasonGrid("2026-09-01", "2026-09-30", [])
  assert.equal(weekContaining(months, "2026-09-12")?.startIso, "2026-09-07")
  assert.equal(weekContaining(months, "2027-03-01"), null)
})
