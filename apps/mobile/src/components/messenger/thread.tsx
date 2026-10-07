import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native"
import * as Haptics from "expo-haptics"
import { Image } from "expo-image"
import { receiptLabel, receiptState, reactionsAccessibilityLabel, type MessageReceipt, type MessageReaction, type ThreadMessage, type ThreadReplyQuote } from "@ovalball/contracts"

import type { ThreadItem } from "../../messages/use-thread"
import type { Picked } from "../../messages/use-attachments"
import { readableSize } from "../../messages/documents"
import { PersonAvatar } from "../identity"
import { MessageAttachment, MessageDocumentShare } from "../message-attachment"
import { ContactCardBubble } from "../message-actions"
import { ArrowDown, Check, CheckCheck, Mic, Plus, Reply, RotateCcw, Send, Smile, X } from "../icons"
import { VoiceNoteBubble, VoiceRecorderBar, voiceAvailable, type RecordedVoice } from "./voice"
import { TOUCH_TARGET, colour, messenger, radius, space, type } from "../../design/tokens"

/**
 * THE CONVERSATION ITSELF -- one implementation for every window onto it.
 *
 * The compact messenger in the header and the full conversation screen draw the same list, the same
 * bubbles and the same composer from here, at two densities. A change to how a message reads lands in
 * both, which is the only way two windows onto one conversation stay one product.
 *
 * NEWEST AT THE BOTTOM, BESIDE THE COMPOSER. The list is inverted, so the data runs newest-first and
 * "load older" is reaching the end of the data, which is the top of the screen.
 *
 * OWNERSHIP COMES FROM THE SENDER, AND THE COLOURS ARE THE PLATFORM'S: mine is messenger blue on the
 * right, received is mint on the left -- the website's rule, and never the only signal. Every bubble's
 * spoken label starts with who said it.
 */

export interface ThreadListHandle {
  scrollToNewest: () => void
}

export interface ThreadListProps {
  items: ThreadItem[]
  /** Group conversations name each sender; a direct one does not need to. */
  isGroup: boolean
  /** Reacting is posting: offered only where the reader may write in this conversation. */
  canReact: boolean
  compact?: boolean
  loadingOlder?: boolean
  hasMore?: boolean
  onEndReached?: () => void
  /** Loading, error and empty states, drawn above the conversation. */
  header?: React.ReactNode
  /** Something shown at the very bottom, under the newest message: the typing line. */
  footer?: React.ReactNode
  onHold?: (message: ThreadMessage) => void
  onToggleReaction?: (message: ThreadMessage, emoji: string) => void
  onRetry?: (clientMessageId: string) => void
  onDiscard?: (clientMessageId: string) => void
  /** The server's receipts for my own messages. Shown, quietly, under my newest one only. */
  receipts?: Map<string, MessageReceipt>
  /** The height of everything in the thread -- the compact messenger sizes itself to a short conversation. */
  onContentHeight?: (height: number) => void
}

export const ThreadList = forwardRef<ThreadListHandle, ThreadListProps>(function ThreadList(
  { items, isGroup, canReact, compact = false, loadingOlder, hasMore, onEndReached, header, footer, onHold, onToggleReaction, onRetry, onDiscard, receipts, onContentHeight },
  ref
) {
  // ONE STATUS LINE, under my newest stored message -- a conversation is not a delivery dashboard.
  const newestOwnId = items.find((i) => i.type === "message" && i.message.isOwn && !i.pending && !i.message.isSystemEvent && !i.message.isDeleted)?.key ?? null
  const list = useRef<FlatList<ThreadItem>>(null)
  const [awayFromNewest, setAwayFromNewest] = useState(false)

  const scrollToNewest = useCallback(() => {
    list.current?.scrollToOffset({ offset: 0, animated: true })
  }, [])
  useImperativeHandle(ref, () => ({ scrollToNewest }), [scrollToNewest])

  const jumpTo = useCallback(
    (messageId: string) => {
      const index = items.findIndex((i) => i.type === "message" && i.message.id === messageId)
      if (index < 0) return
      try {
        list.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 })
      } catch {
        // An index outside the rendered window is not worth an error; the reader can scroll.
      }
    },
    [items]
  )

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setAwayFromNewest(event.nativeEvent.contentOffset.y > 320)
  }, [])

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        onContentSizeChange={onContentHeight ? (_w, h) => onContentHeight(h) : undefined}
        ref={list}
        inverted
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => {
          if (item.type === "day") return <DayLine label={item.label} />
          if (item.type === "unread") return <UnreadLine count={item.count} />
          return (
            <MessageBubble
              message={item.message}
              pending={item.pending}
              isGroup={isGroup}
              compact={compact}
              // INVERTED: the older neighbour is drawn above, the newer one below.
              groupedAbove={item.groupedWithOlder}
              groupedBelow={item.groupedWithNewer}
              canReact={canReact && !item.pending}
              onHold={onHold}
              onToggleReaction={onToggleReaction}
              onRetry={onRetry}
              onDiscard={onDiscard}
              onQuotePress={jumpTo}
              receipt={item.key === newestOwnId && receipts ? (receipts.get(item.message.id) ?? { readCount: 0, firstReadAt: null, isDirect: !isGroup }) : null}
            />
          )
        }}
        // In an inverted list the HEADER renders at the bottom (the typing line, by the composer) and the
        // FOOTER at the top (loading older, and the loading, error and empty states).
        ListHeaderComponent={footer ? <View>{footer}</View> : null}
        ListFooterComponent={
          <View style={{ gap: space.md }}>
            {loadingOlder ? (
              <View accessible accessibilityLabel="Loading older messages" style={{ paddingVertical: space.lg, alignItems: "center" }}>
                <ActivityIndicator color={colour.forest800} />
              </View>
            ) : null}
            {header}
          </View>
        }
        contentContainerStyle={{ paddingHorizontal: compact ? space.md : space.lg, paddingVertical: compact ? space.sm : space.md }}
        onEndReached={hasMore ? onEndReached : undefined}
        onEndReachedThreshold={0.4}
        onScroll={onScroll}
        scrollEventThrottle={64}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        initialNumToRender={compact ? 12 : 18}
        maxToRenderPerBatch={15}
        windowSize={9}
        onScrollToIndexFailed={() => {}}
      />
      {awayFromNewest && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Jump to the newest message"
          onPress={scrollToNewest}
          style={({ pressed }) => ({
            position: "absolute",
            right: space.md,
            bottom: space.md,
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colour.surface,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: colour.line,
            shadowColor: colour.forest950,
            shadowOpacity: 0.18,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
            transform: [{ scale: pressed ? 0.94 : 1 }],
          })}
        >
          <ArrowDown size={18} color={colour.forest800} strokeWidth={2.2} />
        </Pressable>
      )}
    </View>
  )
})

function DayLine({ label }: { label: string }) {
  if (!label) return null
  return (
    <View accessibilityRole="header" style={{ alignItems: "center", paddingVertical: space.md }}>
      <View style={{ paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: messenger.notice }}>
        <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.inkMuted, fontFamily: type.smallMedium.fontFamily }]}>{label}</Text>
      </View>
    </View>
  )
}

function UnreadLine({ count }: { count: number }) {
  return (
    <View
      accessible
      accessibilityLabel={`${count} new message${count === 1 ? "" : "s"} below`}
      style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.sm }}
    >
      <View style={{ flex: 1, height: 1, backgroundColor: colour.pitch600 }} />
      <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.rugby700, fontFamily: type.smallMedium.fontFamily }]}>New Messages</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colour.pitch600 }} />
    </View>
  )
}

function timeOf(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
}

export function MessageBubble({
  message,
  pending,
  isGroup,
  compact,
  groupedAbove,
  groupedBelow,
  canReact,
  onHold,
  onToggleReaction,
  onRetry,
  onDiscard,
  onQuotePress,
  receipt = null,
}: {
  receipt?: MessageReceipt | null
  message: ThreadMessage
  pending: { clientMessageId: string; state: "sending" | "failed"; error: string | null; retryable: boolean } | null
  isGroup: boolean
  compact: boolean
  /** The message drawn directly above is from the same person, moments apart. */
  groupedAbove: boolean
  /** The message drawn directly below is from the same person, moments apart. */
  groupedBelow: boolean
  canReact: boolean
  onHold?: (message: ThreadMessage) => void
  onToggleReaction?: (message: ThreadMessage, emoji: string) => void
  onRetry?: (clientMessageId: string) => void
  onDiscard?: (clientMessageId: string) => void
  onQuotePress?: (messageId: string) => void
}) {
  const mine = message.isOwn
  const time = timeOf(message.createdAt)

  if (message.isSystemEvent) {
    return (
      <Text accessibilityRole="text" style={[type.caption, { color: colour.inkSubtle, textAlign: "center", paddingVertical: space.sm, paddingHorizontal: space.lg }]}>
        {message.matchDay ? `${message.matchDay} · ${message.body}` : message.body}
      </Text>
    )
  }

  const isVoice = Boolean(message.attachment?.mimeType.startsWith("audio/")) && !message.isDeleted
  const failed = pending?.state === "failed"
  const sending = pending?.state === "sending"
  // Long press reaches what can be done with a message; a pending one has nothing yet.
  const holdable = Boolean(onHold) && !pending && !message.isDeleted
  // In a group the first message of a run carries the sender's name; the last carries their face.
  const showName = isGroup && !mine && !groupedAbove
  const showAvatar = !mine && isGroup
  const avatarVisible = showAvatar && !groupedBelow
  const showMeta = !groupedBelow || Boolean(pending) || Boolean(receipt)
  const reactions = message.reactions ?? []
  const bubbleRadius = compact ? 16 : 18
  const tight = 5

  const spoken = [
    `${mine ? "You" : message.senderName}${time ? ` at ${time}` : ""}.`,
    message.replyTo ? `Replying to ${message.replyTo.senderName}: ${message.replyTo.excerpt}.` : null,
    message.body,
    message.attachment && (message.attachment.mimeType.startsWith("audio/") ? "Voice note." : `Attached: ${message.attachment.filename}.`),
    receipt ? `${receiptLabel(receipt)}.` : null,
    message.documentShare && `Club document: ${message.documentShare.title}.`,
    reactions.length ? `Reactions: ${reactionsAccessibilityLabel(reactions)}` : null,
    sending ? "Sending." : null,
    failed ? `Not sent. ${pending?.error ?? ""}` : null,
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <View style={{ marginTop: groupedAbove ? 2 : compact ? space.sm : space.md, alignItems: mine ? "flex-end" : "flex-start" }}>
      {showName && (
        <Text numberOfLines={1} maxFontSizeMultiplier={1.6} style={[type.caption, { color: colour.rugby700, fontFamily: type.smallMedium.fontFamily, marginLeft: showAvatar ? 36 : 4, marginBottom: 3 }]}>
          {message.senderName}
          {!!message.senderRoleLabel && <Text style={{ color: colour.inkSubtle, fontFamily: type.caption.fontFamily }}> · {message.senderRoleLabel}</Text>}
        </Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: compact ? "88%" : "84%" }}>
        {showAvatar &&
          (avatarVisible ? <PersonAvatar name={message.senderName} url={message.senderAvatarUrl} size={28} /> : <View style={{ width: 28 }} />)}
        <Pressable
          // A VOICE NOTE'S PLAY CONTROL MUST BE REACHABLE on its own, so that bubble is not one grouped element.
          accessible={!isVoice}
          accessibilityLabel={spoken}
          accessibilityHint={holdable ? "Press and hold to react, reply or for more options" : undefined}
          accessibilityActions={holdable ? [{ name: "longpress", label: "Message options" }] : undefined}
          onAccessibilityAction={holdable ? () => onHold?.(message) : undefined}
          onLongPress={
            holdable
              ? () => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                  onHold?.(message)
                }
              : undefined
          }
          delayLongPress={320}
          style={({ pressed }) => ({
            flexShrink: 1,
            backgroundColor: mine ? messenger.mine : messenger.theirs,
            opacity: sending ? 0.72 : pressed && holdable ? 0.9 : 1,
            borderRadius: bubbleRadius,
            borderTopRightRadius: mine && groupedAbove ? tight : bubbleRadius,
            borderBottomRightRadius: mine && groupedBelow ? tight : mine ? 6 : bubbleRadius,
            borderTopLeftRadius: !mine && groupedAbove ? tight : bubbleRadius,
            borderBottomLeftRadius: !mine && groupedBelow ? tight : !mine ? 6 : bubbleRadius,
            borderWidth: failed ? 1.5 : 0,
            borderColor: colour.danger,
            paddingHorizontal: compact ? 12 : 14,
            paddingVertical: compact ? 7 : 9,
          })}
        >
          {!!message.replyTo && <ReplyQuote quote={message.replyTo} mine={mine} onPress={onQuotePress} />}
          {!!message.body && (
            <Text
              selectable={!holdable}
              maxFontSizeMultiplier={2}
              style={[
                type.body,
                {
                  color: message.isDeleted ? (mine ? messenger.onMineSoft : colour.inkMuted) : mine ? messenger.onMine : colour.forest950,
                  fontSize: compact ? 14.5 : 15.5,
                  lineHeight: compact ? 20 : 21.5,
                  fontStyle: message.isDeleted ? "italic" : "normal",
                },
              ]}
            >
              {message.body}
            </Text>
          )}
          {!message.isDeleted && !!message.attachment && message.attachment.mimeType.startsWith("audio/") ? (
            <VoiceNoteBubble
              url={message.attachment.signedUrl}
              durationMs={message.attachment.durationMs ?? null}
              mine={mine}
              pending={Boolean(pending)}
              context={`${mine ? "You" : message.senderName}${time ? ` at ${time}` : ""}.${receipt ? ` ${receiptLabel(receipt)}.` : ""}`}
              onHold={holdable ? () => onHold?.(message) : undefined}
            />
          ) : (
            !message.isDeleted && !!message.attachment && <MessageAttachment attachment={message.attachment} mine={mine} />
          )}
          {!message.isDeleted && !!message.documentShare && <MessageDocumentShare share={message.documentShare} mine={mine} />}
          {!message.isDeleted && !!message.contactCard && <ContactCardBubble card={message.contactCard} mine={mine} />}
        </Pressable>
      </View>

      {reactions.length > 0 && (
        <ReactionChips
          reactions={reactions}
          mine={mine}
          offset={showAvatar ? 36 : 0}
          onToggle={canReact && onToggleReaction ? (emoji) => onToggleReaction(message, emoji) : undefined}
        />
      )}

      {showMeta && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2, marginLeft: showAvatar ? 36 : 6, marginRight: 6 }}>
          {failed ? (
            <>
              <Text accessibilityRole="alert" maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.danger, fontSize: 11 }]}>
                {pending?.error ?? "Not sent"}
              </Text>
              {pending?.retryable && onRetry && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry sending this message"
                  hitSlop={10}
                  onPress={() => onRetry(pending.clientMessageId)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 3, minHeight: 28, paddingHorizontal: 4 }}
                >
                  <RotateCcw size={12} color={colour.forest800} strokeWidth={2.4} />
                  <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.forest800, fontFamily: type.smallMedium.fontFamily, fontSize: 11 }]}>Retry</Text>
                </Pressable>
              )}
              {onDiscard && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove this unsent message"
                  hitSlop={10}
                  onPress={() => onDiscard(pending!.clientMessageId)}
                  style={{ minHeight: 28, justifyContent: "center", paddingHorizontal: 4 }}
                >
                  <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.inkMuted, fontSize: 11 }]}>Remove</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.inkSubtle, fontSize: 10.5, lineHeight: 14 }]}>{sending ? "Sending…" : time}</Text>
              {!!receipt && <ReceiptMark receipt={receipt} />}
            </>
          )}
        </View>
      )}
    </View>
  )
}

/** "✓ Sent" / "✓✓ Read" / "✓✓ Read by 3" -- understated, and never colour alone: the words say it. */
function ReceiptMark({ receipt }: { receipt: MessageReceipt }) {
  const read = receiptState(receipt) === "read"
  const Icon = read ? CheckCheck : Check
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      <Icon size={12} color={read ? messenger.read : colour.inkSubtle} strokeWidth={2.4} />
      <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: read ? messenger.read : colour.inkSubtle, fontSize: 10.5, lineHeight: 14 }]}>
        {receiptLabel(receipt)}
      </Text>
    </View>
  )
}

function ReplyQuote({ quote, mine, onPress }: { quote: ThreadReplyQuote; mine: boolean; onPress?: (id: string) => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Replying to ${quote.senderName}: ${quote.excerpt}. Shows that message`}
      onPress={onPress ? () => onPress(quote.id) : undefined}
      style={{
        marginBottom: 6,
        paddingVertical: 5,
        paddingHorizontal: 9,
        borderRadius: 10,
        borderLeftWidth: 3,
        borderLeftColor: mine ? messenger.onMineSoft : colour.pitch600,
        backgroundColor: mine ? messenger.onMineFaint : messenger.onTheirsSoft,
      }}
    >
      <Text numberOfLines={1} maxFontSizeMultiplier={1.6} style={[type.caption, { color: mine ? colour.onForest : colour.rugby700, fontFamily: type.smallMedium.fontFamily }]}>
        {quote.senderName}
      </Text>
      <Text numberOfLines={2} maxFontSizeMultiplier={1.6} style={[type.caption, { color: mine ? messenger.onMineSoft : colour.inkMuted, fontStyle: quote.isDeleted ? "italic" : "normal" }]}>
        {quote.excerpt}
      </Text>
    </Pressable>
  )
}

function ReactionChips({
  reactions,
  mine,
  offset,
  onToggle,
}: {
  reactions: MessageReaction[]
  mine: boolean
  offset: number
  onToggle?: (emoji: string) => void
}) {
  return (
    <View
      accessible={!onToggle}
      accessibilityLabel={!onToggle ? reactionsAccessibilityLabel(reactions) : undefined}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 3, marginTop: -7, marginLeft: mine ? 0 : offset + 10, marginRight: mine ? 10 : 0, justifyContent: mine ? "flex-end" : "flex-start", zIndex: 1 }}
    >
      {reactions.map((r) => (
        <Pressable
          key={r.emoji}
          accessibilityRole={onToggle ? "button" : undefined}
          accessibilityLabel={reactionsAccessibilityLabel([r])}
          accessibilityHint={onToggle ? (r.mine ? "Takes your reaction back" : "Reacts with this too") : undefined}
          disabled={!onToggle}
          onPress={onToggle ? () => onToggle(r.emoji) : undefined}
          hitSlop={4}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 3,
            minHeight: 22,
            paddingHorizontal: r.count > 1 ? 6 : 5,
            borderRadius: radius.pill,
            backgroundColor: r.mine ? colour.mint100 : colour.surface,
            borderWidth: 1,
            borderColor: r.mine ? messenger.onTheirsLine : colour.line,
            shadowColor: colour.forest950,
            shadowOpacity: 0.06,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 1 },
            transform: [{ scale: pressed ? 0.94 : 1 }],
          })}
        >
          <Text allowFontScaling={false} style={{ fontSize: 12.5, lineHeight: 16 }}>
            {r.emoji}
          </Text>
          {r.count > 1 && <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: r.mine ? colour.rugby700 : colour.inkMuted, fontSize: 11, fontFamily: type.smallMedium.fontFamily }]}>{r.count}</Text>}
        </Pressable>
      ))}
    </View>
  )
}

/** "Ffion is typing…" -- a direct conversation only, and gone five seconds after the last keystroke. */
export function TypingLine({ name }: { name: string }) {
  return (
    <View accessibilityLiveRegion="polite" accessible accessibilityLabel={`${name} is typing`} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: space.sm, paddingLeft: 4 }}>
      <View style={{ flexDirection: "row", gap: 3, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 14, backgroundColor: colour.mint100 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colour.forest800, opacity: 0.35 + i * 0.2 }} />
        ))}
      </View>
      <Text maxFontSizeMultiplier={1.4} style={[type.caption, { color: colour.inkMuted }]}>{name} is typing…</Text>
    </View>
  )
}

const EMOJI_TRAY = ["👍", "❤️", "😂", "🎉", "👏", "🙌", "🏉", "💪", "🙏", "😀", "😮", "😢", "✅", "⚽", "🌧️", "☀️"]

/**
 * `[ + ] [ Message ☺ ] [ ➤ ]` -- under the conversation, beside the newest message. Return sends; a long
 * message still wraps.
 *
 * One composer for both windows. The attach control is a full touch target, not a glyph inside the
 * field; the emoji control opens a small tray of the ones a rugby club actually sends, inserted where
 * the cursor is (the keyboard's own emoji key is still there for everything else). There is no
 * microphone, because Ovalball has no voice messages and a button for one would be a lie.
 */
export function Composer({
  canSend,
  unavailableReason,
  draft,
  onChange,
  onSend,
  error,
  onAttach,
  attachBusy,
  replyingTo,
  onCancelReply,
  quickReplies,
  onQuickReply,
  onTyping,
  bottomInset = 0,
  compact = false,
  accessory,
  sendReady,
  inputRef,
  onVoice,
}: {
  /** Present where a voice note can be sent; the microphone then takes the send button's place while the field is empty. */
  onVoice?: (voice: RecordedVoice) => void
  canSend: boolean
  unavailableReason: string | null
  draft: string
  onChange: (value: string) => void
  onSend: () => void
  error?: string | null
  onAttach?: () => void
  attachBusy?: boolean
  replyingTo?: ThreadReplyQuote | null
  onCancelReply?: () => void
  quickReplies?: readonly string[]
  onQuickReply?: (text: string) => void
  onTyping?: () => void
  bottomInset?: number
  compact?: boolean
  /** Something above the input row, such as the tray for a chosen photo. */
  accessory?: React.ReactNode
  /** A send is ready when there is text or the accessory says so. */
  sendReady?: boolean
  inputRef?: React.RefObject<TextInput | null>
}) {
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const selection = useRef<{ start: number; end: number } | null>(null)

  if (!canSend) {
    return (
      <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: bottomInset + space.md, borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.surface }}>
        <Text accessibilityRole="text" style={[type.small, { color: colour.inkMuted, textAlign: "center" }]}>
          {unavailableReason ?? "You can read this conversation but not reply to it."}
        </Text>
      </View>
    )
  }

  const ready = sendReady ?? draft.trim().length > 0

  function insert(emoji: string) {
    const at = selection.current ?? { start: draft.length, end: draft.length }
    const next = draft.slice(0, at.start) + emoji + draft.slice(at.end)
    const caret = at.start + emoji.length
    selection.current = { start: caret, end: caret }
    onChange(next)
    onTyping?.()
  }

  const size = compact ? 40 : TOUCH_TARGET

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.surface, paddingHorizontal: compact ? space.sm : space.md, paddingTop: space.sm, paddingBottom: bottomInset + space.sm }}>
      {!!error && (
        <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, marginBottom: 6, paddingHorizontal: 4 }]}>
          {error}
        </Text>
      )}

      {!!replyingTo && (
        <View
          accessible
          accessibilityLabel={`Replying to ${replyingTo.senderName}: ${replyingTo.excerpt}`}
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.sm, paddingLeft: space.sm, borderLeftWidth: 3, borderLeftColor: colour.pitch600 }}
        >
          <Reply size={15} color={colour.rugby700} strokeWidth={2.2} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={[type.caption, { color: colour.rugby700, fontFamily: type.smallMedium.fontFamily }]}>
              Replying to {replyingTo.senderName}
            </Text>
            <Text numberOfLines={1} style={[type.caption, { color: colour.inkMuted }]}>
              {replyingTo.excerpt}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" onPress={onCancelReply} hitSlop={8} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
            <X size={17} color={colour.inkMuted} strokeWidth={2.2} />
          </Pressable>
        </View>
      )}

      {accessory}

      {!!quickReplies?.length && !ready && !replyingTo && onQuickReply && (
        <View accessibilityLabel="Quick replies" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: space.sm - 2 }}>
          {quickReplies.map((text) => (
            <Pressable
              key={text}
              accessibilityRole="button"
              accessibilityLabel={`Send “${text}”`}
              onPress={() => {
                void Haptics.selectionAsync()
                onQuickReply(text)
              }}
              hitSlop={{ top: 7, bottom: 7 }}
              style={({ pressed }) => ({
                minHeight: 30,
                justifyContent: "center",
                paddingHorizontal: 11,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: colour.line,
                backgroundColor: pressed ? colour.mint100 : colour.chalk,
              })}
            >
              <Text maxFontSizeMultiplier={1.5} style={[type.caption, { color: colour.forest800, fontSize: 13, lineHeight: 17 }]}>{text}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {emojiOpen && (
        <View accessibilityLabel="Emoji" style={{ flexDirection: "row", flexWrap: "wrap", gap: 2, marginBottom: space.sm }}>
          {EMOJI_TRAY.map((emoji) => (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`Insert ${emoji}`}
              onPress={() => insert(emoji)}
              style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? colour.line : "transparent" })}
            >
              <Text allowFontScaling={false} style={{ fontSize: 23, lineHeight: 28 }}>
                {emoji}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {recording && onVoice ? (
        // THE RECORDER TAKES THE INPUT ROW'S PLACE: one clear state, with Cancel and Send at full size.
        <VoiceRecorderBar
          compact={compact}
          onCancel={() => setRecording(false)}
          onSend={(voice) => {
            setRecording(false)
            onVoice(voice)
          }}
        />
      ) : (
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: compact ? 6 : space.sm }}>
        {onAttach && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Attach"
            accessibilityHint="Club Documents, a photo or your contact card"
            accessibilityState={{ busy: Boolean(attachBusy) }}
            disabled={attachBusy}
            onPress={onAttach}
            style={({ pressed }) => ({
              width: size,
              height: size,
              borderRadius: size / 2,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? colour.mint100 : colour.chalk,
              borderWidth: 1,
              borderColor: colour.lineStrong,
              opacity: attachBusy ? 0.5 : 1,
            })}
          >
            <Plus size={21} color={colour.forest800} strokeWidth={2.2} />
          </Pressable>
        )}
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "flex-end",
            minHeight: size,
            borderRadius: size / 2,
            borderWidth: 1,
            borderColor: colour.lineStrong,
            backgroundColor: colour.chalk,
          }}
        >
          <TextInput
            ref={inputRef}
            accessibilityLabel="Message"
            value={draft}
            onChangeText={(value) => {
              onChange(value)
              if (value.length > draft.length) onTyping?.()
            }}
            onSelectionChange={(event) => {
              selection.current = event.nativeEvent.selection
            }}
            placeholder={replyingTo ? "Write your reply" : "Message"}
            maxFontSizeMultiplier={1.6}
            // RETURN SENDS, as in every messenger; the field still wraps a long message onto several lines.
            returnKeyType="send"
            submitBehavior="submit"
            enablesReturnKeyAutomatically
            onSubmitEditing={() => {
              if (!ready) return
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setEmojiOpen(false)
              onSend()
            }}
            placeholderTextColor={colour.inkSubtle}
            multiline
            selectionColor={colour.pitch600}
            style={[
              type.body,
              {
                flex: 1,
                maxHeight: compact ? 96 : 128,
                paddingLeft: space.md,
                paddingRight: 4,
                paddingTop: compact ? 9 : 11,
                paddingBottom: compact ? 9 : 11,
                color: colour.ink,
                fontSize: 15,
              },
            ]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={emojiOpen ? "Hide emoji" : "Emoji"}
            accessibilityState={{ expanded: emojiOpen }}
            onPress={() => setEmojiOpen((open) => !open)}
            style={({ pressed }) => ({ width: size - 4, height: size - 2, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <Smile size={20} color={emojiOpen ? colour.pitch600 : colour.inkMuted} strokeWidth={2} />
          </Pressable>
        </View>
        {/* MICROPHONE WHILE THE FIELD IS EMPTY, SEND ONCE THERE ARE WORDS -- the control people already know. */}
        {!ready && onVoice && voiceAvailable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Record a voice note"
            accessibilityHint="Starts recording. You can cancel before sending."
            onPress={() => {
              void Haptics.selectionAsync()
              setEmojiOpen(false)
              setRecording(true)
            }}
            style={({ pressed }) => ({
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: pressed ? colour.rugby700 : colour.forest800,
              alignItems: "center",
              justifyContent: "center",
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            <Mic size={19} color={colour.onForest} strokeWidth={2.2} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !ready }}
            disabled={!ready}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              setEmojiOpen(false)
              onSend()
            }}
            style={({ pressed }) => ({
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: ready ? colour.pitch600 : colour.lineStrong,
              alignItems: "center",
              justifyContent: "center",
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            <Send size={18} color={colour.onForest} strokeWidth={2.3} style={{ marginLeft: -2, marginTop: 1 }} />
          </Pressable>
        )}
      </View>
      )}
    </View>
  )
}

/**
 * THE CHOSEN FILE, BEFORE IT IS SENT.
 *
 * An image gets its own thumbnail, because "IMG_4821.jpg" does not tell somebody whether they picked the
 * right photo and this is the last moment to notice. A document gets its name and size.
 *
 * REMOVING IT IS A REAL BUTTON AT A REAL SIZE. The ✕ is a full 44pt target, not a 16pt glyph on the
 * corner of a thumbnail, because getting it wrong means sending a photo somebody had decided against.
 */
export function AttachmentTray({
  pending,
  onRemove,
  needsCaption,
}: {
  pending: Picked
  onRemove: () => void
  /** True while a document is waiting for the sentence the database requires alongside it. */
  needsCaption: boolean
}) {
  const uploading = pending.state === "uploading"
  const failed = pending.state === "failed"
  const size = readableSize(pending.sizeBytes)
  const isImage = pending.mimeType.startsWith("image/")

  return (
    <View
      accessible
      accessibilityLabel={`Attached: ${pending.name}${size ? `, ${size}` : ""}${
        uploading ? ". Uploading" : failed ? ". Not sent" : needsCaption ? ". Add a message to send this file" : ""
      }`}
      accessibilityLiveRegion="polite"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        padding: space.sm,
        marginBottom: space.sm,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: failed ? colour.danger : colour.line,
        backgroundColor: colour.chalk,
      }}
    >
      {isImage ? (
        <Image
          source={{ uri: pending.uri }}
          style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colour.mint100 }}
          contentFit="cover"
          accessible={false}
        />
      ) : (
        <View style={{ width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colour.mint100, alignItems: "center", justifyContent: "center" }}>
          <Text style={[type.caption, { color: colour.forest800, fontSize: 10 }]}>
            {pending.mimeType === "application/pdf" ? "PDF" : "FILE"}
          </Text>
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={[type.caption, { color: colour.ink, fontSize: 12 }]}>
          {pending.name}
        </Text>
        <Text style={[type.caption, { color: failed ? colour.danger : colour.inkMuted, fontSize: 10 }]}>
          {uploading
            ? "Uploading…"
            : failed
              ? "Not sent — press send to try again"
              : needsCaption
                ? "Add a message to send this file"
                : (size ?? "Ready")}
        </Text>
      </View>

      {uploading ? (
        <View style={{ width: TOUCH_TARGET, alignItems: "center" }}>
          <ActivityIndicator size="small" color={colour.forest800} />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${pending.name}`}
          onPress={onRemove}
          hitSlop={6}
          style={({ pressed }) => ({
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <X size={20} color={colour.inkMuted} strokeWidth={2.2} />
        </Pressable>
      )}
    </View>
  )
}
