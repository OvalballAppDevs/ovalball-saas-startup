import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import type { AttentionItem, AttentionPriority } from "../attention/model"
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
    }
  })
  const last = items[items.length - 1]
  return { items, next: items.length === limit && last ? { createdAt: last.createdAt, id: last.id } : null }
}

/**
 * THE ONE ORDER FOR EVERY NOTIFICATION LIST (owner rule): newest received first, strictly by
 * `createdAt`, with the id as a stable tie-break -- exactly the order `my_notifications` returns.
 * Read, unread and action-required change how a row LOOKS, never where it sits; the Unread and
 * Action Required views filter this list, they do not re-rank it.
 */
export function newestFirst<T extends { createdAt: string; id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : a.id > b.id ? -1 : 0) : a.createdAt < b.createdAt ? 1 : -1))
}

/**
 * ONE OPEN ASK PER JOB. Several notifications can be about the same live job -- a proposed change,
 * then a newer proposed change for the same result -- and only the NEWEST still describes what is
 * being asked. Older ones about the same job are history: they keep their place in the list but lose
 * the action treatment, so Action Required never highlights a request that has been superseded. A
 * wildcard job (`...:*`, one job standing for several records) is never collapsed this way.
 */
export function verdictsNewestAskOnly<T extends { id: string; type: string; data: Record<string, unknown>; createdAt: string }>(
  items: readonly T[],
  verdictOf: (n: T) => AttentionVerdict
): Map<string, AttentionVerdict> {
  const out = new Map<string, AttentionVerdict>()
  const seen = new Set<string>()
  for (const n of newestFirst(items)) {
    const verdict = verdictOf(n)
    const job = notificationAttentionId(n.type, n.data)
    if (verdict === "open" && job && !job.endsWith(":*")) {
      if (seen.has(job)) {
        out.set(n.id, "unknown")
        continue
      }
      seen.add(job)
    }
    out.set(n.id, verdict)
  }
  return out
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

/**
 * Dismisses (deletes) one of the caller's own notifications from their inbox -- everywhere, website
 * included. Soft and reversible: `restoreNotification` puts it back exactly, unread if it was unread.
 * DISMISSED IS NOT RESOLVED: whatever job the notification was about stays with its own domain and
 * the attention projection. True when a row changed.
 */
export async function dismissNotification(supabase: Client, id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("dismiss_notification", { p_id: id })
  if (error) throw error
  return data === true
}

/** Undoes `dismissNotification` for one of the caller's own notifications. True when a row changed. */
export async function restoreNotification(supabase: Client, id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("restore_notification", { p_id: id })
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
  // A Season Planner club day asks the receiving club to answer it (20270761000000).
  "club_day_request_received",
  "fixture_kickoff_change_proposed",
  "fixture_result_awaiting_confirmation",
  "fixture_result_amendment_proposed",
  "fixture_result_disputed",
  "fixture_call_up_requested",
  "player_eligibility_approval_required",
  "club_join_request_submitted",
  // Team codes place players (20270741000000): a team's approvers asked to decide a place, and a parent
  // asked to confirm their child's own request.
  "team_place_requested",
  "team_place_confirm_requested",
  "partner_request_received",
  "tournament_invitation_received",
  "competition_match_verification_requested",
  "player_information_requested",
  "season_transition_needs_attention",
  "gocardless_payment_failed",
  "safeguarding_dispensation_requested",
  "tournament_result_awaiting_confirmation",
  "tournament_result_contested",
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
    // Open while any fixture of the club day still waits for the receiving club (the club attention projection).
    case "club_day_request_received":
      return s("group_id") ? `club_day:${s("group_id")}` : null
    case "fixture_kickoff_change_proposed":
      return s("fixture_id") ? `kickoff_proposal:${s("fixture_id")}` : null
    case "fixture_result_awaiting_confirmation":
    case "fixture_result_amendment_proposed":
    // A dispute is still this club's job (submit the score it believes) until the result is agreed or
    // an organiser settles it -- the team/club projections now carry disputed results for exactly that.
    case "fixture_result_disputed":
      return s("fixture_id") ? `result_confirmation:${s("fixture_id")}` : null
    case "club_join_request_submitted":
      return s("club_id") ? `club_join_request:${s("club_id")}` : null
    // The team's own "waiting to join" row is one count per team; a parent's ask is one per request.
    case "team_place_requested":
      return s("team_id") ? `team_place_request:${s("team_id")}` : null
    case "team_place_confirm_requested":
      return s("membership_id") ? `team_place_confirmation:${s("membership_id")}` : null
    case "partner_request_received":
      return s("requesting_club_id") || s("partnership_id") ? `partner_request:*` : null
    // M7 notifications programme Phase E: the producer (apply_payment_status_transition,
    // 20270712000000) now carries player_id alongside obligation_id specifically so this can pair to
    // family.ts's money row (`family_subscription:<playerId>`) rather than staying permanently
    // "unknown" the way it did before -- a failed-payment notification could never be confirmed done
    // once the family actually fixed their payment details.
    // A tournament result asks the other side to confirm, and a contest asks the organiser to settle --
    // each the live job for that game in the projection that owns it (team or host club).
    case "tournament_result_awaiting_confirmation":
    case "tournament_result_contested":
      return s("tournament_game_id") ? `tournament_result:${s("tournament_game_id")}` : null
    case "gocardless_payment_failed":
      return s("player_id") ? `family_subscription:${s("player_id")}` : null
    // A dispensation waiting for this person's decision is one item per record (20270742000000): the ask
    // is open while the record is pending and theirs to decide, and history the moment anybody decides it.
    case "safeguarding_dispensation_requested":
      return s("dispensation_id") ? `dispensation:${s("dispensation_id")}` : null
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

const FAMILY_ASKS = new Set(["fixture_attendance_invitation", "fixture_attendance_reminder", "training_attendance_reminder", "player_information_requested", "gocardless_payment_failed", "team_place_confirm_requested"])

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

/**
 * CLUBHOUSE PROGRAMME SECTION 11: the notification types that are genuinely about the rugby NETWORK
 * (fixture requests, partner requests, the viewer's own club-claim outcome) -- never a fabricated feed,
 * and never a global "every club's activity" feed, which no capability check has ever authorised. The
 * one shared source for both Clubhouse Home's "Recent Activity" teaser and the Notifications screen's
 * "Clubhouse" filter -- a duplicated list in two files is exactly how the two would quietly drift.
 */
export const CLUBHOUSE_NOTIFICATION_TYPES = new Set([
  "fixture_request_received",
  "fixture_request_accepted",
  "fixture_request_declined",
  "fixture_request_countered",
  "club_day_request_received",
  "club_day_responded",
  "partner_request_received",
  "calendar_share_approved",
  "calendar_share_declined",
  "club_claim_approved",
  // Sections 15/16 (Looking for Opposition): all four are already staff-only recipients at the
  // database (team_admin/coach/manager, never view_only) -- listed here only decides which types show
  // up in this display filter, never who receives the underlying row.
  "fixture_opportunity_cancelled",
  "fixture_opportunity_response_received",
  "fixture_opportunity_response_declined",
  "fixture_opportunity_filled",
])
