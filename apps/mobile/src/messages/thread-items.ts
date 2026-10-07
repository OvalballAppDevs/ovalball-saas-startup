import type { ThreadMessage, ThreadReplyQuote } from "@ovalball/contracts"

/**
 * HOW AN OPEN CONVERSATION IS LAID OUT -- pure, so the rules can be pinned by tests without a device.
 *
 * Newest first (the list is inverted, so the newest message sits by the composer at the bottom), a day
 * line above each day's first message, one "New Messages" line above the oldest message that was unread
 * on opening, consecutive messages from one person
 * grouped, and a pending send drawn as the sender's own message until the stored one replaces it.
 */

export interface PendingSend {
  clientMessageId: string
  body: string
  replyTo: ThreadReplyQuote | null
  createdAt: string
  state: "sending" | "failed"
  error: string | null
  retryable: boolean
  /** A recorded voice note on its way: the bytes are held only until the server has it. */
  voice?: { bytes: ArrayBuffer; durationMs: number } | null
}

export type ThreadItem =
  | { type: "message"; key: string; message: ThreadMessage; pending: PendingSend | null; groupedWithNewer: boolean; groupedWithOlder: boolean }
  | { type: "day"; key: string; label: string }
  | { type: "unread"; key: string; count: number }

/** The quote a reply carries, built from the message being answered. */
export function quoteOf(message: ThreadMessage): ThreadReplyQuote {
  const text = message.body.replace(/\s+/g, " ").trim()
  return {
    id: message.id,
    senderName: message.isOwn ? "You" : message.senderName,
    isOwn: message.isOwn,
    excerpt: message.isDeleted
      ? "Message has been deleted."
      : text
        ? text.length > 120
          ? `${text.slice(0, 119).trimEnd()}…`
          : text
        : message.attachment
          ? "Photo"
          : message.documentShare
            ? message.documentShare.title
            : "Attachment",
    isDeleted: message.isDeleted,
  }
}

const LONDON_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" })

function dayKey(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? "" : LONDON_DAY.format(at)
}

/** "Today", "Yesterday", "Monday", then "4 October" -- the way a phone already labels a conversation. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ""
  const key = LONDON_DAY.format(at)
  if (key === LONDON_DAY.format(now)) return "Today"
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (key === LONDON_DAY.format(yesterday)) return "Yesterday"
  const days = (now.getTime() - at.getTime()) / (24 * 60 * 60 * 1000)
  if (days < 6) return at.toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/London" })
  return at.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    ...(at.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    timeZone: "Europe/London",
  })
}

const GROUP_WINDOW_MS = 5 * 60 * 1000

/**
 * THE LIST AN INVERTED FLATLIST DRAWS: newest first, with a day line above each day's first message and
 * a "New messages" line above the oldest message that was unread when the conversation was opened.
 *
 * Consecutive messages from one person within five minutes are grouped, so the name and avatar are not
 * repeated on every line of a burst -- the way every messenger people already use reads.
 */
export function buildItems(messages: ThreadMessage[], pending: PendingSend[], viewerId: string | null, unreadAtOpen: number): ThreadItem[] {
  const stored = [...messages].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  const storedIds = new Set(stored.map((m) => m.clientMessageId).filter(Boolean))
  const waiting = pending
    .filter((p) => !storedIds.has(p.clientMessageId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((p) => ({ message: pendingMessage(p, viewerId), pending: p }))
  const all = [...waiting, ...stored.map((m) => ({ message: m, pending: null as PendingSend | null }))]

  // Which incoming message is the oldest unread one: count back through messages from other people.
  let unreadBoundary: string | null = null
  if (unreadAtOpen > 0) {
    let seen = 0
    for (const entry of all) {
      if (entry.pending || entry.message.isOwn || entry.message.isSystemEvent) continue
      seen += 1
      if (seen === unreadAtOpen) {
        unreadBoundary = entry.message.id
        break
      }
    }
    if (!unreadBoundary && seen > 0) unreadBoundary = [...all].reverse().find((e) => !e.pending && !e.message.isOwn)?.message.id ?? null
  }

  const items: ThreadItem[] = []
  for (let i = 0; i < all.length; i += 1) {
    const { message, pending: p } = all[i]!
    const newer = all[i - 1]?.message
    const olderMessage = all[i + 1]?.message
    items.push({
      type: "message",
      key: p ? `pending:${p.clientMessageId}` : message.id,
      message,
      pending: p,
      groupedWithNewer: Boolean(newer && sameRun(message, newer)),
      groupedWithOlder: Boolean(olderMessage && sameRun(message, olderMessage)),
    })
    if (message.id === unreadBoundary) items.push({ type: "unread", key: `unread:${message.id}`, count: unreadAtOpen })
    if (!olderMessage || dayKey(olderMessage.createdAt) !== dayKey(message.createdAt)) {
      items.push({ type: "day", key: `day:${dayKey(message.createdAt)}`, label: dayLabel(message.createdAt) })
    }
  }
  return items
}

function sameRun(a: ThreadMessage, b: ThreadMessage): boolean {
  if (a.isSystemEvent || b.isSystemEvent) return false
  if (a.isOwn !== b.isOwn) return false
  if (!a.isOwn && a.senderName !== b.senderName) return false
  if (dayKey(a.createdAt) !== dayKey(b.createdAt)) return false
  return Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) < GROUP_WINDOW_MS
}

function pendingMessage(p: PendingSend, viewerId: string | null): ThreadMessage {
  return {
    id: `pending:${p.clientMessageId}`,
    body: p.body,
    createdAt: p.createdAt,
    isOwn: true,
    isSystemEvent: false,
    isDeleted: false,
    canDelete: false,
    canReport: false,
    senderName: "You",
    senderRoleLabel: "",
    senderClubName: "",
    senderAvatarUrl: null,
    attachment: p.voice
      ? { id: `pending-voice:${p.clientMessageId}`, filename: "Voice note.m4a", mimeType: "audio/mp4", sizeBytes: p.voice.bytes.byteLength, signedUrl: null, durationMs: p.voice.durationMs }
      : null,
    documentShare: null,
    contactCard: null,
    replyTo: p.replyTo,
    reactions: [],
    clientMessageId: viewerId ? p.clientMessageId : null,
  }
}
