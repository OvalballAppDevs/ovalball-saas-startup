import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

import { requireSiteAdmin } from "../require-site-admin"
import { OfficerCapabilityRow, type OfficerCapabilityData } from "./officer-capability-row"
import { PendingNominationRow, type PendingNomination } from "./pending-nomination-row"
import { CANONICAL_SAFEGUARDING_KEY, type SafeguardingCapabilityKey } from "./capabilities"

export const metadata = { title: "Safeguarding" }

const CAPABILITY_KEYS: SafeguardingCapabilityKey[] = [
  "club.dispensation.view",
  "club.dispensation.notify",
  "club.transfer.safeguarding_view",
  "club.transfer.safeguarding_notify",
]

/**
 * Site Admin surface for Safeguarding Officer capability control (spec
 * section 10/12): sees every ACTIVE, accepted officer across every club,
 * and shows exactly the four Safeguarding-Officer-specific capabilities
 * the role holds, withholding one through the canonical
 * set_capability_override/revoke_capability_override RPCs (see ./actions.ts).
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
          .eq("effect", "deny")
          .eq("status", "active")
          .in("capability_key", Object.values(CANONICAL_SAFEGUARDING_KEY))
      : { data: [] }

  // AN-6 (Slice 4G). Nominations waiting on Ovalball, from the capability-gated queue rather than a
  // role_assignments query: the page should not be naming role keys to decide what it is looking at,
  // and public.pending_safeguarding_nominations already answers the whole question, including the
  // "also Club Admin" flag AN-6 asks to be visible. These people hold nothing — a Safeguarding Officer
  // assignment is refused at every scope until it is CONFIRMED.
  const { data: pendingRows } = await supabase.rpc("pending_safeguarding_nominations")

  const pending: PendingNomination[] = (pendingRows ?? []).map((r) => ({
    assignmentId: r.assignment_id,
    clubId: r.club_id,
    clubName: r.club_name ?? "Unknown club",
    personName: r.person_name ?? "Unnamed person",
    officerType: r.officer_type === "deputy" ? "deputy" : "primary",
    alsoClubAdmin: r.also_club_admin,
    nominatedAt: new Date(r.nominated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }),
  }))

  const officers: OfficerCapabilityData[] = (officerRows ?? [])
    .filter((o): o is typeof o & { user_id: string } => !!o.user_id)
    .map((o) => {
      // Held through the Safeguarding Officer role unless Ovalball has withheld it.
      const granted = Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, true])) as Record<SafeguardingCapabilityKey, boolean>
      for (const key of CAPABILITY_KEYS) {
        if ((overrideRows ?? []).some((row) => row.user_id === o.user_id && row.club_id === o.club_id && row.capability_key === CANONICAL_SAFEGUARDING_KEY[key])) {
          granted[key] = false
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
        Every active, accepted Safeguarding Officer across the platform. Dispensation and transfer safeguarding visibility
        and notifications come with the Safeguarding Officer role. Switch one off here only when an officer should not have it.
      </p>

      <section className="mt-8">
        <h2 className="font-display text-display-s text-ink">Awaiting Confirmation</h2>
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          A club has nominated someone as its Safeguarding Officer. Nothing is granted until Ovalball confirms
          the appointment, and the reason you give is recorded against it.
        </p>
        {pending.length === 0 ? (
          <p className="mt-4 text-sm text-ink-muted">No nominations are waiting.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {pending.map((nomination) => (
              <PendingNominationRow key={nomination.assignmentId} nomination={nomination} />
            ))}
          </ul>
        )}
      </section>

      <h2 className="mt-12 font-display text-display-s text-ink">Confirmed Officers</h2>
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
