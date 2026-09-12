import Link from "next/link"

import type { ParentGuide, ParentsBundle } from "@/lib/app-context/parents-types"
import { PARENT_AUTHORITY_LINKS, PARENT_FAMILY_BLURB, PARENT_FAMILY_LABEL, PARENT_INTENTS, groupParentGuidesByFamily, parentJourney } from "@/lib/app-context/parents-types"
import { cn } from "@/lib/utils"

function GuideCard({ guide }: { guide: ParentGuide }) {
  return (
    <li>
      <Link
        href={`/rugby-hub/parents/${guide.contentKey}` as never}
        className="flex min-h-[4.5rem] flex-col justify-center rounded-xl border border-ink/10 bg-white px-4 py-3 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <span className="text-sm font-semibold text-ink">{guide.title}</span>
        <span className="mt-0.5 line-clamp-2 text-sm text-ink/70">{guide.summary}</span>
      </Link>
    </li>
  )
}

/**
 * Parents & Guardians landing. Question-led rather than alphabetical, because
 * a parent arrives with a specific worry rather than a browsing intent.
 *
 * Two things are deliberate. The newcomer path comes first, since "where do I
 * even start" is the question a directory cannot answer. And Player Welfare
 * and Safeguarding are given a standing signpost of their own — this domain
 * is not the authority on either, and the quickest route to the real guidance
 * should never be buried inside an article.
 */
export function ParentsLanding({ bundle }: { bundle: ParentsBundle }) {
  const journey = parentJourney(bundle.guides)
  const groups = groupParentGuidesByFamily(bundle.guides)
  const byKey = new Map(bundle.guides.map((g) => [g.contentKey, g]))
  const intents = PARENT_INTENTS.filter((i) => byKey.has(i.guideKey))

  return (
    <div className="flex flex-col gap-10">
      {journey.length > 0 && (
        <section aria-labelledby="parents-journey-heading">
          <h2 id="parents-journey-heading" className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">
            New to Rugby
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/70">
            Seven things worth reading in roughly this order if rugby is new to your family. Nothing is tracked and there is nothing to complete.
          </p>
          <ol className="mt-3 flex flex-col gap-2">
            {journey.map((g, index) => {
              const isStart = index === 0
              return (
                <li key={g.id}>
                  <Link
                    href={`/rugby-hub/parents/${g.contentKey}` as never}
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
                      <span className={cn("block font-semibold", isStart ? "font-display text-lg text-forest-900" : "text-sm text-ink")}>{g.title}</span>
                      <span className={cn("mt-0.5 block text-sm", isStart ? "text-forest-900/85" : "text-ink/70")}>{g.summary}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {intents.length > 0 && (
        <section aria-labelledby="parents-intents-heading">
          <h2 id="parents-intents-heading" className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">
            I Need Help With…
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/70">
            Straight to the thing you came for. These are links — nothing is asked of you and nothing is remembered.
          </p>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {intents.map((i) => (
              <li key={i.guideKey}>
                <Link
                  href={`/rugby-hub/parents/${i.guideKey}` as never}
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

      <section aria-labelledby="parents-authority-heading" className="rounded-2xl border border-pitch-400/50 bg-mint-100/60 p-5">
        <h2 id="parents-authority-heading" className="font-display text-lg text-forest-900">
          Where the Official Guidance Lives
        </h2>
        <p className="mt-1 max-w-xl text-sm leading-relaxed text-forest-900/85">
          These pages explain rugby to families. They are not the authority on welfare or safeguarding — that guidance comes from the governing bodies, and it lives here.
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PARENT_AUTHORITY_LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href as never}
                className="flex min-h-[3.5rem] flex-col justify-center rounded-xl border border-forest-900/10 bg-white px-4 py-3 outline-none transition-colors hover:border-pitch-600/50 focus-visible:ring-2 focus-visible:ring-pitch-400"
              >
                <span className="text-sm font-semibold text-ink">{l.label}</span>
                <span className="mt-0.5 text-sm text-ink/70">{l.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {groups.map((g) => (
        <section key={g.family} id={`family-${g.family.toLowerCase()}`} aria-labelledby={`family-${g.family.toLowerCase()}-heading`} className="scroll-mt-6">
          <h2 id={`family-${g.family.toLowerCase()}-heading`} className="font-display text-2xl text-ink">
            {PARENT_FAMILY_LABEL[g.family]}
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink/70">{PARENT_FAMILY_BLURB[g.family]}</p>
          <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {g.guides.map((guide) => (
              <GuideCard key={guide.id} guide={guide} />
            ))}
          </ul>
        </section>
      ))}

      {bundle.guides.length === 0 && <p className="text-sm text-ink/70">No parent guides are published yet.</p>}

      <p className="text-xs text-ink-muted">
        These pages explain rugby to the adults supporting a player. They are not medical advice, not safeguarding policy, and not a record of anything about you, your family or your club. Your
        club&apos;s own arrangements, and the governing bodies&apos; own guidance, are always the authority.
      </p>
    </div>
  )
}
