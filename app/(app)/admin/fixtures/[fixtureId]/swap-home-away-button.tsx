"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { ArrowLeftRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { swapFixtureHomeAway } from "../actions"

/**
 * The deliberate operation behind Home Team editing (mega-spec section W)
 * -- never a naive two-label edit. Flips owning/opponent team_id, home_
 * away, AND home_score/away_score together as one atomic write, so a
 * completed result's orientation never goes backwards.
 */
export function SwapHomeAwayButton({ fixtureId, homeTeamName, awayTeamName, canSwap }: { fixtureId: string; homeTeamName: string; awayTeamName: string; canSwap: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canSwap) return null

  async function handleConfirm() {
    setWorking(true)
    setError(null)
    const result = await swapFixtureHomeAway(fixtureId)
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
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-ink/60" />}>
        <ArrowLeftRight className="size-3.5" />
        Swap home/away
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Swap home and away?</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-ink">{awayTeamName}</span> becomes the home side and{" "}
            <span className="font-medium text-ink">{homeTeamName}</span> becomes away. The score swaps with them, so the
            result stays correctly attributed -- this is a single, deliberate correction, not two separate label edits.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" className="h-9" />}>Cancel</DialogClose>
          <Button type="button" className="h-9" disabled={working} onClick={handleConfirm}>
            {working ? "Swapping…" : "Swap home/away"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
