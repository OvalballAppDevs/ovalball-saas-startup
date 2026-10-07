import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

/**
 * REACTIONS TO A MESSAGE.
 *
 * One reaction per person per message, as in every messenger people already know: choosing another
 * emoji changes it, choosing the same one again takes it back. The set is fixed and friendly --
 * a youth sport's messenger has no free-text reactions to moderate -- and the database holds the same
 * set in a check constraint, so a client offering anything else is refused rather than trusted.
 *
 * REACTING IS POSTING. `set_message_reaction` asks the same question the composer asks
 * (`internal.can_post_to_message`), so somebody who may read a conversation but not write in it --
 * a closed club thread, a lapsed direct relationship, an announcement -- cannot react either. Reading
 * reactions is RLS on `message_reactions`, which shows them exactly where the message itself is visible.
 */

/** The reactions a person is offered, in the order they are shown. */
export const REACTION_EMOJI = ["👍", "❤️", "😂", "🎉", "👏"] as const

export type ReactionEmoji = (typeof REACTION_EMOJI)[number]

/** Words for a screen reader, because an emoji's own name is not always what it means here. */
export const REACTION_NAMES: Record<string, string> = {
  "👍": "thumbs up",
  "❤️": "heart",
  "😂": "laughing",
  "🎉": "celebrate",
  "👏": "applause",
  "🙌": "raised hands",
}

export interface MessageReaction {
  emoji: string
  count: number
  /** The signed-in person's own reaction. At most one entry per message has this. */
  mine: boolean
}

/**
 * Rows to the shape every surface draws: most-used first, then a stable order, so two people looking
 * at one message see the chips in the same places.
 */
export function summariseReactions(rows: readonly { emoji: string; user_id: string }[] | null | undefined, userId: string): MessageReaction[] {
  const byEmoji = new Map<string, MessageReaction>()
  for (const row of rows ?? []) {
    const current = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false }
    current.count += 1
    if (row.user_id === userId) current.mine = true
    byEmoji.set(row.emoji, current)
  }
  return [...byEmoji.values()].sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
}

/** My current reaction on a message, from its summary. */
export function myReaction(reactions: readonly MessageReaction[]): string | null {
  return reactions.find((r) => r.mine)?.emoji ?? null
}

/**
 * What a tap on `emoji` does to a message's reactions, before the server has answered.
 *
 * Shown immediately so the chip responds under the finger, then REPLACED by the server's own answer
 * -- the RPC returns the message's reactions -- or rolled back if it refuses. Never the final word.
 */
export function applyReactionLocally(reactions: readonly MessageReaction[], emoji: string | null): MessageReaction[] {
  const mine = myReaction(reactions)
  const next = reactions
    .map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : { ...r }))
    .filter((r) => r.count > 0)
  if (emoji === null || emoji === mine) return next
  const existing = next.find((r) => r.emoji === emoji)
  if (existing) {
    existing.count += 1
    existing.mine = true
  } else {
    next.push({ emoji, count: 1, mine: true })
  }
  return next.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
}

/** One sentence for a screen reader, e.g. "3 thumbs up, including you. 1 heart." */
export function reactionsAccessibilityLabel(reactions: readonly MessageReaction[]): string {
  return reactions
    .map((r) => `${r.count} ${REACTION_NAMES[r.emoji] ?? r.emoji}${r.mine ? (r.count === 1 ? ", yours" : ", including you") : ""}.`)
    .join(" ")
}

export type SetReactionResult = { ok: true; reactions: MessageReaction[] } | { ok: false; message: string }

/**
 * Set, change or take back my reaction. `emoji` null takes it back; the same emoji as mine also takes
 * it back. Safe to repeat: the server keeps one row per person per message.
 */
export async function setMessageReaction(
  supabase: SupabaseClient<Database>,
  messageId: string,
  emoji: string | null
): Promise<SetReactionResult> {
  // The generated type says `string`, but null is how the function is told to take a reaction back.
  const { data, error } = await supabase.rpc("set_message_reaction", { p_message_id: messageId, p_emoji: emoji as string })
  if (error) {
    return { ok: false, message: error.code === "42501" ? "You can't react to this message." : "Couldn't save that reaction. Try again." }
  }
  const reactions = Array.isArray(data)
    ? (data as { emoji?: unknown; count?: unknown; mine?: unknown }[]).map((r) => ({
        emoji: String(r.emoji ?? ""),
        count: Number(r.count ?? 0),
        mine: r.mine === true,
      }))
    : []
  return { ok: true, reactions: reactions.filter((r) => r.emoji && r.count > 0) }
}

/** Reactions for a set of messages, read under RLS -- for a caller refreshing after a realtime nudge. */
export async function loadReactions(
  supabase: SupabaseClient<Database>,
  messageIds: readonly string[],
  userId: string
): Promise<Map<string, MessageReaction[]>> {
  const result = new Map<string, MessageReaction[]>()
  if (messageIds.length === 0) return result
  const { data } = await supabase.from("message_reactions").select("message_id, emoji, user_id").in("message_id", [...messageIds])
  const grouped = new Map<string, { emoji: string; user_id: string }[]>()
  for (const row of data ?? []) {
    const list = grouped.get(row.message_id) ?? []
    list.push(row)
    grouped.set(row.message_id, list)
  }
  for (const id of messageIds) result.set(id, summariseReactions(grouped.get(id), userId))
  return result
}
