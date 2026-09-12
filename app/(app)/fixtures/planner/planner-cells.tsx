"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"

import type { CellState } from "@/lib/fixtures/planner-model"

/**
 * THE CELLS THE PLANNER IS MADE OF.
 *
 * Two kinds, and the difference is the whole point of §37: a Notes cell is
 * free text because notes are free text, and every other structured column
 * behaves like spreadsheet data validation -- you may type anything, but
 * before a fixture exists the value has to land on a canonical record.
 *
 * Both kinds are a real <input>. That is deliberate and load-bearing:
 * paste, tab, arrow keys, screen readers and the browser's own date and
 * time pickers all work because nothing here reimplements a text box.
 */

export const CELL_TONE: Record<CellState, string> = {
  empty: "",
  // Only states that need a person's attention are inked. A grid where
  // every understood cell is also green is a grid where nothing stands
  // out, and forty green cells hide the one amber one.
  valid: "",
  suggested: "bg-sky-500/[0.07]",
  review: "bg-amber-500/[0.10]",
  error: "bg-destructive/[0.09]",
}

/** Never colour alone: a state that matters also carries a mark. */
const CELL_MARK: Partial<Record<CellState, { glyph: string; title: string }>> = {
  suggested: { glyph: "~", title: "Matched to the Club Directory — this opponent will be recorded, not asked" },
  review: { glyph: "?", title: "Needs review — this value did not match a canonical record" },
  error: { glyph: "!", title: "Ovalball could not read this value" },
}

const BASE_INPUT =
  "h-8 w-full bg-transparent px-1.5 text-sm text-ink outline-none placeholder:text-ink-subtle/60 focus:bg-pitch-400/10 focus:ring-2 focus:ring-inset focus:ring-pitch-600"

/**
 * Spellcheck OFF across the grid.
 *
 * Club names, team names and venues are proper nouns the dictionary has
 * never heard of, so the browser underlines almost every filled cell in
 * red. On a surface whose entire job is to tell somebody which cells are
 * wrong, a red underline that means "not in the dictionary" is actively
 * misleading -- it is the same signal the grid uses for a real error.
 */
const NO_SPELLCHECK = { spellCheck: false, autoCorrect: "off", autoCapitalize: "off" } as const

export interface LookupOption {
  id: string
  label: string
  hint?: string
}

/** A plain free-text or native-picker cell: date, times, notes. */
export function PlainCell({
  value,
  onChange,
  onPaste,
  onKeyDown,
  inputRef,
  label,
  placeholder,
  state,
}: {
  value: string
  onChange: (value: string) => void
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  inputRef: (el: HTMLInputElement | null) => void
  label: string
  placeholder?: string
  state: CellState
}) {
  const mark = CELL_MARK[state]
  return (
    <div className={`relative flex items-center ${CELL_TONE[state]}`}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={state === "error" || undefined}
        {...NO_SPELLCHECK}
        className={BASE_INPUT}
      />
      {mark && (
        <span
          aria-hidden="true"
          title={mark.title}
          className="pointer-events-none absolute right-1 text-xs font-semibold text-ink-muted"
        >
          {mark.glyph}
        </span>
      )}
    </div>
  )
}

/**
 * A STRUCTURED CELL.
 *
 * Types like a text box, resolves like a dropdown. The chevron is not
 * decoration -- §38 -- it is how somebody knows this column has answers
 * before they discover autocomplete by accident.
 *
 * The list opens on focus rather than only on click, so a person arriving
 * by Tab gets the same help as one arriving by mouse, and the options are
 * a real listbox so a screen reader announces how many there are.
 */
export function LookupCell({
  value,
  onChange,
  onCommit,
  onPaste,
  onKeyDown,
  inputRef,
  label,
  placeholder,
  state,
  options,
  loading,
  onQuery,
  emptyHint,
}: {
  value: string
  onChange: (value: string) => void
  /** Called when a real option is chosen, so the row can remember its id. */
  onCommit: (option: LookupOption) => void
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  inputRef: (el: HTMLInputElement | null) => void
  label: string
  placeholder?: string
  state: CellState
  options: LookupOption[]
  loading?: boolean
  /** Asks the owner to fetch options for this text. Debounced by the owner. */
  onQuery: (query: string) => void
  emptyHint?: string
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const listId = useId()
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const mark = CELL_MARK[state]

  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocDown)
    return () => document.removeEventListener("mousedown", onDocDown)
  }, [open])

  function choose(option: LookupOption) {
    onChange(option.label)
    onCommit(option)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className={`relative flex items-center ${CELL_TONE[state]}`}>
      <input
        ref={inputRef}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value)
          onQuery(e.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onFocus={() => {
          onQuery(value)
          setOpen(true)
        }}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (open && options.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setHighlight((h) => Math.min(h + 1, options.length - 1))
              return
            }
            if (e.key === "ArrowUp") {
              e.preventDefault()
              setHighlight((h) => Math.max(h - 1, 0))
              return
            }
            if (e.key === "Enter") {
              e.preventDefault()
              choose(options[highlight])
              return
            }
          }
          if (e.key === "Escape" && open) {
            e.preventDefault()
            setOpen(false)
            return
          }
          onKeyDown(e)
        }}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={state === "error" || undefined}
        {...NO_SPELLCHECK}
        className={`${BASE_INPUT} pr-6`}
      />

      {/* The dropdown indicator, and -- where the cell needs attention --
          the state mark sharing the same corner. */}
      <span className="pointer-events-none absolute right-1 flex items-center gap-0.5">
        {mark && (
          <span aria-hidden="true" title={mark.title} className="text-xs font-semibold text-ink-muted">
            {mark.glyph}
          </span>
        )}
        <ChevronDown className="size-3 text-ink-subtle" aria-hidden="true" />
      </span>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} options`}
          className="absolute top-full left-0 z-30 mt-0.5 max-h-64 min-w-64 overflow-auto rounded-lg border border-ink/15 bg-white py-1 shadow-lg"
        >
          {loading && <li className="px-3 py-2 text-xs text-ink-muted">Searching&hellip;</li>}
          {!loading && options.length === 0 && (
            <li className="px-3 py-2 text-xs text-ink-muted">
              {emptyHint ?? "No match. Anything typed here stays for review until it does."}
            </li>
          )}
          {options.map((option, index) => (
            <li key={option.id} role="option" aria-selected={index === highlight}>
              <button
                type="button"
                // mousedown, not click: the input's blur would close the list
                // before a click ever landed.
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(option)
                }}
                onMouseEnter={() => setHighlight(index)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                  index === highlight ? "bg-pitch-600/10 text-ink" : "text-ink"
                }`}
              >
                <span className="truncate">{option.label}</span>
                {option.hint && <span className="shrink-0 text-xs text-ink-muted">{option.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
