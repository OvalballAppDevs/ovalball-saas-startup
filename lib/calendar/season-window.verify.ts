import { clampIsoToRange, dateWithinAnySeason, effectivePhaseRange, isIsoInRange, overallSeasonRange, type SeasonRow } from "./season-window"

/**
 * Run with `npx tsx lib/calendar/season-window.verify.ts`. Permanent
 * regression coverage for the Pre-Season/Main-Season date-boundary
 * addendum's shared resolver -- the exact boundary a "still allows
 * navigation across arbitrary dates" regression would show up in first.
 */

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`)
  if (ok) pass++
  else fail++
}

const normalSeason: SeasonRow = {
  id: "s1",
  name: "Test 26/27",
  seasonRef: "26/27",
  rugbyCode: "union",
  preSeasonStartsOn: "2026-08-01",
  startsOn: "2026-09-01",
  endsOn: "2027-05-31",
}

check("Pre-Season range = configured start through the day before Main Season Start (derived, never stored)", effectivePhaseRange(normalSeason, "pre"), {
  start: "2026-08-01",
  end: "2026-08-31",
})

check("Main Season range = starts_on through ends_on, both inclusive", effectivePhaseRange(normalSeason, "main"), {
  start: "2026-09-01",
  end: "2027-05-31",
})

check("Pre-Season range derivation across a month boundary (day-before-start crossing months)", effectivePhaseRange({ ...normalSeason, startsOn: "2026-09-01" }, "pre"), {
  start: "2026-08-01",
  end: "2026-08-31",
})

const noPreSeason: SeasonRow = { ...normalSeason, preSeasonStartsOn: null }
check("No configured Pre-Season -> null (fails closed, never an unbounded range)", effectivePhaseRange(noPreSeason, "pre"), null)

const invalidPreOrder: SeasonRow = { ...normalSeason, preSeasonStartsOn: "2026-09-15" } // after starts_on
check("Pre-Season start on/after Main Season start -> null (violates canonical ordering, fails closed)", effectivePhaseRange(invalidPreOrder, "pre"), null)

const invalidMainOrder: SeasonRow = { ...normalSeason, startsOn: "2027-06-01", endsOn: "2027-05-31" } // start after end
check("Main Season start after end -> null (violates canonical ordering, fails closed)", effectivePhaseRange(invalidMainOrder, "main"), null)

check("overallSeasonRange spans Pre-Season start through Main Season end when Pre-Season exists", overallSeasonRange(normalSeason), {
  start: "2026-08-01",
  end: "2027-05-31",
})
check("overallSeasonRange falls back to Main Season start when no Pre-Season configured", overallSeasonRange(noPreSeason), {
  start: "2026-09-01",
  end: "2027-05-31",
})

const range = { start: "2026-09-01", end: "2027-05-31" }
check("isIsoInRange: inside", isIsoInRange("2026-12-25", range), true)
check("isIsoInRange: exactly on start boundary (inclusive)", isIsoInRange("2026-09-01", range), true)
check("isIsoInRange: exactly on end boundary (inclusive)", isIsoInRange("2027-05-31", range), true)
check("isIsoInRange: one day before start", isIsoInRange("2026-08-31", range), false)
check("isIsoInRange: one day after end", isIsoInRange("2027-06-01", range), false)

check("clampIsoToRange: below range clamps to start", clampIsoToRange("2020-01-01", range), "2026-09-01")
check("clampIsoToRange: above range clamps to end", clampIsoToRange("2030-01-01", range), "2027-05-31")
check("clampIsoToRange: inside range passes through unchanged", clampIsoToRange("2027-01-15", range), "2027-01-15")

const priorSeason: SeasonRow = { ...normalSeason, id: "s0", preSeasonStartsOn: "2025-08-01", startsOn: "2025-09-01", endsOn: "2026-05-31" }
check("dateWithinAnySeason: true when the date falls inside a different season in the list", dateWithinAnySeason([priorSeason, normalSeason], "2025-10-01"), true)
check("dateWithinAnySeason: false when the date falls in the gap between two seasons", dateWithinAnySeason([priorSeason, normalSeason], "2026-07-15"), false)
check("dateWithinAnySeason: false against an empty season list (nothing to violate, but also nothing satisfied)", dateWithinAnySeason([], "2026-10-01"), false)

console.log(`\n${pass} PASS, ${fail} FAIL`)
if (fail > 0) process.exit(1)
