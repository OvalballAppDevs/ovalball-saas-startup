import { useCallback, useEffect, useRef } from "react"

import { supabase } from "../auth/supabase"

/**
 * LIVE REFRESH, REUSING THE PLATFORM'S OWN MECHANISM.
 *
 * Ovalball already broadcasts on a PRIVATE channel per conversation
 * (`internal.broadcast_fixture_message`, topic `presence:<kind>:<id>`), and the website listens to
 * exactly this. The broadcast deliberately carries NO CONTENT, so the only correct reaction is to
 * re-read through RLS -- which means reusing it adds no new way for a message to reach a device.
 * That is what makes it safe to reuse rather than a second realtime model to build.
 *
 * ONE CHANNEL PER TOPIC, CARRYING EVERY EVENT. Two `.channel(sameTopic)` subscriptions collide, so the
 * new events ride the same channel rather than opening their own:
 *
 * - `fixture_message_inserted` -- a message arrived; re-read the thread.
 * - `message_reaction_changed` -- somebody reacted (`set_message_reaction`); re-read the reactions.
 * - `message_read` -- somebody read the thread (`mark_thread_read`); a sender re-reads their receipts.
 * - `typing` -- sent by a client, never stored, and only ever honoured in a DIRECT conversation. Realtime
 *   RLS (`fixture_presence_write` → `can_view_direct_conversation`) lets only the two people in it
 *   write to its topic, so a typing event that is not mine can only be the other person's. In a group
 *   the payload would have to say WHO is typing, and that would be a claim the sender makes about
 *   itself -- so groups get no typing indicator rather than a forgeable one.
 *
 * THE SOCKET MUST BE AUTHENTICATED BEFORE SUBSCRIBING. A private topic joined by an anonymous socket
 * is refused by RLS and the channel settles in CLOSED silently -- nothing raises. `setAuth` with the
 * current access token is what makes the join carry the person's identity.
 *
 * THE CALLBACKS ARE HELD IN A REF, and that is load-bearing. Naming them as dependencies rebuilds the
 * channel on every render, and `removeChannel` is async, so the rebuild races its own teardown. The
 * effect depends on the TOPIC alone, because the topic is the only thing that identifies the
 * subscription.
 */
export interface ConversationChannelHandlers {
  onMessage?: () => void
  onReaction?: (messageId: string | null) => void
  /** Called with the typing person's own claim of who they are; the caller decides whether to believe it. */
  onTyping?: (fromUserId: string | null) => void
  /** Somebody read this thread (`mark_thread_read`); the sender re-asks `message_receipts`. No content. */
  onRead?: () => void
  /** The channel joined (true) or dropped and is retrying (false). */
  onConnection?: (connected: boolean) => void
}

export function useConversationChannel(
  topic: string | null,
  handlers: ConversationChannelHandlers,
  selfUserId: string | null = null
): { sendTyping: () => void } {
  const handler = useRef(handlers)

  useEffect(() => {
    handler.current = handlers
  })

  useEffect(() => {
    if (!topic) return
    return joinTopic(topic, handler)
  }, [topic])

  // THROTTLED TO ONE EVERY THREE SECONDS. A receiving client shows "typing" for five seconds after the
  // last event, so this keeps the indicator steady while somebody types without a message per keystroke.
  const lastSent = useRef(0)
  const sendTyping = useCallback(() => {
    if (!topic) return
    const now = Date.now()
    if (now - lastSent.current < TYPING_THROTTLE_MS) return
    const entry = registry.get(topic)
    if (!entry?.channel || !entry.subscribed) return
    lastSent.current = now
    void entry.channel.send({ type: "broadcast", event: "typing", payload: { user_id: selfUserId } })
  }, [topic, selfUserId])

  return { sendTyping }
}

/**
 * ONE CHANNEL PER TOPIC FOR THE WHOLE APP, shared by every window onto that conversation.
 *
 * The compact messenger and the full conversation can both be listening to one conversation in the same
 * moment -- "View Full Conversation" opens the screen while the panel is still closing. supabase-js does
 * not allow two channels on one topic: the second `.channel(topic)` is the first one, part-way through
 * being removed, and a typing event sent on it goes nowhere. So the channel is held here, counted by
 * the windows using it, and every event is handed to each of them; it is removed only when the last
 * window leaves.
 */
type Listener = { current: ConversationChannelHandlers }
interface TopicEntry {
  channel: ReturnType<typeof supabase.channel> | null
  subscribed: boolean
  everJoined: boolean
  listeners: Set<Listener>
  closed: boolean
}
const registry = new Map<string, TopicEntry>()
// A topic whose last window has just left is still being removed; a window joining it again waits for that.
const removing = new Map<string, Promise<unknown>>()

function joinTopic(topic: string, listener: Listener): () => void {
  let entry = registry.get(topic)
  if (!entry) {
    const created: TopicEntry = { channel: null, subscribed: false, everJoined: false, listeners: new Set(), closed: false }
    entry = created
    registry.set(topic, created)
    void (async () => {
      await removing.get(topic)
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (created.closed || !session) return
      await supabase.realtime.setAuth(session.access_token)
      if (created.closed) return
      const channel = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } })
      const each = (fn: (h: ConversationChannelHandlers) => void) => created.listeners.forEach((l) => fn(l.current))
      channel
        .on("broadcast", { event: "fixture_message_inserted" }, () => each((h) => h.onMessage?.()))
        .on("broadcast", { event: "message_reaction_changed" }, (event) => {
          const id = (event.payload as { message_id?: unknown } | undefined)?.message_id
          each((h) => h.onReaction?.(typeof id === "string" ? id : null))
        })
        .on("broadcast", { event: "typing" }, (event) => {
          const from = (event.payload as { user_id?: unknown } | undefined)?.user_id
          each((h) => h.onTyping?.(typeof from === "string" ? from : null))
        })
        .on("broadcast", { event: "message_read" }, () => each((h) => h.onRead?.()))
      created.channel = channel
      channel.subscribe((status) => {
        const was = created.subscribed
        created.subscribed = status === "SUBSCRIBED"
        // A channel that dropped and came back means messages may have arrived meanwhile: re-read.
        if (created.subscribed && created.everJoined && !was) each((h) => h.onMessage?.())
        if (created.subscribed) created.everJoined = true
        if (created.everJoined && was !== created.subscribed) each((h) => h.onConnection?.(created.subscribed))
      })
    })()
  }
  entry.listeners.add(listener)
  const joined = entry
  return () => {
    joined.listeners.delete(listener)
    if (joined.listeners.size > 0) return
    joined.closed = true
    joined.subscribed = false
    if (registry.get(topic) === joined) registry.delete(topic)
    if (joined.channel) {
      const removal = supabase.removeChannel(joined.channel).finally(() => {
        if (removing.get(topic) === removal) removing.delete(topic)
      })
      removing.set(topic, removal)
    }
  }
}

/** The original single-purpose hook, kept for callers that only need "a message arrived". */
export function useConversationRealtime(topic: string | null, onMessage: () => void) {
  useConversationChannel(topic, { onMessage })
}

export const TYPING_THROTTLE_MS = 3_000
export const TYPING_VISIBLE_MS = 5_000

/**
 * The topic for a conversation, in the platform's own scheme
 * (`internal.message_realtime_topic`): c club, t team, s safeguarding, a announcement, d direct,
 * f fixture, r request. Written here as a mapping rather than a string built at each call site, so a
 * typo produces no subscription rather than a wrong one.
 */
const TOPIC_PREFIX: Record<string, string> = {
  direct: "presence:d:",
  fixture: "presence:f:",
  request: "presence:r:",
  club: "presence:c:",
}

export function conversationTopic(kind: string, conversationId: string | null): string | null {
  const prefix = TOPIC_PREFIX[kind]
  if (!prefix || !conversationId) return null
  return `${prefix}${conversationId}`
}
