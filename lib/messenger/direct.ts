import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ThreadMessage } from "@/lib/messenger/thread-types"

/**
 * READING A 1:1 CONVERSATION.
 *
 * Every query here is an ordinary authenticated read, so RLS decides what
 * comes back: membership of the thread grants the history, and nothing else
 * grants anything. There is no administrator clause — a private conversation
 * is not club property, and a moderator who legitimately needs one goes
 * through the audited Support path that already exists.
 *
 * WHETHER YOU MAY SEND is a separate question from whether you may read, and
 * is asked of internal.may_direct_message rather than inferred here. A
 * relationship that has lapsed, a club that has switched direct messaging
 * off, or a block in either direction all stop the composer while leaving the
 * history exactly where it was.
 */

export interface DirectThreadView {
  conversationId: string
  otherUserId: string
  otherName: string
  /** A light line under the name where there is something true to say. */
  contextLabel: string | null
  messages: ThreadMessage[]
  canSend: boolean
  /**
   * ONE SENTENCE FOR EVERY CAUSE. Block in either direction, policy off,
   * relationship lapsed — all read the same, because the differences are
   * exactly what must not be disclosed.
   */
  unavailableReason: string | null
}

const UNAVAILABLE = "This conversation isn't available."

export async function getDirectThread(
  supabase: SupabaseClient,
  conversationId: string,
  viewerId: string,
): Promise<DirectThreadView | null> {
  const { data: conversation } = await supabase
    .from("direct_conversations")
    .select("id, user_a, user_b")
    .eq("id", conversationId)
    .maybeSingle()

  if (!conversation) return null

  const otherUserId = conversation.user_a === viewerId ? conversation.user_b : conversation.user_a

  // ONE call for the name and the send authority. Deliberately not the
  // candidate list: a blocked or lapsed thread drops out of discovery, and a
  // header that then read "Ovalball user" would hide who you were talking to
  // at exactly the moment you most want to know.
  const { data: headerRows } = await supabase.rpc("direct_conversation_header", {
    p_conversation_id: conversationId,
  })
  const header = (headerRows ?? [])[0]
  if (!header) return null

  const { data: rows } = await supabase
    .from("fixture_messages")
    .select("id, body, sender_user_id, created_at, kind, deleted_at, deleted_by_role, content_type")
    .eq("direct_conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(200)

  const messages: ThreadMessage[] = (rows ?? []).map((m) => {
    const isDeleted = Boolean(m.deleted_at)
    const isOwn = m.sender_user_id === viewerId
    return {
      id: m.id,
      // Tombstoned the same way as everywhere else — the original words stay
      // in the row for moderation and never reach this payload.
      body: isDeleted
        ? m.deleted_by_role === "moderator"
          ? "Message has been deleted by admin."
          : "Message has been deleted by user."
        : (m.body ?? ""),
      createdAt: m.created_at,
      isOwn,
      isSystemEvent: m.kind === "system_event",
      isDeleted,
      canDelete: isOwn && !isDeleted,
      canReport: !isOwn && !isDeleted,
      senderName: isOwn ? "You" : (header.other_display_name ?? "Ovalball user"),
      senderRoleLabel: "",
      senderClubName: "",
      senderAvatarUrl: null,
      attachment: null,
      documentShare: null,
      contactCard: null,
    }
  })

  const canSend = header.can_send === true

  // The context line is a nicety, so it comes from discovery and is simply
  // absent when discovery no longer lists them.
  const { data: candidates } = await supabase.rpc("my_direct_message_candidates")
  const match = (candidates ?? []).find((c: { user_id: string }) => c.user_id === otherUserId)

  return {
    conversationId,
    otherUserId,
    otherName: header.other_display_name ?? "Ovalball user",
    contextLabel: match ? [match.context_label, match.context_detail].filter(Boolean).join(" · ") : null,
    messages,
    canSend,
    unavailableReason: canSend ? null : UNAVAILABLE,
  }
}
