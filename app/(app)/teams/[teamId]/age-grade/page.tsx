import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { readDispensationOptions } from "@ovalball/contracts/team/dispensation"
import { TEAM_ACTIONABLE_AGE_GRADE_STATUSES } from "@ovalball/contracts/team/overview"

import { RequestDispensationForm } from "@/components/dispensations/request-dispensation-form"
import { PageIdentity } from "@/components/shell/page-identity"
import { hasCapability } from "@/lib/permissions/has-capability"
import { AGE_GRADE_STATUS_LABEL, loadTeamAgeGradeAttention } from "@/lib/teams/age-grade"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Age Grade" }

/**
 * `/teams/<id>/age-grade` -- where "a player's age grade needs your action" lands, on both clients.
 *
 * The list is `team_age_grade_attention`, the server's answer per player. The team's move is to ask for a
 * dispensation (`request_dispensation`, with a reason); the club's Safeguarding Officer or a Club Admin
 * decides it -- never the team (20270742000000). Once asked, the row reads "Dispensation pending", opens the
 * request, and leaves the team's Action Required on its own.
 */
export default async function TeamAgeGradePage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: team } = await supabase.from("teams").select("id, club_id, display_name").eq("id", teamId).maybeSingle()
  if (!team) notFound()

  const mayView =
    (await hasCapability(supabase, "team.roster.view", "team", { clubId: team.club_id, teamId: team.id })) ||
    (await hasCapability(supabase, "team.roster.view", "club", { clubId: team.club_id }))
  if (!mayView) redirect(`/teams/${team.id}`)
  const mayRequest =
    (await hasCapability(supabase, "fixture.dispensation.request", "team", { clubId: team.club_id, teamId: team.id })) ||
    (await hasCapability(supabase, "fixture.dispensation.request", "club", { clubId: team.club_id }))

  const rows = await loadTeamAgeGradeAttention(supabase, team.id)
  const yours = rows.filter((r) => TEAM_ACTIONABLE_AGE_GRADE_STATUSES.has(r.status))
  const withClub = rows.filter((r) => !TEAM_ACTIONABLE_AGE_GRADE_STATUSES.has(r.status))
  // The request each waiting row is about, so the row opens it. Only what this person may read comes back.
  const contract = supabase as unknown as Parameters<typeof readDispensationOptions>[0]
  const live = new Map(
    await Promise.all(
      withClub
        .filter((r) => r.status === "DISPENSATION_PENDING" || r.status === "DISPENSATION_APPROVED")
        .map(async (r) => [r.playerId, (await readDispensationOptions(contract, r.playerId, team.id).catch(() => null))?.live?.id ?? null] as const)
    )
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <Link href={`/teams/${team.id}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-forest-800 hover:text-forest-950">
        <ChevronLeft aria-hidden="true" className="size-4" />
        {team.display_name}
      </Link>
      <PageIdentity workspace="Team" title="Age Grade" className="mt-2" />
      <p className="mt-2 text-sm text-ink-muted">
        Age grade comes from each player&apos;s recorded date of birth and the season, and is never inferred from the team.
      </p>

      {rows.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface px-4 py-6">
          <p className="text-sm font-medium text-ink">Every player is in their age grade</p>
        </div>
      )}

      {yours.length > 0 && (
        <section className="mt-8" aria-labelledby="age-grade-yours">
          <h2 id="age-grade-yours" className="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
            Needs Your Action
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {yours.map((row) => (
              <li key={row.playerId} className="rounded-2xl border border-line bg-surface p-4">
                <p className="font-medium text-ink">
                  {row.displayName} <span className="font-normal text-ink-muted">· {AGE_GRADE_STATUS_LABEL[row.status]}</span>
                </p>
                <p className="mt-1 text-sm text-ink-muted">{row.detail}</p>
                {row.status === "OUTSIDE_AGE_GRADE" && mayRequest && (
                  <RequestDispensationForm playerId={row.playerId} playerName={row.displayName} teamId={team.id} teamLabel={team.display_name} compact />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {withClub.length > 0 && (
        <section className="mt-8" aria-labelledby="age-grade-club">
          <h2 id="age-grade-club" className="text-xs font-semibold tracking-[0.08em] text-ink-muted uppercase">
            With the Club
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {withClub.map((row) => (
              <li key={row.playerId} className="rounded-2xl border border-line bg-surface p-4">
                <p className="font-medium text-ink">
                  {row.displayName} <span className="font-normal text-ink-muted">· {AGE_GRADE_STATUS_LABEL[row.status]}</span>
                </p>
                <p className="mt-1 text-sm text-ink-muted">{row.detail}</p>
                {live.get(row.playerId) && (
                  <Link href={`/dispensations/${live.get(row.playerId)}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-forest-800 underline-offset-2 hover:underline">
                    Open Request
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
