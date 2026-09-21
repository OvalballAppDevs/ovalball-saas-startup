import Link from "next/link"
import { notFound } from "next/navigation"
import { Building2, CheckCircle2, ExternalLink, Trophy, Users } from "lucide-react"

import { PageIdentity } from "@/components/shell/page-identity"
import {
  BODY_ROLE_LABEL,
  BODY_TYPE_LABEL,
  loadAffiliatedClubs,
  loadGoverningBody,
} from "@/lib/governing/body"
import { createClient } from "@/lib/supabase/server"

/**
 * CONVERGENCE STEP 14 — what organisation am I looking at?
 *
 * The foundation surface, and deliberately not Step 15's workspace. It answers the four questions a
 * rugby administrator actually asks on arriving: who is this, what am I to it, which clubs belong to
 * it, and what does it run. Everything beyond that is named as coming next rather than mocked up,
 * because a button that does nothing is worse than an honest gap.
 *
 * There are no database diagnostics on this page. The provenance line is the exception, and it earns
 * its place: this is reference data about a real organisation, and where it came from is a fact a
 * person may need to check.
 */
export default async function GoverningBodyPage({ params }: { params: Promise<{ bodyId: string }> }) {
  const { bodyId } = await params
  const supabase = await createClient()

  // The server refuses a viewer with no relationship, so "nothing" here means "not yours".
  const body = await loadGoverningBody(supabase, bodyId)
  if (!body) notFound()
  const clubs = await loadAffiliatedClubs(supabase, bodyId)

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <PageIdentity workspace="Governing Body" title={body.canonicalName} className="mt-0" />

      {/* WHO IS THIS, AND WHAT AM I TO IT. */}
      <section aria-labelledby="gb-identity" className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <h2 id="gb-identity" className="sr-only">
          Organisation
        </h2>
        <div className="flex flex-wrap items-start gap-3">
          <Building2 className="mt-0.5 size-5 shrink-0 text-forest-800" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">
              {BODY_TYPE_LABEL[body.bodyType] ?? body.bodyType} · {body.rugbyCode === "union" ? "Rugby Union" : "Rugby League"} ·{" "}
              {body.nation}
            </p>
            {body.myRole && (
              <p className="mt-1 text-sm text-ink-muted">
                You are <span className="font-medium text-ink">{BODY_ROLE_LABEL[body.myRole]}</span> here.
                {body.canManage
                  ? " You can change this organisation's record and who holds a role in it."
                  : body.canManageCompetitions
                    ? " You can organise its competitions."
                    : " You can see it, and not change it."}
              </p>
            )}
            {!body.myRole && (
              <p className="mt-1 text-sm text-ink-muted">
                You are seeing this as a Site Admin. You hold no role in this organisation.
              </p>
            )}
            {body.sourceUrl && (
              <p className="mt-2 text-xs text-ink-muted">
                Organisation record from{" "}
                <a href={body.sourceUrl} className="underline hover:no-underline" rel="noreferrer noopener" target="_blank">
                  its own listing <ExternalLink className="inline size-3" aria-hidden="true" />
                </a>
                {body.sourceCheckedOn ? `, checked ${body.sourceCheckedOn}` : ""}.
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* THE CLUBS. */}
        <section aria-labelledby="gb-clubs" className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <h2 id="gb-clubs" className="flex items-center gap-2 font-display text-base text-ink">
            <Users className="size-4 text-ink-muted" aria-hidden="true" />
            Affiliated Clubs
          </h2>
          {clubs.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              No clubs are recorded as affiliated to this organisation yet. Affiliation is held on the club&apos;s
              own Club Directory record.
            </p>
          ) : (
            <>
              <p className="mt-1 mb-3 text-sm text-ink-muted">
                {clubs.length} {clubs.length === 1 ? "club is" : "clubs are"} affiliated.
              </p>
              <ul className="flex flex-col gap-1.5">
                {clubs.slice(0, 12).map((c) => (
                  <li key={c.directoryId} className="flex items-baseline gap-2 text-sm text-ink">
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {c.isOnOvalball && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-muted">
                        <CheckCircle2 className="size-3" aria-hidden="true" /> on Ovalball
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {clubs.length > 12 && (
                <p className="mt-2 text-xs text-ink-muted">and {clubs.length - 12} more</p>
              )}
            </>
          )}
        </section>

        {/* WHAT IT RUNS. */}
        <section aria-labelledby="gb-competitions" className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
          <h2 id="gb-competitions" className="flex items-center gap-2 font-display text-base text-ink">
            <Trophy className="size-4 text-ink-muted" aria-hidden="true" />
            Competitions
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            {body.competitionCount === 0
              ? "This organisation does not yet organise any competitions on Ovalball."
              : `${body.competitionCount} ${body.competitionCount === 1 ? "competition is" : "competitions are"} organised by this organisation.`}
          </p>
          {body.canManageCompetitions && (
            <p className="mt-2 text-sm text-ink-muted">
              Competitions are created in{" "}
              <Link href="/fixtures/competitions" className="underline hover:no-underline">
                Competitions
              </Link>
              , using the same architecture a club organiser uses.
            </p>
          )}
        </section>
      </div>

      {/* HONEST ABOUT WHAT IS NOT HERE YET. */}
      <section aria-labelledby="gb-next" className="rounded-2xl border border-dashed border-line px-4 py-3">
        <h2 id="gb-next" className="text-sm font-medium text-ink">
          Coming next
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          This is the foundation: the organisation, its clubs, its competitions and your access. People and
          access management, results and regulation for the organisation are the next pieces, and are not
          built yet.
        </p>
      </section>
    </div>
  )
}
