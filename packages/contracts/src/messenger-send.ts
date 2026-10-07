import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

/**
 * SENDING ONE MESSAGE, ONCE.
 *
 * Every text message from either client goes through `public.send_conversation_message`, which is
 * SECURITY INVOKER: the insert still passes the per-container RLS policy, so the RPC adds no authority
 * a direct insert did not have. What it adds is that a send is IDEMPOTENT. The client chooses the id
 * of the message before it is sent, and the server keeps one row per (sender, client id) -- so a
 * retry after a dropped connection, a double tap, or a quick reply from a lock-screen notification
 * that fires twice all produce exactly one message.
 *
 * THE ID IS CHOSEN ONCE PER MESSAGE, NOT PER ATTEMPT. A retry must reuse the id of the attempt it is
 * retrying, or it is a second message. `newClientMessageId` exists so every caller makes ids the same
 * way; holding on to it across attempts is the caller's job.
 */

export type ConversationSendKind = "fixture" | "request" | "club" | "team" | "safeguarding" | "direct"

export interface SendConversationMessageInput {
  kind: ConversationSendKind
  /** The container's own id: the fixture, request, club conversation, team, safeguarding conversation or direct conversation. */
  targetId: string
  body: string
  clientMessageId: string
  /** A message in the same conversation. The server refuses a reply to anything else. */
  replyToMessageId?: string | null
}

export type SendConversationMessageResult = { ok: true; messageId: string } | { ok: false; message: string; retryable: boolean }

/**
 * A version-4 UUID for a message about to be sent.
 *
 * `crypto.randomUUID` is present in every browser Ovalball supports and in Hermes on the SDK the
 * mobile app uses. The fallback exists only so a missing global is a usable id rather than a crash;
 * it still draws from `crypto.getRandomValues` where that exists.
 */
export function newClientMessageId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c && typeof c.randomUUID === "function") return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * A send reference DERIVED from something that identifies one intended message -- a notification and
 * the action taken on it -- so the same action delivered twice (iOS may hand an action to the app more
 * than once) is still one message. Version-4 shaped; not a secret, only a stable name.
 */
export function clientMessageIdFrom(seed: string): string {
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b].map((start, lane) => {
    let h = start ^ (lane * 0x27d4eb2d)
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
      h ^= h >>> 13
    }
    return (h >>> 0).toString(16).padStart(8, "0")
  })
  const hex = words.join("").split("")
  hex[12] = "4"
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  const s = hex.join("")
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

/**
 * Whether a failure is worth retrying with the same id.
 *
 * A refusal (no authority, a closed thread, a reply to the wrong conversation) will be refused again,
 * so offering Retry would be a button that cannot work. Only a failure that never reached a decision
 * -- the network, a timeout, the server being briefly unavailable -- is retryable.
 */
export function isRetryableSendError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  const code = error.code ?? ""
  if (code === "42501" || code === "22023" || code === "23514" || code === "P0001" || code.startsWith("PGRST")) return false
  if (code === "" || code === "08006" || code === "57014" || code === "40001") return true
  return /network|fetch|timeout|connection|abort/i.test(error.message ?? "")
}

function refusalSentence(error: { code?: string | null; message?: string | null }): string {
  if (error.code === "22023" && /reply/i.test(error.message ?? "")) return "You can only reply to a message in this conversation."
  if (error.code === "22023") return "Write a message first."
  // UNDIFFERENTIATED ON PURPOSE: a block, a lapsed relationship and messaging switched off must read alike.
  return "This conversation isn't available."
}

/** How long a send may wait for the server before it is reported as not sent. */
export const SEND_TIMEOUT_MS = 15_000

export async function sendConversationMessage(
  supabase: SupabaseClient<Database>,
  input: SendConversationMessageInput,
  timeoutMs: number = SEND_TIMEOUT_MS
): Promise<SendConversationMessageResult> {
  const body = input.body.trim()
  if (!body) return { ok: false, message: "Write a message first.", retryable: false }
  // A CONNECTION THAT HANGS IS A SEND THAT FAILED, as far as the person can tell. Without a limit a
  // dropped signal leaves the message "Sending…" for ever; with one it becomes "Not sent" and Retry --
  // which reuses this reference, so a send that did reach the server is not written twice.
  const controller = typeof AbortController === "function" ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  const request = supabase.rpc("send_conversation_message", {
    p_kind: input.kind,
    p_target_id: input.targetId,
    p_body: body,
    p_client_message_id: input.clientMessageId,
    ...(input.replyToMessageId ? { p_reply_to_message_id: input.replyToMessageId } : {}),
  })
  const { data, error } = await (controller ? request.abortSignal(controller.signal) : request).then(
    (result) => result,
    (caught: unknown) => ({ data: null, error: { code: "", message: caught instanceof Error ? caught.message : "network" } })
  )
  if (timer) clearTimeout(timer)
  if (error || !data) {
    const retryable = isRetryableSendError(error)
    return {
      ok: false,
      retryable,
      message: retryable ? "Not sent. Check your connection and try again." : refusalSentence(error ?? {}),
    }
  }
  return { ok: true, messageId: data }
}
