import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"

/**
 * WITHDRAWING YOUR OWN WORDS, AND REPORTING SOMEBODY ELSE'S.
 *
 * Both are on the website and both were missing here, which mattered more than it looks: a club
 * messaging product used by parents and coaches in which a message cannot be withdrawn or reported from
 * a phone is a safeguarding surface with a hole in it, because the phone is where these conversations
 * actually happen.
 *
 * NEITHER IS A CLIENT DECISION. `soft_delete_own_message` refuses a message that is not yours and one
 * that is already deleted; `report_message` refuses your own message and a conversation you cannot see.
 * The app renders the two controls from `canDelete` and `canReport` on the canonical message -- the
 * SERVER's answer, carried on the row -- and the RPC checks again regardless, so a modified client gains
 * nothing by showing a control it should not have.
 *
 * A DELETE IS A TOMBSTONE, NOT AN ERASURE. The row stays and the body becomes the tombstone text, so a
 * conversation does not silently lose a message somebody replied to, and a report already made still
 * points at something.
 */

export async function deleteOwnMessage(
  supabase: SupabaseClient<Database>,
  messageId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("soft_delete_own_message", { p_message_id: messageId })
  if (error) return { ok: false, message: error.message || "Couldn't delete that message." }
  return { ok: true }
}

export async function reportMessage(
  supabase: SupabaseClient<Database>,
  messageId: string,
  reason: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  // THE REASON IS REQUIRED BY THE PLATFORM, so it is asked for rather than defaulted. A report reading
  // "Reported from mobile" is a report nobody can act on, and it is the moderator who pays for that.
  const trimmed = reason.trim()
  if (!trimmed) return { ok: false, message: "Say briefly what's wrong, so a moderator can act on it." }
  const { error } = await supabase.rpc("report_message", { p_message_id: messageId, p_reason: trimmed })
  if (error) return { ok: false, message: error.message || "Couldn't report that message." }
  return { ok: true }
}
