"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

/**
 * THE PLANNER'S UNSAVED WORK, HELD IN ONE PLACE.
 *
 * A fixture secretary moving twelve kick-offs is doing ONE piece of work, so
 * the edits live at the planner level rather than in twelve independent
 * rows. That is what makes a single "Save changes" honest: the toolbar can
 * say how many fixtures are affected because it can see all of them.
 *
 * NOTHING IS WRITTEN UNTIL SAVE. Every edit here is client-local. The row
 * shows what you typed, the server still holds what it held, and Discard is
 * therefore a real return to canonical values rather than an undo stack.
 *
 * SELECTION IS DELIBERATELY PAGE-LOCAL. The planner is paginated, so a
 * checkbox cannot honestly mean "every fixture matching this filter" -- it
 * means the rows in front of you. Anything else would let one click change
 * hundreds of fixtures a person never saw.
 */
export interface FixtureEdit {
  kickoffDate?: string
  kickoffTime?: string | null
  meetTime?: string | null
  venueId?: string | null
  competitionEditionId?: string | null
}

export type EditableField = keyof FixtureEdit

interface PlannerState {
  edits: Map<string, FixtureEdit>
  selected: Set<string>
  editCount: number
  setField: (fixtureId: string, field: EditableField, value: string | null) => void
  revertField: (fixtureId: string, field: EditableField) => void
  isDirty: (fixtureId: string, field?: EditableField) => boolean
  toggleSelected: (fixtureId: string) => void
  setAllSelected: (ids: string[], selected: boolean) => void
  clearEdits: () => void
  clearSelection: () => void
}

const PlannerContext = createContext<PlannerState | null>(null)

export function PlannerStateProvider({ children }: { children: ReactNode }) {
  const [edits, setEdits] = useState<Map<string, FixtureEdit>>(new Map())
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const setField = useCallback((fixtureId: string, field: EditableField, value: string | null) => {
    setEdits((prev) => {
      const next = new Map(prev)
      const row = { ...(next.get(fixtureId) ?? {}) }
      ;(row as Record<string, unknown>)[field] = value
      next.set(fixtureId, row)
      return next
    })
  }, [])

  const revertField = useCallback((fixtureId: string, field: EditableField) => {
    setEdits((prev) => {
      const row = prev.get(fixtureId)
      if (!row) return prev
      const next = new Map(prev)
      const copy = { ...row }
      delete copy[field]
      if (Object.keys(copy).length === 0) next.delete(fixtureId)
      else next.set(fixtureId, copy)
      return next
    })
  }, [])

  const isDirty = useCallback(
    (fixtureId: string, field?: EditableField) => {
      const row = edits.get(fixtureId)
      if (!row) return false
      return field ? field in row : true
    },
    [edits],
  )

  const toggleSelected = useCallback((fixtureId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(fixtureId)) next.delete(fixtureId)
      else next.add(fixtureId)
      return next
    })
  }, [])

  const setAllSelected = useCallback((ids: string[], isSelected: boolean) => {
    setSelected(() => (isSelected ? new Set(ids) : new Set()))
  }, [])

  const value = useMemo<PlannerState>(
    () => ({
      edits,
      selected,
      editCount: edits.size,
      setField,
      revertField,
      isDirty,
      toggleSelected,
      setAllSelected,
      clearEdits: () => setEdits(new Map()),
      clearSelection: () => setSelected(new Set()),
    }),
    [edits, selected, setField, revertField, isDirty, toggleSelected, setAllSelected],
  )

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>
}

export function usePlanner(): PlannerState {
  const ctx = useContext(PlannerContext)
  if (!ctx) throw new Error("usePlanner must be used inside PlannerStateProvider")
  return ctx
}
