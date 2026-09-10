/**
 * ONE CONVERSATION ROW, WHEREVER A CONVERSATION IS LISTED.
 *
 * Ovalball lists conversations in three places -- the /messages workspace, the
 * compact Messenger panel in the header, and the mobile list -- and they are
 * three views of one product, not three products. So they share this shape and
 * the component that renders it. A row cannot say one thing in the panel and
 * something else in the workspace, and a change to how a conversation reads
 * lands in all three at once.
 *
 * Pure and client-safe on purpose: the server modules that build these rows
 * (lib/app-context/conversations.ts, lib/support/conversations.ts) are
 * server-only, and a shape that cannot cross that line cannot be shared with
 * the client components that draw it.
 *
 * NOTHING HERE FETCHES. The canonical queries already exist and are unchanged;
 * this is presentation vocabulary over what they return.
 */

/**
 * What kind of conversation this is. These are the real conversation kinds the
 * product already has -- not a taxonomy invented to give the UI more icons.
 */
export type ConversationKind = "request" | "fixture" | "club" | "support"

export interface MessengerRow {
  /** Stable across renders and unique across kinds: "fixture:<uuid>". */
  key: string
  kind: ConversationKind
  href: string
  /** The other party's crest, where one legitimately exists. */
  logoUrl: string | null
  /** WHO. The club or organisation on the other side. */
  title: string
  /**
   * WHY THIS CONVERSATION EXISTS, in one line: the fixture, the request, the
   * support case. Never a repeat of the title.
   */
  context: string | null
  /** WHAT WAS SAID LAST, already prefixed with the sender where known. */
  preview: string | null
  /** The canonical status value, as the database holds it. */
  status: string
  /** That status in Ovalball's own words. */
  statusLabel: string
  /**
   * ISO timestamp used for BOTH the displayed time and the sort, so a row can
   * never show one time and order itself by another.
   */
  activityAt: string | null
  unreadCount: number
}

/**
 * The status values that mean "this needs an answer from somebody". Used to
 * tint a status chip warm rather than neutral -- and never as the only signal,
 * since the label always says the same thing in words.
 */
const AWAITING = new Set(["sent", "pending", "counter_proposed", "Open", "With Ovalball"])
const SETTLED = new Set(["accepted", "Booked", "Confirmed", "Resolved"])
const CLOSED = new Set(["declined", "cancelled", "Cancelled", "expired"])

export type StatusTone = "awaiting" | "settled" | "closed" | "neutral"

export function statusTone(status: string): StatusTone {
  if (AWAITING.has(status)) return "awaiting"
  if (SETTLED.has(status)) return "settled"
  if (CLOSED.has(status)) return "closed"
  return "neutral"
}

/**
 * Conversation-list time, which is not the same as message time. A list is
 * scanned, so it wants the shortest thing that is still unambiguous: a clock
 * time today, a weekday this week, a date beyond that. "3 days ago" reads
 * fine in isolation and badly in a column of twelve.
 */
export function listTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDiff = Math.round((startOfToday - startOfDate) / 86400000)
  if (dayDiff === 0) return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  if (dayDiff === 1) return "Yesterday"
  if (dayDiff > 1 && dayDiff < 7) return date.toLocaleDateString("en-GB", { weekday: "short" })
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/**
 * A badge that will not break the layout it sits in. Ovalball is a club
 * product: a fixture secretary in September genuinely can have hundreds of
 * unread items, and a three-digit number inside a 16px circle is a broken
 * header, not a large count.
 */
export function badgeCount(count: number): string {
  if (count > 99) return "99+"
  return String(count)
}

/**
 * The accessible name for an unread badge. The number alone announces as a
 * bare digit next to a link, which tells a screen reader user nothing about
 * what it counts.
 */
export function unreadLabel(count: number, noun = "unread message"): string {
  if (count === 1) return `1 ${noun}`
  return `${count} ${noun}s`
}

/**
 * Sorting, in one place, because the workspace and the compact panel must
 * agree on which conversation is "most recent" -- otherwise the panel's top
 * row is not the workspace's top row and the product looks broken.
 */
export function byRecentActivity(a: MessengerRow, b: MessengerRow): number {
  return (b.activityAt ?? "").localeCompare(a.activityAt ?? "")
}
