"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type MessageActionResult = { ok: true } | { ok: false; error: string }

export type ConversationKind = "request" | "fixture" | "club"

const ATTACHMENT_MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024

export type SendAttachmentResult = { ok: true } | { ok: false; error: string }

/**
 * Upload happens first (to a random, non-guessable, safe generated storage
 * path -- the original filename never becomes part of it), then the
 * message+attachment metadata are created together by the one RPC that can
 * see both. If the RPC fails, we attempt a best-effort remove() of the
 * upload -- storage.objects' own protect_delete trigger means an ordinary
 * authenticated caller usually can't actually delete it (only the Storage
 * API's own internal role can), so in practice this fails silently and the
 * object is left behind. That's the deliberate "explicit recoverable
 * state" from the brief rather than active cleanup: the object is inert
 * (no fixture_message_attachments row ever references it, so it can never
 * appear in any UI), never a message that pretends to have an attachment
 * it doesn't -- upload-then-link, never link-then-upload.
 */
export async function sendFixtureMessageWithAttachment(
  kind: ConversationKind,
  id: string,
  body: string,
  file: File
): Promise<SendAttachmentResult> {
  // Deliberately deferred for this pass -- club conversations reuse the
  // fixture_messages table and its RLS, but the attachment/document-
  // library/contact-card RPCs are still coupled to
  // internal.resolve_my_fixture_club_id(fixture_id, fixture_request_id)
  // and per-club message-policy resolution keyed off a fixture. Widening
  // that whole surface is a real follow-up, not a five-line change --
  // reported as a known gap rather than silently pretending it works.
  if (kind === "club") return { ok: false, error: "Attachments aren't available in club conversations yet." }

  const extension = ATTACHMENT_MIME_EXTENSIONS[file.type]
  if (!extension) return { ok: false, error: "Unsupported file type. Attach a PDF, JPEG, PNG, or WEBP." }
  if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, error: "Attachments must be 2MB or smaller." }
  if (file.size <= 0) return { ok: false, error: "That file appears to be empty." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const storagePath = `${kind === "fixture" ? "f" : "r"}/${id}/${crypto.randomUUID()}.${extension}`

  const bytes = await file.arrayBuffer()
  const { error: uploadError } = await supabase.storage
    .from("fixture-attachments")
    .upload(storagePath, bytes, { contentType: file.type, upsert: false })
  if (uploadError) return { ok: false, error: "Couldn't upload that file -- please try again." }

  const { error: rpcError } = await supabase.rpc("create_fixture_message_with_attachment", {
    // Args are declared nullable uuid in SQL (exactly one of fixture_id/
    // fixture_request_id is null, matching the messages table's own
    // num_nonnulls(...) = 1 check) -- the generated type just doesn't
    // capture that.
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
    p_body: body.trim() || `Attached: ${file.name}`,
    p_storage_path: storagePath,
    p_original_filename: file.name,
    p_mime_type: file.type,
    p_size_bytes: file.size,
  })
  if (rpcError) {
    await supabase.storage.from("fixture-attachments").remove([storagePath])
    return { ok: false, error: rpcError.message }
  }

  revalidatePath(`/messages/${kind}/${id}`)
  revalidatePath("/messages")
  return { ok: true }
}

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
    club_conversation_id: kind === "club" ? id : null,
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
    .contains("data", kind === "request" ? { fixture_request_id: id } : kind === "fixture" ? { fixture_id: id } : { club_conversation_id: id })
}

/**
 * Report a message into the existing Site Admin message-moderation
 * workflow (report_fixture_message() -- Overnight Master Pass Section 83:
 * "do not create a duplicate ticket system," so this reuses the RPC and
 * report_status column /admin/messages already reads, never a new table).
 */
export async function reportMessage(messageId: string, reason: string): Promise<MessageActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("report_fixture_message", { p_message_id: messageId, p_reason: reason })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Tombstone your own message (Section 85/87) -- never a hard delete,
 * never another person's message.
 */
export async function deleteOwnMessage(messageId: string): Promise<MessageActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("soft_delete_own_message", { p_message_id: messageId })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
