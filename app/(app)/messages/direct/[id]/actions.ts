"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type DirectResult = { ok: true } | { ok: false; error: string }

/**
 * SENDING A DIRECT MESSAGE.
 *
 * The insert goes through RLS, which re-asks internal.may_direct_message on
 * every row. That is the point: authority is checked at send time, not
 * inherited from whenever the thread was opened, so a block, a policy change
 * or a lapsed relationship stops the NEXT message rather than only the next
 * thread.
 *
 * The failure text is deliberately one sentence for every cause. "This
 * conversation isn't available" covers a block in either direction, direct
 * messaging switched off, and a relationship that has lapsed -- because
 * distinguishing them would tell the sender which, and "they blocked you" is
 * exactly what must never be inferable.
 */
export async function sendDirectMessage(conversationId: string, body: string): Promise<DirectResult> {
  const trimmed = body.trim()
  if (!trimmed) return { ok: false, error: "Write a message first." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "This conversation isn't available." }

  const { error } = await supabase.from("fixture_messages").insert({
    direct_conversation_id: conversationId,
    sender_user_id: user.id,
    body: trimmed,
    kind: "message",
    content_type: "text",
  })

  if (error) return { ok: false, error: "This conversation isn't available." }

  revalidatePath(`/messages/direct/${conversationId}`)
  revalidatePath("/messages", "layout")
  return { ok: true }
}

/** Opening a thread is reading it. Failure is silent: a lingering badge is a nuisance, interrupting the reader is worse. */
export async function markDirectRead(conversationId: string): Promise<void> {
  const supabase = await createClient()
  await supabase.rpc("mark_direct_conversation_read", { p_conversation_id: conversationId })
}

/**
 * Opening (or reusing) the thread with a person. The RPC is idempotent, so a
 * double click cannot produce two threads.
 */
export async function openDirectConversation(
  otherUserId: string,
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("open_direct_conversation", { p_other_user_id: otherUserId })

  if (error || !data) return { ok: false, error: "This conversation isn't available." }

  revalidatePath("/messages", "layout")
  return { ok: true, conversationId: data }
}
