"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

import { startClubConversation } from "../messages/club-actions"

/**
 * CLUBHOUSE PROGRAMME SECTION 10: "Message This Club" from the map/list card, going straight to
 * `start_or_get_club_conversation` with the club already selected -- never a second search for a club
 * the viewer is already looking at. `/messages/new`'s own club search (`club-search.ts`) is unchanged
 * and remains the right entry point for "I don't yet know which club" -- this dialog is the other one:
 * "I'm looking at this club's card right now."
 *
 * myClubId is the caller's own `activeManageableClubId` -- the same value Section 5's
 * `canManagePartnerships` is derived from. It is not necessarily exactly the capability
 * start_or_get_club_conversation itself checks (`can_manage_club_fixtures`), so the RPC's own refusal
 * is the real authority, exactly like every other button in this card -- offering a control that might
 * be refused is still better than a second, guessed capability check duplicated client-side.
 */
export function MessageClubDialog({
  open,
  onOpenChange,
  myClubId,
  targetClubId,
  clubName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  myClubId: string
  targetClubId: string
  clubName: string
}) {
  const router = useRouter()
  const [message, setMessage] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setMessage("")
    setError(null)
  }

  async function handleSend() {
    if (!message.trim()) {
      setError("Write a first message.")
      return
    }
    setSending(true)
    setError(null)
    const result = await startClubConversation(myClubId, targetClubId, message.trim())
    setSending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onOpenChange(false)
    reset()
    router.push(`/messages/club/${result.conversationId}`)
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
          <DialogTitle>Message {clubName}</DialogTitle>
          <DialogDescription>
            {clubName} decides whether to open this conversation. Until they accept, only your first message is with
            them.
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="message-club-first-message" className="text-ink/80">
            First Message
          </Label>
          <textarea
            id="message-club-first-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Write your message…"
            className="mt-1.5 w-full resize-none rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
        </div>
        {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-text">{error}</p>}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" className="h-10" />}>Cancel</DialogClose>
          <Button type="button" className="h-10" disabled={sending} onClick={handleSend}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
