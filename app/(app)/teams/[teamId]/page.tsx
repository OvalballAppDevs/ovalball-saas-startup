import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { canManageClubFixturesAnywhere, getSessionContext, isClubAdminAnywhere } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { TeamEditForm } from "./team-edit-form"
import { TeamPeople, type ClubMemberOption, type TeamMemberRow } from "./team-people"

export default async function TeamDetailPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  if (!canManageClubFixturesAnywhere(ctx)) redirect("/dashboard")

  const { data: team } = await supabase
    .from("teams")
    .select("id, club_id, display_name, category, age_group, squad_designation, gender, active")
    .eq("id", teamId)
    .maybeSingle()

  if (!team) notFound()

  const myClubIds = new Set(ctx.clubMemberships.map((m) => m.clubId))
  if (!ctx.isSiteAdmin && !myClubIds.has(team.club_id)) redirect("/teams")

  const canManage = ctx.isSiteAdmin || ctx.clubMemberships.some((m) => m.clubId === team.club_id && m.role === "CLUB_ADMIN")

  const [{ data: teamPerms }, { data: memberships }] = await Promise.all([
    supabase.from("team_permissions").select("id, membership_id, permission").eq("team_id", teamId),
    supabase.from("club_memberships").select("id, user_id").eq("club_id", team.club_id).eq("status", "active"),
  ])

  const { data: profiles } = await supabase.rpc("get_club_member_directory", { p_club_id: team.club_id })
  const profileById = new Map((profiles ?? []).map((p) => [p.user_id, p]))
  const nameByMembershipId = new Map(
    (memberships ?? []).map((m) => {
      const p = profileById.get(m.user_id)
      return [m.id, [p?.first_name, p?.surname].filter(Boolean).join(" ") || "Unknown"]
    })
  )

  const members: TeamMemberRow[] = (teamPerms ?? []).map((tp) => ({
    teamPermissionId: tp.id,
    membershipId: tp.membership_id,
    name: nameByMembershipId.get(tp.membership_id) ?? "Unknown",
    permission: tp.permission as TeamMemberRow["permission"],
  }))

  const clubMembers: ClubMemberOption[] = (memberships ?? [])
    .map((m) => ({ membershipId: m.id, name: nameByMembershipId.get(m.id) ?? "Unknown" }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/teams" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        Teams
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Team</p>
        {!team.active && (
          <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-medium text-ink/50">Archived</span>
        )}
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">{team.display_name}</h1>

      <div className="mt-8">
        {canManage ? (
          <TeamEditForm
            team={{
              id: team.id,
              displayName: team.display_name,
              category: team.category as "senior" | "youth",
              ageGroup: team.age_group,
              squadDesignation: team.squad_designation,
              gender: team.gender as "mens" | "womens" | "mixed" | null,
              active: team.active,
            }}
          />
        ) : (
          <div className="rounded-lg border border-ink/10 bg-white p-6">
            <p className="text-sm text-ink/60">
              {[
                `${team.category === "youth" ? team.age_group : "Senior"}${team.squad_designation ? ` ${team.squad_designation}` : ""}`,
                team.gender,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        )}
      </div>

      <TeamPeople teamId={team.id} members={members} clubMembers={clubMembers} canManage={canManage} />

      {!isClubAdminAnywhere(ctx) && !ctx.isSiteAdmin && (
        <p className="mt-6 text-xs text-ink/40">Only this club&apos;s Club Admin can edit team details or assign people.</p>
      )}
    </div>
  )
}
