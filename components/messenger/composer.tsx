"use client"

import { useRef, useState, type ReactNode } from "react"
import { AlertCircle, Loader2, Lock, SendHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * THE COMPOSER, in both Messenger surfaces.
 *
 * One reply box, one set of states, one set of manners. The compact panel and
 * the workspace differ only in what they hang in `extras` -- the workspace
 * offers attachments, a document from the club library and a contact card;
 * the panel offers none of those, because inventing them there would be
 * inventing features.
 *
 * NOTHING IS EVER SHOWN AS SENT THAT WAS NOT SENT. On failure the draft stays
 * exactly where it was, the reason is stated, and Try Again is a real second
 * attempt at the same message rather than a re-type. The caller owns the send;
 * this owns the honesty about it.
 */
export function Composer({
  onSend,
  disabled = false,
  disabledReason,
  placeholder = "Write a message…",
  extras,
  leading,
  footnote,
  density = "full",
  autoFocus = false,
  value,
  onValueChange,
  attachmentReady = false,
}: {
  /** Resolves ok:false with a reason rather than throwing. */
  onSend: (body: string) => Promise<{ ok: true } | { ok: false; error: string }>
  disabled?: boolean
  disabledReason?: string
  placeholder?: string
  extras?: ReactNode
  /** A control that belongs ON the composer row -- the workspace's "+" menu. */
  leading?: ReactNode
  /** One quiet line under the box, e.g. which club you are sending as. */
  footnote?: ReactNode
  density?: "compact" | "full"
  autoFocus?: boolean
  /**
   * Optional controlled draft. The compact Messenger lifts the draft up to the
   * panel so that closing and reopening -- which unmounts this component --
   * does not quietly throw away half a reply.
   */
  value?: string
  onValueChange?: (value: string) => void
  /**
   * True when something other than text is ready to send -- an image or a
   * file waiting in `extras`. Send used to be gated on typed text alone, so a
   * person could attach an image and find the Send button still dead: the
   * "uploaded... now what?" dead end. An attachment IS a message.
   */
  attachmentReady?: boolean
}) {
  const [internalDraft, setInternalDraft] = useState("")
  const draft = value ?? internalDraft
  const setDraft = (next: string) => {
    if (onValueChange) onValueChange(next)
    else setInternalDraft(next)
  }
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const canSend = (draft.trim().length > 0 || attachmentReady) && !sending

  async function send() {
    const body = draft.trim()
    // An image with no caption is a legitimate message, so an empty body is
    // only a reason to stop when there is nothing attached either.
    if ((!body && !attachmentReady) || sending) return
    setSending(true)
    setError(null)
    const result = await onSend(body)
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDraft("")
    setError(null)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter starts a line. The convention people already
    // have, and the reason the hint below says so out loud once.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  if (disabled) {
    // NOT A HIDDEN CONTROL. The composer is replaced by the reason there is
    // nothing to type into, so a restricted conversation looks deliberately
    // restricted rather than broken.
    return (
      <div className={cn("shrink-0 border-t border-ink/10 bg-white", density === "compact" ? "px-3 py-3" : "px-4 py-3.5 sm:px-6")}>
        <p className={cn("flex items-start gap-2 rounded-xl bg-chalk px-3.5 py-2.5 text-sm text-ink-muted ring-1 ring-ink/[0.06]", density === "full" && "mx-auto w-full max-w-[46rem]")}>
          <Lock className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          <span>{disabledReason ?? "You cannot reply in this conversation."}</span>
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "shrink-0 border-t border-ink/10 bg-white",
        density === "compact" ? "px-3 py-2.5" : "px-4 py-3 sm:px-6",
        // The floating assistant owns the bottom-right corner of every
        // authenticated page (measured: 116x48 against the viewport's right
        // edge). Without this the Send button sits underneath it and cannot be
        // clicked at all. On a wide screen there is room to step aside
        // horizontally; on a phone there is not, so the composer lifts above
        // the assistant's band instead of surrendering a third of its width.
        density === "full" && "max-lg:pb-20 lg:pr-36"
      )}
    >
      {/* ALIGNED TO THE READING COLUMN, not to the pane. The reply lines up
          under the messages it answers, and on a wide screen it stops short of
          the bottom-right corner where the floating assistant lives -- which
          it was otherwise sitting underneath. */}
      <div className={density === "compact" ? undefined : "mx-auto w-full max-w-[46rem]"}>
      {extras}

      {footnote && <div className="mb-1.5 px-0.5">{footnote}</div>}

      <div className="flex items-end gap-2">
        {leading}
        <div className="relative flex min-w-0 flex-1 items-end rounded-2xl bg-chalk ring-1 ring-ink/12 transition-shadow focus-within:ring-2 focus-within:ring-pitch-600">
          <textarea
            ref={textareaRef}
            value={draft}
            autoFocus={autoFocus}
            onChange={(e) => {
              setDraft(e.target.value)
              // Grow with the message, to a ceiling, so a long reply is
              // visible while being written but never eats the conversation.
              const el = e.target
              el.style.height = "auto"
              el.style.height = `${Math.min(el.scrollHeight, 132)}px`
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label="Message"
            rows={1}
            className="max-h-[132px] min-h-[44px] w-full resize-none bg-transparent px-3.5 py-3 text-[0.9375rem] leading-[1.4] text-ink outline-none placeholder:text-ink-subtle"
          />
        </div>

        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label={sending ? "Sending message" : "Send message"}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full text-white outline-none transition-all",
            "focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2",
            canSend
              ? "bg-messenger-blue shadow-[0_2px_8px_-2px_rgba(47,93,140,0.6)] hover:brightness-110"
              : "cursor-not-allowed bg-ink/15"
          )}
        >
          {sending ? (
            <Loader2 className="size-[18px] animate-spin" aria-hidden="true" />
          ) : (
            <SendHorizontal className="size-[18px]" aria-hidden="true" />
          )}
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-2 flex items-start gap-2 rounded-xl bg-destructive/[0.07] px-3 py-2.5 ring-1 ring-destructive/25">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive-text" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-destructive-text">{error}</p>
            <button
              type="button"
              onClick={send}
              className="mt-0.5 text-sm font-medium text-destructive-text underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              Try Again
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
