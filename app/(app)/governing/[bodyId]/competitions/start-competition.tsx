"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { createBodyCompetition } from "@/app/(app)/governing/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * CONVERGENCE STEP 15 — starting a competition for the organisation.
 *
 * ONE FIELD, because one field is all the canonical model needs: the rugby code comes from the body
 * itself (a Rugby Union county cannot run a Rugby League competition, and offering the choice would
 * invite the mistake), and the season comes from the canonical register. Format, participants, groups
 * and the draw all belong to the Competition Creator, which already does them properly — so this hands
 * straight over rather than asking the same questions again in a worse form.
 *
 * NEEDS ATTENTION IS SHOWN, NOT SWALLOWED. If no season is registered for this code, the competition is
 * created and has no edition yet, and the person is told exactly that. Ovalball never guesses a season.
 */
export function StartCompetition({
  bodyId,
  rugbyCode,
  bodyName,
  seasonName,
}: {
  bodyId: string
  rugbyCode: string
  bodyName: string
  /** The canonical current season, or null when the register has none for this code. */
  seasonName: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    setNotice(null)
    start(async () => {
      const res = await createBodyCompetition(bodyId, name.trim())
      if (!res.ok) {
        setError(res.error)
        return
      }
      if (res.needsAttention) {
        // The competition exists; what is missing is a registered season. Say so and stay put.
        setNotice(res.needsAttention)
        setName("")
        router.refresh()
        return
      }
      setName("")
      setOpen(false)
      // Straight into the Creator, at the first step that has a decision in it.
      if (res.editionId) router.push(`/fixtures/competitions/${res.editionId}/details`)
      else router.refresh()
    })
  }

  if (!open) {
    return (
      <div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" />
          Start a Competition
        </Button>
        {notice && (
          <p className="mt-2 text-sm text-amber-800" role="status">
            {notice}
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <Label htmlFor="gb-comp-name">Competition Name</Label>
      <Input
        id="gb-comp-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={rugbyCode === "league" ? "e.g. County Cup U14" : "e.g. County Junior Cup"}
        autoFocus
        required
        aria-describedby="gb-comp-help"
      />
      {/* CONVERGENCE STEP 16 -- THE INHERITED FACTS, SHOWN BUT NOT EDITABLE.
          The name is the only decision; season, code and organiser are canonical and come from the Seasons
          register, the organisation's own record and the context. Printing them is comprehension; making
          them editable would invite somebody to enter a Rugby League competition for a Rugby Union county,
          or to file a competition under a season the register does not have. */}
      <dl id="gb-comp-help" className="flex flex-col gap-1 rounded-lg bg-surface-muted px-3 py-2 text-xs">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-ink-muted">Season</dt>
          <dd className="text-ink">{seasonName ?? "No season registered yet"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-ink-muted">Code</dt>
          <dd className="text-ink">{rugbyCode === "league" ? "Rugby League" : "Rugby Union"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-ink-muted">Organiser</dt>
          <dd className="min-w-0 text-ink">{bodyName}</dd>
        </div>
      </dl>
      <p className="text-xs text-ink-muted">You choose the format and enter the teams next.</p>
      {error && (
        <p className="text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || name.trim().length === 0}>
          {pending ? "Creating…" : "Create Competition"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
