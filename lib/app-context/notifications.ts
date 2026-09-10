import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { notificationHref } from "@/lib/notifications/destinations"
import type { Database } from "@/types/database.types"

export interface NotificationItem {
  id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  readAt: string | null
  createdAt: string
  href: string
}

/**
 * WHAT THE BELL SHOWS.
 *
 * The panel and its badge used to be built from two different ideas of what
 * belongs to the bell: the badge counted 3 and the panel it opened listed 6
 * -- the three it counts plus the three messages belonging to the badge next
 * door. The number and the list contradicted each other on screen, at the
 * same moment, a few pixels apart.
 *
 * Both now read the same definition. public.my_bell_notifications returns
 * what the bell holds and public.my_unread_counts counts it, and both split
 * by the notification registry's own topic -- so this file holds no list of
 * type names, and there is nothing here that can drift from the badge.
 *
 * THE COUNT IS NOT RETURNED FROM HERE. getUnreadCounts is the one unread
 * read; returning a second count beside these items would be the same
 * duplication in a new place.
 */
export async function getRecentNotifications(
  supabase: SupabaseClient<Database>,
  limit = 8
): Promise<NotificationItem[]> {
  const { data: recent } = await supabase.rpc("my_bell_notifications", { p_limit: limit })

  return (recent ?? []).map((n) => {
    const data = (n.data as Record<string, unknown>) ?? {}
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data,
      readAt: n.read_at,
      createdAt: n.created_at,
      href: notificationHref(n.type, data),
    }
  })
}
