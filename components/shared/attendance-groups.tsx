import { Check, CircleDashed, HelpCircle, X } from "lucide-react"

import {
  ATTENDANCE_STATES,
  ATTENDANCE_STATE_WORDS,
  type AttendanceGroupKey,
  type AvailabilityIconName,
} from "@ovalball/contracts/availability"

/**
 * ONE PALETTE FOR THE FOUR ANSWERS -- THE WEB'S PAINT, THE PLATFORM'S MEANING.
 *
 * Match Centre's participant list defined this and Training Centre's register
 * was drawn from scratch beside it, which is how one product ends up with two
 * greens for "attending". The values below are Match Centre's own, and both
 * registers have rendered from this single source since.
 *
 * WHAT CHANGED IN M6. The three things that are not paint -- WHICH states exist,
 * what ORDER they are in, and which ICON each carries -- moved to
 * `@ovalball/contracts/availability`, because the native client needs exactly
 * those and cannot have a Tailwind class or a `lucide-react` component. So this
 * file is now the web's RENDERING of a shared model rather than the model
 * itself: the class strings below are unchanged, and the list is built by mapping
 * the canonical order rather than by being written out in an order somebody chose
 * here.
 *
 * COLOUR IS NEVER THE ONLY CARRIER. Every tile and every heading also has its
 * own ICON and its own WORD, both from the shared contract, so the register, the
 * filter and the summary all say "Can't attend" the same way and draw the same
 * tick. The section reads correctly in greyscale, to a colour-blind reader, and
 * to a screen reader.
 */

export type { AttendanceGroupKey }

export interface AttendanceGroup {
  key: AttendanceGroupKey
  label: string
  Icon: typeof Check
  /** The count tile's gradient and ring. */
  tile: string
  /** A small outlined badge on white. */
  badge: string
  /** The big number. */
  figure: string
  /** The group heading text. */
  heading: string
  /** A person chip inside the group. */
  chip: string
  /** The initials disc on a person chip. */
  avatar: string
}

/** The shared contract names the icon; the web supplies the component for that name. */
const ICON: Record<AvailabilityIconName, typeof Check> = {
  check: Check,
  "help-circle": HelpCircle,
  x: X,
  "circle-dashed": CircleDashed,
}

/** Paint only. Everything else about a state comes from the contract. */
const PAINT: Record<AttendanceGroupKey, Omit<AttendanceGroup, "key" | "label" | "Icon">> = {
  ATTENDING: {
    tile: "from-pitch-400/25 to-pitch-400/5 ring-pitch-600/25",
    // forest-900, not pitch-800. pitch-800 does not exist in the theme -- only
    // pitch-400 and pitch-600 do -- so this silently fell back to ink and the
    // attending group has never rendered in its intended colour on either
    // surface. pitch-600 would resolve but measures 3.14:1 on white, under AA
    // for 14px semibold; forest-900 is the dark green the theme actually has
    // and clears it comfortably. The same measurement is recorded against the
    // shared contract's `positive` tone, so the app inherits the corrected
    // value rather than repeating the mistake.
    badge: "border-pitch-600/50 bg-white text-forest-900",
    figure: "text-forest-900",
    heading: "text-forest-900",
    chip: "border-pitch-600/25 bg-pitch-400/10",
    avatar: "border-pitch-600/25 bg-pitch-600/10 text-forest-900",
  },
  UNSURE: {
    tile: "from-amber-400/25 to-amber-400/5 ring-amber-500/30",
    badge: "border-amber-500/50 bg-white text-amber-800",
    figure: "text-amber-900",
    heading: "text-amber-800",
    chip: "border-amber-500/25 bg-amber-400/10",
    avatar: "border-amber-500/30 bg-amber-400/15 text-amber-900",
  },
  CANNOT_ATTEND: {
    tile: "from-red-400/20 to-red-400/5 ring-red-500/25",
    badge: "border-red-500/50 bg-white text-red-700",
    figure: "text-red-900",
    heading: "text-red-800",
    chip: "border-red-500/20 bg-red-400/8",
    avatar: "border-red-500/25 bg-red-400/10 text-red-900",
  },
  AWAITING: {
    tile: "from-ink/8 to-ink/[0.02] ring-ink/15",
    badge: "border-ink/25 bg-white text-ink-muted",
    figure: "text-ink",
    heading: "text-ink-muted",
    chip: "border-ink/12 bg-white",
    avatar: "border-ink/15 bg-ink/5 text-ink-muted",
  },
}

/**
 * The four groups, in the CANONICAL order -- said yes, not sure, said no, has
 * not said. The order is the contract's, so a register cannot be re-sorted on
 * one client and not the other.
 */
export const ATTENDANCE_GROUPS: readonly AttendanceGroup[] = ATTENDANCE_STATES.map((state) => ({
  key: state.key,
  label: ATTENDANCE_STATE_WORDS[state.key],
  Icon: ICON[state.icon],
  ...PAINT[state.key],
}))

/** Initials for a person chip. Never a photo: a register is not a gallery of other people's children. */
export function initialsFor(firstName: string, surname: string): string {
  return `${firstName[0] ?? ""}${surname[0] ?? ""}`.toUpperCase() || "?"
}
