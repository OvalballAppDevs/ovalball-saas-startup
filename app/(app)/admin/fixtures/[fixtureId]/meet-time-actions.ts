"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type MeetTimeResult = { ok: true; meetTime: string | null } | { ok: false; error: string }

/**
 * Sets the fixture's canonical arrival time.
 *
 * WHY THIS LIVES IN FIXTURE MANAGEMENT AND NOT IN THE MATCH CENTRE
 *
 * Meet time is a property of the fixture, alongside kick-off, venue and pitch.
 * It is scheduled by whoever runs the fixture, and it is scheduled once. The
 * Match Centre is where the whole club READS the fixture -- putting an editing
 * control there made the presentation surface a second editing authority for
 * one field, which is how two places to change one fact come about.
 *
 * The canonical column, its CHECK constraints and this RPC are all unchanged:
 * only the control moved. The Match Centre still displays meet_time in its
 * hero, because everybody needs to know when to turn up.
 *
 * Authority is NOT decided here. update_fixture_meet_time re-checks
 * internal.can_submit_fixture_result (plus Site Admin) server-side -- the same
 * check the rest of the schedule uses, and one that covers EITHER side, so an
 * away club can still tell its own players when to meet. This action only
 * forwards the value.
 *
 * The two rules (a meet time needs a kick-off, and cannot be after it) are
 * enforced by the database in both a CHECK constraint and the RPC, so the
 * messages below are the RPC's own human-readable ones rather than anything
 * re-derived in TypeScript.
 */
export async function setFixtureMeetTime(fixtureId: string, meetTime: string | null): Promise<MeetTimeResult> {
  const supabase = await createClient()
  const trimmed = meetTime && meetTime.trim().length > 0 ? meetTime.trim() : null

  // The generated parameter type is non-null, but the RPC accepts NULL to
  // clear a meet time; an empty string is nullified by the same function.
  const { error } = await supabase.rpc("update_fixture_meet_time", {
    p_fixture_id: fixtureId,
    p_meet_time: trimmed as unknown as string,
  })
  if (error) {
    console.error("update_fixture_meet_time failed:", error.message)
    const message = error.message ?? ""
    // Both of these are safe to show verbatim: they describe the caller's own
    // fixture and reveal nothing else.
    if (message.startsWith("Set a kick-off time") || message.startsWith("The meet time must be")) {
      return { ok: false, error: message }
    }
    return { ok: false, error: "We couldn't save that meet time. Please try again." }
  }

  // Every surface that shows a meet time, refreshed together -- the Match
  // Centre reads the same canonical column this just wrote.
  revalidatePath(`/admin/fixtures/${fixtureId}`)
  revalidatePath(`/fixtures/${fixtureId}`)
  revalidatePath("/agenda")
  revalidatePath("/calendar")
  return { ok: true, meetTime: trimmed }
}
