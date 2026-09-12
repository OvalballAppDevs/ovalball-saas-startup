import Link from "next/link"
import { ExternalLink } from "lucide-react"

import type { InternationalBundle, InternationalTeam } from "@/lib/app-context/international-types"
import { HONOUR_TYPE_LABEL, TEAM_GENDER_LABEL, TEAM_TYPE_LABEL, internationalRugbyCodeLabel } from "@/lib/app-context/international-types"

/**
 * A team page shows a plain-language introduction, its major competitions
 * and a curated honours list -- never a live squad, ranking, fixture list
 * or statistics (explicit, repeated instruction). Team type and gender
 * render as text badges, never colour/flag-only, matching every other
 * Rugby Hub status badge this session established.
 */
export function TeamDetail({ bundle, team }: { bundle: InternationalBundle; team: InternationalTeam }) {
  const honours = bundle.honoursByTeam.get(team.id) ?? []
  const related = bundle.relatedByTeam.get(team.id) ?? []
  const heritageLinks = bundle.heritageByContentItem.get(team.id) ?? []
  const codeLabel = internationalRugbyCodeLabel(team.rugbyCode)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-display-l text-ink">{team.title}</h2>
        {codeLabel && <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{codeLabel}</span>}
        <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{TEAM_TYPE_LABEL[team.teamType]}</span>
        {team.teamGender && <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{TEAM_GENDER_LABEL[team.teamGender]}</span>}
      </div>

      <p className="text-[15px] leading-relaxed text-ink/85">{team.summary}</p>

      {team.body && <p className="text-[15px] leading-relaxed text-ink/80">{team.body}</p>}

      {(team.sourceNote || team.sourceUrl) && (
        <div className="flex items-start gap-1.5 rounded-lg border border-ink/10 bg-chalk px-3 py-2.5 text-sm text-ink/60">
          <ExternalLink aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {team.sourceUrl ? (
              <a href={team.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-forest-800 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
                {team.sourceNote ?? "Official source"}
              </a>
            ) : (
              <span className="font-medium text-ink/70">{team.sourceNote}</span>
            )}
          </span>
        </div>
      )}

      {honours.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Selected Honours</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {honours.map((h) => (
              <li key={h.id} className="rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink/80">
                <span className="font-semibold text-ink">{h.yearLabel}</span> — {HONOUR_TYPE_LABEL[h.honourType] ?? h.honourType}, {h.competitionTitle}
                {h.notes && <span className="mt-1 block text-ink/60">{h.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {related.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Major Competitions</h3>
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

      <p className="border-t border-ink/10 pt-4 text-xs text-ink-muted">Ovalball educational guidance — general rugby knowledge, not a live squad, ranking or statistics service.</p>
    </div>
  )
}
