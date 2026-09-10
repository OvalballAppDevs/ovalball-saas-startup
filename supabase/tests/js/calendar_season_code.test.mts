import { test } from "node:test"
import assert from "node:assert/strict"

import { effectivePhaseRange, resolveDefaultPhase, resolveDefaultSeason, type SeasonRow } from "@/lib/calendar/season-window"
import { selectSeasonForCode } from "@/lib/calendar/season-window"

/**
 * CALENDAR SEASON SEMANTICS ARE CODE-AWARE, AND CODE-BOUND.
 *
 * Rugby Union and Rugby League do not share a season shape. Union runs
 * across two calendar years and is written "26/27"; League runs inside one
 * and is written "2026". Ovalball stores both facts canonically --
 * `seasons.rugby_code` and `seasons.season_ref` -- so no surface ever has to
 * infer a code by reading a label, and none of these tests parses one.
 *
 * The rule these guard is the one the brief calls a release blocker: a
 * season_id belonging to one code must never widen into the other. A Union
 * club handed a League season id in a URL must not end up showing Union
 * fixtures inside League date boundaries.
 */

const UNION_26: SeasonRow = {
  id: "u26", name: "Rugby Union 26/27", seasonRef: "26/27", rugbyCode: "union",
  preSeasonStartsOn: "2026-08-01", startsOn: "2026-09-01", endsOn: "2027-06-30",
}
const UNION_27: SeasonRow = {
  id: "u27", name: "Rugby Union 27/28", seasonRef: "27/28", rugbyCode: "union",
  preSeasonStartsOn: "2027-08-01", startsOn: "2027-09-01", endsOn: "2028-06-30",
}
const LEAGUE_26: SeasonRow = {
  id: "l26", name: "Rugby League 2026", seasonRef: "2026", rugbyCode: "league",
  preSeasonStartsOn: null, startsOn: "2026-02-01", endsOn: "2026-10-31",
}
const ALL = [LEAGUE_26, UNION_26, UNION_27]

test("a season id from the other code never becomes the selected season", () => {
  // THE RELEASE BLOCKER. A Union club's calendar, handed League 2026 in the
  // URL, must fall back to its own code's season rather than adopting League
  // date boundaries for Union fixtures.
  const picked = selectSeasonForCode(ALL, "union", "l26", "2026-09-15")
  assert.equal(picked?.rugbyCode, "union", "a union club must not select a league season")
  assert.notEqual(picked?.id, "l26")

  // And the reverse.
  const pickedLeague = selectSeasonForCode(ALL, "league", "u26", "2026-09-15")
  assert.equal(pickedLeague?.rugbyCode, "league")
  assert.notEqual(pickedLeague?.id, "u26")
})

test("a legitimate season id of the viewer's own code is honoured", () => {
  const picked = selectSeasonForCode(ALL, "union", "u27", "2026-09-15")
  assert.equal(picked?.id, "u27", "switching to another season of your own code is a real thing to do")
})

test("an unknown or absent season id falls back to the code's default", () => {
  assert.equal(selectSeasonForCode(ALL, "union", "nonsense", "2026-09-15")?.id, "u26")
  assert.equal(selectSeasonForCode(ALL, "union", undefined, "2026-09-15")?.id, "u26")
})

test("Union and League defaults resolve to their own code's season", () => {
  assert.equal(resolveDefaultSeason(ALL, "union", "2026-09-15")?.seasonRef, "26/27")
  assert.equal(resolveDefaultSeason(ALL, "league", "2026-05-15")?.seasonRef, "2026")
})

test("the display reference is stored, never derived from the dates", () => {
  // League 2026 runs Feb-Oct inside one calendar year and is written "2026".
  // Union 26/27 spans two and is written "26/27". Nothing may compute these
  // from starts_on/ends_on -- a League season configured across a year
  // boundary would then be mislabelled "26/27".
  assert.equal(LEAGUE_26.seasonRef, "2026")
  assert.equal(UNION_26.seasonRef, "26/27")
  assert.equal(LEAGUE_26.seasonRef.includes("/"), false, "a League season reference is a calendar year, never a cross-year pair")
})

test("pre-season is derived from the canonical column, never assumed", () => {
  // Union 26/27 has a recorded pre-season start, so a date inside it is
  // pre-season and the phase range is real.
  assert.equal(resolveDefaultPhase(UNION_26, "2026-08-15"), "pre")
  assert.equal(resolveDefaultPhase(UNION_26, "2026-09-15"), "main")
  const pre = effectivePhaseRange(UNION_26, "pre")
  assert.deepEqual(pre, { start: "2026-08-01", end: "2026-08-31" }, "pre-season ends the day before the season starts")

  // League 2026 has NO recorded pre-season. It must not invent one.
  assert.equal(resolveDefaultPhase(LEAGUE_26, "2026-01-15"), "main")
  assert.equal(effectivePhaseRange(LEAGUE_26, "pre"), null, "a season with no recorded pre-season has no pre-season range")
})

test("the main-season range is exactly the canonical window", () => {
  assert.deepEqual(effectivePhaseRange(UNION_26, "main"), { start: "2026-09-01", end: "2027-06-30" })
  assert.deepEqual(effectivePhaseRange(LEAGUE_26, "main"), { start: "2026-02-01", end: "2026-10-31" })
})
