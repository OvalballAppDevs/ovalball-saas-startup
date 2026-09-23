import {
  ATTENDANCE_STATES,
  ATTENDANCE_STATE_WORDS,
  AVAILABILITY_TONE_VALUES,
  attendanceStateShape,
  type AttendanceGroupKey,
  type AvailabilityIconName,
  type AvailabilityTone,
} from "@ovalball/contracts/availability"

import { Check, CircleDashed, HelpCircle, X } from "../components/icons"
import { colour } from "../design/tokens"

/**
 * THE WEBSITE'S AVAILABILITY DESIGN, EXPRESSED FOR A PLATFORM WITH NO CASCADE.
 *
 * This file is the twin of `components/shared/attendance-groups.tsx`. Both are
 * PAINT ONLY: which states exist, what they are called, what order they come in
 * and which icon each carries all arrive from
 * `@ovalball/contracts/availability`, so the app cannot end up with a fourth
 * state, a different word, a re-sorted register or a tick where the web draws a
 * question mark.
 *
 * WHY THERE IS PAINT HERE AT ALL. The web's values are Tailwind class strings
 * against a light card. React Native has no class names, no cascade and no
 * alpha-on-token syntax, so the same DESIGN has to be written as literal
 * colours. Copying by value is the established convention for this app
 * (`src/design/tokens.ts` says so about the whole palette), and the shared
 * contract carries the measured hex for each tone precisely so this file is
 * transcribing rather than choosing.
 *
 * COLOUR IS NEVER THE ONLY CARRIER, on either client. Every tile and every group
 * heading shows its ICON and its WORD as well, so the register reads correctly
 * in greyscale, to a colour-blind reader and to VoiceOver.
 */

const ICON: Record<AvailabilityIconName, typeof Check> = {
  check: Check,
  "help-circle": HelpCircle,
  x: X,
  "circle-dashed": CircleDashed,
}

export interface AvailabilityToneStyle {
  /** The figure, the icon and the heading. */
  text: string
  /** A hairline around a tile or a person chip. */
  edge: string
  /** The tile's own ground -- a wash, so the number stays the loudest thing. */
  wash: string
}

/**
 * Each tone's three values. Taken from the contract, which records where they
 * were measured -- forest-900 rather than pitch-600 for the positive tone,
 * because pitch-600 measures 3.14:1 on white and fails AA for semibold body
 * text. The web carries the same correction as a comment against the same
 * decision.
 */
export function toneStyle(tone: AvailabilityTone): AvailabilityToneStyle {
  return AVAILABILITY_TONE_VALUES[tone]
}

export interface AvailabilityGroupStyle {
  key: AttendanceGroupKey
  label: string
  Icon: typeof Check
  tone: AvailabilityTone
  text: string
  edge: string
  wash: string
}

/** The four groups, in the canonical order, ready to render. */
export const AVAILABILITY_GROUPS: readonly AvailabilityGroupStyle[] = ATTENDANCE_STATES.map((state) => ({
  key: state.key,
  label: ATTENDANCE_STATE_WORDS[state.key],
  Icon: ICON[state.icon],
  tone: state.tone,
  ...AVAILABILITY_TONE_VALUES[state.tone],
}))

/** One state's rendering, for a single chip or a single row rather than the whole register. */
export function availabilityGroupStyle(status: AttendanceGroupKey): AvailabilityGroupStyle {
  const shape = attendanceStateShape(status)
  return {
    key: shape.key,
    label: ATTENDANCE_STATE_WORDS[shape.key],
    Icon: ICON[shape.icon],
    tone: shape.tone,
    ...AVAILABILITY_TONE_VALUES[shape.tone],
  }
}

/**
 * THE THREE ANSWERS ON THE DARK MATCHDAY GROUND.
 *
 * The web's control sits inside the forest hero, where the wash values above --
 * measured against white -- would disappear. These are the dark-ground
 * equivalents of the same three semantic decisions, transcribed from
 * `components/shared/availability-choice.tsx`'s own class strings so the two
 * controls read as one control on two devices.
 */
export const ANSWER_ON_DARK: Record<"ATTENDING" | "CANNOT_ATTEND" | "UNSURE", { idle: string; chosenEdge: string; chosenWash: string; chosenText: string }> = {
  ATTENDING: {
    idle: colour.pitch400,
    chosenEdge: colour.pitch400,
    chosenWash: "rgba(90,203,131,0.20)",
    chosenText: colour.chalk,
  },
  CANNOT_ATTEND: {
    idle: "#fca5a5",
    chosenEdge: "rgba(248,113,113,0.70)",
    chosenWash: "rgba(248,113,113,0.15)",
    chosenText: "#fee2e2",
  },
  UNSURE: {
    idle: "#fcd34d",
    chosenEdge: "rgba(251,191,36,0.70)",
    chosenWash: "rgba(251,191,36,0.15)",
    chosenText: "#fef3c7",
  },
}

/**
 * THE SAME THREE ANSWERS, ON A LIGHT GROUND.
 *
 * The Training Centre's availability selector sits on the chalk sheet rather than
 * inside a dark hero, so the control needs a palette measured against chalk. It is
 * the SAME control and the same three answers -- only the ground changed, and with
 * it the ink that stays readable on it.
 *
 * SELECTION IS STILL NEVER COLOUR ALONE: each choice keeps its own icon, its own
 * words, a filled ground when chosen and `accessibilityState.selected`.
 */
export const ANSWER_ON_LIGHT: Record<
  "ATTENDING" | "CANNOT_ATTEND" | "UNSURE",
  { idle: string; chosenEdge: string; chosenWash: string; chosenText: string }
> = {
  ATTENDING: {
    idle: colour.forest800,
    chosenEdge: colour.pitch600,
    chosenWash: colour.successSurface,
    chosenText: colour.forest800,
  },
  CANNOT_ATTEND: {
    idle: colour.danger,
    chosenEdge: colour.danger,
    chosenWash: colour.dangerSurface,
    chosenText: colour.danger,
  },
  UNSURE: {
    idle: colour.warning,
    chosenEdge: colour.warning,
    chosenWash: colour.warningSurface,
    chosenText: colour.warning,
  },
}

export { ICON as AVAILABILITY_ICONS }
