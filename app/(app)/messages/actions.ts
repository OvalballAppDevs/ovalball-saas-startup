"use server"

import { revalidatePath } from "next/cache"

import { createSupportTicket } from "@/app/(app)/support/actions"
import { createClient } from "@/lib/supabase/server"

export type MessageActionResult = { ok: true } | { ok: false; error: string }

export type ConversationKind = "request" | "fixture" | "club" | "direct"

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
    // The caption, or nothing. The schema now models an image with no words
    // as an image with no words -- so an empty caption is stored as an empty
    // caption rather than as the sentence "Attached: IMG_4821.HEIC", which is
    // not something the sender ever said.
    p_body: (body.trim() || null) as unknown as string,
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
    // The seventh container. RLS decides whether this insert is allowed,
    // exactly as it does for the other four -- the CHECK constraint keeps
    // it to one container, so naming it here cannot widen anything.
    direct_conversation_id: kind === "direct" ? id : null,
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
    // A direct message raises its own notification type, so clearing only
    // new_fixture_message left a direct conversation looking unread after it
    // had been read in the panel.
    .eq("type", kind === "direct" ? "new_direct_message" : "new_fixture_message")
    .is("read_at", null)
    .contains("data", kind === "request" ? { fixture_request_id: id } : kind === "fixture" ? { fixture_id: id } : { club_conversation_id: id })
}

/**
 * Report a message into the existing Site Admin message-moderation
 * workflow (report_fixture_message() -- Overnight Master Pass Section 83:
 * "do not create a duplicate ticket system," so this reuses the RPC and
 * report_status column /admin/messages already reads, never a new table).
 */
export type ReportMessageResult = { ok: true; reference: string | null } | { ok: false; error: string }

/**
 * REPORTING A MESSAGE RAISES A REAL SUPPORT CASE.
 *
 * report_fixture_message already existed and already did the safety-critical
 * half: it checks the reporter can actually see the conversation, refuses an
 * empty reason, and stamps reported_by / reported_at / report_reason /
 * report_status onto the message row. What it never did was tell anybody.
 * A report went into a column and waited to be noticed.
 *
 * It now also opens a ticket in Ovalball's existing Support system -- the same
 * create_support_ticket every other support request goes through, in the
 * `messages` category, so a reported message lands in the queue Site Admins
 * already work. No second support system, and no new schema.
 *
 * THE EVIDENCE IS READ FROM THE DATABASE, NEVER FROM THE BROWSER. The only
 * thing the client supplies is a message id and the reporter's own words. The
 * body, the sender, the timestamp and the conversation are re-read here from
 * the canonical row under the reporter's own RLS -- so a report cannot be made
 * to quote text that was never sent, and cannot reference a message the
 * reporter has no access to (report_fixture_message rejects that first).
 *
 * The durable evidence is the fixture_messages row itself: reporting does not
 * copy the body anywhere, and a later soft delete sets deleted_at without ever
 * clearing it. The ticket carries the message id so an investigator can find
 * that row after the message has vanished from the conversation.
 */
export async function reportMessage(messageId: string, reason: string): Promise<ReportMessageResult> {
  const supabase = await createClient()

  // 1. The safety check and the report stamp, unchanged.
  const { error } = await supabase.rpc("report_fixture_message", { p_message_id: messageId, p_reason: reason })
  if (error) return { ok: false, error: error.message }

  // 2. The canonical evidence, re-read server-side. Access was proven by the
  //    call above; this read is under the reporter's own RLS as well.
  const { data: evidence } = await supabase
    .from("fixture_messages")
    .select("id, body, created_at, kind, fixture_id, fixture_request_id, conversation_id, sender_user_id, deleted_at")
    .eq("id", messageId)
    .maybeSingle()

  const ticket = await createSupportTicket({
    category: "messages",
    subject: "Reported message",
    description: [
      `A message was reported from Messenger.`,
      ``,
      `Reason given by the reporter:`,
      reason.trim(),
      ``,
      `--- Evidence (resolved server-side from the message record) ---`,
      `Message id: ${evidence?.id ?? messageId}`,
      evidence?.conversation_id ? `Conversation id: ${evidence.conversation_id}` : null,
      evidence?.sender_user_id ? `Sender user id: ${evidence.sender_user_id}` : null,
      evidence?.created_at ? `Sent at: ${evidence.created_at}` : null,
      evidence?.deleted_at ? `Already deleted at: ${evidence.deleted_at}` : null,
      ``,
      `Message content at the time of reporting:`,
      evidence?.body ?? "(the message record could not be read back)",
      ``,
      `The message record is retained and remains readable to Support after the`,
      `message is deleted from the conversation.`,
    ]
      .filter((line) => line !== null)
      .join("\n"),
    sourceRoute: "/messages",
    relatedFixtureId: evidence?.fixture_id ?? null,
    relatedFixtureRequestId: evidence?.fixture_request_id ?? null,
  })

  // The report itself succeeded even if the ticket did not; say so honestly
  // rather than claiming a case exists that does not.
  if (!ticket.ok) {
    return {
      ok: false,
      error: "The message was reported, but a Support case could not be opened. Please contact Ovalball Support.",
    }
  }

  return { ok: true, reference: ticket.reference }
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
