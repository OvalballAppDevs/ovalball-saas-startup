"use server"

import { revalidatePath } from "next/cache"

import { requirePitchAllocationAccess } from "@/app/(app)/calendar/pitch-allocation/actions"
import { saveSchedulingPolicy as saveSharedSchedulingPolicy, type SchedulingPolicySettings } from "@ovalball/contracts/pitch-allocation/operations"

export type { SchedulingPolicySettings }

export type SaveSchedulingPolicyResult = { ok: true } | { ok: false; error: string }


/**
 * Section 5-7 / 31-40: the same access gate Pitch Allocation's own
 * mutations use (reused, not re-derived -- see requirePitchAllocationAccess's
 * own comment for why fixture.edit at club scope is the correct, audited
 * boundary for who manages this club's scheduling policy).
 */
export async function saveSchedulingPolicy(clubId: string, settings: SchedulingPolicySettings): Promise<SaveSchedulingPolicyResult> {
  const auth = await requirePitchAllocationAccess(clubId)
  if (!auth.ok) return { ok: false, error: auth.error }

  // CA-M11.1: the validation and the write are the shared package's, so the phone saves the same row.
  const saved = await saveSharedSchedulingPolicy(auth.supabase, clubId, auth.user.id, settings)
  if (!saved.ok) return saved

  revalidatePath("/club/settings/pitch-allocation")
  revalidatePath("/calendar/pitch-allocation")
  return { ok: true }
}
