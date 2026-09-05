import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"
import { ChevronLeft } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { canManageClubFixturesAnywhere, getSessionContext, isClubAdminAnywhere } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"
import { compactTeamLabel, fullTeamLabel } from "@/lib/teams/compact-label"
import { formatGenderLabel } from "@/lib/teams/labels"

import { TeamIdentitySection } from "./team-identity-section"
import { TeamLifecycleSection, type RestorableFixtureRow } from "./team-lifecycle-section"
import { TeamPeople, type ClubMemberOption, type TeamMemberRow } from "./team-people"

export default async function TeamDetailPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  if (!ctx.isSiteAdmin && !canManageClubFixturesAnywhere(ctx)) redirect("/dashboard")

  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)

  const { data: team } = await supabase
    .from("teams")
    .select("id, club_id, display_name, category, age_group, squad_designation, gender, active, folded_at, fold_reason")
    .eq("id", teamId)
    .maybeSingle()

  if (!team) notFound()

  const { data: aliasRow } = await supabase.from("team_aliases").select("alias").eq("team_id", teamId).maybeSingle()

  // Scoped to the ACTIVE context's own club, not "does this session hold
  // club-wide fixture authority ANYWHERE" -- the old canManageClubFixturesAnywhere(ctx)
  // + session-wide clubMemberships check meant a multi-role account
  // switched into Parent View (or any unrelated team's context) could
  // still browse and, via canManage below, edit a completely different
  // team's record merely because it also happens to be Club Admin
  // somewhere. See app/(app)/people/page.tsx for the identical leak class
  // found and fixed earlier in this pass.
  const activeClub = activeClubId(ctx, activeContext)
  if (!ctx.isSiteAdmin && activeClub !== team.club_id) redirect("/teams")

  const canManage = ctx.isSiteAdmin || activeManageableClubId(ctx, activeContext) === team.club_id

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

  let restorableFixtures: RestorableFixtureRow[] = []
  if (canManage && team.active) {
    const { data: restorable } = await supabase.rpc("list_restorable_fixtures", { p_team_id: teamId })
    restorableFixtures = (restorable ?? []).map((f) => ({
      id: f.id,
      kickoffDate: f.kickoff_date,
      raw: f.raw_opposition_text,
      homeAway: f.home_away as "Home" | "Away",
    }))
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/teams" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/55 hover:text-ink">
        <ChevronLeft className="size-4" />
        Teams
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Team</p>
        {!team.active && (
          <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-medium text-ink/50">Folded</span>
        )}
      </div>
      <h1 className="mt-2 font-display text-display-l text-ink">{team.display_name}</h1>

      <div className="mt-8">
        {canManage ? (
          <>
            <p className="mb-3 text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Team settings</p>
            <TeamIdentitySection
              team={{
                id: team.id,
                fullLabel: fullTeamLabel({ category: team.category, ageGroup: team.age_group, gender: team.gender, squadDesignation: team.squad_designation, alias: aliasRow?.alias ?? null }),
                compactLabel: compactTeamLabel({ category: team.category, ageGroup: team.age_group, gender: team.gender, squadDesignation: team.squad_designation, alias: aliasRow?.alias ?? null }),
                squadDesignation: team.squad_designation,
                active: team.active,
                alias: aliasRow?.alias ?? null,
              }}
            />
          </>
        ) : (
          <div className="rounded-lg border border-ink/10 bg-white p-6">
            <p className="text-sm text-ink/60">
              {[
                fullTeamLabel({ category: team.category, ageGroup: team.age_group, gender: team.gender, squadDesignation: team.squad_designation, alias: aliasRow?.alias ?? null }),
                formatGenderLabel(team.gender),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        )}
      </div>

      <TeamPeople teamId={team.id} members={members} clubMembers={clubMembers} canManage={canManage} />

      {canManage && (
        <TeamLifecycleSection
          team={{
            teamId: team.id,
            displayName: team.display_name,
            active: team.active,
            foldedAt: team.folded_at,
            foldReason: team.fold_reason,
            restorableFixtures,
          }}
        />
      )}

      {!isClubAdminAnywhere(ctx) && !ctx.isSiteAdmin && (
        <p className="mt-6 text-xs text-ink/40">Only this club&apos;s Club Admin can edit team details or assign people.</p>
      )}
    </div>
  )
}
