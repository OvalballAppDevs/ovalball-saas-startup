import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import { requireSiteAdmin } from "../require-site-admin"
import { OfficerCapabilityRow, type OfficerCapabilityData } from "./officer-capability-row"
import type { SafeguardingCapabilityKey } from "./actions"

const CAPABILITY_KEYS: SafeguardingCapabilityKey[] = [
  "club.dispensation.view",
  "club.dispensation.notify",
  "club.transfer.safeguarding_view",
  "club.transfer.safeguarding_notify",
]

/**
 * Site Admin surface for Safeguarding Officer capability control (spec
 * section 10/12): sees every ACTIVE, accepted officer across every club,
 * and toggles exactly the four Safeguarding-Officer-specific capabilities
 * -- reusing the existing set_capability_override/revoke_capability_
 * override RPCs directly (see ./actions.ts), never a bespoke grant path.
 * A Club Admin cannot reach this page at all (requireSiteAdmin) and
 * cannot use it to grant an unrelated platform capability (actions.ts
 * restricts the capability key allowlist).
 */
export default async function SafeguardingCapabilityAdminPage() {
  const supabase = await createClient()
  const auth = await requireSiteAdmin(supabase)
  if (!auth.ok) redirect("/dashboard")

  const { data: officerRows } = await supabase
    .from("club_safeguarding_officers")
    .select("id, club_id, officer_type, contact_name, user_id, clubs:club_id(club_directory:directory_id(name))")
    .eq("status", "active")
    .not("user_id", "is", null)
    .order("officer_type")

  const userIds = (officerRows ?? []).map((o) => o.user_id).filter((id): id is string => !!id)
  const { data: overrideRows } =
    userIds.length > 0
      ? await supabase
          .from("capability_overrides")
          .select("user_id, club_id, capability_key")
          .in("user_id", userIds)
          .eq("scope_type", "club")
          .eq("effect", "grant")
          .eq("status", "active")
          .in("capability_key", CAPABILITY_KEYS)
      : { data: [] }

  const officers: OfficerCapabilityData[] = (officerRows ?? [])
    .filter((o): o is typeof o & { user_id: string } => !!o.user_id)
    .map((o) => {
      const granted = Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, false])) as Record<SafeguardingCapabilityKey, boolean>
      for (const row of overrideRows ?? []) {
        if (row.user_id === o.user_id && row.club_id === o.club_id) {
          granted[row.capability_key as SafeguardingCapabilityKey] = true
        }
      }
      const clubName = (o.clubs as unknown as { club_directory: { name: string } | null } | null)?.club_directory?.name ?? "Unknown club"
      return {
        userId: o.user_id,
        clubId: o.club_id,
        clubName,
        officerName: o.contact_name,
        officerType: o.officer_type as "primary" | "deputy",
        granted,
      }
    })

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Safeguarding Officer Capabilities</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        Every active, accepted Safeguarding Officer across the platform. Dispensation and transfer safeguarding visibility/
        notifications are never granted by default &mdash; enable them individually here.
      </p>

      {officers.length === 0 ? (
        <p className="mt-8 text-sm text-ink-muted">No active, accepted Safeguarding Officers yet.</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-2">
          {officers.map((officer) => (
            <OfficerCapabilityRow key={`${officer.userId}-${officer.clubId}`} officer={officer} />
          ))}
        </ul>
      )}
    </div>
  )
}
