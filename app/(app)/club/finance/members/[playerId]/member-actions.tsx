"use client"

import { useId, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CHANGE_PAYER_STEPS } from "@ovalball/contracts/membership/member"

import { OutcomeNotice, RemindButton, useOutcome, type Said } from "@/components/membership/membership-remind"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import { changeWhoPaysAction, remindMembers, retryFailedPayment } from "../../actions"

/**
 * WHAT THE CLUB CAN DO ABOUT ONE MEMBER (Club Memberships Part 2): the status card's one action, Retry Payment for a
 * failed month and Change Who Pays. Each is the existing server operation, which decides again whether this person may
 * and refuses with a sentence the page shows as it is.
 */

const QUIET_LINK =
  "inline-flex min-h-11 items-center rounded-md text-sm font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-9"

/** Takes the person to the page's own Cancel Membership button, wherever the page has laid it out. */
function focusCancelMembership() {
  const button = document.querySelector<HTMLButtonElement>("#cancel-membership button")
  button?.scrollIntoView({ block: "center" })
  button?.focus()
}

export function MemberStatusActions({
  clubId,
  playerId,
  playerName,
  remind,
  askable,
  retry,
  changePayer,
  endOrPlace,
}: {
  clubId: string
  playerId: string
  playerName: string
  /** Send Reminder: the guidance's action, the reader may remind, and the server says the payer can be asked now. */
  remind: boolean
  /** Who the reminder goes to, in a sentence (askableSentence). */
  askable: string | null
  retry: { paymentId: string; monthLabel: string } | null
  changePayer: ChangePayerTarget | null
  /** Still enrolled after leaving every team: cancel the membership (if the reader may) or place them in a team. */
  endOrPlace: { canCancel: boolean } | null
}) {
  const { said, done } = useOutcome()
  const [retrying, startRetry] = useTransition()
  // Once the reminder has gone, the refreshed page no longer offers it: the button stays where it was, as "Reminder
  // Sent", with the server's sentence beneath it, rather than vanishing from under the person's focus.
  const [reminded, setReminded] = useState(false)
  // The same for Retry: the month it retried, kept so the button stays put as "Payment Retried".
  const [retried, setRetried] = useState<{ paymentId: string; monthLabel: string } | null>(null)
  const retryShown = retry ?? retried
  // And for Change Payer: once released the membership is not set up, so the refreshed page no longer offers it.
  const [payerChanged, setPayerChanged] = useState<ChangePayerTarget | null>(null)
  const payerShown = changePayer ?? payerChanged

  if (!remind && !reminded && !retryShown && !payerShown && !endOrPlace && !said) return null
  return (
    <div className="mt-4 border-t border-ink/10 pt-4">
      <div className="flex flex-wrap items-center gap-3">
        {(remind || reminded) && (
          <RemindButton
            primary
            label="Send Reminder"
            held={reminded}
            action={(): Promise<Said> => remindMembers(clubId, [playerId])}
            onDone={(next) => {
              if (next.tone === "ok" && (next.sent ?? 0) > 0) setReminded(true)
              done(next)
            }}
          />
        )}
        {retryShown && (
          <Button
            type="button"
            className="h-11 px-4 font-semibold aria-disabled:pointer-events-none aria-disabled:opacity-60 sm:h-9"
            variant={remind ? "outline" : "default"}
            focusableWhenDisabled
            disabled={retrying || retried !== null}
            aria-busy={retrying}
            onClick={() =>
              startRetry(async () => {
                const result = await retryFailedPayment(clubId, retryShown.paymentId)
                if (result.ok) setRetried(retryShown)
                done(result.ok ? { tone: "ok", text: `${retryShown.monthLabel}'s payment will be tried again.` } : { tone: "error", text: result.error })
              })
            }
          >
            {retrying ? "Retrying…" : retried ? "Payment Retried" : "Retry Payment"}
          </Button>
        )}
        {payerShown && (
          <ChangePayerButton
            {...payerShown}
            playerName={playerName}
            primary={!remind && !retryShown}
            changed={payerChanged !== null}
            onChanged={(next) => {
              setPayerChanged(payerShown)
              done(next)
            }}
          />
        )}
        {endOrPlace?.canCancel && (
          // Not a second Cancel Membership: it takes the person to the page's one, which asks for a reason first.
          <button type="button" onClick={focusCancelMembership} className={QUIET_LINK}>
            Go to Cancel Membership
          </button>
        )}
        {endOrPlace && (
          <Link href="/teams" className={QUIET_LINK}>
            Place in a Team
          </Link>
        )}
      </div>
      {remind && !reminded && askable && <p className="mt-2 max-w-prose text-xs text-ink-muted">{askable}</p>}
      <OutcomeNotice said={said} className="mt-3" />
    </div>
  )
}

/**
 * CHANGE WHO PAYS (decision #11): the current payer's set-up ends first, so two Direct Debits can never collect for
 * one player; then a guardian sets it up with their own. The steps are shown before anything happens, a reason is
 * required, and the server's refusal is shown with its way forward.
 */
export type ChangePayerTarget = { payerSubscriptionId: string; payerName: string | null; canCancel: boolean }

export function ChangePayerButton({
  payerSubscriptionId,
  payerName,
  playerName,
  canCancel,
  primary = false,
  changed = false,
  onChanged,
}: ChangePayerTarget & {
  playerName: string
  primary?: boolean
  /** Done: the same button stays in place, unavailable, as "Payer Changed". */
  changed?: boolean
  onChanged: (said: Said) => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<{ text: string; collecting: boolean } | null>(null)
  const reasonId = useId()
  const missing = reason.trim().length === 0

  function openDialog() {
    setReason("")
    setTried(false)
    setProblem(null)
    setOpen(true)
  }

  async function submit() {
    setTried(true)
    if (missing || busy) return
    setBusy(true)
    setProblem(null)
    const result = await changeWhoPaysAction(payerSubscriptionId, reason)
    setBusy(false)
    if (!result.ok) return setProblem({ text: result.error, collecting: result.collecting })
    setOpen(false)
    onChanged({
      tone: "ok",
      text: `${payerName ?? "The payer"} no longer pays for ${playerName}'s membership, and it now shows as not set up. Send a reminder so a guardian can set it up.`,
    })
  }

  return (
    <>
      <Button
        type="button"
        variant={primary ? "default" : "outline"}
        className={`h-11 px-4 aria-disabled:pointer-events-none aria-disabled:opacity-60 sm:h-9 ${primary ? "font-semibold" : ""}`}
        focusableWhenDisabled
        disabled={changed}
        onClick={openDialog}
      >
        {changed ? "Payer Changed" : "Change Payer"}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && !busy && setOpen(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Change Who Pays</DialogTitle>
            <DialogDescription>{`${payerName ?? "The current payer"} pays for ${playerName}'s membership now. This is what happens next:`}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink marker:text-ink-muted">
              {CHANGE_PAYER_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="space-y-1.5">
              <label htmlFor={reasonId} className="text-sm font-medium text-ink">
                Reason <span aria-hidden="true" className="text-destructive-text">*</span>
              </label>
              <textarea
                id={reasonId}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                required
                aria-required="true"
                aria-invalid={tried && missing}
                aria-describedby={`${reasonId}-hint`}
                placeholder="Recorded with the change, e.g. the parents have agreed the other parent pays"
                className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-forest-800 focus-visible:ring-2 focus-visible:ring-forest-800/25 aria-invalid:border-destructive"
              />
              <p id={`${reasonId}-hint`} role={tried && missing ? "alert" : undefined} className={`text-xs ${tried && missing ? "text-destructive-text" : "text-ink-muted"}`}>
                {tried && missing ? "Say why the payer is changing." : "Kept with the membership's history. The current payer is told their set-up has ended."}
              </p>
            </div>
            {problem && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive-text">
                <p>{problem.text}</p>
                {problem.collecting &&
                  (canCancel ? (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        // After the dialog has gone, so the page's button can take focus.
                        window.setTimeout(focusCancelMembership, 0)
                      }}
                      className="mt-1.5 inline-flex min-h-11 items-center font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-8"
                    >
                      Go to Cancel Membership
                    </button>
                  ) : (
                    <p className="mt-1.5">Cancelling a membership needs the payments permission at this club.</p>
                  ))}
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={busy} onClick={() => setOpen(false)}>
                Keep the Current Payer
              </Button>
              <Button type="submit" className="h-11 px-4 font-semibold sm:h-9" disabled={busy} aria-busy={busy}>
                {busy ? "Changing…" : "Change Who Pays"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * The Responsible Payer panel's Change Payer. Always in the page (the server page renders it whether or not there is
 * a payer to change), so once the payer is released the button stays in place as "Payer Changed" and what happened
 * is still said, though the refreshed page has nobody left to change.
 */
export function PayerActions({ changePayer, playerName }: { changePayer: ChangePayerTarget | null; playerName: string }) {
  const { said, done } = useOutcome()
  const [changed, setChanged] = useState<ChangePayerTarget | null>(null)
  const shown = changePayer ?? changed
  if (!shown && !said) return null
  return (
    <div className="mt-3 space-y-3">
      {shown && (
        <ChangePayerButton
          {...shown}
          playerName={playerName}
          changed={changed !== null}
          onChanged={(next) => {
            setChanged(shown)
            done(next)
          }}
        />
      )}
      <OutcomeNotice said={said} />
    </div>
  )
}

/**
 * Retry for one failed month in the payments list, saying what happened beside it. Mounted for every month that has a
 * payment, offered only while that payment has failed (`available`); after a retry the refreshed month is no longer
 * failed, and the button stays in place as "Retried" with what happened beneath it.
 */
export function RetryPaymentButton({ clubId, paymentId, monthLabel, available }: { clubId: string; paymentId: string; monthLabel: string; available: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [said, setSaid] = useState<Said | null>(null)
  const retried = said?.tone === "ok"
  if (!available && !said) return null
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        aria-disabled={pending || retried || !available || undefined}
        aria-busy={pending}
        aria-label={retried ? `${monthLabel}'s payment retried` : `Retry ${monthLabel}'s payment`}
        onClick={() => {
          if (pending || retried || !available) return
          start(async () => {
            const result = await retryFailedPayment(clubId, paymentId)
            setSaid(result.ok ? { tone: "ok", text: "Being tried again." } : { tone: "error", text: result.error })
            if (result.ok) router.refresh()
          })
        }}
        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-ink/15 bg-white px-3 text-xs font-medium text-forest-800 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-forest-800 aria-disabled:cursor-default aria-disabled:opacity-60 sm:min-h-8"
      >
        {pending ? "Retrying…" : retried ? "Retried" : "Retry"}
      </button>
      <span role="status" aria-live="polite" className={`text-xs ${said?.tone === "error" ? "text-destructive-text" : "text-ink-muted"}`}>
        {said?.text ?? ""}
      </span>
    </span>
  )
}
