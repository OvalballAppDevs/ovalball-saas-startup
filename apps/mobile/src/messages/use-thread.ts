import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  applyReactionLocally,
  loadReactions,
  loadReceipts,
  markThreadRead,
  newClientMessageId,
  sendVoiceMessage,
  setMessageReaction,
  type MessageReaction,
  type MessageReceipt,
  type ThreadMessage,
  type VoiceTarget,
} from "@ovalball/contracts"

import { supabase } from "../auth/supabase"
import { friendly, logDetail } from "../errors/translate"
import { loadConversation, loadOlderMessages, markRead, sendMessage, type Conversation, type ConversationKind } from "./conversation"
import { conversationTopic, TYPING_VISIBLE_MS, useConversationChannel } from "./realtime"
import { clearDraft, readDraft, writeDraft } from "./drafts"
import { buildItems, quoteOf, type PendingSend } from "./thread-items"

export { buildItems, dayLabel, quoteOf, type PendingSend, type ThreadItem } from "./thread-items"

/**
 * ONE OPEN CONVERSATION, FOR EVERY SURFACE THAT OPENS ONE.
 *
 * The compact messenger in the header and the full conversation screen are two windows onto the same
 * conversation, so they share this hook rather than each keeping its own idea of what was sent, what
 * failed and what has been read. A change to how sending, retrying or reacting behaves lands in both.
 *
 * READING IS PER CONVERSATION. Only mounting this hook for a conversation -- which happens when somebody
 * actually opens it -- marks it read, and it marks only that one. Listing conversations never does.
 *
 * READ RECEIPTS ARE THE SERVER'S. Opening the conversation records "read" up to the newest message
 * (`mark_thread_read`) -- the reader's own act, and the only way a read is ever written. The sender's ticks
 * come back from `message_receipts` and are refreshed live when somebody reads.
 *
 * A MESSAGE IS NEVER SHOWN AS SENT BEFORE THE SERVER HAS IT. A pending send is drawn as pending
 * ("Sending…"), then either replaced by the stored message or marked "Not sent" with Retry. Retry reuses
 * the same client reference, so the server keeps one message however many times it is pressed.
 */

export interface UseThreadOptions {
  kind: ConversationKind
  id: string
  viewerId: string | null
  /** How many messages were unread when this was opened, for the "New messages" line. Unknown is fine. */
  initialUnread?: number
  /** Called after the conversation has been marked read, so a badge can recount. */
  onRead?: () => void | Promise<void>
}

export function useThread({ kind, id, viewerId, initialUnread = 0, onRead }: UseThreadOptions) {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [pending, setPending] = useState<PendingSend[]>([])
  const [reactionProblem, setReactionProblem] = useState<string | null>(null)
  const [otherTypingAt, setOtherTypingAt] = useState<number | null>(null)
  const [receipts, setReceipts] = useState<Map<string, MessageReceipt>>(new Map())
  const [connected, setConnected] = useState(true)
  // The "New messages" line is fixed when the conversation opens and stays there while it is read:
  // moving it as messages arrive would make it point at the wrong place.
  const unreadAtOpen = useRef(initialUnread)
  const conversationRef = useRef(conversation)
  useEffect(() => {
    conversationRef.current = conversation
  })
  const onReadRef = useRef(onRead)
  useEffect(() => {
    onReadRef.current = onRead
  })

  // Receipts for MY messages among those shown -- the server answers nothing else.
  async function refreshReceiptsFor(messages: ThreadMessage[]) {
    const mine = messages.filter((m) => m.isOwn && !m.isDeleted && !m.isSystemEvent).map((m) => m.id)
    if (mine.length === 0) return
    const fresh = await loadReceipts(supabase, mine.slice(-60))
    setReceipts(fresh)
  }

  const load = useCallback(async () => {
    if (!viewerId || !id) return
    setProblem(null)
    try {
      const loaded = await loadConversation(supabase, kind, id, viewerId)
      if (!loaded) {
        setMissing(true)
        return
      }
      setConversation((current) => mergeLoaded(current, loaded))
      // Stored messages that a pending send was waiting for: the pending bubble is no longer needed.
      const stored = new Set(loaded.messages.map((m) => m.clientMessageId).filter(Boolean))
      setPending((list) => list.filter((p) => !stored.has(p.clientMessageId)))
      // READ, AS FAR AS THE NEWEST MESSAGE ON SCREEN -- recorded by the reader, for the sender's ticks.
      const newest = newestOf(loaded.messages.filter((m) => !m.isSystemEvent))
      await Promise.all([
        markRead(supabase, kind, id),
        newest ? markThreadRead(supabase, newest.id) : Promise.resolve(0),
        refreshReceiptsFor(loaded.messages),
      ])
      await onReadRef.current?.()
    } catch (caught) {
      const failure = friendly(caught, "this conversation")
      logDetail("conversation", failure)
      setProblem(failure.message)
    }
  }, [viewerId, id, kind])

  useEffect(() => {
    setConversation(null)
    setMissing(false)
    setPending([])
    unreadAtOpen.current = initialUnread
    void load()
    // `initialUnread` is read once per conversation, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const refreshReceipts = useCallback(async () => {
    await refreshReceiptsFor(conversationRef.current?.messages ?? [])
  }, [])

  const refreshReactions = useCallback(async () => {
    if (!viewerId) return
    const ids = (conversation?.messages ?? []).map((m) => m.id)
    if (ids.length === 0) return
    const fresh = await loadReactions(supabase, ids, viewerId)
    setConversation((current) =>
      current ? { ...current, messages: current.messages.map((m) => (fresh.has(m.id) ? { ...m, reactions: fresh.get(m.id) } : m)) } : current
    )
  }, [conversation, viewerId])

  const { sendTyping } = useConversationChannel(
    conversationTopic(kind, conversation?.conversationId ?? null),
    {
      onMessage: () => {
        setOtherTypingAt(null)
        void load()
      },
      onReaction: () => void refreshReactions(),
      onRead: () => void refreshReceipts(),
      onConnection: setConnected,
      // DIRECT ONLY, and the payload's claim is not what is believed: only the two people in a direct
      // conversation can write to its topic, and self-broadcast is off, so any typing event is theirs.
      onTyping: kind === "direct" ? () => setOtherTypingAt(Date.now()) : undefined,
    },
    viewerId
  )

  // The indicator expires on its own; nothing is persisted, so a stale "typing" cannot outlive five seconds.
  useEffect(() => {
    if (otherTypingAt === null) return
    const timer = setTimeout(() => setOtherTypingAt(null), TYPING_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [otherTypingAt])

  const older = useCallback(async () => {
    if (loadingOlder || !conversation?.hasMore || !viewerId) return
    const oldest = oldestOf(conversation.messages)
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const page = await loadOlderMessages(supabase, kind, id, viewerId, oldest)
      setConversation((current) =>
        current ? { ...current, messages: dedupe([...page.messages, ...current.messages]), hasMore: page.hasMore } : current
      )
    } catch (caught) {
      logDetail("older messages", friendly(caught, "older messages"))
    } finally {
      setLoadingOlder(false)
    }
  }, [loadingOlder, conversation, viewerId, kind, id])

  const attempt = useCallback(
    async (send: PendingSend) => {
      const result = send.voice
        ? await sendVoiceMessage(supabase, {
            target: VOICE_TARGET[kind as keyof typeof VOICE_TARGET],
            targetId: id,
            bytes: send.voice.bytes,
            durationMs: send.voice.durationMs,
            clientMessageId: send.clientMessageId,
          })
        : await sendMessage(supabase, kind, id, send.body, send.clientMessageId, send.replyTo?.id ?? null)
      if (!result.ok) {
        setPending((list) =>
          list.map((p) => (p.clientMessageId === send.clientMessageId ? { ...p, state: "failed", error: result.message, retryable: result.retryable } : p))
        )
        return false
      }
      await load()
      return true
    },
    [kind, id, load]
  )

  /** Send a text message. Resolves once the server has answered, either way. */
  const send = useCallback(
    async (body: string, replyTo: ThreadMessage | null = null): Promise<boolean> => {
      const text = body.trim()
      if (!text || !viewerId) return false
      const next: PendingSend = {
        clientMessageId: newClientMessageId(),
        body: text,
        replyTo: replyTo ? quoteOf(replyTo) : null,
        createdAt: new Date().toISOString(),
        state: "sending",
        error: null,
        retryable: true,
      }
      setPending((list) => [...list, next])
      return attempt(next)
    },
    [viewerId, attempt]
  )

  /** Send a recorded voice note: drawn as pending at once, held only until the server has it. */
  const sendVoice = useCallback(
    async (voice: { bytes: ArrayBuffer; durationMs: number }): Promise<boolean> => {
      if (!viewerId || !(kind in VOICE_TARGET)) return false
      const next: PendingSend = {
        clientMessageId: newClientMessageId(),
        body: "",
        replyTo: null,
        createdAt: new Date().toISOString(),
        state: "sending",
        error: null,
        retryable: true,
        voice,
      }
      setPending((list) => [...list, next])
      return attempt(next)
    },
    [viewerId, kind, attempt]
  )

  /** Try a failed send again, as the same message. */
  const retry = useCallback(
    async (clientMessageId: string) => {
      const target = pending.find((p) => p.clientMessageId === clientMessageId)
      if (!target || target.state === "sending") return
      const again = { ...target, state: "sending" as const, error: null }
      setPending((list) => list.map((p) => (p.clientMessageId === clientMessageId ? again : p)))
      await attempt(again)
    },
    [pending, attempt]
  )

  /** Give up on a failed send. Its words are returned so the caller can put them back in the composer. */
  const discard = useCallback(
    (clientMessageId: string): string | null => {
      const target = pending.find((p) => p.clientMessageId === clientMessageId)
      setPending((list) => list.filter((p) => p.clientMessageId !== clientMessageId))
      return target?.body ?? null
    },
    [pending]
  )

  /**
   * React, change a reaction, or take it back. Drawn at once, then replaced by the server's own answer
   * -- or put back exactly as it was if the server refuses.
   */
  const react = useCallback(
    async (messageId: string, emoji: string | null) => {
      setReactionProblem(null)
      const before: MessageReaction[] = conversationRef.current?.messages.find((m) => m.id === messageId)?.reactions ?? []
      setConversation((current) =>
        current
          ? { ...current, messages: current.messages.map((m) => (m.id === messageId ? { ...m, reactions: applyReactionLocally(before, emoji) } : m)) }
          : current
      )
      const result = await setMessageReaction(supabase, messageId, emoji)
      setConversation((current) =>
        current
          ? {
              ...current,
              messages: current.messages.map((m) => (m.id === messageId ? { ...m, reactions: result.ok ? result.reactions : before } : m)),
            }
          : current
      )
      if (!result.ok) setReactionProblem(result.message)
    },
    []
  )

  const items = useMemo(
    () => buildItems(conversation?.messages ?? [], pending, viewerId, unreadAtOpen.current),
    [conversation, pending, viewerId]
  )

  return {
    conversation,
    missing,
    problem,
    items,
    load,
    older,
    loadingOlder,
    send,
    retry,
    discard,
    react,
    reactionProblem,
    clearReactionProblem: () => setReactionProblem(null),
    receipts,
    sendVoice,
    canSendVoice: kind in VOICE_TARGET,
    connected,
    otherTyping: otherTypingAt !== null,
    notifyTyping: kind === "direct" ? sendTyping : () => {},
  }
}

/**
 * THE DRAFT SURVIVES THE KEYBOARD, THE APP BACKGROUNDING AND A FAILED SEND. Read once per conversation
 * and per person, so one identity's unsent line is never offered to another. The compact messenger and
 * the full screen share the key, so a line started in one is waiting in the other.
 */
export function useDraft(viewerId: string | null, kind: string, id: string) {
  const key = `${kind}:${id}`
  const [draft, setDraft] = useState("")
  const hydrated = useRef(false)

  useEffect(() => {
    hydrated.current = false
    setDraft("")
    if (!viewerId) return
    let live = true
    void readDraft(viewerId, key).then((saved) => {
      if (!live) return
      if (saved) setDraft(saved)
      hydrated.current = true
    })
    return () => {
      live = false
    }
  }, [viewerId, key])

  useEffect(() => {
    if (!viewerId || !hydrated.current) return
    void writeDraft(viewerId, key, draft)
  }, [viewerId, key, draft])

  const clear = useCallback(async () => {
    setDraft("")
    if (viewerId) await clearDraft(viewerId, key)
  }, [viewerId, key])

  return { draft, setDraft, clear }
}

/**
 * A fresh page replaces the newest messages but keeps older pages already loaded, so a live arrival does
 * not throw away history somebody scrolled back to read.
 */
function mergeLoaded(current: Conversation | null, loaded: Conversation): Conversation {
  if (!current || current.messages.length <= loaded.messages.length) return loaded
  const oldestLoaded = oldestOf(loaded.messages)
  if (!oldestLoaded) return loaded
  const cutoff = new Date(oldestLoaded.createdAt).getTime()
  const kept = current.messages.filter((m) => new Date(m.createdAt).getTime() < cutoff)
  return { ...loaded, messages: dedupe([...kept, ...loaded.messages]), hasMore: current.hasMore }
}

/** Voice notes ride the attachment model, which a club-to-club thread does not have. */
const VOICE_TARGET: Record<"direct" | "fixture" | "request", VoiceTarget> = { direct: "direct", fixture: "fixture", request: "fixture_request" }

function newestOf(messages: ThreadMessage[]): ThreadMessage | null {
  let newest: ThreadMessage | null = null
  for (const m of messages) if (!newest || m.createdAt > newest.createdAt) newest = m
  return newest
}

function oldestOf(messages: ThreadMessage[]): ThreadMessage | null {
  let oldest: ThreadMessage | null = null
  for (const m of messages) if (!oldest || m.createdAt < oldest.createdAt) oldest = m
  return oldest
}

function dedupe(messages: ThreadMessage[]): ThreadMessage[] {
  const seen = new Set<string>()
  const out: ThreadMessage[] = []
  for (const message of messages) {
    if (seen.has(message.id)) continue
    seen.add(message.id)
    out.push(message)
  }
  return out
}

