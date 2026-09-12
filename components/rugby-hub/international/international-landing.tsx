import Link from "next/link"

import type { InternationalBundle, RugbyCode } from "@/lib/app-context/international-types"
import { internationalRugbyCodeLabel } from "@/lib/app-context/international-types"
import { cn } from "@/lib/utils"

const CODE_FILTERS: { value: "all" | RugbyCode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "union", label: "Rugby Union" },
  { value: "league", label: "Rugby League" },
]

function Card({ href, title, summary, codeLabel }: { href: string; title: string; summary: string; codeLabel: string | null }) {
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
 * Question-first landing (section 40 of the design): major international
 * teams grouped by representation type before named competitions, so a
 * beginner meets "what kind of team is this" before "which specific team."
 * Women's teams are interleaved with men's within each group -- never
 * pushed below a men's-first list -- since the underlying data already
 * treats them as fully independent rows.
 */
export function InternationalLanding({ bundle, activeCode }: { bundle: InternationalBundle; activeCode: "all" | RugbyCode }) {
  const filteredTeams = bundle.teams.filter((t) => activeCode === "all" || t.rugbyCode === activeCode)
  const nationalTeams = filteredTeams.filter((t) => t.teamType === "NATIONAL_TEAM")
  const representativeTeams = filteredTeams.filter((t) => t.teamType === "REPRESENTATIVE_TEAM")
  const filteredCompetitions = bundle.competitions.filter((c) => activeCode === "all" || c.rugbyCode === activeCode)

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Filter by rugby code" className="flex flex-wrap gap-1">
        {CODE_FILTERS.map((f) => {
          const isActive = f.value === activeCode
          return (
            <Link
              key={f.value}
              href={f.value === "all" ? "/rugby-hub/international" : `/rugby-hub/international?code=${f.value}`}
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
        <h2 className="font-display text-2xl text-ink">National Teams</h2>
        {nationalTeams.length > 0 ? (
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {nationalTeams.map((t) => (
              <Card key={t.id} href={`/rugby-hub/international/teams/${t.contentKey}`} title={t.title} summary={t.summary} codeLabel={internationalRugbyCodeLabel(t.rugbyCode)} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink/60">No national teams match this filter yet.</p>
        )}
      </div>

      <div>
        <h2 className="font-display text-2xl text-ink">Representative Teams</h2>
        <p className="mt-1 text-sm text-ink/60">A representative team is drawn from several nations rather than being a nation in its own right.</p>
        {representativeTeams.length > 0 ? (
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {representativeTeams.map((t) => (
              <Card key={t.id} href={`/rugby-hub/international/teams/${t.contentKey}`} title={t.title} summary={t.summary} codeLabel={internationalRugbyCodeLabel(t.rugbyCode)} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink/60">No representative teams match this filter yet.</p>
        )}
      </div>

      <div>
        <h2 className="font-display text-2xl text-ink">International Competitions</h2>
        {filteredCompetitions.length > 0 ? (
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filteredCompetitions.map((c) => (
              <Card key={c.id} href={`/rugby-hub/competitions/${c.contentKey}`} title={c.title} summary={c.summary} codeLabel={internationalRugbyCodeLabel(c.rugbyCode)} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink/60">No competitions match this filter yet.</p>
        )}
      </div>

      <p className="text-xs text-ink-muted">
        This covers a small, deliberately curated first set of major international teams and competitions — not every rugby-playing nation. More will follow.
      </p>
    </div>
  )
}
