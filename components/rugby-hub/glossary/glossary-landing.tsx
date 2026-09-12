"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

import type { GlossaryTerm } from "@/lib/app-context/glossary-types"
import { groupTermsByLetter, rugbyCodeLabel } from "@/lib/app-context/glossary-types"
import { cn } from "@/lib/utils"

type CodeFilter = "ALL" | "UNIVERSAL" | "union" | "league"

const CODE_FILTERS: { value: CodeFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "UNIVERSAL", label: "Universal" },
  { value: "union", label: "Rugby Union" },
  { value: "league", label: "Rugby League" },
]

/**
 * The Glossary Explorer: A-Z structural browse over the whole, already
 * server-fetched, published term list -- never a second free-text search.
 * Typing to find a term by meaning is what the one global Rugby Hub search
 * bar (in the header on every page) already does. The alphabet rail and
 * code filter both operate over this one in-memory list; neither issues a
 * new request, and both scale to hundreds of terms without becoming a
 * client-side reimplementation of search_hub_content.
 */
export function GlossaryLanding({ terms }: { terms: GlossaryTerm[] }) {
  const [filter, setFilter] = useState<CodeFilter>("ALL")

  const filteredTerms = useMemo(() => {
    if (filter === "ALL") return terms
    if (filter === "UNIVERSAL") return terms.filter((t) => t.rugbyCode === null)
    return terms.filter((t) => t.rugbyCode === filter)
  }, [terms, filter])

  const allLetters = useMemo(() => groupTermsByLetter(terms).map((g) => g.letter), [terms])
  const groups = useMemo(() => groupTermsByLetter(filteredTerms), [filteredTerms])
  const availableLetters = new Set(groups.map((g) => g.letter))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">Glossary</h2>
          <p aria-live="polite" className="mt-1 text-sm text-ink/60">
            {filteredTerms.length} {filteredTerms.length === 1 ? "term" : "terms"}
          </p>
        </div>
        <div role="group" aria-label="Filter by rugby code" className="inline-flex flex-wrap rounded-full border border-ink/15 bg-white p-0.5">
          {CODE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "min-h-9 rounded-full px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                filter === f.value ? "bg-ink text-chalk" : "text-ink/60 hover:text-ink/90"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <nav aria-label="Jump to letter" className="-mx-1 flex flex-wrap gap-1 overflow-x-auto px-1 pb-1">
        {allLetters.map((letter) => {
          const active = availableLetters.has(letter)
          return active ? (
            <a
              key={letter}
              href={`#letter-${letter}`}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-forest-800 outline-none transition-colors hover:bg-mint-100 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              {letter}
            </a>
          ) : (
            <span key={letter} aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-medium text-ink/25">
              {letter}
            </span>
          )
        })}
      </nav>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-ink/10 bg-white px-4 py-8 text-center">
          <p className="text-sm font-medium text-ink">No terms match this filter yet</p>
          <p className="mt-1 text-sm text-ink-muted">Try a different rugby code, or view all terms.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <div key={group.letter} id={`letter-${group.letter}`} className="scroll-mt-24">
              <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{group.letter}</h3>
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {group.terms.map((t) => {
                  const codeLabel = rugbyCodeLabel(t.rugbyCode)
                  return (
                    <li key={t.id}>
                      <Link
                        href={`/rugby-hub/glossary/${t.termKey}`}
                        className="flex min-h-[4.5rem] flex-col justify-center rounded-xl border border-ink/10 bg-white px-4 py-3 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                      >
                        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          <span className="text-sm font-semibold text-ink">{t.displayTerm}</span>
                          {codeLabel && <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-ink/15 px-2 text-[11px] font-medium whitespace-nowrap text-ink/60">{codeLabel}</span>}
                        </span>
                        <span className="mt-0.5 line-clamp-2 text-sm text-ink/60">{t.plainLanguageDefinition}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
