import Link from "next/link"
import { ExternalLink } from "lucide-react"

import type { ParentGuide, ParentRelatedLink, ParentsBundle } from "@/lib/app-context/parents-types"
import { PARENT_AUTHORITY_LINKS, PARENT_FAMILY_LABEL, SOURCE_TIER_LABEL } from "@/lib/app-context/parents-types"

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{heading}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-ink/80">{children}</p>
    </div>
  )
}

function Chips({ heading, note, links }: { heading: string; note?: string; links: { href: string; title: string }[] }) {
  if (links.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">{heading}</h3>
      {note && <p className="mt-1 text-sm text-ink/70">{note}</p>}
      <ul className="mt-2 flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href as never}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              {l.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

const SOURCE_TIER_DISPLAY: Record<string, string> = { ...SOURCE_TIER_LABEL, SAFEGUARDING_AUTHORITY: "Safeguarding authority" }

/**
 * A parent guide page. It answers the adult's question and then hands over:
 * every section below the prose exists to send the reader to whichever Hub
 * domain actually owns the answer. Nothing here is medical advice,
 * safeguarding policy, or a record of any real family.
 */
export function ParentGuideDetail({ bundle, guide }: { bundle: ParentsBundle; guide: ParentGuide }) {
  const related = bundle.relatedByGuide.get(guide.id) ?? []
  const glossary = bundle.glossaryByGuide.get(guide.id) ?? []
  const skills = bundle.skillsByGuide.get(guide.id) ?? []
  const positions = bundle.positionsByGuide.get(guide.id) ?? []
  const facts = bundle.regulatoryFactsByGuide.get(guide.id) ?? []
  const sources = bundle.sourcesByGuide.get(guide.id) ?? []

  const byKind = (kind: string) => related.filter((r: ParentRelatedLink) => r.kindLabel === kind)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-display-l text-ink">{guide.title}</h2>
        <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{PARENT_FAMILY_LABEL[guide.family]}</span>
      </div>

      <p className="text-[15px] leading-relaxed text-ink/85">{guide.summary}</p>

      {guide.whyItMatters && <Section heading="Why this matters">{guide.whyItMatters}</Section>}
      {guide.body && <Section heading="What parents should know">{guide.body}</Section>}

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
          <p className="mt-2 text-xs text-forest-900/70">This is the governing body&apos;s own wording, not an Ovalball summary. Rules change between age groups and between the codes, so check what applies to your player rather than relying on memory.</p>
        </div>
      )}

      <Chips heading="Words You Might Not Know" note="Plain-English definitions, in the Glossary." links={glossary.map((g) => ({ href: `/rugby-hub/glossary/${g.termKey}`, title: g.displayTerm }))} />

      <Chips heading="How the Game Works" links={byKind("How the game works").map((l) => ({ href: l.href, title: l.title }))} />

      <Chips heading="What Your Player Is Learning" note="The player's own side of this, written for them." links={byKind("Player Development").map((l) => ({ href: l.href, title: l.title }))} />

      <Chips heading="What the Coach Is Doing" links={byKind("Coaching").map((l) => ({ href: l.href, title: l.title }))} />

      <Chips heading="Match Officials" links={byKind("Officiating").map((l) => ({ href: l.href, title: l.title }))} />

      <Chips heading="The Skills Behind This" links={skills.map((s) => ({ href: `/rugby-hub/skills/${s.skillKey}`, title: s.displayName }))} />

      <Chips heading="Positions" links={positions.map((p) => ({ href: `/rugby-hub/positions/${p.rugbyCode}/${p.positionKey}`, title: p.displayName }))} />

      <Chips heading="More for Parents" links={byKind("For Parents").map((l) => ({ href: l.href, title: l.title }))} />

      {guide.family === "WELFARE_AND_SAFETY" && (
        <div className="rounded-xl border border-pitch-400/50 bg-mint-100/60 px-4 py-4">
          <h3 className="text-xs font-semibold tracking-[0.06em] text-forest-900/70 uppercase">Where the Official Guidance Lives</h3>
          <p className="mt-1 text-sm leading-relaxed text-forest-900/85">
            This page explains the subject to a family. It is not the authority on it — these are.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {PARENT_AUTHORITY_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href as never}
                  className="inline-flex min-h-9 items-center rounded-full border border-forest-900/15 bg-white px-3 text-sm font-medium text-forest-900 outline-none transition-colors hover:border-pitch-600/50 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {l.label}
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
              <li key={`${s.title}-${s.url ?? ""}`} className="flex items-start gap-1.5 text-sm text-ink/70">
                <ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-forest-800 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
                      {s.title}
                    </a>
                  ) : (
                    <span className="font-medium text-ink/70">{s.title}</span>
                  )}
                  <span className="text-ink-muted"> · {SOURCE_TIER_DISPLAY[s.tier] ?? s.tier}</span>
                  {s.retrievedOn && <span className="text-ink-muted"> · Retrieved {new Date(s.retrievedOn).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-ink/10 pt-4 text-xs text-ink-muted">
        Ovalball educational guidance for families — not medical advice, not safeguarding policy, not law or regulation, and not a record of any player. Anything involving a player&apos;s health belongs
        with qualified medical people, and any safeguarding concern belongs with your club&apos;s welfare officer or the routes in the Safeguarding section.
      </p>
    </div>
  )
}
