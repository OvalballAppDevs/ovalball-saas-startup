import type { ArenaActivity, ArenaOccupancy, OptionState, SegmentPhase } from "@ovalball/contracts/arena"

import { colour, eventTone } from "../design/tokens"

/**
 * ARENA'S COLOURS ARE THE APP'S OWN. A match is the match green, training the training blue, a
 * tournament its forest, an event its violet -- the same tones the Calendar and the agenda use, so a
 * thing looks like itself everywhere. Colour is never the only signal: every block and row also says
 * its kind and its state in words.
 */
export function activityTone(a: Pick<ArenaActivity, "kind">): { accent: string; surface: string; text: string } {
  if (a.kind === "FIXTURE") return eventTone.match
  if (a.kind === "TRAINING") return eventTone.training
  if (a.kind === "TOURNAMENT") return eventTone.tournament
  return eventTone.event
}

export function occupancyTone(type: ArenaOccupancy["activityType"]): { accent: string; surface: string; text: string } {
  if (type === "FIXTURE") return eventTone.match
  if (type === "TRAINING") return eventTone.training
  if (type === "TOURNAMENT" || type === "TOURNAMENT_GAME") return eventTone.tournament
  return eventTone.event
}

/** A segment of a block: warm-up and clearing the pitch are the same tone, quieter than play. */
export function phaseOpacity(phase: SegmentPhase): number {
  if (phase === "PLAY" || phase === "IN_USE" || phase === "RESERVED") return 1
  return 0.45
}

export const PHASE_WORDS: Record<SegmentPhase, string> = {
  WARM_UP: "Warm-up",
  PLAY: "Playing",
  CLEAR: "Clearing the pitch",
  RESERVED: "Reserved",
  IN_USE: "In use",
  TURNAROUND: "Turnaround",
}

export const OPTION_WORDS: Record<OptionState, string> = {
  PREFERRED: "Preferred",
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  UNSUITABLE: "Unsuitable",
  CURRENT: "Current",
}

export function optionTone(state: OptionState): { fg: string; bg: string; border: string } {
  if (state === "PREFERRED") return { fg: colour.forest800, bg: colour.mint100, border: colour.mint300 }
  if (state === "AVAILABLE") return { fg: colour.forest800, bg: colour.surface, border: colour.lineStrong }
  if (state === "CURRENT") return { fg: colour.onForest, bg: colour.forest800, border: colour.forest800 }
  if (state === "OCCUPIED") return { fg: colour.warning, bg: colour.warningSurface, border: colour.warning }
  return { fg: colour.inkMuted, bg: colour.chalk, border: colour.line }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

function parts(iso: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = iso.split("-").map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return { y, m, d, dow }
}

export function weekdayShort(iso: string): string {
  return WEEKDAYS[parts(iso).dow]
}

export function shortDate(iso: string): string {
  const p = parts(iso)
  return `${p.d} ${MONTHS[p.m - 1]}`
}

/** "Saturday, 10 October 2026" -- the day header's own form. */
export function longDate(iso: string): string {
  const p = parts(iso)
  return `${WEEKDAYS_LONG[p.dow]}, ${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}`
}

export function monthTitle(iso: string): string {
  const p = parts(iso)
  return `${MONTHS_LONG[p.m - 1]} ${p.y}`
}

/** The date `n` days from `iso`, as "YYYY-MM-DD". */
export function addDays(iso: string, n: number): string {
  const p = parts(iso)
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`
}

/** The Monday of the week holding `iso`. */
export function weekStart(iso: string): string {
  const dow = parts(iso).dow
  return addDays(iso, dow === 0 ? -6 : 1 - dow)
}

export function monthStart(iso: string): string {
  const p = parts(iso)
  return `${p.y}-${String(p.m).padStart(2, "0")}-01`
}

export function monthEnd(iso: string): string {
  const p = parts(iso)
  const t = new Date(Date.UTC(p.y, p.m, 0))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`
}
