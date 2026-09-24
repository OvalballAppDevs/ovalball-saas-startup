import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import type { AttentionItem, AttentionPriority } from "../attention/model"
import { notificationDestination, type Destination } from "../navigation/destinations"
import { notificationHref } from "./destinations"

type Client = SupabaseClient<Database>

/**
 * THE INBOX FEED, paged, and the read mutation -- both clients, one source (CA-M8).
 *
 * `my_notifications` is the bell's own membership rule with a keyset cursor; `getRecentNotifications`
 * (the bell's short list) stays as it is and both read the same rows. READ IS NOT RESOLVED: marking a
 * row read touches `read_at` and nothing else; whether the thing it was about still needs an answer
 * is the domain's to say, through the attention projection -- which is why a feed row can be paired
 * with an attention item (`notificationAttentionId`) and never carries a "done" flag of its own.
 */
export interface FeedNotification {
  id: string
  type: string
  topicKey: string | null
  title: string
  body: string
  data: Record<string, unknown>
  readAt: string | null
  createdAt: string
  href: string
  destination: Destination
}

export interface FeedCursor {
  createdAt: string
  id: string
}

export interface NotificationPage {
  items: FeedNotification[]
  /** The cursor for the page after this one; null when this was the last page. */
  next: FeedCursor | null
}

export const FEED_PAGE_SIZE = 20

export async function readNotificationPage(
  supabase: Client,
  options: { limit?: number; cursor?: FeedCursor | null; unreadOnly?: boolean } = {}
): Promise<NotificationPage> {
  const limit = Math.max(1, Math.min(options.limit ?? FEED_PAGE_SIZE, 50))
  const { data, error } = await supabase.rpc("my_notifications", {
    p_limit: limit,
    p_before_created_at: options.cursor?.createdAt ?? undefined,
    p_before_id: options.cursor?.id ?? undefined,
    p_unread_only: options.unreadOnly ?? false,
  })
  if (error) throw error
  const items = (data ?? []).map((n) => {
    const payload = (n.data as Record<string, unknown>) ?? {}
    return {
      id: n.id,
      type: n.type,
      topicKey: n.topic_key,
      title: n.title,
      body: n.body,
      data: payload,
      readAt: n.read_at,
      createdAt: n.created_at,
      href: notificationHref(n.type, payload),
      destination: notificationDestination(n.type, payload),
    }
  })
  const last = items[items.length - 1]
  return { items, next: items.length === limit && last ? { createdAt: last.createdAt, id: last.id } : null }
}

/** Marks one of the caller's own notifications read. True when a row changed. */
export async function markNotificationRead(supabase: Client, id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("mark_notification_read", { p_id: id })
  if (error) throw error
  return data === true
}

/** Marks one of the caller's own notifications unread again. True when a row changed. */
export async function markNotificationUnread(supabase: Client, id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("mark_notification_unread", { p_id: id })
  if (error) throw error
  return data === true
}

/** Marks every unread row the bell lists read. Returns how many changed. */
export async function markAllNotificationsRead(supabase: Client): Promise<number> {
  const { data, error } = await supabase.rpc("mark_all_notifications_read")
  if (error) throw error
  return data ?? 0
}

// ---------------------------------------------------------------------------------------------------
// WHAT A NOTIFICATION IS ABOUT -- derived from the type and the ids it carries, never from its words.
// ---------------------------------------------------------------------------------------------------

/**
 * Types that ASK the recipient for something. A notification of one of these can be paired with an
 * open attention item; whether the ask is still open is the projection's answer, not this list's.
 */
export const ASKING_TYPES = new Set([
  "fixture_attendance_invitation",
  "fixture_attendance_reminder",
  "training_attendance_reminder",
  "fixture_request_received",
  "fixture_kickoff_change_proposed",
  "fixture_result_awaiting_confirmation",
  "fixture_result_amendment_proposed",
  "fixture_call_up_requested",
  "player_eligibility_approval_required",
  "club_join_request_submitted",
  "partner_request_received",
  "tournament_invitation_received",
  "competition_match_verification_requested",
  "player_information_requested",
  "season_transition_needs_attention",
  "gocardless_payment_failed",
  "safeguarding_dispensation_requested",
])

/** Types whose news changes today's plans: cancellations, safety, money that failed, account security. */
export const URGENT_TYPES = new Set([
  "fixture_cancelled",
  "fixture_cancelled_team_folded",
  "training_session_cancelled",
  "training_plan_cancelled",
  "competition_match_cancelled",
  "gocardless_payment_failed",
  "gocardless_membership_cancelled",
  "account_recovery_requested",
  "safeguarding_threads_unattended",
  "safeguarding_guardian_call_up",
  "safeguarding_guardian_dispensation",
])

/** The deterministic band a notification sits in, from its type alone. */
export function notificationPriority(type: string): AttentionPriority {
  if (URGENT_TYPES.has(type)) return "urgent"
  if (ASKING_TYPES.has(type)) return "needs_action"
  return "for_information"
}

/**
 * The attention item id this notification is about, where the two can be paired by canonical record.
 * A family's availability item is per child, so the pairing is by prefix (see `attentionStillOpen`).
 */
export function notificationAttentionId(type: string, data: Record<string, unknown>): string | null {
  const s = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null)
  switch (type) {
    case "fixture_attendance_invitation":
    case "fixture_attendance_reminder":
    case "fixture_availability_responded":
      return s("fixture_id") ? `fixture_availability:${s("fixture_id")}` : null
    case "training_attendance_reminder":
    case "training_availability_responded":
      return s("training_session_id") ? `training_availability:${s("training_session_id")}` : null
    case "fixture_request_received":
      return s("fixture_request_id") ? `fixture_request:${s("fixture_request_id")}` : null
    case "fixture_kickoff_change_proposed":
      return s("fixture_id") ? `kickoff_proposal:${s("fixture_id")}` : null
    case "fixture_result_awaiting_confirmation":
    case "fixture_result_amendment_proposed":
      return s("fixture_id") ? `result_confirmation:${s("fixture_id")}` : null
    case "club_join_request_submitted":
      return s("club_id") ? `club_join_request:${s("club_id")}` : null
    case "partner_request_received":
      return s("requesting_club_id") || s("partnership_id") ? `partner_request:*` : null
    default:
      return null
  }
}

/**
 * Whether the job a notification asked about is still open, judged ONLY by the attention projection.
 * `null` where the projection cannot say (a type it does not pair, or a context whose work is on the
 * web) -- and a screen shows nothing for null rather than guessing either way.
 */
export function attentionStillOpen(type: string, data: Record<string, unknown>, attention: AttentionItem[]): boolean | null {
  const id = notificationAttentionId(type, data)
  if (!id) return null
  if (id.endsWith(":*")) {
    const prefix = id.slice(0, -1)
    return attention.some((i) => i.id.startsWith(prefix))
  }
  return attention.some((i) => i.id === id || i.id.startsWith(`${id}:`))
}

/** The context identity a notification carries, so the app can stand in the right place before it opens. */
export function notificationContextHint(data: Record<string, unknown>): { teamId: string | null; clubId: string | null; playerId: string | null } {
  const s = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : null)
  return { teamId: s("team_id"), clubId: s("club_id"), playerId: s("player_id") }
}

// ---------------------------------------------------------------------------------------------------
// WHOSE ASK IT IS. A parent's availability invitation and a coach's "somebody answered" are both about
// the same fixture; only one of them is a job for the person reading. The verdict below is asked
// against the projection for the context the person is standing in, and stays silent everywhere else.
// ---------------------------------------------------------------------------------------------------
export type NotificationAudience = "family" | "staff" | "either"

const FAMILY_ASKS = new Set(["fixture_attendance_invitation", "fixture_attendance_reminder", "training_attendance_reminder", "player_information_requested", "gocardless_payment_failed"])

export function notificationAudience(type: string): NotificationAudience {
  if (FAMILY_ASKS.has(type)) return "family"
  if (ASKING_TYPES.has(type) || type === "fixture_availability_responded" || type === "training_availability_responded") return "staff"
  return "either"
}

export type AttentionVerdict = "open" | "done" | "unknown"

/**
 * Types whose absence from the projection proves nothing. A team's projection carries the register for
 * the NEXT fixture only, so "somebody answered" about a later fixture is neither open nor done as far
 * as the phone can see -- and the card says nothing rather than "done".
 */
const OPEN_ONLY_TYPES = new Set(["fixture_availability_responded", "training_availability_responded"])

/** The words a card uses for a verdict, in the voice of whoever the ask belongs to. */
export function verdictWording(type: string): { open: string; done: string } {
  if (OPEN_ONLY_TYPES.has(type)) return { open: "Answers still coming in", done: "Register complete" }
  if (notificationAudience(type) === "family") return { open: "Still needs your answer", done: "Answered" }
  return { open: "Still waiting on you", done: "Dealt with" }
}

/**
 * Whether the job behind a notification is still open FOR THIS CONTEXT: `open` when the projection
 * holds it, `done` when the projection could have held it and does not, `unknown` when the projection
 * cannot say (the wrong kind of context, a type nothing pairs, or work that lives on the web).
 */
export function attentionVerdict(
  type: string,
  data: Record<string, unknown>,
  read: { items: AttentionItem[]; coverage: "native" | "web" } | null,
  contextIsFamilyFacing: boolean
): AttentionVerdict {
  if (!read || read.coverage !== "native") return "unknown"
  const audience = notificationAudience(type)
  if (audience === "family" && !contextIsFamilyFacing) return "unknown"
  if (audience === "staff" && contextIsFamilyFacing) return "unknown"
  const open = attentionStillOpen(type, data, read.items)
  if (open === null) return "unknown"
  if (open) return "open"
  return OPEN_ONLY_TYPES.has(type) ? "unknown" : "done"
}
