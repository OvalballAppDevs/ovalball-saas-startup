import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

/**
 * VOICE NOTES, ON THE CANONICAL ATTACHMENT MODEL.
 *
 * A voice note is an attachment like any other: uploaded into the conversation's own folder of the private
 * `fixture-attachments` bucket (whose storage policy is the conversation's own authority), then linked by
 * `create_voice_message`, which applies exactly the attachment authority and the club's attachment policy. A new
 * kind of message is not a new permission: who may send a voice note is exactly who may send a photo.
 *
 * AAC in an .m4a file, at most two minutes and two megabytes; the server checks all three again. The file name is
 * the send reference itself, so a retry re-uses the same object rather than leaving a second one behind, and the
 * send is idempotent on that reference.
 *
 * NOTHING PUBLIC. Playback is a short-lived signed URL made by the reader's own session, through the same reader
 * that signs every other attachment.
 */

export const VOICE_MIME = "audio/mp4"
export const VOICE_MAX_MS = 120_000
export const VOICE_MIN_MS = 500
export const VOICE_MAX_BYTES = 2 * 1024 * 1024

export type VoiceTarget = "fixture" | "fixture_request" | "direct"

const PREFIX: Record<VoiceTarget, "f" | "r" | "d"> = { fixture: "f", fixture_request: "r", direct: "d" }

export function voiceStoragePath(target: VoiceTarget, targetId: string, clientMessageId: string): string {
  return `${PREFIX[target]}/${targetId}/${clientMessageId}.m4a`
}

/** Refused before a byte is uploaded, with the reason said plainly. */
export function validateVoiceNote(durationMs: number, sizeBytes: number): string | null {
  if (!Number.isFinite(durationMs) || durationMs < VOICE_MIN_MS) return "That was too short to send. Hold on a moment longer."
  if (durationMs > VOICE_MAX_MS) return "Voice notes can be up to two minutes long."
  if (sizeBytes <= 0) return "That recording appears to be empty."
  if (sizeBytes > VOICE_MAX_BYTES) return "That recording is too large to send."
  return null
}

/** "0:07", "1:42" -- the way every player shows a short recording. */
export function formatVoiceDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

export type SendVoiceResult = { ok: true; messageId: string } | { ok: false; message: string; retryable: boolean }

export async function sendVoiceMessage(
  supabase: SupabaseClient<Database>,
  input: { target: VoiceTarget; targetId: string; bytes: ArrayBuffer; durationMs: number; clientMessageId: string }
): Promise<SendVoiceResult> {
  const refusal = validateVoiceNote(input.durationMs, input.bytes.byteLength)
  if (refusal) return { ok: false, message: refusal, retryable: false }
  const path = voiceStoragePath(input.target, input.targetId, input.clientMessageId)

  const { error: uploadError } = await supabase.storage.from("fixture-attachments").upload(path, input.bytes, { contentType: VOICE_MIME, upsert: false })
  // An object already at this path is this same voice note from an earlier attempt -- carry on and link it.
  const duplicate = uploadError && /exist|duplicate|409/i.test(`${uploadError.message} ${(uploadError as { statusCode?: string }).statusCode ?? ""}`)
  if (uploadError && !duplicate) {
    return { ok: false, message: "Voice note not sent. Check your connection and try again.", retryable: true }
  }

  const { data, error } = await supabase.rpc("create_voice_message", {
    p_target_type: input.target,
    p_target_id: input.targetId,
    p_storage_path: path,
    p_size_bytes: input.bytes.byteLength,
    p_duration_ms: Math.round(input.durationMs),
    p_client_message_id: input.clientMessageId,
  })
  if (error || !data) {
    const refused = error?.code === "42501" || error?.code === "22023"
    // A refusal will be refused again; the uploaded object is removed so nothing inert is left in the folder.
    if (refused) await supabase.storage.from("fixture-attachments").remove([path])
    return {
      ok: false,
      retryable: !refused,
      message: refused ? (error?.code === "22023" ? (error.message ?? "That voice note can't be sent.") : "This conversation isn't available.") : "Voice note not sent. Check your connection and try again.",
    }
  }
  return { ok: true, messageId: data }
}
