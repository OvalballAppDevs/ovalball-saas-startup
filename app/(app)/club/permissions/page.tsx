import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { ShieldCheck } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

import { GROUPS } from "./groups"
import { ClubPermissionsPanel, type ClubMember } from "./permissions-panel"

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
export default async function ClubPermissionsPage() {
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

  // Deliberately three separate awaits rather than one Promise.all: the
  // tuple of three differently-shaped PostgREST builders defeats Supabase's
  // generated type inference outright ("type instantiation is excessively
  // deep"). Three small sequential reads on an administrative screen is the
  // cheaper trade.
  // Every answer, with the rule and level it came from, from the one resolver -- only for the
  // capabilities this screen offers.
  const { data: rows } = await supabase.rpc("club_member_capabilities", {
    p_club_id: clubId,
    p_capability_keys: GROUPS.flatMap((g) => g.items.map((i) => i.key)),
  })
  // Club roles from the canonical role assignments (club_memberships.role is compatibility only).
  const { data: roleRows } = await supabase
    .from("role_assignments")
    .select("user_id, role_key, role_definitions(label)")
    .eq("club_id", clubId)
    .is("team_id", null)
    .eq("state", "ACTIVE")

  const roleLabelByUser = new Map<string, string>()
  for (const r of roleRows ?? []) {
    const label = r.role_definitions?.label ?? r.role_key
    const existing = roleLabelByUser.get(r.user_id)
    // A club role outranks the plain Member role when someone holds both.
    if (!existing || existing === "Member") roleLabelByUser.set(r.user_id, label)
  }

  const memberIds = [...new Set(((rows ?? []) as { user_id: string }[]).map((r) => r.user_id))]
  // Names through the club's member directory, which a Club Admin may read; a direct profiles read only
  // returns the viewer's own row, so every other person would show as "Club member".
  const { data: directoryRows } = memberIds.length
    ? await supabase.rpc("get_club_member_directory", { p_club_id: clubId })
    : { data: [] as { user_id: string; first_name: string | null; surname: string | null }[] }
  const nameById = new Map((directoryRows ?? []).map((p) => [p.user_id, [p.first_name, p.surname].filter(Boolean).join(" ")]))
  const { data: club } = await supabase.from("clubs").select("club_directory(name)").eq("id", clubId).maybeSingle()

  const byUser = new Map<string, ClubMember["capabilities"]>()
  for (const r of rows ?? []) {
    const list = byUser.get(r.user_id) ?? []
    list.push({
      capabilityKey: r.capability_key,
      effective: r.effective,
      source: r.source,
      overrideId: r.override_id,
      overrideLevel: r.override_level,
      editable: r.editable === true,
    })
    byUser.set(r.user_id, list)
  }

  const members: ClubMember[] = memberIds
    .map((userId) => ({
      userId,
      name: nameById.get(userId) || "Club member",
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
        Decide who at {club?.club_directory?.name ?? "your club"} may run fixtures, training and the calendar. A
        person&rsquo;s role already gives them a starting position — use this to allow something extra, or to
        withhold something their role would otherwise include.
      </p>
      <p className="mt-2 max-w-xl text-xs text-ink-subtle">
        Ovalball sets the ceiling. Where Ovalball has switched something off, allowing it here has no effect.
      </p>

      <ClubPermissionsPanel clubId={clubId} members={members} />
    </div>
  )
}
