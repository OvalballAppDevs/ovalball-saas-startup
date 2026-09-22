import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { PageIdentity } from "@/components/shell/page-identity"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

import { TeamPeople, type ClubMemberOption, type TeamPersonRow } from "../team-people"

export const metadata = { title: "People" }

/**
 * THE TEAM'S PEOPLE, AS A DESTINATION.
 *
 * Who is in this team is recurring work -- a manager looks at it most weeks -- and it used to be a
 * section part-way down an administration page reached through a navigation group called "Team",
 * inside a context that was already that team. Three steps to answer "who are my players".
 *
 * ONE ROSTER, FROM ONE READER. `public.team_people` resolves coaches, parents/guardians, players and
 * pending requests with one definition of what "active" means for each. This page does not assemble
 * its own: the team administration page renders the same component from the same RPC, and a second
 * assembly here would be a second answer to a question that has one.
 *
 * AUTHORITY IS THE SERVER'S. RLS decides which rows come back and the capability engine decides
 * whether the controls inside do anything; this page renders what it is given.
 */
export default async function TeamPeoplePage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: team } = await supabase
    .from("teams")
    .select("id, club_id, display_name")
    .eq("id", teamId)
    .maybeSingle()
  if (!team) notFound()

  const canManage =
    (await hasCapability(supabase, "club.roster.manage", "team", { clubId: team.club_id, teamId: team.id })) ||
    (await hasCapability(supabase, "club.roster.manage", "club", { clubId: team.club_id }))
  const canAssignTeamAdmin = await hasCapability(supabase, "people.role.assign_club", "club", {
    clubId: team.club_id,
  })

  const [{ data: peopleRows }, { data: memberships }] = await Promise.all([
    supabase.rpc("team_people", { p_team_id: teamId }),
    supabase.from("club_memberships").select("id, user_id").eq("club_id", team.club_id).eq("status", "active"),
  ])

  const { data: profiles } = await supabase.rpc("get_club_member_directory", { p_club_id: team.club_id })
  const profileById = new Map((profiles ?? []).map((p) => [p.user_id, p]))
  const membershipIdByUserId = new Map((memberships ?? []).map((m) => [m.user_id, m.id]))

  const people: TeamPersonRow[] = (peopleRows ?? []).map((r) => ({
    kind: r.kind as TeamPersonRow["kind"],
    rowId: r.row_id!,
    personId: r.kind === "coach" ? (membershipIdByUserId.get(r.person_id!) ?? null) : r.person_id,
    name: r.name ?? "Unknown",
    detail: r.detail,
    status: r.status as TeamPersonRow["status"],
    requestedAt: r.requested_at,
  }))

  const clubMembers: ClubMemberOption[] = (memberships ?? [])
    .map((m) => {
      const p = profileById.get(m.user_id)
      return { membershipId: m.id, name: [p?.first_name, p?.surname].filter(Boolean).join(" ") || "Unknown" }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <Link
        href="/dashboard"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-forest-800 hover:text-forest-950"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {team.display_name}
      </Link>

      <PageIdentity workspace="Team" title="People" className="mt-2" />
      <p className="mt-2 text-sm text-ink-muted">
        Everyone connected to {team.display_name} — players, their parents and guardians, and the
        coaches and managers who run it.
      </p>

      <TeamPeople
        teamId={team.id}
        people={people}
        clubMembers={clubMembers}
        canManage={canManage}
        canAssignTeamAdmin={canAssignTeamAdmin}
      />
    </div>
  )
}
