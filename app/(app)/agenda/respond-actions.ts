"use server"

import { revalidatePath } from "next/cache"

import { setAttendanceResponse } from "../fixtures/[fixtureId]/actions"
import { respondToTrainingAttendance } from "../calendar/training-session-actions"
import { respondToTournamentAttendance } from "../tournaments/actions"

export type AgendaResponseResult = { ok: true } | { ok: false; message: string }

/**
 * ONE ENTRY POINT FOR ANSWERING, FROM THE AGENDA.
 *
 * Convergence Step 9. Until now the agenda's own copy said "Open a fixture to
 * change whether you can make it" -- the answer was always one navigation away,
 * on a surface built for reading a match rather than for answering four of them
 * on a Tuesday evening. That is the gap this closes.
 *
 * It introduces NO new authority, NO new state and NO new table. Both branches
 * call the canonical server action that already owns the write, which calls the
 * canonical RPC, whose `internal.resolve_attendance_response_source` decides --
 * for every caller, from every surface -- whether this person may answer for
 * this player: a guardian may, an adult player may for themselves, a sixteen or
 * seventeen year old may only with their guardian's recorded consent, and
 * anybody under sixteen may not. Nothing here re-implements a line of it, and a
 * caller the database refuses is refused here whether or not a button was
 * rendered.
 *
 * The three kinds deliberately do not share a write: a fixture, a training
 * session and a tournament are different canonical records with different RPCs,
 * and pretending otherwise would mean inventing a fourth thing that is none of
 * them. What they DO share is the authority underneath -- all three RPCs call
 * the same `internal.resolve_attendance_response_source` -- which is the part
 * that must never be duplicated.
 */
export async function respondFromAgenda(
  kind: "fixture" | "training" | "tournament",
  eventId: string,
  playerId: string,
  status: "ATTENDING" | "CANNOT_ATTEND" | "UNSURE",
): Promise<AgendaResponseResult> {
  if (kind === "fixture") {
    const result = await setAttendanceResponse(eventId, playerId, status)
    if (!result.ok) return { ok: false, message: result.message }
  } else if (kind === "tournament") {
    const result = await respondToTournamentAttendance(eventId, playerId, status)
    if (!result.ok) return { ok: false, message: result.error }
  } else {
    const result = await respondToTrainingAttendance(eventId, playerId, status)
    if (!result.ok) return { ok: false, message: result.error }
  }
  // The agenda and the dashboard both count what is still outstanding, so both
  // are stale the moment this succeeds.
  revalidatePath("/agenda")
  revalidatePath("/dashboard")
  return { ok: true }
}
