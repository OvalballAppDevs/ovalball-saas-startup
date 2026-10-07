import { test } from "node:test"
import assert from "node:assert/strict"

import { addMinutesToTime, canContinueTimesStep, deriveEndTime, minutesBetween, validateTimeRange } from "./times-and-details-logic.ts"

/**
 * PINS Times & Details' pure time arithmetic (Page 5): the canonical (start_time, duration_minutes)
 * pair the schema actually stores, end_time always derived exactly the way the database itself
 * derives it, and same-day-only validation (no overnight sessions, matching the schema's own
 * unmodelled midnight crossing).
 */

test("18:00 + 60 minutes = 19:00", () => {
  assert.equal(addMinutesToTime("18:00", 60), "19:00")
})

test("18:30 + 60 minutes = 19:30", () => {
  assert.equal(addMinutesToTime("18:30", 60), "19:30")
})

test("18:30 + 90 minutes = 20:00", () => {
  assert.equal(addMinutesToTime("18:30", 90), "20:00")
})

test("18:00 -> 19:30 is 90 minutes", () => {
  assert.equal(minutesBetween("18:00", "19:30"), 90)
})

test("deriveEndTime matches addMinutesToTime for the same inputs", () => {
  assert.equal(deriveEndTime("18:00", 60), "19:00")
})

test("validateTimeRange: end at or before start is rejected -- no overnight sessions", () => {
  assert.equal(validateTimeRange("18:00", "18:00"), "End Time must be after Start Time.")
  assert.equal(validateTimeRange("19:00", "18:00"), "End Time must be after Start Time.")
})

test("validateTimeRange: shorter than 15 minutes is rejected", () => {
  assert.equal(validateTimeRange("18:00", "18:10"), "A training session must be at least 15 minutes long.")
})

test("validateTimeRange: longer than 4 hours is rejected", () => {
  assert.equal(validateTimeRange("08:00", "13:00"), "A training session cannot be longer than 4 hours.")
})

test("validateTimeRange: an ordinary same-day range is fine", () => {
  assert.equal(validateTimeRange("18:00", "19:00"), null)
})

test("canContinueTimesStep: requires a start time and a duration", () => {
  assert.equal(canContinueTimesStep({ startTime: null, durationMinutes: 60 }), false)
  assert.equal(canContinueTimesStep({ startTime: "18:00", durationMinutes: null }), false)
  assert.equal(canContinueTimesStep({ startTime: "18:00", durationMinutes: 60 }), true)
})

test("changing duration updates the derived end time", () => {
  const start = "18:00"
  assert.equal(deriveEndTime(start, 60), "19:00")
  assert.equal(deriveEndTime(start, 90), "19:30")
})

test("changing end time (via minutesBetween) updates the derived duration", () => {
  assert.equal(minutesBetween("18:00", "19:00"), 60)
  assert.equal(minutesBetween("18:00", "19:15"), 75)
})
