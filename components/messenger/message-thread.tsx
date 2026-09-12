"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowUp, Flag, MoreHorizontal, Trash2 } from "lucide-react"

import { UserAvatar } from "@/components/profile/user-avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { ThreadMessage } from "@/lib/messenger/thread-types"
import { cn } from "@/lib/utils"

/**
 * THE CONVERSATION, wherever Ovalball shows one.
 *
 * The compact Messenger panel and the /messages workspace render this same
 * component over the same ThreadMessage[] from the same server-side reader.
 * They differ by `density` and by what the caller hangs off a message -- not
 * by having two ideas of what a conversation looks like.
 *
 * THE GROUND IS A PITCH. Faint mown stripes, the same motif and roughly the
 * same weight as the Match Centre and Training Centre heroes, so a
 * conversation about a game sits somewhere that belongs to this product
 * rather than on the flat white panel every messaging app has. It is texture
 * at arm's length and nothing more: remove it and only the feeling goes.
 *
 * NEWEST AT THE TOP. Deliberate and reaffirmed -- these are operational club
 * conversations, opened to find the latest answer rather than read from the
 * beginning -- so the composer sits above and arrivals land in view.
 *
 * OWNERSHIP IS THE AUTHENTICATED SENDER. Mine is blue and right, everyone
 * else's is green and left, and alignment plus the squared tail corner carry
 * the same distinction as the colour so the thread survives without hue.
 */

export interface MessageThreadProps {
  messages: ThreadMessage[]
  density?: "compact" | "full"
  /** Rendered inside a bubble, under the body -- attachments, shared documents, contact cards. */
  renderExtras?: (message: ThreadMessage) => ReactNode
  /** Resolves ok:false with a reason rather than throwing. */
  onDeleteMessage?: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Raises a Support case. Returns the case reference when there is one. */
  onReportMessage?: (id: string, reason: string) => Promise<{ ok: true; reference: string | null } | { ok: false; error: string }>
  emptyTitle?: string
  emptyBody?: string
}

const RUN_GAP_MS = 5 * 60 * 1000

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function startsRun(current: ThreadMessage, previous: ThreadMessage | undefined): boolean {
  if (!previous) return true
  if (dayKey(previous.createdAt) !== dayKey(current.createdAt)) return true
  if (previous.isSystemEvent || current.isSystemEvent) return true
  if (previous.isOwn !== current.isOwn) return true
  if (previous.senderName !== current.senderName) return true
  return Math.abs(new Date(previous.createdAt).getTime() - new Date(current.createdAt).getTime()) > RUN_GAP_MS
}

export function MessageThread({
  messages,
  density = "full",
  renderExtras,
  onDeleteMessage,
  onReportMessage,
  emptyTitle = "No messages yet",
  emptyBody = "Confirm the kick-off time, the pitch, or anything else about this fixture.",
}: MessageThreadProps) {
  const ordered = [...messages].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  // ---------------------------------------------------------------------
  // ARRIVALS NEVER MOVE WHAT SOMEBODY IS READING.
  //
  // New messages land at the top, so the person at risk of being disturbed is
  // the one who has scrolled down into history. They keep their place and get
  // a quiet offer; everyone else simply sees the message, because it arrived
  // in view.
  // ---------------------------------------------------------------------
  // Delete and Report are deliberate acts, so each one asks first -- one
  // dialog for the whole thread rather than state on every bubble.
  const [pending, setPending] = useState<{ kind: "delete" | "report"; message: ThreadMessage } | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [pendingArrivals, setPendingArrivals] = useState(0)
  const seenCount = useRef(ordered.length)

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const onScroll = () => {
      if (node.scrollTop <= 48) setPendingArrivals(0)
    }
    node.addEventListener("scroll", onScroll, { passive: true })
    return () => node.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const arrived = ordered.length - seenCount.current
    seenCount.current = ordered.length
    if (arrived <= 0) return
    // Read the position from the DOM at the moment the message lands. Reading
    // it from state instead looked equivalent and was not: the effect closed
    // over a stale value and the offer never appeared.
    const node = scrollRef.current
    if (!node || node.scrollTop <= 48) return
    setPendingArrivals((n) => n + arrived)
  }, [ordered.length])

  function jumpToLatest() {
    // scrollTop, not scrollTo({ behavior: "smooth" }): the smooth version
    // silently did nothing on this container while still clearing the offer,
    // which dismissed it and moved nobody. Going straight there is also right
    // for anyone who asked for reduced motion.
    const node = scrollRef.current
    if (node) node.scrollTop = 0
    setPendingArrivals(0)
  }

  return (
    <div className="relative min-h-0 flex-1">
      {/* One status region for the whole thread: announces what a reader
          cannot see, and stays silent about what they can. */}
      <p aria-live="polite" className="sr-only">
        {pendingArrivals > 0 ? `${pendingArrivals} new ${pendingArrivals === 1 ? "message" : "messages"} above` : ""}
      </p>

      {pendingArrivals > 0 && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute inset-x-0 top-2.5 z-20 mx-auto flex h-9 w-fit items-center gap-1.5 rounded-full bg-forest-950 pr-4 pl-3 text-xs font-medium text-chalk shadow-[0_6px_20px_-6px_rgba(7,28,20,0.6)] outline-none transition-colors hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          <ArrowUp className="size-3.5" aria-hidden="true" />
          {pendingArrivals} new {pendingArrivals === 1 ? "message" : "messages"}
        </button>
      )}

      {/*
        THE QUIETEST SURFACE IN THE PRODUCT.
        Mown stripes were tried here and removed: texture behind a paragraph of
        text is texture you read through, and across a 900px canvas it fought
        every message on it. Ovalball's personality lives in the header, the
        crests, the bubbles and the type -- the reading area's whole job is to
        get out of the way. The stripes still run across the conversation
        header, where there is nothing to read through them.
      */}
      <div ref={scrollRef} className="relative h-full overflow-y-auto overscroll-contain bg-chalk">
        <div
          className={cn(
            // A READABLE COLUMN, not the whole workspace. At 1440 the messages
            // used to swim across the full width of the pane; they now sit in
            // a measure a person can actually track back through.
            "relative mx-auto w-full",
            density === "compact" ? "px-3 py-3" : "max-w-[46rem] px-5 py-6 sm:px-6"
          )}
        >
          {ordered.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
              <p className="font-display text-[1.0625rem] text-ink">{emptyTitle}</p>
              <p className="mt-1.5 max-w-[34ch] text-sm text-ink-muted">{emptyBody}</p>
            </div>
          ) : (
            <ul className="flex flex-col">
              {ordered.map((m, i) => {
                const previous = ordered[i - 1]
                const next = ordered[i + 1]
                const showDay = !previous || dayKey(previous.createdAt) !== dayKey(m.createdAt)
                const opensRun = showDay || startsRun(m, previous)
                // The visual foot of a run: where the next item begins a new
                // one, or there is no next item. Only the foot carries a
                // timestamp, so a burst of four messages reads as one thing
                // said rather than four timestamped events.
                const closesRun = !next || startsRun(next, m)

                if (m.isSystemEvent) {
                  return (
                    <li key={m.id} className="flex flex-col">
                      {showDay && <DaySeparator iso={m.createdAt} />}
                      <SystemEvent body={m.body} iso={m.createdAt} />
                    </li>
                  )
                }

                return (
                  <li
                    key={m.id}
                    className={cn(
                      "flex flex-col",
                      // Runs breathe; messages inside a run sit almost on top
                      // of each other, because they are one person still
                      // talking. The old uniform gap made four quick messages
                      // read as four separate events.
                      opensRun ? "mt-4 first:mt-0" : "mt-[2px]",
                      m.isOwn ? "items-end" : "items-start"
                    )}
                  >
                    {showDay && <DaySeparator iso={m.createdAt} />}

                    {/*
                      THE MESSAGE GROUP IS ONE OBJECT: the sender, the bubbles
                      and the time all sit in a column no wider than the widest
                      bubble. Previously the timestamp was a sibling of the
                      full-width row, so an own-message time floated at the far
                      edge of the workspace with nothing near it.
                    */}
                    <div
                      className={cn(
                        "flex min-w-0 flex-col",
                        density === "compact" ? "max-w-[88%]" : "max-w-[62%]",
                        m.isOwn ? "items-end" : "items-start"
                      )}
                    >
                      {opensRun && !m.isOwn && (
                        <div className="mb-1 flex items-center gap-1.5 pl-0.5">
                          <UserAvatar avatarUrl={m.senderAvatarUrl} name={m.senderName} size="xs" />
                          <p className="truncate text-xs font-semibold text-ink/80">
                            {m.senderName}
                            {m.senderRoleLabel && <span className="font-normal text-ink-muted"> · {m.senderRoleLabel}</span>}
                          </p>
                        </div>
                      )}

                      <div className="group/msg flex w-full items-end gap-1" style={{ justifyContent: m.isOwn ? "flex-end" : "flex-start" }}>
                        {m.isOwn && (
                          <MessageActions
                            message={m}
                            onDelete={onDeleteMessage ? () => setPending({ kind: "delete", message: m }) : undefined}
                            onReport={onReportMessage ? () => setPending({ kind: "report", message: m }) : undefined}
                            side="left"
                          />
                        )}

                        <div
                          className={cn(
                            // Short stays short: the bubble is sized by its
                            // content, and only capped by the group above.
                            "min-w-0 px-3.5 py-2 text-[0.9375rem] leading-[1.45] break-words whitespace-pre-wrap",
                            "rounded-[1.125rem]",
                            m.isDeleted
                              ? "border border-dashed border-ink/20 bg-transparent text-ink-muted italic"
                              : m.isOwn
                                ? "bg-messenger-blue text-white"
                                : "bg-white text-ink ring-1 ring-ink/[0.07]",
                            !m.isDeleted && !m.isOwn && "bg-mint-100 text-forest-950 ring-forest-900/[0.06]",
                            // The tail: squared on the side the message came
                            // from, and only on the last bubble of a run.
                            !m.isDeleted && closesRun && (m.isOwn ? "rounded-br-[6px]" : "rounded-bl-[6px]")
                          )}
                        >
                          {m.body}
                          {renderExtras?.(m)}
                        </div>

                        {!m.isOwn && (
                          <MessageActions
                            message={m}
                            onDelete={onDeleteMessage ? () => setPending({ kind: "delete", message: m }) : undefined}
                            onReport={onReportMessage ? () => setPending({ kind: "report", message: m }) : undefined}
                            side="right"
                          />
                        )}
                      </div>

                      {closesRun && (
                        <p className="mt-0.5 px-1 text-[11px] text-ink-subtle">
                          <time dateTime={m.createdAt}>{clockTime(m.createdAt)}</time>
                          {m.isOwn && <span className="sr-only"> · sent by you</span>}
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {pending && (
        <MessageActionDialog
          kind={pending.kind}
          message={pending.message}
          onClose={() => setPending(null)}
          onDelete={onDeleteMessage}
          onReport={onReportMessage}
        />
      )}
    </div>
  )
}

/**
 * DELETING AND REPORTING BOTH ASK FIRST.
 *
 * Delete says what it actually does. It does NOT say the message is destroyed,
 * because it is not: the record is retained for moderation and remains
 * readable to Support afterwards. Telling somebody their message is gone
 * forever when it is not would be a lie in the interface.
 *
 * Report needs a reason -- report_fixture_message refuses an empty one -- and
 * the compact Messenger was sending a hardcoded string in its place. It now
 * asks, and confirms with the real Support reference the server came back
 * with, so the person knows a case exists and what to quote.
 */
function MessageActionDialog({
  kind,
  message,
  onClose,
  onDelete,
  onReport,
}: {
  kind: "delete" | "report"
  message: ThreadMessage
  onClose: () => void
  onDelete?: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>
  onReport?: (id: string, reason: string) => Promise<{ ok: true; reference: string | null } | { ok: false; error: string }>
}) {
  const [reason, setReason] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function confirm() {
    setWorking(true)
    setError(null)
    const result = kind === "delete" ? await onDelete?.(message.id) : await onReport?.(message.id, reason.trim())
    setWorking(false)
    if (!result) return
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (kind === "report") {
      const reference = "reference" in result ? result.reference : null
      setDone(reference ? `Report sent to Ovalball Support · ${reference}` : "Report sent to Ovalball Support")
      return
    }
    onClose()
  }

  return (
    <div className="absolute inset-0 z-30 flex items-end justify-center bg-forest-950/25 p-3 sm:items-center">
      <div role="dialog" aria-modal="true" aria-label={kind === "delete" ? "Delete message" : "Report message"} className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-[0_24px_60px_-20px_rgba(7,28,20,0.5)]">
        {done ? (
          <>
            <p className="text-sm font-medium text-ink">{done}</p>
            <p className="mt-1.5 text-sm text-ink-muted">Ovalball Support can see the message even if it is deleted from the conversation.</p>
            <button type="button" onClick={onClose} className="mt-3 h-11 w-full rounded-full bg-forest-950 text-sm font-medium text-chalk outline-none hover:bg-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400">
              Done
            </button>
          </>
        ) : (
          <>
            <p className="font-display text-[1.0625rem] text-ink">{kind === "delete" ? "Delete this message?" : "Report this message"}</p>
            <p className="mt-1.5 text-sm text-ink-muted">
              {kind === "delete"
                ? "It will be removed from the conversation and replaced with a note that it was deleted. The record is kept for moderation."
                : "This opens a case with Ovalball Support. Tell them what is wrong with it."}
            </p>

            {kind === "report" && (
              <textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                aria-label="Why are you reporting this message?"
                placeholder="Why are you reporting this message?"
                className="mt-3 w-full resize-none rounded-xl bg-chalk px-3 py-2.5 text-sm text-ink ring-1 ring-ink/12 outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-pitch-600"
              />
            )}

            {error && (
              <p role="alert" className="mt-2 text-sm text-destructive-text">
                {error}
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={confirm}
                disabled={working || (kind === "report" && reason.trim().length === 0)}
                className="h-11 flex-1 rounded-full bg-destructive text-sm font-medium text-white outline-none transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                {working ? "Working…" : kind === "delete" ? "Delete Message" : "Send Report"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-11 flex-1 rounded-full bg-white text-sm font-medium text-ink ring-1 ring-ink/15 outline-none hover:bg-chalk focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * A SYSTEM EVENT IS NOT SOMETHING A PERSON SAID.
 *
 * "This fixture has been cancelled" is Ovalball reporting a fact, and it used
 * to be a grey pill sitting in the same rhythm as the bubbles around it --
 * close enough to a message to be read as one. It now spans the column as a
 * ruled line with the fact set into it: unmistakably the record of an event,
 * and impossible to mistake for a reply.
 */
function SystemEvent({ body, iso }: { body: string; iso: string }) {
  return (
    <div className="my-3 flex w-full flex-col items-center gap-1 self-stretch px-4">
      {/* One hairline above, and the fact set quietly beneath it. Flanking
          rules were tried and abandoned: a cancellation sentence is long
          enough to squeeze them to nothing at panel width, which left the
          treatment looking like a broken message rather than a record. */}
      <span className="h-px w-full max-w-[70%] bg-forest-900/10" aria-hidden="true" />
      <p className="text-center text-[11px] leading-snug text-balance text-ink-muted">
        {body}{" "}
        <time dateTime={iso} className="whitespace-nowrap text-ink-subtle">
          {clockTime(iso)}
        </time>
      </p>
    </div>
  )
}

/**
 * Safety actions, discoverable but secondary. One quiet control beside the
 * bubble it acts on -- always rendered, because a phone has no hover, and a
 * control that only exists under a pointer does not exist on a touchscreen.
 */
function MessageActions({
  message,
  onDelete,
  onReport,
  side,
}: {
  message: ThreadMessage
  onDelete?: () => void
  onReport?: () => void
  side: "left" | "right"
}) {
  const canDelete = message.canDelete && Boolean(onDelete)
  const canReport = message.canReport && Boolean(onReport)
  if (!canDelete && !canReport) return null

  return (
    <div className={cn("shrink-0 pb-0.5", side === "left" ? "order-first" : "order-last")}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`More actions for the message from ${message.senderName}`}
              className={cn(
                "flex size-7 items-center justify-center rounded-full text-ink-subtle outline-none transition-opacity",
                "opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-pitch-400",
                // A touchscreen has no hover, so the control has to be there
                // already -- faint, but present. Keyed on the INPUT device
                // rather than on viewport width, which is what a narrow panel
                // on a laptop was being mistaken for.
                "[@media(hover:none)]:opacity-50"
              )}
            >
              <MoreHorizontal className="size-3.5" aria-hidden="true" />
            </button>
          }
        />
        <DropdownMenuContent align={side === "left" ? "end" : "start"} className="w-48">
          {canReport && (
            <DropdownMenuItem onClick={() => onReport?.()} className="text-destructive-text">
              <Flag className="size-3.5 shrink-0" aria-hidden="true" />
              Report Message
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem onClick={() => onDelete?.()} className="text-destructive-text">
              <Trash2 className="size-3.5 shrink-0" aria-hidden="true" />
              Delete Message
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function DaySeparator({ iso }: { iso: string }) {
  const date = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const dayDiff = Math.round((startOfToday - startOfDate) / 86400000)
  const label =
    dayDiff === 0
      ? "Today"
      : dayDiff === 1
        ? "Yesterday"
        : dayDiff > 1 && dayDiff < 7
          ? date.toLocaleDateString("en-GB", { weekday: "long" })
          : date.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
            })

  return (
    // Chronology, not another floating chip competing for attention.
    <div className="my-4 flex w-full items-center gap-3 self-stretch first:mt-0">
      <span className="h-px flex-1 bg-ink/[0.08]" aria-hidden="true" />
      <h3 className="text-[10px] font-semibold tracking-[0.09em] text-ink-subtle uppercase">{label}</h3>
      <span className="h-px flex-1 bg-ink/[0.08]" aria-hidden="true" />
    </div>
  )
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
}
