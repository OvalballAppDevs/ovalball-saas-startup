"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ExternalLink, MessageSquarePlus, Search } from "lucide-react"

import { ConversationRow } from "@/components/messenger/conversation-row"
import { Composer } from "@/components/messenger/composer"
import { MessageThread } from "@/components/messenger/message-thread"
import { ClubAvatar } from "@/components/club/club-avatar"
import { createClient } from "@/lib/supabase/client"
import { byRecentActivity, type MessengerRow } from "@/lib/messenger/view-model"
import { cn } from "@/lib/utils"

import {
  openCompactConversation,
  type CompactConversation,
  type CompactConversationKind,
} from "@/app/(app)/messages/compact-actions"
import { deleteOwnMessage, markConversationRead, reportMessage, sendFixtureMessage } from "@/app/(app)/messages/actions"
import { respondToClubMessageRequest } from "@/app/(app)/messages/club-actions"

/**
 * COMPACT MESSENGER -- a real Messenger, not a preview list.
 *
 * The whole point of the control in the header is that you can deal with a
 * message without leaving what you were doing. It used to open a list of
 * conversations whose only affordance was a link that took you away from the
 * page you were on, which is the opposite of that.
 *
 * TWO STATES IN ONE PANEL:
 *
 *   INBOX         recent conversations, searchable, unread obvious
 *   CONVERSATION  Back, who and why, the real history, a real composer
 *
 * Everything here goes through the canonical system: openCompactConversation
 * reads through the same server-side reader the workspace uses, sendFixture-
 * Message is the same send, markConversationRead is the same read, and the
 * Realtime topic is the same channel. There is no local message store and no
 * optimistic success -- a message appears when the server says it exists.
 */

/**
 * The conversation view carries the ROW that opened it.
 *
 * Identity comes from getMessengerRows -- the same source the list beside it
 * uses -- rather than being resolved a second time when the conversation
 * opens. Two derivations meant two answers: the row said "Rossendale RUFC"
 * (fixtures.raw_opposition_text) while a freshly-resolved header said
 * "Wharfedale" (fixtures.opponent_directory_id), inside one panel, six pixels
 * apart. The underlying disagreement in the fixture row is a separate defect;
 * this makes sure Messenger cannot be the place it shows up.
 */
type View =
  | { name: "inbox" }
  | { name: "conversation"; kind: CompactConversationKind; id: string; row: MessengerRow }

export interface CompactMessengerState {
  view: View
  setView: (view: View) => void
  draft: string
  setDraft: (draft: string) => void
}

/**
 * The panel's state lives in the header control, which never unmounts, so
 * closing and reopening Messenger returns you to the conversation you were
 * reading and to the reply you had half-written.
 */
export function useCompactMessengerState(): CompactMessengerState {
  const [view, setView] = useState<View>({ name: "inbox" })
  const [draft, setDraft] = useState("")
  return { view, setView, draft, setDraft }
}

export function CompactMessenger({
  rows,
  canStartConversation,
  state,
  onClose,
  density = "panel",
}: {
  rows: MessengerRow[]
  canStartConversation: boolean
  state: CompactMessengerState
  onClose: () => void
  /** "panel" is the anchored desktop pop-down; "sheet" is the mobile surface. */
  density?: "panel" | "sheet"
}) {
  if (state.view.name === "conversation") {
    return (
      <CompactConversationView
        kind={state.view.kind}
        id={state.view.id}
        row={state.view.row}
        state={state}
        onBack={() => {
          state.setView({ name: "inbox" })
          state.setDraft("")
        }}
        onClose={onClose}
        density={density}
      />
    )
  }
  return <CompactInbox rows={rows} canStartConversation={canStartConversation} state={state} onClose={onClose} />
}

/* ------------------------------------------------------------------ inbox */

function CompactInbox({
  rows,
  canStartConversation,
  state,
  onClose,
}: {
  rows: MessengerRow[]
  canStartConversation: boolean
  state: CompactMessengerState
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const visible = [...rows]
    .filter(
      (r) =>
        !needle ||
        r.title.toLowerCase().includes(needle) ||
        (r.context ?? "").toLowerCase().includes(needle) ||
        (r.preview ?? "").toLowerCase().includes(needle)
    )
    .sort(byRecentActivity)

  const unread = rows.reduce((sum, r) => sum + r.unreadCount, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <PanelHeader
        title="Messages"
        subtitle={unread > 0 ? `${unread} unread` : "Up to date"}
        right={
          canStartConversation ? (
            <Link
              href="/messages/new"
              onClick={onClose}
              aria-label="New Message"
              className="flex size-9 items-center justify-center rounded-full text-chalk/80 outline-none transition-colors hover:bg-white/12 hover:text-chalk focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <MessageSquarePlus className="size-[18px]" aria-hidden="true" />
            </Link>
          ) : null
        }
      />

      <div className="shrink-0 border-b border-ink/[0.08] px-3 py-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="h-10 w-full rounded-full bg-chalk pr-3 pl-9 text-sm text-ink outline-none ring-1 ring-ink/10 placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-pitch-600"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {visible.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="font-display text-[1.0625rem] text-ink">{needle ? "Nothing matches that" : "No conversations yet"}</p>
            <p className="mx-auto mt-1.5 max-w-[28ch] text-sm text-ink-muted">
              {needle
                ? "Try a club name, a team, or a word from the message."
                : "Fixture requests, fixture conversations and club messages arrive here."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-ink/[0.06]">
            {visible.map((row) => (
              <li key={row.key}>
                <ConversationRow
                  row={row}
                  density="compact"
                  // SELECTING DOES NOT NAVIGATE. It turns this panel into the
                  // conversation -- the entire reason the control exists.
                  // Support threads stay a link: the Support surface owns that
                  // conversation and its reply box, so there is one place a
                  // support reply can be written. Everything else opens here.
                  onSelect={
                    row.kind === "support"
                      ? undefined
                      : () =>
                          state.setView({
                            name: "conversation",
                            kind: row.kind as CompactConversationKind,
                            id: conversationIdFromHref(row.href),
                            row,
                          })
                  }
                  onNavigate={onClose}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <PanelFooter href="/messages" label="Open Messages Workspace" onClose={onClose} />
    </div>
  )
}

function conversationIdFromHref(href: string): string {
  return href.split("/").pop() ?? ""
}

/* ----------------------------------------------------------- conversation */

function CompactConversationView({
  kind,
  id,
  row,
  state,
  onBack,
  onClose,
  density,
}: {
  kind: CompactConversationKind
  id: string
  row: MessengerRow
  state: CompactMessengerState
  onBack: () => void
  onClose: () => void
  density: "panel" | "sheet"
}) {
  const router = useRouter()
  const [conversation, setConversation] = useState<CompactConversation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [responding, setResponding] = useState(false)

  const load = useCallback(async () => {
    const result = await openCompactConversation(kind, id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setConversation(result.conversation)
  }, [kind, id])

  useEffect(() => {
    // `active` guards against a slow first conversation resolving after the
    // person has already gone back and opened a different one -- without it,
    // the panel would briefly show the wrong thread.
    let active = true
    openCompactConversation(kind, id).then((result) => {
      if (!active) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      setError(null)
      setConversation(result.conversation)
    })
    // Reading a conversation is reading it, in the panel exactly as in the
    // workspace -- the same canonical mark-read, so the badge moves either way.
    void markConversationRead(kind, id)
    return () => {
      active = false
    }
  }, [kind, id])

  // REALTIME, ON THE EXISTING CHANNEL. The same topic the workspace joins and
  // the same broadcast the database already sends; the panel simply re-reads
  // when it hears one. No second subscription model, no local message store.
  useEffect(() => {
    const topic = conversation?.presenceTopic
    if (!topic) return
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    // The token has to reach the socket before it joins a private topic --
    // otherwise realtime refuses the join, supabase-js quietly retries, and
    // anything that arrives in the meantime is lost. See the same guard in
    // useFixturePresence.
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled || !session) return

      await supabase.realtime.setAuth(session.access_token)
      if (cancelled) return

      channel = supabase.channel(topic, { config: { private: true } })
      channel.on("broadcast", { event: "fixture_message_inserted" }, () => {
        void load()
        void markConversationRead(kind, id)
        // The workspace behind the panel holds the same conversation and the
        // same unread counts; refreshing it keeps the two from disagreeing.
        router.refresh()
      })
      void channel.subscribe()
    })()

    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [conversation?.presenceTopic, load, router, kind, id])

  async function handleSend(body: string) {
    const result = await sendFixtureMessage(kind, id, body)
    if (!result.ok) return result
    // Re-read rather than push a local copy: the message the panel shows is
    // the message the server stored, which is what makes it the same one the
    // workspace and the preview will show.
    await load()
    router.refresh()
    return { ok: true as const }
  }

  async function respond(approve: boolean) {
    setResponding(true)
    const result = await respondToClubMessageRequest(id, approve)
    setResponding(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await load()
    router.refresh()
  }

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <PanelHeader title={row.title} subtitle="Unavailable" crestUrl={row.logoUrl} onBack={onBack} />
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
          <p className="font-display text-[1.0625rem] text-ink">This conversation could not be opened</p>
          <p className="mt-1.5 max-w-[32ch] text-sm text-ink-muted">{error}</p>
          <button
            type="button"
            onClick={onBack}
            className="mt-4 inline-flex h-11 items-center rounded-full bg-forest-950 px-4 text-sm font-medium text-chalk outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Back to Messages
          </button>
        </div>
      </div>
    )
  }

  if (!conversation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-white">
        <PanelHeader title={row.title} subtitle="Opening…" crestUrl={row.logoUrl} onBack={onBack} />
        <ThreadSkeleton />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <PanelHeader
        title={row.title}
        subtitle={row.context ?? undefined}
        crestUrl={row.logoUrl}
        onBack={onBack}
        right={
          <Link
            href={conversation.href}
            onClick={onClose}
            aria-label="Open this conversation in the Messages workspace"
            title="Open in Messages"
            className="flex size-9 items-center justify-center rounded-full text-chalk/80 outline-none transition-colors hover:bg-white/12 hover:text-chalk focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <ExternalLink className="size-[17px]" aria-hidden="true" />
          </Link>
        }
      />

      {conversation.requestSide && (
        <RequestDecision
          side={conversation.requestSide}
          otherClubName={row.title}
          busy={responding}
          onRespond={respond}
        />
      )}

      <MessageThread
        messages={conversation.messages}
        density="compact"
        // THE SAME SERVER ACTIONS AS THE WORKSPACE. One delete, one report,
        // one authority -- the panel is a second window, never second logic.
        onDeleteMessage={async (messageId) => {
          const result = await deleteOwnMessage(messageId)
          if (result.ok) {
            await load()
            router.refresh()
          }
          return result
        }}
        onReportMessage={async (messageId, reason) => {
          const result = await reportMessage(messageId, reason)
          if (result.ok) await load()
          return result
        }}
        emptyTitle="No messages yet"
        emptyBody="Say what you need to arrange, and it will appear here."
      />

      <Composer
        density={density === "sheet" ? "full" : "compact"}
        onSend={handleSend}
        disabled={!conversation.canCompose}
        disabledReason={
          conversation.requestSide === "requester"
            ? "You can write again once they accept your request."
            : "This conversation isn't open yet."
        }
        value={state.draft}
        onValueChange={state.setDraft}
        placeholder={`Message ${row.title}…`}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- pieces */

/**
 * THE PANEL'S OWN HEADER, in Ovalball's dark forest rather than the flat white
 * every messaging dropdown has. It is the single thing that makes this read as
 * part of the product instead of a floating box, and it carries the mown
 * stripes the Match Centre and Training Centre heroes use.
 */
function PanelHeader({
  title,
  subtitle,
  crestUrl,
  onBack,
  right,
}: {
  title: string
  subtitle?: string
  crestUrl?: string | null
  onBack?: () => void
  right?: React.ReactNode
}) {
  return (
    <div className="relative shrink-0 overflow-hidden bg-gradient-to-b from-forest-900 to-forest-950 text-chalk">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex">
        {Array.from({ length: 8 }).map((_, i) => (
          <span key={i} className={cn("h-full flex-1", i % 2 === 0 ? "bg-white/[0.035]" : "bg-transparent")} />
        ))}
      </div>
      <div className="relative flex items-center gap-2 px-2.5 py-2.5">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to conversations"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-chalk/85 outline-none transition-colors hover:bg-white/12 hover:text-chalk focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <ArrowLeft className="size-[18px]" aria-hidden="true" />
          </button>
        )}
        {crestUrl !== undefined && (
          <ClubAvatar logoUrl={crestUrl ?? null} name={title} size="sm" className="shrink-0 ring-1 ring-white/15" />
        )}
        <div className={cn("min-w-0 flex-1", !onBack && !crestUrl && "pl-1.5")}>
          <p className="truncate font-display text-[1.0625rem] leading-tight text-chalk">{title}</p>
          {subtitle && <p className="truncate text-xs text-chalk/60">{subtitle}</p>}
        </div>
        {right}
      </div>
    </div>
  )
}

function PanelFooter({ href, label, onClose }: { href: string; label: string; onClose: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className="flex shrink-0 items-center justify-center gap-1.5 border-t border-ink/[0.08] bg-white px-4 py-3 text-sm font-medium text-forest-800 outline-none transition-colors hover:bg-chalk hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-inset"
    >
      {label}
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </Link>
  )
}

function RequestDecision({
  side,
  otherClubName,
  busy,
  onRespond,
}: {
  side: "recipient" | "requester"
  otherClubName: string
  busy: boolean
  onRespond: (approve: boolean) => void
}) {
  if (side === "requester") {
    return (
      <p className="shrink-0 border-b border-ink/[0.08] bg-chalk px-4 py-2.5 text-xs text-ink-muted">
        Waiting for {otherClubName} to accept your request.
      </p>
    )
  }
  return (
    <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/[0.08] px-3.5 py-3">
      <p className="text-sm font-medium text-ink">{otherClubName} would like to message you</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onRespond(true)}
          className="h-10 flex-1 rounded-full bg-forest-950 text-sm font-medium text-chalk outline-none transition-colors hover:bg-forest-900 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          {busy ? "Working…" : "Accept"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRespond(false)}
          className="h-10 flex-1 rounded-full bg-white text-sm font-medium text-ink ring-1 ring-ink/15 outline-none transition-colors hover:bg-chalk disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          Decline
        </button>
      </div>
    </div>
  )
}

function ThreadSkeleton() {
  return (
    <div className="flex-1 space-y-3 px-3 py-4" aria-hidden="true">
      {[72, 54, 84, 46].map((w, i) => (
        <div key={i} className={cn("flex", i % 2 === 0 ? "justify-start" : "justify-end")}>
          <div
            className={cn("h-9 animate-pulse rounded-[1.125rem]", i % 2 === 0 ? "bg-mint-100" : "bg-ink/8")}
            style={{ width: `${w}%` }}
          />
        </div>
      ))}
    </div>
  )
}
