"use client"

import { useMemo, useState } from "react"

import type { KitPattern } from "@/components/club/rugby-kit"
import type { ArticleCard } from "@/lib/club-public/articles"
import { cn } from "@/lib/utils"

import { NewsCard } from "./news-cards"
import { EmptyState, FOCUS_LIGHT } from "./primitives"

/**
 * Team news with a team filter. The filter only offers teams that actually
 * have published stories on the page, so no choice ever leads to nothing,
 * and the result count is announced when it changes.
 */
export function TeamNews({ articles, clubSlug, pattern }: { articles: ArticleCard[]; clubSlug: string; pattern: KitPattern }) {
  const [team, setTeam] = useState<string | null>(null)
  const teams = useMemo(() => {
    const seen = new Map<string, string>()
    for (const a of articles) if (a.teamId && a.teamName && !seen.has(a.teamId)) seen.set(a.teamId, a.teamName)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [articles])

  if (articles.length === 0) {
    return (
      <EmptyState title="No team news yet">
        Match reports, training updates and team events appear here when the club&apos;s teams publish them.
      </EmptyState>
    )
  }

  const shown = team ? articles.filter((a) => a.teamId === team) : articles

  return (
    <div>
      {teams.length > 1 && (
        <div role="group" aria-label="Show news for" className="mb-5 flex flex-wrap gap-2">
          {[[null, "All Teams"] as const, ...teams].map(([id, name]) => (
            <button
              key={id ?? "all"}
              type="button"
              aria-pressed={team === id}
              onClick={() => setTeam(id)}
              className={cn(
                FOCUS_LIGHT,
                "min-h-10 rounded-full border px-4 text-sm font-semibold transition-colors",
                team === id ? "border-(--club-solid) bg-(--club-solid) text-(--club-on-solid)" : "border-ink/15 bg-white text-ink hover:border-ink/40"
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {shown.length === 1 ? "1 story" : `${shown.length} stories`}
      </p>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        {shown.slice(0, 6).map((a) => (
          <li key={a.id}>
            <NewsCard article={a} clubSlug={clubSlug} pattern={pattern} showTeam={!team} />
          </li>
        ))}
      </ul>
    </div>
  )
}
