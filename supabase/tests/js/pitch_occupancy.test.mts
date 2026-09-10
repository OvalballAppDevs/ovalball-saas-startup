import { test } from "node:test"
import assert from "node:assert/strict"

import { fixtureOccupiedWindow, occupancyOverlaps, timeToMinutes } from "@/lib/pitch-allocation/occupancy"
import { detectConflicts } from "@/lib/pitch-allocation/auto-allocate"
import { detectResourceConflicts } from "@/lib/pitch-allocation/training-conflicts"
import type { AllocationFixture, PitchOption } from "@/lib/pitch-allocation/types"

/**
 * A PITCH IS OCCUPIED FOR LONGER THAN THE MATCH.
 *
 * The rule these hold: a fixture reserves its pitch from the start of warm-up
 * to the end of pack-up, and EVERYTHING that asks "is this pitch free" asks it
 * the same way. The board draws that window, the conflict detector tests it,
 * the auto-allocator books it and Move validates against it -- from one
 * primitive, so they cannot answer differently.
 *
 * The case that matters most is the one the brief names: a fixture whose play
 * ends at 12:00 but whose pack-up runs to 12:20 must NOT let another fixture
 * be treated as conflict-free at 12:05.
 */

const fixture = (over: Partial<AllocationFixture> & { fixtureId: string }): AllocationFixture =>
  ({
    homeTeamId: "t1",
    category: "youth",
    gender: "boys",
    status: "Confirmed",
    kickoffDate: "2026-09-12",
    venueId: null,
    homeTeamLabel: "Under 12 Boys",
    opponentLabel: "Rossendale RUFC",
    kickoffTime: "11:00",
    durationMinutes: 60,
    pitchId: "p1",
    ageGroup: "U12",
    ...over,
  }) as AllocationFixture

const pitch = (over: Partial<PitchOption> = {}): PitchOption =>
  ({ id: "p1", displayName: "Pitch 1", active: true, venueId: null, sizeCategory: "full", laneCount: 1, ...over }) as PitchOption

/**
 * Only the conflicts this file is about.
 *
 * detectConflicts also reports pitch-size and inactive-pitch problems, which
 * are real but are a different rule. Filtering to the overlap message keeps
 * these assertions about occupancy and nothing else -- otherwise an unrelated
 * change to the size rules would fail tests that never meant to test them.
 */
const overlapsOnly = (cs: { reason: string }[]) => cs.filter((c) => /clash|overlap|same time|already/i.test(c.reason))

test("the reserved window runs from warm-up start to pack-up end, not kick-off to final whistle", () => {
  const w = fixtureOccupiedWindow({ kickoffTime: "11:00", durationMinutes: 60 }, { warmUpMinutes: 30, packUpMinutes: 20 })!
  assert.equal(w.start, timeToMinutes("10:30"), "the pitch stops being free when warm-up begins")
  assert.equal(w.playStart, timeToMinutes("11:00"))
  assert.equal(w.playEnd, timeToMinutes("12:00"))
  assert.equal(w.end, timeToMinutes("12:20"), "the pitch is free again only when pack-up ends")
  // ONE reservation carrying three phases -- never three bookings.
  assert.equal(w.warmUpMinutes, 30)
  assert.equal(w.packUpMinutes, 20)
  assert.equal(w.playMinutes, 60)
})

test("with no buffers configured the window is exactly the match", () => {
  // The product default is 0/0 -- a club that has never configured buffers
  // gets no invented ones, and the window collapses to the play time.
  const w = fixtureOccupiedWindow({ kickoffTime: "11:00", durationMinutes: 70 }, { warmUpMinutes: 0, packUpMinutes: 0 })!
  assert.equal(w.start, w.playStart)
  assert.equal(w.end, w.playEnd)
  assert.equal(w.end - w.start, 70)
})

test("a fixture with no kick-off time has no window at all", () => {
  assert.equal(fixtureOccupiedWindow({ kickoffTime: null, durationMinutes: 60 }, { warmUpMinutes: 15, packUpMinutes: 15 }), null)
})

test("a negative buffer cannot invert the window", () => {
  // A misconfigured setting must never produce a reservation that reports the
  // pitch as free during its own match.
  const w = fixtureOccupiedWindow({ kickoffTime: "11:00", durationMinutes: 60 }, { warmUpMinutes: -30, packUpMinutes: -30 })!
  assert.equal(w.start, w.playStart)
  assert.equal(w.end, w.playEnd)
})

test("THE BOUNDARY CASE: 12:05 is not free just because play ended at 12:00", () => {
  // Fixture A: 11:00 kick-off, 60 minutes, 20-minute pack-up -> reserved to 12:20.
  // Fixture B at 12:05 lands inside that pack-up.
  const buffers = { warmUpMinutes: 0, packUpMinutes: 20 }
  const a = fixtureOccupiedWindow({ kickoffTime: "11:00", durationMinutes: 60 }, buffers)!
  const b = fixtureOccupiedWindow({ kickoffTime: "12:05", durationMinutes: 60 }, buffers)!
  assert.equal(occupancyOverlaps(a, b), true, "a fixture starting during another's pack-up is a conflict")

  const conflicts = overlapsOnly(
    detectConflicts([fixture({ fixtureId: "a", kickoffTime: "11:00" }), fixture({ fixtureId: "b", kickoffTime: "12:05" })], [pitch()], buffers)
  )
  assert.equal(conflicts.length > 0, true, "and the conflict detector agrees, because both read the same window")

  // Without the pack-up configured, the same two fixtures are genuinely fine.
  const noBuffer = overlapsOnly(
    detectConflicts([fixture({ fixtureId: "a", kickoffTime: "11:00" }), fixture({ fixtureId: "b", kickoffTime: "12:05" })], [pitch()], {
      warmUpMinutes: 0,
      packUpMinutes: 0,
    })
  )
  assert.equal(noBuffer.length, 0, "the conflict comes from the SETTING, not from a rule baked into the code")
})

test("warm-up counts before kick-off too", () => {
  // Fixture A plays 09:00-10:00. Fixture B kicks off at 10:15 with a
  // 30-minute warm-up, so B's warm-up starts at 09:45 -- inside A's match.
  const buffers = { warmUpMinutes: 30, packUpMinutes: 0 }
  const conflicts = overlapsOnly(
    detectConflicts([fixture({ fixtureId: "a", kickoffTime: "09:00" }), fixture({ fixtureId: "b", kickoffTime: "10:15" })], [pitch()], buffers)
  )
  assert.equal(conflicts.length > 0, true, "a warm-up that starts during the previous match is a conflict")
})

test("a clean handover on the boundary is not a conflict", () => {
  // A reserved to 12:20; B's warm-up begins exactly at 12:20. The pitch is
  // genuinely handed over -- half-open intervals, so this is allowed.
  const buffers = { warmUpMinutes: 0, packUpMinutes: 20 }
  const conflicts = overlapsOnly(
    detectConflicts([fixture({ fixtureId: "a", kickoffTime: "11:00" }), fixture({ fixtureId: "b", kickoffTime: "12:20" })], [pitch()], buffers)
  )
  assert.equal(conflicts.length, 0, "touching intervals hand the pitch over cleanly")
})

test("training occupies its own recorded time and is never padded with fixture buffers", () => {
  // A training session running 18:00-19:00 does not conflict with a fixture
  // whose pack-up ends at 18:00, and gains no warm-up of its own.
  const { trainingConflicts } = detectResourceConflicts(
    [fixture({ fixtureId: "a", kickoffTime: "16:00", durationMinutes: 60 })],
    [{ trainingSessionId: "t1", teamLabel: "Under 12 Boys", venueId: null, pitchId: "p1", sessionDate: "2026-09-12", startTime: "18:00", durationMinutes: 60, status: "PLANNED", source: "MANUAL" }],
    [pitch()],
    { warmUpMinutes: 30, packUpMinutes: 60 }
  )
  // Fixture reserved 15:30-18:00; training 18:00-19:00. Clean handover.
  assert.equal(trainingConflicts.length, 0, "training is not given a fixture's warm-up or pack-up")
})

test("the same window is what a conflict is reported against, whichever detector asks", () => {
  // detectConflicts and detectResourceConflicts must agree, because both read
  // the one primitive. This is the drift the guard exists to prevent.
  const buffers = { warmUpMinutes: 25, packUpMinutes: 25 }
  const fixtures = [fixture({ fixtureId: "a", kickoffTime: "11:00" }), fixture({ fixtureId: "b", kickoffTime: "12:10" })]
  const fromAuto = overlapsOnly(detectConflicts(fixtures, [pitch()], buffers))
  const { fixtureConflicts } = detectResourceConflicts(fixtures, [], [pitch()], buffers)
  assert.equal(fromAuto.length > 0, true)
  assert.equal(fixtureConflicts.length > 0, true)
  assert.equal(fromAuto.length > 0, fixtureConflicts.length > 0, "both detectors reach the same verdict on the same window")
})
