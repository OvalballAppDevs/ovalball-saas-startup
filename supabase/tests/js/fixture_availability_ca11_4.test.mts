import { test } from "node:test"
import assert from "node:assert/strict"

import { availabilityDetailLabel, availabilityLabel, compareAvailability, findGoodDates, type DayAvailability, type TeamAvailabilityDay } from "../../../packages/contracts/src/fixtures/availability"

/**
 * SHARED SCHEDULING CALENDAR (CA-M11.4) -- pure comparison/labelling logic. The server-side privacy
 * and authority model is pinned separately (supabase/tests/team_scheduling_availability.sql); these
 * pins cover the CLIENT-side arithmetic both apps share: combining two already-read availability lists
 * into a compare view, finding good dates, and the wording rules (Section 15: the partner's side is
 * never described more specifically than "Busy").
 */

const day = (date: string, status: DayAvailability): TeamAvailabilityDay => ({ date, status })

test("availabilityLabel never says more than 'Busy' for a non-available day -- Section 15's own privacy rule, enforced in wording", () => {
  assert.equal(availabilityLabel("available"), "Available")
  assert.equal(availabilityLabel("fixture"), "Busy")
  assert.equal(availabilityLabel("training"), "Busy")
  assert.equal(availabilityLabel("club_event"), "Busy")
  assert.equal(availabilityLabel("request_pending"), "Request pending")
})

test("availabilityDetailLabel is specific -- legitimate for OUR OWN side only, never applied to a partner's day by this pass's UI", () => {
  assert.equal(availabilityDetailLabel("fixture"), "Fixture")
  assert.equal(availabilityDetailLabel("training"), "Training")
  assert.equal(availabilityDetailLabel("club_event"), "Club event")
  assert.equal(availabilityDetailLabel("available"), "Available")
  assert.equal(availabilityDetailLabel("request_pending"), "Request pending")
})

test("compareAvailability: a good option is exactly 'both sides available', nothing else", () => {
  const own = [day("2026-10-10", "available")]
  const partner = [day("2026-10-10", "available")]
  const [result] = compareAvailability(own, partner)
  assert.equal(result.isGoodOption, true)
  assert.equal(result.ours, "available")
  assert.equal(result.partner, "available")
})

test("compareAvailability: our own commitment is never a good option, whatever the partner reads", () => {
  const own = [day("2026-10-10", "fixture")]
  const partner = [day("2026-10-10", "available")]
  const [result] = compareAvailability(own, partner)
  assert.equal(result.isGoodOption, false)
})

test("compareAvailability: partner busy is never a good option, whatever our own side reads", () => {
  const own = [day("2026-10-10", "available")]
  const partner = [day("2026-10-10", "training")]
  const [result] = compareAvailability(own, partner)
  assert.equal(result.isGoodOption, false)
})

test("compareAvailability: partner not yet read (null list, e.g. no compatible opponent team chosen yet) gives partner=null, never a false 'available' claim -- Section 20's own instruction", () => {
  const own = [day("2026-10-10", "available")]
  const [result] = compareAvailability(own, null)
  assert.equal(result.partner, null)
  assert.equal(result.isGoodOption, false, "never claimed a good option when the partner side is genuinely unknown")
})

test("compareAvailability: a date present for OUR side but missing from the partner's read (e.g. outside their returned range) also reads partner=null, never guessed as available", () => {
  const own = [day("2026-10-10", "available"), day("2026-10-11", "available")]
  const partner = [day("2026-10-10", "available")] // 2026-10-11 genuinely absent
  const results = compareAvailability(own, partner)
  assert.equal(results[1].partner, null)
  assert.equal(results[1].isGoodOption, false)
})

test("findGoodDates: chronological order, no scoring, only genuinely-both-available dates", () => {
  const own = [day("2026-10-17", "available"), day("2026-10-03", "fixture"), day("2026-10-10", "available"), day("2026-10-24", "available")]
  const partner = [day("2026-10-17", "training"), day("2026-10-03", "available"), day("2026-10-10", "available"), day("2026-10-24", "available")]
  const compared = compareAvailability(own, partner)
  const good = findGoodDates(compared)
  // Matches the owner's own worked example (Section 19): Sat 10 and Sat 24 are the good options,
  // Sat 3 fails (we're busy) and Sat 17 fails (they're busy) -- in chronological order, not sorted by
  // "quality".
  assert.deepEqual(good, ["2026-10-10", "2026-10-24"])
})

test("findGoodDates: an empty result is a genuine, honest empty list, never a fabricated fallback date", () => {
  const own = [day("2026-10-10", "fixture")]
  const partner = [day("2026-10-10", "available")]
  assert.deepEqual(findGoodDates(compareAvailability(own, partner)), [])
})
