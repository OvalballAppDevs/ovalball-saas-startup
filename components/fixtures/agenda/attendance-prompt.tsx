import Link from "next/link"
import { ArrowRight, ClipboardCheck, X } from "lucide-react"

/**
 * "YOU STILL OWE AN ANSWER."
 *
 * Two states of one idea, deliberately in one file so they cannot drift into
 * two different explanations of the same filter.
 *
 * THE PROMPT (filter off) invites. It is the only element on the agenda
 * allowed to compete with the promoted card, so it is COMPACT and horizontal
 * rather than a full-width pale alert: the previous version was a large cream
 * rectangle occupying the first screen of a phone before any rugby appeared,
 * which is a poor trade for a two-line message.
 *
 * THE ACTIVE BANNER (filter on) explains and offers the way out. That was the
 * real defect: tapping the prompt filtered the agenda with no obvious return,
 * leaving "Filter 1" as the only clue and the drawer as the only escape.
 *
 * Both inherit the tactile language -- a hard bottom edge and 3px of press
 * travel -- so the prompt reads as pressable before it is pressed.
 */

export function AttendancePrompt({ count, href }: { count: number; href: string }) {
  return (
    <Link
      href={href}
      className="group flex min-h-11 items-center gap-3 rounded-xl border border-amber-500/35 bg-amber-50 px-4 py-3 shadow-[0_3px_0_0_theme(colors.amber.500/25%)] outline-none transition-[transform,box-shadow,background-color] duration-100 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 focus-visible:outline-none active:translate-y-[3px] active:shadow-none"
    >
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-900">
        <ClipboardCheck className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-base leading-tight text-amber-950">
          {count} {count === 1 ? "activity needs" : "activities need"} your response
        </span>
        <span className="mt-0.5 block text-xs text-amber-900/80">In the next 14 days</span>
      </span>
      <span
        aria-hidden="true"
        className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-amber-950 transition-transform group-hover:translate-x-0.5"
      >
        Review
        <ArrowRight className="size-4" />
      </span>
    </Link>
  )
}

/**
 * The active state.
 *
 * `clearHref` removes ONLY this filter and keeps everything else the person
 * chose -- somebody looking at September, Ava, training on, who then taps the
 * prompt, gets September/Ava/training-on back, not a reset agenda.
 */
export function AttendanceActiveBanner({ clearHref }: { clearHref: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/35 bg-amber-50 px-4 py-3">
      <p className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-900">
          <ClipboardCheck className="size-4" />
        </span>
        <span className="min-w-0">
          {/* No count here. The result line directly below already carries the
              number, and the two of them saying "4" one under the other read
              as a mistake rather than as emphasis. */}
          <span className="block text-sm font-semibold text-amber-950">Showing activities needing a response</span>
          <span className="mt-0.5 block text-xs text-amber-900/80">Everything else is hidden while this is on.</span>
        </span>
      </p>
      {/* The escape, right beside the explanation of why things are missing --
          not behind the filter drawer. */}
      <Link
        href={clearHref}
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-amber-600/30 bg-white px-4 text-sm font-medium text-amber-950 shadow-[0_3px_0_0_theme(colors.amber.500/25%)] outline-none transition-[transform,box-shadow,background-color] duration-100 hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 focus-visible:outline-none active:translate-y-[3px] active:shadow-none"
      >
        <X className="size-3.5" aria-hidden="true" />
        Show All
      </Link>
    </div>
  )
}
