"use client"

import { useEffect, useState } from "react"
import { Pencil, Trophy } from "lucide-react"

import { listCompetitionEditionsForRugbyCode, type CompetitionEditionOption } from "@/lib/fixtures/competitions"

import { updateFixtureCompetitionAction } from "./result-actions"

export function CompetitionInlineEdit({
  fixtureId,
  rugbyCode,
  competitionEditionId,
  competitionName,
  canEdit,
}: {
  fixtureId: string
  rugbyCode: string
  competitionEditionId: string | null
  competitionName: string | null
  canEdit: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState({ id: competitionEditionId, name: competitionName })
  const [options, setOptions] = useState<CompetitionEditionOption[]>([])
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!editing) return
    let active = true
    listCompetitionEditionsForRugbyCode(rugbyCode).then((result) => {
      if (active) setOptions(result)
    })
    return () => {
      active = false
    }
  }, [editing, rugbyCode])

  if (!canEdit) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-ink/12 bg-white px-2.5 py-1 text-xs font-medium text-ink/70">
        <Trophy className="size-3.5 text-ink/35" />
        {current.name ?? "No competition set"}
      </span>
    )
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink/12 bg-white px-2.5 py-1 text-xs font-medium text-ink/70 outline-none transition-colors hover:border-pitch-600/40 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <Trophy className="size-3.5 text-ink/35" />
        {current.name ?? "Set competition"}
        <Pencil className="size-3 text-ink/30" />
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-pitch-600/40 bg-white py-1 pr-1.5 pl-2.5">
      <select
        autoFocus
        defaultValue={current.id ?? ""}
        onChange={async (e) => {
          const value = e.target.value || null
          setPending(true)
          const result = await updateFixtureCompetitionAction(fixtureId, value)
          setPending(false)
          if (result.ok) {
            const selected = options.find((o) => o.id === value)
            setCurrent({ id: value, name: selected ? `${selected.competitionName} · ${selected.seasonName}` : null })
            setEditing(false)
          }
        }}
        disabled={pending}
        className="h-6 max-w-40 border-0 p-0 text-xs text-ink outline-none"
      >
        <option value="">None</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.competitionName} &middot; {o.seasonName}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-ink/40 hover:text-ink/70">
        Cancel
      </button>
    </span>
  )
}
