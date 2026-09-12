"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type AnnouncementActionResult = { ok: true } | { ok: false; error: string }

/**
 * EVERY ACTION HERE IS A THIN CALL TO ONE RPC.
 *
 * Deliberately so. Reply-mode rules, audience membership, the club's feature
 * policy and who may withdraw are all decided in the database, where they are
 * the same answer for the compact Messenger, the workspace, a future mobile
 * client and anybody with a session token. A server action that re-checked
 * any of them here would be a second opinion, and the second opinion is the
 * one that goes stale.
 *
 * So these functions do three things: pass the id through, turn a Postgres
 * error into a sentence a person can act on, and revalidate. No branching on
 * roles, no "if the user is staff" -- if that logic appears in this file,
 * something has been implemented in the wrong place.
 */

/** Postgres errors are for developers. This is what the person reads. */
function readableError(message: string | undefined, fallback: string): string {
  if (!message) return fallback
  // The RPCs raise sentences on purpose; anything that still looks like a
  // database internal is replaced rather than shown.
  if (/^[a-z_]+ [a-z_]+:/i.test(message) || message.includes("SQLSTATE")) return fallback
  return message
}

export async function replyToAnnouncement(
  announcementId: string,
  body: string,
): Promise<AnnouncementActionResult> {
  const trimmed = body.trim()
  if (!trimmed) return { ok: false, error: "Write a message first." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("reply_to_announcement", {
    p_announcement_id: announcementId,
    p_body: trimmed,
  })

  if (error) {
    return { ok: false, error: readableError(error.message, "Your reply could not be sent.") }
  }

  revalidatePath(`/messages/announcement/${announcementId}`)
  return { ok: true }
}

export async function markAnnouncementRead(announcementId: string): Promise<void> {
  const supabase = await createClient()
  // Failure here is deliberately silent: an unread badge that lingers is a
  // nuisance, and interrupting someone's reading to tell them about it would
  // be a worse one. The delivery row is the record; this only clears a badge.
  await supabase.rpc("mark_announcement_read", { p_announcement_id: announcementId })
}

export async function withdrawAnnouncement(announcementId: string): Promise<AnnouncementActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("withdraw_announcement", {
    p_announcement_id: announcementId,
  })

  if (error) {
    return { ok: false, error: readableError(error.message, "This announcement could not be withdrawn.") }
  }

  revalidatePath(`/messages/announcement/${announcementId}`)
  revalidatePath("/messages")
  return { ok: true }
}
