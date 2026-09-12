import Link from "next/link"
import { ExternalLink } from "lucide-react"

import type { GameConcept, GameKnowledgeBundle } from "@/lib/app-context/game-knowledge-types"
import { conceptRugbyCodeLabel } from "@/lib/app-context/game-knowledge-types"
import { GameFlowDiagram } from "./game-flow-diagram"

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{heading}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink/85">{children}</p>
    </div>
  )
}

/**
 * Game Knowledge concept detail: only renders sections this specific
 * concept's data actually supports -- the same "no forced empty sections"
 * principle Skills Explorer already established. The flagship
 * how-a-game-flows concept additionally renders the interactive
 * GameFlowDiagram; every other concept is text-and-connections only.
 */
export function GameConceptDetail({ bundle, concept }: { bundle: GameKnowledgeBundle; concept: GameConcept }) {
  const positions = bundle.positionsByConcept.get(concept.id) ?? []
  const skills = bundle.skillsByConcept.get(concept.id) ?? []
  const related = bundle.relatedByConcept.get(concept.id) ?? []
  const regulatoryFacts = bundle.regulatoryFactsByConcept.get(concept.id) ?? []
  const codeLabel = conceptRugbyCodeLabel(concept.rugbyCode)
  const isFlagship = concept.contentKey === "how-a-game-flows"

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-display-l text-ink">{concept.title}</h2>
        {codeLabel && <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{codeLabel}</span>}
      </div>

      <Section heading="What It Is">{concept.summary}</Section>

      {isFlagship && (
        <div>
          <GameFlowDiagram defaultCode={concept.rugbyCode ?? "union"} />
        </div>
      )}

      {concept.whyItMatters && <Section heading="Why It Matters">{concept.whyItMatters}</Section>}
      {concept.whatHappens && <Section heading="What Happens">{concept.whatHappens}</Section>}
      {concept.unionLeagueDifference && (
        <div className="rounded-xl border border-pitch-400/50 bg-mint-100/60 px-4 py-4">
          <p className="text-xs font-semibold tracking-[0.06em] text-forest-900 uppercase">Union / League Difference</p>
          <p className="mt-1.5 text-[15px] leading-relaxed text-forest-900/85">{concept.unionLeagueDifference}</p>
        </div>
      )}
      {concept.whatToWatchFor && <Section heading="What to Watch For">{concept.whatToWatchFor}</Section>}
      {concept.whatHappensNext && <Section heading="What Usually Happens Next">{concept.whatHappensNext}</Section>}

      {positions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Connected Positions</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {positions.map((p) => (
              <li key={p.positionId}>
                <Link
                  href={`/rugby-hub/positions/${p.rugbyCode}/${p.positionKey}`}
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

      {skills.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Connected Skills</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {skills.map((s) => (
              <li key={s.skillId}>
                <Link
                  href={`/rugby-hub/skills/${s.skillKey}`}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {s.displayName}
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
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {regulatoryFacts.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Related Rules</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {regulatoryFacts.map((f) => (
              <li key={f.factKey} className="flex items-start gap-1.5 rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink/70">
                <ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>{f.valueText ?? "Governing-body regulation"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-ink/10 pt-4 text-xs text-ink-muted">Ovalball educational guidance — general rugby knowledge, not law or regulation.</p>
    </div>
  )
}
