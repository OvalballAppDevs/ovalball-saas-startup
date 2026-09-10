import assert from "node:assert/strict"
import { test } from "node:test"

import { siblingReservations, tournamentOccupiedWindow } from "@/lib/pitch-allocation/occupancy"
import { detectTournamentConflicts, occupantsFromFixtures, occupantsFromSpans } from "@/lib/pitch-allocation/tournament-conflicts"

/**
 * A FESTIVAL IS NOT CONFLICTING WITH ITSELF.
 *
 * The one exception in the whole conflict model, and the tests that keep it
 * exactly that narrow: two reservations of the SAME tournament never clash,
 * and everything else clashes exactly as it always did.
 */

const RES = (id: string, tournamentId: string, pitchId: string, startTime: string, endTime: string) => ({
  id,
  tournamentId,
  tournamentName: `Tournament ${tournamentId}`,
  pitchId,
  startTime,
  endTime,
})

test("a reservation occupies exactly its recorded period -- no warm-up or pack-up is added", () => {
  const w = tournamentOccupiedWindow(RES("r1", "t1", "p1", "09:30", "14:00"))
  assert.equal(w.start, 9 * 60 + 30)
  assert.equal(w.end, 14 * 60)
})

test("two pitches held by the SAME tournament over the same period is not a conflict", () => {
  const { tournamentConflicts } = detectTournamentConflicts(
    [RES("r1", "t1", "p1", "09:30", "14:00"), RES("r2", "t1", "p2", "09:30", "14:00")],
    []
  )
  assert.deepEqual(tournamentConflicts, [])
})

test("three pitches held by the same tournament, one of them overlapping the others, is still not a conflict", () => {
  const { tournamentConflicts } = detectTournamentConflicts(
    [
      RES("r1", "t1", "p1", "09:30", "14:00"),
      RES("r2", "t1", "p2", "09:30", "14:00"),
      RES("r3", "t1", "p3", "11:00", "13:00"),
    ],
    []
  )
  assert.deepEqual(tournamentConflicts, [])
})

test("a DIFFERENT tournament wanting the same pitch at the same time IS a conflict", () => {
  const { tournamentConflicts } = detectTournamentConflicts(
    [RES("r1", "t1", "p1", "09:30", "14:00"), RES("r2", "t2", "p1", "10:00", "11:00")],
    []
  )
  // Both sides are reported: each reservation genuinely has a problem.
  assert.equal(tournamentConflicts.length, 2)
  assert.ok(tournamentConflicts.every((c) => c.severity === "hard"))
})

test("an unrelated fixture on a reserved pitch conflicts, in both directions", () => {
  const fixtures = occupantsFromFixtures(
    [
      {
        fixtureId: "f1",
        homeTeamLabel: "Under 14 Girls",
        opponentLabel: "Somebody",
        pitchId: "p1",
        kickoffTime: "11:00",
        durationMinutes: 60,
      } as never,
    ],
    { warmUpMinutes: 15, packUpMinutes: 15 }
  )
  const { tournamentConflicts, fixtureConflicts } = detectTournamentConflicts([RES("r1", "t1", "p1", "09:30", "14:00")], fixtures)
  assert.equal(tournamentConflicts.length, 1)
  assert.equal(fixtureConflicts.length, 1)
  assert.equal(fixtureConflicts[0].fixtureId, "f1")
})

test("a training session on a reserved pitch conflicts", () => {
  const training = occupantsFromSpans("training", [
    { id: "s1", label: "Under 9 — Planned Training", pitchId: "p1", startTime: "10:00", durationMinutes: 60 },
  ])
  const { tournamentConflicts } = detectTournamentConflicts([RES("r1", "t1", "p1", "09:30", "14:00")], training)
  assert.equal(tournamentConflicts.length, 1)
})

test("a club event on a reserved pitch conflicts", () => {
  const events = occupantsFromSpans("event", [{ id: "e1", label: "Open Day", pitchId: "p1", startTime: "13:00", endTime: "17:00" }])
  const { tournamentConflicts } = detectTournamentConflicts([RES("r1", "t1", "p1", "09:30", "14:00")], events)
  assert.equal(tournamentConflicts.length, 1)
})

test("a fixture on a DIFFERENT pitch is untouched by the reservation", () => {
  const fixtures = occupantsFromFixtures(
    [
      {
        fixtureId: "f1",
        homeTeamLabel: "Under 14 Girls",
        opponentLabel: "Somebody",
        pitchId: "p9",
        kickoffTime: "11:00",
        durationMinutes: 60,
      } as never,
    ],
    { warmUpMinutes: 15, packUpMinutes: 15 }
  )
  const { tournamentConflicts, fixtureConflicts } = detectTournamentConflicts([RES("r1", "t1", "p1", "09:30", "14:00")], fixtures)
  assert.deepEqual(tournamentConflicts, [])
  assert.deepEqual(fixtureConflicts, [])
})

test("a clean handover on the boundary is not a conflict", () => {
  const events = occupantsFromSpans("event", [{ id: "e1", label: "Open Day", pitchId: "p1", startTime: "14:00", endTime: "17:00" }])
  const { tournamentConflicts } = detectTournamentConflicts([RES("r1", "t1", "p1", "09:30", "14:00")], events)
  assert.deepEqual(tournamentConflicts, [])
})

test("the sibling exception is decided by parent identity, never by being a tournament", () => {
  assert.equal(siblingReservations({ tournamentId: "t1" }, { tournamentId: "t1" }), true)
  assert.equal(siblingReservations({ tournamentId: "t1" }, { tournamentId: "t2" }), false)
  // A non-tournament occupant is never anybody's sibling, so it can never be
  // waved through by this rule.
  assert.equal(siblingReservations({ tournamentId: "t1" }, { tournamentId: null }), false)
  assert.equal(siblingReservations({ tournamentId: null }, { tournamentId: null }), false)
})
