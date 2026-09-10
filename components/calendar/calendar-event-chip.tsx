import { CalendarHeart, Dumbbell, MapPin, Trophy } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * ONE CALENDAR EVENT PRIMITIVE, AT TWO DENSITIES.
 *
 * Every schedulable thing Ovalball puts on a calendar draws through this:
 * a fixture, a training session, a club event, a tournament. Before it, only
 * fixtures had a chip -- training was loose italic text inside the day square,
 * carrying no time, no team and no mark, so the same Thursday showed a
 * designed object and an afterthought side by side.
 *
 * SAME FUNCTION, SAME PATTERN. Each kind keeps its own character -- its mark,
 * its colour, its vocabulary -- but the geometry, the truncation, the spacing
 * and the way it states a time are shared, because they are answering the same
 * question in the same place.
 *
 * WHAT EACH DENSITY IS FOR.
 *
 *   month  a day square holds three of these and a "+2 more". It gets a mark,
 *          a time and one line of identity, truncated. Nothing else fits, and
 *          cramming a full card in is what makes a month grid unreadable.
 *   week   a day column is taller than it is wide, so it gets the same
 *          information on two lines with room for the opposition or venue.
 *
 * NEVER COLOUR ALONE, AND NEVER RED. Each kind carries a distinct icon before
 * it carries a tint, so the four are separable in greyscale. Red stays
 * reserved across Ovalball for cancelled, error and danger.
 */

export type CalendarEventKind = "fixture" | "training" | "event" | "tournament"

export interface CalendarEventChipProps {
  kind: CalendarEventKind
  /** "10:30", or null when the time is not settled. */
  time: string | null
  /** The main line: "Under 12 Boys v Rossendale RUFC", "Centenary Weekend". */
  title: string
  /** A quieter second line at week density -- venue, or the team for a club-wide event. */
  detail?: string | null
  density: "month" | "week"
  /** A multi-day event's middle and last days say so rather than repeating the start time. */
  continuation?: "starts" | "continues" | "ends" | null
  cancelled?: boolean
  className?: string
}

const KIND_ICON = {
  fixture: MapPin,
  training: Dumbbell,
  event: CalendarHeart,
  tournament: Trophy,
} as const

/**
 * Each kind's own character.
 *
 * An Event must never be mistaken for a Match or a Training session, so it
 * gets its own icon and its own tint rather than borrowing either. Its
 * plum/berry reads as "club life" beside the pitch greens without competing
 * with the amber a tournament already owns.
 */
const KIND_TONE = {
  fixture: "bg-forest-800/10 text-forest-900",
  training: "bg-ink/6 text-ink-muted",
  event: "bg-[#6d3b5d]/10 text-[#6d3b5d]",
  tournament: "bg-amber-500/12 text-amber-900",
} as const

export function CalendarEventChip({
  kind,
  time,
  title,
  detail,
  density,
  continuation,
  cancelled,
  className,
}: CalendarEventChipProps) {
  const Icon = KIND_ICON[kind]
  // A day in the middle of a seven-day event has no start time of its own, and
  // repeating the first day's would be a lie about that day. An event with no
  // recorded start time is all-day on its first day too -- the absence of a
  // time is the all-day semantic, never a fake midnight.
  const timeLabel =
    continuation && continuation !== "starts"
      ? continuation === "ends"
        ? "Ends"
        : "All day"
      : (time ?? (kind === "event" ? "All day" : null))

  // CANCELLED TAKES THE ONE RESERVED TONE, not its kind's. A cancelled event
  // is no longer "a club event" first -- it is a cancellation, and Ovalball
  // already has exactly one visual language for that. Strike-through carries
  // it without colour, so the two together survive greyscale.
  const tone = cancelled ? "bg-destructive/10 text-destructive-text" : KIND_TONE[kind]

  if (density === "month") {
    return (
      <span
        className={cn(
          "flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight",
          tone,
          cancelled && "line-through",
          className
        )}
      >
        <Icon className="size-2.5 shrink-0" aria-hidden="true" />
        {timeLabel && <span className="shrink-0 font-semibold tabular-nums">{timeLabel}</span>}
        <span className="min-w-0 truncate">{title}</span>
      </span>
    )
  }

  return (
    <span
      className={cn(
        "flex w-full min-w-0 flex-col gap-0.5 rounded-lg border border-ink/8 bg-white px-2 py-1.5",
        cancelled && "opacity-60",
        className
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={cn("flex size-4 shrink-0 items-center justify-center rounded", tone)}>
          <Icon className="size-2.5" aria-hidden="true" />
        </span>
        {timeLabel && <span className="shrink-0 text-[11px] leading-none font-semibold text-ink tabular-nums">{timeLabel}</span>}
      </span>
      <span className={cn("line-clamp-2 text-[11px] leading-snug text-ink", cancelled && "line-through")}>{title}</span>
      {detail && <span className="truncate text-[10px] leading-none text-ink-muted">{detail}</span>}
    </span>
  )
}
