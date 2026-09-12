"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { unblockUser } from "../[kind]/[id]/participants"

export interface BlockedUser {
  userId: string
  displayName: string
}

/**
 * MANAGING THE BLOCKS YOU HAVE MADE.
 *
 * Everything on this screen is the viewer's own decision reflected back at
 * them, which is why it can name people at all: the list is built from their
 * own live block rows and can contain nobody else. It is not a directory, it
 * is a receipt.
 *
 * WHAT IT DELIBERATELY OMITS: email addresses, phone numbers, ids, club or
 * role metadata, and blocks that have already been lifted. A lifted block is
 * an audit fact, not something a person needs to manage -- keeping it here
 * would turn a short list of "who cannot contact me" into a permanent record
 * of everyone I ever fell out with.
 *
 * Removal is optimistic: the row goes as soon as the server confirms, and the
 * page revalidates behind it, so the list never shows somebody as blocked
 * after they are not.
 */
export function BlockedUsersList({ blocked }: { blocked: BlockedUser[] }) {
  const [rows, setRows] = useState(blocked)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<BlockedUser | null>(null)

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-6">
        <h2 className="font-display text-lg text-ink">You haven&rsquo;t blocked anyone</h2>
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          If someone is contacting you privately and you would rather they didn&rsquo;t, you can block them from the
          people list in any conversation you share. They aren&rsquo;t told.
        </p>
      </div>
    )
  }

  return (
    <>
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}

      <ul className="divide-y divide-ink/10 rounded-lg border border-ink/10 bg-white">
        {rows.map((person) => (
          <li key={person.userId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
            {/* The name can be long. It wraps rather than truncating, because
                a half-shown name on the one screen whose job is to identify
                people is the wrong trade. */}
            <span className="min-w-0 flex-1 basis-40 text-sm break-words text-ink">{person.displayName}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={pending === person.userId}
              // Named for a screen reader, which hears the button out of the
              // context of its row.
              aria-label={`Unblock ${person.displayName}`}
              onClick={() => setConfirming(person)}
              className="shrink-0"
            >
              {pending === person.userId ? "Unblocking…" : "Unblock"}
            </Button>
          </li>
        ))}
      </ul>

      <Dialog open={confirming !== null} onOpenChange={(next) => !next && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unblock {confirming?.displayName}?</DialogTitle>
            <DialogDescription>
              They will be able to contact you privately again, and you will be able to contact them. They are not
              told about this either way.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button
              onClick={async () => {
                const person = confirming
                if (!person) return
                setPending(person.userId)
                setError(null)
                const result = await unblockUser(person.userId)
                setPending(null)
                setConfirming(null)
                if (result.ok) setRows((current) => current.filter((r) => r.userId !== person.userId))
                else setError(result.error)
              }}
            >
              Unblock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
