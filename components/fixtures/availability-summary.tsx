import { summariseAvailability } from "@ovalball/contracts/availability"

import { cn } from "@/lib/utils"

/**
 * HOW MANY HAVE ANSWERED, AS ONE LINE.
 *
 * WHAT THIS READS. The canonical `player_fixture_attendance` counts an
 * operational surface is entitled to see. It offers no way to answer and no
 * per-player names: responding belongs to Match Centre and Training Centre,
 * which own the control and the safeguarding rule behind it.
 *
 * NULL IS NOT ZERO. Rendering nothing when the summary is null means "you are
 * not authorised to know", not "nobody has replied". The RPC goes to some
 * trouble to keep those apart -- a caller without attendance authority gets no
 * row at all, so the function cannot even be used to learn that a fixture id
 * exists -- and a component printing "0 of 0" would throw that away at the last
 * step. The decision now lives in `summariseAvailability`, which returns null for
 * both cases, so every surface refuses in the same way.
 *
 * WHY THE NUMBER THAT LEADS IS "AWAITING". A fixture secretary is not checking
 * whether people are coming; they are checking whether they know yet. That is a
 * product decision rather than a layout one, so it is made once in the shared
 * contract and both clients inherit it -- the app's own summary cannot decide to
 * lead with "18 attending".
 *
 * Numbers are never carried by colour alone: the visible line states the figure
 * and the word, and the full sentence is available to a screen reader.
 */

/**
 * The shape this component's existing callers already hold -- Fixture Operations'
 * row query names the column `unavailable_count` and its type follows. Adapted
 * into the shared contract's names here rather than renamed across Fixture
 * Operations, so one component translates once instead of every surface learning
 * a second vocabulary for the same four figures.
 */
export interface AvailabilityCounts {
  squad: number
  attending: number
  unavailable: number
  unsure: number
  awaiting: number
}

export function AvailabilitySummary({ counts, className }: { counts: AvailabilityCounts | null | undefined; className?: string }) {
  const summary = summariseAvailability(
    counts ? { squad: counts.squad, attending: counts.attending, cannotAttend: counts.unavailable, unsure: counts.unsure, awaiting: counts.awaiting } : null
  )
  if (!summary) return null

  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs", className)} title={summary.spoken}>
      <span className="sr-only">{summary.spoken}</span>
      <span aria-hidden="true" className={cn("font-medium tabular-nums", summary.outstanding ? "text-amber-900" : "text-forest-800")}>
        {summary.lead}
      </span>
      <span aria-hidden="true" className="text-ink-muted tabular-nums">
        {summary.breakdown}
        {summary.outstanding && <> &middot; {summary.progress}</>}
      </span>
    </p>
  )
}
