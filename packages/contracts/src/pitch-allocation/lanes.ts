/**
 * HOW MANY ROWS A PITCH NEEDS, AND WHICH ONE EACH BOOKING SITS IN.
 *
 * Extracted from the Pitch Allocation board so it can be asserted directly.
 * It was private to a client component, which is why the defect below survived:
 * there was no way to state the rule except by looking at a screenshot.
 *
 * THE SPLIT-SQUARE DEFECT.
 *
 * The board used to clamp a fixture that needed a lane beyond the pitch's
 * configured capacity into the LAST lane -- the comment said "so it still
 * renders somewhere rather than being silently dropped". What it did in
 * practice was render it in the same square as the booking already there:
 * two teams, one pitch, one time, one card's worth of space, the lower card
 * invisible underneath. And an ordinary one-lane pitch never reached the lane
 * code at all, so a genuine double-booking drew both cards at identical
 * coordinates.
 *
 * The classification matters, because the brief asks for it: this was
 * PRESENTATION. The allocation had correctly put both fixtures on the pitch,
 * the canonical `fixtures.pitch_id` on each was right, and the conflict
 * detector had already flagged the clash. The board had simply decided in
 * advance how many rows it was willing to draw.
 *
 * So lanes are counted from the bookings, and the declared capacity keeps the
 * job it is actually for -- deciding what counts as a conflict.
 *
 * There is no canonical "lane" fact anywhere. `pitch_id` names the one real
 * physical pitch; this is arithmetic over kickoff and duration, done at render
 * time, and can never drift out of sync with what is booked.
 */

export interface LaneBooking {
  id: string
  /** `HH:MM`. A booking with no start time cannot be placed on a timeline and is not passed here. */
  startTime: string
  durationMinutes?: number | null
}

const DEFAULT_DURATION_MINUTES = 60

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + m
}

/**
 * Classic greedy interval scheduling: each booking takes the first lane whose
 * previous occupant has finished, and opens a new lane when none has.
 *
 * Deliberately NOT capped. A caller that wants to know the pitch's declared
 * capacity should ask the pitch.
 */
export function assignBookingLanes(bookings: LaneBooking[]): Map<string, number> {
  const sorted = [...bookings].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
  const laneEndTimes: number[] = []
  const laneById = new Map<string, number>()
  for (const b of sorted) {
    const start = toMinutes(b.startTime)
    const end = start + (b.durationMinutes ?? DEFAULT_DURATION_MINUTES)
    let lane = laneEndTimes.findIndex((endTime) => endTime <= start)
    if (lane === -1) {
      lane = laneEndTimes.length
      laneEndTimes.push(end)
    } else {
      laneEndTimes[lane] = end
    }
    laneById.set(b.id, lane)
  }
  return laneById
}

/**
 * How many lanes the row must actually draw: never fewer than the pitch's
 * declared capacity (so a four-lane mini pitch still reads as four lanes when
 * only two games are on it), and never fewer than the bookings need (so an
 * over-booked pitch shows every card instead of hiding one).
 */
export function laneRowCount(declaredLaneCount: number, laneById: Map<string, number>): number {
  const declared = Math.max(1, declaredLaneCount)
  let needed = 1
  for (const lane of laneById.values()) needed = Math.max(needed, lane + 1)
  return Math.max(declared, needed)
}
