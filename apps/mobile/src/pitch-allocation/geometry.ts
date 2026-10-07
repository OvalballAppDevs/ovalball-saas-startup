import { timeToMinutes } from "@ovalball/contracts/pitch-allocation"

/**
 * THE BOARD'S GEOMETRY -- pure, tested, and the ONLY place minutes become points or points become
 * minutes (CA-M11.2; re-oriented in the Arena pass).
 *
 * A RESOURCE TIMETABLE: TIME RUNS DOWN THE LEFT, PITCHES RUN ACROSS THE TOP (the owner's orientation rule
 * and the Arena Planning mock-up: "TIME | PITCH 1 | PITCH 2 | …", never times across the top). The
 * scheduling precision is the website's: the day runs 08:00 → 23:00 in 15-minute slots, and a drop snaps
 * to the nearest slot. Two scales exist so a person can see the whole morning at once or move a fixture
 * precisely; both are point heights for the SAME slot, so nothing about time changes with the zoom. A pitch
 * is a column; a pitch with more than one lane is that many narrower columns side by side.
 *
 * Nothing here knows about pitches, fixtures or buffers -- those come from the shared package. This file
 * answers "where on the screen" and "which slot, which column under the finger", nothing else.
 */
export const START_MINUTES = 8 * 60
export const END_MINUTES = 23 * 60
export const SLOT_MINUTES = 15
export const SLOT_COUNT = (END_MINUTES - START_MINUTES) / SLOT_MINUTES

export type BoardScale = "compact" | "comfortable"

/** Points per 15-minute slot, DOWN the board. Comfortable makes a 50-minute match about 110pt tall -- room for its names. */
export const PX_PER_SLOT: Record<BoardScale, number> = { compact: 18, comfortable: 32 }

/** One lane's column: wide enough for "Under 12 Boys" and a kick-off on two short lines. */
export const LANE_WIDTH = 124
export const LANE_GAP = 8
/** The frozen time axis down the left. */
export const TIME_AXIS_WIDTH = 52
/** The frozen resource header across the top: a pitch's name, its size and how many games it takes. */
export const HEADER_HEIGHT = 58

export function timelineHeight(scale: BoardScale): number {
  return SLOT_COUNT * PX_PER_SLOT[scale]
}

export function minutesToY(minutes: number, scale: BoardScale): number {
  return ((minutes - START_MINUTES) / SLOT_MINUTES) * PX_PER_SLOT[scale]
}

export function heightForMinutes(minutes: number, scale: BoardScale): number {
  return (minutes / SLOT_MINUTES) * PX_PER_SLOT[scale]
}

/** The slot under a vertical position, clamped to the day: never an arbitrary point-derived time. */
export function yToSnappedMinutes(y: number, scale: BoardScale): number {
  const raw = START_MINUTES + Math.round(y / PX_PER_SLOT[scale]) * SLOT_MINUTES
  return Math.min(Math.max(raw, START_MINUTES), END_MINUTES - SLOT_MINUTES)
}

export function minutesToTime(m: number): string {
  const hh = Math.floor(m / 60).toString().padStart(2, "0")
  const mm = (m % 60).toString().padStart(2, "0")
  return `${hh}:${mm}`
}

export function kickoffMinutes(kickoffTime: string | null): number | null {
  return kickoffTime ? timeToMinutes(kickoffTime) : null
}

/**
 * THE TIME AXIS: every slot from 08:00, each a 24-hour clock time ("08:00", "08:15", …). `labelled` says
 * which of them the axis prints at this scale -- every quarter where a slot is tall enough to read, the
 * hours alone where it is not; an unlabelled quarter is still drawn as a faint line.
 */
export function timeMarks(scale: BoardScale): { minutes: number; label: string; hour: boolean; labelled: boolean }[] {
  const everyQuarter = PX_PER_SLOT[scale] >= 24
  const marks: { minutes: number; label: string; hour: boolean; labelled: boolean }[] = []
  for (let m = START_MINUTES; m < END_MINUTES; m += SLOT_MINUTES) {
    const hour = m % 60 === 0
    marks.push({ minutes: m, label: minutesToTime(m), hour, labelled: hour || everyQuarter })
  }
  return marks
}

/** One column of the board: a pitch lane (a pitch with N lanes is N columns) at a known left edge and a
 * known width of its OWN -- see `laneWidthFor` for why this is not always `LANE_WIDTH`. */
export interface LaneColumn {
  pitchId: string
  laneIndex: number
  left: number
  width: number
}

/** The narrowest a lane may be drawn, however many lanes share a pitch: still a readable kick-off. */
export const MIN_LANE_WIDTH = 64
const COMPACT_LANE_GAP = 3
/** How much a pitch's TOTAL width grows for each concurrent lane beyond the first, rather than the full
 * `LANE_WIDTH` a naive side-by-side would cost. */
const COMPACT_STEP = 72

/**
 * A SINGLE booking gets the full `LANE_WIDTH`. Up to four CONCURRENT bookings on the same pitch (its own
 * declared lanes, or more when genuinely double-booked -- `laneRowCount`'s split-square rule) share a
 * pitch's column as narrower lanes rather than costing a full column each: a pitch hosting three junior
 * games at once should not cost three times the screen one game would.
 */
export function laneWidthFor(lanes: number): number {
  if (lanes <= 1) return LANE_WIDTH
  const total = LANE_WIDTH + (lanes - 1) * COMPACT_STEP
  const perLane = Math.floor((total - (lanes - 1) * COMPACT_LANE_GAP) / lanes)
  return Math.max(MIN_LANE_WIDTH, perLane)
}

/**
 * `lanes` is the number of columns a pitch is DRAWN with: its declared capacity, or more when it has been
 * double-booked -- so a clash is visible, never hidden under another card. Lanes of the SAME pitch sit close
 * together (`COMPACT_LANE_GAP`); the gap after a pitch's LAST lane is the larger `LANE_GAP` that separates
 * one pitch from the next.
 */
export function laneColumns(pitches: { id: string; lanes: number; active: boolean }[]): LaneColumn[] {
  const cols: LaneColumn[] = []
  let left = 0
  for (const p of pitches) {
    if (!p.active) continue
    const lanes = Math.max(1, p.lanes)
    const width = laneWidthFor(lanes)
    for (let i = 0; i < lanes; i += 1) {
      cols.push({ pitchId: p.id, laneIndex: i, left, width })
      left += width + (i === lanes - 1 ? LANE_GAP : COMPACT_LANE_GAP)
    }
  }
  return cols
}

export function boardWidth(cols: LaneColumn[]): number {
  if (cols.length === 0) return 0
  const last = cols[cols.length - 1]
  return last.left + last.width
}

/** The lane under a horizontal position, or null when the finger is left or right of every lane. Each
 * column's own boundary runs to wherever the NEXT column starts (so the gap after it still belongs to it)
 * -- correct for both uniform and compacted, variable-width columns. */
export function xToLaneColumn(x: number, cols: LaneColumn[]): LaneColumn | null {
  for (let i = 0; i < cols.length; i += 1) {
    const col = cols[i]
    const boundary = i + 1 < cols.length ? cols[i + 1].left : col.left + col.width + LANE_GAP
    if (x >= col.left && x < boundary) return col
  }
  return null
}

/** Where a finger must be for the board to scroll for it, and how fast. */
export const AUTO_SCROLL_EDGE = 48
export const AUTO_SCROLL_STEP = 14

export function autoScrollVelocity(position: number, extent: number): number {
  // BUG FOUND LIVE ON DEVICE: an unmeasured or not-yet-ready viewport reports extent<=0, and the "near
  // the trailing edge" branch below is unconditionally true for any position once extent<=0 -- which
  // reads as "scroll at full speed, forever" the instant a drag begins. Fail safe to no auto-scroll rather
  // than a runaway one.
  if (!(extent > 0)) return 0
  if (position < AUTO_SCROLL_EDGE) return -AUTO_SCROLL_STEP * (1 - Math.max(0, position) / AUTO_SCROLL_EDGE)
  if (position > extent - AUTO_SCROLL_EDGE) return AUTO_SCROLL_STEP * (1 - Math.max(0, extent - position) / AUTO_SCROLL_EDGE)
  return 0
}
