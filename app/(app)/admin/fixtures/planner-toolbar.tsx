"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { usePlanner, type EditableField } from "./planner-state"
import { saveFixtureEdits, type PlannerSaveRow } from "./planner-actions"

/**
 * THE ONE PLACE THE PLANNER SAYS WHAT IS OUTSTANDING.
 *
 * It appears only when there is something to say -- unsaved work, or rows
 * selected. A bar that is always there teaches people to stop reading it.
 *
 * FAILURES ARE NAMED, NOT COUNTED. "2 need attention" with the fixtures
 * listed and the database's own sentence beside each is the difference
 * between a secretary fixing a clash in ten seconds and re-entering twelve
 * rows to find out which one broke.
 */
export function PlannerToolbar({ rowLabels }: { rowLabels: Record<string, string> }) {
  const { edits, editCount, selected, setField, clearEdits, clearSelection } = usePlanner()
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [failures, setFailures] = useState<PlannerSaveRow[]>([])
  const [saved, setSaved] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [bulkField, setBulkField] = useState<EditableField | "">("")
  const [bulkValue, setBulkValue] = useState("")

  const hasWork = editCount > 0 || selected.size > 0

  /**
   * A bulk change is not a separate write path. It stages the same edit on
   * every selected fixture, which then goes through the ordinary Save --
   * so the person sees what will change before it changes, and one refusal
   * is reported against its own fixture exactly as a typed edit would be.
   */
  function applyToSelection() {
    if (!bulkField || selected.size === 0) return
    for (const id of selected) {
      setField(id, bulkField, bulkValue === "" ? null : bulkValue)
    }
    setBulkValue("")
    setBulkField("")
  }

  // Leaving with unsaved work should cost a confirmation, not be impossible.
  useEffect(() => {
    if (editCount === 0) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [editCount])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setFailures([])
    setSaved(null)

    const changes = [...edits.entries()].map(([fixtureId, edit]) => ({ fixtureId, ...edit }))
    const result = await saveFixtureEdits(changes)
    setSaving(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setSaved(result.saved)
    setFailures(result.failed)
    // Only the fixtures that genuinely saved stop being dirty; anything the
    // server refused stays on screen, still edited, so the person can fix it.
    if (result.failed.length === 0) clearEdits()
    router.refresh()
  }

  if (!hasWork && failures.length === 0 && saved === null && !error) return null

  return (
    <div className="sticky top-2 z-20 mt-3 rounded-lg border border-ink/10 bg-white/95 px-3.5 py-2.5 shadow-[0_8px_24px_-16px_rgba(7,28,20,0.45)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {editCount > 0 && (
            <span className="font-medium text-ink">
              {editCount} unsaved {editCount === 1 ? "change" : "changes"}
            </span>
          )}
          {selected.size > 0 && (
            <span className="text-ink-muted">
              {selected.size} {selected.size === 1 ? "fixture" : "fixtures"} selected
            </span>
          )}
          {saved !== null && failures.length === 0 && editCount === 0 && (
            <span className="text-forest-800">
              Saved {saved} {saved === 1 ? "fixture" : "fixtures"}.
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 && (
            <>
              {/* Set one field across the selection, then Save as usual. */}
              <label className="sr-only" htmlFor="bulk-field">
                Field to change on selected fixtures
              </label>
              <select
                id="bulk-field"
                value={bulkField}
                onChange={(e) => setBulkField(e.target.value as EditableField | "")}
                className="h-9 rounded-lg border border-ink/15 bg-white px-2.5 text-sm text-ink/70 outline-none focus-visible:border-pitch-600"
              >
                <option value="">Change…</option>
                <option value="kickoffDate">Date</option>
                <option value="kickoffTime">Kick Off Time</option>
                <option value="meetTime">Meet Time</option>
              </select>
              {bulkField && (
                <input
                  type={bulkField === "kickoffDate" ? "date" : "time"}
                  value={bulkValue}
                  onChange={(e) => setBulkValue(e.target.value)}
                  aria-label={`New value for the selected fixtures`}
                  className="h-9 rounded-lg border border-ink/15 bg-white px-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
                />
              )}
              {bulkField && (
                <button
                  type="button"
                  onClick={applyToSelection}
                  className="min-h-9 rounded-lg border border-ink/15 bg-white px-3 text-sm font-medium text-ink outline-none hover:border-ink/30 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  Apply to {selected.size}
                </button>
              )}
            </>
          )}
          {selected.size > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              className="min-h-9 rounded-lg px-3 text-sm font-medium text-ink-muted outline-none hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              Clear Selection
            </button>
          )}
          {editCount > 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  clearEdits()
                  setFailures([])
                  setError(null)
                  setSaved(null)
                }}
                disabled={saving}
                className="min-h-9 rounded-lg px-3 text-sm font-medium text-ink-muted outline-none hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
              >
                Discard Changes
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="min-h-9 rounded-lg bg-forest-900 px-3.5 text-sm font-medium text-chalk outline-none hover:bg-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive-text">
          {error}
        </p>
      )}

      {failures.length > 0 && (
        <div className="mt-2 rounded-md bg-amber-500/10 px-3 py-2">
          <p className="text-sm font-medium text-amber-900">
            {saved} saved · {failures.length} need attention
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {failures.map((f) => (
              <li key={f.fixtureId} className="text-xs text-amber-900">
                <span className="font-medium">{rowLabels[f.fixtureId] ?? "This fixture"}</span> — {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
