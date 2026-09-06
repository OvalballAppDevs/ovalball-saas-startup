"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import Link from "next/link"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { inviteClubToOvalball } from "./actions"

/**
 * ONE invite dialog, opened either from the map/list card's "Invite"
 * button (club pre-selected) or -- in a future pass -- a general
 * "Invite a Partner Club" entry point on the page itself. Never a second,
 * map-specific implementation: both entry points render this exact
 * component with different `open`/`onOpenChange` wiring from their parent.
 */
export function InviteClubDialog({
  open,
  onOpenChange,
  clubDirectoryId,
  clubName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  clubDirectoryId: string
  clubName: string
}) {
  const [contactName, setContactName] = useState("")
  const [contactEmail, setContactEmail] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentLink, setSentLink] = useState<string | null>(null)

  function reset() {
    setContactName("")
    setContactEmail("")
    setError(null)
    setSentLink(null)
  }

  async function handleInvite() {
    if (!contactName.trim() || !contactEmail.trim()) {
      setError("A contact name and email are both required.")
      return
    }
    setSending(true)
    setError(null)
    const result = await inviteClubToOvalball(clubDirectoryId, contactName.trim(), contactEmail.trim())
    setSending(false)
    if (result.ok) {
      setSentLink(result.inviteLink)
    } else {
      setError(result.error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refer {clubName} &mdash; get one month free</DialogTitle>
          <DialogDescription>
            {clubName} isn&apos;t on Ovalball yet. We&apos;ll email an invitation to join &mdash; they&apos;ll go through the normal
            sign-up and club-claim process, never an automatic account.
          </DialogDescription>
        </DialogHeader>

        {/* The offer, stated exactly as the engine behaves. "Successfully
            collected" is load-bearing: a sign-up, a trial, a mandate or a
            submitted payment all earn nothing. This is the same invitation
            it always was -- the referral is claimed on it automatically, so
            there is no second form and no second flow. */}
        {!sentLink && (
          <div className="rounded-lg bg-mint-100 px-4 py-3.5">
            <p className="text-sm leading-relaxed text-forest-950">
              If they start a paid Ovalball subscription and their first payment is successfully
              collected, your club gets one month of its current plan free.
            </p>
            <Link
              href="/legal/referral-terms"
              className="mt-1.5 inline-block text-xs font-medium text-forest-800 underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              Referral terms apply
            </Link>
          </div>
        )}

        {sentLink ? (
          <div className="flex flex-col gap-3">
            <p className="rounded-lg border border-pitch-600/30 bg-pitch-600/5 px-4 py-3 text-sm text-forest-800">
              Invitation sent to {contactEmail}. It counts as your referral &mdash; you&apos;ll see it
              under Ovalball Plan.
            </p>
            <div>
              <Label className="text-ink/80">Invite link</Label>
              <p className="mt-1.5 break-all rounded-lg border border-ink/15 bg-ink/[0.02] px-3.5 py-2.5 text-xs text-ink/70">{sentLink}</p>
              <p className="mt-1.5 text-xs text-ink/40">
                No email provider is connected in local development &mdash; use this link directly to test the flow.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <Label htmlFor="invite-contact-name" className="text-ink/80">
                Contact name
              </Label>
              <Input id="invite-contact-name" value={contactName} onChange={(e) => setContactName(e.target.value)} className="mt-1.5 h-10 border-ink/15 bg-white" />
            </div>
            <div>
              <Label htmlFor="invite-contact-email" className="text-ink/80">
                Email address
              </Label>
              <Input
                id="invite-contact-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="mt-1.5 h-10 border-ink/15 bg-white"
              />
            </div>
            {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" className="h-10" />}>{sentLink ? "Close" : "Cancel"}</DialogClose>
          {!sentLink && (
            <Button type="button" className="h-10" disabled={sending} onClick={handleInvite}>
              {sending ? "Sending…" : "Send invitation"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
