"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { getClubActiveTeams, updateFixtureOwningTeam, type OwningTeamOption } from "../actions"

/**
 * Change Home Team / Change Away Team for the OWNING side (Reconciliation
 * complaint 7) -- distinct from the opponent-side editor (opponent's own
 * "Change" link, via update_fixture_opposition) and from "Swap home/away"
 * (which flips which resolved side is Home, via swap_fixture_home_away).
 * This corrects which of the CLUB'S OWN real, active teams this fixture
 * belongs to -- e.g. it was created under the wrong age group -- never a
 * Team Directory identity, and never a different club.
 */
export function OwningTeamEditor({
  fixtureId,
  clubId,
  currentTeamId,
  currentTeamName,
  sideLabel,
}: {
  fixtureId: string
  clubId: string
  currentTeamId: string
  currentTeamName: string
  /** "Home" or "Away" -- whichever this owning side currently is, purely for copy. */
  sideLabel: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<OwningTeamOption[]>([])
  const [selected, setSelected] = useState(currentTeamId)
  const [loading, setLoading] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (selected === currentTeamId) {
      setOpen(false)
      return
    }
    setWorking(true)
    setError(null)
    const result = await updateFixtureOwningTeam(fixtureId, selected)
    setWorking(false)
    if (result.ok) {
      setOpen(false)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setError(null)
        if (next) {
          setSelected(currentTeamId)
          setLoading(true)
          getClubActiveTeams(clubId).then((opts) => {
            setOptions(opts)
            setLoading(false)
          })
        }
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-ink/45 outline-none hover:text-forest-800 focus-visible:ring-2 focus-visible:ring-pitch-400"
          />
        }
      >
        <Pencil className="size-3" />
        Change
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change {sideLabel.toLowerCase()} team</DialogTitle>
          <DialogDescription>
            Correct which of this club&apos;s own active teams this fixture belongs to. Currently{" "}
            <span className="font-medium text-ink">{currentTeamName}</span>. Only real, active teams at the same club
            are offered &mdash; reassigning to a different club isn&apos;t a supported edit.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-ink/45">Loading this club&apos;s teams&hellip;</p>
        ) : (
          <select
            aria-label={`${sideLabel} team`}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" className="h-9" />}>Cancel</DialogClose>
          <Button type="button" className="h-9" disabled={working || loading} onClick={handleConfirm}>
            {working ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
