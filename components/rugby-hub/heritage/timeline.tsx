"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

import type { HeritageEntry, HeritageEra } from "@/lib/app-context/heritage-data"
import { CertaintyBadge } from "./certainty-badge"
import { CodeBadge, codeAccentClass, codeDotClass } from "./code-badge"

type CodeFilter = "all" | "union" | "league"

const FILTERS: { value: CodeFilter; label: string }[] = [
  { value: "all", label: "All Rugby" },
  { value: "union", label: "Union" },
  { value: "league", label: "League" },
]

/** An entry is visible under a code filter if it's that code's own, or if it belongs to the shared/both history every code carries -- filtering narrows which code's OWN developments you see, it never fragments the shared root into two copies. */
function matchesFilter(entry: HeritageEntry, filter: CodeFilter): boolean {
  if (filter === "all") return true
  if (entry.codeScope === "pre_schism" || entry.codeScope === "both") return true
  return entry.codeScope === filter
}

export function HeritageTimelineExperience({ eras, entries }: { eras: HeritageEra[]; entries: HeritageEntry[] }) {
  const [filter, setFilter] = useState<CodeFilter>("all")

  const eraGroups = useMemo(() => {
    return eras.map((era) => ({
      era,
      allEntries: entries.filter((e) => e.eraId === era.id).sort((a, b) => a.happenedYear - b.happenedYear),
      visibleEntries: entries.filter((e) => e.eraId === era.id && matchesFilter(e, filter)).sort((a, b) => a.happenedYear - b.happenedYear),
    }))
  }, [eras, entries, filter])

  return (
    <div>
      <div role="radiogroup" aria-label="Filter by rugby code" className="sticky top-0 z-10 -mx-4 flex flex-wrap gap-1 border-b border-ink/8 bg-chalk/95 px-4 py-3 backdrop-blur-sm md:-mx-8 md:px-8">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={filter === f.value}
            onClick={() => setFilter(f.value)}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 ${
              filter === f.value ? "border-ink/15 bg-ink text-chalk" : "border-ink/15 bg-white text-ink/70 hover:border-ink/30"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ol className="relative mt-8 flex flex-col gap-12">
        {eraGroups.map(({ era, allEntries, visibleEntries }, eraIndex) => (
          <li key={era.id}>
            <EraMarker era={era} isFirst={eraIndex === 0} isLast={eraIndex === eraGroups.length - 1} />

            {visibleEntries.length === 0 ? (
              <p className="mt-4 ml-[1.375rem] border-l-2 border-dashed border-ink/10 py-2 pl-6 text-sm text-ink-muted md:ml-6">
                {allEntries.length > 0
                  ? `This era belongs entirely to ${allEntries[0].codeScope === "union" ? "Rugby Union" : "Rugby League"} — no ${filter} entries here.`
                  : "No entries recorded for this era yet."}
              </p>
            ) : (
              <ol className="mt-4 flex flex-col gap-1">
                {visibleEntries.map((entry) => (
                  <li key={entry.id}>
                    <TimelineEntryRow entry={entry} />
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

function EraMarker({ era, isFirst, isLast }: { era: HeritageEra; isFirst: boolean; isLast: boolean }) {
  const years = era.endsYear ? `${era.startsYear}–${era.endsYear}` : `${era.startsYear}–present`
  return (
    <div className="flex items-baseline gap-4 md:gap-6">
      <div className="flex shrink-0 flex-col items-center self-stretch" aria-hidden="true">
        <span className={`h-3 w-3 rounded-full border-2 border-chalk ${codeDotClass(era.codeScope)} ring-2 ring-current ${codeAccentClass(era.codeScope)}`} />
        {!isLast && <span className="mt-1 w-px flex-1 bg-ink/10" />}
      </div>
      <div className={isFirst ? "pt-0.5" : "pt-1"}>
        <p className={`font-display text-2xl leading-none ${codeAccentClass(era.codeScope)}`}>{years}</p>
        <h2 className="mt-1 font-display text-display-l text-ink">{era.title}</h2>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink/70">{era.summary}</p>
      </div>
    </div>
  )
}

function TimelineEntryRow({ entry }: { entry: HeritageEntry }) {
  return (
    <Link
      href={`/rugby-hub/story/${entry.entryKey}`}
      className="group ml-[1.375rem] flex min-h-11 items-start gap-4 border-l-2 border-ink/10 py-3 pl-6 outline-none transition-colors hover:border-ink/25 focus-visible:ring-2 focus-visible:ring-pitch-400 md:ml-6"
    >
      <span className="w-14 shrink-0 pt-0.5 font-display text-xl leading-none text-ink-muted group-hover:text-ink/70">{entry.happenedYear}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-ink group-hover:text-forest-800">{entry.title}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-ink/60">{entry.summary}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <CodeBadge codeScope={entry.codeScope} />
          <CertaintyBadge certainty={entry.certainty} />
        </div>
      </div>
    </Link>
  )
}
