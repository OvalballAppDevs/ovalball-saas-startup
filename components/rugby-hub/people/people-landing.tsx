import Link from "next/link"

import type { PeopleBundle } from "@/lib/app-context/people-types"
import { personYearRange } from "@/lib/app-context/people-types"

/**
 * Beginner-first, not an alphabetical celebrity directory: grouped by role
 * (Players / Coaches / Referees & Officials / Pioneers) with a multi-role
 * person appearing in every group they genuinely qualify for -- Kevin
 * Sinfield belongs under both Players and Coaches, which is simply true,
 * not a data error. No Union/League filter in v1: the corpus (14 people)
 * doesn't yet justify one, matching "no filters unless corpus size
 * justifies them." No "Legend" section header anywhere -- coverage itself
 * is the editorial curation; the entity taxonomy stays factual.
 */
function Card({ href, title, years, summary }: { href: string; title: string; years: string | null; summary: string }) {
  return (
    <li>
      <Link
        href={href as never}
        className="flex min-h-[4.5rem] flex-col justify-center rounded-xl border border-ink/10 bg-white px-4 py-3 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-sm font-semibold text-ink">{title}</span>
          {years && <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-ink/15 px-2 text-[11px] font-medium whitespace-nowrap text-ink/60">{years}</span>}
        </span>
        <span className="mt-0.5 line-clamp-2 text-sm text-ink/60">{summary}</span>
      </Link>
    </li>
  )
}

export function PeopleLanding({ bundle }: { bundle: PeopleBundle }) {
  const players = bundle.people.filter((p) => p.roles.includes("PLAYER"))
  const coaches = bundle.people.filter((p) => p.roles.includes("COACH"))
  const referees = bundle.people.filter((p) => p.roles.includes("REFEREE"))
  const pioneers = bundle.people.filter((p) => p.roles.includes("PIONEER"))

  const groups = [
    { key: "players", label: "Players", items: players },
    { key: "coaches", label: "Coaches", items: coaches },
    { key: "referees", label: "Referees & Officials", items: referees },
    { key: "pioneers", label: "Pioneers", items: pioneers },
  ].filter((g) => g.items.length > 0)

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <div key={group.key}>
          <h2 className="font-display text-2xl text-ink">{group.label}</h2>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.items.map((p) => (
              <Card key={`${group.key}-${p.contentKey}`} href={`/rugby-hub/people/${p.contentKey}`} title={p.title} years={personYearRange(p.birthYear, p.deathYear)} summary={p.summary} />
            ))}
          </ul>
        </div>
      ))}

      <p className="text-xs text-ink-muted">This covers a small, deliberately curated first set of significant rugby figures — not every player, coach, referee or pioneer. More will follow.</p>
    </div>
  )
}
