"use client"

import { Check, Pencil, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { quickEditClub, type QuickEditInput } from "./actions"

/**
 * Click-to-edit table cell for the QUICK-editable fields only (name, town,
 * county, postcode, website -- see actions.ts's QuickEditInput allowlist).
 * Deliberately requires an explicit Save/Cancel click or Enter/Escape --
 * never saves on blur -- so scrolling the table or clicking elsewhere to
 * read another row can never trigger an accidental write. Desktop/tablet
 * only (rendered inside the `md:block` table); the mobile card list links
 * straight to the full edit form instead, per the brief's own guidance
 * that inline editing doesn't need mobile parity.
 */
export function QuickEditCell({
  directoryId,
  field,
  value,
  placeholder = "—",
  type = "text",
}: {
  directoryId: string
  field: QuickEditInput["field"]
  value: string
  placeholder?: string
  type?: "text" | "url"
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Resyncs the draft when `value` changes from outside (another save,
  // router.refresh()) while this cell isn't mid-edit. Adjusted during
  // render, per React's own guidance for derived state, rather than in an
  // effect -- see club-filters.tsx's identical pattern for the same reason.
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue && !editing) {
    setPrevValue(value)
    setDraft(value)
  } else if (value !== prevValue) {
    setPrevValue(value)
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function commit() {
    if (draft === value) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    const result = await quickEditClub({ directoryId, field, value: draft })
    setSaving(false)
    if (result.ok) {
      setEditing(false)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
    setError(null)
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group/cell -mx-2 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left outline-none hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-pitch-400"
        aria-label={`Edit ${field}`}
      >
        <span className={value ? "truncate" : "truncate text-ink/35"}>{value || placeholder}</span>
        <Pencil className="size-3 shrink-0 text-ink/0 group-hover/cell:text-ink/30" />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type={type}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") cancel()
        }}
        className="h-8 w-full min-w-0 rounded-md border border-pitch-600 bg-white px-2 text-sm text-ink outline-none"
      />
      <button
        type="button"
        onClick={commit}
        disabled={saving}
        aria-label="Save"
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-forest-800 outline-none hover:bg-mint-100 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <Check className="size-4" />
      </button>
      <button
        type="button"
        onClick={cancel}
        disabled={saving}
        aria-label="Cancel"
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink/50 outline-none hover:bg-ink/8 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <X className="size-4" />
      </button>
      {error && <span className="absolute mt-9 text-xs text-destructive">{error}</span>}
    </div>
  )
}

/** Same click-to-edit interaction, for the `active` boolean -- a toggle instead of a text field, still requiring an explicit click (not a bare checkbox that saves the instant it's toggled without confirmation context). */
export function QuickEditActiveToggle({ directoryId, active }: { directoryId: string; active: boolean }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [current, setCurrent] = useState(active)
  const [prevActive, setPrevActive] = useState(active)
  if (active !== prevActive) {
    setPrevActive(active)
    setCurrent(active)
  }

  async function toggle() {
    const next = !current
    setSaving(true)
    const result = await quickEditClub({ directoryId, field: "active", value: next })
    setSaving(false)
    if (result.ok) {
      setCurrent(next)
      router.refresh()
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={saving}
      role="switch"
      aria-checked={current}
      aria-label={current ? "Directory entry is active" : "Directory entry is inactive"}
      className={`relative h-6 w-10 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50 ${
        current ? "bg-pitch-600" : "bg-ink/15"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform ${
          current ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  )
}
