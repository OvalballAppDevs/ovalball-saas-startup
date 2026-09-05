import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext, isClubAdminAnywhere } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"
import { teamPermissionLabel } from "@/lib/permissions/role-labels"

import { InviteForm } from "./invite-form"
import { PendingInvitationRow } from "./pending-invitation-row"
import { PersonRow, type PersonRowData } from "./person-row"

/**
 * "Club Admin" is a strict superset of "Fixture Secretary" authority
 * everywhere it's checked (can_manage_club_fixtures's own definition ORs in
 * is_club_admin) -- club_memberships.role is deliberately a single value,
 * not a set, because there is no functional gap a person would need both
 * roles simultaneously to close. A club-wide role and any number of
 * team-scoped roles are the two independent axes this page models; two
 * *club-wide* roles at once was never a real distinction the schema drops.
 */
export default async function PeoplePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  if (!isClubAdminAnywhere(ctx)) redirect("/dashboard")

  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // People management is Club Admin-only authority (people.manage isn't in
  // Fixtures Admin's capability set) -- resolve the active context's own
  // club only if the session actually holds CLUB_ADMIN there, so switching
  // to a team context or a club where this session is merely Fixture
  // Secretary never silently falls back to managing a DIFFERENT club's
  // people instead.
  const activeClub = activeManageableClubId(ctx, activeContext)
  const activeClubAdminMembership = activeClub ? ctx.clubMemberships.find((m) => m.clubId === activeClub && m.role === "CLUB_ADMIN") : undefined
  // No `?? ctx.clubMemberships.find(...)` fallback here on purpose: a
  // session that genuinely holds CLUB_ADMIN somewhere but whose ACTIVE
  // context isn't that club's Club Admin view (e.g. Parent View on a team
  // in the same club) must never fall through to managing people for
  // whichever club-admin membership happens to exist first -- that was a
  // real, live-confirmed leak (Parent View could see/edit/remove every
  // Burnley member). Redirect instead, matching fixtures/page.tsx's
  // activeContext.kind === "club" gate.
  if (!activeClubAdminMembership) redirect("/dashboard")
  const clubId = activeClubAdminMembership.clubId
  const clubName = activeClubAdminMembership.clubName

  const [{ data: memberships }, { data: teams }, { data: invitations }] = await Promise.all([
    supabase.from("club_memberships").select("id, user_id, role").eq("club_id", clubId).eq("status", "active"),
    supabase.from("teams").select("id, display_name").eq("club_id", clubId).eq("active", true),
    supabase
      .from("invitations")
      .select("id, invited_email, club_role, declared_role, created_at")
      .eq("club_id", clubId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ])

  const membershipIds = (memberships ?? []).map((m) => m.id)
  const { data: teamPerms } =
    membershipIds.length > 0
      ? await supabase.from("team_permissions").select("membership_id, permission, teams(display_name)").in("membership_id", membershipIds)
      : { data: [] }

  const { data: profiles } = await supabase.rpc("get_club_member_directory", { p_club_id: clubId })
  const profileById = new Map((profiles ?? []).map((p) => [p.user_id, p]))

  const teamRolesByMembership = new Map<string, { teamName: string; permission: string }[]>()
  for (const tp of teamPerms ?? []) {
    const list = teamRolesByMembership.get(tp.membership_id) ?? []
    list.push({ teamName: tp.teams?.display_name ?? "Team", permission: teamPermissionLabel(tp.permission) })
    teamRolesByMembership.set(tp.membership_id, list)
  }

  // Every active member appears here, including a bare "Member" with no
  // elevated role yet -- "who has access to this club" has to include them,
  // not just the people already assigned something.
  const people: PersonRowData[] = (memberships ?? [])
    .map((m) => {
      const profile = profileById.get(m.user_id)
      return {
        membershipId: m.id,
        userId: m.user_id,
        name: [profile?.first_name, profile?.surname].filter(Boolean).join(" ") || "Unknown",
        email: profile?.email ?? "",
        clubRole: m.role as PersonRowData["clubRole"],
        teamRoles: teamRolesByMembership.get(m.id) ?? [],
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club</p>
      <h1 className="mt-2 font-display text-display-l text-ink">People</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">
        Who has access to {clubName}, what they can do, and which teams they&apos;re assigned to.
      </p>

      <section className="mt-8">
        {people.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
            <p className="text-sm font-medium text-ink">Just you, for now</p>
            <p className="mt-1 text-sm text-ink/55">Invite coaches, team managers, or other club officials below.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {people.map((p) => (
              <PersonRow key={p.membershipId} person={p} isSelf={p.userId === user.id} />
            ))}
          </ul>
        )}
      </section>

      {invitations && invitations.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Pending invitations</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {invitations.map((inv) => (
              <PendingInvitationRow
                key={inv.id}
                invitation={{
                  id: inv.id,
                  invitedEmail: inv.invited_email,
                  clubRole: inv.club_role as "CLUB_ADMIN" | "FIXTURE_SECRETARY" | null,
                  declaredRole: inv.declared_role,
                }}
              />
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8">
        <InviteForm clubId={clubId} clubName={clubName} teams={(teams ?? []).map((t) => ({ id: t.id, displayName: t.display_name }))} />
      </div>
    </div>
  )
}
