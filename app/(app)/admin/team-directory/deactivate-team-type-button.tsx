"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { deactivateTeamType, getTeamTypeImpact, type TeamTypeImpact } from "./actions"

/**
 * "Deactivate", never "Delete" -- this button never removes the row. See
 * deactivate_canonical_team_type's own comment for the full lifecycle
 * guarantee (existing club-team history stays intact; new activation is
 * blocked at the database level, not just here). Shows a real impact
 * preview (Overnight Master Pass Section 49) fetched fresh when the
 * dialog opens -- never a generic reassurance sentence.
 */
export function DeactivateTeamTypeButton({ id, label }: { id: string; label: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [impact, setImpact] = useState<TeamTypeImpact | null>(null)
  const loadingImpact = open && !impact && !error

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getTeamTypeImpact(id).then((result) => {
      if (cancelled) return
      if (result.ok) setImpact(result.impact)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [open, id])

  async function handleConfirm() {
    setWorking(true)
    setError(null)
    const result = await deactivateTeamType(id)
    setWorking(false)
    if (result.ok) {
      setOpen(false)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setImpact(null)
      setError(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:bg-destructive/10" />}>
        Deactivate
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate &ldquo;{label}&rdquo;?</DialogTitle>
          <DialogDescription>
            Any club already running a {label} team keeps it, completely unaffected &mdash; its history, fixtures,
            and roster are untouched. No club will be able to newly add {label} from Add Team or signup after this.
          </DialogDescription>
        </DialogHeader>

        {loadingImpact && <p className="text-sm text-ink/50">Checking real impact…</p>}
        {impact && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3.5">
            <p className="text-sm font-medium text-amber-900">Real impact today</p>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-amber-900">
              <li>{impact.clubsAffected} club(s) currently running it</li>
              <li>{impact.activeTeams} active team(s)</li>
              <li>{impact.players} player(s)</li>
              <li>{impact.guardians} guardian(s)</li>
              <li>{impact.futureFixtures} upcoming fixture(s)</li>
              <li>{impact.historicalFixtures} past fixture(s)</li>
            </ul>
            {impact.activeTeams > 0 && (
              <p className="mt-2 text-xs text-amber-800">
                These teams keep operating today, but cannot be created again for another club once this type is deactivated.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" className="h-9" />}>Cancel</DialogClose>
          <Button type="button" variant="destructive" className="h-9" disabled={working || loadingImpact} onClick={handleConfirm}>
            {working ? "Deactivating…" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
