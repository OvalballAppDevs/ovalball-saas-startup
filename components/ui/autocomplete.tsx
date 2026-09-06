"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Loader2, Search, X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The one type-ahead primitive.
 *
 * Ovalball had three different search experiences: the fixture opponent
 * selector searched as you typed (no debounce, no keyboard support), the
 * venue address field made you press a Search button, and Site Admin's
 * Lookup Administration was a server-rendered form that needed Enter and a
 * full page navigation. Two of those were reported as broken, and they were
 * broken in different ways because they were three implementations.
 *
 * This is the shared one. It owns the behaviour that was missing:
 *
 *   * searches automatically after a minimum length and a debounce -- never
 *     a button, never Enter-to-start;
 *   * cancels superseded requests, so a slow early keystroke cannot
 *     overwrite the results of a later one;
 *   * real combobox semantics (role, aria-expanded, aria-activedescendant),
 *     so it is navigable by keyboard and announced by a screen reader;
 *   * arrow keys move, Enter selects the highlighted option, Escape closes;
 *   * distinct, visible loading / no-results / error states rather than a
 *     silent empty list.
 *
 * It is deliberately generic over the option type: callers supply the
 * search function and how to render an option, and get the selection back.
 */
export interface AutocompleteProps<T> {
  label: string
  placeholder?: string
  /** Runs debounced. Must be abort-aware via the signal where the caller can. */
  onSearch: (query: string) => Promise<T[]>
  onSelect: (option: T) => void
  renderOption: (option: T) => React.ReactNode
  /** Plain-text label for assistive tech and for the input once selected. */
  optionLabel: (option: T) => string
  optionKey: (option: T) => string
  /** Below this many characters nothing is searched. */
  minChars?: number
  debounceMs?: number
  /** Shown under the field; use for provider-unavailable notices. */
  hint?: string
  emptyMessage?: string
  autoFocus?: boolean
}

export function Autocomplete<T>({
  label,
  placeholder = "Start typing…",
  onSearch,
  onSelect,
  renderOption,
  optionLabel,
  optionKey,
  minChars = 2,
  debounceMs = 250,
  hint,
  emptyMessage = "No matches found.",
  autoFocus = false,
}: AutocompleteProps<T>) {
  const id = useId()
  const listId = `${id}-listbox`

  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)
  const [active, setActive] = useState(-1)

  // Monotonically increasing, so a slow earlier response is discarded
  // rather than clobbering a newer one.
  const seq = useRef(0)
  const boxRef = useRef<HTMLDivElement>(null)

  // Only the debounced async search lives here. Resetting below the
  // minimum length happens in onChange instead: setState synchronously in
  // an effect body triggers a cascading render, and the reset is a direct
  // consequence of the keystroke rather than of anything external.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < minChars) return

    const mine = ++seq.current
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const found = await onSearch(trimmed)
        if (mine !== seq.current) return
        setOptions(found)
        setActive(found.length > 0 ? 0 : -1)
        setError(null)
      } catch {
        if (mine !== seq.current) return
        setOptions([])
        setError("Search is temporarily unavailable.")
      } finally {
        if (mine === seq.current) {
          setLoading(false)
          setSearched(true)
          setOpen(true)
        }
      }
    }, debounceMs)

    return () => clearTimeout(timer)
    // onSearch is expected to be stable; callers wrap it in useCallback where
    // it closes over changing state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, minChars, debounceMs])

  // Clicking away closes the list without selecting anything.
  useEffect(() => {
    function onDocPointerDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocPointerDown)
    return () => document.removeEventListener("mousedown", onDocPointerDown)
  }, [])

  function handleQueryChange(value: string) {
    setQuery(value)
    if (value.trim().length < minChars) {
      seq.current++ // discard any in-flight response for a longer query
      setOptions([])
      setSearched(false)
      setError(null)
      setLoading(false)
      setOpen(false)
      setActive(-1)
    }
  }

  function choose(option: T) {
    onSelect(option)
    setQuery("")
    setOptions([])
    setOpen(false)
    setSearched(false)
    setActive(-1)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (options.length === 0) return
      e.preventDefault()
      setOpen(true)
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1
        return (next + options.length) % options.length
      })
      return
    }
    if (e.key === "Enter") {
      // Enter SELECTS the highlighted option. It never starts the search --
      // the search has already run. Prevented so the surrounding form does
      // not submit.
      if (open && active >= 0 && options[active]) {
        e.preventDefault()
        choose(options[active])
      }
      return
    }
    if (e.key === "Escape") {
      setOpen(false)
      setActive(-1)
    }
  }

  // An empty `emptyMessage` means the caller has nothing useful to say when
  // there are no results -- typically because a hint below the field is
  // already explaining why (the provider is not connected, say). Rendering
  // an empty dropdown there is noise, and "no matches" would contradict the
  // hint, so the list is suppressed entirely.
  const suppressEmptyList = emptyMessage.trim() === ""
  const showList =
    open &&
    (loading || options.length > 0 || (searched && query.trim().length >= minChars && !suppressEmptyList))

  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={id} className="text-sm text-ink/70">
        {label}
      </label>

      <div className="relative mt-1.5">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink/35"
        />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && options[active] ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          value={query}
          placeholder={placeholder}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => options.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-lg border border-ink/15 bg-white pr-9 pl-9 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400"
        />
        {loading ? (
          <Loader2
            aria-hidden="true"
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-ink/35"
          />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("")
              setOptions([])
              setOpen(false)
              setSearched(false)
            }}
            aria-label="Clear search"
            className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-ink/40 outline-none hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {hint ? <p className="mt-1 text-xs text-ink/50">{hint}</p> : null}

      {/* Always rendered so assistive tech can observe it; the live region
          announces state changes without stealing focus. */}
      <span className="sr-only" role="status" aria-live="polite">
        {loading
          ? "Searching"
          : searched && options.length === 0
            ? emptyMessage
            : options.length > 0
              ? `${options.length} result${options.length === 1 ? "" : "s"} available`
              : ""}
      </span>

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-ink/12 bg-white py-1 shadow-lg"
        >
          {loading && options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink/50">Searching…</li>
          ) : error ? (
            <li className="px-3 py-2 text-sm text-amber-900">{error}</li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink/50">{emptyMessage}</li>
          ) : (
            options.map((o, i) => (
              <li
                key={optionKey(o)}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                aria-label={optionLabel(o)}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  className={cn(
                    "w-full px-3 py-2 text-left text-sm outline-none",
                    i === active ? "bg-pitch-600/10 text-ink" : "text-ink/80 hover:bg-ink/[0.03]"
                  )}
                >
                  {renderOption(o)}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
