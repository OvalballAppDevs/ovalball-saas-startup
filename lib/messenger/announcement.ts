import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ThreadMessage } from "@/lib/messenger/thread-types"

/**
 * READING AN ANNOUNCEMENT, AND WHAT IT DELIBERATELY DOES NOT READ.
 *
 * Every query here is an ordinary authenticated read. Nothing in this file
 * elevates, and nothing asks the database a question the viewer could not ask
 * themselves -- so what a recipient sees is decided by the row-level policies
 * in 20270242000000 and 20270246000000 and by nothing on this side.
 *
 * That matters more here than in an ordinary thread. An announcement's
 * audience is private, so the failure mode is not "the screen shows too
 * much"; it is "the payload contains what the screen hides". A reader who
 * opens devtools is entitled to see everything that reached their browser, so
 * the only durable answer is that it never reaches their browser.
 *
 * THE RECIPIENT COUNT IS THE ONE FIGURE TO BE CAREFUL WITH. The sending side
 * genuinely needs it -- "this went to 43 people" is the difference between
 * confidence and hope -- and a recipient must not have it, because a count
 * plus a roster is an audience. So it is read from the announcement row,
 * which recipients can see, but it is only PASSED ON when the viewer is the
 * sending side. `resolved_recipient_count` is not a secret about any one
 * person; a recipient simply has no use for it and no right to it.
 */

export interface AnnouncementView {
  id: string
  title: string | null
  body: string
  senderLabel: string
  senderIdentityType: string
  replyMode: "NO_REPLY" | "PRIVATE_REPLY" | "GROUP_DISCUSSION"
  scope: string
  withdrawn: boolean
  sentAt: string | null
  /** Present only for the sending side. Recipients get null. */
  recipientCount: number | null
  /** Present only for the sending side. */
  unreachable: { playerId: string; outcome: string }[] | null
  viewerIsSender: boolean
  viewerIsRecipient: boolean
  /** For a recipient, when their own copy was delivered. */
  deliveredAt: string | null
  excludedU18: boolean
  replies: ThreadMessage[]
  canReply: boolean
  /** Why replying is unavailable, in the recipient's own terms. */
  replyBlockedReason: string | null
}

/** The shape public.announcement_replies returns, named so the map below reads. */
interface AnnouncementReplyRow {
  message_id: string
  sender_user_id: string
  body: string
  deleted: boolean
  created_at: string
}

const REPLY_MODES = ["NO_REPLY", "PRIVATE_REPLY", "GROUP_DISCUSSION"] as const

function asReplyMode(value: unknown): AnnouncementView["replyMode"] {
  return (REPLY_MODES as readonly string[]).includes(String(value))
    ? (value as AnnouncementView["replyMode"])
    : "NO_REPLY"
}

export async function getAnnouncementView(
  supabase: SupabaseClient,
  announcementId: string,
  viewerId: string,
): Promise<AnnouncementView | null> {
  // RLS decides whether this returns anything at all: the sending side, or
  // somebody it was delivered to. There is no third case.
  const { data: announcement } = await supabase
    .from("messenger_announcements")
    .select(
      "id, title, body, actor_user_id, sender_identity_type, sender_identity_id, scope, scope_id, audience_spec, reply_mode, status, sent_at, resolved_recipient_count, exclude_u18, withdrawn_at",
    )
    .eq("id", announcementId)
    .maybeSingle()

  if (!announcement) return null

  const withdrawn = Boolean(announcement.withdrawn_at)

  // The sending side is anyone whose delivery-table reach exceeds their own
  // row. Asked of the database rather than recomputed here, because
  // "may_send_as" is an authority question and this file has no authority.
  const { count: visibleDeliveries } = await supabase
    .from("messenger_announcement_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("announcement_id", announcementId)

  const { data: ownDelivery } = await supabase
    .from("messenger_announcement_deliveries")
    .select("delivered_at, read_at")
    .eq("announcement_id", announcementId)
    .eq("recipient_user_id", viewerId)
    .maybeSingle()

  const viewerIsRecipient = Boolean(ownDelivery)
  const viewerIsSender =
    announcement.actor_user_id === viewerId ||
    // More rows visible than my own means the delivery policy admitted me as
    // the sending side. One row that is mine means it did not.
    (visibleDeliveries ?? 0) > (viewerIsRecipient ? 1 : 0)

  // The canonical label, from the one function that knows how an identity is
  // named (20270250000000). This used to be resolved here in TypeScript as
  // well, which meant the same announcement could be attributed one way in
  // the inbox and another on the page.
  const { data: senderLabel } = await supabase.rpc("announcement_sender_label", {
    p_announcement_id: announcementId,
  })

  const replyMode = asReplyMode(announcement.reply_mode)

  // Replies come through the RPC, which is not SECURITY DEFINER precisely so
  // that the policy on fixture_messages is the only thing deciding.
  const { data } = await supabase.rpc("announcement_replies", {
    p_announcement_id: announcementId,
  })
  const replyRows: AnnouncementReplyRow[] = data ?? []

  const senderIds = Array.from(new Set(replyRows.map((r) => r.sender_user_id)))
  const names = await resolveNames(supabase, senderIds)

  const replies: ThreadMessage[] = replyRows.map(
    (r) => ({
      id: r.message_id,
      body: r.body,
      createdAt: r.created_at,
      isOwn: r.sender_user_id === viewerId,
      isSystemEvent: false,
      isDeleted: r.deleted,
      canDelete: r.sender_user_id === viewerId && !r.deleted,
      canReport: r.sender_user_id !== viewerId && !r.deleted,
      senderName: names.get(r.sender_user_id) ?? "Someone",
      senderRoleLabel: "",
      senderClubName: "",
      senderAvatarUrl: null,
      attachment: null,
      documentShare: null,
      contactCard: null,
    }),
  )

  // Unreachable players are a SENDER's concern and nobody else's -- it names
  // children whose families could not be contacted.
  let unreachable: AnnouncementView["unreachable"] = null
  if (viewerIsSender && !withdrawn) {
    // The SAME criteria the announcement was sent with -- scope, scope id and
    // spec -- because asking a different question would report a different
    // audience's gaps. Errors are swallowed deliberately: this is supporting
    // information, and a sender should still be able to read what they sent
    // if, say, the club has since switched the feature off.
    const { data } = await supabase.rpc("audience_unreachable", {
      p_scope: announcement.scope,
      p_scope_id: announcement.scope_id,
      p_audience_spec: announcement.audience_spec ?? {},
      p_exclude_u18: announcement.exclude_u18,
    })
    if (Array.isArray(data)) {
      unreachable = data.map((r: { player_id: string; outcome: string }) => ({
        playerId: r.player_id,
        outcome: r.outcome,
      }))
    }
  }

  const { canReply, replyBlockedReason } = resolveReplyAvailability({
    replyMode,
    withdrawn,
    viewerIsSender,
    viewerIsRecipient,
  })

  return {
    id: announcement.id,
    title: withdrawn ? null : announcement.title,
    body: withdrawn ? "This announcement has been withdrawn." : announcement.body,
    senderLabel: senderLabel ?? "Ovalball",
    senderIdentityType: announcement.sender_identity_type,
    replyMode,
    scope: announcement.scope,
    withdrawn,
    sentAt: announcement.sent_at,
    recipientCount: viewerIsSender ? (announcement.resolved_recipient_count ?? null) : null,
    unreachable,
    viewerIsSender,
    viewerIsRecipient,
    deliveredAt: ownDelivery?.delivered_at ?? null,
    excludedU18: Boolean(announcement.exclude_u18),
    replies,
    canReply,
    replyBlockedReason,
  }
}

/**
 * Written as one function rather than inline conditions so the reasons stay
 * readable next to each other -- a person told they cannot reply deserves to
 * be told why, and each of these says something different.
 */
function resolveReplyAvailability(input: {
  replyMode: AnnouncementView["replyMode"]
  withdrawn: boolean
  viewerIsSender: boolean
  viewerIsRecipient: boolean
}): { canReply: boolean; replyBlockedReason: string | null } {
  if (input.withdrawn) {
    return { canReply: false, replyBlockedReason: "This announcement has been withdrawn." }
  }
  if (input.replyMode === "NO_REPLY") {
    return { canReply: false, replyBlockedReason: "This announcement does not take replies." }
  }
  if (!input.viewerIsSender && !input.viewerIsRecipient) {
    return { canReply: false, replyBlockedReason: "You are not part of this conversation." }
  }
  return { canReply: true, replyBlockedReason: null }
}

/**
 * Names come from profiles, which the database has already normalised. Never
 * re-formatted here -- see CLAUDE.md: the stored value is what an export, an
 * email and a screen reader see, so the screen must not disagree with it.
 */
async function resolveNames(supabase: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (ids.length === 0) return map

  const { data } = await supabase.from("profiles").select("id, first_name, surname").in("id", ids)
  for (const row of data ?? []) {
    const name = [row.first_name, row.surname].filter(Boolean).join(" ").trim()
    if (name) map.set(row.id, name)
  }
  return map
}
