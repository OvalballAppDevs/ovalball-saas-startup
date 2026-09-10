"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Ban, Flag, Megaphone, MessageSquare, Send, Trash2 } from "lucide-react"

import { sendFixtureMessage } from "@/app/(app)/fixtures/[fixtureId]/actions"
import {
  blockUserFromMessaging,
  deleteMessageAsStaff,
  deleteOwnMessage,
  reportMessage,
} from "@/app/(app)/fixtures/[fixtureId]/message-actions"
import type { FixtureConversationRef } from "@/lib/app-context/match-centre-data"
import { cn } from "@/lib/utils"

/**
 * THE FIXTURE CONVERSATION -- one thread, everybody invited to the match.
 *
 * There used to be two messaging surfaces on this page: a staff "Communication"
 * composer and a separate "Messages" list. They looked like two ways of saying
 * something to the same people, which made the page feel like an admin console
 * rather than a place a team talks. This is now the one place a message is
 * written and read.
 *
 * WHAT DID NOT MERGE INTO IT, AND WHY. The staff composer's audience-targeted
 * send is not a chat message: it produces a NOTIFICATION that reaches guardians
 * and eligible players through the safeguarding-aware recipient model, so it
 * lands with a family that never opens the app. Posting here is a message in a
 * thread, which reaches whoever comes and reads it. Folding the first into the
 * second would quietly stop families being told things. So the composer remains
 * as one clearly-labelled ANNOUNCE action inside this same section rather than
 * a second thread with its own textarea.
 *
 * THE BUBBLES
 *
 * Each person gets their own hue, derived from their user id, so a thread of
 * several people is readable at a glance -- the same trick a group chat uses.
 * Colour is never load-bearing: every message shows the sender's NAME, their
 * avatar or initials, and a timestamp, so the thread reads correctly in
 * greyscale and to a screen reader.
 *
 * MODERATION IS PRESENTATION ONLY. Report, remove and block are rendered from
 * capabilities the server resolved, and every one of them calls an RPC that
 * re-checks that capability. Hiding a control is a courtesy, never a boundary.
 */

export interface FixtureMessageRow {
  id: string
  body: string
  createdAt: string
  senderName: string
  senderUserId: string
  senderAvatarUrl: string | null
  senderInitials: string
  isOwn: boolean
  /** Already reported by somebody. The thread says so rather than offering to report it twice. */
  reported: boolean
}

/**
 * A stable hue per person.
 *
 * Derived from the user id so somebody is the same colour every time the
 * thread is opened, on every device, without storing a preference. The set is
 * hand-picked to sit on the chalk ground at AA contrast -- an algorithmically
 * generated hue would eventually produce yellow text on white.
 */
const SENDER_TONES = [
  { bubble: "bg-sky-50 border-sky-200/70", name: "text-sky-900" },
  { bubble: "bg-violet-50 border-violet-200/70", name: "text-violet-900" },
  { bubble: "bg-amber-50 border-amber-200/70", name: "text-amber-900" },
  { bubble: "bg-rose-50 border-rose-200/70", name: "text-rose-900" },
  { bubble: "bg-indigo-50 border-indigo-200/70", name: "text-indigo-900" },
  { bubble: "bg-orange-50 border-orange-200/70", name: "text-orange-900" },
]

// NOTHING GREEN IN HERE. The viewer's own bubble is pitch-green, and a teal
// tone for somebody else read as the same person's message at a glance --
// which is the one mistake a group chat must not make. Green belongs to "you".

function toneFor(userId: string) {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  return SENDER_TONES[hash % SENDER_TONES.length]
}

/** "Sat 12 Sept, 2:14pm" -- the date a message was sent, said the way a person would. */
function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(d)
  const time = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(" ", "")
  return `${date}, ${time}`
}

export function MessagingPanel({
  fixtureId,
  conversation,
  initialMessages,
  announce,
}: {
  fixtureId: string
  conversation: FixtureConversationRef
  initialMessages: FixtureMessageRow[]
  /**
   * The staff announcement composer, rendered inside this same section so the
   * page has ONE place messages are written. Null for a viewer who cannot
   * announce -- the slot simply is not there, rather than a disabled control
   * advertising something they cannot do.
   */
  announce?: React.ReactNode
}) {
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const endRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  // Newest message in view on arrival -- the thread is read from the bottom,
  // like every other conversation a person uses. Scoped to the scroller so it
  // never yanks the whole page, which would fight a reader who came here for
  // the venue.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [messages.length])

  useEffect(() => {
    setMessages(initialMessages)
  }, [initialMessages])

  if (!conversation.canView) {
    return (
      <section aria-labelledby="mc-messages-heading" className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
        <h2
          id="mc-messages-heading"
          className="flex items-center gap-2 border-b border-ink/8 bg-chalk px-5 py-3 text-xs font-medium tracking-[0.08em] text-ink-muted uppercase"
        >
          <MessageSquare className="size-3.5" aria-hidden="true" />
          Conversation
        </h2>
        <p className="px-5 py-4 text-sm text-ink-muted">This fixture&rsquo;s conversation is for the people playing in it and their club.</p>
      </section>
    )
  }

  function handleSend() {
    const body = draft.trim()
    if (!body) return
    setError(null)
    startTransition(async () => {
      const result = await sendFixtureMessage(fixtureId, body)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          body,
          createdAt: new Date().toISOString(),
          senderName: "You",
          senderUserId: conversation.viewerUserId,
          senderAvatarUrl: null,
          senderInitials: "You".slice(0, 2).toUpperCase(),
          isOwn: true,
          reported: false,
        },
      ])
      setDraft("")
    })
  }

  return (
    <section aria-labelledby="mc-messages-heading" className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
      <h2
        id="mc-messages-heading"
        className="flex items-center justify-between gap-3 border-b border-ink/8 bg-chalk px-5 py-3 text-xs font-medium tracking-[0.08em] text-ink-muted uppercase"
      >
        <span className="flex items-center gap-2">
          <MessageSquare className="size-3.5" aria-hidden="true" />
          Conversation
        </span>
        {messages.length > 0 && (
          <span className="text-xs font-normal normal-case tracking-normal text-ink-subtle">
            {messages.length} {messages.length === 1 ? "message" : "messages"}
          </span>
        )}
      </h2>

      {/*
        A bounded, scrolling thread rather than an ever-growing list. Fifty
        messages rendered inline pushed the compose box below the fold on a
        phone, so the one control somebody came to use was the hardest to
        reach. max-h rather than a fixed height, so a short thread does not
        sit in a tall empty box.
      */}
      <div
        ref={scrollerRef}
        className="flex max-h-[26rem] flex-col gap-3 overflow-y-auto bg-chalk/60 px-4 py-4 sm:px-5"
      >
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">
            Nothing here yet. This is where the team talks about this match.
          </p>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              fixtureId={fixtureId}
              canModerate={conversation.canModerate}
              onChanged={(id, patch) => setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)))}
              onRemoved={(id) => setMessages((prev) => prev.filter((x) => x.id !== id))}
            />
          ))
        )}
        <div ref={endRef} />
      </div>

      {conversation.canPost ? (
        <div className="border-t border-ink/8 px-4 py-3 sm:px-5">
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor="mc-message-draft">
              Write a Message
            </label>
            <textarea
              id="mc-message-draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter starts a line -- the convention
                // every messenger uses, so nobody has to learn this one.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Write a message…"
              className="min-h-11 flex-1 resize-none rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
            />
            <button
              type="button"
              disabled={isPending || !draft.trim()}
              onClick={handleSend}
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-forest-800 text-white shadow-sm outline-none transition-colors hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-40"
            >
              <Send className="size-4" aria-hidden="true" />
              <span className="sr-only">{isPending ? "Sending" : "Send message"}</span>
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive-text">
              {error}
            </p>
          )}
        </div>
      ) : (
        <p className="border-t border-ink/8 px-5 py-3 text-sm text-ink-muted">You can read this conversation but not post in it.</p>
      )}

      {/* Announcing is a different act from chatting -- it notifies families
          who never open the thread -- so it keeps its own disclosure inside
          this one section instead of becoming a second card on the page. */}
      {announce && (
        <details className="group border-t border-ink/8 bg-chalk">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
            <span className="flex items-center gap-2">
              <Megaphone className="size-4 shrink-0 text-forest-800" aria-hidden="true" />
              Announce to the Squad
            </span>
            <span className="text-xs font-normal text-ink-muted group-open:hidden">Notifies families, not just this thread</span>
          </summary>
          <div className="border-t border-ink/8">{announce}</div>
        </details>
      )}
    </section>
  )
}

/**
 * One message.
 *
 * The moderation controls sit BELOW the bubble rather than inside a hover
 * menu: hover does not exist on a phone, and a kebab that only appears on
 * pointer-over is a control a touch user cannot find. They are quiet until
 * focused, and each states what it does in words.
 */
function MessageBubble({
  message,
  fixtureId,
  canModerate,
  onChanged,
  onRemoved,
}: {
  message: FixtureMessageRow
  fixtureId: string
  canModerate: boolean
  onChanged: (id: string, patch: Partial<FixtureMessageRow>) => void
  onRemoved: (id: string) => void
}) {
  const [mode, setMode] = useState<"idle" | "reporting" | "blocking">("idle")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tone = toneFor(message.senderUserId)
  const isLocal = message.id.startsWith("local-")

  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk: () => void) {
    setBusy(true)
    setError(null)
    const result = await fn()
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onOk()
  }

  return (
    <div className={cn("flex w-full gap-2.5", message.isOwn && "flex-row-reverse")}>
      {message.senderAvatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- storage-hosted profile avatar.
        <img
          src={message.senderAvatarUrl}
          alt=""
          className="mt-0.5 size-8 shrink-0 rounded-full border border-ink/10 object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-forest-800/15 bg-forest-800/8 text-[10px] font-semibold text-forest-800"
        >
          {message.senderInitials}
        </span>
      )}

      <div className={cn("flex min-w-0 max-w-[85%] flex-col", message.isOwn && "items-end")}>
        <div
          className={cn(
            "rounded-2xl border px-3.5 py-2.5 shadow-sm",
            message.isOwn ? "rounded-tr-sm border-pitch-600/25 bg-pitch-600/10" : `rounded-tl-sm ${tone.bubble}`
          )}
        >
          <p className={cn("text-xs font-semibold", message.isOwn ? "text-forest-900" : tone.name)}>{message.senderName}</p>
          <p className="mt-1 text-sm break-words whitespace-pre-wrap text-ink">{message.body}</p>
          <p className="mt-1.5 text-[11px] text-ink-subtle">
            <time dateTime={message.createdAt}>{formatStamp(message.createdAt)}</time>
          </p>
        </div>

        {message.reported && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-900">
            <Flag className="size-3 shrink-0" aria-hidden="true" />
            Reported — a moderator will look at this.
          </p>
        )}

        {notice && <p className="mt-1 text-[11px] text-forest-800">{notice}</p>}
        {error && (
          <p role="alert" className="mt-1 text-[11px] text-destructive-text">
            {error}
          </p>
        )}

        {/* A message that only exists in this browser until the next load has
            no server id, so nothing can be done to it yet. */}
        {!isLocal && mode === "idle" && (
          <div className={cn("mt-1 flex flex-wrap items-center gap-x-3 gap-y-1", message.isOwn && "justify-end")}>
            {message.isOwn ? (
              <MessageAction
                Icon={Trash2}
                label="Delete"
                busy={busy}
                onClick={() => void run(() => deleteOwnMessage(fixtureId, message.id), () => onRemoved(message.id))}
              />
            ) : (
              !message.reported && <MessageAction Icon={Flag} label="Report" busy={busy} onClick={() => setMode("reporting")} />
            )}
            {canModerate && !message.isOwn && (
              <>
                <MessageAction
                  Icon={Trash2}
                  label="Remove"
                  busy={busy}
                  onClick={() => void run(() => deleteMessageAsStaff(fixtureId, message.id), () => onRemoved(message.id))}
                />
                <MessageAction Icon={Ban} label="Block Sender" busy={busy} onClick={() => setMode("blocking")} />
              </>
            )}
          </div>
        )}

        {mode !== "idle" && (
          <div className="mt-2 w-full rounded-xl border border-ink/12 bg-white px-3 py-2.5">
            <label htmlFor={`reason-${message.id}`} className="text-xs font-medium text-ink">
              {mode === "reporting" ? "What's the problem?" : `Why block ${message.senderName}?`}
            </label>
            {mode === "blocking" && (
              <p className="mt-1 text-[11px] text-ink-muted">
                They won&rsquo;t be able to post in this club&rsquo;s fixture conversations. They can still read them, still be
                messaged, and can still contact a safeguarding officer.
              </p>
            )}
            <textarea
              id={`reason-${message.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              maxLength={500}
              className="mt-1.5 w-full rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || (mode === "reporting" && reason.trim().length === 0)}
                onClick={() =>
                  void run(
                    () =>
                      mode === "reporting"
                        ? reportMessage(fixtureId, message.id, reason)
                        : blockUserFromMessaging(fixtureId, message.senderUserId, reason),
                    () => {
                      setMode("idle")
                      setReason("")
                      if (mode === "reporting") {
                        onChanged(message.id, { reported: true })
                        setNotice(null)
                      } else {
                        setNotice(`${message.senderName} can no longer post here.`)
                      }
                    }
                  )
                }
                className="min-h-11 rounded-lg bg-forest-800 px-4 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
              >
                {busy ? "Working…" : mode === "reporting" ? "Send Report" : "Block Sender"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode("idle")
                  setReason("")
                  setError(null)
                }}
                className="min-h-11 rounded-lg px-3 text-sm text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MessageAction({
  Icon,
  label,
  busy,
  onClick,
}: {
  Icon: typeof Flag
  label: string
  busy: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1 text-[11px] font-medium text-ink-subtle outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {label}
    </button>
  )
}
