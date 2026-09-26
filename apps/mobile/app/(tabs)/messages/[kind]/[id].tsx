import { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ActivityIndicator as Spinner,
  Text,
  TextInput,
  View,
} from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
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
import { attachmentSupport, sendWithAttachment, type AttachableKind } from "../../../../src/messages/attachments"
import { choosePhoto, readFileBytes, takePhoto, type PickResult } from "../../../../src/messages/pickers"
import { readableSize } from "../../../../src/messages/documents"
import { previewContactCard, shareContactCard, type ContactCardPreview } from "../../../../src/messages/contact-card"
import { deleteOwnMessage, reportMessage } from "../../../../src/messages/moderation"
import { clearDraft, readDraft, writeDraft } from "../../../../src/messages/drafts"
import { friendly, logDetail } from "../../../../src/errors/translate"
import { PersonAvatar } from "../../../../src/components/identity"
import { AttachmentSheet, type AttachmentAction } from "../../../../src/components/attachment-sheet"
import { MessageAttachment, MessageDocumentShare } from "../../../../src/components/message-attachment"
import {
  ContactCardBubble,
  ContactCardSheet,
  MessageActionsSheet,
  ReportSheet,
} from "../../../../src/components/message-actions"
import { ChevronRight, Plus, Users, X } from "../../../../src/components/icons"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { respondToClubConversation } from "../../../../src/messages/club-conversations"
import { Image } from "expo-image"
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
/**
 * A CHOSEN FILE, ON ITS WAY.
 *
 * `state` is what the tray draws, and the three values are the three things that can actually be true:
 * chosen and validated, uploading, or refused. There is no "sent" state because a sent attachment is
 * not in the tray -- it is in the conversation.
 */
interface Picked {
  name: string
  mimeType: string
  sizeBytes: number
  uri: string
  state: "ready" | "uploading" | "failed"
}

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
  // ONE ATTACHMENT, because the canonical RPC carries one. A tray that accepted three and then sent
  // one would be the interface lying about the platform.
  const [pending, setPending] = useState<Picked | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  // Contact card: previewed from the server before it is shared, because the telephone number comes from
  // the account rather than from the composer.
  const [cardSheet, setCardSheet] = useState(false)
  const [card, setCard] = useState<ContactCardPreview | null>(null)
  const [cardProblem, setCardProblem] = useState<string | null>(null)
  const [cardSending, setCardSending] = useState(false)
  // One message's own actions, opened by pressing and holding it.
  const [acting, setActing] = useState<ThreadMessage | null>(null)
  const [reporting, setReporting] = useState<ThreadMessage | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionProblem, setActionProblem] = useState<string | null>(null)
  const viewerId = session?.user.id ?? null
  const attachments = attachmentSupport(kind)
  // Narrowed once, here, rather than cast at four call sites. `attachments.canAttach` and this are the
  // same fact, and a club conversation is the only kind that has no attachment target.
  const attachTo = attachments.canAttach ? (kind as AttachableKind) : null
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

  // A SHARE HAPPENS ON ANOTHER SCREEN. Club Documents pushes a picker, the share is written there, and
  // `router.back()` returns here -- which does not remount this screen, so without this the document
  // somebody just sent would not appear until they left and came back. The same focus rule the inbox
  // needed, for the same reason.
  useFocusEffect(
    useCallback(() => {
      void load()
    }, [load])
  )

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

  /**
   * WHERE THE SHEET'S CHOICES GO.
   *
   * CLUB DOCUMENTS AND CREATE IMAGE ARE SCREENS, not pickers -- one needs a search and a note, the
   * other needs to explain itself. The three device pickers all end in the same place: a validated
   * file in the tray, or a sentence saying why not.
   *
   * THE DRAFT SURVIVES ALL OF IT. Opening the camera backgrounds the app, and iOS may reclaim it; the
   * draft has already been written to storage on every keystroke, so the text is read back when the
   * screen mounts again. Nothing extra is needed here, and that is the point of having put it there.
   */
  async function chose(action: AttachmentAction) {
    if (!attachTo) {
      setSendError(attachments.reason)
      return
    }
    if (action === "documents") {
      router.push({ pathname: "/messages/documents", params: { kind, id } })
      return
    }
    if (action === "contact") {
      setCard(null)
      setCardProblem(null)
      setCardSheet(true)
      const preview = await previewContactCard(supabase, attachTo, id)
      if (preview.ok) setCard(preview.card)
      else setCardProblem(preview.message)
      return
    }
    setSendError(null)
    setPicking(true)
    let result: PickResult
    try {
      result = action === "camera" ? await takePhoto() : await choosePhoto()
    } catch (caught) {
      logDetail("attachment picker", friendly(caught, "that file"))
      result = { ok: false, message: "Couldn't open that. Try again." }
    }
    setPicking(false)
    if ("cancelled" in result) return
    if (!result.ok) {
      setSendError(result.message)
      return
    }
    setPending({ ...result.file, state: "ready" })
  }

  async function send() {
    // Guarded against a double tap: a slow network is exactly when somebody presses twice, and two
    // identical messages is the result nobody wants.
    // An attachment on its own is a message. A caption is optional, which is what the RPC models.
    if (sending || (!draft.trim() && !pending)) return
    // A SEND THAT CANNOT RUN MUST SAY SO. This used to return silently when the session had not
    // finished restoring -- the button simply did nothing, which is indistinguishable from a broken
    // app and leaves nothing to report. Restoring is slower on a device than in a browser, so the
    // window is real.
    if (!session?.user) {
      setSendError("Still signing you in. Try again in a moment.")
      return
    }
    setSending(true)
    setSendError(null)
    const body = draft
    // CLEARED OPTIMISTICALLY, RESTORED ON FAILURE -- but the MESSAGE is not shown until the server has
    // it. A bubble that appears sent and later turns out not to be is the one outcome worth avoiding
    // in a product where somebody may act on having told a parent something.
    setDraft("")
    const result = pending
      ? await sendAttached(pending, body)
      : await sendMessage(supabase, kind, id, session.user.id, body)
    setSending(false)
    if (!result.ok) {
      // The draft comes back, so a failed send never loses what somebody wrote, and the composer is
      // ready to try again. THE ATTACHMENT STAYS TOO, marked failed rather than discarded: making
      // somebody find the same photo again because the network dropped is the wrong half to throw away.
      setDraft(body)
      setSendError(result.message)
      setPending((current) => (current ? { ...current, state: "failed" } : current))
      return
    }
    setPending(null)
    if (viewerId) await clearDraft(viewerId, draftKey)
    await load()
    // Offset 0 in an inverted list is the BOTTOM of the screen, which is where the message just sent
    // has landed.
    requestAnimationFrame(() => list.current?.scrollToOffset({ offset: 0, animated: true }))
  }

  /**
   * The bytes are read HERE, at send time, not when the file was chosen.
   *
   * Holding two megabytes in component state from the moment of picking means an app that is carrying
   * it through every re-render and through backgrounding. Reading at send also means a file the system
   * has since reclaimed from the cache fails with a sentence rather than uploading something stale.
   */
  async function sendAttached(file: Picked, body: string): Promise<{ ok: true } | { ok: false; message: string }> {
    setPending({ ...file, state: "uploading" })
    if (!attachTo) return { ok: false, message: attachments.reason ?? "Attachments aren't available here." }
    const bytes = await readFileBytes(file.uri)
    if (!bytes) return { ok: false, message: "Couldn't read that file. Choose it again." }
    return sendWithAttachment(supabase, attachTo, id, body, {
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      bytes,
    })
  }

  async function sendCard() {
    if (cardSending || !attachTo) return
    setCardSending(true)
    setCardProblem(null)
    const result = await shareContactCard(supabase, attachTo, id)
    setCardSending(false)
    if (!result.ok) {
      setCardProblem(result.message)
      return
    }
    setCardSheet(false)
    await load()
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
    await load()
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
    // Reload, so a report that the server has recorded is reflected by the row rather than by this
    // screen remembering it locally.
    await load()
  }

  if (missing) {
    return (
      <Shell
        title="Messages"
        onBack={() => router.back()}
        insets={insets}
        messages={[]}
        avatarUrl={null}
        isPerson={false}
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
        avatarUrl={conversation?.avatarUrl ?? null}
        isPerson={conversation?.isPerson ?? false}
        onBack={() => router.back()}
        insets={insets}
        listRef={list}
        // NEWEST FIRST IN THE DATA, which an inverted list draws bottom-up -- so the newest message
        // sits nearest the composer and the oldest is furthest up. Sorted once, here, because the
        // canonical reader returns ascending and no screen should assume which way it came.
        messages={[...(conversation?.messages ?? [])].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )}
        onEndReached={older}
        loadingOlder={loadingOlder}
        hasMore={conversation?.hasMore ?? false}
        onHold={(message) => {
          setActionProblem(null)
          setActing(message)
        }}
        // PEOPLE ON EVERY CONVERSATION, including a direct one. Two people is still an answer to "who
        // is reading this", and blocking somebody is reached from the one place they are genuinely
        // identifiable. The screen says why there is nothing to add.
        onPeople={() => router.push({ pathname: "/messages/participants", params: { kind, id } })}
        header={
          <>
            {problem && <ErrorState message={problem} onRetry={load} />}
            {!problem && conversation === null && (
              <>
                <CardSkeleton lines={2} />
                <CardSkeleton lines={1} />
              </>
            )}
            {kind === "club" && conversation?.clubConversationStatus === "pending" && (
              <MessageRequestBanner
                conversationId={conversation.conversationId}
                side={conversation.clubRequestSide ?? "recipient"}
                otherClubName={conversation.clubOtherClubName ?? "The other club"}
                onDecided={load}
              />
            )}
            {conversation?.messages.length === 0 && conversation.clubConversationStatus !== "pending" && (
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
          onAttach={() => setSheetOpen(true)}
          picking={picking}
          pending={pending}
          onRemovePending={() => {
            setPending(null)
            setSendError(null)
          }}
        />
      )}

      <AttachmentSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onChoose={(action) => void chose(action)}
        canAttach={attachments.canAttach}
        reason={attachments.reason}
      />

      <ContactCardSheet
        visible={cardSheet}
        card={card}
        problem={cardProblem}
        sending={cardSending}
        onSend={() => void sendCard()}
        onClose={() => setCardSheet(false)}
      />

      <MessageActionsSheet
        visible={acting !== null}
        canDelete={acting?.canDelete ?? false}
        canReport={acting?.canReport ?? false}
        busy={actionBusy}
        problem={actionProblem}
        onDelete={() => void removeMessage()}
        onReport={() => {
          const message = acting
          setActing(null)
          setActionProblem(null)
          setReporting(message)
        }}
        onClose={() => setActing(null)}
      />

      <ReportSheet
        visible={reporting !== null}
        busy={actionBusy}
        problem={actionProblem}
        onSubmit={(reason) => void sendReport(reason)}
        onClose={() => setReporting(null)}
      />
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
 * NEWEST AT THE BOTTOM, BESIDE THE COMPOSER -- the owner's direction, and the convention every phone
 * messaging app follows: you read down to the newest thing and reply underneath it. The WEBSITE sorts
 * newest-first, which suits a mouse and a tall column; a thumb does not. The divergence is
 * deliberate, and the only one between the two clients.
 *
 * `inverted` gives that for free and keeps virtualisation honest: the list renders from the bottom,
 * so "load older" is reaching the END of the data, which is the TOP of the screen. Reaching it is
 * what asks for the previous page.
 */
/**
 * SECTION 10 (CLUBHOUSE): the decision on an unanswered club message request, mirroring the website's
 * own `MessageRequestDecision` -- it had no home at all before this. respond_to_club_conversation
 * exists and is correctly enforced server-side; nothing in the mobile product called it, so a request
 * could be received and read and then never answered.
 */
function MessageRequestBanner({
  conversationId,
  side,
  otherClubName,
  onDecided,
}: {
  conversationId: string | null
  side: "requester" | "recipient"
  otherClubName: string
  onDecided: () => Promise<void>
}) {
  const [working, setWorking] = useState<"accept" | "decline" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function respond(approve: boolean) {
    if (!conversationId || working) return
    setWorking(approve ? "accept" : "decline")
    setError(null)
    const result = await respondToClubConversation(supabase, conversationId, approve)
    setWorking(null)
    if (!result.ok) {
      setError(result.error ?? "That could not be done.")
      return
    }
    await onDecided()
  }

  if (side === "requester") {
    return (
      <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colour.line, backgroundColor: colour.surface, padding: space.md, gap: space.xs }}>
        <Text style={[type.smallMedium, { color: colour.ink }]}>Waiting for {otherClubName}</Text>
        <Text style={[type.caption, { color: colour.inkMuted }]}>
          They can accept or decline your request. Your first message is already with them; you can write again once they accept.
        </Text>
      </View>
    )
  }

  return (
    <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colour.warning, backgroundColor: colour.surface, padding: space.md, gap: space.sm }}>
      <Text style={[type.smallMedium, { color: colour.ink }]}>{otherClubName} would like to message you</Text>
      <Text style={[type.caption, { color: colour.inkMuted }]}>Accepting opens the conversation for both clubs. Declining closes it, and they are told.</Text>
      {error && <Text style={[type.caption, { color: colour.warning }]}>{error}</Text>}
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Accept Request" style={{ flex: 1 }} busy={working === "accept"} disabled={working !== null} onPress={() => void respond(true)} />
        <Button label="Decline" variant="secondary" style={{ flex: 1 }} busy={working === "decline"} disabled={working !== null} onPress={() => void respond(false)} />
      </View>
    </View>
  )
}

function Shell({
  title,
  subtitle,
  avatarUrl,
  isPerson,
  onBack,
  onPeople,
  insets,
  listRef,
  messages,
  header,
  onEndReached,
  loadingOlder,
  hasMore,
  onHold,
}: {
  title: string
  subtitle?: string
  /** The PERSON's own picture. Null means initials -- never a substitute image. */
  avatarUrl?: string | null
  isPerson?: boolean
  onBack: () => void
  /** Present only for a group conversation: a direct thread's participants are its two people. */
  onPeople?: () => void
  insets: { top: number; bottom: number }
  listRef?: React.RefObject<FlatList<ThreadMessage> | null>
  messages: ThreadMessage[]
  /** Loading, error and empty states sit above the list rather than inside it. */
  header?: React.ReactNode
  onEndReached?: () => void
  loadingOlder?: boolean
  hasMore?: boolean
  /** Press and hold a message to reach what can be done with it. */
  onHold?: (message: ThreadMessage) => void
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
        {/* A PERSON gets their own picture beside their name. A fixture or club thread gets none --
            rather than borrowing a crest, which would attribute a conversation to an organisation. */}
        {isPerson && <PersonAvatar name={title} url={avatarUrl ?? null} size={36} />}
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
        {/* WHO ELSE IS READING THIS. A group thread is not "you and the opposition" -- it is both clubs'
            administrators and both teams' staff -- and writing to an audience you are guessing at is the
            wrong thing to be doing in a product where a message might name a child. */}
        {!!onPeople && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="People in this conversation"
            onPress={onPeople}
            hitSlop={8}
            style={({ pressed }) => ({
              width: TOUCH_TARGET,
              height: TOUCH_TARGET,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Users size={21} color={colour.forest800} strokeWidth={1.9} />
          </Pressable>
        )}
      </View>

      <FlatList
        ref={listRef}
        inverted
        data={messages}
        keyExtractor={(message) => message.id}
        renderItem={({ item }) => <Bubble message={item} onHold={onHold} />}
        // In an inverted list the HEADER renders at the bottom and the FOOTER at the top, so the
        // loading, error and empty states go in the footer to stay visually above the conversation.
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
function Bubble({ message, onHold }: { message: ThreadMessage; onHold?: (message: ThreadMessage) => void }) {
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

  // OFFERED ONLY WHERE THE SERVER SAYS SO. `canDelete` and `canReport` are the canonical reader's
  // answers, carried on the row -- never recomputed here from a sender id.
  const actionable = Boolean(onHold) && (message.canDelete || message.canReport)

  return (
    <Pressable
      accessible
      // A LONG PRESS IS THE GESTURE A PHONE ALREADY HAS FOR THIS, and it is announced rather than left
      // to be discovered: a screen reader user is told the action exists.
      accessibilityActions={actionable ? [{ name: "longpress", label: "Message options" }] : undefined}
      onAccessibilityAction={actionable ? () => onHold?.(message) : undefined}
      onLongPress={actionable ? () => onHold?.(message) : undefined}
      delayLongPress={350}
      // THE ATTACHMENT IS PART OF WHAT WAS SAID. A label that reads only the caption tells a screen
      // reader user there is a message and not that there is a file in it.
      accessibilityLabel={[
        `${mine ? "You" : message.senderName} at ${time}.`,
        message.body,
        message.attachment && `Attached: ${message.attachment.filename}.`,
        message.documentShare && `Club document: ${message.documentShare.title}.`,
      ]
        .filter(Boolean)
        .join(" ")}
      accessibilityHint={actionable ? "Press and hold for options" : undefined}
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
        {/* A CAPTION IS OPTIONAL, so an attachment with no words renders no empty line. The canonical
            reader returns an empty body for exactly that case. */}
        {!!message.body && (
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
        )}
        {/* A TOMBSTONED MESSAGE SHOWS NEITHER. Once soft-deleted the body is already the tombstone
            text, and rendering the attachment beside it would leave the file reachable after the
            message carrying it was withdrawn. */}
        {!message.isDeleted && !!message.attachment && (
          <MessageAttachment attachment={message.attachment} mine={mine} />
        )}
        {!message.isDeleted && !!message.documentShare && (
          <MessageDocumentShare share={message.documentShare} mine={mine} />
        )}
        {!message.isDeleted && !!message.contactCard && (
          <ContactCardBubble card={message.contactCard} mine={mine} />
        )}
        <Text style={[type.caption, { color: mine ? "rgba(255,255,255,0.75)" : colour.inkMuted, fontSize: 10, marginTop: 2, textAlign: "right" }]}>
          {time}
        </Text>
      </View>
    </Pressable>
  )
}

/**
 * `[ + ] [ Message....................... ] [ send ]`
 *
 * THE ATTACH CONTROL IS A FULL TOUCH TARGET, not a glyph tucked inside the text field. A 24pt paperclip
 * inside the input is the commonest version of this control and it is the one people miss and mis-tap,
 * because it competes with placing the cursor.
 *
 * IT IS ALWAYS THERE, EVEN WHERE ATTACHMENTS ARE NOT SUPPORTED, and the sheet explains why rather than
 * the button disappearing. A control that exists on a fixture thread and vanishes on a direct one reads
 * as a bug in the app; a sheet that says attachments work on fixture conversations reads as the product
 * telling you where to do the thing.
 */
function Composer({
  canSend,
  unavailableReason,
  draft,
  onChange,
  onSend,
  sending,
  error,
  bottomInset,
  onAttach,
  picking,
  pending,
  onRemovePending,
}: {
  canSend: boolean
  unavailableReason: string | null
  draft: string
  onChange: (value: string) => void
  onSend: () => void
  sending: boolean
  error: string | null
  bottomInset: number
  onAttach: () => void
  picking: boolean
  pending: Picked | null
  onRemovePending: () => void
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

  /**
   * AN IMAGE ALONE IS SENDABLE. A DOCUMENT NEEDS WORDS -- and that is the DATABASE's rule, not a
   * preference: `fixture_messages_content_present` is
   *
   *     CHECK (content_type = 'image' OR (body IS NOT NULL AND btrim(body) <> ''))
   *
   * and a non-image attachment is stored as `content_type = 'text'`. So sending a PDF with an empty
   * caption is refused by the constraint, arriving back as a generic "couldn't attach that file" with
   * nothing a person can act on. The composer therefore asks for the sentence BEFORE the upload rather
   * than discovering the rule afterwards, and the tray says why.
   *
   * IT CURRENTLY NEVER FIRES, and it stays anyway. The only things this app can attach are a camera
   * photo and a library image, both JPEG -- so `needsCaption` is false in practice today. It is kept
   * because the rule belongs to the DATABASE rather than to the picker: the moment anything non-image
   * can reach this composer, the constraint is waiting, and a guard that was deleted for being
   * currently unreachable is how that returns as "couldn't attach that file".
   *
   * (The website's composer gates on `draft || attachmentReady` without this distinction, and its menu
   * does offer a one-off PDF, so it has the dead end. Recorded as a web defect rather than changed here.)
   */
  const needsCaption = pending !== null && !pending.mimeType.startsWith("image/")
  const hasText = draft.trim().length > 0
  const ready =
    (hasText || (pending !== null && !needsCaption)) && !sending && pending?.state !== "uploading"

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colour.line, backgroundColor: colour.surface, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: bottomInset + space.sm }}>
      {!!error && (
        <Text accessibilityRole="alert" style={[type.caption, { color: colour.danger, marginBottom: 6 }]}>
          {error}
        </Text>
      )}

      {picking && (
        <View
          accessible
          accessibilityLabel="Preparing the file"
          accessibilityLiveRegion="polite"
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingBottom: space.sm }}
        >
          <Spinner size="small" color={colour.forest800} />
          <Text style={[type.caption, { color: colour.inkMuted }]}>Preparing…</Text>
        </View>
      )}

      {pending && <Tray pending={pending} onRemove={onRemovePending} needsCaption={needsCaption && !hasText} />}

      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach"
          accessibilityState={{ busy: picking }}
          disabled={picking || sending}
          onPress={onAttach}
          style={({ pressed }) => ({
            width: TOUCH_TARGET,
            height: TOUCH_TARGET,
            borderRadius: TOUCH_TARGET / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colour.chalk,
            borderWidth: 1,
            borderColor: colour.lineStrong,
            opacity: picking || sending ? 0.5 : pressed ? 0.8 : 1,
          })}
        >
          <Plus size={22} color={colour.forest800} strokeWidth={2.2} />
        </Pressable>
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
 * THE CHOSEN FILE, BEFORE IT IS SENT.
 *
 * An image gets its own thumbnail, because "IMG_4821.jpg" does not tell somebody whether they picked the
 * right photo and this is the last moment to notice. A document gets its name and size.
 *
 * REMOVING IT IS A REAL BUTTON AT A REAL SIZE. The ✕ is a full 44pt target, not a 16pt glyph on the
 * corner of a thumbnail, because getting it wrong means sending a photo somebody had decided against.
 */
function Tray({
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
          <Spinner size="small" color={colour.forest800} />
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
