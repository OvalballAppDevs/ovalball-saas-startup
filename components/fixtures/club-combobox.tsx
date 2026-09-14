"use client"

import { useId, useMemo, useState } from "react"
import { Loader2, Lock } from "lucide-react"

import type { ClubCatalogueEntry } from "@/lib/fixtures/club-catalogue"
import { buildLookupIndex, searchLookup } from "@/lib/fixtures/planner-lookup"
import { cn } from "@/lib/utils"

/**
 * CHOOSE A CLUB, FROM THE CATALOGUE ALREADY IN THE BROWSER.
 *
 * The catalogue (lib/fixtures/club-catalogue.ts) is loaded once, the first
 * time any picker on the page is focused, and every keystroke filters it
 * locally with the planner's ranked search -- "RFC", "Rugby Football Club"
 * and "rufc" all find the same club. Ovalball clubs are marked, because
 * choosing one means they are asked rather than booked.
 *
 * Keyboard: arrows move, Enter chooses, Escape closes the list without
 * closing whatever dialog the picker sits in.
 */

export type ClubChoice = { directoryId: string | null; name: string; tenantClubId: string | null }

export function ClubCombobox({
  label,
  value,
  onChoose,
  loadCatalogue,
  disabled = false,
  lockedReason,
  allowFreeText = false,
  placeholder,
  errors = [],
  hideLabel = false,
  describe,
  className,
}: {
  label: string
  value: ClubChoice | null
  onChoose: (choice: ClubChoice | null) => void
  loadCatalogue: () => Promise<ClubCatalogueEntry[]>
  disabled?: boolean
  lockedReason?: string | null
  /** Offer "Use ... as a club not listed" (a fixture's external opposition). Competitions need a directory club. */
  allowFreeText?: boolean
  placeholder?: string
  errors?: string[]
  hideLabel?: boolean
  /** A quiet line under the field while the list is closed. */
  describe?: string | null
  className?: string
}) {
  const id = useId()
  const listId = `${id}-list`
  const [query, setQuery] = useState(value?.name ?? "")
  // A value changed from outside (cleared, reordered, reset) shows in the box.
  const [shownName, setShownName] = useState(value?.name ?? "")
  if ((value?.name ?? "") !== shownName) {
    setShownName(value?.name ?? "")
    setQuery(value?.name ?? "")
  }
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [catalogue, setCatalogue] = useState<ClubCatalogueEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const index = useMemo(
    () => (catalogue ? buildLookupIndex(catalogue.map((c) => ({ id: c.id, label: c.name, hint: c.tenantClubId ? "On Ovalball" : undefined }))) : null),
    [catalogue],
  )
  const results = useMemo(() => (index && query.trim() ? searchLookup(index, query, { limit: 8 }) : []), [index, query])
  const byId = useMemo(() => new Map((catalogue ?? []).map((c) => [c.id, c])), [catalogue])
  const typed = query.trim()
  const offerText = allowFreeText && typed.length > 1 && !results.some((r) => r.label.toLowerCase() === typed.toLowerCase())
  const optionCount = results.length + (offerText ? 1 : 0)
  const listOpen = open && (loading || optionCount > 0)

  function ensure() {
    if (catalogue || loading) return
    setLoading(true)
    loadCatalogue().then((c) => {
      setCatalogue(c)
      setLoading(false)
    })
  }

  function choose(i: number) {
    if (i < results.length) {
      const entry = byId.get(results[i].id)
      if (!entry) return
      setQuery(entry.name)
      onChoose({ directoryId: entry.id, name: entry.name, tenantClubId: entry.tenantClubId })
    } else if (offerText) {
      onChoose({ directoryId: null, name: typed, tenantClubId: null })
    }
    setOpen(false)
  }

  return (
    <div className={cn("relative", className)}>
      <label htmlFor={id} className={cn(hideLabel ? "sr-only" : "flex items-center gap-1.5 text-sm font-medium text-ink")}>
        {label}
        {disabled && lockedReason && <Lock className="size-3 text-ink-muted" aria-label="Locked" />}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={listOpen && optionCount > 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        disabled={disabled}
        placeholder={placeholder ?? "Search clubs"}
        onFocus={ensure}
        onChange={(e) => {
          ensure()
          setQuery(e.target.value)
          setActive(0)
          setOpen(true)
          if (!e.target.value.trim() && value) onChoose(null)
        }}
        onBlur={() => {
          setOpen(false)
          if (query.trim() && query.trim() !== (value?.name ?? "")) setQuery(value?.name ?? "")
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setOpen(true)
            setActive((a) => Math.min(a + 1, Math.max(optionCount - 1, 0)))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === "Enter" && open && optionCount > 0) {
            e.preventDefault()
            choose(active)
          } else if (e.key === "Escape" && open) {
            e.stopPropagation()
            e.preventDefault()
            setOpen(false)
          }
        }}
        className={cn(
          "h-9 w-full rounded-md border border-ink/15 bg-white px-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400/40 disabled:cursor-not-allowed disabled:bg-ink/[0.03] disabled:text-ink-muted",
          !hideLabel && "mt-1",
        )}
      />
      {describe && !open && <p className="mt-1 text-xs text-ink-muted">{describe}</p>}
      {disabled && lockedReason && <p className="mt-1 text-xs text-ink-muted">{lockedReason}</p>}
      {errors.map((m) => (
        <p key={m} role="alert" className="mt-1 text-xs text-destructive-text">
          {m}
        </p>
      ))}
      {listOpen && (
        <ul id={listId} role="listbox" aria-label={`${label} options`} className="absolute z-20 mt-1 max-h-72 w-full min-w-64 overflow-y-auto rounded-md border border-ink/15 bg-white py-1 shadow-md">
          {loading && !catalogue && (
            <li className="flex items-center gap-2 px-3 py-2 text-sm text-ink-muted">
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Loading clubs…
            </li>
          )}
          {results.map((r, i) => (
            <li
              key={r.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(i)
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm", i === active && "bg-ink/[0.05]")}
            >
              <span className="truncate text-ink">{r.label}</span>
              {r.hint && <span className="shrink-0 text-xs text-forest-800">{r.hint}</span>}
            </li>
          ))}
          {offerText && (
            <li
              id={`${listId}-${results.length}`}
              role="option"
              aria-selected={active === results.length}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(results.length)
              }}
              onMouseEnter={() => setActive(results.length)}
              className={cn("cursor-pointer border-t border-ink/8 px-3 py-2 text-sm text-ink", active === results.length && "bg-ink/[0.05]")}
            >
              Use &ldquo;{typed}&rdquo; as a club not listed
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
