"use server"

import { revalidatePath } from "next/cache"

import {
  markAllNotificationsRead as markAllRead,
  markNotificationRead as markRead,
} from "@ovalball/contracts/notifications/feed"

import { createClient } from "@/lib/supabase/server"

/**
 * THE SAME READ MUTATION THE APP USES (CA-M8). `mark_notification_read` and
 * `mark_all_notifications_read` are self-only and touch read_at alone -- the
 * boundary the table's policy and its read-only trigger already draw -- and
 * "all" means the bell's own rows: Messenger clears its own unread state
 * through its conversations, exactly as before. Neither touches the thing a
 * notification was about. READ IS NOT RESOLVED.
 */
export async function markNotificationRead(id: string): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  await markRead(supabase, id).catch(() => false)
  revalidatePath("/", "layout")
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  await markAllRead(supabase).catch(() => 0)
  revalidatePath("/", "layout")
}
