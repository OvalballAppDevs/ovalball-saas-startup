import assert from "node:assert/strict"
import { test } from "node:test"

import { formatDateLong, formatDateRange, formatDateShort, formatDayName, formatTime, formatTimeRange } from "@/lib/email/dynamic-data/format"

/**
 * ONE DATE/TIME FORMAT, PROVED HERE ONCE, USED BY EVERY RESOLVER.
 */

test("formatDateLong has no comma between weekday and day", () => {
  assert.equal(formatDateLong("2026-09-09"), "Wednesday 9 September 2026")
})

test("formatDateShort omits the weekday", () => {
  assert.equal(formatDateShort("2026-09-09"), "9 September 2026")
})

test("formatDayName gives just the weekday", () => {
  assert.equal(formatDayName("2026-09-09"), "Wednesday")
})

test("formatTime trims seconds; null in, null out", () => {
  assert.equal(formatTime("18:00:00"), "18:00")
  assert.equal(formatTime(null), null)
})

test("formatTimeRange joins start and end; a single time when there is no end; null when there is no start", () => {
  assert.equal(formatTimeRange("18:00:00", "19:30:00"), "18:00–19:30")
  assert.equal(formatTimeRange("18:00:00", null), "18:00")
  assert.equal(formatTimeRange(null, "19:30:00"), null)
  assert.equal(formatTimeRange(null, null), null)
})

test("formatDateRange collapses to a single date when start and end are the same day", () => {
  assert.equal(formatDateRange("2026-09-09", "2026-09-09"), "9 September 2026")
})

test("formatDateRange within one month shows the day once", () => {
  assert.equal(formatDateRange("2026-09-07", "2026-09-14"), "7–14 September 2026")
})

test("formatDateRange spanning two months in the same year names both months", () => {
  assert.equal(formatDateRange("2026-08-28", "2026-09-03"), "28 August – 3 September 2026")
})

test("formatDateRange spanning a year boundary spells out both years", () => {
  assert.equal(formatDateRange("2026-12-28", "2027-01-03"), "28 December 2026 – 3 January 2027")
})
