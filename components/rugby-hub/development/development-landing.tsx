import Link from "next/link"

import type { DevelopmentBundle, DevelopmentConcept, RugbyCode } from "@/lib/app-context/development-types"
import {
  DEVELOPMENT_FAMILY_BLURB,
  DEVELOPMENT_FAMILY_LABEL,
  developmentJourney,
  developmentRugbyCodeLabel,
  filterConceptsByCode,
  groupConceptsByFamily,
} from "@/lib/app-context/development-types"
import { cn } from "@/lib/utils"

const CODE_FILTERS: { value: "all" | RugbyCode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "union", label: "Rugby Union" },
  { value: "league", label: "Rugby League" },
]

function ConceptCard({ concept }: { concept: DevelopmentConcept }) {
  const codeLabel = developmentRugbyCodeLabel(concept.rugbyCode)
  return (
    <li>
      <Link
        href={`/rugby-hub/development/${concept.contentKey}` as never}
        className="flex min-h-[4.5rem] flex-col justify-center rounded-xl border border-ink/10 bg-white px-4 py-3 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-sm font-semibold text-ink">{concept.title}</span>
          {codeLabel && <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-ink/15 px-2 text-[11px] font-medium whitespace-nowrap text-ink/60">{codeLabel}</span>}
        </span>
        <span className="mt-0.5 line-clamp-2 text-sm text-ink/60">{concept.summary}</span>
      </Link>
    </li>
  )
}

/**
 * Player Development's landing page. Three ways in, all of them pure
 * navigation: the beginner path (ordered in the data, not here), the five
 * families, and search. Nothing on this page asks who the reader is, rates
 * them, or tells them they are behind -- "What Should I Work On?" answers
 * with a menu, never with a verdict, because Ovalball has no basis on which
 * to judge an individual player and deliberately never will.
 */
export function DevelopmentLanding({ bundle, activeCode }: { bundle: DevelopmentBundle; activeCode: "all" | RugbyCode }) {
  const visible = filterConceptsByCode(bundle.concepts, activeCode)
  const journey = developmentJourney(visible)
  const groups = groupConceptsByFamily(visible)

  // Data-derived, never a hardcoded boast: this only says "governing-body
  // guidance" because these rows genuinely carry GOVERNING_BODY sources.
  const physicalConcepts = visible.filter((c) => c.family === "PHYSICAL")
  const physicalGoverningBodySourced = physicalConcepts.filter((c) => (bundle.sourcesByConcept.get(c.id) ?? []).some((s) => s.tier === "GOVERNING_BODY")).length

  return (
    <div className="flex flex-col gap-10">
      <nav aria-label="Filter by rugby code" className="flex flex-wrap gap-1">
        {CODE_FILTERS.map((f) => {
          const isActive = f.value === activeCode
          return (
            <Link
              key={f.value}
              href={f.value === "all" ? "/rugby-hub/development" : `/rugby-hub/development?code=${f.value}`}
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

      {journey.length > 0 && (
        <section aria-labelledby="journey-heading">
          <h2 id="journey-heading" className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">
            New to Rugby
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/70">
            A path through the ideas in the order they tend to make sense. It is not a syllabus and there is no finish line — read one, play some rugby, come back.
          </p>
          {/* One list, one emphasis. The first step carries the "Start Here"
              weight in place rather than being repeated above the list, so a
              reader is never shown the same card twice in a row. */}
          <ol className="mt-3 flex flex-col gap-2">
            {journey.map((c, index) => {
              const isStart = index === 0
              return (
                <li key={c.id}>
                  <Link
                    href={`/rugby-hub/development/${c.contentKey}` as never}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border px-4 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                      isStart ? "border-pitch-400/50 bg-mint-100/60 hover:border-pitch-600/60 sm:px-5 sm:py-4" : "border-ink/10 bg-white hover:border-pitch-600/40"
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        isStart ? "bg-forest-900 text-chalk" : "bg-forest-800 text-chalk"
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0">
                      {isStart && <span className="block text-[11px] font-semibold tracking-[0.06em] text-forest-900/70 uppercase">Start Here</span>}
                      <span className={cn("block font-semibold", isStart ? "font-display text-lg text-forest-900" : "text-sm text-ink")}>{c.title}</span>
                      <span className={cn("mt-0.5 block text-sm", isStart ? "text-forest-900/85" : "text-ink/60")}>{c.summary}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      <section aria-labelledby="work-on-heading">
        <h2 id="work-on-heading" className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">
          What Should I Work On?
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/70">
          Ovalball does not answer that for you, and nothing here scores or ranks a player. Your coach knows your rugby; these are the five kinds of thing there are to work on, so you can find the one you came for.
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {groups.map((g) => (
            <li key={g.family}>
              <a
                href={`#family-${g.family.toLowerCase()}`}
                className="flex min-h-[4rem] flex-col justify-center rounded-xl border border-ink/10 bg-white px-4 py-3 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                <span className="text-sm font-semibold text-ink">{DEVELOPMENT_FAMILY_LABEL[g.family]}</span>
                <span className="mt-0.5 text-sm text-ink/60">{DEVELOPMENT_FAMILY_BLURB[g.family]}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {groups.map((g) => (
        <section key={g.family} id={`family-${g.family.toLowerCase()}`} aria-labelledby={`family-${g.family.toLowerCase()}-heading`} className="scroll-mt-6">
          {/* No blurb repeated here: the What Should I Work On? card above is
              where each family is described, and saying it twice on one page
              reads as padding rather than emphasis. */}
          <h2 id={`family-${g.family.toLowerCase()}-heading`} className="font-display text-2xl text-ink">
            {DEVELOPMENT_FAMILY_LABEL[g.family]}
          </h2>

          {g.family === "PHYSICAL" && physicalGoverningBodySourced > 0 && (
            <p className="mt-3 rounded-xl border border-pitch-400/50 bg-mint-100/60 px-4 py-3 text-sm leading-relaxed text-forest-900/85">
              These explain how young players develop and why rugby is taught in stages. They are general principles, sourced to governing-body guidance —{" "}
              {physicalGoverningBodySourced} of {physicalConcepts.length} carry a governing-body source. They are never a training plan, a target, or medical advice, and Ovalball does not set an individual
              player&apos;s physical work. That is for your coach, and where health is involved, a qualified professional.
            </p>
          )}

          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {g.concepts.map((c) => (
              <ConceptCard key={c.id} concept={c} />
            ))}
          </ul>
        </section>
      ))}

      {visible.length === 0 && <p className="text-sm text-ink/60">No development concepts match this filter yet.</p>}

      <p className="text-xs text-ink-muted">
        Player Development explains how learning rugby works. It is not an assessment, a rating, a selection tool or a talent programme, and it records nothing about any individual player.
      </p>
    </div>
  )
}
