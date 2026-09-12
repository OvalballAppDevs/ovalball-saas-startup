import Link from "next/link"
import { ExternalLink } from "lucide-react"

import type { DevelopmentBundle, DevelopmentConcept } from "@/lib/app-context/development-types"
import { DEVELOPMENT_FAMILY_LABEL, SOURCE_TIER_LABEL, developmentRugbyCodeLabel } from "@/lib/app-context/development-types"

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{heading}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-ink/80">{children}</p>
    </div>
  )
}

/**
 * A development concept page explains an idea about learning rugby. It
 * deliberately does not say what THIS reader should do next, how far along
 * they are, or how they compare -- there is no player record behind this
 * page and there never will be. The Skills it links to are where technique
 * lives; this page is the layer above them.
 */
export function DevelopmentDetail({ bundle, concept }: { bundle: DevelopmentBundle; concept: DevelopmentConcept }) {
  const skills = bundle.skillsByConcept.get(concept.id) ?? []
  const positions = bundle.positionsByConcept.get(concept.id) ?? []
  const related = bundle.relatedByConcept.get(concept.id) ?? []
  const facts = bundle.regulatoryFactsByConcept.get(concept.id) ?? []
  const sources = bundle.sourcesByConcept.get(concept.id) ?? []
  const codeLabel = developmentRugbyCodeLabel(concept.rugbyCode)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-display-l text-ink">{concept.title}</h2>
        <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{DEVELOPMENT_FAMILY_LABEL[concept.family]}</span>
        {codeLabel && <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{codeLabel}</span>}
      </div>

      <p className="text-[15px] leading-relaxed text-ink/85">{concept.summary}</p>

      {concept.whyItMatters && <Section heading="Why it matters">{concept.whyItMatters}</Section>}
      {concept.body && <Section heading="What this looks like">{concept.body}</Section>}

      {facts.length > 0 && (
        <div className="rounded-xl border border-pitch-400/50 bg-mint-100/60 px-4 py-4">
          <h3 className="text-xs font-semibold tracking-[0.06em] text-forest-900/70 uppercase">What the Law Actually Says</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {facts.map((f) => (
              <li key={f.factKey} className="text-[15px] leading-relaxed text-forest-900/85">
                {f.valueText ?? "Governing-body regulation"}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-forest-900/70">This is the governing body&apos;s own wording, not an Ovalball paraphrase.</p>
        </div>
      )}

      {skills.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Skills This Applies To</h3>
          <p className="mt-1 text-sm text-ink/60">The technique itself lives on these pages.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {skills.map((s) => (
              <li key={s.skillKey}>
                <Link
                  href={`/rugby-hub/skills/${s.skillKey}` as never}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {s.displayName}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {positions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Where You See This Most</h3>
          <p className="mt-1 text-sm text-ink/60">Positions where this idea shows up especially clearly — not the only positions it applies to, and not a suggestion of where anyone should play.</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {positions.map((p) => (
              <li key={`${p.rugbyCode}-${p.positionKey}`}>
                <Link
                  href={`/rugby-hub/positions/${p.rugbyCode}/${p.positionKey}` as never}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {p.shirtNumber && <span className="text-ink-muted">#{p.shirtNumber}</span>}
                  {p.displayName}
                  <span className="text-xs text-ink-muted">{p.rugbyCode === "union" ? "Union" : "League"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {related.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Related Knowledge</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {related.map((r) => (
              <li key={r.href}>
                <Link
                  href={r.href as never}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {r.title}
                  <span className="text-xs text-ink-muted">{r.kindLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {sources.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Sources</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {sources.map((s) => (
              <li key={`${s.title}-${s.url ?? ""}`} className="flex items-start gap-1.5 text-sm text-ink/60">
                <ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-forest-800 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
                      {s.title}
                    </a>
                  ) : (
                    <span className="font-medium text-ink/70">{s.title}</span>
                  )}
                  <span className="text-ink-muted"> · {SOURCE_TIER_LABEL[s.tier]}</span>
                  {s.retrievedOn && <span className="text-ink-muted"> · Retrieved {new Date(s.retrievedOn).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-ink/10 pt-4 text-xs text-ink-muted">
        Ovalball educational guidance — general coaching convention, not law, regulation, an assessment of any player, or medical advice.
      </p>
    </div>
  )
}
