"use client"

import { useEffect, useRef, useState } from "react"

import { usePlanner, type EditableField } from "./planner-state"

/**
 * ONE EDITABLE CELL.
 *
 * READ STATE STAYS READ STATE. The planner is scanned far more often than it
 * is edited, so a cell is plain text until somebody asks to change it --
 * double-click, Enter, or simply clicking the cell when it already has
 * keyboard focus. Rendering two hundred permanent form controls would make
 * the densest screen in the product the noisiest one, and would flatten the
 * difference between "this is the kick-off" and "this is a box you can type
 * a kick-off into".
 *
 * THE KEYBOARD CONTRACT IS THE ORDINARY ONE. The closed cell is a real
 * button, so Tab reaches it and Enter opens it; Escape abandons the edit and
 * restores the saved value; Tab out commits to the planner's dirty state.
 * Nothing here simulates a spreadsheet at the cost of a screen reader.
 */
export function PlannerCell({
  fixtureId,
  field,
  type,
  savedValue,
  label,
  tone = "primary",
  dateStyle = "medium",
}: {
  fixtureId: string
  field: EditableField
  type: "date" | "time"
  /** The canonical server value, and what Discard returns to. */
  savedValue: string | null
  /** Names the control for assistive technology: "Kick off time, Under 12 Boys". */
  label: string
  /**
   * "secondary" renders smaller and quieter. Used for the kick-off sitting
   * UNDER the date in one combined column: both are editable, but only one
   * of them is what the eye lands on when scanning a season.
   */
  tone?: "primary" | "secondary"
  /** "short" drops the year -- inside a match-day group it is already known. */
  dateStyle?: "medium" | "short"
}) {
  const { edits, setField, revertField, isDirty } = usePlanner()
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const pending = edits.get(fixtureId)?.[field]
  const current = (pending !== undefined ? pending : savedValue) ?? ""
  const dirty = isDirty(fixtureId, field)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commit(raw: string) {
    const next = raw === "" ? null : raw
    const saved = savedValue ?? null
    // Typing a value back to what it already was is not a change.
    if (next === saved) revertField(fixtureId, field)
    else setField(fixtureId, field, next)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type}
        aria-label={label}
        defaultValue={current}
        onBlur={(e) => {
          commit(e.target.value)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            setEditing(false)
          } else if (e.key === "Enter") {
            e.preventDefault()
            commit((e.target as HTMLInputElement).value)
            setEditing(false)
          }
        }}
        className="block w-full min-w-[6.5rem] rounded-md border border-pitch-600 bg-white px-1.5 py-0.5 text-sm text-ink outline-none"
      />
    )
  }

  const display = current ? (type === "time" ? current.slice(0, 5) : formatDate(current, dateStyle)) : "—"

  return (
    <button
      type="button"
      onDoubleClick={() => setEditing(true)}
      onClick={(e) => {
        // A single click opens the editor only when the cell already had
        // focus, so scanning with the mouse never drops you into typing.
        if (document.activeElement === e.currentTarget) setEditing(true)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          setEditing(true)
        }
      }}
      aria-label={`${label}${dirty ? " (edited, not saved)" : ""}`}
      // `block`, not the default inline-block: the Date and Kick Off cells
      // share one column stacked, and two inline-block buttons sat side by
      // side until the second one was clipped by the next column.
      className={`block w-full rounded-md px-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 ${
        tone === "secondary" ? "py-0 text-xs" : "py-0.5 text-sm"
      } ${
        dirty
          ? "bg-amber-500/12 font-medium text-amber-900 ring-1 ring-amber-500/30"
          : tone === "secondary"
            ? "text-ink-muted hover:bg-ink/[0.04]"
            : "font-medium text-ink hover:bg-ink/[0.04]"
      }`}
    >
      {display}
      {/* The dirty marker is never colour alone. */}
      {dirty && <span className="ml-1 text-[11px]">•&nbsp;edited</span>}
    </button>
  )
}

function formatDate(iso: string, style: "medium" | "short"): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return style === "short"
    ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/** Row selection. Page-local by design -- see PlannerStateProvider. */
export function PlannerRowSelect({ fixtureId, label }: { fixtureId: string; label: string }) {
  const { selected, toggleSelected } = usePlanner()
  return (
    <input
      type="checkbox"
      checked={selected.has(fixtureId)}
      onChange={() => toggleSelected(fixtureId)}
      aria-label={`Select ${label}`}
      /*
       * Drawn explicitly rather than left to `accent-*`.
       *
       * Under this project's CSS reset the native control rendered as a
       * solid dark square in BOTH states, so an untouched fixture list
       * looked like every row was already selected -- the one thing a
       * bulk-edit control must never imply. appearance-none plus an
       * explicit box makes checked and unchecked genuinely different, and
       * does not depend on how the reset happens to treat form controls.
       */
      className="size-4 shrink-0 cursor-pointer appearance-none rounded border border-ink/30 bg-white outline-none checked:border-forest-800 checked:bg-forest-800 checked:bg-[length:80%] checked:bg-center checked:bg-no-repeat checked:bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22 fill=%22none%22 stroke=%22white%22 stroke-width=%223%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%223,8.5 6.5,12 13,4.5%22/></svg>')] hover:border-ink/50 focus-visible:ring-2 focus-visible:ring-pitch-400"
    />
  )
}
