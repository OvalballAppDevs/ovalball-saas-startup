"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/**
 * Moderation actions for the fixture conversation.
 *
 * NONE of these decide authority. Every one forwards to an RPC that re-checks
 * the caller's real capability server-side, so a control being visible in the
 * browser is presentation and never permission. The client is told what
 * happened in a sentence it can act on, and nothing else -- an RPC's raw error
 * can name a fixture, a capability or a constraint.
 */

export type ModerationResult = { ok: true } | { ok: false; error: string }

/**
 * Anybody who can see a message can report it.
 *
 * Deliberately available to every viewer of the thread, including a parent.
 * A report costs a person nothing to make and is the mechanism by which the
 * club finds out; gating it behind a role would mean the people most likely
 * to see something are the ones who cannot say so.
 */
export async function reportMessage(fixtureId: string, messageId: string, reason: string): Promise<ModerationResult> {
  const supabase = await createClient()
  const trimmed = reason.trim()
  if (trimmed.length === 0) return { ok: false, error: "Say briefly what the problem is." }
  if (trimmed.length > 500) return { ok: false, error: "That's too long — a sentence or two is enough." }

  // Slice 4F section T: report_message, not report_fixture_message. The old RPC stamped four
  // columns onto the message row, so a second person reporting the same message replaced the
  // first person's report. Match Centre and Messenger are two doors onto the same conversation,
  // so they have to report through the same one.
  const { error } = await supabase.rpc("report_message", { p_message_id: messageId, p_reason: trimmed })
  if (error) {
    console.error("report_message failed:", error.message)
    return { ok: false, error: "We couldn't report that message. Please try again." }
  }
  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}

/** Removing your own message. Soft delete: the row survives, the content stops being shown. */
export async function deleteOwnMessage(fixtureId: string, messageId: string): Promise<ModerationResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("soft_delete_own_message", { p_message_id: messageId })
  if (error) {
    console.error("soft_delete_own_message failed:", error.message)
    return { ok: false, error: "We couldn't remove that message. Please try again." }
  }
  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}

/**
 * Removing somebody else's message, as staff of one of the two clubs.
 *
 * team_delete_fixture_message checks can_manage_fixture_side on either side of
 * THIS fixture -- the same capability that governs every other staff action
 * here. It is not the platform-wide moderator path and does not touch it.
 */
export async function deleteMessageAsStaff(fixtureId: string, messageId: string): Promise<ModerationResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("team_delete_fixture_message", { p_message_id: messageId })
  if (error) {
    console.error("team_delete_fixture_message failed:", error.message)
    const message = error.message ?? ""
    if (message.startsWith("You are not authorised")) return { ok: false, error: "You can't remove messages in this fixture." }
    return { ok: false, error: "We couldn't remove that message. Please try again." }
  }
  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}

/**
 * Stopping somebody posting in this club's fixture conversations.
 *
 * The club id is resolved SERVER-SIDE from the fixture, not passed from the
 * browser: a club id in the signature would be a parameter an attacker could
 * aim at a club they do not belong to, and the capability check would then be
 * the only thing standing between them and it. Here there is nothing to aim.
 */
export async function blockUserFromMessaging(fixtureId: string, userId: string, reason: string): Promise<ModerationResult> {
  const supabase = await createClient()

  const { data: clubId, error: resolveError } = await supabase.rpc("resolve_blocking_club_for_fixture", { p_fixture_id: fixtureId })
  if (resolveError || !clubId) {
    return { ok: false, error: "You can't block someone from this fixture's conversation." }
  }

  const { error } = await supabase.rpc("block_user_from_club_messages", {
    p_club_id: clubId as string,
    p_user_id: userId,
    p_reason: reason.trim().length > 0 ? reason.trim() : undefined,
  })
  if (error) {
    console.error("block_user_from_club_messages failed:", error.message)
    const message = error.message ?? ""
    // Both are about the caller's own action and reveal nothing else.
    if (message.startsWith("A Club Admin cannot be blocked") || message.startsWith("You cannot block yourself")) {
      return { ok: false, error: message }
    }
    return { ok: false, error: "We couldn't block that person. Please try again." }
  }
  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}
