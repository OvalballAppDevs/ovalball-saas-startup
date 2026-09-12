import Link from "next/link"

import type { ClubBundle, RugbyCode } from "@/lib/app-context/clubs-types"
import { internationalRugbyCodeLabel } from "@/lib/app-context/clubs-types"
import { cn } from "@/lib/utils"

const CODE_FILTERS: { value: "all" | RugbyCode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "union", label: "Rugby Union" },
  { value: "league", label: "Rugby League" },
]

function Card({ href, title, codeLabel, summary }: { href: string; title: string; codeLabel: string | null; summary: string }) {
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
 * Beginner-first, not an alphabetical directory: a single flat list per
 * code filter, women's clubs interleaved naturally alongside men's --
 * never split into a secondary "Women's Clubs" section, matching the
 * exact instruction and the same pattern already proven for International
 * Rugby's national teams.
 */
export function ClubsLanding({ bundle, activeCode }: { bundle: ClubBundle; activeCode: "all" | RugbyCode }) {
  const filteredClubs = bundle.clubs.filter((c) => activeCode === "all" || c.rugbyCode === activeCode)

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Filter by rugby code" className="flex flex-wrap gap-1">
        {CODE_FILTERS.map((f) => {
          const isActive = f.value === activeCode
          return (
            <Link
              key={f.value}
              href={f.value === "all" ? "/rugby-hub/clubs" : `/rugby-hub/clubs?code=${f.value}`}
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

      {filteredClubs.length > 0 ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filteredClubs.map((c) => (
            <Card key={c.id} href={`/rugby-hub/clubs/${c.contentKey}`} title={c.title} codeLabel={internationalRugbyCodeLabel(c.rugbyCode)} summary={c.summary} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink/60">No clubs match this filter yet.</p>
      )}

      <p className="text-xs text-ink-muted">
        These are clubs that shaped rugby history — not simply today&apos;s biggest names. A small, deliberately curated first set. More will follow.
      </p>
    </div>
  )
}
