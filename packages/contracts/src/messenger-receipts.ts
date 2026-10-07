import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

/**
 * READ RECEIPTS, AS THE SERVER KNOWS THEM.
 *
 * A message is "read" when the person it was sent to opened the conversation as far as it -- recorded by
 * `mark_thread_read`, which only the reader can call, only through a message they can read. Nothing here is
 * inferred on the device. There is no "delivered": Ovalball cannot know that a phone received anything, so it
 * does not claim to.
 *
 * Receipts are answered only for the signed-in person's OWN messages (`message_receipts`), so nobody learns who
 * read somebody else's words. A direct conversation says "Read"; a group says "Read by N" -- a count, never a
 * list of names -- because "everyone has read it" is not something a single tick can honestly say. A block in
 * either direction hides a direct conversation's receipts entirely.
 *
 * READ IS NOT RESOLVED. Reading a message never completes, answers or dismisses anything it was about.
 */

export interface MessageReceipt {
  readCount: number
  /** When it was first read -- the only reader, in a direct conversation. */
  firstReadAt: string | null
  isDirect: boolean
}

export type ReceiptState = "sent" | "read"

/** I have read this conversation up to and including this message. Failure is silent: it is retried on the next open. */
export async function markThreadRead(supabase: SupabaseClient<Database>, messageId: string): Promise<number> {
  const { data, error } = await supabase.rpc("mark_thread_read", { p_message_id: messageId })
  if (error) return 0
  return typeof data === "number" ? data : 0
}

/** Receipts for my own messages among these ids, keyed by message id. Ids that are not mine simply have none. */
export async function loadReceipts(supabase: SupabaseClient<Database>, messageIds: readonly string[]): Promise<Map<string, MessageReceipt>> {
  const result = new Map<string, MessageReceipt>()
  const ids = [...new Set(messageIds)].slice(-200)
  if (ids.length === 0) return result
  const { data, error } = await supabase.rpc("message_receipts", { p_message_ids: ids })
  if (error || !data) return result
  for (const row of data) {
    result.set(row.message_id, { readCount: row.read_count ?? 0, firstReadAt: row.first_read_at ?? null, isDirect: row.is_direct === true })
  }
  return result
}

export function receiptState(receipt: MessageReceipt | null | undefined): ReceiptState {
  return receipt && receipt.readCount > 0 ? "read" : "sent"
}

/** The words beside a tick: "Sent", "Read", or in a group "Read by 3". */
export function receiptLabel(receipt: MessageReceipt | null | undefined): string {
  if (!receipt || receipt.readCount === 0) return "Sent"
  return receipt.isDirect ? "Read" : `Read by ${receipt.readCount}`
}

/** "7 Oct 2026, 10:33" in UK time, for Message Info. */
export function receiptTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const day = at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
  return `${day}, ${time}`
}
