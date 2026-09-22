import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"

/**
 * ATTACHMENTS, AGAINST THE CANONICAL MODEL -- INCLUDING WHERE IT STOPS.
 *
 * ARCHAEOLOGY FIRST, AND IT CHANGED THE SCOPE. `create_fixture_message_with_attachment` takes
 * `p_fixture_id` and `p_fixture_request_id` and nothing else; `share_fixture_document` is the same
 * shape. There is no direct-conversation or club-conversation parameter on either, and the website
 * says so out loud -- `sendFixtureMessageWithAttachment` returns "Attachments aren't available in club
 * conversations yet" and never offers them on a direct thread at all.
 *
 * So ATTACHMENTS ARE A FIXTURE-AND-REQUEST CAPABILITY on this platform, for both clients. Building
 * them for a direct conversation on mobile would mean either a mobile-only insert path around the
 * RPC -- which is exactly what must not be built -- or widening the canonical RPC, which is platform
 * work that has to serve the website too. `canAttach` names that boundary rather than hiding it, and
 * the interface explains it rather than showing a button that fails.
 *
 * THE LIMITS ARE THE WEB'S, recovered rather than chosen: PDF, JPEG, PNG and WEBP; two megabytes;
 * the private `fixture-attachments` bucket; a random storage path that never contains the original
 * filename; upload first, then link, so a message never claims an attachment it does not have.
 */

/** Recovered from `app/(app)/messages/actions.ts`. A mobile-only extension here would be a weakening. */
export const ATTACHMENT_MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024

export type AttachableKind = "fixture" | "request"

/**
 * Whether this conversation can carry an attachment at all.
 *
 * Not a permission -- the server decides that -- but a statement about what the canonical model
 * supports. A person is told which it is.
 */
export function attachmentSupport(kind: string): { canAttach: boolean; reason: string | null } {
  if (kind === "fixture" || kind === "request") return { canAttach: true, reason: null }
  if (kind === "direct") {
    return {
      canAttach: false,
      reason: "Attachments aren't available in direct messages yet — they work on fixture conversations.",
    }
  }
  return { canAttach: false, reason: "Attachments aren't available in club conversations yet." }
}

export interface PendingAttachment {
  /** Local, so the tray can render and remove before anything is uploaded. */
  key: string
  name: string
  mimeType: string
  sizeBytes: number
  /** A local file URI for an image, so a thumbnail can be shown before sending. */
  uri: string
  state: "ready" | "uploading" | "failed"
  error?: string | null
}

/**
 * Everything refused BEFORE a byte is uploaded, with the reason said plainly.
 *
 * A client-side extension is not validation -- the server checks the type again -- but refusing here
 * means somebody is told immediately rather than after a two-megabyte upload.
 */
export function validateAttachment(file: { name: string; mimeType: string; sizeBytes: number }): string | null {
  if (!ATTACHMENT_MIME_EXTENSIONS[file.mimeType]) {
    return "Unsupported file type. Attach a PDF, JPEG, PNG or WEBP."
  }
  if (file.sizeBytes > MAX_ATTACHMENT_BYTES) return "Attachments must be 2MB or smaller."
  if (file.sizeBytes <= 0) return "That file appears to be empty."
  return null
}

/**
 * Upload, then link -- never the other way round.
 *
 * The storage path is random and carries no part of the original filename, which is the web's rule
 * and the reason a private attachment's path cannot be guessed from what it is called. The RPC then
 * creates the message and the attachment row together, because it is the only thing that can see
 * both; if it refuses, the uploaded object is left inert -- nothing references it, so it can never
 * appear anywhere -- exactly as the website leaves it.
 */
export async function sendWithAttachment(
  supabase: SupabaseClient<Database>,
  kind: AttachableKind,
  id: string,
  body: string,
  file: { name: string; mimeType: string; sizeBytes: number; bytes: ArrayBuffer }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const refusal = validateAttachment(file)
  if (refusal) return { ok: false, message: refusal }

  const extension = ATTACHMENT_MIME_EXTENSIONS[file.mimeType]
  const storagePath = `${kind === "fixture" ? "f" : "r"}/${id}/${randomId()}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from("fixture-attachments")
    .upload(storagePath, file.bytes, { contentType: file.mimeType, upsert: false })
  if (uploadError) return { ok: false, message: "Couldn't upload that file. Try again." }

  const { error } = await supabase.rpc("create_fixture_message_with_attachment", {
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
    // An attachment with no caption is an attachment with no caption -- the schema models that, and
    // inventing "Attached: IMG_4821" would put words in somebody's mouth.
    p_body: (body.trim() || null) as unknown as string,
    p_storage_path: storagePath,
    p_original_filename: file.name,
    p_mime_type: file.mimeType,
    p_size_bytes: file.sizeBytes,
  })
  if (error) {
    await supabase.storage.from("fixture-attachments").remove([storagePath])
    return { ok: false, message: "Couldn't attach that file. Try again." }
  }
  return { ok: true }
}

/**
 * Share a document that is ALREADY in Ovalball, by reference.
 *
 * Nothing is copied or re-uploaded: `share_fixture_document` writes a reference row, so the
 * conversation points at the club's own document and a later revision is not orphaned. The function
 * checks three things the app deliberately does not: that the sender may post in this conversation,
 * that the club's message policy allows library sharing at all, and that the sender may view that
 * document's library.
 */
export async function shareDocument(
  supabase: SupabaseClient<Database>,
  kind: AttachableKind,
  id: string,
  documentId: string,
  note: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc("share_fixture_document", {
    p_fixture_id: (kind === "fixture" ? id : null) as unknown as string,
    p_fixture_request_id: (kind === "request" ? id : null) as unknown as string,
    p_document_id: documentId,
    p_note: (note.trim() || null) as unknown as string,
  })
  if (error) {
    // The RPC's own refusals are about the SHARE and are worth showing: "sharing documents from the
    // library is turned off for your club" is something a person can act on.
    return { ok: false, message: error.message || "Couldn't share that document." }
  }
  return { ok: true }
}

/** A path segment that reveals nothing. `crypto.randomUUID` is not in every React Native runtime. */
function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}
