import Link from "next/link"
import { ExternalLink } from "lucide-react"

import type { GlossaryBundle, GlossaryTerm } from "@/lib/app-context/glossary-types"
import { rugbyCodeLabel } from "@/lib/app-context/glossary-types"

/**
 * Glossary term detail: deliberately compact -- a definition, not an
 * article (section 7/13 of the design). Only sections a term's data
 * actually supports are rendered, exactly as Game Knowledge's own concept
 * detail already established.
 */
export function GlossaryTermDetail({ bundle, term }: { bundle: GlossaryBundle; term: GlossaryTerm }) {
  const relatedTerms = bundle.relatedTermsByTerm.get(term.id) ?? []
  const contentLinks = bundle.contentLinksByTerm.get(term.id) ?? []
  const positions = bundle.positionsByTerm.get(term.id) ?? []
  const skills = bundle.skillsByTerm.get(term.id) ?? []
  const regulatoryFacts = bundle.regulatoryFactsByTerm.get(term.id) ?? []
  const detailLink = bundle.detailLinkByTerm.get(term.id) ?? null
  const codeLabel = rugbyCodeLabel(term.rugbyCode)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-display-l text-ink">{term.displayTerm}</h2>
        {codeLabel && <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{codeLabel}</span>}
      </div>

      <p className="text-[15px] leading-relaxed text-ink/85">{term.plainLanguageDefinition}</p>

      {term.aliases.length > 0 && (
        <p className="text-sm text-ink/60">
          <span className="font-semibold text-ink/70">Also called: </span>
          {term.aliases.join(", ")}
        </p>
      )}

      {detailLink && (
        <div>
          <Link href={detailLink.href as never} className="text-sm font-medium text-forest-800 underline underline-offset-2">
            Read more
          </Link>
        </div>
      )}

      {contentLinks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Related Knowledge</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {contentLinks.map((c) => (
              <li key={c.href}>
                <Link
                  href={c.href as never}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {skills.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Related Skills</h3>
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

      {positions.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Related Positions</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {positions.map((p) => (
              <li key={p.positionId}>
                <Link
                  href={`/rugby-hub/positions/${p.rugbyCode}/${p.positionKey}`}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {p.displayName}
                  <span className="text-xs text-ink-muted">{p.rugbyCode === "union" ? "Union" : "League"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {relatedTerms.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Related Terms</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {relatedTerms.map((r) => (
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
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Related Rule</h3>
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

      <p className="border-t border-ink/10 pt-4 text-xs text-ink-muted">Ovalball educational guidance — general rugby terminology, not law or regulation.</p>
    </div>
  )
}
