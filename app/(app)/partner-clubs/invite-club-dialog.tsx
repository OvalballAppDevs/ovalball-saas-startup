"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
          <DialogTitle>Invite {clubName} to Ovalball</DialogTitle>
          <DialogDescription>
            {clubName} isn&apos;t on Ovalball yet. We&apos;ll email an invitation to join &mdash; they&apos;ll go through the normal
            sign-up and club-claim process, never an automatic account.
          </DialogDescription>
        </DialogHeader>

        {sentLink ? (
          <div className="flex flex-col gap-3">
            <p className="rounded-lg border border-pitch-600/30 bg-pitch-600/5 px-4 py-3 text-sm text-forest-800">
              Invitation sent to {contactEmail}.
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
              {sending ? "Sending…" : "Invite to Ovalball"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
