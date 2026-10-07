import { test } from "node:test"
import assert from "node:assert/strict"

import { canContinueDatesStep, deriveDefaultDates, validateDateOrder } from "./dates-and-frequency-logic.ts"
import type { CanonicalSeason } from "../data.ts"

/**
 * PINS Dates & Frequency's pure decisions (Page 3 correction pass): Season Long/Pre Season default
 * dates derive from the canonical season selected on Page 2 and never touch the season row itself,
 * end-before-start is rejected, and Next requires a start, an end (or an explicit "no end date"), and
 * at least one repeat day.
 */
function season(overrides: Partial<CanonicalSeason> = {}): CanonicalSeason {
  return { id: "s1", name: "Rugby Union 26/27", startsOn: "2026-09-01", endsOn: "2027-05-31", preSeasonStartsOn: "2026-06-01", ...overrides }
}

test("deriveDefaultDates: Season Long uses the canonical season's own start/end, unmodified", () => {
  const s = season()
  const result = deriveDefaultDates("SEASON", s)
  assert.deepEqual(result, { startDate: "2026-09-01", endDate: "2027-05-31" })
  // Proves nothing about the season row was mutated by deriving from it.
  assert.equal(s.startsOn, "2026-09-01")
  assert.equal(s.endsOn, "2027-05-31")
})

test("deriveDefaultDates: Pre Season uses pre_season_starts_on through the season's own ends_on", () => {
  const result = deriveDefaultDates("SEASON_PRE_SEASON", season())
  assert.deepEqual(result, { startDate: "2026-06-01", endDate: "2027-05-31" })
})

test("deriveDefaultDates: Pre Season with no canonical pre-season boundary returns null, never a guessed date", () => {
  const result = deriveDefaultDates("SEASON_PRE_SEASON", season({ preSeasonStartsOn: null }))
  assert.equal(result, null)
})

test("deriveDefaultDates: no season selected yet returns null", () => {
  assert.equal(deriveDefaultDates("SEASON", null), null)
})

test("validateDateOrder: end before start is rejected", () => {
  assert.equal(validateDateOrder("2026-09-10", "2026-09-01"), "Start Date cannot be after End Date.")
})

test("validateDateOrder: end on or after start is fine", () => {
  assert.equal(validateDateOrder("2026-09-01", "2026-09-01"), null)
  assert.equal(validateDateOrder("2026-09-01", "2026-09-02"), null)
})

test("validateDateOrder: either date missing is not an error (nothing to compare yet)", () => {
  assert.equal(validateDateOrder(null, "2026-09-02"), null)
  assert.equal(validateDateOrder("2026-09-01", null), null)
})

test("canContinueDatesStep: requires a start date, an end date, and at least one repeat day", () => {
  assert.equal(canContinueDatesStep({ startDate: null, endDate: null, repeatWeekdays: [] }), false)
  assert.equal(canContinueDatesStep({ startDate: "2026-09-01", endDate: null, repeatWeekdays: [1] }), false, "no end date")
  assert.equal(canContinueDatesStep({ startDate: "2026-09-01", endDate: "2027-05-31", repeatWeekdays: [] }), false, "no repeat day selected")
  assert.equal(canContinueDatesStep({ startDate: "2026-09-01", endDate: "2027-05-31", repeatWeekdays: [1, 3] }), true)
})

test("canContinueDatesStep: an end date before the start date blocks Next even if every field is filled", () => {
  assert.equal(canContinueDatesStep({ startDate: "2026-09-10", endDate: "2026-09-01", repeatWeekdays: [1] }), false)
})
