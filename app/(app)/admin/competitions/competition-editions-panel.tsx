"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"

import { createCompetitionEdition, deactivateCompetitionEdition } from "./actions"
import type { EditionRow, SeasonOption } from "./page"

/**
 * Reconciliation complaints 12/13: creating a competition alone (Add
 * competition, above) never made it selectable anywhere -- competitions
 * and competition_editions are genuinely different things (one enduring
 * concept vs. one season's run of it), and there was previously no UI at
 * all for the second. This panel is that missing piece: per competition,
 * which seasons it has an edition in, and a way to add one -- the exact
 * moment a competition becomes real for a club's fixture form.
 */
export function CompetitionEditionsPanel({
  competitionId,
  competitionRugbyCode,
  editions,
  seasons,
  canManage,
}: {
  competitionId: string
  competitionRugbyCode: string
  editions: EditionRow[]
  seasons: SeasonOption[]
  canManage: boolean
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [selectedSeasonId, setSelectedSeasonId] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const eligibleSeasons = seasons.filter((s) => s.rugbyCode === competitionRugbyCode && !editions.some((e) => e.seasonId === s.id && e.active))
  const activeEditions = editions.filter((e) => e.active)
  const deactivatedEditions = editions.filter((e) => !e.active)

  async function handleAdd() {
    if (!selectedSeasonId) return
    setSaving(true)
    setError(null)
    const result = await createCompetitionEdition(competitionId, selectedSeasonId)
    setSaving(false)
    if (result.ok) {
      setAdding(false)
      setSelectedSeasonId("")
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  async function handleRemove(editionId: string) {
    setSaving(true)
    setError(null)
    const result = await deactivateCompetitionEdition(editionId)
    setSaving(false)
    if (!result.ok) setError(result.error)
    else router.refresh()
  }

  return (
    <div className="mt-2.5 border-t border-ink/6 pt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-medium tracking-[0.04em] text-ink/40 uppercase">Editions</span>
        {activeEditions.length === 0 && deactivatedEditions.length === 0 && (
          <span className="text-xs text-amber-700">None yet &mdash; not selectable for any fixture until it has a season edition</span>
        )}
        {activeEditions.map((e) => (
          <span key={e.id} className="flex items-center gap-1 rounded-full border border-pitch-600/25 bg-pitch-600/5 py-0.5 pr-1 pl-2.5 text-xs font-medium text-forest-900">
            {e.seasonName}
            {canManage && (
              <button
                type="button"
                disabled={saving}
                onClick={() => handleRemove(e.id)}
                className="ml-0.5 rounded-full px-1 text-ink/40 outline-none hover:bg-ink/10 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
                aria-label={`Remove ${e.seasonName} edition`}
              >
                &times;
              </button>
            )}
          </span>
        ))}
        {deactivatedEditions.map((e) => (
          <span key={e.id} className="rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-0.5 text-xs text-ink/35 line-through">
            {e.seasonName}
          </span>
        ))}
      </div>

      {canManage && !adding && eligibleSeasons.length > 0 && (
        <button type="button" onClick={() => setAdding(true)} className="mt-1.5 text-xs font-medium text-forest-800 underline hover:text-forest-950">
          Add edition
        </button>
      )}
      {canManage && adding && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={selectedSeasonId}
            onChange={(e) => setSelectedSeasonId(e.target.value)}
            className="h-8 rounded-md border border-ink/15 bg-white px-2 text-xs text-ink outline-none focus-visible:border-pitch-600"
          >
            <option value="">Select a season&hellip;</option>
            {eligibleSeasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" className="h-8" disabled={!selectedSeasonId || saving} onClick={handleAdd}>
            {saving ? "Adding…" : "Add"}
          </Button>
          <button type="button" onClick={() => setAdding(false)} className="text-xs text-ink/45 underline hover:text-ink">
            Cancel
          </button>
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  )
}
