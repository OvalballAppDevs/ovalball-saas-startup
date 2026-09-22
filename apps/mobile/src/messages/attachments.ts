import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"

type MessageTarget = Database["public"]["Enums"]["message_target_type"]

/**
 * ATTACHMENTS, AGAINST THE CANONICAL MODEL.
 *
 * AN ATTACHMENT BELONGS TO A CONVERSATION, and the platform now says which one: `create_message_attachment`
 * and `share_message_document` take a typed `message_target_type` -- fixture, fixture request or direct --
 * instead of the pair of nullable fixture ids that could not name a direct conversation at all. Both
 * clients call the same RPCs; there is no mobile insert path and no service role anywhere near this.
 *
 * A DIRECT CONVERSATION IS NOT SECOND-CLASS, and it is not a loosening either. Posting an attachment
 * into one requires exactly what posting a SENTENCE into one requires -- `can_view_direct_conversation`
 * and `may_direct_message` -- so every safeguarding rule (both parties adult, blocks in either
 * direction, club and site messaging policy, discovery) governs a photo precisely as it governs a line
 * of text. The app asserts none of it; the server does, and refuses.
 *
 * THE LIMITS ARE THE PLATFORM'S, recovered rather than chosen: PDF, JPEG, PNG and WEBP; two megabytes;
 * the private `fixture-attachments` bucket; a storage path whose first two segments name the
 * conversation and whose last contains no part of the original filename; upload first, then link, so a
 * message never claims an attachment it does not have.
 *
 * ONE CONVERSATION STILL HAS NO TARGET: a club-to-club thread. Its per-club message policy and document
 * resolution are keyed off a fixture, so widening it is its own slice. Saying so is better than a
 * button that fails.
 */

/** Recovered from `app/(app)/messages/actions.ts`. A mobile-only extension here would be a weakening. */
export const ATTACHMENT_MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024

export type AttachableKind = "fixture" | "request" | "direct"

/** The route's own word for a conversation, mapped to the database's typed target. One mapping. */
const TARGET: Record<AttachableKind, MessageTarget> = {
  fixture: "fixture",
  request: "fixture_request",
  direct: "direct",
}

/** The typed target for a route kind, for the callers that need it without needing the whole module. */
export function messageTarget(kind: AttachableKind): MessageTarget {
  return TARGET[kind]
}

/** The first segment of a storage path, which is what the bucket policy reads as the container. */
const PREFIX: Record<AttachableKind, "f" | "r" | "d"> = { fixture: "f", request: "r", direct: "d" }

/**
 * Whether this conversation can carry an attachment at all.
 *
 * Not a permission -- the server decides that -- but a statement about what the canonical model
 * supports. A person is told which it is.
 */
export function attachmentSupport(kind: string): { canAttach: boolean; reason: string | null } {
  if (kind === "fixture" || kind === "request" || kind === "direct") return { canAttach: true, reason: null }
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
  // THE PATH NAMES THE CONVERSATION, and the server now checks that it does: an attachment whose path
  // points at a different conversation is refused rather than linked to a message that then cannot be
  // opened.
  const storagePath = `${PREFIX[kind]}/${id}/${randomId()}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from("fixture-attachments")
    .upload(storagePath, file.bytes, { contentType: file.mimeType, upsert: false })
  if (uploadError) return { ok: false, message: "Couldn't upload that file. Try again." }

  const { error } = await supabase.rpc("create_message_attachment", {
    p_target_type: TARGET[kind],
    p_target_id: id,
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
  const { error } = await supabase.rpc("share_message_document", {
    p_target_type: TARGET[kind],
    p_target_id: id,
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
