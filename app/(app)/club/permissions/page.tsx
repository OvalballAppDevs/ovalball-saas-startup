import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { ShieldCheck } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { roleAssignmentLabel } from "@/lib/permissions/role-presentation"
import { createClient } from "@/lib/supabase/server"

import { GROUPS, TEAM_GROUPS } from "@ovalball/contracts/club/permission-groups"
import { readPermissionGrid, type PermissionRow } from "@ovalball/contracts/club/permissions"

import { ScopeSwitcher } from "./scope-switcher"
import { ClubPermissionsPanel, type CapabilityPreset, type ClubMember } from "./permissions-panel"

export const metadata = { title: "Club Permissions" }

/**
 * THE CLUB'S OWN DELEGATION SCREEN.
 *
 * Scoped to the ACTIVE club context rather than "whichever club this
 * account administers somewhere" -- the same rule Fixture Management uses,
 * and for the same reason: an account holding authority at two clubs must
 * not administer one while operating as the other.
 *
 * The capability check here is a friendly redirect. The real boundary is in
 * set_capability_override / club_member_capabilities, both of which demand
 * club.capabilities.manage for the club they are asked about -- so reaching
 * this URL without the authority shows nothing and changes nothing.
 */
export default async function ClubPermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>
}) {
  const { team: teamParam } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeManageableClubId(ctx, activeContext)
  if (!clubId) redirect("/dashboard")

  if (!(await hasCapability(supabase, "people.capability.manage", "club", { clubId }))) {
    redirect("/club")
  }

  // THE CLUB'S OWN TEAMS, so the club can decide for one of them. Read before the branch because the
  // switcher is on the page either way -- a Club Admin should be able to see that per-team decisions
  // exist without first knowing to ask for one.
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, display_name")
    .eq("club_id", clubId)
    .eq("active", true)
    .is("folded_at", null)
    .is("archived_at", null)
    .order("display_name")
  const teams = (teamRows ?? []).map((t) => ({ id: t.id, name: t.display_name }))
  const activeTeam = teamParam ? teams.find((t) => t.id === teamParam) : undefined

  const { data: clubRow } = await supabase.from("clubs").select("club_directory(name)").eq("id", clubId).maybeSingle()
  const clubName = clubRow?.club_directory?.name ?? "your club"

  if (activeTeam) {
    // ONE TEAM. The same screen, the same rows, the same resolver -- club_team_capabilities is
    // club_member_capabilities asked at team scope, and the panel writes through the team action.
    // A club-wide job preset is deliberately not offered here: a preset is a club job.
    // ONE TEAM. The same rows and the same resolver through the shared contract (readPermissionGrid over
    // club_team_capabilities), and the panel writes through the team action.
    const teamCapRows = await readPermissionGrid(supabase, clubId, activeTeam.id, TEAM_GROUPS.flatMap((g) => g.items.map((i) => i.key)))
    const teamStaffIds = [...new Set(teamCapRows.map((r) => r.userId))]
    const { data: teamDirectory } = teamStaffIds.length
      ? await supabase.rpc("get_club_member_directory", { p_club_id: clubId })
      : { data: [] as { user_id: string; first_name: string | null; surname: string | null; email: string | null }[] }
    const teamProfile = new Map((teamDirectory ?? []).map((p) => [p.user_id, p]))

    const { data: teamRoleRows } = await supabase
      .from("role_assignments")
      .select("user_id, role_key, confirmation_state, role_definitions(label)")
      .eq("team_id", activeTeam.id)
      .eq("state", "ACTIVE")
    const teamRoleByUser = new Map<string, string>()
    for (const r of teamRoleRows ?? []) {
      teamRoleByUser.set(r.user_id, roleAssignmentLabel(r.role_key, r.role_definitions?.label, r.confirmation_state))
    }

    const byTeamUser = new Map<string, PermissionRow[]>()
    for (const { userId, ...row } of teamCapRows) {
      const list = byTeamUser.get(userId) ?? []
      list.push(row)
      byTeamUser.set(userId, list)
    }

    const teamStaff: ClubMember[] = teamStaffIds
      .map((userId) => {
        const profile = teamProfile.get(userId)
        return {
          userId,
          name: [profile?.first_name, profile?.surname].filter(Boolean).join(" ") || "Club member",
          email: profile?.email ?? "",
          roleLabel: teamRoleByUser.get(userId) ?? "Team staff",
          capabilities: byTeamUser.get(userId) ?? [],
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    return (
      <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="size-5 text-forest-800" />
          <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club Admin</p>
        </div>

        <h1 className="mt-2 font-display text-display-l text-ink">Permissions</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-muted">
          What this team&rsquo;s coaches and managers may do for {activeTeam.name}. A decision here applies to
          this team only — it does not make anybody fixture staff for the rest of {clubName}.
        </p>

        <ScopeSwitcher teams={teams} activeTeamId={activeTeam.id} clubName={clubName} />

        <ClubPermissionsPanel
          clubId={clubId}
          teamId={activeTeam.id}
          teamName={activeTeam.name}
          members={teamStaff}
          presets={[]}
          groups={TEAM_GROUPS}
          emptyMessage={`Nobody holds a coaching or managing role on ${activeTeam.name} yet, so there is nobody to give a team permission to.`}
        />
      </div>
    )
  }

  // Deliberately three separate awaits rather than one Promise.all: the
  // tuple of three differently-shaped PostgREST builders defeats Supabase's
  // generated type inference outright ("type instantiation is excessively
  // deep"). Three small sequential reads on an administrative screen is the
  // cheaper trade.
  // Every answer, with the rule, the level and the role default it came from, from the one resolver
  // (readPermissionGrid over club_member_capabilities) -- only for the capabilities this screen offers.
  const rows = await readPermissionGrid(supabase, clubId, null, GROUPS.flatMap((g) => g.items.map((i) => i.key)))
  // Club roles from the canonical role assignments (club_memberships.role is compatibility only).
  //
  // `confirmation_state` is selected because it is PART of the role, not a detail
  // beside it. Without it this row read "Safeguarding Officer" for a person whose
  // nomination is still sitting in PENDING_CONFIRMATION conferring nothing --
  // telling the club an appointment was settled while the page that owns the
  // appointment said the club had none. One canonical state, worded in one place.
  const { data: roleRows } = await supabase
    .from("role_assignments")
    .select("user_id, role_key, confirmation_state, role_definitions(label)")
    .eq("club_id", clubId)
    .is("team_id", null)
    .eq("state", "ACTIVE")

  const roleLabelByUser = new Map<string, string>()
  for (const r of roleRows ?? []) {
    const label = roleAssignmentLabel(r.role_key, r.role_definitions?.label, r.confirmation_state)
    const existing = roleLabelByUser.get(r.user_id)
    // A club role outranks the plain Member role when someone holds both.
    if (!existing || existing === "Member") roleLabelByUser.set(r.user_id, label)
  }

  const memberIds = [...new Set(rows.map((r) => r.userId))]
  // Names through the club's member directory, which a Club Admin may read; a direct profiles read only
  // returns the viewer's own row, so every other person would show as "Club member".
  const { data: directoryRows } = memberIds.length
    ? await supabase.rpc("get_club_member_directory", { p_club_id: clubId })
    : { data: [] as { user_id: string; first_name: string | null; surname: string | null; email: string | null }[] }
  const nameById = new Map((directoryRows ?? []).map((p) => [p.user_id, [p.first_name, p.surname].filter(Boolean).join(" ")]))
  // A permissions screen has to say WHO each row is about. Somebody who has not
  // filled their name in yet showed as the bare fallback "Club member", and two
  // of those in a list are indistinguishable -- so the address they signed up
  // with is carried through as the secondary line. It comes from the same
  // authorised directory call as the name, never from a second lookup.
  const emailById = new Map((directoryRows ?? []).map((p) => [p.user_id, p.email ?? ""]))

  // The named jobs this club can hand out, and whether THIS person may hand
  // each one out. The database answers both, asking the same question the
  // write will ask -- so the screen cannot offer a button that then refuses.
  const { data: presetRows } = await supabase.rpc("club_capability_presets", { p_club_id: clubId })
  const presets: CapabilityPreset[] = (presetRows ?? []).map((p) => ({
    presetKey: p.preset_key,
    label: p.label,
    description: p.description,
    capabilityLabels: p.capability_labels ?? [],
    mayApply: p.may_apply === true,
  }))

  const byUser = new Map<string, PermissionRow[]>()
  for (const { userId, ...row } of rows) {
    const list = byUser.get(userId) ?? []
    list.push(row)
    byUser.set(userId, list)
  }

  const members: ClubMember[] = memberIds
    .map((userId) => ({
      userId,
      name: nameById.get(userId) || "Club member",
      email: emailById.get(userId) ?? "",
      roleLabel: roleLabelByUser.get(userId) ?? "Club member",
      capabilities: byUser.get(userId) ?? [],
    }))
    .filter((m) => m.capabilities.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club Admin</p>
      </div>

      <h1 className="mt-2 font-display text-display-l text-ink">Permissions</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        Decide who at {clubName} may run fixtures, training and the calendar. A
        person&rsquo;s role already gives them a starting position — use this to allow something extra, or to
        withhold something their role would otherwise include.
      </p>
      <p className="mt-2 max-w-xl text-xs text-ink-subtle">
        Ovalball sets the ceiling. Where Ovalball has switched something off, allowing it here has no effect.
      </p>

      <ScopeSwitcher teams={teams} activeTeamId={null} clubName={clubName} />

      <ClubPermissionsPanel clubId={clubId} members={members} presets={presets} />
    </div>
  )
}
