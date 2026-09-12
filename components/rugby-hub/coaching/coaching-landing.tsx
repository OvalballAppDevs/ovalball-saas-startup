import Link from "next/link"

import type { CoachingBundle, CoachingConcept, RugbyCode } from "@/lib/app-context/coaching-types"
import {
  COACHING_FAMILY_BLURB,
  COACHING_FAMILY_LABEL,
  COACHING_INTENTS,
  coachingJourney,
  coachingRugbyCodeLabel,
  filterCoachingByCode,
  groupCoachingByFamily,
} from "@/lib/app-context/coaching-types"
import { cn } from "@/lib/utils"

const CODE_FILTERS: { value: "all" | RugbyCode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "union", label: "Rugby Union" },
  { value: "league", label: "Rugby League" },
]

function ConceptCard({ concept }: { concept: CoachingConcept }) {
  const codeLabel = coachingRugbyCodeLabel(concept.rugbyCode)
  return (
    <li>
      <Link
        href={`/rugby-hub/coaching/${concept.contentKey}` as never}
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
 * Coaching Knowledge landing. Three ways in, all pure navigation: the New to
 * Coaching path, a set of questions a coach already has, and the seven
 * families. Nothing here is a course, a qualification or a record — a coach
 * can read any of it in any order and Ovalball stores nothing about who read
 * what.
 */
export function CoachingLanding({ bundle, activeCode }: { bundle: CoachingBundle; activeCode: "all" | RugbyCode }) {
  const visible = filterCoachingByCode(bundle.concepts, activeCode)
  const journey = coachingJourney(visible)
  const groups = groupCoachingByFamily(visible)
  const byKey = new Map(visible.map((c) => [c.contentKey, c]))
  const intents = COACHING_INTENTS.filter((i) => byKey.has(i.conceptKey))

  return (
    <div className="flex flex-col gap-10">
      <nav aria-label="Filter by rugby code" className="flex flex-wrap gap-1">
        {CODE_FILTERS.map((f) => {
          const isActive = f.value === activeCode
          return (
            <Link
              key={f.value}
              href={f.value === "all" ? "/rugby-hub/coaching" : `/rugby-hub/coaching?code=${f.value}`}
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
        <section aria-labelledby="coaching-journey-heading">
          <h2 id="coaching-journey-heading" className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">
            New to Coaching
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/70">
            Seven ideas in the order they tend to be useful. There is no course, no badge and nothing to complete — read one before Tuesday and see what changes.
          </p>
          <ol className="mt-3 flex flex-col gap-2">
            {journey.map((c, index) => {
              const isStart = index === 0
              return (
                <li key={c.id}>
                  <Link
                    href={`/rugby-hub/coaching/${c.contentKey}` as never}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border px-4 py-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400",
                      isStart ? "border-pitch-400/50 bg-mint-100/60 hover:border-pitch-600/60 sm:px-5 sm:py-4" : "border-ink/10 bg-white hover:border-pitch-600/40"
                    )}
                  >
                    <span aria-hidden="true" className={cn("mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-chalk", isStart ? "bg-forest-900" : "bg-forest-800")}>
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

      {intents.length > 0 && (
        <section aria-labelledby="coaching-intents-heading">
          <h2 id="coaching-intents-heading" className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">
            I Want To…
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/70">
            Shortcuts to the thing you came for. Nothing is asked of you and nothing is remembered — these are links, not a questionnaire.
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {intents.map((i) => (
              <li key={i.conceptKey}>
                <Link
                  href={`/rugby-hub/coaching/${i.conceptKey}` as never}
                  className="flex min-h-11 items-center gap-2 rounded-xl border border-ink/10 bg-white px-4 py-2.5 text-sm font-medium text-ink outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  <span aria-hidden="true" className="text-ink/30">
                    →
                  </span>
                  {i.question}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.family} id={`family-${g.family.toLowerCase()}`} aria-labelledby={`family-${g.family.toLowerCase()}-heading`} className="scroll-mt-6">
          <h2 id={`family-${g.family.toLowerCase()}-heading`} className="font-display text-2xl text-ink">
            {COACHING_FAMILY_LABEL[g.family]}
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink/70">{COACHING_FAMILY_BLURB[g.family]}</p>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {g.concepts.map((c) => (
              <ConceptCard key={c.id} concept={c} />
            ))}
          </ul>
        </section>
      ))}

      {visible.length === 0 && <p className="text-sm text-ink/60">No coaching concepts match this filter yet.</p>}

      <p className="text-xs text-ink-muted">
        Coaching Knowledge is educational guidance about how coaching works. It is not a coaching qualification, does not replace the RFU&apos;s or RFL&apos;s own coach education, and records nothing about
        you, your sessions or your players. Your club&apos;s real sessions, registers and plans live in Training Management.
      </p>
    </div>
  )
}
