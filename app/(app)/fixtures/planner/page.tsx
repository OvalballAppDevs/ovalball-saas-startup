import { redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"
import { ArrowRight } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"
import { fullTeamLabel } from "@/lib/teams/compact-label"

import { MassFixturePlanner } from "./mass-planner"

export const metadata = { title: "Mass Fixture Planner" }

/**
 * THE MASS FIXTURE PLANNER.
 *
 * A fixture secretary arrives holding a season, not a fixture. They have
 * it in a spreadsheet, or in a league PDF they have retyped into one, or
 * in their head. The planner's whole job is to let them put all of it in
 * at once, in the shape they already have it in, and then tell them
 * exactly what Ovalball understood before anything is created.
 *
 * Everything this page needs to OFFER -- the club's real teams, its real
 * venues, the competitions it actually plays in -- is read here, server
 * side, from canonical records. The grid never invents an option, and a
 * value typed or pasted into it is matched against these same records on
 * the server before it becomes a fixture.
 */
export default async function MassFixturePlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ club?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const { club: requestedClubId } = await searchParams

  // A SITE ADMIN PLANS FOR A CLUB, HAVING CHOSEN ONE.
  //
  // The planner is club-scoped by construction: it resolves teams, venues
  // and competitions for one club and hands the engine that club's id. An
  // account whose active context is not a club has simply not said which
  // club it means -- which was previously answered with a silent redirect
  // to /fixtures, so "Plan Fixtures" appeared to do nothing.
  //
  // The fix is to ASK, not to widen anything. The chooser lists only clubs
  // this account may genuinely manage fixtures for; the chosen club is then
  // put through the SAME capability checks as any other route into this
  // page, and every read below is scoped to it. A Site Admin does not
  // become a member of the club and no predicate is relaxed -- they are
  // still a Site Admin, acting under the Site Admin bypass the capability
  // engine already grants, on a club they named.
  const activeClub = activeManageableClubId(ctx, activeContext)
  const clubId = activeClub ?? requestedClubId ?? null

  if (!clubId) {
    const choices = await plannerClubChoices(supabase, ctx)
    // NOTHING TO CHOOSE IS NOT A CHOICE.
    //
    // The chooser exists for somebody who may plan for several clubs and
    // has not said which. Showing it to a guardian or a player -- who may
    // plan for none -- put a page headed "Mass Fixture Planner" in front of
    // somebody who will never use one, which is worse than the redirect it
    // replaced even though it offers them nothing. They go where they went
    // before.
    if (choices.length === 0) redirect("/fixtures")
    if (choices.length === 1) redirect(`/fixtures/planner?club=${choices[0].id}`)
    return <PlannerClubChooser choices={choices} />
  }

  // The capability check is the boundary, and it runs for the named club
  // whether that club came from the active context or from the chooser.
  if (!(await hasCapability(supabase, "fixture.create", "club", { clubId }))) redirect("/fixtures")
  // Not a gate on reaching the page -- a person who may create one fixture
  // may plan one here. It decides whether the page offers mass creation at
  // all, so the limit is stated up front rather than discovered on submit.
  const canCreateMany = await hasCapability(supabase, "fixture.import", "club", { clubId })

  const [{ data: teamRows }, { data: venueRows }, { data: editionRows }, { data: clubRow }] = await Promise.all([
    supabase
      .from("teams")
      .select("id, rugby_code, category, age_group, gender, squad_designation")
      .eq("club_id", clubId)
      .eq("active", true)
      .order("category")
      .order("age_group"),
    supabase.from("venues").select("name").eq("club_id", clubId).eq("active", true).order("name"),
    supabase
      .from("competition_editions")
      .select("id, competitions(name), seasons(name)")
      .eq("active", true)
      .limit(200),
    supabase.from("clubs").select("club_directory(name)").eq("id", clubId).maybeSingle(),
  ])

  const teamOptions = (teamRows ?? []).map((t) =>
    fullTeamLabel({
      category: t.category,
      ageGroup: t.age_group,
      gender: t.gender,
      squadDesignation: t.squad_designation,
      rugbyCode: t.rugby_code,
    }),
  )

  return (
    <div className="w-full px-3 py-3 md:px-4 md:py-4">
      <MassFixturePlanner
        clubId={clubId}
        clubName={clubRow?.club_directory?.name ?? "your club"}
        canCreateMany={canCreateMany}
        teamOptions={teamOptions}
        venueOptions={(venueRows ?? []).map((v) => v.name)}
        competitionOptions={[
          ...new Set(
            (editionRows ?? [])
              .map((e) => e.competitions?.name)
              .filter((n): n is string => Boolean(n)),
          ),
        ].sort()}
      />
    </div>
  )
}

/**
 * The clubs this account may genuinely plan fixtures for.
 *
 * Two sources, deliberately not merged into one query: a Site Admin may
 * plan for any activated club, because the capability engine already
 * grants them that authority everywhere; anyone else may plan only where
 * they hold club-wide fixture authority through their own membership.
 * Neither branch invents access -- the hasCapability check on the chosen
 * club is what actually decides, and this list only determines what is
 * worth offering.
 */
async function plannerClubChoices(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ctx: Awaited<ReturnType<typeof getSessionContext>>,
): Promise<{ id: string; name: string }[]> {
  if (ctx.isSiteAdmin) {
    const { data } = await supabase
      .from("clubs")
      .select("id, club_directory(name)")
      .eq("status", "active")
      .limit(300)
    return (data ?? [])
      .map((c) => ({ id: c.id, name: c.club_directory?.name ?? "Unnamed club" }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  return ctx.clubMemberships
    .filter((m) => m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY")
    .map((m) => ({ id: m.clubId, name: m.clubName ?? "Your club" }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * WHICH CLUB'S SEASON ARE YOU PLANNING?
 *
 * Deliberately the smallest possible surface: one question, the answer,
 * and nothing else. It exists because a season belongs to a club, not
 * because Site Admin needs a dashboard.
 */
function PlannerClubChooser({ choices }: { choices: { id: string; name: string }[] }) {
  // No empty branch: the page redirects before constructing this when
  // there is nothing to choose between, so a chooser always has choices.
  return (
    <div className="mx-auto max-w-lg px-4 py-12 md:px-8">
      <h1 className="font-display text-display-l text-ink">Mass Fixture Planner</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Which club&rsquo;s season are you planning? The planner matches every row against that club&rsquo;s own teams,
        venues and competitions.
      </p>

      <ul className="mt-5 flex flex-col gap-1.5">
        {choices.map((club) => (
          <li key={club.id}>
            <Link
              href={`/fixtures/planner?club=${club.id}`}
              className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-ink/12 bg-white px-4 text-sm font-medium text-ink outline-none hover:border-ink/25 focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              {club.name}
              <ArrowRight className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
