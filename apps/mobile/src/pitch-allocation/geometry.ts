import { timeToMinutes } from "@ovalball/contracts/pitch-allocation"

/**
 * THE BOARD'S GEOMETRY -- pure, tested, and the ONLY place minutes become pixels or pixels become
 * minutes (CA-M11.2).
 *
 * The scheduling precision is the website's: the day runs 08:00 → 23:00 in 15-minute slots, and a
 * drop snaps to the nearest slot. Two scales exist so a person can see the whole morning at once or
 * move a fixture precisely; both are pixel widths for the SAME slot, so nothing about time changes
 * with the zoom. Lanes are rows of a fixed height; a pitch with more than one lane is that many rows.
 *
 * Nothing here knows about pitches, fixtures or buffers -- those come from the shared package. This
 * file answers "where on the screen" and "which slot under the finger", nothing else.
 */
export const START_MINUTES = 8 * 60
export const END_MINUTES = 23 * 60
export const SLOT_MINUTES = 15
export const SLOT_COUNT = (END_MINUTES - START_MINUTES) / SLOT_MINUTES

export type BoardScale = "compact" | "comfortable"

/** Pixels per 15-minute slot. Comfortable makes a 50-minute match about 160pt wide -- room for two lines of words. */
export const PX_PER_SLOT: Record<BoardScale, number> = { compact: 22, comfortable: 48 }

// Taller than a first pass: a typical club (2-4 pitches) should fill the screen's real estate rather
// than leave a dead gap above the unallocated sheet -- found live, on device, alongside the auto-scroll
// bug, and worth fixing in the same pass since both are "the board wastes the screen" complaints.
export const LANE_HEIGHT = 116
export const LANE_GAP = 12
// Widened (CA-M11.2 visual pass) to hold an icon tile beside the pitch name and its real size-category
// metadata -- never a photograph: no venue/pitch image exists in the canonical schema
// (`club_pitches` has no such column), and inventing one would be exactly the fabricated-data mistake
// the platform's own asset rules forbid.
export const LABEL_COLUMN_WIDTH = 128
export const HEADER_HEIGHT = 28

export function timelineWidth(scale: BoardScale): number {
  return SLOT_COUNT * PX_PER_SLOT[scale]
}

export function minutesToX(minutes: number, scale: BoardScale): number {
  return ((minutes - START_MINUTES) / SLOT_MINUTES) * PX_PER_SLOT[scale]
}

export function widthForMinutes(minutes: number, scale: BoardScale): number {
  return (minutes / SLOT_MINUTES) * PX_PER_SLOT[scale]
}

/** The slot under a horizontal position, clamped to the day: never an arbitrary pixel-derived time. */
export function xToSnappedMinutes(x: number, scale: BoardScale): number {
  const raw = START_MINUTES + Math.round(x / PX_PER_SLOT[scale]) * SLOT_MINUTES
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

/** The hour marks the header draws: 8am … 10pm, as the website labels them. */
export function hourMarks(): { minutes: number; label: string }[] {
  const marks: { minutes: number; label: string }[] = []
  for (let m = START_MINUTES; m < END_MINUTES; m += 60) {
    const h = Math.floor(m / 60)
    const period = h >= 12 ? "pm" : "am"
    const h12 = h % 12 === 0 ? 12 : h % 12
    marks.push({ minutes: m, label: `${h12}${period}` })
  }
  return marks
}

/** One row of the board: a pitch lane (a pitch with N lanes is N rows) at a known vertical offset. */
export interface LaneRow {
  pitchId: string
  laneIndex: number
  top: number
}

/**
 * `lanes` is the number of rows a pitch is DRAWN with: its declared capacity, or more when it has been
 * double-booked (the website's split-square rule, `laneRowCount`) -- so a clash is visible, never hidden
 * under another card.
 */
export function laneRows(pitches: { id: string; lanes: number; active: boolean }[]): LaneRow[] {
  const rows: LaneRow[] = []
  let top = 0
  for (const p of pitches) {
    if (!p.active) continue
    const lanes = Math.max(1, p.lanes)
    for (let i = 0; i < lanes; i += 1) {
      rows.push({ pitchId: p.id, laneIndex: i, top })
      top += LANE_HEIGHT + LANE_GAP
    }
  }
  return rows
}

export function boardHeight(rows: LaneRow[]): number {
  return rows.length === 0 ? 0 : rows.length * (LANE_HEIGHT + LANE_GAP) - LANE_GAP
}

/** The lane under a vertical position, or null when the finger is above or below every lane. */
export function yToLaneRow(y: number, rows: LaneRow[]): LaneRow | null {
  for (const row of rows) {
    if (y >= row.top && y < row.top + LANE_HEIGHT + LANE_GAP) return row
  }
  return null
}

/** Where a finger must be for the board to scroll for it, and how fast. */
export const AUTO_SCROLL_EDGE = 48
export const AUTO_SCROLL_STEP = 14

export function autoScrollVelocity(position: number, extent: number): number {
  // BUG FOUND LIVE ON DEVICE: an unmeasured or not-yet-ready viewport reports extent<=0, and the "near
  // the trailing edge" branch below is unconditionally true for any position once extent<=0 -- which
  // reads as "scroll right (or down) at full speed, forever" the instant a drag begins. Fail safe to
  // no auto-scroll rather than a runaway one.
  if (!(extent > 0)) return 0
  if (position < AUTO_SCROLL_EDGE) return -AUTO_SCROLL_STEP * (1 - Math.max(0, position) / AUTO_SCROLL_EDGE)
  if (position > extent - AUTO_SCROLL_EDGE) return AUTO_SCROLL_STEP * (1 - Math.max(0, extent - position) / AUTO_SCROLL_EDGE)
  return 0
}
