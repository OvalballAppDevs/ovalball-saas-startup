import { useCallback, useEffect, useRef, useState } from "react"
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
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
import { loadConversation, markRead, sendMessage, type Conversation, type ConversationKind } from "../../../../src/messages/conversation"
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

  const scroller = useRef<ScrollView>(null)
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [missing, setMissing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

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

  async function send() {
    // Guarded against a double tap as well as disabled: a slow network is exactly when somebody presses
    // twice, and two identical messages is the result nobody wants.
    if (sending || !draft.trim() || !session?.user) return
    setSending(true)
    setSendError(null)
    const body = draft
    setDraft("")
    const result = await sendMessage(supabase, kind, id, session.user.id, body)
    setSending(false)
    if (!result.ok) {
      // The draft comes back, so a failed send never loses what somebody wrote.
      setDraft(body)
      setSendError(result.message)
      return
    }
    await load()
    // The new message lands at the TOP, so that is where to be -- scrolling to the end would take
    // somebody to the oldest message in the thread, which is the opposite of what they just did.
    requestAnimationFrame(() => scroller.current?.scrollTo({ y: 0, animated: true }))
  }

  if (missing) {
    return (
      <Shell title="Messages" onBack={() => router.back()} insets={insets}>
        <EmptyState
          title="This conversation isn't available"
          body="It may have been removed, or it may not be one you have access to. Your other conversations are in Messages."
        />
      </Shell>
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
        scrollRef={scroller}
      >
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
        {/*
          NEWEST AT THE TOP, which is the website's order and therefore the product's
          (`components/messenger/message-thread.tsx`: sorted descending, so arrivals land at the top
          and never move what somebody is reading). The canonical reader returns ascending, so the
          reversal happens once, here, rather than being assumed anywhere.
        */}
        {[...(conversation?.messages ?? [])]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
      </Shell>

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

function Shell({
  title,
  subtitle,
  onBack,
  insets,
  children,
  scrollRef,
  onContentSizeChange,
}: {
  title: string
  subtitle?: string
  onBack: () => void
  insets: { top: number; bottom: number }
  children: React.ReactNode
  scrollRef?: React.RefObject<ScrollView | null>
  onContentSizeChange?: () => void
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

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        onContentSizeChange={onContentSizeChange}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="interactive"
      >
        {children}
      </ScrollView>
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
