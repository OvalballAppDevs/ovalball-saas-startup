import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/** Unread support_ticket_update notifications for the header Support icon. */
export async function getSupportUnreadCount(supabase: SupabaseClient<Database>, userId: string): Promise<number> {
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "support_ticket_update")
    .is("read_at", null)
  return count ?? 0
}

/**
 * New/unreviewed ticket count for the Site Admin nav badge -- RLS on
 * support_tickets already scopes this to what the caller can actually
 * see, so a non-support-capable Site Admin profile gets 0 here rather
 * than a number that doesn't match what they can open.
 */
export async function getNewSupportTicketCount(supabase: SupabaseClient<Database>): Promise<number> {
  const { count } = await supabase
    .from("support_tickets")
    .select("id", { count: "exact", head: true })
    .eq("status", "new")
  return count ?? 0
}
