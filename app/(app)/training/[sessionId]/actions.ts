"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/**
 * The two things a participant owns on a training session.
 *
 * ONE WRITE, AND IT IS NOT NEW. This calls the canonical
 * public.respond_to_training_attendance, which already existed and already
 * does the right things: it refuses a cancelled session, refuses a player who
 * is not on the team or group training, resolves the responder's authority
 * through internal.resolve_attendance_response_source -- the SAME safeguarding
 * rule fixtures use, so an under-16 cannot answer for themselves and a 16-17
 * year old can only with recorded guardian consent -- and upserts onto the
 * partial unique index on (training_session_id, player_id).
 *
 * That last part is the one section 14 asks about: repeated clicks UPDATE the
 * single canonical response. They never accumulate rows, and they never touch
 * next Tuesday's session, because the row is keyed on this occurrence's own
 * id rather than on the recurrence that generated it.
 *
 * This file adds NO authorization of its own. Everything above is enforced in
 * the database, where a forged request cannot route around it.
 */

export type TrainingAttendanceResult = { ok: true } | { ok: false; message: string }

/**
 * Errors a person should actually read.
 *
 * Anything else is logged server-side and replaced, so a Postgres message
 * never becomes a description of the schema in somebody's browser.
 */
const SAFE_PREFIXES = [
  "Invalid attendance status",
  "Training session not found",
  "This training session has been cancelled",
  "This player is not associated",
  "You are not authorized",
  "Age could not be verified",
  "Guardian consent for self-attendance",
  "Players under 16",
]

function toPublicError(message: string): string {
  if (SAFE_PREFIXES.some((p) => message.startsWith(p))) return message
  console.error("Training attendance RPC raw error (sanitized before returning to browser):", message)
  return "Something went wrong. Please try again."
}

export async function setTrainingAttendanceResponse(
  sessionId: string,
  playerId: string,
  status: "ATTENDING" | "CANNOT_ATTEND" | "UNSURE"
): Promise<TrainingAttendanceResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "You must be signed in to respond." }

  const { error } = await supabase.rpc("respond_to_training_attendance", {
    p_training_session_id: sessionId,
    p_player_id: playerId,
    p_status: status,
  })
  if (error) return { ok: false, message: toPublicError(error.message) }

  // Every surface that shows an answer, or a count derived from one.
  revalidatePath(`/training/${sessionId}`)
  revalidatePath("/agenda")
  revalidatePath("/calendar")
  revalidatePath("/dashboard")
  return { ok: true }
}
