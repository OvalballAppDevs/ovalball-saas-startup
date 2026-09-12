import Link from "next/link"
import { ExternalLink } from "lucide-react"

import type { PeopleBundle, RugbyPerson } from "@/lib/app-context/people-types"
import { HONOUR_ROLE_LABEL, ROLE_LABEL, SOURCE_TIER_LABEL, TEAM_ROLE_LABEL, personYearRange } from "@/lib/app-context/people-types"

/**
 * A person page shows a plain-language introduction, real team/honour/
 * Heritage relationships and full source provenance -- never live stats,
 * caps, current club or a squad list (explicit, repeated instruction).
 * Every role a person has held renders as its own text badge (never
 * colour-only), so a multi-role figure like Kevin Sinfield shows PLAYER,
 * COACH and ADMINISTRATOR all at once rather than one arbitrary label.
 */
export function PersonDetail({ bundle, person }: { bundle: PeopleBundle; person: RugbyPerson }) {
  const teamLinks = bundle.teamLinksByPerson.get(person.id) ?? []
  const honours = bundle.honoursByPerson.get(person.id) ?? []
  const heritageLinks = bundle.heritageByPerson.get(person.id) ?? []
  const sources = bundle.sourcesByPerson.get(person.id) ?? []
  const related = bundle.relatedByPerson.get(person.id) ?? []
  const yearRange = personYearRange(person.birthYear, person.deathYear)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-display-l text-ink">{person.title}</h2>
        {yearRange && <span className="text-sm text-ink-muted">{yearRange}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {person.roles.map((role) => (
          <span key={role} className="inline-flex h-6 shrink-0 items-center rounded-full border border-ink/15 px-2.5 text-xs font-medium whitespace-nowrap text-ink/70">
            {ROLE_LABEL[role]}
          </span>
        ))}
      </div>

      <p className="text-[15px] leading-relaxed text-ink/85">{person.summary}</p>

      {person.body && <p className="text-[15px] leading-relaxed text-ink/80">{person.body}</p>}

      {teamLinks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Teams Represented</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {teamLinks.map((t) => (
              <li key={`${t.teamKey}-${t.roleType}`} className="rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink/80">
                <Link href={`/rugby-hub/international/teams/${t.teamKey}` as never} className="font-semibold text-forest-800 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400">
                  {t.teamTitle}
                </Link>
                <span className="text-ink/60"> — {TEAM_ROLE_LABEL[t.roleType]}</span>
                {t.notes && <span className="mt-1 block text-ink/60">{t.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {honours.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Selected Honours</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {honours.map((h) => (
              <li key={`${h.competitionKey}-${h.yearLabel}-${h.roleType}`} className="rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-sm text-ink/80">
                <span className="font-semibold text-ink">{h.yearLabel}</span> — {HONOUR_ROLE_LABEL[h.roleType]}, {h.teamTitle} ({h.competitionTitle})
                {h.notes && <span className="mt-1 block text-ink/60">{h.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {related.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold tracking-[0.06em] text-ink-muted uppercase">Related Rugby Hub Knowledge</h3>
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

      <p className="border-t border-ink/10 pt-4 text-xs text-ink-muted">Ovalball educational guidance — general rugby knowledge and history, not live statistics, rankings or a current-squad record.</p>
    </div>
  )
}
