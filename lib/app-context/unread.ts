import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * THE ONE UNREAD READ.
 *
 * Every badge in the header comes from here, in one round trip, from one
 * SQL function (public.my_unread_counts). Before this, three badges ran three
 * independent queries against the same rows, and two of them counted things
 * the third was already counting -- so the bell would not go down when you
 * cleared your messages.
 *
 * The split between badges is decided in the database, from the notification
 * registry's own topic, so this file holds no list of type names and cannot
 * drift away from what a badge actually opens.
 */
export interface UnreadCounts {
  /** The bell. Everything NOT surfaced by another badge. */
  notifications: number
  /** Messenger. Every unread notification in the `messages` topic. */
  messages: number
  /** The Support control. */
  support: number
  /** Every unread notification, whichever badge shows it. Never render this as a badge. */
  total: number
}

const NONE: UnreadCounts = { notifications: 0, messages: 0, support: 0, total: 0 }

export async function getUnreadCounts(supabase: SupabaseClient<Database>): Promise<UnreadCounts> {
  const { data, error } = await supabase.rpc("my_unread_counts")
  if (error || !data) return NONE
  // The RPC returns a single row; PostgREST hands back an array for a
  // set-returning function.
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return NONE
  return {
    notifications: row.notifications ?? 0,
    messages: row.messages ?? 0,
    support: row.support ?? 0,
    total: row.total ?? 0,
  }
}
