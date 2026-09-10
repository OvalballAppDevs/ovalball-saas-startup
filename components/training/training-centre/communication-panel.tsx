"use client"

import { useState, useTransition } from "react"
import { BellRing, Check, CircleDashed, Megaphone, Send, Users } from "lucide-react"

import { sendTrainingCommunication, type TrainingAudience } from "@/app/(app)/training/[sessionId]/communication-actions"
import { cn } from "@/lib/utils"

/**
 * TELLING THE SQUAD SOMETHING.
 *
 * ONE composer, not a scattering of message buttons. Training Centre had no
 * communication surface at all: a coach could see that nine people had not
 * answered and then had to leave the product to ask them, which is the outcome
 * Ovalball exists to replace.
 *
 * THE AUDIENCE IS A CATEGORY, NEVER A LIST. Each choice sends one word to the
 * server, which resolves the actual people from the canonical register through
 * the same safeguarding rule fixtures use. This component never sees, holds or
 * transmits a recipient -- which is also why the confirmation says "14 people"
 * rather than naming other families' children.
 *
 * THE REMINDER IS PART OF THE SAME CONTROL, not a second feature bolted beside
 * it. "Awaiting a response" is simply the audience that has a canned message
 * available, so a coach chases outstanding replies with one tap and writes
 * their own words when they have some.
 *
 * NOTHING DISABLED AND USELESS. An audience with nobody in it is not offered.
 * When everyone has answered there is no reminder to send, and the control for
 * it is absent rather than greyed out.
 */

export interface AudienceCounts {
  teamPlayers: number
  attendingPlayers: number
  awaitingPlayers: number
  teamRecipients: number
  attendingRecipients: number
  awaitingRecipients: number
}

const COPY: Record<TrainingAudience, { label: string; Icon: typeof Users; hint: string }> = {
  MESSAGE_TEAM: { label: "Everyone", Icon: Users, hint: "Everyone expected at this session" },
  MESSAGE_ATTENDEES: { label: "Attending", Icon: Check, hint: "Only those who said they are coming" },
  MESSAGE_AWAITING: { label: "Not Answered", Icon: CircleDashed, hint: "Only those who have not replied yet" },
  ATTENDANCE_REMINDER: { label: "Reminder", Icon: BellRing, hint: "A standard nudge to reply" },
}

export function TrainingCommunicationPanel({ sessionId, counts }: { sessionId: string; counts: AudienceCounts }) {
  const [audience, setAudience] = useState<TrainingAudience>("MESSAGE_TEAM")
  const [body, setBody] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const recipientsFor: Record<TrainingAudience, number> = {
    MESSAGE_TEAM: counts.teamRecipients,
    MESSAGE_ATTENDEES: counts.attendingRecipients,
    MESSAGE_AWAITING: counts.awaitingRecipients,
    ATTENDANCE_REMINDER: counts.awaitingRecipients,
  }
  const playersFor: Record<TrainingAudience, number> = {
    MESSAGE_TEAM: counts.teamPlayers,
    MESSAGE_ATTENDEES: counts.attendingPlayers,
    MESSAGE_AWAITING: counts.awaitingPlayers,
    ATTENDANCE_REMINDER: counts.awaitingPlayers,
  }

  // Only offer an audience that has somebody in it.
  const available = (Object.keys(COPY) as TrainingAudience[]).filter((a) => playersFor[a] > 0)
  const isReminder = audience === "ATTENDANCE_REMINDER"
  const recipients = recipientsFor[audience]
  const canSend = recipients > 0 && (isReminder || body.trim().length > 0)

  if (available.length === 0) {
    return (
      <Section>
        <p className="px-5 py-6 text-sm text-ink-muted">
          There is nobody to message for this session yet. Once players are on the team you can tell them about training from here.
        </p>
      </Section>
    )
  }

  function send() {
    setError(null)
    startTransition(async () => {
      const r = await sendTrainingCommunication(sessionId, audience, isReminder ? null : body.trim())
      if (!r.ok) {
        setError(r.message)
        setConfirming(false)
        return
      }
      setConfirming(false)
      setBody("")
      setResult(
        r.outcome === "NO_ELIGIBLE_RECIPIENTS"
          ? "Nobody on this session could be contacted — there is no guardian or eligible player account to reach."
          : r.outcome === "RATE_LIMITED"
            ? "You have just sent this. Give it a few minutes before sending again."
            : `Sent to ${r.recipients} ${r.recipients === 1 ? "person" : "people"}.`
      )
    })
  }

  return (
    <Section>
      <div className="flex flex-col gap-4 px-5 py-4">
        <fieldset>
          <legend className="text-xs font-medium tracking-[0.08em] text-ink-muted uppercase">Who To Tell</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {available.map((a) => {
              const c = COPY[a]
              const selected = audience === a
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setAudience(a)
                    setResult(null)
                    setConfirming(false)
                  }}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium outline-none transition-[transform,box-shadow,background-color] duration-100 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 active:translate-y-[2px] active:shadow-none",
                    selected
                      ? "border-forest-950 bg-forest-900 font-semibold text-chalk shadow-none"
                      : "border-ink/12 bg-white text-ink shadow-[0_2px_0_0_theme(colors.ink/10%)] hover:bg-chalk"
                  )}
                >
                  <c.Icon className="size-4 shrink-0" aria-hidden="true" />
                  {c.label}
                  <span className={cn("tabular-nums", selected ? "text-chalk/70" : "text-ink-subtle")}>{playersFor[a]}</span>
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-sm text-ink-muted">{COPY[audience].hint}.</p>
        </fieldset>

        {!isReminder && (
          <div>
            <label htmlFor="tc-message" className="text-xs font-medium tracking-[0.08em] text-ink-muted uppercase">
              Message
            </label>
            <textarea
              id="tc-message"
              value={body}
              onChange={(e) => {
                setBody(e.target.value)
                setResult(null)
                setConfirming(false)
              }}
              rows={3}
              maxLength={2000}
              placeholder="Training has moved to Pitch 2 tonight."
              className="mt-1.5 w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
            />
          </div>
        )}

        {/* THE CONFIRMATION IS A COUNT, NOT A LIST. */}
        {confirming ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-forest-800/20 bg-forest-800/5 px-4 py-3">
            <p className="min-w-0 flex-1 text-sm text-forest-900">
              Send to {recipients} {recipients === 1 ? "person" : "people"}?
              <span className="mt-0.5 block text-xs text-ink-muted">
                Guardians are contacted for younger players, and players themselves where they are old enough.
              </span>
            </p>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-ink-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={send}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-forest-900 px-4 text-sm font-semibold text-chalk hover:bg-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
            >
              <Send className="size-4" aria-hidden="true" />
              {isPending ? "Sending…" : "Send"}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!canSend}
              onClick={() => setConfirming(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-forest-900 px-4 text-sm font-semibold text-chalk shadow-[0_2px_0_0_theme(colors.forest.950)] transition-[transform,box-shadow] hover:bg-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 focus-visible:outline-none active:translate-y-[2px] active:shadow-none disabled:opacity-45 disabled:shadow-none"
            >
              {isReminder ? <BellRing className="size-4" aria-hidden="true" /> : <Megaphone className="size-4" aria-hidden="true" />}
              {isReminder ? "Send Reminder" : "Send Message"}
            </button>
            {recipients === 0 && (
              <p className="text-sm text-ink-muted">Nobody in this group can be contacted yet.</p>
            )}
          </div>
        )}

        {/* One live region for both outcomes, so a screen reader is told what
            happened without hunting for it. */}
        <p aria-live="polite" className="sr-only">
          {error ?? result ?? ""}
        </p>
        {result && !error && (
          <p className="rounded-xl border border-pitch-600/25 bg-pitch-400/10 px-4 py-2.5 text-sm text-forest-900">{result}</p>
        )}
        {error && (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive-text">
            {error}
          </p>
        )}
      </div>
    </Section>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="tc-comms-heading" className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
      <h2
        id="tc-comms-heading"
        className="flex items-center gap-2 border-b border-ink/8 bg-chalk px-5 py-3 text-xs font-medium tracking-[0.08em] text-ink-muted uppercase"
      >
        <Megaphone className="size-3.5" aria-hidden="true" />
        Tell The Squad
      </h2>
      {children}
    </section>
  )
}
