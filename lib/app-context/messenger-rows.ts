import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { getClubConversationSummaries, getConversationSummaries } from "@/lib/app-context/conversations"
import type { SessionContext } from "@/lib/app-context/session-context"
import type { MessengerRow } from "@/lib/messenger/view-model"
import { getMySupportConversations, SUPPORT_STATUS_LABEL } from "@/lib/support/conversations"
import type { Database } from "@/types/database.types"

/**
 * THE ONE PLACE A CONVERSATION BECOMES A ROW.
 *
 * The /messages workspace and the compact Messenger panel in the header used
 * to build their rows independently: the workspace listed fixtures, requests,
 * club messages and Support; the panel listed fixture conversations only, with
 * its own row component, its own relative-time function and its own idea of
 * what to put on the second line. Two lists claiming to be the same inbox,
 * showing different things.
 *
 * They now call this, and render what it returns through one row component. A
 * conversation reads the same wherever Ovalball shows it, and a change to how
 * it reads is one edit rather than two that drift.
 *
 * NO NEW QUERY AND NO NEW STORE. Every fetch below already existed and is
 * unchanged; this shapes what they return.
 */

const STATUS_LABELS: Record<string, string> = {
  sent: "Awaiting response",
  pending: "Awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
  counter_proposed: "Counter-proposed",
}

/** "Priya: Can we move to 10:30?" -- who said it, then what they said. */
function preview(senderName: string | null, text: string | null): string | null {
  if (!text) return null
  const cleaned = text.replace(/^Shared document:/, "Shared")
  return senderName ? `${senderName}: ${cleaned}` : cleaned
}

export interface MessengerRowsOptions {
  /**
   * Parent and Player contexts do not see club-to-club fixture negotiation --
   * an existing product decision, preserved exactly. Their own Support thread
   * is theirs and is never gated, because a support request belongs to the
   * person rather than to a club.
   */
  includeClubToClub: boolean
}

export async function getMessengerRows(
  supabase: SupabaseClient<Database>,
  ctx: SessionContext,
  userId: string,
  { includeClubToClub }: MessengerRowsOptions
): Promise<MessengerRow[]> {
  const [conversations, clubConversations, supportConversations] = await Promise.all([
    includeClubToClub ? getConversationSummaries(supabase, ctx, userId) : Promise.resolve([]),
    includeClubToClub ? getClubConversationSummaries(supabase, ctx, userId) : Promise.resolve([]),
    getMySupportConversations(supabase, userId),
  ])

  const rows: MessengerRow[] = [
    ...conversations.map((c) => ({
      key: `${c.kind}:${c.id}`,
      kind: c.kind,
      href: `/messages/${c.kind}/${c.id}`,
      logoUrl: c.opponentClubLogoUrl,
      // WHO first. "Rossendale RUFC", not "U12 A vs U12 A" -- the useful
      // first question in an inbox is who this is with.
      title: c.opponentClubName,
      // WHY, on one line: our team against theirs. The kind of conversation
      // (fixture or request) is carried by the marker on the crest, so it is
      // not also spelled out here.
      context: `${c.myTeamDisplayName} vs ${c.oppositionLabel}`,
      preview: preview(c.latestMessageSenderName, c.latestMessagePreview),
      status: c.status,
      statusLabel: STATUS_LABELS[c.status] ?? c.status,
      activityAt: c.latestMessageAt ?? c.date,
      unreadCount: c.unreadCount,
    })),
    ...clubConversations.map((c) => ({
      key: `club:${c.id}`,
      kind: "club" as const,
      href: `/messages/club/${c.id}`,
      logoUrl: c.opponentClubLogoUrl,
      title: c.opponentClubName,
      context: "Club message",
      preview: preview(c.latestMessageSenderName, c.latestMessagePreview),
      status: c.status,
      statusLabel: STATUS_LABELS[c.status] ?? c.status,
      activityAt: c.latestMessageAt ?? c.requestedAt,
      unreadCount: c.unreadCount,
    })),
    ...supportConversations.map((c) => ({
      key: `support:${c.ticketId}`,
      kind: "support" as const,
      // Straight to the canonical Support thread. Messages lists it; the
      // Support surface still owns the conversation and the reply box, so
      // there stays one place a reply can be written.
      href: `/support/${c.ticketId}`,
      logoUrl: null,
      title: "Ovalball Support",
      context: c.subject,
      preview: preview(c.latestFrom === "support" ? "Ovalball Support" : null, c.latestPreview),
      status: SUPPORT_STATUS_LABEL[c.status],
      statusLabel: SUPPORT_STATUS_LABEL[c.status],
      activityAt: c.latestAt,
      // Support has its own header control and its own unread truth; counting
      // it again on the Messenger badge would be the double count this
      // slice's foundation removed.
      unreadCount: 0,
    })),
  ]

  return rows.sort((a, b) => (b.activityAt ?? "").localeCompare(a.activityAt ?? ""))
}
