"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import type { AttendanceStatus } from "@/lib/app-context/match-centre-data"

export type AttendanceWriteResult =
  | { ok: true }
  | { ok: false; reason: "permission_denied" | "failure"; message: string }

/**
 * The real production write -- calls Main's own respond_to_attendance RPC
 * directly (20260928200000_side_project_1_player_guardian_foundation.sql,
 * refined by 20261011070000_training_attendance.sql's shared resolver).
 * Every authorization decision (guardian/self/age/consent/cross-team) lives
 * entirely inside that one function; nothing here re-implements it.
 */
export async function setAttendanceResponse(fixtureId: string, playerId: string, status: AttendanceStatus): Promise<AttendanceWriteResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: "permission_denied", message: "You must be signed in to respond." }

  const { error } = await supabase.rpc("respond_to_attendance", { p_fixture_id: fixtureId, p_player_id: playerId, p_status: status })
  if (error) {
    return {
      ok: false,
      reason: error.code === "42501" ? "permission_denied" : "failure",
      message: error.code === "42501" ? error.message : "The attendance response could not be saved. Please try again.",
    }
  }

  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}

export type SendFixtureMessageResult = { ok: true } | { ok: false; message: string }

export async function sendFixtureMessage(fixtureId: string, body: string): Promise<SendFixtureMessageResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "You must be signed in to send a message." }
  if (!body.trim()) return { ok: false, message: "Message cannot be empty." }

  const { error } = await supabase.from("fixture_messages").insert({ fixture_id: fixtureId, sender_user_id: user.id, body: body.trim() })
  if (error) return { ok: false, message: "The message could not be sent. Please try again." }

  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}
