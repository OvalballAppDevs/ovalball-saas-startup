"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { Search, X } from "lucide-react"

import type { HubSearchResult } from "@/lib/app-context/rugby-hub-search"
import { searchRugbyHubAction } from "@/app/(app)/rugby-hub/search-action"

/**
 * One Rugby Hub search, not a per-section search box. Query state lives in
 * the URL (?q=) so a search is a real, shareable, back-button-safe place
 * -- not just component state that vanishes on navigation (section 14/24).
 * Results are a single ranked list (section 15): with three linkable
 * result types and a modest content volume, splitting into per-type
 * groups would fragment an already-small result set rather than help
 * scanning -- search_hub_content's own rank ordering already does the
 * useful work.
 */
export function HubSearch() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlQuery = searchParams.get("q") ?? ""

  const [query, setQuery] = useState(urlQuery)
  const [results, setResults] = useState<HubSearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [hasSearched, setHasSearched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  function handleChange(value: string) {
    setQuery(value)
    setIsOpen(true)
    // A query that's too short to search is cleared synchronously here (a
    // real event handler), not in the effect below -- the effect's own
    // synchronous body never calls setState directly, only inside the
    // debounced timeout/promise callback.
    if (value.trim().length < 2) {
      setResults([])
      setHasSearched(false)
      setActiveIndex(-1)
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (trimmed.length < 2) return

    debounceRef.current = setTimeout(() => {
      const thisRequest = ++requestIdRef.current
      searchRugbyHubAction(trimmed).then((r) => {
        if (thisRequest !== requestIdRef.current) return // a newer keystroke already superseded this request
        setResults(r)
        setHasSearched(true)
        setActiveIndex(-1)
      })
      const params = new URLSearchParams(window.location.search)
      params.set("q", trimmed)
      router.replace(`?${params.toString()}`, { scroll: false })
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  const showPanel = isOpen && query.trim().length >= 2

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setIsOpen(false)
      inputRef.current?.blur()
      return
    }
    if (!showPanel || results.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault()
      const result = results[activeIndex]
      if (result) {
        setIsOpen(false)
        router.push(result.href as never)
      }
    }
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <label htmlFor="rugby-hub-search" className="sr-only">
        Search Rugby Hub
      </label>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
        <input
          ref={inputRef}
          id="rugby-hub-search"
          type="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="rugby-hub-search-results"
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `rugby-hub-search-result-${activeIndex}` : undefined}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search Rugby Hub"
          className="min-h-11 w-full rounded-full border border-ink/15 bg-white py-2 pr-9 pl-9 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("")
              setResults([])
              setHasSearched(false)
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
            className="absolute top-1/2 right-2.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted outline-none transition-colors hover:bg-mint-100 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        )}
      </div>

      {showPanel && (
        <div
          id="rugby-hub-search-results"
          role="listbox"
          aria-label="Search results"
          className="absolute top-full right-0 left-0 z-20 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-ink/10 bg-white p-2 shadow-lg"
        >
          {results.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {results.map((r, i) => (
                <li key={`${r.type}-${r.id}`} role="option" id={`rugby-hub-search-result-${i}`} aria-selected={activeIndex === i}>
                  <Link
                    href={r.href as never}
                    onClick={() => setIsOpen(false)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`block rounded-xl px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${activeIndex === i ? "bg-mint-100" : "hover:bg-mint-100/60"}`}
                  >
                    <p className="text-sm font-semibold text-ink">{r.title}</p>
                    <p className="mt-0.5 text-xs font-medium text-forest-800">{r.typeLabel}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">{r.snippet}</p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : hasSearched ? (
            <div className="px-3 py-6 text-center">
              <p className="text-sm font-medium text-ink">No results for &ldquo;{query.trim()}&rdquo;</p>
              <p className="mt-1 text-xs text-ink-muted">Check the spelling, or browse Positions, Skills or Rules directly.</p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                <Link href="/rugby-hub/positions" className="rounded-full border border-ink/15 px-3 py-1 text-xs font-medium text-ink/70 hover:border-pitch-600/40">
                  Positions
                </Link>
                <Link href="/rugby-hub/skills" className="rounded-full border border-ink/15 px-3 py-1 text-xs font-medium text-ink/70 hover:border-pitch-600/40">
                  Skills
                </Link>
                <Link href="/rugby-hub/rules" className="rounded-full border border-ink/15 px-3 py-1 text-xs font-medium text-ink/70 hover:border-pitch-600/40">
                  Rules
                </Link>
              </div>
            </div>
          ) : (
            <p className="px-3 py-4 text-center text-xs text-ink-muted">Searching…</p>
          )}
        </div>
      )}
    </div>
  )
}
