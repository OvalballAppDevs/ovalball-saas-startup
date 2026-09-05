"use server"

import { revalidatePath } from "next/cache"

import { requirePitchAllocationAccess } from "@/app/(app)/calendar/pitch-allocation/actions"

export interface SchedulingPolicySettings {
  autoAllocateHomeFixtures: boolean
  warmUpMinutes: number
  packUpMinutes: number
}

export type SaveSchedulingPolicyResult = { ok: true } | { ok: false; error: string }

const VALID_BUFFER_MINUTES = new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60])

/**
 * Section 5-7 / 31-40: the same access gate Pitch Allocation's own
 * mutations use (reused, not re-derived -- see requirePitchAllocationAccess's
 * own comment for why fixture.edit at club scope is the correct, audited
 * boundary for who manages this club's scheduling policy).
 */
export async function saveSchedulingPolicy(clubId: string, settings: SchedulingPolicySettings): Promise<SaveSchedulingPolicyResult> {
  const auth = await requirePitchAllocationAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error }

  if (!VALID_BUFFER_MINUTES.has(settings.warmUpMinutes) || !VALID_BUFFER_MINUTES.has(settings.packUpMinutes)) {
    return { ok: false, error: "Warm-up and pack-up time must be in 5-minute increments between 0 and 60." }
  }

  const { error } = await auth.supabase
    .from("club_scheduling_policy")
    .upsert(
      {
        club_id: clubId,
        auto_allocate_home_fixtures: settings.autoAllocateHomeFixtures,
        warm_up_minutes: settings.warmUpMinutes,
        pack_up_minutes: settings.packUpMinutes,
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "club_id" }
    )
  if (error) return { ok: false, error: error.message }

  revalidatePath("/club/settings/pitch-allocation")
  revalidatePath("/calendar/pitch-allocation")
  return { ok: true }
}
