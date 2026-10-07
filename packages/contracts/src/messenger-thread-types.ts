/**
 * WHAT A MESSAGE IS, wherever Ovalball shows one.
 *
 * The compact Messenger in the header and the /messages workspace render the
 * same conversations, so they render the same shape -- and both get it from
 * the same server-side reader (lib/messenger/thread.ts). This file holds only
 * the shape, so it can cross into client components that the server-only
 * reader cannot.
 *
 * These types used to live inside the conversation component itself, which
 * meant anything that wanted a message had to import a React component to
 * describe one.
 */

import type { MessageReaction } from "./messenger-reactions"

export interface ThreadAttachment {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  signedUrl: string | null
  /** A voice note's length (audio/mp4 only). Absent on a surface that has not asked for it. */
  durationMs?: number | null
}

export interface ThreadDocumentShare {
  id: string
  title: string
  category: string
  filename: string
  mimeType: string
  sizeBytes: number
  signedUrl: string | null
}

export interface ThreadContactCard {
  displayName: string
  roleLabel: string
  clubName: string
  teamName: string | null
  telephone: string
}

/**
 * THE MESSAGE BEING ANSWERED, as a quote above a reply.
 *
 * Read through the same RLS as the reply itself, so a quote can never show more than the reader may
 * see. A parent that has since been deleted quotes as deleted -- its original words are never carried
 * forward by being replied to.
 */
export interface ThreadReplyQuote {
  id: string
  senderName: string
  isOwn: boolean
  excerpt: string
  isDeleted: boolean
}

export interface ThreadMessage {
  id: string
  body: string
  createdAt: string
  /**
   * WRITTEN BY THE SIGNED-IN PERSON. The one thing that decides which side of
   * the thread a message sits on and which colour it is.
   *
   * There used to be an `isOwnClub` beside this, and the bubbles were coloured
   * by it: a Fixture Secretary reading a thread saw their Club Admin
   * colleague's messages styled as their own. That is a misattribution rather
   * than a styling choice -- in a club communications product, "who said this"
   * has to survive switching context -- so the club-scoped flag was removed
   * rather than left available.
   */
  isOwn: boolean
  isSystemEvent: boolean
  /** True once soft_delete_own_message()/moderator_delete_message() has tombstoned this message -- `body` is already the tombstone text by this point, never the original content. */
  isDeleted: boolean
  /** Only the sender, and only before it's already deleted (Section 87 -- never someone else's message). */
  canDelete: boolean
  /** Never your own message, never an already-deleted one, never a system event. */
  canReport: boolean
  senderName: string
  senderRoleLabel: string
  senderClubName: string
  senderAvatarUrl: string | null
  attachment: ThreadAttachment | null
  documentShare: ThreadDocumentShare | null
  contactCard: ThreadContactCard | null
  /** The message this one answers, or null. Absent entirely on a surface that has not asked for it. */
  replyTo?: ThreadReplyQuote | null
  /** Most-used first. Empty where nobody has reacted. */
  reactions?: MessageReaction[]
  /** The sender's own send reference, so a sending client can match its pending bubble to the stored message. Only ever present on my own messages. */
  clientMessageId?: string | null
  /** A match update's own match ("Sat 17 Oct"), because one conversation covers every fixture against a side. */
  matchDay?: string | null
}
