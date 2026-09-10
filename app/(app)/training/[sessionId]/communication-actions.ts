"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/**
 * Telling the squad about training.
 *
 * THE BROWSER SENDS A WORD, NOT A LIST. `audience` is one of four category
 * names; who those names resolve to is decided entirely inside
 * public.send_training_communication, from the canonical register. There is no
 * parameter here through which a caller could name a recipient, so a forged
 * request can pick a different category and nothing else.
 *
 * SAFEGUARDING IS NOT RE-IMPLEMENTED. The RPC resolves recipients through
 * internal.notifiable_users_for_players -- the SAME function fixtures use --
 * so an under-16 is reached through their active guardians, a 16-17 year old
 * directly only with recorded consent, and an adult on their own account. This
 * file could not weaken that if it tried.
 *
 * AUTHORITY IS NOT DECIDED HERE EITHER. The RPC requires
 * internal.can_manage_training, which since the capability separation means
 * club.training.manage or team.training.manage. A guardian or player is
 * refused with 42501 however legitimately they can open the session.
 */

export type TrainingAudience = "MESSAGE_TEAM" | "MESSAGE_ATTENDEES" | "MESSAGE_AWAITING" | "ATTENDANCE_REMINDER"

export type SendResult =
  | { ok: true; outcome: string; players: number; recipients: number }
  | { ok: false; message: string }

/** Errors a coach should actually read. Anything else is logged and replaced. */
const SAFE_PREFIXES = [
  "You must be signed in",
  "Unknown communication action",
  "This training session is not available",
  "This training session has been cancelled",
  "You are not authorized",
  "Write a message before sending",
  "That message is too long",
]

function toPublicError(message: string): string {
  if (SAFE_PREFIXES.some((p) => message.startsWith(p))) return message
  console.error("Training communication RPC raw error (sanitized before returning to browser):", message)
  return "Something went wrong. Please try again."
}

export async function sendTrainingCommunication(sessionId: string, audience: TrainingAudience, body: string | null): Promise<SendResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "You must be signed in to send a message." }

  const { data, error } = await supabase.rpc("send_training_communication", {
    p_training_session_id: sessionId,
    p_action: audience,
    // The generated type makes the default-valued argument optional rather
    // than nullable; a reminder legitimately carries no body.
    p_body: body ?? undefined,
  })
  if (error) return { ok: false, message: toPublicError(error.message) }

  const row = (data as Record<string, unknown>[] | null)?.[0]
  revalidatePath(`/training/${sessionId}`)
  return {
    ok: true,
    outcome: (row?.outcome as string) ?? "SENT",
    players: (row?.player_count as number) ?? 0,
    recipients: (row?.recipient_count as number) ?? 0,
  }
}
