"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/**
 * The one thing a participant owns on a club event: their own answer.
 *
 * ONE WRITE, AND NO AUTHORITY OF ITS OWN. This calls the canonical
 * public.respond_to_event_attendance, which refuses a player who is not
 * involved in the event, resolves the responder's authority through
 * internal.resolve_attendance_response_source -- the SAME safeguarding rule
 * fixtures and training already use, so an under-16 cannot answer for
 * themselves and a 16-17 year old can only with recorded guardian consent --
 * and upserts onto the partial unique index on (event_id, player_id).
 *
 * Repeated clicks therefore UPDATE the single canonical response. They never
 * accumulate rows, and they never touch another day of a multi-day event,
 * because the row is keyed on the EVENT's own id rather than on any day the
 * calendar happens to project it onto.
 *
 * This file adds no authorization. Everything above is enforced in the
 * database, where a forged request cannot route around it.
 */

export type EventAttendanceResult = { error?: string }

/**
 * Errors a person should actually read.
 *
 * Anything else is logged server-side and replaced, so a Postgres message
 * never becomes a description of the schema in somebody's browser.
 */
const SAFE_MESSAGES = [
  "Unknown response.",
  "Event not found.",
  "That player is not involved in this event.",
  "You cannot respond for this player.",
]

export async function setEventAttendanceResponse(
  eventId: string,
  playerId: string,
  status: "ATTENDING" | "CANNOT_ATTEND" | "UNSURE"
): Promise<EventAttendanceResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("respond_to_event_attendance", {
    p_event_id: eventId,
    p_player_id: playerId,
    p_status: status,
  })

  if (error) {
    if (SAFE_MESSAGES.some((m) => error.message.startsWith(m))) return { error: error.message }
    console.error("Event attendance RPC raw error (sanitized before returning to browser):", error.message)
    return { error: "Something went wrong. Please try again." }
  }

  revalidatePath(`/events/${eventId}`)
  revalidatePath("/calendar")
  return {}
}
