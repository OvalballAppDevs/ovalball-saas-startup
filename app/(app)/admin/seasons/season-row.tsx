"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { effectivePhaseRange } from "@/lib/calendar/season-window"
import { validateSeasonDates } from "@/lib/seasons/validation"

import { deleteSeason, editSeason, setSeasonActive } from "./actions"

export interface SeasonRowData {
  id: string
  name: string
  seasonRef: string
  rugbyCode: "union" | "league" | null
  seasonYearStart: number
  startsOn: string
  endsOn: string
  preSeasonStartsOn: string | null
  active: boolean
  isRegressionFixture: boolean
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/**
 * One unified, dirty-tracked Save/Discard for the date fields (matching
 * this project's standing edit-UI convention), plus separate
 * Archive/Delete actions -- those are distinct operations, not part of
 * "saving a field", so they stay their own buttons with their own
 * confirmation, never folded into the same dirty-state Save.
 */
export function SeasonRow({ season }: { season: SeasonRowData }) {
  const [editing, setEditing] = useState(false)
  const [startsOn, setStartsOn] = useState(season.startsOn)
  const [endsOn, setEndsOn] = useState(season.endsOn)
  const [preSeasonStartsOn, setPreSeasonStartsOn] = useState(season.preSeasonStartsOn ?? "")
  const [saving, setSaving] = useState(false)
  const [busyAction, setBusyAction] = useState<"archive" | "delete" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const dirty = startsOn !== season.startsOn || endsOn !== season.endsOn || (preSeasonStartsOn || "") !== (season.preSeasonStartsOn ?? "")

  const clientError = useMemo(() => {
    if (!season.rugbyCode || !startsOn || !endsOn) return null
    return validateSeasonDates({
      rugbyCode: season.rugbyCode,
      seasonYearStart: season.seasonYearStart,
      preSeasonStartsOn: preSeasonStartsOn || null,
      startsOn,
      endsOn,
    })
  }, [season.rugbyCode, season.seasonYearStart, preSeasonStartsOn, startsOn, endsOn])

  function discard() {
    setStartsOn(season.startsOn)
    setEndsOn(season.endsOn)
    setPreSeasonStartsOn(season.preSeasonStartsOn ?? "")
    setError(null)
    setEditing(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const result = await editSeason({
      id: season.id,
      rugbyCode: season.rugbyCode ?? "union",
      seasonYearStart: season.seasonYearStart,
      startsOn,
      endsOn,
      preSeasonStartsOn: preSeasonStartsOn || null,
    })
    setSaving(false)
    if (result.ok) setEditing(false)
    else setError(result.error)
  }

  async function handleArchiveToggle() {
    setBusyAction("archive")
    setError(null)
    const result = await setSeasonActive(season.id, !season.active)
    setBusyAction(null)
    if (!result.ok) setError(result.error)
  }

  async function handleDelete() {
    setBusyAction("delete")
    setError(null)
    const result = await deleteSeason(season.id)
    setBusyAction(null)
    if (!result.ok) setError(result.error)
    setConfirmingDelete(false)
  }

  return (
    <tr className={`border-b border-ink/5 last:border-0 ${season.isRegressionFixture ? "bg-ink/[0.02]" : ""} ${!season.active ? "opacity-60" : ""}`}>
      <td className="px-4 py-3 align-top font-medium text-ink">
        {season.name}
        {season.isRegressionFixture && (
          <span className="ml-2 rounded border border-ink/15 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ink/45 uppercase">Regression only</span>
        )}
        {!season.active && <span className="ml-2 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-amber-900 uppercase">Archived</span>}
        {error && <p className="mt-1 max-w-xs text-xs font-normal text-destructive">{error}</p>}
      </td>
      <td className="px-4 py-3 align-top font-medium text-ink/70">{season.seasonRef}</td>
      <td className="px-4 py-3 align-top text-ink/70 capitalize">{season.rugbyCode ?? "—"}</td>
      {editing ? (
        <td colSpan={2} className="px-4 py-3 align-top">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-medium text-ink/60">Pre-season starts</label>
              <Input type="date" value={preSeasonStartsOn} onChange={(e) => setPreSeasonStartsOn(e.target.value)} className="mt-1 h-9 border-ink/15 bg-white text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink/60">Main starts</label>
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className="mt-1 h-9 border-ink/15 bg-white text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink/60">Main ends</label>
              <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="mt-1 h-9 border-ink/15 bg-white text-sm" />
            </div>
          </div>
          {clientError && <p className="mt-2 text-xs text-destructive">{clientError}</p>}
        </td>
      ) : (
        <>
          <td className="px-4 py-3 align-top text-ink/70">
            {(() => {
              const range = effectivePhaseRange(season, "pre")
              return range ? `${fmt(range.start)} – ${fmt(range.end)}` : "—"
            })()}
          </td>
          <td className="px-4 py-3 align-top text-ink/70">
            {fmt(season.startsOn)} – {fmt(season.endsOn)}
          </td>
        </>
      )}
      <td className="px-4 py-3 align-top">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {editing ? (
            <>
              <Button type="button" variant="ghost" size="sm" className="h-8 text-ink/60" onClick={discard} disabled={saving}>
                Discard
              </Button>
              <Button type="button" size="sm" className="h-8" onClick={handleSave} disabled={saving || !dirty || Boolean(clientError)}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={handleArchiveToggle} disabled={busyAction !== null}>
                {busyAction === "archive" ? "…" : season.active ? "Archive" : "Reactivate"}
              </Button>
              {confirmingDelete ? (
                <>
                  <span className="text-xs text-ink/50">Delete permanently?</span>
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-ink/60" onClick={() => setConfirmingDelete(false)}>
                    Cancel
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:bg-destructive/10" onClick={handleDelete} disabled={busyAction !== null}>
                    {busyAction === "delete" ? "Deleting…" : "Confirm delete"}
                  </Button>
                </>
              ) : (
                <Button type="button" variant="ghost" size="sm" className="h-8 text-destructive hover:bg-destructive/10" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </Button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  )
}
