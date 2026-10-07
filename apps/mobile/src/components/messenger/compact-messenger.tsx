import { useCallback, useEffect, useRef, useState } from "react"
import { Animated, Easing, Keyboard, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native"
import { usePathname, useRouter } from "expo-router"
import * as Clipboard from "expo-clipboard"
import * as Haptics from "expo-haptics"
import { myReaction, type MessengerRow, type ThreadMessage, type ThreadReplyQuote } from "@ovalball/contracts"

import { supabase } from "../../auth/supabase"
import { useSession } from "../../auth/session"
import { useAppContexts } from "../../context/contexts"
import { loadInbox, routeForRow } from "../../messages/inbox"
import { quoteOf, useDraft, useThread } from "../../messages/use-thread"
import { useDirectPresence } from "../../messages/presence"
import { useClubDocumentsEntry } from "../../messages/documents-entry"
import { type AttachableKind } from "../../messages/attachments"
import { useAttachments } from "../../messages/use-attachments"
import { ShareAccessory, ShareSheets, shareReady } from "./share"
import type { ConversationKind } from "../../messages/conversation"
import { friendly, logDetail } from "../../errors/translate"
import { ClubCrest, PersonAvatar } from "../identity"
import { ChevronLeft, ChevronRight, Maximize2, MessageSquare, Search, SquarePen, Users, X } from "../icons"
import { Skeleton } from "../ui"
import { ConversationRow, matchesSearch } from "./conversation-row"
import { ContactRow, ContactSection } from "./contact-row"
import { useNewMessage, type ContactEntry } from "../../messages/new-message"
import { DocumentPicker } from "./document-picker"
import { MessageActionsSheet, MessageInfoSheet, ReportSheet, ReportedNotice } from "../message-actions"
import { deleteOwnMessage, reportMessage } from "../../messages/moderation"
import { Composer, ThreadList, TypingLine, type ThreadListHandle } from "./thread"
import type { QuickViewAnchor } from "../notification-quick-view"
import { TOUCH_TARGET, colour, messenger, onForest, radius, space, type } from "../../design/tokens"

/**
 * THE COMPACT MESSENGER -- the header's Messages control, opened in place.
 *
 * Not a preview and not a second inbox. The list is the website's own `getMessengerRows` (via
 * `loadInbox`), and a conversation opened here is the same conversation the full screen opens, through
 * the same hook and the same components -- so somebody can read, reply, react and share a Club Document
 * without leaving the screen they were on, and "View Full Conversation" takes them to the identical
 * thread with more room.
 *
 * OPENING THE PANEL MARKS NOTHING READ. Looking at a list is not reading it. Opening ONE conversation
 * marks that one read, and only that one -- the hook does it, exactly as the full screen does.
 *
 * KEYBOARD-SAFE BY MEASUREMENT. The panel hangs from the header, so when the keyboard rises the panel's
 * height is reduced to the space left above it rather than the composer being pushed off screen.
 */

const PANEL_GUTTER = 12
const LIST_ROWS = 6
/** A conversation of one or two messages still reads as a composed panel -- header, a little thread, the composer -- not a slab. */
const MIN_CONVERSATION = 320
const QUICK_REPLIES = ["Yes 👍", "Not sure", "See you there!"] as const

type Mode = { kind: "list" } | { kind: "new" } | { kind: "conversation"; row: MessengerRow; from?: "new" } | { kind: "documents"; row: MessengerRow }

export function CompactMessenger({
  anchor,
  onForestGround,
  onClose,
  badge = null,
}: {
  anchor: QuickViewAnchor | null
  onForestGround: boolean
  onClose: () => void
  /** The Messages control's own unread badge, drawn on the lifted copy of the control. */
  badge?: React.ReactNode
}) {
  const visible = anchor !== null
  const { width: windowWidth, height: windowHeight } = useWindowDimensions()
  const router = useRouter()
  // Where the panel was opened, so an expanded conversation's Back returns there rather than to whatever the
  // messages stack happens to hold.
  const pathname = usePathname()
  const { session } = useSession()
  const { sessionContext, active, refreshUnread } = useAppContexts()
  const [rows, setRows] = useState<MessengerRow[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>({ kind: "list" })
  const [keyboard, setKeyboard] = useState(0)
  // What a short conversation actually needs, so a three-message thread is not a tall empty panel.
  const [preferredHeight, setPreferredHeight] = useState<number | null>(null)
  const progress = useRef(new Animated.Value(0)).current
  const closing = useRef(false)
  const presence = useDirectPresence(visible)
  const documentsOffered = useClubDocumentsEntry()

  const load = useCallback(async () => {
    if (!sessionContext || !session?.user) return
    setProblem(null)
    try {
      const [inbox] = await Promise.all([loadInbox(supabase, sessionContext, session.user.id, active), refreshUnread()])
      setRows(inbox)
    } catch (caught) {
      const failure = friendly(caught, "your messages")
      logDetail("compact messenger", failure)
      setProblem(failure.message)
    }
  }, [sessionContext, session, active, refreshUnread])

  useEffect(() => {
    if (!visible) return
    closing.current = false
    progress.setValue(0)
    setMode({ kind: "list" })
    setRows(null)
    void load()
    void Haptics.selectionAsync()
  }, [visible, load, progress])

  useEffect(() => {
    if (!visible) return
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) => setKeyboard(e.endCoordinates.height))
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboard(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [visible])

  // Started from the modal's own onShow: a native-driven animation begun as a modal mounts is dropped on iOS.
  const reveal = useCallback(() => {
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 4 }).start()
  }, [progress])

  const close = useCallback(
    (then?: () => void) => {
      if (closing.current) return
      closing.current = true
      Keyboard.dismiss()
      Animated.timing(progress, { toValue: 0, duration: 150, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
        onClose()
        then?.()
      })
    },
    [progress, onClose]
  )

  const back = useCallback(() => {
    Keyboard.dismiss()
    setMode({ kind: "list" })
    // The list re-reads so the conversation just read no longer shows as unread.
    void load()
  }, [load])

  if (!anchor) return null

  const panelWidth = Math.min(windowWidth - PANEL_GUTTER * 2, 404)
  const panelLeft = windowWidth - PANEL_GUTTER - panelWidth
  const iconCentre = anchor.x + anchor.width / 2
  const caretLeft = Math.max(24, Math.min(panelWidth - 38, iconCentre - panelLeft - 8))
  const top = anchor.y + anchor.height + 8
  const room = windowHeight - top - (keyboard > 0 ? keyboard + 8 : 40)
  const tallest = Math.max(260, Math.min(room, 620))
  const conversationHeight = preferredHeight === null ? tallest : Math.max(Math.min(MIN_CONVERSATION, tallest), Math.min(preferredHeight, tallest))

  function openFull(row: MessengerRow) {
    const route = routeForRow(row)
    if (!route) return
    close(() => router.push({ pathname: route.pathname as never, params: { ...(route.params as object), returnTo: pathname } as never }))
  }

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onShow={reveal} onRequestClose={() => (mode.kind === "list" ? close() : mode.kind === "documents" ? setMode({ kind: "conversation", row: mode.row }) : back())}>
      <Animated.View style={{ flex: 1, opacity: progress }}>
        <Pressable accessibilityLabel="Close messages" onPress={() => close()} style={{ flex: 1, backgroundColor: messenger.scrimLight }} />
      </Animated.View>

      {/* THE CONTROL, LIFTED ABOVE THE SCRIM -- tapping it again closes the panel it opened. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close messages"
        onPress={() => close()}
        style={{
          position: "absolute",
          left: anchor.x,
          top: anchor.y,
          width: anchor.width,
          height: anchor.height,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: onForestGround ? onForest.line : colour.line,
        }}
      >
        <MessageSquare size={20} color={onForestGround ? colour.onForest : colour.ink} strokeWidth={1.9} />
        {badge}
      </Pressable>

      <Animated.View
        accessibilityViewIsModal
        style={{
          position: "absolute",
          top,
          left: panelLeft,
          width: panelWidth,
          opacity: progress,
          transformOrigin: `${caretLeft + 8}px 0px`,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) },
          ],
          shadowColor: colour.forest950,
          shadowOpacity: 0.3,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: 16 },
          elevation: 18,
        }}
      >
        <View style={{ position: "absolute", top: -7, left: caretLeft, width: 16, height: 16, borderRadius: 3, backgroundColor: mode.kind === "list" ? colour.surface : colour.forest950, transform: [{ rotate: "45deg" }] }} />
        <View style={{ borderRadius: radius.xl, backgroundColor: colour.surface, overflow: "hidden", ...(mode.kind === "list" ? { maxHeight: Math.max(300, room) } : mode.kind === "new" ? { maxHeight: Math.max(300, Math.min(room, 560)) } : { height: conversationHeight }) }}>
          {mode.kind === "list" ? (
            <ListMode
              rows={rows ?? []}
              total={rows?.length ?? 0}
              loading={rows === null && !problem}
              problem={problem}
              onRetry={() => void load()}
              presenceFor={presence.presenceFor}
              onOpen={(row) => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setPreferredHeight(null)
                setMode({ kind: "conversation", row })
              }}
              // NEW MESSAGE STAYS IN THE PANEL: choosing somebody opens the conversation right here.
              onNew={() => setMode({ kind: "new" })}
              onClose={() => close()}
              onAll={() => close(() => router.push("/messages"))}
            />
          ) : mode.kind === "new" ? (
            <NewMode
              onBack={() => setMode({ kind: "list" })}
              onOpen={(row) => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                setPreferredHeight(null)
                setMode({ kind: "conversation", row, from: "new" })
              }}
            />
          ) : mode.kind === "conversation" ? (
            <ConversationMode
              row={mode.row}
              presenceLabel={presence.presenceFor(idOf(mode.row))}
              onBack={back}
              backLabel="Back to your conversations"
              onActivity={presence.refresh}
              onPreferredHeight={setPreferredHeight}
              onFull={() => openFull(mode.row)}
              onDocuments={documentsOffered ? () => setMode({ kind: "documents", row: mode.row }) : null}
            />
          ) : (
            <View style={{ flex: 1, backgroundColor: colour.chalk }}>
              <PanelBar title="Club Documents" onBack={() => setMode({ kind: "conversation", row: mode.row })} backLabel={`Back to ${mode.row.title}`} />
              <DocumentPicker kind={mode.row.kind as AttachableKind} id={idOf(mode.row)} compact onShared={() => setMode({ kind: "conversation", row: mode.row })} />
            </View>
          )}
        </View>
      </Animated.View>
    </Modal>
  )
}

function idOf(row: MessengerRow): string {
  return row.key.slice(row.key.indexOf(":") + 1)
}

function ListMode({
  rows,
  total,
  loading,
  problem,
  onRetry,
  presenceFor,
  onOpen,
  onNew,
  onClose,
  onAll,
}: {
  rows: MessengerRow[]
  total: number
  loading: boolean
  problem: string | null
  onRetry: () => void
  presenceFor: ReturnType<typeof useDirectPresence>["presenceFor"]
  onOpen: (row: MessengerRow) => void
  onNew: () => void
  onClose: () => void
  onAll: () => void
}) {
  const [search, setSearch] = useState("")
  // The newest handful at rest; every match while searching -- over this person's own conversations only.
  const shown = search.trim() ? rows.filter((row) => matchesSearch(row, search)) : rows.slice(0, LIST_ROWS)
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingTop: space.md, paddingBottom: space.sm }}>
        <Text accessibilityRole="header" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.3} style={[type.title, { color: colour.ink, flex: 1 }]}>
          Messages
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New Message"
          onPress={onNew}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            minHeight: 36,
            paddingHorizontal: 12,
            borderRadius: radius.pill,
            backgroundColor: pressed ? colour.pitch600 : colour.pitch400,
          })}
        >
          <SquarePen size={15} color={colour.forest950} strokeWidth={2.2} />
          <Text maxFontSizeMultiplier={1.3} style={[type.smallMedium, { color: colour.forest950, fontSize: 13 }]}>New Message</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close messages"
          onPress={onClose}
          hitSlop={6}
          style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? colour.line : "transparent" })}
        >
          <X size={19} color={colour.inkMuted} strokeWidth={2.2} />
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: space.md, paddingBottom: space.sm }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colour.chalk }}>
          <Search size={16} color={colour.inkSubtle} strokeWidth={2.1} />
          <TextInput
            accessibilityLabel="Search your conversations"
            value={search}
            onChangeText={setSearch}
            placeholder="Search conversations"
            placeholderTextColor={colour.inkSubtle}
            autoCorrect={false}
            maxFontSizeMultiplier={1.5}
            selectionColor={colour.pitch600}
            style={[type.small, { flex: 1, color: colour.ink, paddingVertical: 8 }]}
          />
          {!!search && (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch("")} hitSlop={10}>
              <X size={15} color={colour.inkSubtle} strokeWidth={2.2} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: space.xs }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {problem ? (
          <View style={{ padding: space.lg, gap: space.sm }}>
            <Text style={[type.small, { color: colour.inkMuted }]}>{problem}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Try Again" onPress={onRetry} hitSlop={8}>
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>Try Again</Text>
            </Pressable>
          </View>
        ) : loading ? (
          [0, 1, 2].map((i) => (
            <View key={i} style={{ flexDirection: "row", gap: space.md, alignItems: "center", paddingHorizontal: space.md, paddingVertical: 10 }}>
              <Skeleton height={40} width={40} style={{ borderRadius: 20 }} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton height={13} width="50%" />
                <Skeleton height={11} width="80%" />
              </View>
            </View>
          ))
        ) : shown.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: space.xl, paddingHorizontal: space.lg, gap: space.xs }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colour.mint100 }}>
              {search.trim() ? <Search size={20} color={colour.forest800} strokeWidth={2} /> : <MessageSquare size={20} color={colour.forest800} strokeWidth={2} />}
            </View>
            <Text style={[type.smallMedium, { color: colour.ink }]}>{search.trim() ? "No matches" : "No conversations yet"}</Text>
            <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>
              {search.trim() ? `None of your conversations mention “${search.trim()}”.` : "Start one with somebody you can message."}
            </Text>
          </View>
        ) : (
          shown.map((row, index) => (
            <View key={row.key}>
              {index > 0 && <View style={{ height: 1, marginLeft: space.md + 40 + space.md, backgroundColor: colour.line }} />}
              <ConversationRow
                row={row}
                tone="light"
                dense
                presence={row.kind === "direct" ? presenceFor(idOf(row)) : null}
                onPress={routeForRow(row) ? () => onOpen(row) : undefined}
              />
            </View>
          ))
        )}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={total > 0 ? `View all messages, ${total} conversations` : "View all messages"}
        onPress={onAll}
        style={({ pressed }) => ({
          minHeight: 52,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingHorizontal: space.lg,
          borderTopWidth: 1,
          borderTopColor: colour.line,
          backgroundColor: pressed ? colour.chalk : colour.surface,
        })}
      >
        <MessageSquare size={18} color={colour.forest800} strokeWidth={1.9} />
        <Text maxFontSizeMultiplier={1.4} style={[type.smallMedium, { color: colour.ink, flex: 1, fontSize: 15 }]}>View All Messages</Text>
        <ChevronRight size={18} color={colour.inkSubtle} />
      </Pressable>
    </>
  )
}

/**
 * NEW MESSAGE, INSIDE THE PANEL -- the same model and rows as the New Message screen, so choosing somebody opens
 * the conversation here rather than taking the person away from what they were doing.
 */
function NewMode({ onBack, onOpen }: { onBack: () => void; onOpen: (row: MessengerRow) => void }) {
  const model = useNewMessage()

  async function choose(entry: ContactEntry) {
    const target = await model.open(entry)
    if (!target) return
    onOpen(
      target.row ?? {
        key: `direct:${target.id}`,
        kind: "direct",
        href: `/messages/direct/${target.id}`,
        logoUrl: null,
        avatarUrl: target.avatarUrl,
        otherUserId: entry.userId ?? null,
        title: target.title,
        context: "Direct message",
        preview: null,
        status: "direct",
        statusLabel: "Direct",
        activityAt: null,
        unreadCount: 0,
      }
    )
  }

  return (
    <View style={{ flexShrink: 1, backgroundColor: colour.chalk }}>
      <PanelBar title="New Message" onBack={onBack} backLabel="Back to your conversations" />
      <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: colour.surface, borderBottomWidth: 1, borderBottomColor: colour.line }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colour.chalk }}>
          <Search size={16} color={colour.inkSubtle} strokeWidth={2.1} />
          <TextInput
            accessibilityLabel="Search people, teams or groups you can message"
            value={model.search}
            onChangeText={model.setSearch}
            placeholder="Search people, teams or groups"
            placeholderTextColor={colour.inkSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            maxFontSizeMultiplier={1.5}
            selectionColor={colour.pitch600}
            style={[type.small, { flex: 1, color: colour.ink, paddingVertical: 8 }]}
          />
          {!!model.search && (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => model.setSearch("")} hitSlop={10}>
              <X size={15} color={colour.inkSubtle} strokeWidth={2.2} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: space.md }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        {!!model.problem && (
          <View style={{ margin: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colour.dangerSurface, gap: space.xs }}>
            <Text style={[type.small, { color: colour.danger }]}>{model.problem}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Try Again" onPress={() => void model.reload()} hitSlop={8}>
              <Text style={[type.smallMedium, { color: colour.forest800 }]}>Try Again</Text>
            </Pressable>
          </View>
        )}
        {!model.loaded && !model.problem &&
          [0, 1, 2, 3].map((i) => (
            <View key={i} style={{ flexDirection: "row", gap: space.md, alignItems: "center", paddingHorizontal: space.md, paddingVertical: 10 }}>
              <Skeleton height={40} width={40} style={{ borderRadius: 20 }} />
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton height={13} width="45%" />
                <Skeleton height={11} width="70%" />
              </View>
            </View>
          ))}
        {(model.nothingAtAll || (model.loaded && model.searching && model.sections.length === 0)) && (
          <View style={{ alignItems: "center", paddingVertical: space.xl, paddingHorizontal: space.lg, gap: space.xs }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colour.mint100 }}>
              {model.searching ? <Search size={20} color={colour.forest800} strokeWidth={2} /> : <Users size={20} color={colour.forest800} strokeWidth={2} />}
            </View>
            <Text style={[type.smallMedium, { color: colour.ink, textAlign: "center" }]}>{model.searching ? "No matching conversations or contacts" : "Nobody to message yet"}</Text>
            <Text style={[type.caption, { color: colour.inkMuted, textAlign: "center" }]}>
              {model.searching ? "Try another name, team or group." : "People appear here once you share a club or a team with them."}
            </Text>
          </View>
        )}
        {model.sections.map((section) => (
          <ContactSection key={section.title ?? "results"} title={section.title} compact>
            {section.entries.map((entry, index) => (
              <ContactRow
                key={entry.key}
                compact
                name={entry.name}
                context={entry.context}
                avatarUrl={entry.avatarUrl}
                presence={entry.presence}
                group={entry.kind === "group"}
                first={index === 0}
                busy={model.opening === entry.userId}
                dimmed={Boolean(model.opening) && model.opening !== entry.userId}
                onPress={() => void choose(entry)}
              />
            ))}
          </ContactSection>
        ))}
      </ScrollView>
    </View>
  )
}

function PanelBar({
  title,
  subtitle,
  live,
  online,
  avatar,
  onBack,
  backLabel,
  trailing,
}: {
  title: string
  subtitle?: string | null
  live?: boolean
  /** The other person is online now: a green dot before the words, which still say it. */
  online?: boolean
  avatar?: React.ReactNode
  onBack: () => void
  backLabel: string
  trailing?: React.ReactNode
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.xs, paddingVertical: space.xs, backgroundColor: colour.forest950 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={backLabel} onPress={onBack} hitSlop={4} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
        <ChevronLeft size={22} color={colour.onForest} />
      </Pressable>
      {avatar}
      <View accessible accessibilityRole="header" accessibilityLabel={[title, subtitle].filter(Boolean).join(". ")} style={{ flex: 1, minWidth: 0, marginLeft: avatar ? space.xs : 0 }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.5} style={[type.heading, { color: colour.onForest, fontSize: 16 }]}>
          {title}
        </Text>
        {!!subtitle && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            {!!online && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colour.pitch400 }} />}
            <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={[type.caption, { color: live ? colour.mint300 : onForest.secondary, flexShrink: 1 }]}>
              {subtitle}
            </Text>
          </View>
        )}
      </View>
      {trailing}
    </View>
  )
}

/**
 * ONE CONVERSATION, INSIDE THE PANEL. The hook marks it read on opening, and only it.
 */
function ConversationMode({
  row,
  presenceLabel,
  onBack,
  backLabel,
  onActivity,
  onPreferredHeight,
  onFull,
  onDocuments,
}: {
  row: MessengerRow
  presenceLabel: { online: boolean; label: string | null }
  onBack: () => void
  backLabel: string
  /** The other person just showed they are here (typing): re-read presence now. */
  onActivity: () => void
  onPreferredHeight: (height: number) => void
  onFull: () => void
  /** Club Documents, where the server says this person may use the library. */
  onDocuments: (() => void) | null
}) {
  const { session } = useSession()
  const { refreshUnread } = useAppContexts()
  const viewerId = session?.user.id ?? null
  const kind = row.kind as ConversationKind
  const id = idOf(row)
  const thread = useThread({ kind, id, viewerId, initialUnread: row.unreadCount, onRead: refreshUnread })
  const { draft, setDraft, clear } = useDraft(viewerId, kind, id)
  const list = useRef<ThreadListHandle>(null)
  const [replyingTo, setReplyingTo] = useState<ThreadReplyQuote | null>(null)
  const replyingMessage = useRef<ThreadMessage | null>(null)
  const [acting, setActing] = useState<ThreadMessage | null>(null)
  const [reporting, setReporting] = useState<ThreadMessage | null>(null)
  const [reported, setReported] = useState(false)
  const clearReported = useCallback(() => setReported(false), [])
  const [info, setInfo] = useState<ThreadMessage | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionProblem, setActionProblem] = useState<string | null>(null)
  const canSend = thread.conversation?.canSend ?? false
  const isGroup = kind !== "direct"
  // EVERYTHING SHARED HERE STAYS HERE: a photo, the camera, a contact card and a Club Document are chosen and sent
  // inside the panel, through the same hook the full conversation uses.
  const share = useAttachments(kind, id, { onDocuments: onDocuments ?? (() => {}), onSent: () => thread.load() })
  const subtitle = thread.otherTyping
    ? "Typing…"
    : !thread.connected
      ? "Reconnecting…"
      : kind === "direct"
        ? presenceLabel.label
        : (thread.conversation?.subtitle ?? row.context)
  // Quick answers only where the question is "are we on?": a fixture or a fixture request.
  useEffect(() => {
    if (thread.otherTyping) onActivity()
  }, [thread.otherTyping, onActivity])

  // THE PANEL FITS THE CONVERSATION: its chrome (header, composer, quick replies) plus the thread's own content.
  const panelHeight = useRef(0)
  const viewportHeight = useRef(0)
  const contentHeight = useRef(0)
  const propose = () => {
    if (!panelHeight.current || !viewportHeight.current || !contentHeight.current) return
    onPreferredHeight(Math.ceil(panelHeight.current - viewportHeight.current + contentHeight.current))
  }
  const quickReplies = kind === "fixture" || kind === "request" ? QUICK_REPLIES : undefined

  async function send(text: string) {
    const reply = replyingMessage.current
    setReplyingTo(null)
    replyingMessage.current = null
    requestAnimationFrame(() => list.current?.scrollToNewest())
    await thread.send(text, reply)
  }

  async function removeMessage() {
    if (!acting || actionBusy) return
    setActionBusy(true)
    setActionProblem(null)
    const result = await deleteOwnMessage(supabase, acting.id)
    setActionBusy(false)
    if (!result.ok) {
      setActionProblem(result.message)
      return
    }
    setActing(null)
    await thread.load()
  }

  async function sendReport(reason: string) {
    if (!reporting || actionBusy) return
    setActionBusy(true)
    setActionProblem(null)
    const result = await reportMessage(supabase, reporting.id, reason)
    setActionBusy(false)
    if (!result.ok) {
      setActionProblem(result.message)
      return
    }
    setReporting(null)
    setReported(true)
    await thread.load()
  }

  const preview = (message: ThreadMessage | null) =>
    message && !message.isDeleted ? message.body || (message.attachment?.mimeType.startsWith("audio/") ? "Voice note" : null) : null

  return (
    <View
      style={{ flex: 1, backgroundColor: colour.chalk }}
      onLayout={(e) => {
        panelHeight.current = e.nativeEvent.layout.height
        propose()
      }}
    >
      <PanelBar
        title={thread.conversation?.title ?? row.title}
        subtitle={subtitle}
        live={thread.otherTyping || presenceLabel.online}
        online={kind === "direct" && thread.connected && !thread.otherTyping && presenceLabel.online}
        backLabel={backLabel}
        onBack={onBack}
        avatar={
          isGroup ? (
            row.logoUrl ? (
              <ClubCrest clubName={row.title} url={row.logoUrl} size={34} />
            ) : (
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: messenger.wellOnForest, alignItems: "center", justifyContent: "center" }}>
                <Users size={17} color={colour.onForest} strokeWidth={1.9} />
              </View>
            )
          ) : (
            <View>
              <PersonAvatar name={row.title} url={thread.conversation?.avatarUrl ?? null} size={34} />
              {presenceLabel.online && <View style={{ position: "absolute", right: -1, bottom: -1, width: 11, height: 11, borderRadius: 6, backgroundColor: colour.pitch400, borderWidth: 2, borderColor: colour.forest950 }} />}
            </View>
          )
        }
        trailing={
          <Pressable accessibilityRole="button" accessibilityLabel="View Full Conversation" onPress={onFull} hitSlop={4} style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
            <Maximize2 size={18} color={colour.onForest} strokeWidth={2} />
          </Pressable>
        }
      />

      <ReportedNotice visible={reported} onDone={clearReported} />
      {!!thread.reactionProblem && (
        <Pressable accessibilityRole="alert" onPress={thread.clearReactionProblem} style={{ paddingHorizontal: space.md, paddingVertical: 6, backgroundColor: colour.dangerSurface }}>
          <Text style={[type.caption, { color: colour.danger }]}>{thread.reactionProblem}</Text>
        </Pressable>
      )}

      {thread.missing ? (
        <View style={{ padding: space.lg }}>
          <Text style={[type.small, { color: colour.inkMuted }]}>This conversation isn't available.</Text>
        </View>
      ) : (
        <View
          style={{ flex: 1 }}
          onLayout={(e) => {
            viewportHeight.current = e.nativeEvent.layout.height
            propose()
          }}
        >
        <ThreadList
          ref={list}
          onContentHeight={(height) => {
            contentHeight.current = height
            propose()
          }}
          items={thread.items}
          isGroup={isGroup}
          canReact={canSend}
          compact
          loadingOlder={thread.loadingOlder}
          hasMore={thread.conversation?.hasMore ?? false}
          onEndReached={thread.older}
          onHold={(message) => {
            setActionProblem(null)
            setActing(message)
          }}
          onToggleReaction={(message, emoji) => void thread.react(message.id, emoji)}
          onRetry={(clientId) => void thread.retry(clientId)}
          receipts={thread.receipts}
          onDiscard={(clientId) => {
            const words = thread.discard(clientId)
            if (words && !draft.trim()) setDraft(words)
          }}
          footer={thread.otherTyping ? <TypingLine name={row.title.split(" ")[0] ?? row.title} /> : null}
          header={
            thread.problem ? (
              <Text style={[type.small, { color: colour.danger, padding: space.md }]}>{thread.problem}</Text>
            ) : thread.conversation === null ? (
              <View style={{ gap: space.sm, padding: space.sm }}>
                <Skeleton height={34} width="62%" />
                <Skeleton height={34} width="48%" style={{ alignSelf: "flex-end" }} />
              </View>
            ) : thread.items.length === 0 ? (
              <Text style={[type.small, { color: colour.inkMuted, textAlign: "center", padding: space.lg }]}>{canSend ? "No messages yet. Say hello below." : "Nothing has been said here yet."}</Text>
            ) : null
          }
        />
        </View>
      )}

      {thread.conversation && (
        <Composer
          compact
          canSend={canSend}
          unavailableReason={thread.conversation.unavailableReason}
          draft={draft}
          onChange={setDraft}
          onSend={() => {
            const text = draft
            if (share.pending) {
              void clear()
              void share.sendPending(text).then((result) => {
                if (!result.ok) setDraft(text)
                else requestAnimationFrame(() => list.current?.scrollToNewest())
              })
              return
            }
            void clear()
            void send(text)
          }}
          error={share.problem}
          onAttach={share.support.canAttach ? share.openSheet : () => share.setProblem(share.support.reason)}
          attachBusy={share.picking}
          sendReady={shareReady(share, draft.trim().length > 0)}
          accessory={<ShareAccessory attach={share} hasText={draft.trim().length > 0} />}
          replyingTo={replyingTo}
          onCancelReply={() => {
            setReplyingTo(null)
            replyingMessage.current = null
          }}
          quickReplies={quickReplies}
          onQuickReply={(text) => void send(text)}
          onTyping={thread.notifyTyping}
          onVoice={
            canSend && thread.canSendVoice && !share.pending
              ? (voice) => {
                  requestAnimationFrame(() => list.current?.scrollToNewest())
                  void thread.sendVoice(voice)
                }
              : undefined
          }
        />
      )}

      <ShareSheets attach={share} showDocuments={Boolean(onDocuments)} />

      {/* THE SAME ACTIONS AS THE FULL CONVERSATION: react, reply, copy, info, delete -- and Report, always. */}
      <MessageActionsSheet
        visible={acting !== null}
        canDelete={acting?.canDelete ?? false}
        canReport={acting?.canReport ?? false}
        busy={actionBusy}
        problem={actionProblem}
        myReaction={acting ? myReaction(acting.reactions ?? []) : null}
        preview={preview(acting)}
        onReact={
          canSend && acting && !acting.isDeleted
            ? (emoji) => {
                const message = acting
                setActing(null)
                void Haptics.selectionAsync()
                void thread.react(message.id, emoji)
              }
            : undefined
        }
        onReply={
          canSend && acting && !acting.isDeleted
            ? () => {
                replyingMessage.current = acting
                setReplyingTo(quoteOf(acting))
                setActing(null)
              }
            : undefined
        }
        onCopy={
          acting && !acting.isDeleted && acting.body
            ? () => {
                void Clipboard.setStringAsync(acting.body)
                setActing(null)
              }
            : undefined
        }
        onInfo={
          acting && acting.isOwn && !acting.isDeleted
            ? () => {
                setInfo(acting)
                setActing(null)
              }
            : undefined
        }
        onDelete={() => void removeMessage()}
        onReport={() => {
          const message = acting
          setActing(null)
          setActionProblem(null)
          setReporting(message)
        }}
        onClose={() => setActing(null)}
      />
      <MessageInfoSheet
        visible={info !== null}
        sentAt={info?.createdAt ?? null}
        receipt={info ? (thread.receipts.get(info.id) ?? { readCount: 0, firstReadAt: null }) : null}
        isGroup={isGroup}
        preview={preview(info)}
        onClose={() => setInfo(null)}
      />
      <ReportSheet visible={reporting !== null} busy={actionBusy} problem={actionProblem} onSubmit={(reason) => void sendReport(reason)} onClose={() => setReporting(null)} />
    </View>
  )
}
