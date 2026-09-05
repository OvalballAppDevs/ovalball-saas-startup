import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

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
 * Where a notification's "view" action goes -- one place mapping every
 * type this session's triggers actually write (see the *_notifications.sql
 * migrations) to a route, so the bell never has to guess. Falls back to
 * /dashboard for a type this doesn't recognise rather than a dead link.
 */
function notificationHref(type: string, data: Record<string, unknown>): string {
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)

  switch (type) {
    case "new_fixture_message": {
      const fixtureId = str(data.fixture_id)
      const requestId = str(data.fixture_request_id)
      if (fixtureId) return `/messages/fixture/${fixtureId}`
      if (requestId) return `/messages/request/${requestId}`
      return "/messages"
    }
    case "fixture_request_received":
    case "fixture_request_accepted": {
      const requestId = str(data.fixture_request_id)
      return requestId ? `/messages/request/${requestId}` : "/fixtures"
    }
    case "partner_request_received":
    case "calendar_share_approved":
    case "calendar_share_declined":
      return "/partner-clubs"
    case "club_claim_submitted":
    case "directory_request_submitted":
    case "club_join_request_submitted":
      return "/admin/claims"
    case "club_invitation_accepted":
      return "/people"
    case "support_ticket_update": {
      const ticketId = str(data.support_ticket_id)
      return ticketId ? `/support/${ticketId}` : "/support"
    }
    case "club_claim_approved":
    case "club_claim_rejected":
      return "/dashboard"
    case "season_transition_warning":
    case "season_transition_needs_attention":
    case "season_transition_completed":
      return "/club/rollover"
    case "fixture_call_up_requested":
    case "fixture_call_up_decided":
    case "player_eligibility_approval_required":
      return "/club/player-moves"
    default:
      return "/dashboard"
  }
}

export async function getRecentNotifications(
  supabase: SupabaseClient<Database>,
  userId: string,
  limit = 8
): Promise<{ items: NotificationItem[]; unreadCount: number }> {
  const [{ data: recent }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, type, title, body, data, read_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null),
  ])

  const items: NotificationItem[] = (recent ?? []).map((n) => {
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

  return { items, unreadCount: count ?? 0 }
}
