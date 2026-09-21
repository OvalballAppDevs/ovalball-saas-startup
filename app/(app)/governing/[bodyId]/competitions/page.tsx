import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, Eye, Trophy } from "lucide-react"

import { GoverningEmpty, GoverningPageHeader, GoverningSection } from "@/components/governing/workspace"
import { competitionProgress, loadBodyCompetitions, loadGoverningBody } from "@/lib/governing/body"
import { createClient } from "@/lib/supabase/server"

import { StartCompetition } from "./start-competition"

export const metadata = { title: "Competitions" }

/**
 * CONVERGENCE STEP 15 — THE COMPETITIONS THIS ORGANISATION RUNS.
 *
 * THE POINT OF THIS PAGE IS THAT IT IS NOT A COMPETITION PRODUCT. Ovalball already has one —
 * Competition → Participants → Competition Matches → optional Fixtures, with the Competition Creator
 * over it — and a governing body is one more kind of organiser beside the club, never a second engine.
 * So this page lists, states honestly where each competition has got to, and hands over.
 *
 * `canOrganise` PER ROW COMES FROM THE DATABASE — `internal.can_organise_competition`, the same
 * predicate the ten competition mutations reach through `internal.require_edition_organiser`. So a
 * Viewer here is told the truth rather than shown a control that will refuse them, and the page cannot
 * drift away from what is actually allowed.
 */
export default async function GoverningBodyCompetitionsPage({ params }: { params: Promise<{ bodyId: string }> }) {
  const { bodyId } = await params
  const supabase = await createClient()
  const body = await loadGoverningBody(supabase, bodyId)
  if (!body) notFound()
  const competitions = await loadBodyCompetitions(supabase, bodyId)

  const active = competitions.filter((c) => c.active)
  const closed = competitions.filter((c) => !c.active)

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <GoverningPageHeader
        body={body}
        title="Competitions"
        description="The leagues and cups this organisation runs, built with the same competition tools a club organiser uses."
        action={body.canManageCompetitions ? <StartCompetition bodyId={bodyId} rugbyCode={body.rugbyCode} /> : undefined}
      />

      <GoverningSection
        id="gb-comp-active"
        title="Running Now"
        icon={<Trophy className="size-4 text-ink-muted" aria-hidden="true" />}
        count={active.length > 0 ? `${active.length}` : undefined}
      >
        {active.length === 0 ? (
          <GoverningEmpty>
            {body.canManageCompetitions
              ? "This organisation runs no competitions on Ovalball yet. Start one and you will choose the format, enter the teams and draw the matches."
              : "This organisation runs no competitions on Ovalball yet. An administrator or competitions officer here can start one."}
          </GoverningEmpty>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {active.map((c) => (
              <li key={c.competitionId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{c.name}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {c.seasonName ?? "No season registered"}
                    {c.format ? ` · ${FORMAT_WORD[c.format] ?? c.format}` : " · Format not set"}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">{competitionProgress(c)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm">
                  {/* THE PUBLIC PAGE, for checking what everybody else can see. */}
                  <Link
                    href={`/competitions/${c.slug}`}
                    className="inline-flex items-center gap-1 text-ink-muted hover:text-ink hover:underline"
                  >
                    <Eye className="size-3.5" aria-hidden="true" />
                    Public page
                  </Link>
                  {/* AND THE CANONICAL CREATOR, when this person actually organises it. */}
                  {c.canOrganise && c.editionId ? (
                    <Link
                      href={`/fixtures/competitions/${c.editionId}/participants`}
                      className="inline-flex items-center gap-1 font-medium text-forest-800 hover:underline"
                    >
                      Manage
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  ) : !c.editionId ? (
                    <span className="text-xs text-amber-800">No season registered yet</span>
                  ) : (
                    <span className="text-xs text-ink-muted">View only</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </GoverningSection>

      {closed.length > 0 && (
        <GoverningSection id="gb-comp-closed" title="Closed" count={`${closed.length}`}>
          <ul className="flex flex-col gap-1.5">
            {closed.map((c) => (
              <li key={c.competitionId} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink">{c.name}</span>
                <span className="shrink-0 text-xs text-ink-muted">{c.seasonName ?? "No season"}</span>
              </li>
            ))}
          </ul>
        </GoverningSection>
      )}

      <section aria-labelledby="gb-comp-scope" className="rounded-2xl border border-dashed border-line px-4 py-3">
        <h2 id="gb-comp-scope" className="text-sm font-medium text-ink">
          What Organising a Competition Covers
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Organising a competition lets this organisation enter teams, draw and issue its matches, and record their
          results. It gives no access to a club&apos;s own fixtures, teams or members — a club still runs its own
          season, and the matches in this competition appear in its calendar because it is taking part.
        </p>
      </section>
    </div>
  )
}

/** The formats, in the words the Creator uses, so one competition reads the same in both places. */
const FORMAT_WORD: Record<string, string> = {
  league: "League",
  knockout: "Knockout",
  league_knockout: "League + Knockout",
}
