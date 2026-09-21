"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { CheckCircle2, ExternalLink, MapPin, Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import type { AffiliatedClub } from "@/lib/governing/body"

/**
 * CONVERGENCE STEP 15 — the affiliated clubs, as a list somebody can find a club in.
 *
 * SEARCH ONLY WHERE IT IS WARRANTED. A county union with sixty clubs needs a filter; one with four
 * needs the four clubs. The threshold means a small organisation is not handed an empty control, and a
 * large one is not handed a wall.
 *
 * FILTERING IS IN THE BROWSER AND THAT IS SAFE HERE, because the whole list is already authorised: the
 * server returned only the clubs affiliated to a body this viewer may see. This is not the pattern of
 * loading data somebody may not have and hiding it in React — there is nothing here to hide.
 */
export function AffiliatedClubList({ clubs }: { clubs: AffiliatedClub[] }) {
  const [query, setQuery] = useState("")
  const showSearch = clubs.length > 10

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clubs
    return clubs.filter((c) =>
      [c.name, c.town, c.county, c.homeGround].some((f) => (f ?? "").toLowerCase().includes(q))
    )
  }, [clubs, query])

  return (
    <div className="flex flex-col gap-3">
      {showSearch && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search affiliated clubs by name, town or ground"
            placeholder="Search by club, town or ground"
            className="pl-9"
          />
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-xl bg-surface-muted px-3 py-6 text-center text-sm text-ink-muted" role="status">
          No affiliated club matches &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <>
          {showSearch && (
            <p className="text-xs text-ink-muted" role="status" aria-live="polite">
              {shown.length} of {clubs.length} clubs
            </p>
          )}
          <ul className="flex flex-col divide-y divide-line">
            {shown.map((c) => (
              <li key={c.directoryId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{c.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-muted">
                    {(c.town || c.county) && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3" aria-hidden="true" />
                        {[c.town, c.county].filter(Boolean).join(", ")}
                      </span>
                    )}
                    {c.homeGround && <span className="truncate">{c.homeGround}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  {/* THE CLUB'S OWN PUBLIC HOME -- the legitimate destination, and the same page any
                      visitor sees. A body's affiliation is not authority over the club's private data,
                      so this deliberately goes nowhere administrative. */}
                  {c.isOnOvalball && c.clubSlug ? (
                    <Link href={`/club/${c.clubSlug}`} className="inline-flex items-center gap-1 font-medium text-forest-800 hover:underline">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      On Ovalball
                    </Link>
                  ) : c.website ? (
                    <a
                      href={c.website}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1 text-ink-muted hover:text-ink hover:underline"
                    >
                      Club website
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="text-ink-muted">Not on Ovalball</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
