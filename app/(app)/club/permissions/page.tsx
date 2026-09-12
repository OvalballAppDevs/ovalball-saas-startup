import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { ShieldCheck } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

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

  if (!(await hasCapability(supabase, "club.capabilities.manage", "club", { clubId }))) {
    redirect("/club")
  }

  // Deliberately three separate awaits rather than one Promise.all: the
  // tuple of three differently-shaped PostgREST builders defeats Supabase's
  // generated type inference outright ("type instantiation is excessively
  // deep"). Three small sequential reads on an administrative screen is the
  // cheaper trade.
  const { data: rows } = await supabase.rpc("club_member_capabilities", { p_club_id: clubId })
  // The embedded profile join is what tips the generated types over, so the
  // two reads are kept separate and joined here.
  const { data: memberRows } = await supabase
    .from("club_memberships")
    .select("user_id, role")
    .eq("club_id", clubId)
    .eq("status", "active")

  const memberIds = (memberRows ?? []).map((m) => m.user_id)
  const { data: profileRows } = memberIds.length
    ? await supabase.from("profiles").select("id, first_name, surname").in("id", memberIds)
    : { data: [] as { id: string; first_name: string; surname: string }[] }
  const nameById = new Map((profileRows ?? []).map((p) => [p.id, [p.first_name, p.surname].filter(Boolean).join(" ")]))
  const { data: club } = await supabase.from("clubs").select("club_directory(name)").eq("id", clubId).maybeSingle()

  const byUser = new Map<string, ClubMember["capabilities"]>()
  for (const r of (rows ?? []) as { user_id: string; capability_key: string; effective: boolean; source: string; override_id: string | null }[]) {
    const list = byUser.get(r.user_id) ?? []
    list.push({ capabilityKey: r.capability_key, effective: r.effective, source: r.source, overrideId: r.override_id })
    byUser.set(r.user_id, list)
  }

  const members: ClubMember[] = (memberRows ?? [])
    .map((m) => ({
      userId: m.user_id,
      name: nameById.get(m.user_id) || "Club member",
      roleLabel: ROLE_LABEL[m.role] ?? m.role,
      capabilities: byUser.get(m.user_id) ?? [],
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

const ROLE_LABEL: Record<string, string> = {
  CLUB_ADMIN: "Club Admin",
  FIXTURE_SECRETARY: "Fixture Secretary",
  BASIC_USER: "Club member",
}
