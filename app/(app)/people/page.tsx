import { redirect } from "next/navigation"

import { getSessionContext, isClubAdminAnywhere } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { InviteForm } from "./invite-form"
import { PendingInvitationRow } from "./pending-invitation-row"
import { PersonRow, type PersonRowData } from "./person-row"

const TEAM_PERMISSION_LABEL: Record<string, string> = {
  team_admin: "Team Admin",
  coach: "Coach",
  manager: "Manager",
  view_only: "Parent/Player",
}

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

  const clubId = ctx.clubMemberships.find((m) => m.role === "CLUB_ADMIN")!.clubId
  const clubName = ctx.clubMemberships.find((m) => m.role === "CLUB_ADMIN")!.clubName

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
    list.push({ teamName: tp.teams?.display_name ?? "Team", permission: TEAM_PERMISSION_LABEL[tp.permission] ?? tp.permission })
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
