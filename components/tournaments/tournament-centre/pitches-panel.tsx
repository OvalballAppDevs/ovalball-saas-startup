import { Clock } from "lucide-react"

import type { TournamentPitchReservation } from "@/lib/tournaments/view-model"

/**
 * THE PITCHES THE DAY HOLDS.
 *
 * Stated as periods, because that is what a reservation is. A festival that
 * finishes at 14:00 does not hold the pitch until midnight, and the board it
 * feeds says the same thing -- these are the exact rows Pitch Allocation
 * reads, not a second description of them.
 *
 * Several pitches over overlapping periods is the normal shape here and is
 * presented without apology or warning, because a festival on three pitches is
 * not a clash. What WOULD be a clash -- something unrelated wanting one of
 * these pitches -- shows on the Pitch Allocation board, where the rest of the
 * day is also visible.
 */
export function TournamentPitches({
  reservations,
  isMultiDay,
}: {
  reservations: TournamentPitchReservation[]
  isMultiDay: boolean
}) {
  if (reservations.length === 0) return null

  return (
    <section aria-labelledby="tc-pitches" className="rounded-2xl border border-ink/10 bg-white p-4 sm:p-5">
      <h2 id="tc-pitches" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
        Pitches Reserved
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {reservations.map((r) => (
          <li
            key={r.id}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-400/15 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-500/25"
          >
            <span className="font-medium">{r.pitchName}</span>
            <span className="inline-flex items-center gap-1 text-xs tabular-nums">
              <Clock className="size-3" aria-hidden="true" />
              {r.startTime.slice(0, 5)}&ndash;{r.endTime.slice(0, 5)}
              {isMultiDay && <> &middot; {new Date(`${r.reservedOn}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
