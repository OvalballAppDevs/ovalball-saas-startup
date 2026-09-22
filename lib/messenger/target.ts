import type { Database } from "@/types/database.types"

/**
 * WHICH CONVERSATION AN ATTACHMENT IS GOING INTO.
 *
 * The route's `kind` segment and the database's `message_target_type` are two names for the same
 * three containers, plus one -- "club" -- that the canonical attachment model still does not carry.
 * Mapping them in one place is what stops a caller inventing the mapping again: the previous version
 * lived inline in `sendFixtureMessageWithAttachment`, wrote `r/<direct-conversation-id>/…` for a direct
 * message because the kind was not "fixture", passed null for both fixture ids, and was then refused by
 * the server. The `+` menu was on screen the whole time.
 */
export type MessageTarget = Database["public"]["Enums"]["message_target_type"]

export type AttachmentSupport =
  | { supported: true; target: MessageTarget; storagePrefix: "f" | "r" | "d" }
  | { supported: false; reason: string }

export function attachmentTarget(kind: "fixture" | "request" | "club" | "direct"): AttachmentSupport {
  if (kind === "fixture") return { supported: true, target: "fixture", storagePrefix: "f" }
  if (kind === "request") return { supported: true, target: "fixture_request", storagePrefix: "r" }
  if (kind === "direct") return { supported: true, target: "direct", storagePrefix: "d" }
  // A club conversation reuses fixture_messages for text but has no attachment target of its own: the
  // per-club message policy and the document-library resolution are still keyed off a fixture. Saying
  // so is the honest answer until that is its own slice.
  return { supported: false, reason: "Attachments aren't available in club conversations yet." }
}
