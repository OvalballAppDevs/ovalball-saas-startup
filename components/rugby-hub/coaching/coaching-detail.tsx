import Link from "next/link"
import { ExternalLink } from "lucide-react"

import type { CoachingBundle, CoachingConcept, CoachingRelatedLink } from "@/lib/app-context/coaching-types"
import { COACHING_FAMILY_LABEL, SOURCE_TIER_LABEL, coachingRugbyCodeLabel } from "@/lib/app-context/coaching-types"

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{heading}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-ink/80">{children}</p>
    </div>
  )
}

function LinkChips({ heading, note, links }: { heading: string; note?: string; links: { href: string; title: string; trailing?: string }[] }) {
  if (links.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{heading}</h3>
      {note && <p className="mt-1 text-sm text-ink/60">{note}</p>}
      <ul className="mt-2 flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href as never}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              {l.title}
              {l.trailing && <span className="text-xs text-ink-muted">{l.trailing}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * A coaching concept page. It explains how a coach creates learning — never
 * what a player should do (Skills and Player Development own that), never
 * what the Law says (Rules owns that, and this page links to the governing
 * body's own wording instead), and never anything about a real session,
 * squad or player.
 */
export function CoachingDetail({ bundle, concept }: { bundle: CoachingBundle; concept: CoachingConcept }) {
  const skills = bundle.skillsByConcept.get(concept.id) ?? []
  const related = bundle.relatedByConcept.get(concept.id) ?? []
  const facts = bundle.regulatoryFactsByConcept.get(concept.id) ?? []
  const sources = bundle.sourcesByConcept.get(concept.id) ?? []
  const codeLabel = coachingRugbyCodeLabel(concept.rugbyCode)

  const byKind = (kind: string) => related.filter((r: CoachingRelatedLink) => r.kindLabel === kind)
  const coachingLinks = byKind("Coaching")
  const developmentLinks = byKind("Development")
  const gameLinks = byKind("How the game works")
  const officiatingLinks = byKind("Officiating")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-display-l text-ink">{concept.title}</h2>
        <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{COACHING_FAMILY_LABEL[concept.family]}</span>
        {codeLabel && <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{codeLabel}</span>}
      </div>

      <p className="text-[15px] leading-relaxed text-ink/85">{concept.summary}</p>

      {concept.whyItMatters && <Section heading="Why this matters">{concept.whyItMatters}</Section>}
      {concept.body && <Section heading="What this looks like in a session">{concept.body}</Section>}

      {facts.length > 0 && (
        <div className="rounded-xl border border-pitch-400/50 bg-mint-100/60 px-4 py-4">
          <h3 className="text-xs font-semibold tracking-[0.06em] text-forest-900/70 uppercase">What the Governing Body Actually Says</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {facts.map((f) => (
              <li key={f.factKey} className="text-[15px] leading-relaxed text-forest-900/85">
                {f.valueText ?? "Governing-body regulation"}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-forest-900/70">This is the governing body&apos;s own wording, not an Ovalball paraphrase or a coaching opinion. Check the current rules for your age grade rather than relying on memory.</p>
        </div>
      )}

      <LinkChips
        heading="Skills This Helps You Coach"
        note="The technique itself, and how a player practises it, lives on these pages."
        links={skills.map((s) => ({ href: `/rugby-hub/skills/${s.skillKey}`, title: s.displayName }))}
      />

      <LinkChips
        heading="What the Player Is Developing"
        note="The player's side of the same idea, written for them rather than for you."
        links={developmentLinks.map((l) => ({ href: l.href, title: l.title }))}
      />

      <LinkChips heading="How the Game Works" links={gameLinks.map((l) => ({ href: l.href, title: l.title }))} />

      <LinkChips heading="How It Is Refereed" links={officiatingLinks.map((l) => ({ href: l.href, title: l.title }))} />

      <LinkChips heading="Related Coaching" links={coachingLinks.map((l) => ({ href: l.href, title: l.title }))} />

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
        Ovalball educational guidance — general coaching convention, not law, regulation, a coaching qualification, or medical advice. It is not a record of you, your sessions or your players.
      </p>
    </div>
  )
}
