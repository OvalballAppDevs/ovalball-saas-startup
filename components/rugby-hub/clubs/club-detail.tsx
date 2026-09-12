import Link from "next/link"
import { ExternalLink } from "lucide-react"

import type { ClubBundle, FamousClub } from "@/lib/app-context/clubs-types"
import { HONOUR_TYPE_LABEL, SOURCE_TIER_LABEL, TEAM_GENDER_LABEL, TEAM_ROLE_LABEL, internationalRugbyCodeLabel } from "@/lib/app-context/clubs-types"

/**
 * A club page shows plain-language identity, real honours, real people and
 * real history connections -- never a live table, ranking or current
 * squad. Historical significance is never framed by current competition
 * position (Bradford is the permanent regression case for this).
 */
export function ClubDetail({ bundle, club }: { bundle: ClubBundle; club: FamousClub }) {
  const honours = bundle.honoursByClub.get(club.id) ?? []
  const related = bundle.relatedByClub.get(club.id) ?? []
  const heritageLinks = bundle.heritageByClub.get(club.id) ?? []
  const people = bundle.peopleByClub.get(club.id) ?? []
  const sources = bundle.sourcesByClub.get(club.id) ?? []
  const codeLabel = internationalRugbyCodeLabel(club.rugbyCode)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-display-l text-ink">{club.title}</h2>
        {codeLabel && <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{codeLabel}</span>}
        <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">Club</span>
        {club.teamGender && <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">{TEAM_GENDER_LABEL[club.teamGender]}</span>}
      </div>

      <p className="text-[15px] leading-relaxed text-ink/85">{club.summary}</p>

      {club.body && <p className="text-[15px] leading-relaxed text-ink/80">{club.body}</p>}

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

      {people.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Famous People</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {people.map((p) => (
              <li key={`${p.personKey}-${p.roleType}`} className="rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink/80">
                <Link href={p.href as never} className="font-semibold text-forest-800 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
                  {p.personTitle}
                </Link>
                <span className="text-ink/60"> — {TEAM_ROLE_LABEL[p.roleType]}</span>
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

      <p className="border-t border-ink/10 pt-4 text-xs text-ink-muted">Ovalball educational guidance — general rugby knowledge and history, not a live club database, standings service or current-squad record.</p>
    </div>
  )
}
