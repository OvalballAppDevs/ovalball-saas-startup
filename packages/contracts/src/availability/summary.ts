/**
 * HOW MANY HAVE ANSWERED, SAID ONCE.
 *
 * Four numbers describing one squad are read on at least six surfaces -- the
 * Match Centre register, the training register, the fixture list's summary line,
 * the Fixture Control Centre, the Calendar's quick look and both clients' own
 * versions of all of them. Each of those used to decide for itself which figure
 * led, what the sentence was and whether "0 of 0" was a sentence at all.
 *
 * WHICH NUMBER LEADS, AND WHY IT IS NOT "ATTENDING". A fixture secretary is not
 * checking whether people are coming; they are checking whether they KNOW yet.
 * "Six still to reply" is the fact somebody can act on, and the breakdown
 * follows it. That decision belongs to the product, so it is made here once
 * rather than being re-made by whichever surface is being built that week.
 *
 * NULL IS NOT ZERO, AND THIS MODULE REFUSES TO PRETEND OTHERWISE. A caller with
 * no attendance authority gets no row from `fixture_availability_summary` at all
 * -- deliberately, so the function cannot even be used to learn that a fixture
 * id exists. `summariseAvailability(null)` therefore returns null, and a surface
 * renders nothing. A confident "0 of 0" would throw that whole design away at
 * the last step.
 */

import { ATTENDANCE_STATE_WORDS } from "./vocabulary"

/**
 * ONE SHAPE FOR FOUR NUMBERS.
 *
 * The canonical RPC calls them `attending_count` / `unavailable_count` /
 * `unsure_count` / `awaiting_count` / `squad_count`; the Match Centre resolver
 * calls them `attending` / `cannotAttend` / `unsure` / `awaitingResponse`. Two
 * names for one set of figures is how a surface ends up reading the wrong one,
 * so both clients normalise into this and nothing downstream sees either.
 */
export interface AvailabilityCounts {
  /** Everybody expected: the squad plus approved call-ups. */
  squad: number
  attending: number
  cannotAttend: number
  unsure: number
  awaiting: number
}

export interface AvailabilitySummary {
  counts: AvailabilityCounts
  /** How many have said anything at all. */
  answered: number
  /**
   * ATTENTION, not urgency. True when somebody still owes an answer, which is
   * the only condition any surface treats differently. There is no "deadline
   * approaching" state because Ovalball has no availability deadline.
   */
  outstanding: boolean
  /** The figure that leads, and its word. "6 to reply", or "All replied". */
  lead: string
  /** The breakdown that follows it, in the register's own vocabulary. */
  breakdown: string
  /** "14 of 20 responded" -- the register heading's own line. */
  progress: string
  /** The whole thing as one sentence, for a screen reader and for a `title`. */
  spoken: string
}

/**
 * Build the summary, or return null when there is nothing honest to say.
 *
 * Null in means "you are not authorised to know". A squad of zero means the club
 * has not put anybody on this team yet, which is a real state and also not a
 * summary -- both produce null, and the caller renders its own empty state.
 */
export function summariseAvailability(counts: AvailabilityCounts | null | undefined): AvailabilitySummary | null {
  if (!counts || counts.squad === 0) return null

  const answered = counts.squad - counts.awaiting
  const outstanding = counts.awaiting > 0

  const lead = outstanding ? `${counts.awaiting} to reply` : "All replied"
  const breakdown = [
    `${counts.attending} ${ATTENDANCE_STATE_WORDS.ATTENDING.toLowerCase()}`,
    `${counts.cannotAttend} ${ATTENDANCE_STATE_WORDS.CANNOT_ATTEND.toLowerCase()}`,
    ...(counts.unsure > 0 ? [`${counts.unsure} ${ATTENDANCE_STATE_WORDS.UNSURE.toLowerCase()}`] : []),
  ].join(" · ")
  const progress = `${answered} of ${counts.squad} responded`

  const spoken = outstanding
    ? `${counts.awaiting} of ${counts.squad} still to reply. ${breakdown.replace(/ · /g, ", ")}`
    : `Everyone has replied: ${breakdown.replace(/ · /g, ", ")}`

  return { counts, answered, outstanding, lead, breakdown, progress, spoken }
}

/** The canonical RPC row, in the shape this module wants. Kept here so no caller has to remember which name belongs to which column. */
export function countsFromRpcRow(row: {
  squad_count?: number | null
  attending_count?: number | null
  unavailable_count?: number | null
  unsure_count?: number | null
  awaiting_count?: number | null
} | null | undefined): AvailabilityCounts | null {
  if (!row) return null
  return {
    squad: row.squad_count ?? 0,
    attending: row.attending_count ?? 0,
    cannotAttend: row.unavailable_count ?? 0,
    unsure: row.unsure_count ?? 0,
    awaiting: row.awaiting_count ?? 0,
  }
}

/** Counts derived from rows a client already holds, so a register and its summary can never disagree about the same list. */
export function countsFromResponses(responses: readonly (string | null | undefined)[]): AvailabilityCounts {
  const counts: AvailabilityCounts = { squad: responses.length, attending: 0, cannotAttend: 0, unsure: 0, awaiting: 0 }
  for (const r of responses) {
    if (r === "ATTENDING") counts.attending++
    else if (r === "CANNOT_ATTEND") counts.cannotAttend++
    else if (r === "UNSURE") counts.unsure++
    else counts.awaiting++
  }
  return counts
}
