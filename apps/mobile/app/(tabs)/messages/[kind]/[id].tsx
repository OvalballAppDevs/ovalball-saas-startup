import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { ThreadMessage } from "@ovalball/contracts"

import { supabase } from "../../../../src/auth/supabase"
import { useSession } from "../../../../src/auth/session"
import { useAppContexts } from "../../../../src/context/contexts"
import {
  loadConversation,
  loadOlderMessages,
  markRead,
  sendMessage,
  type Conversation,
  type ConversationKind,
} from "../../../../src/messages/conversation"
import { conversationTopic, useConversationRealtime } from "../../../../src/messages/realtime"
import { clearDraft, readDraft, writeDraft } from "../../../../src/messages/drafts"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { PersonAvatar } from "../../../../src/components/identity"
import { ChevronRight } from "../../../../src/components/icons"
import { CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { TOUCH_TARGET, colour, radius, space, type } from "../../../../src/design/tokens"

/**
 * A CONVERSATION.
 *
 * THE ID IS NOT THE AUTHORITY. It arrives from a tap or from a deep link, and either way the server
 * decides: every read goes through RLS or an RPC scoped to the caller, so an id for a conversation
 * this person is not in returns nothing and this screen says so. There is no membership check here to
 * get wrong.
 *
 * READ-ONLY IS A STATE, NOT AN ABSENCE. A conversation that cannot be replied to is still shown --
 * closed club threads, a resolved request, a direct thread that is no longer available. Hiding it
 * would lose the history somebody is entitled to read. When the reason is a DIRECT thread's
 * unavailability, the sentence is the canonical undifferentiated one: block in either direction,
 * messaging switched off and a lapsed relationship all read identically, because the difference is
 * exactly what must not be disclosed.
 *
 * READING IS NOT RESOLVING. `markRead` clears the unread state for a direct conversation, which is
 * what the platform means by read. It does not touch any notification's resolved state, and nothing
 * here treats having seen a message as having dealt with it.
 */
export default function ConversationScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { session } = useSession()
  const { refreshUnread } = useAppContexts()
  // BOTH COME FROM THE PATH NOW. The route is /messages/<kind>/<id>, which is the same shape the
  // links Ovalball issues already use -- so a link tapped on a cold start matches a real route rather
  // than falling through to Unmatched Route before any handler can help.
  const params = useLocalSearchParams<{ id: string; kind?: string }>()
  const id = String(params.id ?? "")
  const rawKind = String(params.kind ?? "direct")
  const kind = (["direct", "fixture", "request", "club"].includes(rawKind) ? rawKind : "direct") as ConversationKind

  const list = useRef<FlatList<ThreadMessage>>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const viewerId = session?.user.id ?? null
  const draftKey = `${kind}:${id}`

  const load = useCallback(async () => {
    if (!session?.user || !id) return
    setProblem(null)
    try {
      const loaded = await loadConversation(supabase, kind, id, session.user.id)
      if (!loaded) {
        setMissing(true)
        return
      }
      setConversation(loaded)
      await markRead(supabase, kind, id)
      await refreshUnread()
    } catch (caught) {
      const failure = friendly(caught, "this conversation")
      logDetail("conversation", failure)
      setProblem(failure.message)
    }
  }, [session, id, kind, refreshUnread])

  useEffect(() => {
    void load()
  }, [load])

  // THE DRAFT SURVIVES THE KEYBOARD, THE APP BACKGROUNDING AND A FAILED SEND. Read once per
  // conversation and per person, so one identity's unsent line is never offered to another.
  useEffect(() => {
    if (!viewerId) return
    let live = true
    void readDraft(viewerId, draftKey).then((saved) => {
      if (live && saved) setDraft(saved)
    })
    return () => {
      live = false
    }
  }, [viewerId, draftKey])

  useEffect(() => {
    if (!viewerId) return
    void writeDraft(viewerId, draftKey, draft)
  }, [viewerId, draftKey, draft])

  // LIVE, THROUGH THE PLATFORM'S OWN BROADCAST. It carries no content, so the reaction is to re-read
  // through RLS -- the same thing the website does, and the reason reusing it adds no new way for a
  // message to reach a device.
  useConversationRealtime(conversationTopic(kind, conversation?.conversationId ?? null), () => {
    void load()
  })

  const older = useCallback(async () => {
    if (loadingOlder || !conversation?.hasMore || !viewerId) return
    const oldest = conversation.messages[0]
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const page = await loadOlderMessages(supabase, kind, id, viewerId, oldest)
      setConversation((current) =>
        current
          ? {
              ...current,
              // Prepended, and de-duplicated by id: a message that arrived while the page was in
              // flight must not appear twice.
              messages: dedupe([...page.messages, ...current.messages]),
              hasMore: page.hasMore,
            }
          : current
      )
    } catch (caught) {
      logDetail("older messages", friendly(caught, "older messages"))
    } finally {
      setLoadingOlder(false)
    }
  }, [loadingOlder, conversation, viewerId, kind, id])

  async function send() {
    // Guarded against a double tap as well as disabled: a slow network is exactly when somebody presses
    // twice, and two identical messages is the result nobody wants.
    if (sending || !draft.trim() || !session?.user) return
    setSending(true)
    setSendError(null)
    const body = draft
    // CLEARED OPTIMISTICALLY, RESTORED ON FAILURE -- but the MESSAGE is not shown until the server has
    // it. A bubble that appears sent and later turns out not to be is the one outcome worth avoiding
    // in a product where somebody may act on having told a parent something.
    setDraft("")
    const result = await sendMessage(supabase, kind, id, session.user.id, body)
    setSending(false)
    if (!result.ok) {
      // The draft comes back, so a failed send never loses what somebody wrote, and the composer is
      // ready to try again.
      setDraft(body)
      setSendError(result.message)
      return
    }
    if (viewerId) await clearDraft(viewerId, draftKey)
    await load()
    // The newest message is at the TOP of the list, so that is where to be.
    requestAnimationFrame(() => list.current?.scrollToOffset({ offset: 0, animated: true }))
  }

  if (missing) {
    return (
      <Shell
        title="Messages"
        onBack={() => router.back()}
        insets={insets}
        messages={[]}
        header={
          <EmptyState
            title="This conversation isn't available"
            body="It may have been removed, or it may not be one you have access to. Your other conversations are in Messages."
          />
        }
      />
    )
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
      style={{ flex: 1, backgroundColor: colour.chalk }}
    >
      <Shell
        title={conversation?.title ?? "Conversation"}
        subtitle={conversation?.subtitle ?? undefined}
        onBack={() => router.back()}
        insets={insets}
        listRef={list}
        // NEWEST FIRST, which is the website's order. Sorted once, here, because the canonical reader
        // returns ascending and no screen should assume which way it came.
        messages={[...(conversation?.messages ?? [])].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )}
        onEndReached={older}
        loadingOlder={loadingOlder}
        hasMore={conversation?.hasMore ?? false}
        header={
          <>
            {problem && <ErrorState message={problem} onRetry={load} />}
            {!problem && conversation === null && (
              <>
                <CardSkeleton lines={2} />
                <CardSkeleton lines={1} />
              </>
            )}
            {conversation?.messages.length === 0 && (
              <EmptyState title="No messages yet" body="Start the conversation below." />
            )}
          </>
        }
      />

      {conversation && (
        <Composer
          canSend={conversation.canSend}
          unavailableReason={conversation.unavailableReason}
          draft={draft}
          onChange={setDraft}
          onSend={send}
          sending={sending}
          error={sendError}
          bottomInset={insets.bottom}
        />
      )}
    </KeyboardAvoidingView>
  )
}

/**
 * THE CONVERSATION, AS A VIRTUALISED LIST.
 *
 * A ScrollView renders every child; a club thread with six hundred messages would build six hundred
 * views before the first frame. FlatList renders a window, which is what keeps a long conversation
 * smooth -- and is why `messages` is passed as data rather than mapped into children.
 *
 * NEWEST AT THE TOP, which is the website's order. So "load older" belongs at the END of the list,
 * and reaching the end is what asks for it.
 */
function Shell({
  title,
  subtitle,
  onBack,
  insets,
  listRef,
  messages,
  header,
  onEndReached,
  loadingOlder,
  hasMore,
}: {
  title: string
  subtitle?: string
  onBack: () => void
  insets: { top: number; bottom: number }
  listRef?: React.RefObject<FlatList<ThreadMessage> | null>
  messages: ThreadMessage[]
  /** Loading, error and empty states sit above the list rather than inside it. */
  header?: React.ReactNode
  onEndReached?: () => void
  loadingOlder?: boolean
  hasMore?: boolean
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colour.chalk }}>
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.sm,
          paddingHorizontal: space.md,
          backgroundColor: colour.chalk,
          borderBottomWidth: 1,
          borderBottomColor: colour.line,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Messages"
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View style={{ transform: [{ rotate: "180deg" }] }}>
            <ChevronRight size={22} color={colour.ink} />
          </View>
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={[type.heading, { color: colour.ink }]}>
            {title}
          </Text>
          {!!subtitle && (
            <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
              {subtitle}
            </Text>
          )}
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(message) => message.id}
        renderItem={({ item }) => <Bubble message={item} />}
        ListHeaderComponent={header ? <View style={{ gap: space.md }}>{header}</View> : null}
        ListFooterComponent={
          loadingOlder ? (
            <View accessible accessibilityLabel="Loading older messages" style={{ paddingVertical: space.lg, alignItems: "center" }}>
              <ActivityIndicator color={colour.forest800} />
            </View>
          ) : null
        }
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        onEndReached={hasMore ? onEndReached : undefined}
        onEndReachedThreshold={0.4}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // A conversation is read from the top, so keeping a few screens of window is enough.
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={7}
      />
    </View>
  )
}

/**
 * OWNERSHIP COMES FROM THE SENDER, AND THE COLOURS ARE THE PLATFORM'S.
 *
 * MINE IS BLUE AND ON THE RIGHT; RECEIVED IS MINT AND ON THE LEFT. That is the website's rule
 * (`components/messenger/message-thread.tsx`), and the first mobile draft had it inverted -- forest
 * for mine, white for received -- which misattributes every message on the screen to the wrong side
 * of the conversation for anybody who has learned the product in a browser.
 *
 * `isOwn` is the server reader's answer. The canonical type carries a note about exactly why: a
 * club-scoped flag once coloured a colleague's messages as the reader's own, and "who said this" has
 * to survive switching context.
 */
function Bubble({ message }: { message: ThreadMessage }) {
  // `isOwn` IS THE ANSWER, and it is the server reader's. Recomputing it here from a sender id would
  // be a second opinion about attribution -- and the canonical type carries a note about exactly that:
  // a club-scoped flag once coloured a colleague's messages as the reader's own.
  const mine = message.isOwn
  const when = new Date(message.createdAt)
  const time = Number.isNaN(when.getTime())
    ? ""
    : when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

  if (message.isSystemEvent) {
    return (
      <Text accessibilityRole="text" style={[type.caption, { color: colour.inkSubtle, textAlign: "center" }]}>
        {message.body}
      </Text>
    )
  }

  return (
    <View
      accessible
      accessibilityLabel={`${mine ? "You" : message.senderName} at ${time}. ${message.body}`}
      style={{ flexDirection: "row", gap: space.sm, alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%" }}
    >
      {/* The sender's OWN picture, already resolved by the canonical reader from the private
          avatars bucket. A person, never a club crest. */}
      {!mine && <PersonAvatar name={message.senderName} url={message.senderAvatarUrl} size={28} />}
      <View
        style={{
          backgroundColor: mine ? colour.messengerBlue : colour.mint100,
          borderRadius: radius.lg,
          borderWidth: 0,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          flexShrink: 1,
        }}
      >
        {!mine && !!message.senderName && (
          <Text style={[type.caption, { color: colour.forest800, fontFamily: type.smallMedium.fontFamily }]}>
            {message.senderName}
            {!!message.senderRoleLabel && (
              <Text style={{ color: colour.inkSubtle }}> · {message.senderRoleLabel}</Text>
            )}
          </Text>
        )}
        <Text
          style={[
            type.body,
            {
              color: message.isDeleted ? (mine ? "rgba(255,255,255,0.7)" : colour.inkSubtle) : mine ? colour.onForest : colour.forest950,
              fontSize: 15,
              fontStyle: message.isDeleted ? "italic" : "normal",
            },
          ]}
        >
          {message.body}
        </Text>
        <Text style={[type.caption, { color: mine ? "rgba(255,255,255,0.75)" : colour.inkMuted, fontSize: 10, marginTop: 2, textAlign: "right" }]}>
          {time}
        </Text>
      </View>
    </View>
  )
}

function Composer({
  canSend,
  unavailableReason,
  draft,
  onChange,
  onSend,
  sending,
  error,
  bottomInset,
}: {
  canSend: boolean
  unavailableReason: string | null
  draft: string
  onChange: (value: string) => void
  onSend: () => void
  sending: boolean
  error: string | null
  bottomInset: number
}) {
  if (!canSend) {
    return (
      <View style={{ padding: space.lg, paddingBottom: bottomInset + space.lg, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.surface }}>
        <Text accessibilityRole="text" style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>
          {unavailableReason ?? "You can read this conversation but not reply to it."}
        </Text>
      </View>
    )
  }

  const ready = draft.trim().length > 0 && !sending

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.surface, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: bottomInset + space.sm }}>
      {!!error && (
        <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, marginBottom: 6 }]}>
          {error}
        </Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
        <TextInput
          accessibilityLabel="Message"
          value={draft}
          onChangeText={onChange}
          placeholder="Message"
          placeholderTextColor={colour.inkSubtle}
          multiline
          selectionColor={colour.pitch600}
          style={[
            type.body,
            {
              flex: 1,
              minHeight: TOUCH_TARGET,
              maxHeight: 120,
              paddingHorizontal: space.md,
              paddingTop: 11,
              paddingBottom: 11,
              borderRadius: radius.xl,
              borderWidth: 1,
              borderColor: colour.lineStrong,
              backgroundColor: colour.chalk,
              color: colour.ink,
              fontSize: 15,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !ready, busy: sending }}
          disabled={!ready}
          onPress={onSend}
          style={({ pressed }) => ({
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            borderRadius: TOUCH_TARGET / 2,
            backgroundColor: ready ? colour.forest800 : colour.lineStrong,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <ChevronRight size={20} color={colour.onForest} strokeWidth={2.6} />
        </Pressable>
      </View>
    </View>
  )
}

/**
 * One message, once.
 *
 * A page of older history and a live arrival can overlap -- the page was in flight when the message
 * landed -- and the same row would then be rendered twice with the same key, which React reports and a
 * person simply sees. Keyed by id, keeping the first occurrence.
 */
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
