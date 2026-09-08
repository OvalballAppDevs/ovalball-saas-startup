"use client"

import { useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BellRing, Check, MessageSquare, Send, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { sendFixtureCommunication, type CommunicationAction } from "./communication-actions"

/**
 * The staff Communication section.
 *
 * The composer never shows an address, and the counts describe PLAYERS, not
 * the adults resolved behind them -- "12 attending" is what a coach
 * understands, and "19 recipients" would quietly publish which children have
 * two separated guardians to anyone who can read a squad list.
 *
 * Every button disables while sending. That is the client half of the
 * double-send guard; the server half is a 10-minute cooldown per actor per
 * action, which is what actually holds when the browser retries.
 */

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; message: string }
  | { kind: "error"; message: string }

export function CommunicationPanel({
  fixtureId,
  outstandingCount,
  attendingCount,
  teamCount,
}: {
  fixtureId: string
  /** Null means this viewer is not entitled to the figure -- the control is hidden rather than showing a confident zero. */
  outstandingCount: number | null
  attendingCount: number | null
  teamCount: number | null
}) {
  return (
    <section aria-labelledby="mc-comms-heading" className="rounded-lg border border-ink/10 bg-white px-5 py-4">
      <h2 id="mc-comms-heading" className="flex items-center gap-2 text-xs font-medium tracking-[0.08em] text-ink-muted uppercase">
        <MessageSquare className="size-3.5" aria-hidden="true" />
        Communication
      </h2>

      <div className="mt-3 flex flex-col divide-y divide-ink/8">
        {outstandingCount !== null && <ReminderRow fixtureId={fixtureId} outstandingCount={outstandingCount} />}
        {attendingCount !== null && (
          <ComposerRow
            fixtureId={fixtureId}
            action="MESSAGE_ATTENDEES"
            Icon={Check}
            label="Message attendees"
            audience={`${attendingCount} attending ${attendingCount === 1 ? "player" : "players"}`}
            disabled={attendingCount === 0}
            disabledHint="Nobody has said they're attending yet."
          />
        )}
        {teamCount !== null && (
          <ComposerRow
            fixtureId={fixtureId}
            action="MESSAGE_TEAM"
            Icon={Users}
            label="Message team"
            audience={`${teamCount} ${teamCount === 1 ? "player" : "players"} in this fixture`}
            disabled={teamCount === 0}
            disabledHint="There's nobody in this fixture yet."
          />
        )}
      </div>
    </section>
  )
}

function ReminderRow({ fixtureId, outstandingCount }: { fixtureId: string; outstandingCount: number }) {
  const router = useRouter()
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [confirming, setConfirming] = useState(false)

  async function send() {
    setStatus({ kind: "sending" })
    const result = await sendFixtureCommunication(fixtureId, "ATTENDANCE_REMINDER")
    setConfirming(false)
    if (!result.ok) {
      setStatus({ kind: "error", message: result.error })
      return
    }
    setStatus({ kind: "sent", message: "Reminder sent" })
    router.refresh()
  }

  const busy = status.kind === "sending"

  return (
    <div className="py-3 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <BellRing className="mt-0.5 size-4 shrink-0 text-forest-800" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-ink">Send attendance reminder</p>
            <p className="text-sm text-ink-muted">
              {outstandingCount === 0
                ? "Everyone has responded."
                : `${outstandingCount} ${outstandingCount === 1 ? "response" : "responses"} outstanding`}
            </p>
          </div>
        </div>

        {outstandingCount > 0 &&
          (confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" className="h-11" disabled={busy} onClick={() => void send()}>
                {busy ? "Sending…" : `Send to ${outstandingCount}`}
              </Button>
              <Button type="button" variant="ghost" className="h-11" disabled={busy} onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" className="h-11" onClick={() => setConfirming(true)}>
              Send reminder
            </Button>
          ))}
      </div>

      {/* A deliberate confirmation: this reaches families, and the count is
          the thing worth reading before it does. */}
      {confirming && (
        <p className="mt-2 text-sm text-ink">
          Send an attendance reminder for {outstandingCount} {outstandingCount === 1 ? "player" : "players"}?
        </p>
      )}
      <StatusLine status={status} />
    </div>
  )
}

function ComposerRow({
  fixtureId,
  action,
  Icon,
  label,
  audience,
  disabled,
  disabledHint,
}: {
  fixtureId: string
  action: CommunicationAction
  Icon: typeof Users
  label: string
  audience: string
  disabled: boolean
  disabledHint: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState("")
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fieldId = useId()

  const MAX = 2000
  const busy = status.kind === "sending"

  async function send() {
    setStatus({ kind: "sending" })
    const result = await sendFixtureCommunication(fixtureId, action, body)
    if (!result.ok) {
      setStatus({ kind: "error", message: result.error })
      return
    }
    setStatus({ kind: "sent", message: `Message sent to ${result.playerCount} ${result.playerCount === 1 ? "player" : "players"}` })
    setBody("")
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Icon className="mt-0.5 size-4 shrink-0 text-forest-800" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-ink">{label}</p>
            <p className="text-sm text-ink-muted">{disabled ? disabledHint : audience}</p>
          </div>
        </div>
        {!disabled && !open && (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              setOpen(true)
              setStatus({ kind: "idle" })
              // Focus moves into the composer that just appeared, so a
              // keyboard user is not left where the button used to be.
              requestAnimationFrame(() => textareaRef.current?.focus())
            }}
          >
            Write message
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-md border border-ink/10 bg-chalk px-3 py-3">
          <label htmlFor={fieldId} className="text-sm font-medium text-ink">
            {label}
          </label>
          <p className="mt-0.5 text-sm text-ink-muted">{audience}</p>
          <textarea
            ref={textareaRef}
            id={fieldId}
            value={body}
            maxLength={MAX}
            rows={4}
            disabled={busy}
            onChange={(e) => setBody(e.target.value)}
            className="mt-2 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
            placeholder="What do they need to know?"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className={cn("text-xs", body.length > MAX - 100 ? "text-amber-900" : "text-ink-subtle")}>
              {body.length} / {MAX}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" className="h-9 gap-1.5" disabled={busy || body.trim().length === 0} onClick={() => void send()}>
              <Send className="size-3.5" aria-hidden="true" />
              {busy ? "Sending…" : "Send message"}
            </Button>
            <Button type="button" variant="ghost" className="h-11" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <StatusLine status={status} />
    </div>
  )
}

/**
 * Outcomes are announced, not just coloured. aria-live carries them to a
 * screen reader, and the icon plus wording carries them to someone who
 * cannot distinguish the colours.
 */
function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle" || status.kind === "sending") {
    return (
      <p aria-live="polite" className="sr-only">
        {status.kind === "sending" ? "Sending" : ""}
      </p>
    )
  }
  return (
    <p
      aria-live="polite"
      className={cn("mt-2 flex items-center gap-1.5 text-sm", status.kind === "sent" ? "text-forest-800" : "text-destructive-text")}
    >
      {status.kind === "sent" && <Check className="size-3.5" aria-hidden="true" />}
      {status.message}
    </p>
  )
}
