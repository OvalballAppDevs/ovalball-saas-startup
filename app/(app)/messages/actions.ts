"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type MessageActionResult = { ok: true } | { ok: false; error: string }

export type ConversationKind = "request" | "fixture"

/**
 * fixture_messages_insert_scoped (sender = self AND
 * can_access_fixture_conversation) is the real authorization boundary --
 * this only resolves which of the exactly-one-of columns to set from the
 * route's kind segment.
 */
export async function sendFixtureMessage(kind: ConversationKind, id: string, body: string): Promise<MessageActionResult> {
  const trimmed = body.trim()
  if (!trimmed) return { ok: false, error: "Message can't be empty." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const { error } = await supabase.from("fixture_messages").insert({
    fixture_request_id: kind === "request" ? id : null,
    fixture_id: kind === "fixture" ? id : null,
    sender_user_id: user.id,
    body: trimmed,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath(`/messages/${kind}/${id}`)
  revalidatePath("/messages")
  return { ok: true }
}

/**
 * Marks this thread's unread new_fixture_message notifications read --
 * notifications_update_self restricts a client to only ever changing
 * read_at (see enforce_notification_read_only_update), so this can't be
 * used to alter a notification's actual content.
 */
export async function markConversationRead(kind: ConversationKind, id: string): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("type", "new_fixture_message")
    .is("read_at", null)
    .contains("data", kind === "request" ? { fixture_request_id: id } : { fixture_id: id })
}
