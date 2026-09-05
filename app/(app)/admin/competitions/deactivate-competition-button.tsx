"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { deactivateCompetition } from "./actions"

/**
 * "Deactivate", never "Delete" -- this button never removes the row. A
 * fixture that already references this competition keeps that reference
 * completely intact; the competition simply disappears from new-fixture
 * selection.
 */
export function DeactivateCompetitionButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setWorking(true)
    setError(null)
    const result = await deactivateCompetition(id)
    setWorking(false)
    if (result.ok) {
      setOpen(false)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:bg-destructive/10" />}>
        Deactivate
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate &ldquo;{name}&rdquo;?</DialogTitle>
          <DialogDescription>
            Fixtures already assigned to {name} keep that reference, completely unaffected. No club will be able to
            select {name} for a new fixture after this.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" className="h-9" />}>Cancel</DialogClose>
          <Button type="button" variant="destructive" className="h-9" disabled={working} onClick={handleConfirm}>
            {working ? "Deactivating…" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
