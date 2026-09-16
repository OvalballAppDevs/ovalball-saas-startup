import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"
import { ChevronLeft, ChevronRight, Newspaper } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext, isClubAdminAnywhere } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"
import { compactTeamLabel, fullTeamLabel } from "@/lib/teams/compact-label"
import { formatGenderLabel } from "@/lib/teams/labels"

import { TeamIdentitySection } from "./team-identity-section"
import { TeamLifecycleSection, type RestorableFixtureRow } from "./team-lifecycle-section"
import { TeamPeople, type ClubMemberOption, type TeamPersonRow } from "./team-people"

export default async function TeamDetailPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)

  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)

  const { data: team } = await supabase
    .from("teams")
    .select("id, club_id, display_name, rugby_code, category, age_group, squad_designation, gender, active, folded_at, fold_reason")
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

  // Entry is now a capability on THIS team, not a club-wide role held
  // somewhere. A coach assigned to this side sees its people; that is the
  // whole point of the roster. The active-context check stays, so a
  // multi-role account switched into an unrelated club still cannot browse
  // this team -- see app/(app)/people/page.tsx for that leak class.
  const canView =
    ctx.siteCapabilities.includes("site.clubs.view") ||
    (activeClub === team.club_id &&
      (await hasCapability(supabase, "team.team.view", "team", { clubId: team.club_id, teamId: team.id })))
  if (!canView) redirect("/teams")

  const canManage = ctx.isSiteAdmin || activeManageableClubId(ctx, activeContext) === team.club_id

  // Deliberately NOT the same flag as canManage. Team settings and folding are
  // club-wide decisions; keeping a team's own roster straight is the team's,
  // and this asks the exact question internal.team_people_authority asks, so
  // the buttons on screen and the writes behind them can never disagree.
  // Team Admin itself is club authority (a Club Admin, or Ovalball's site.team_roles.manage); Team
  // Administration holders assign Coach and Team Manager only. The database refuses the rest regardless.
  const canAssignTeamAdmin =
    ctx.siteCapabilities.includes("site.team_roles.manage") ||
    (await hasCapability(supabase, "people.role.assign_club", "club", { clubId: team.club_id }))

  // The controls behind this flag are ROSTER controls (Archive, Restore, Approve, Decline), and the writes
  // behind them are refused by internal.team_people_authority, which asks team.roster.manage at the team's
  // scope or inherited from the club. So this asks exactly that, at both scopes, and the buttons on screen
  // cannot disagree with the writes behind them. team.team.manage is the wrong question here: it is team
  // settings (Club Admin and Team Administration), and it would hide the roster from a Team Manager who is
  // allowed to change it, while also not inheriting to a Club Admin who holds it club-wide.
  const canManagePeople =
    ctx.siteCapabilities.includes("site.team_roles.manage") ||
    (await hasCapability(supabase, "team.roster.manage", "team", { clubId: team.club_id, teamId: team.id })) ||
    (await hasCapability(supabase, "team.roster.manage", "club", { clubId: team.club_id }))

  // Team news: the same capability pair the database's publishing adapter
  // resolves (club.news.manage, or team.news.manage for this team). This
  // only decides whether to show the entry point.
  const canPublishTeamNews =
    (await hasCapability(supabase, "club.news.manage", "club", { clubId: team.club_id })) ||
    (await hasCapability(supabase, "team.news.manage", "team", { clubId: team.club_id, teamId: team.id }))

  // The roster comes from public.team_people, which resolves coaches,
  // parents/guardians and players in one place with one definition of what
  // "active" means for each. Assembling it here would make this page a second
  // answer to a question a coach's own view has to answer identically.
  const [{ data: peopleRows }, { data: memberships }] = await Promise.all([
    supabase.rpc("team_people", { p_team_id: teamId }),
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
  const membershipIdByUserId = new Map((memberships ?? []).map((m) => [m.user_id, m.id]))

  const people: TeamPersonRow[] = (peopleRows ?? []).map((r) => ({
    kind: r.kind as TeamPersonRow["kind"],
    rowId: r.row_id!,
    // A coach row is addressed by their club membership when assigning, which
    // is what the picker below deals in.
    personId: r.kind === "coach" ? (membershipIdByUserId.get(r.person_id!) ?? null) : r.person_id,
    name: r.name ?? "Unknown",
    detail: r.detail,
    status: r.status as TeamPersonRow["status"],
    requestedAt: r.requested_at,
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
      <Link href="/teams" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronLeft className="size-4" />
        Teams
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Team</p>
        {!team.active && (
          <span className="rounded-full bg-ink/10 px-2.5 py-0.5 text-xs font-medium text-ink-muted">Folded</span>
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
                fullLabel: fullTeamLabel({ category: team.category, ageGroup: team.age_group, gender: team.gender, squadDesignation: team.squad_designation, rugbyCode: team.rugby_code, alias: aliasRow?.alias ?? null }),
                compactLabel: compactTeamLabel({ category: team.category, ageGroup: team.age_group, gender: team.gender, squadDesignation: team.squad_designation, rugbyCode: team.rugby_code, alias: aliasRow?.alias ?? null }),
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
                fullTeamLabel({ category: team.category, ageGroup: team.age_group, gender: team.gender, squadDesignation: team.squad_designation, rugbyCode: team.rugby_code, alias: aliasRow?.alias ?? null }),
                formatGenderLabel(team.gender),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        )}
      </div>

      <TeamPeople
        teamId={team.id}
        people={people}
        clubMembers={clubMembers}
        canManage={canManagePeople}
        canAssignTeamAdmin={canAssignTeamAdmin}
      />

      {canPublishTeamNews && team.active && (
        <Link
          href={`/teams/${team.id}/news`}
          className="mt-8 flex items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5 outline-none transition-colors hover:border-ink/20 focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          <Newspaper aria-hidden="true" className="size-5 shrink-0 text-forest-800" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink">Team News</span>
            <span className="block text-xs text-ink-muted">Publish match reports, updates and notices on the club&apos;s public page.</span>
          </span>
          <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        </Link>
      )}

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
        <p className="mt-6 text-xs text-ink-muted">Only this club&apos;s Club Admin can edit team details or assign people.</p>
      )}
    </div>
  )
}
