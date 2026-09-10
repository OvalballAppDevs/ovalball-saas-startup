"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import { setEmailEnabled } from "./actions"

import type { EmailClassification } from "@/lib/email/catalogue"

/**
 * THE ON/OFF SWITCH -- never colour alone.
 *
 * EVERY WIRED EMAIL GETS THIS SWITCH, REGARDLESS OF CLASSIFICATION.
 *
 * Classification (Mandatory/Optional/Identity) governs whether an ordinary
 * RECIPIENT's own preference can suppress a message -- it is not, and must
 * never become, the authority check for whether Ovalball's own Full Site
 * Admin may switch the whole transactional channel off. See migration
 * 20270129000000's own header for the corrected reasoning; an earlier
 * version of this component refused to show a real switch for anything but
 * OPTIONAL_OPERATIONAL mail, which was wrong.
 *
 * The one thing that legitimately changes the control is whether the event
 * is WIRED to an actual send trigger -- an unwired event shows "Not Wired"
 * instead, because toggling a channel nothing sends through is a decision
 * that does nothing.
 *
 * Turning a WIRED email OFF gets a confirmation dialog, worded to the
 * classification's own real consequence -- identity/onboarding mail losing
 * its channel is a bigger deal than an optional update losing its. Turning
 * one back ON is immediate: re-enabling is the safe direction.
 */
export function EmailEnabledSwitch({
  eventKey,
  eventName,
  active,
  wired,
  classification,
  lockVersion,
}: {
  eventKey: string
  eventName: string
  active: boolean
  wired: boolean
  classification: EmailClassification
  lockVersion: number
}) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function apply(next: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await setEmailEnabled(eventKey, next, lockVersion)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setConfirmOpen(false)
      router.refresh()
    })
  }

  if (!wired) {
    return (
      <span
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink-muted"
        title={`Nothing in Ovalball sends ${eventName} yet, so there is no channel to switch on or off.`}
      >
        Not Wired
      </span>
    )
  }

  return (
    <>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={`${eventName}: ${active ? "On" : "Off"}`}
        disabled={pending}
        onClick={() => (active ? setConfirmOpen(true) : apply(true))}
        className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60 ${
          active
            ? "border-forest-800/30 bg-mint-100/60 text-forest-800"
            : "border-destructive/30 bg-destructive/5 text-destructive-text"
        }`}
      >
        <span
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${active ? "bg-forest-800" : "bg-destructive"}`}
          aria-hidden="true"
        >
          <span className={`inline-block size-4 transform rounded-full bg-white transition-transform ${active ? "translate-x-4" : "translate-x-1"}`} />
        </span>
        {active ? "On" : "Off"}
      </button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Turn Off {eventName} Emails?</DialogTitle>
            <DialogDescription>{consequenceCopy(classification, eventName)}</DialogDescription>
          </DialogHeader>

          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-white px-3 py-2 text-sm text-destructive-text">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" className="h-11" onClick={() => apply(false)} disabled={pending}>
              {pending ? "Turning off…" : "Turn Off Email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Worded to the classification's own real consequence -- not a refusal, a
 * warning. Every wording ends the same way: what keeps working regardless,
 * and that the template and history are kept.
 */
function consequenceCopy(classification: EmailClassification, eventName: string): string {
  const kept = "The template and its delivery history are kept -- nothing is deleted, and the underlying event this email is about still happens exactly as before."
  if (classification === "TRANSACTIONAL_IDENTITY") {
    return `This is how someone with no Ovalball account reaches one, or how a safeguarding concern reaches its intended contact when they have none -- ${eventName} recipients will simply not be reached by email until you turn it back on. ${kept}`
  }
  if (classification === "MANDATORY_OPERATIONAL") {
    return `This is normally sent for every occurrence, with no way for an individual recipient to opt out. Turning it off stops it for everyone, silently, until you turn it back on. ${kept}`
  }
  return `Ovalball will stop sending this transactional email. ${kept}`
}
