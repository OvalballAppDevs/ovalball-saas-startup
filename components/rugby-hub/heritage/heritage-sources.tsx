import { ExternalLink } from "lucide-react"

import type { HeritageSource } from "@/lib/app-context/heritage-data"

const TIER_LABEL: Record<string, string> = {
  GOVERNING_BODY: "Governing body",
  MUSEUM_OR_ARCHIVE: "Museum or archive",
  ACADEMIC: "Academic",
  ENCYCLOPEDIA: "Encyclopedia",
  POPULAR_HISTORY: "Popular history",
  CONTEMPORARY_REPORT: "Contemporary report",
}

/** Elegant, not dominant: a disclosure rather than a reference list dumped into the reading flow. Never renders a source's internal id -- only what a reader can actually use (title, publisher, tier, link). */
export function HeritageSources({ sources }: { sources: HeritageSource[] }) {
  if (sources.length === 0) return null
  return (
    <details className="group mt-10 rounded-lg border border-ink/10 bg-white open:pb-1">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 py-3.5 text-sm font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
        <span>
          Sources <span className="font-normal text-ink-muted">({sources.length})</span>
        </span>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 text-ink-muted transition-transform group-open:rotate-180">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <ul className="flex flex-col gap-3 px-4 pb-3">
        {sources.map((source) => (
          <li key={source.id} className="border-t border-ink/8 pt-3 first:border-t-0 first:pt-0">
            <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">{TIER_LABEL[source.sourceTier] ?? source.sourceTier}</p>
            {source.sourceUrl ? (
              <a
                href={source.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-start gap-1 text-[15px] font-medium text-forest-800 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                {source.sourceTitle}
                <ExternalLink aria-hidden="true" className="mt-1 size-3 shrink-0" />
              </a>
            ) : (
              <p className="mt-0.5 text-[15px] font-medium text-ink">{source.sourceTitle}</p>
            )}
            {source.publisher && <p className="text-sm text-ink/60">{source.publisher}</p>}
            {source.supports && <p className="mt-1 text-sm text-ink-muted italic">{source.supports}</p>}
          </li>
        ))}
      </ul>
    </details>
  )
}
