import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { ClubSettingsNav } from "../club-settings-nav"
import { PitchAllocationSettingsForm } from "./settings-form"

/**
 * Section 5-7 / 31-40: the Club Settings surface club_scheduling_policy
 * never had -- Pitch Allocation's own data.ts only ever READ this table
 * (falling back to DEFAULT_SCHEDULING_POLICY when no row exists yet).
 * Gated by fixture.edit at club scope, the exact same capability that
 * gates the Pitch Allocation board itself (see requirePitchAllocationAccess's
 * own comment for why that's the correct boundary, not a new capability).
 */
export default async function PitchAllocationSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeClubId(ctx, activeContext)

  const canPitchAllocation = clubId ? await hasCapability(supabase, "fixture.edit", "club", { clubId }) : false
  if (!clubId || !canPitchAllocation) redirect("/club/settings")
  const canPlayerMoves = clubId ? await hasCapability(supabase, "manage_fixture_callups", "club", { clubId }) : false

  const { data: policyRow } = await supabase
    .from("club_scheduling_policy")
    .select("auto_allocate_home_fixtures, warm_up_minutes, pack_up_minutes")
    .eq("club_id", clubId)
    .maybeSingle()

  const clubName = activeContext.kind === "club" ? activeContext.label : "Club"

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Club Settings</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Pitch Allocation</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">How {clubName} schedules home fixtures onto pitches.</p>

      <ClubSettingsNav active="pitchAllocation" canProfile={false} canTeams={false} canVenues={false} canRollover={false} canPitchAllocation canPlayerMoves={canPlayerMoves} />

      <div className="mt-8">
        <PitchAllocationSettingsForm
          clubId={clubId}
          initial={{
            autoAllocateHomeFixtures: policyRow?.auto_allocate_home_fixtures ?? false,
            warmUpMinutes: policyRow?.warm_up_minutes ?? 0,
            packUpMinutes: policyRow?.pack_up_minutes ?? 0,
          }}
        />
      </div>
    </div>
  )
}
