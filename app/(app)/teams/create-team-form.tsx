"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import type { TeamCategoryGroup, TeamOptionAvailability } from "@/lib/teams/catalog"

import { createTeam } from "./actions"
import { TeamCategoryPicker } from "./team-category-picker"

export function CreateTeamForm({
  clubId,
  groups,
  availability,
  rugbyCode,
}: {
  clubId: string
  groups: TeamCategoryGroup[]
  availability: TeamOptionAvailability[]
  rugbyCode?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [categoryLabel, setCategoryLabel] = useState<string | null>(null)
  const [squadLetter, setSquadLetter] = useState<string | null>(null)
  const [alias, setAlias] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <Button type="button" className="h-10" onClick={() => setOpen(true)}>
        Add a team
      </Button>
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!categoryLabel) {
      setError("Pick a team from the list.")
      return
    }
    setStatus("saving")
    setError(null)
    const result = await createTeam({ clubId, categoryLabel, squadLetter, alias })
    if (result.ok) {
      setCategoryLabel(null)
      setSquadLetter(null)
      setAlias("")
      setOpen(false)
      setStatus("idle")
      router.refresh()
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm font-medium text-ink">Add a team</p>
      <p className="mt-1 text-sm text-ink-muted">
        Pick from the same team list your club confirmed when it joined Ovalball &mdash; there&apos;s no free-text
        name to type or get out of sync.
      </p>

      <div className="mt-4">
        <TeamCategoryPicker
          groups={groups}
          categoryLabel={categoryLabel}
          squadLetter={squadLetter}
          availability={availability}
          rugbyCode={rugbyCode}
          onChange={(label, letter) => {
            setCategoryLabel(label)
            setSquadLetter(letter)
            if (!letter) setAlias("")
          }}
        />
      </div>

      {squadLetter && (
        <div className="mt-4">
          <label htmlFor="team-alias" className="text-sm font-medium text-ink/80">
            What does your club call this squad? <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <p className="mt-1 text-sm text-ink-muted">
            Clubs often name their second and third squads rather than lettering them. A name replaces the letter
            wherever the team is shown — &ldquo;{categoryLabel} Blacks&rdquo; instead of &ldquo;{categoryLabel}{" "}
            {squadLetter}&rdquo;. You can change it later from the team&apos;s own page.
          </p>
          <input
            id="team-alias"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="e.g. Blacks"
            className="mt-2 h-10 w-full max-w-xs rounded-lg border border-ink/15 px-3 text-sm outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
          />
        </div>
      )}

      {error && <p className="mt-3 text-sm text-destructive-text">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <Button type="submit" className="h-9" disabled={status === "saving" || !categoryLabel}>
          {status === "saving" ? "Adding…" : "Add team"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9"
          onClick={() => {
            setOpen(false)
            setCategoryLabel(null)
            setSquadLetter(null)
            setError(null)
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
