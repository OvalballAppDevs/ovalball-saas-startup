import { cn } from "@/lib/utils"

/**
 * HOW MANY HAVE ANSWERED, AS ONE LINE.
 *
 * STEP 7 DISPLAY, NOT THE STEP 9 RESPONSE EXPERIENCE. This reads the canonical
 * `player_fixture_attendance` counts an operational surface is entitled to see.
 * It offers no way to answer, no per-player names, and no route into
 * responding: the parent and player journey that produces these numbers is a
 * later step's, and this component exists so that Fixture Operations can be
 * useful in the meantime without pulling that journey forward.
 *
 * NULL IS NOT ZERO. The caller renders nothing when the summary is null --
 * which means "you are not authorised to know", not "nobody has replied". The
 * RPC goes to some trouble to keep those two apart (see the migration); a
 * component that printed "0 of 0" would throw that away at the last step.
 *
 * WHY THE NUMBER THAT LEADS IS "AWAITING". A fixture secretary is not
 * checking whether people are coming; they are checking whether they know yet.
 * "Six still to reply" is the actionable fact, and the breakdown follows it.
 * Numbers are never carried by colour alone.
 */
export interface AvailabilityCounts {
  squad: number
  attending: number
  unavailable: number
  unsure: number
  awaiting: number
}

export function AvailabilitySummary({ counts, className }: { counts: AvailabilityCounts | null | undefined; className?: string }) {
  // Not authorised, or a fixture with no squad recorded against it yet: in
  // both cases a count would be an assertion nobody can stand behind.
  if (!counts || counts.squad === 0) return null

  const replied = counts.squad - counts.awaiting
  const label =
    counts.awaiting === 0
      ? `Everyone has replied: ${counts.attending} available, ${counts.unavailable} not, ${counts.unsure} unsure`
      : `${counts.awaiting} of ${counts.squad} still to reply. ${counts.attending} available, ${counts.unavailable} not, ${counts.unsure} unsure`

  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs", className)} title={label}>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className={cn("font-medium tabular-nums", counts.awaiting > 0 ? "text-amber-900" : "text-forest-800")}>
        {counts.awaiting > 0 ? `${counts.awaiting} to reply` : "All replied"}
      </span>
      <span aria-hidden="true" className="text-ink-muted tabular-nums">
        {counts.attending} in &middot; {counts.unavailable} out
        {counts.unsure > 0 && <> &middot; {counts.unsure} unsure</>}
        {counts.awaiting > 0 && <> &middot; {replied}/{counts.squad}</>}
      </span>
    </p>
  )
}
