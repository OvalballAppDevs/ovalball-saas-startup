import Link from "next/link"
import { ExternalLink } from "lucide-react"

import type { CompetitionBundle, CompetitionGuide } from "@/lib/app-context/teams-competitions-types"
import { competitionRugbyCodeLabel } from "@/lib/app-context/teams-competitions-types"

/**
 * A competition guide is a plain explanatory article -- title, summary,
 * body -- never Game Knowledge's journey-field layout (why_it_matters/
 * what_happens/etc.), which this domain has no equivalent need for.
 * Source provenance, when present, renders as a small restrained line --
 * "Source: ... · Retrieved {date}" -- deliberately never phrased like a
 * regulatory citation ("Law says"/"Regulation says"): this is an ordinary
 * editorial fact about current competition structure, not a legal
 * proposition, and the two must stay visually and verbally distinct.
 */
export function CompetitionGuideDetail({ bundle, guide }: { bundle: CompetitionBundle; guide: CompetitionGuide }) {
  const related = bundle.relatedByGuide.get(guide.id) ?? []
  const glossaryLinks = bundle.glossaryByGuide.get(guide.id) ?? []
  const heritageLinks = bundle.heritageByGuide.get(guide.id) ?? []
  const codeLabel = competitionRugbyCodeLabel(guide.rugbyCode)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-display-l text-ink">{guide.title}</h2>
        {codeLabel && <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{codeLabel}</span>}
      </div>

      <p className="text-[15px] leading-relaxed text-ink/85">{guide.summary}</p>

      {guide.body && <p className="text-[15px] leading-relaxed text-ink/80">{guide.body}</p>}

      {(guide.sourceNote || guide.sourceUrl) && (
        <div className="flex items-start gap-1.5 rounded-lg border border-ink/10 bg-chalk px-3 py-2.5 text-sm text-ink/60">
          <ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {guide.sourceUrl ? (
              <a href={guide.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-forest-800 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
                {guide.sourceNote ?? "Official source"}
              </a>
            ) : (
              <span className="font-medium text-ink/70">{guide.sourceNote}</span>
            )}
            {guide.sourceRetrievedOn && <span> · Retrieved {new Date(guide.sourceRetrievedOn).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>}
          </span>
        </div>
      )}

      {glossaryLinks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Related Glossary</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {glossaryLinks.map((g) => (
              <li key={g.href}>
                <Link
                  href={g.href as never}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {g.title}
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

      {heritageLinks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Related History</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {heritageLinks.map((h) => (
              <li key={h.href}>
                <Link
                  href={h.href as never}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 text-sm font-medium text-ink/80 outline-none transition-colors hover:border-pitch-600/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {h.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-ink/10 pt-4 text-xs text-ink-muted">Ovalball educational guidance — general rugby knowledge, not law or regulation.</p>
    </div>
  )
}
