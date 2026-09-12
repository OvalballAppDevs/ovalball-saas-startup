import Link from "next/link"

import type { CompetitionBundle, RugbyCode } from "@/lib/app-context/teams-competitions-types"
import { competitionRugbyCodeLabel } from "@/lib/app-context/teams-competitions-types"
import { cn } from "@/lib/utils"

const CODE_FILTERS: { value: "all" | RugbyCode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "union", label: "Rugby Union" },
  { value: "league", label: "Rugby League" },
]

function GuideCard({ href, title, summary, codeLabel }: { href: string; title: string; summary: string; codeLabel: string | null }) {
  return (
    <li>
      <Link
        href={href as never}
        className="flex min-h-[4.5rem] flex-col justify-center rounded-xl border border-ink/10 bg-white px-4 py-3 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-sm font-semibold text-ink">{title}</span>
          {codeLabel && <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-ink/15 px-2 text-[11px] font-medium whitespace-nowrap text-ink/60">{codeLabel}</span>}
        </span>
        <span className="mt-0.5 line-clamp-2 text-sm text-ink/60">{summary}</span>
      </Link>
    </li>
  )
}

/**
 * Beginner-first, not alphabetical (section 33 of the design): a short
 * intro, a real (data-driven, never hardcoded) Union/League filter, then
 * the generic "how competitions work" explainers before the named
 * competitions themselves -- understanding the shape of a competition
 * matters before meeting a specific one. The filter is server-rendered
 * real links (?code=), never a clickable div, so it stays keyboard-
 * reachable and works with JS disabled.
 */
export function CompetitionsLanding({ bundle, activeCode }: { bundle: CompetitionBundle; activeCode: "all" | RugbyCode }) {
  const explainers = bundle.guides.filter((g) => g.rugbyCode === null)
  const named = bundle.guides.filter((g) => g.rugbyCode !== null && (activeCode === "all" || g.rugbyCode === activeCode))

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Filter by rugby code" className="flex flex-wrap gap-1">
        {CODE_FILTERS.map((f) => {
          const isActive = f.value === activeCode
          return (
            <Link
              key={f.value}
              href={f.value === "all" ? "/rugby-hub/competitions" : `/rugby-hub/competitions?code=${f.value}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                isActive ? "bg-ink text-chalk" : "border border-ink/15 text-ink/70 hover:border-pitch-600/40"
              )}
            >
              {f.label}
            </Link>
          )
        })}
      </nav>

      <div>
        <h2 className="font-display text-2xl text-ink">How Competitions Work</h2>
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {explainers.map((g) => (
            <GuideCard key={g.id} href={`/rugby-hub/competitions/${g.contentKey}`} title={g.title} summary={g.summary} codeLabel={null} />
          ))}
        </ul>
      </div>

      <div>
        <h2 className="font-display text-2xl text-ink">Domestic Competitions</h2>
        {named.length > 0 ? (
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {named.map((g) => (
              <GuideCard key={g.id} href={`/rugby-hub/competitions/${g.contentKey}`} title={g.title} summary={g.summary} codeLabel={competitionRugbyCodeLabel(g.rugbyCode)} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink/60">No competitions match this filter yet.</p>
        )}
      </div>

      <p className="text-xs text-ink-muted">
        This covers a small, deliberately incomplete first set of English domestic competitions — not a complete guide to every UK competition. Wales, Scotland and Ireland are not yet
        covered here.
      </p>
    </div>
  )
}
