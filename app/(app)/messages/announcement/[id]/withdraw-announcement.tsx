"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { withdrawAnnouncement } from "./actions"

/**
 * WITHDRAWING IS CONFIRMED, AND THE CONFIRMATION TELLS THE TRUTH.
 *
 * The tempting copy is "this will delete the announcement". It would be
 * wrong, and wrong in the direction that matters: withdrawal hides the
 * content from readers and keeps the record, the deliveries and the original
 * words, because "we sent this and then took it back" is precisely what an
 * investigation needs to see. Somebody withdrawing a message in a hurry
 * deserves to know that before they press it, not afterwards.
 *
 * It also cannot be undone, which is the other thing the dialog has to say.
 */
export function WithdrawAnnouncement({ announcementId }: { announcementId: string }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-chalk/85 hover:bg-white/12 hover:text-chalk focus-visible:ring-pitch-400"
          >
            Withdraw
          </Button>
        }
      />

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Withdraw This Announcement</DialogTitle>
          <DialogDescription>
            Everyone who received this will see that it was withdrawn instead of what it said. It stays in their
            Messenger, and the original wording is kept on record for moderation. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => {
              setError(null)
              startTransition(async () => {
                const result = await withdrawAnnouncement(announcementId)
                if (result.ok) setOpen(false)
                else setError(result.error)
              })
            }}
          >
            {pending ? "Withdrawing…" : "Withdraw Announcement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
