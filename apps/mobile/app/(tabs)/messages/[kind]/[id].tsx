import { useCallback, useEffect, useRef, useState } from "react"
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native"
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router"
import * as Clipboard from "expo-clipboard"
import { myReaction, type ThreadMessage, type ThreadReplyQuote } from "@ovalball/contracts"

import { supabase } from "../../../../src/auth/supabase"
import { useSession } from "../../../../src/auth/session"
import { useAppContexts } from "../../../../src/context/contexts"
import { type ConversationKind } from "../../../../src/messages/conversation"
import { quoteOf, useDraft, useThread } from "../../../../src/messages/use-thread"
import { useDirectPresence } from "../../../../src/messages/presence"
import { useAttachments } from "../../../../src/messages/use-attachments"
import { deleteOwnMessage, reportMessage } from "../../../../src/messages/moderation"
import { PersonAvatar } from "../../../../src/components/identity"
import { OvalballDetailHeader } from "../../../../src/components/app-header"
import { MessageActionsSheet, MessageInfoSheet, ReportSheet, ReportedNotice } from "../../../../src/components/message-actions"
import { ShareAccessory, ShareSheets, shareReady } from "../../../../src/components/messenger/share"
import { useClubDocumentsEntry } from "../../../../src/messages/documents-entry"
import { loadParticipants } from "../../../../src/messages/participants"
import { ONLINE_WINDOW_MS } from "@ovalball/contracts"
import { Composer, ThreadList, TypingLine, type ThreadListHandle } from "../../../../src/components/messenger/thread"
import { Ellipsis, Users } from "../../../../src/components/icons"
import { Button, CardSkeleton, EmptyState, ErrorState } from "../../../../src/components/ui"
import { respondToClubConversation } from "../../../../src/messages/club-conversations"
import { TOUCH_TARGET, colour, messenger, onForest, radius, space, type } from "../../../../src/design/tokens"

/**
 * A CONVERSATION.
 *
 * THE ID IS NOT THE AUTHORITY. It arrives from a tap or from a deep link, and either way the server
 * decides: every read goes through RLS or an RPC scoped to the caller, so an id for a conversation
 * this person is not in returns nothing and this screen says so. There is no membership check here to
 * get wrong.
 *
 * ONE CONVERSATION, TWO WINDOWS. This screen and the compact messenger in the header draw the same
 * thread through the same hook (`useThread`) and the same components (`components/messenger/thread`),
 * so sending, retrying, reacting and replying behave identically in both.
 *
 * READ-ONLY IS A STATE, NOT AN ABSENCE. A conversation that cannot be replied to is still shown --
 * closed club threads, a resolved request, a direct thread that is no longer available. When the
 * reason is a DIRECT thread's unavailability, the sentence is the canonical undifferentiated one: block
 * in either direction, messaging switched off and a lapsed relationship all read identically.
 *
 * READING IS NOT RESOLVING. Opening the conversation marks THIS conversation read, which is what the
 * platform means by read. It does not touch any notification's resolved state.
 */
export default function ConversationScreen() {
  const router = useRouter()
  const { session } = useSession()
  const { refreshUnread, sessionContext } = useAppContexts()
  // BOTH COME FROM THE PATH. The route is /messages/<kind>/<id>, the same shape the links Ovalball
  // issues already use -- so a link tapped on a cold start matches a real route.
  const params = useLocalSearchParams<{ id: string; kind?: string; unread?: string; returnTo?: string }>()
  // BACK RETURNS TO WHERE THE PERSON CAME FROM. Expanded from the compact messenger, that is the screen the panel
  // was opened on (Home, Fixtures...), not whatever the messages stack still holds underneath.
  const returnTo = typeof params.returnTo === "string" && params.returnTo.startsWith("/") && !params.returnTo.startsWith("/messages") ? params.returnTo : null
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back()
    if (returnTo) router.navigate(returnTo as never)
  }, [router, returnTo])
  const id = String(params.id ?? "")
  const rawKind = String(params.kind ?? "direct")
  const kind = (["direct", "fixture", "request", "club"].includes(rawKind) ? rawKind : "direct") as ConversationKind
  const viewerId = session?.user.id ?? null

  const thread = useThread({ kind, id, viewerId, initialUnread: Number(params.unread ?? 0) || 0, onRead: refreshUnread })
  const { conversation } = thread
  const { draft, setDraft, clear: clearDraft } = useDraft(viewerId, kind, id)
  const presence = useDirectPresence(kind === "direct")
  // Somebody typing is active right now: re-read presence then, rather than waiting for the next minute's poll.
  const refreshPresence = presence.refresh
  useEffect(() => {
    if (thread.otherTyping) void refreshPresence()
  }, [thread.otherTyping, refreshPresence])
  const list = useRef<ThreadListHandle>(null)

  const [replyingTo, setReplyingTo] = useState<ThreadReplyQuote | null>(null)
  const replyingMessage = useRef<ThreadMessage | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [acting, setActing] = useState<ThreadMessage | null>(null)
  const [reporting, setReporting] = useState<ThreadMessage | null>(null)
  const [reported, setReported] = useState(false)
  const clearReported = useCallback(() => setReported(false), [])
  const [actionBusy, setActionBusy] = useState(false)
  const [actionProblem, setActionProblem] = useState<string | null>(null)
  const [info, setInfo] = useState<ThreadMessage | null>(null)
  const [people, setPeople] = useState<{ total: number; online: number } | null>(null)
  const documentsOffered = useClubDocumentsEntry()
  // PHOTOS, CLUB DOCUMENTS AND CONTACT CARDS -- the same hook the compact messenger uses.
  const attach = useAttachments(kind, id, {
    onDocuments: () => router.push({ pathname: "/messages/documents", params: { kind, id } }),
    onSent: () => thread.load(),
  })
  const pending = attach.pending

  // A SHARE HAPPENS ON ANOTHER SCREEN (Club Documents), and coming back refocuses rather than remounts.
  const reload = thread.load
  useFocusEffect(
    useCallback(() => {
      void reload()
    }, [reload])
  )

  // WHO IS IN A GROUP, AND HOW MANY ARE AROUND: from the conversation's own people list (`conversation_people`),
  // which already answers only to people in the conversation. A direct conversation uses its presence line.
  useEffect(() => {
    if (kind === "direct" || !sessionContext || !viewerId) return
    let live = true
    void loadParticipants(supabase, sessionContext, kind, id, viewerId)
      .then((view) => {
        if (!live || !view) return
        const now = Date.now()
        const online = view.participants.filter((p) => !p.isMe && p.lastActiveAt && now - new Date(p.lastActiveAt).getTime() < ONLINE_WINDOW_MS).length
        setPeople({ total: view.participants.length, online })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [kind, id, viewerId, sessionContext])

  async function send() {
    if (!session?.user) {
      setSendError("Still signing you in. Try again in a moment.")
      return
    }
    setSendError(null)
    const body = draft
    if (pending) {
      // A PHOTO GOES THROUGH THE CANONICAL ATTACHMENT RPC, which carries its own caption.
      if (pending.state === "uploading") return
      setDraft("")
      const result = await attach.sendPending(body)
      if (!result.ok) {
        setDraft(body)
        return
      }
      await clearDraft()
      requestAnimationFrame(() => list.current?.scrollToNewest())
      return
    }
    if (!body.trim()) return
    // THE WORDS LEAVE THE COMPOSER AT ONCE and appear as a pending bubble; a failure keeps them there,
    // marked "Not sent" with Retry, rather than throwing them back into the field.
    const reply = replyingMessage.current
    setReplyingTo(null)
    replyingMessage.current = null
    await clearDraft()
    requestAnimationFrame(() => list.current?.scrollToNewest())
    await thread.send(body, reply)
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

  const canSend = conversation?.canSend ?? false
  const isGroup = kind !== "direct"
  const live = kind === "direct" ? presence.presenceFor(id) : null
  const groupLine = people ? `${people.total} ${people.total === 1 ? "person" : "people"}${people.online > 0 ? ` · ${people.online} online` : ""}` : null
  const subtitle = thread.otherTyping
    ? "Typing…"
    : !thread.connected
      ? "Reconnecting…"
      : isGroup
        ? ([conversation?.subtitle, groupLine].filter(Boolean).join(" · ") || null)
        : (live?.label ?? conversation?.subtitle ?? null)
  // QUICK ANSWERS WHERE THE QUESTION IS ALWAYS "ARE WE ON?" -- a fixture or a fixture request -- and nowhere else.
  const quickReplies = kind === "fixture" || kind === "request" ? FIXTURE_QUICK_REPLIES : undefined

  if (thread.missing) {
    return (
      <View style={{ flex: 1, backgroundColor: colour.chalk }}>
        <OvalballDetailHeader title="Messages" onBack={goBack} />
        <View style={{ padding: space.lg }}>
          <EmptyState
            title="This conversation isn't available"
            body="It may have been removed, or it may not be one you have access to. Your other conversations are in Messages."
          />
        </View>
      </View>
    )
  }

  const hasText = draft.trim().length > 0

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colour.chalk }}>
      <OvalballDetailHeader
        title={conversation?.title ?? "Conversation"}
        onBack={goBack}
        rightAction={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Conversation details"
            accessibilityHint="Shows who is in this conversation"
            onPress={() => router.push({ pathname: "/messages/participants", params: { kind, id } })}
            hitSlop={6}
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <Ellipsis size={22} color={onForest.primary} strokeWidth={2} />
          </Pressable>
        }
        identity={{
          avatar: isGroup ? (
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: messenger.wellOnForest, alignItems: "center", justifyContent: "center" }}>
              <Users size={19} color={onForest.primary} strokeWidth={1.9} />
            </View>
          ) : (
            <View>
              <PersonAvatar name={conversation?.title ?? null} url={conversation?.avatarUrl ?? null} size={38} />
              {live?.online && <OnlineDot ring={colour.forest950} />}
            </View>
          ),
          subtitle,
          subtitleTone: thread.otherTyping || (!isGroup && live?.online) ? "live" : "default",
          // PEOPLE ON EVERY CONVERSATION: who is reading this, and where blocking somebody is reached.
          onPress: () => router.push({ pathname: "/messages/participants", params: { kind, id } }),
          accessibilityHint: "Shows the people in this conversation",
        }}
      />

      <ThreadList
        ref={list}
        items={thread.items}
        isGroup={isGroup}
        canReact={canSend}
        loadingOlder={thread.loadingOlder}
        hasMore={conversation?.hasMore ?? false}
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
        footer={thread.otherTyping && conversation ? <TypingLine name={conversation.title.split(" ")[0] ?? conversation.title} /> : null}
        header={
          <>
            {thread.problem && <ErrorState message={thread.problem} onRetry={thread.load} />}
            {!thread.problem && conversation === null && (
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
                onDecided={thread.load}
              />
            )}
            {conversation?.messages.length === 0 && conversation.clubConversationStatus !== "pending" && thread.items.length === 0 && (
              <EmptyState title="No messages yet" body={canSend ? "Say hello below." : "Nothing has been said here yet."} />
            )}
          </>
        }
      />

      <ReportedNotice visible={reported} onDone={clearReported} />
      {!!thread.reactionProblem && (
        <Pressable accessibilityRole="alert" onPress={thread.clearReactionProblem} style={{ paddingHorizontal: space.lg, paddingVertical: space.xs, backgroundColor: colour.dangerSurface }}>
          <Text style={[type.caption, { color: colour.danger }]}>{thread.reactionProblem}</Text>
        </Pressable>
      )}

      {conversation && (
        <Composer
          canSend={canSend}
          unavailableReason={conversation.unavailableReason}
          draft={draft}
          onChange={setDraft}
          onSend={() => void send()}
          error={sendError ?? attach.problem}
          onAttach={attach.openSheet}
          attachBusy={attach.picking}
          replyingTo={replyingTo}
          onCancelReply={() => {
            setReplyingTo(null)
            replyingMessage.current = null
          }}
          onTyping={thread.notifyTyping}
          quickReplies={quickReplies}
          onQuickReply={(text) => {
            requestAnimationFrame(() => list.current?.scrollToNewest())
            void thread.send(text, null)
          }}
          onVoice={
            canSend && thread.canSendVoice && !pending
              ? (voice) => {
                  requestAnimationFrame(() => list.current?.scrollToNewest())
                  void thread.sendVoice(voice)
                }
              : undefined
          }
          // The tab bar sits below this screen and already clears the home indicator.
          bottomInset={0}
          sendReady={shareReady(attach, hasText)}
          accessory={<ShareAccessory attach={attach} hasText={hasText} />}
        />
      )}

      <ShareSheets attach={attach} showDocuments={documentsOffered} />

      <MessageActionsSheet
        visible={acting !== null}
        canDelete={acting?.canDelete ?? false}
        canReport={acting?.canReport ?? false}
        busy={actionBusy}
        problem={actionProblem}
        myReaction={acting ? myReaction(acting.reactions ?? []) : null}
        preview={acting && !acting.isDeleted ? acting.body || (acting.attachment?.mimeType.startsWith("audio/") ? "Voice note" : null) : null}
        onInfo={
          acting && acting.isOwn && !acting.isDeleted
            ? () => {
                setInfo(acting)
                setActing(null)
              }
            : undefined
        }
        onReact={
          canSend && acting && !acting.isDeleted
            ? (emoji) => {
                const message = acting
                setActing(null)
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
        preview={info ? info.body || (info.attachment?.mimeType.startsWith("audio/") ? "Voice note" : null) : null}
        onClose={() => setInfo(null)}
      />

      <ReportSheet visible={reporting !== null} busy={actionBusy} problem={actionProblem} onSubmit={(reason) => void sendReport(reason)} onClose={() => setReporting(null)} />
    </KeyboardAvoidingView>
  )
}

const FIXTURE_QUICK_REPLIES = ["Yes 👍", "Not sure", "See you there!"] as const

/** The presence dot on a person's picture: bright green, ringed in the ground it sits on. */
function OnlineDot({ ring }: { ring: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: colour.pitch400, borderWidth: 2, borderColor: ring }}
    />
  )
}

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
