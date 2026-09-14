"use client"

import { memo } from "react"
import { ChevronDown } from "lucide-react"

import type { LookupEntry } from "@/lib/fixtures/planner-lookup"
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
 * paste, the clipboard, screen readers and IME composition all work because
 * nothing here reimplements a text box.
 *
 * THE CELLS DO NOT HANDLE KEYS. The grid owns every keystroke -- moving,
 * extending, editing, choosing from a list -- so a list's arrow keys and the
 * grid's arrow keys can never both act on one press. A cell only draws what
 * the grid tells it: whether it is active, editing, selected or open.
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

/**
 * Spellcheck OFF across the grid.
 *
 * Club names, team names and venues are proper nouns the dictionary has
 * never heard of, so the browser underlines almost every filled cell in
 * red. On a surface whose entire job is to tell somebody which cells are
 * wrong, a red underline that means "not in the dictionary" is actively
 * misleading -- it is the same signal the grid uses for a real error.
 */
/** One hidden "Suggested" note the grid renders once, described by every suggested cell. */
export const SUGGESTED_NOTE_ID = "planner-suggested-note"

const NO_SPELLCHECK = { spellCheck: false, autoCorrect: "off", autoCapitalize: "off" } as const

function inputClass(editing: boolean, lookup: boolean, suggestion = false): string {
  return [
    "h-8 w-full bg-transparent px-1.5 text-sm outline-none placeholder:text-ink-subtle/60",
    // A suggestion reads as one -- quieter and italic -- until somebody types over it.
    suggestion ? "italic text-forest-800/80" : "text-ink",
    lookup ? "pr-6" : "",
    // Selection mode shows no caret: the cell is selected, not being typed
    // into, and a blinking caret would say otherwise.
    editing ? "cursor-text" : "cursor-cell caret-transparent select-none",
  ].join(" ")
}

interface CellProps {
  value: string
  label: string
  placeholder?: string
  state: CellState
  /** Filled in by Ovalball (a suggested team or ground) and not yet typed over. */
  suggestion?: boolean
  active: boolean
  editing: boolean
  inputRef: (el: HTMLInputElement | null) => void
  onChange: (value: string) => void
}

/** A plain free-text cell: date, times, H/A, notes. */
export const PlainCell = memo(function PlainCell({ value, label, placeholder, state, suggestion, active, editing, inputRef, onChange }: CellProps) {
  const mark = CELL_MARK[state]
  return (
    <div className={`relative flex items-center ${CELL_TONE[state]}`}>
      <input
        ref={inputRef}
        value={value}
        tabIndex={active ? 0 : -1}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        aria-describedby={suggestion ? SUGGESTED_NOTE_ID : undefined}
        aria-invalid={state === "error" || undefined}
        title={suggestion ? "Suggested by Ovalball. Type to change it." : undefined}
        {...NO_SPELLCHECK}
        className={inputClass(editing, false, suggestion)}
      />
      {mark && (
        <span aria-hidden="true" title={mark.title} className="pointer-events-none absolute right-1 text-xs font-semibold text-ink-muted">
          {mark.glyph}
        </span>
      )}
    </div>
  )
})

/**
 * A STRUCTURED CELL.
 *
 * Types like a text box, resolves like a dropdown. The chevron is not
 * decoration -- §38 -- it is how somebody knows this column has answers
 * before they discover autocomplete by accident. The options are a real
 * listbox with an active descendant, so a screen reader announces both how
 * many there are and which one Enter will choose.
 */
export const LookupCell = memo(function LookupCell({
  value,
  label,
  placeholder,
  state,
  suggestion,
  active,
  editing,
  inputRef,
  onChange,
  listId,
  open,
  dropUp,
  alignEnd,
  options,
  loading,
  emptyHint,
  highlight,
  onHighlight,
  onChoose,
}: CellProps & {
  listId: string
  open: boolean
  dropUp: boolean
  /** Near the grid's right edge the list opens leftwards, so it is not clipped by the scroller. */
  alignEnd?: boolean
  options: LookupEntry[]
  loading: boolean
  emptyHint?: string
  highlight: number
  onHighlight: (index: number) => void
  onChoose: (option: LookupEntry) => void
}) {
  const mark = CELL_MARK[state]
  const activeOption = open && options[highlight] ? `${listId}-o${highlight}` : undefined

  return (
    <div className={`relative flex items-center ${CELL_TONE[state]}`}>
      <input
        ref={inputRef}
        value={value}
        tabIndex={active ? 0 : -1}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeOption}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        aria-describedby={suggestion ? SUGGESTED_NOTE_ID : undefined}
        aria-invalid={state === "error" || undefined}
        title={suggestion ? "Suggested by Ovalball. Type or choose to change it." : undefined}
        {...NO_SPELLCHECK}
        className={inputClass(editing, true, suggestion)}
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
          // mousedown, not click, and never taking focus: the input keeps it,
          // so the grid keeps receiving keys while the list is open.
          onMouseDown={(e) => e.preventDefault()}
          className={`absolute ${alignEnd ? "right-0" : "left-0"} z-40 max-h-64 min-w-64 overflow-auto rounded-lg border border-ink/15 bg-white py-1 shadow-lg ${
            dropUp ? "bottom-full mb-0.5" : "top-full mt-0.5"
          }`}
        >
          {loading && <li className="px-3 py-2 text-xs text-ink-muted">Loading&hellip;</li>}
          {!loading && options.length === 0 && (
            <li className="px-3 py-2 text-xs text-ink-muted">{emptyHint ?? "No match. Anything typed here stays for review until it does."}</li>
          )}
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-o${index}`}
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onChoose(option)
              }}
              onMouseEnter={() => onHighlight(index)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm text-ink ${
                index === highlight ? "bg-pitch-600/10" : ""
              }`}
            >
              <span className="truncate">{option.label}</span>
              {option.hint && <span className="shrink-0 text-xs text-ink-muted">{option.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})
