import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { getSessionContext } from "@/lib/app-context/session-context"
import { plannerClubCandidates } from "@/lib/fixtures/fixture-team-authority"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

import { MassFixturePlanner } from "./mass-planner"
import { resolvePlannerScope } from "./planner-scope"

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
 * Everything this page needs to OFFER -- the teams this person may plan for,
 * the club's real venues and pitches, the competitions it actually plays in --
 * is read here, server side, from canonical records. The grid never invents an
 * option, and a value typed, pasted or filled into it is matched against these
 * same records on the server before it becomes a fixture.
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

  const { club: requestedClubId } = await searchParams

  // CLUB ADMINISTRATION, NOT TEAM STAFF.
  //
  // The Season Planner is bulk fixture planning, which belongs to club-scope
  // fixture administrators and Site Admins. A club context plans its club;
  // anybody else names a club (the chooser, or a Site Admin) and is put through
  // the same bulk authority check the staging tables enforce. A Coach, Team
  // Manager or Team Admin creates single fixtures through Request a Fixture.
  const scope = await resolvePlannerScope(requestedClubId)

  if (!scope) {
    const ctx = await getSessionContext(supabase, user)
    const choices = ctx.isSiteAdmin ? await activeClubChoices(supabase) : plannerClubCandidates(ctx)
    // NOTHING TO CHOOSE IS NOT A CHOICE.
    //
    // The chooser exists for somebody who may plan for several clubs and
    // has not said which. Showing it to a guardian or a player -- who may
    // plan for none -- put a page headed "Mass Fixture Planner" in front of
    // somebody who will never use one. They go where they went before. A
    // club that was named and refused is not offered again as a choice.
    const offered = choices.filter((c) => c.id !== requestedClubId)
    if (requestedClubId || offered.length === 0) redirect("/fixtures")
    if (offered.length === 1) redirect(`/fixtures/planner?club=${offered[0].id}`)
    return <PlannerClubChooser choices={offered} />
  }

  const { universe } = scope
  const clubId = universe.clubId
  // The active club context plans its own club. A different club named in the
  // address is not what is shown, so the address should not say it is.
  if (requestedClubId && requestedClubId !== clubId) redirect("/fixtures/planner")
  // Not a gate on reaching the page -- a person who may create one fixture
  // may plan one here. It decides whether the page offers mass creation at
  // all, so the limit is stated up front rather than discovered on submit.
  const canCreateMany = await hasCapability(supabase, "fixture.import", "club", { clubId })

  const { data: clubRow } = await supabase.from("clubs").select("club_directory(name, rugby_code)").eq("id", clubId).maybeSingle()
  const rugbyCode = clubRow?.club_directory?.rugby_code ?? null

  const [{ data: venueRows }, { data: pitchRows }, { data: editionRows }] = await Promise.all([
    supabase.from("venues").select("id, name, is_default_home").eq("club_id", clubId).eq("active", true).order("name"),
    supabase
      .from("club_pitches")
      .select("id, display_name, venue_id")
      .eq("club_id", clubId)
      .eq("active", true)
      .order("sort_order"),
    // Union and League are isolated in the query: a club is offered its own code's competitions only.
    rugbyCode
      ? supabase
          .from("competition_editions")
          .select("id, competitions(name), seasons(name)")
          .eq("active", true)
          .eq("rugby_code", rugbyCode)
          .limit(200)
      : Promise.resolve({ data: [] as { id: string; competitions: { name: string } | null; seasons: { name: string } | null }[] }),
  ])

  // Our primary ground, for a Home row's suggested venue: the default ground,
  // or the only one; its pitch only when it has exactly one.
  const activeVenues = venueRows ?? []
  const primary = activeVenues.filter((v) => v.is_default_home).length === 1 ? activeVenues.find((v) => v.is_default_home) : activeVenues.length === 1 ? activeVenues[0] : undefined
  const primaryPitches = primary ? (pitchRows ?? []).filter((p) => p.venue_id === primary.id) : []
  const ourGround = primary ? { venue: primary.name, pitch: primaryPitches.length === 1 ? primaryPitches[0].display_name : null } : null

  return (
    <div className="w-full px-3 py-3 md:px-4 md:py-4">
      <MassFixturePlanner
        clubId={clubId}
        clubName={clubRow?.club_directory?.name ?? "your club"}
        canCreateMany={canCreateMany}
        teams={universe.teams}
        venues={(venueRows ?? []).map((v) => ({ id: v.id, name: v.name }))}
        ourGround={ourGround}
        pitches={(pitchRows ?? []).map((p) => ({ id: p.id, name: p.display_name, venueId: p.venue_id }))}
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
 * A Site Admin may plan for any activated club, because the capability engine
 * already grants them that authority everywhere. The universe check on the
 * chosen club is still what decides.
 */
async function activeClubChoices(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("clubs").select("id, club_directory(name)").eq("status", "active").limit(300)
  return (data ?? [])
    .map((c) => ({ id: c.id, name: c.club_directory?.name ?? "Unnamed club" }))
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
