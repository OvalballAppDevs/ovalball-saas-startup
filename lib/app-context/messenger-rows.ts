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

/** What a recipient can DO with an announcement, said in the status chip. */
const REPLY_MODE_LABEL: Record<string, string> = {
  NO_REPLY: "Announcement",
  PRIVATE_REPLY: "Reply privately",
  GROUP_DISCUSSION: "Group discussion",
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

/**
 * The caller's own announcements as inbox rows.
 *
 * Read through public.my_announcements, which is scoped to the caller's own
 * deliveries -- so this can never return somebody else's, and the inbox
 * cannot become a place the audience leaks. It also applies withdrawal in one
 * place, so a withdrawn announcement previews as withdrawn here exactly as it
 * reads when opened.
 */
async function getMyAnnouncementRows(supabase: SupabaseClient<Database>): Promise<MessengerRow[]> {
  const { data } = await supabase.rpc("my_announcements", { p_limit: 30 })

  return (data ?? []).map((a) => ({
    key: `announcement:${a.announcement_id}`,
    kind: "announcement" as const,
    href: `/messages/announcement/${a.announcement_id}`,
    // No crest: the sender label is already the identity, and borrowing a club
    // logo for a team announcement would attribute it to the wrong sender.
    logoUrl: null,
    title: a.sender_label ?? "Announcement",
    context: a.title ?? "Announcement",
    // No "Name:" prefix -- an announcement is the organisation speaking, and
    // prefixing it with a person's name would undo the sender identity.
    preview: a.body,
    status: a.withdrawn ? "withdrawn" : "sent",
    statusLabel: a.withdrawn ? "Withdrawn" : REPLY_MODE_LABEL[a.reply_mode] ?? "Announcement",
    activityAt: a.delivered_at,
    // One unread per undelivered-read announcement, counted the same way the
    // Messenger badge counts it, so the list and the badge agree.
    unreadCount: a.read_at ? 0 : 1,
  }))
}

/**
 * The caller's 1:1 conversations as inbox rows.
 *
 * Read through public.my_direct_conversations, which is scoped to threads the
 * caller is in, so this cannot surface anybody else's. Unread comes from the
 * same notification rows the Messenger badge counts, so the badge and the
 * list agree by construction rather than by coincidence.
 */
async function getMyDirectRows(supabase: SupabaseClient<Database>): Promise<MessengerRow[]> {
  const { data } = await supabase.rpc("my_direct_conversations", { p_limit: 50 })

  return (data ?? []).map((d) => ({
    key: `direct:${d.conversation_id}`,
    kind: "direct" as const,
    href: `/messages/direct/${d.conversation_id}`,
    // No crest: a direct conversation is with a person, and borrowing their
    // club's badge would attribute a private message to an organisation.
    logoUrl: null,
    title: d.other_display_name ?? "Ovalball user",
    context: "Direct message",
    preview: d.last_message_from_me ? preview("You", d.last_message_preview) : d.last_message_preview,
    status: "direct",
    statusLabel: "Direct",
    activityAt: d.last_message_at,
    unreadCount: d.unread,
  }))
}

export async function getMessengerRows(
  supabase: SupabaseClient<Database>,
  ctx: SessionContext,
  userId: string,
  { includeClubToClub }: MessengerRowsOptions
): Promise<MessengerRow[]> {
  const [conversations, clubConversations, supportConversations, announcements, directs] = await Promise.all([
    includeClubToClub ? getConversationSummaries(supabase, ctx, userId) : Promise.resolve([]),
    includeClubToClub ? getClubConversationSummaries(supabase, ctx, userId) : Promise.resolve([]),
    getMySupportConversations(supabase, userId),
    // ANNOUNCEMENTS BELONG IN THE INBOX, not only on the badge. They are
    // counted as messages (notification_types.topic_key = 'messages'), so
    // leaving them out of this list produced the one state an inbox must
    // never be in: a badge saying "1 unread message" over a list with nothing
    // in it and nowhere to tap. Deliberately NOT gated on includeClubToClub --
    // an announcement to a team's families is exactly what a parent receives.
    getMyAnnouncementRows(supabase),
    // DIRECT THREADS BELONG IN THE SAME INBOX. Not gated on
    // includeClubToClub: a 1:1 is the person's own conversation, not club-to-
    // club negotiation, and hiding it in Parent View would hide a message
    // somebody sent them personally.
    getMyDirectRows(supabase),
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
    ...announcements,
    ...directs,
  ]

  return rows.sort((a, b) => (b.activityAt ?? "").localeCompare(a.activityAt ?? ""))
}
