"use client"

import { useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { BellRing, Check, MessageSquare, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { sendFixtureCommunication, type CommunicationAction } from "./communication-actions"

/**
 * ONE COMMUNICATION EXPERIENCE.
 *
 * This section used to be three stacked controls, each with its own inline
 * composer: "Send attendance reminder", "Message attendees", "Message team".
 * Two of them were the same composer with a different recipient rule, and both
 * could be open at once -- two identical textareas on screen, one above the
 * other, each labelled slightly differently. The page grew a button every time
 * a new audience was needed.
 *
 * So there is now one composer, and the audience is a choice inside it. Adding
 * an audience in future is a row in a list, not another card.
 *
 * WHY THE REMINDER IS STILL ITS OWN ACTION, in this same section rather than
 * as a fourth audience: its semantics genuinely differ. It carries no message
 * -- it asks for a response, and deliberately cannot say anything else,
 * because a nudge that could carry free text is a message with a misleading
 * name. It also cannot change anybody's answer, which the copy says out loud.
 *
 * WHAT THE BROWSER MAY CHOOSE, AND WHAT IT MAY NOT.
 *
 * The browser picks a canonical AUDIENCE CATEGORY -- a word from a closed set.
 * It never picks people. There is no recipient list, no email address, no
 * player id and no user id in anything this component sends: the server
 * resolves who that category means from canonical relationships under an
 * authority check this file cannot reach or weaken. That is why the counts
 * below describe PLAYERS rather than the adults resolved behind them -- "12
 * attending" is what a coach understands, and "19 recipients" would quietly
 * publish which children have two separated guardians to anybody who can read
 * a squad list.
 *
 * Every control disables while sending. That is the client half of the
 * double-send guard; the server half is a per-actor, per-action cooldown,
 * which is what actually holds when a browser retries.
 */

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; message: string }
  | { kind: "error"; message: string }

interface AudienceOption {
  action: Extract<CommunicationAction, "MESSAGE_TEAM" | "MESSAGE_ATTENDEES">
  label: string
  /** Player-population description, never a recipient count. */
  describe: (n: number) => string
  count: number | null
}

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
  const router = useRouter()
  const groupId = useId()
  const fieldId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const audiences: AudienceOption[] = (
    [
      {
        action: "MESSAGE_TEAM",
        label: "Whole team",
        describe: (n: number) => `${n} ${n === 1 ? "player" : "players"} in this fixture`,
        count: teamCount,
      },
      {
        action: "MESSAGE_ATTENDEES",
        label: "Attending",
        describe: (n: number) => `${n} attending ${n === 1 ? "player" : "players"}`,
        count: attendingCount,
      },
    ] satisfies AudienceOption[]
  ).filter((a) => a.count !== null)

  const [audience, setAudience] = useState<AudienceOption["action"]>(audiences[0]?.action ?? "MESSAGE_TEAM")
  const [body, setBody] = useState("")
  const [status, setStatus] = useState<Status>({ kind: "idle" })

  const MAX = 2000
  const busy = status.kind === "sending"
  const selected = audiences.find((a) => a.action === audience) ?? null
  const selectedCount = selected?.count ?? 0
  const canSend = selected !== null && selectedCount > 0 && body.trim().length > 0 && !busy

  async function send() {
    setStatus({ kind: "sending" })
    const result = await sendFixtureCommunication(fixtureId, audience, body)
    if (!result.ok) {
      setStatus({ kind: "error", message: result.error })
      return
    }
    setStatus({
      kind: "sent",
      message: `Message sent to ${result.playerCount} ${result.playerCount === 1 ? "player" : "players"}`,
    })
    setBody("")
    router.refresh()
  }

  return (
    <section aria-labelledby="mc-comms-heading" className="overflow-hidden rounded-2xl border border-ink/10 bg-white">
      <h2
        id="mc-comms-heading"
        className="flex items-center gap-2 border-b border-ink/8 bg-chalk px-5 py-3 text-xs font-medium tracking-[0.08em] text-ink-muted uppercase"
      >
        <MessageSquare className="size-3.5" aria-hidden="true" />
        Communication
      </h2>

      {audiences.length > 0 && (
        <div className="px-5 py-4">
          <fieldset>
            <legend id={groupId} className="text-sm font-medium text-ink">
              Who is this for?
            </legend>
            {/* Real radios rather than styled buttons: this is one choice from
                a closed set, and arrow-key navigation between the options is
                what a keyboard user expects from that. */}
            <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {audiences.map((a) => {
                const empty = (a.count ?? 0) === 0
                const isSelected = audience === a.action
                return (
                  <label
                    key={a.action}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3.5 py-2.5 transition-colors",
                      isSelected ? "border-pitch-600 bg-pitch-600/8" : "border-ink/12 hover:bg-ink/[0.02]",
                      empty && "cursor-not-allowed opacity-60"
                    )}
                  >
                    <input
                      type="radio"
                      name={`${groupId}-audience`}
                      value={a.action}
                      checked={isSelected}
                      disabled={empty || busy}
                      onChange={() => {
                        setAudience(a.action)
                        setStatus({ kind: "idle" })
                      }}
                      className="mt-0.5 size-4 shrink-0 accent-pitch-600"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">{a.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {empty
                          ? a.action === "MESSAGE_ATTENDEES"
                            ? "Nobody has said they're attending yet."
                            : "There's nobody in this fixture yet."
                          : a.describe(a.count ?? 0)}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>

          <div className="mt-4">
            <label htmlFor={fieldId} className="text-sm font-medium text-ink">
              Message
            </label>
            <textarea
              ref={textareaRef}
              id={fieldId}
              value={body}
              maxLength={MAX}
              rows={4}
              disabled={busy || selectedCount === 0}
              onChange={(e) => {
                setBody(e.target.value)
                if (status.kind !== "idle") setStatus({ kind: "idle" })
              }}
              className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none disabled:bg-ink/[0.03]"
              placeholder="What do they need to know?"
            />
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
              <span className={cn("text-xs", body.length > MAX - 100 ? "text-amber-900" : "text-ink-subtle")}>
                {body.length} / {MAX}
              </span>
              <Button type="button" className="h-11 gap-1.5 px-5" disabled={!canSend} onClick={() => void send()}>
                <Send className="size-3.5" aria-hidden="true" />
                {busy ? "Sending…" : "Send Message"}
              </Button>
            </div>
            <StatusLine status={status} />
          </div>
        </div>
      )}

      {outstandingCount !== null && (
        <ReminderRow fixtureId={fixtureId} outstandingCount={outstandingCount} hasComposer={audiences.length > 0} />
      )}
    </section>
  )
}

/**
 * The nudge.
 *
 * Separate from the composer because it says something different: it asks the
 * people who have not answered to answer, and it cannot say anything else. The
 * copy is explicit that it does not change anybody's response, because a coach
 * pressing a button called "reminder" should never wonder whether it marked
 * anyone as attending.
 */
function ReminderRow({
  fixtureId,
  outstandingCount,
  hasComposer,
}: {
  fixtureId: string
  outstandingCount: number
  hasComposer: boolean
}) {
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
    <div className={cn("bg-chalk px-5 py-4", hasComposer && "border-t border-ink/8")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <BellRing className="mt-0.5 size-4 shrink-0 text-forest-800" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-ink">Attendance reminder</p>
            <p className="mt-0.5 text-sm text-ink-muted">
              {outstandingCount === 0
                ? "Everyone has responded."
                : `${outstandingCount} ${outstandingCount === 1 ? "player is" : "players are"} yet to respond. A reminder asks them to answer — it doesn't change anyone's answer.`}
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
            <Button type="button" variant="outline" className="h-11 shrink-0" onClick={() => setConfirming(true)}>
              Send Reminder
            </Button>
          ))}
      </div>

      {/* A deliberate confirmation: this reaches families, and the count is
          the thing worth reading before it does. */}
      {confirming && (
        <p className="mt-2.5 text-sm text-ink">
          Send an attendance reminder for {outstandingCount} {outstandingCount === 1 ? "player" : "players"}?
        </p>
      )}
      <StatusLine status={status} />
    </div>
  )
}

/**
 * Outcomes are announced, not just coloured. aria-live carries them to a
 * screen reader, and the icon plus wording carries them to somebody who cannot
 * distinguish the colours.
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
      className={cn("mt-2.5 flex items-center gap-1.5 text-sm", status.kind === "sent" ? "text-forest-800" : "text-destructive-text")}
    >
      {status.kind === "sent" && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
      {status.message}
    </p>
  )
}
