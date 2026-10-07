import { test } from "node:test"
import assert from "node:assert/strict"

import { isSessionPast, rulesShareOneTime, sessionDisplayStatus, sessionRowLabel, sortSessionsByDate, upcomingCountLabel } from "./plan-detail-logic.ts"

test("isSessionPast: strictly before today is past, today and after are not", () => {
  assert.equal(isSessionPast("2026-09-28", "2026-09-29"), true)
  assert.equal(isSessionPast("2026-09-29", "2026-09-29"), false)
  assert.equal(isSessionPast("2026-09-30", "2026-09-29"), false)
})

test("sortSessionsByDate: chronological, earliest first, regardless of input order", () => {
  const sorted = sortSessionsByDate([{ occurrenceDate: "2026-10-05" }, { occurrenceDate: "2026-09-30" }, { occurrenceDate: "2026-10-12" }])
  assert.deepEqual(
    sorted.map((s) => s.occurrenceDate),
    ["2026-09-30", "2026-10-05", "2026-10-12"]
  )
})

test("sessionRowLabel: weekday and date derived correctly, matching Postgres's own weekday numbering", () => {
  assert.equal(sessionRowLabel("2026-10-05"), "Mon 5 Oct")
  assert.equal(sessionRowLabel("2026-09-30"), "Wed 30 Sep")
})

test("rulesShareOneTime: one rule always agrees with itself", () => {
  assert.equal(rulesShareOneTime([{ weekday: 1, startTime: "18:00", durationMinutes: 60 }]), true)
})

test("rulesShareOneTime: two rules at the same time agree", () => {
  assert.equal(
    rulesShareOneTime([
      { weekday: 1, startTime: "18:00", durationMinutes: 60 },
      { weekday: 3, startTime: "18:00", durationMinutes: 60 },
    ]),
    true
  )
})

test("rulesShareOneTime: two rules at different times do not agree", () => {
  assert.equal(
    rulesShareOneTime([
      { weekday: 1, startTime: "18:00", durationMinutes: 60 },
      { weekday: 4, startTime: "19:00", durationMinutes: 90 },
    ]),
    false
  )
})

test("upcomingCountLabel: singular vs plural", () => {
  assert.equal(upcomingCountLabel([]), "0 sessions")
  assert.equal(upcomingCountLabel([{ id: "1", occurrenceDate: "2026-10-05", startTime: "18:00", pitchName: null, status: "PLANNED", isOverridden: false }]), "1 session")
  assert.equal(
    upcomingCountLabel([
      { id: "1", occurrenceDate: "2026-10-05", startTime: "18:00", pitchName: null, status: "PLANNED", isOverridden: false },
      { id: "2", occurrenceDate: "2026-10-07", startTime: "18:00", pitchName: null, status: "PLANNED", isOverridden: false },
    ]),
    "2 sessions"
  )
})

test("sessionDisplayStatus: a cancelled row reads cancelled regardless of date", () => {
  assert.equal(sessionDisplayStatus("2026-09-28", "CANCELLED", "2026-09-30"), "cancelled")
  assert.equal(sessionDisplayStatus("2026-10-05", "CANCELLED", "2026-09-30"), "cancelled")
})

test("sessionDisplayStatus: a planned row before today reads completed", () => {
  assert.equal(sessionDisplayStatus("2026-09-28", "PLANNED", "2026-09-30"), "completed")
})

test("sessionDisplayStatus: a planned row today or later reads upcoming", () => {
  assert.equal(sessionDisplayStatus("2026-09-30", "PLANNED", "2026-09-30"), "upcoming")
  assert.equal(sessionDisplayStatus("2026-10-05", "PLANNED", "2026-09-30"), "upcoming")
})
