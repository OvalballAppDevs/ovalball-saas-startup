import { fixtureOccupiedWindow, occupancyOverlaps, timeToMinutes, type OccupancyBuffers } from "./occupancy"
import type { AllocationConflict, AllocationFixture, PitchOption } from "./types"
import type { EventOccupancy } from "./board"

/**
 * AN EVENT'S EXPLICIT PITCH HOLDS AGAINST A FIXTURE -- the board's mirror of the server engine's
 * PITCH_EVENT rule (internal.arena_conflicts, 20270737000000), so a drag shows before the drop what Save
 * would be refused for. Only an event's own reservation of a pitch counts (club_event_pitches): an
 * event at the clubhouse holds no pitch. An event with no start time holds the pitch from the start of
 * the day; one with no end time until the end of it. The server stays the authority: a placement this
 * misses is still refused there, in the same words.
 */
export function detectEventConflicts(
  fixtures: AllocationFixture[],
  clubEvents: EventOccupancy[],
  pitches: PitchOption[],
  buffers: OccupancyBuffers,
  dateIso?: string
): AllocationConflict[] {
  const conflicts: AllocationConflict[] = []
  for (const f of fixtures) {
    if (!f.pitchId || !f.kickoffTime) continue
    const window = fixtureOccupiedWindow(f, buffers)
    if (!window) continue
    for (const e of clubEvents) {
      if (e.pitchId !== f.pitchId) continue
      const day = dateIso ?? f.kickoffDate
      const start = e.startTime && e.startsOn === day ? timeToMinutes(e.startTime) : 0
      const end = e.endTime && e.endsOn === day ? timeToMinutes(e.endTime) : 24 * 60
      if (!occupancyOverlaps(window, { start, end })) continue
      const pitchName = pitches.find((p) => p.id === f.pitchId)?.displayName ?? "This pitch"
      const span = start <= 0 && end >= 24 * 60 ? "all day" : `from ${clockOf(start)} to ${clockOf(end)}`
      conflicts.push({ fixtureId: f.fixtureId, severity: "hard", reason: `${pitchName} is reserved for ${e.name} ${span}.` })
      break
    }
  }
  return conflicts
}

function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}
