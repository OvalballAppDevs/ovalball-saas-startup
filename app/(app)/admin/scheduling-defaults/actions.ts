"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/**
 * The platform-wide Pitch Allocation defaults.
 *
 * ONE SETTER, AND IT IS NOT THIS FILE. This calls the canonical
 * public.set_platform_scheduling_defaults, which gates on
 * internal.is_full_site_admin() and enforces the same 0-60 in 5-minute
 * increments a club must obey. Nothing here decides authority or validity:
 * a crafted request reaches the same check, because the check is in the
 * database rather than in front of it.
 *
 * There is deliberately no second store. This writes the one row every club
 * without its own override reads through
 * public.resolve_club_scheduling_buffers.
 */

export type SavePlatformDefaultsResult = { ok: true } | { ok: false; error: string }

export async function savePlatformSchedulingDefaults(
  warmUpMinutes: number,
  packUpMinutes: number
): Promise<SavePlatformDefaultsResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_platform_scheduling_defaults", {
    p_warm_up_minutes: warmUpMinutes,
    p_pack_up_minutes: packUpMinutes,
  })

  if (error) {
    // The database's own two messages are written for people and are safe to
    // show. Anything else is logged and replaced, so a Postgres error never
    // becomes a description of the schema in somebody's browser.
    if (
      error.message.startsWith("Only a Full Site Admin") ||
      error.message.startsWith("Warm-up and pack-up time must be")
    ) {
      return { ok: false, error: error.message }
    }
    console.error("set_platform_scheduling_defaults failed:", error.message)
    return { ok: false, error: "Something went wrong. Please try again." }
  }

  // Every club that inherits reads this on its next render, so the surfaces
  // that show it are revalidated rather than left showing the old number.
  revalidatePath("/admin/scheduling-defaults")
  revalidatePath("/calendar/pitch-allocation")
  revalidatePath("/club/settings/pitch-allocation")
  return { ok: true }
}
