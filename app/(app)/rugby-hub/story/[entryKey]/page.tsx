import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { CertaintyBadge, CertaintyDescription } from "@/components/rugby-hub/heritage/certainty-badge"
import { CodeBadge } from "@/components/rugby-hub/heritage/code-badge"
import { HeritageSources } from "@/components/rugby-hub/heritage/heritage-sources"
import { findAdjacentEntries, findEraRelatives, getHeritageEntrySources, getHeritageTimeline } from "@/lib/app-context/heritage-data"
import { createClient } from "@/lib/supabase/server"

export async function generateMetadata({ params }: { params: Promise<{ entryKey: string }> }): Promise<Metadata> {
  const { entryKey } = await params
  const supabase = await createClient()
  const { entries } = await getHeritageTimeline(supabase)
  const entry = entries.find((e) => e.entryKey === entryKey)
  if (!entry) return { title: "The Story of Rugby | Rugby Hub" }
  // A MYTH/LEGEND entry's own title (e.g. "William Webb Ellis picks up the
  // ball") must never appear in a page <title> or share preview without its
  // certainty qualifier -- that is exactly the kind of place uncertainty
  // quietly turns into fact.
  const qualifier = entry.certainty === "MYTH" || entry.certainty === "LEGEND" ? ` (${entry.certainty === "MYTH" ? "myth" : "legend"})` : ""
  return {
    title: `${entry.title}${qualifier} | The Story of Rugby`,
    description: entry.summary,
  }
}

export default async function HeritageEntryPage({ params }: { params: Promise<{ entryKey: string }> }) {
  const { entryKey } = await params
  const supabase = await createClient()
  const { eras, entries } = await getHeritageTimeline(supabase)
  const entry = entries.find((e) => e.entryKey === entryKey)
  if (!entry) notFound()

  const era = eras.find((e) => e.id === entry.eraId) ?? null
  const [sources, { previous, next }, relatives] = await Promise.all([
    getHeritageEntrySources(supabase, entry.id),
    Promise.resolve(findAdjacentEntries(entries, entry.entryKey)),
    Promise.resolve(findEraRelatives(entries, entry)),
  ])

  const period = entry.endsYear && entry.endsYear !== entry.happenedYear ? `${entry.happenedYear}–${entry.endsYear}` : entry.happenedOn ?? String(entry.happenedYear)

  return (
    <div>
      <Link
        href="/rugby-hub/story"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-forest-800 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        The Story of Rugby
      </Link>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <p className="font-display text-3xl leading-none text-ink-muted">{period}</p>
        <CodeBadge codeScope={entry.codeScope} />
        {era && <span className="text-sm text-ink-muted">{era.title}</span>}
      </div>

      <h1 className="mt-3 font-display text-display-xl text-ink">{entry.title}</h1>

      <div className="mt-4 flex items-center gap-2 text-sm">
        <CertaintyBadge certainty={entry.certainty} size="md" />
        <CertaintyDescription certainty={entry.certainty} />
      </div>

      {(entry.certainty === "MYTH" || entry.certainty === "LEGEND") && (
        <div className="mt-4 rounded-lg border border-amber-600/30 bg-amber-50 px-4 py-3.5" role="note">
          <p className="text-[15px] leading-relaxed text-amber-950">
            {entry.certainty === "MYTH"
              ? "This is a well-known story, but the historical evidence doesn't support it. Ovalball records it because of its cultural importance, not because it happened."
              : "This is part of rugby's tradition, but it isn't established historical fact."}
          </p>
        </div>
      )}

      <div className="mt-8 max-w-2xl text-[16px] leading-relaxed text-ink/85">
        <p>{entry.summary}</p>
        {entry.detail && <p className="mt-4">{entry.detail}</p>}
      </div>

      {entry.certaintyNote && (
        <div className="mt-6 max-w-2xl border-l-2 border-amber-500/40 pl-4">
          <p className="text-sm leading-relaxed text-ink/60">{entry.certaintyNote}</p>
        </div>
      )}

      {(entry.people.length > 0 || entry.places.length > 0) && (
        <dl className="mt-8 grid max-w-2xl grid-cols-1 gap-4 border-t border-ink/8 pt-6 sm:grid-cols-2">
          {entry.people.length > 0 && (
            <div>
              <dt className="text-xs font-medium tracking-wide text-ink-muted uppercase">People</dt>
              <dd className="mt-1 text-sm text-ink/75">{entry.people.join(", ")}</dd>
            </div>
          )}
          {entry.places.length > 0 && (
            <div>
              <dt className="text-xs font-medium tracking-wide text-ink-muted uppercase">Place</dt>
              <dd className="mt-1 text-sm text-ink/75">{entry.places.join(", ")}</dd>
            </div>
          )}
        </dl>
      )}

      <HeritageSources sources={sources} />

      {relatives.length > 0 && (
        <div className="mt-10 border-t border-ink/8 pt-6">
          <h2 className="text-sm font-semibold text-ink">More from {era?.title ?? "this era"}</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {relatives.map((rel) => (
              <li key={rel.id}>
                <Link
                  href={`/rugby-hub/story/${rel.entryKey}`}
                  className="flex min-h-11 items-center gap-3 rounded-lg py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <span className="font-display text-base text-ink-muted">{rel.happenedYear}</span>
                  <span className="text-sm font-medium text-ink underline-offset-2 hover:underline">{rel.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <nav aria-label="Chronological navigation" className="mt-10 grid grid-cols-2 gap-4 border-t border-ink/8 pt-6">
        {previous ? (
          <Link
            href={`/rugby-hub/story/${previous.entryKey}`}
            className="group flex min-h-11 flex-col rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <span className="flex items-center gap-1 text-xs font-medium tracking-wide text-ink-muted uppercase">
              <ChevronLeft aria-hidden="true" className="size-3.5" />
              {previous.happenedYear}
            </span>
            <span className="mt-1 text-sm font-medium text-ink group-hover:text-forest-800">{previous.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/rugby-hub/story/${next.entryKey}`}
            className="group flex min-h-11 flex-col items-end rounded-lg text-right outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            <span className="flex items-center gap-1 text-xs font-medium tracking-wide text-ink-muted uppercase">
              {next.happenedYear}
              <ChevronRight aria-hidden="true" className="size-3.5" />
            </span>
            <span className="mt-1 text-sm font-medium text-ink group-hover:text-forest-800">{next.title}</span>
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  )
}
