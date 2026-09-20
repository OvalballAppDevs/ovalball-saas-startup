import { test } from "node:test"
import assert from "node:assert/strict"

import { assignBookingLanes, laneRowCount } from "@/lib/pitch-allocation/lanes"

/**
 * THE SPLIT-SQUARE REGRESSION.
 *
 * The reported defect: two teams on the same pitch at the same time appeared
 * in one square, with one card hidden under the other. It was reproduced,
 * classified as PRESENTATION -- the allocation and the canonical `pitch_id` on
 * each fixture were correct, and the conflict detector had already flagged the
 * clash -- and fixed by letting the board draw as many lanes as the bookings
 * need instead of clamping them into the pitch's configured capacity.
 *
 * The exact reproduced case is the first test here.
 */

const booking = (id: string, startTime: string, durationMinutes = 60) => ({ id, startTime, durationMinutes })

test("REPRODUCTION: two fixtures at the same time on a ONE-lane pitch get two lanes, not one square", () => {
  const lanes = assignBookingLanes([booking("a", "10:30"), booking("b", "10:30")])
  assert.equal(lanes.get("a"), 0)
  assert.equal(lanes.get("b"), 1)
  assert.notEqual(lanes.get("a"), lanes.get("b"), "both cards would render at identical coordinates")
  // And the row is sized for both of them, even though the pitch declares one.
  assert.equal(laneRowCount(1, lanes), 2)
})

test("a pitch with more concurrent games than its declared capacity shows every one of them", () => {
  // Five games at once on a pitch marked out for four. The fifth used to be
  // clamped on top of the fourth.
  const lanes = assignBookingLanes(["a", "b", "c", "d", "e"].map((id) => booking(id, "10:00", 40)))
  assert.deepEqual([...lanes.values()].sort(), [0, 1, 2, 3, 4])
  assert.equal(laneRowCount(4, lanes), 5)
})

test("the declared capacity still sets the floor, so a quiet multi-lane pitch keeps its shape", () => {
  const lanes = assignBookingLanes([booking("a", "10:00")])
  assert.equal(laneRowCount(4, lanes), 4)
})

test("an ordinary single booking on a single-lane pitch is still one row", () => {
  const lanes = assignBookingLanes([booking("a", "10:30")])
  assert.equal(laneRowCount(1, lanes), 1)
})

test("consecutive bookings reuse the same lane rather than stacking up rows", () => {
  const lanes = assignBookingLanes([booking("a", "10:00", 60), booking("b", "11:00", 60), booking("c", "12:00", 60)])
  assert.deepEqual([lanes.get("a"), lanes.get("b"), lanes.get("c")], [0, 0, 0])
  assert.equal(laneRowCount(1, lanes), 1)
})

test("a booking that starts exactly as another finishes shares its lane -- an end is not an overlap", () => {
  const lanes = assignBookingLanes([booking("a", "10:00", 60), booking("b", "11:00", 60)])
  assert.equal(lanes.get("a"), lanes.get("b"))
})

test("a booking that starts one minute before another finishes does NOT share its lane", () => {
  const lanes = assignBookingLanes([booking("a", "10:00", 60), booking("b", "10:59", 60)])
  assert.notEqual(lanes.get("a"), lanes.get("b"))
})

test("lanes are freed and reused, so a long game does not push every later one down", () => {
  const lanes = assignBookingLanes([
    booking("long", "10:00", 180),
    booking("short1", "10:00", 60),
    booking("short2", "11:00", 60),
  ])
  assert.equal(lanes.get("long"), 0)
  assert.equal(lanes.get("short1"), 1)
  // short2 starts as short1 ends, so it goes back into lane 1 rather than
  // opening a third.
  assert.equal(lanes.get("short2"), 1)
  assert.equal(laneRowCount(1, lanes), 2)
})

test("a missing duration is treated as an hour rather than as zero", () => {
  // Zero would make every booking instantaneous and collapse real clashes into
  // one lane, which is the defect wearing a different hat.
  const lanes = assignBookingLanes([
    { id: "a", startTime: "10:00", durationMinutes: null },
    { id: "b", startTime: "10:30", durationMinutes: null },
  ])
  assert.notEqual(lanes.get("a"), lanes.get("b"))
})

test("the order bookings arrive in does not change the answer", () => {
  const forwards = assignBookingLanes([booking("a", "10:00"), booking("b", "10:30"), booking("c", "11:30")])
  const backwards = assignBookingLanes([booking("c", "11:30"), booking("b", "10:30"), booking("a", "10:00")])
  assert.deepEqual([...forwards.entries()].sort(), [...backwards.entries()].sort())
})

test("no bookings is one row, not zero", () => {
  assert.equal(laneRowCount(1, assignBookingLanes([])), 1)
  assert.equal(laneRowCount(4, assignBookingLanes([])), 4)
})
