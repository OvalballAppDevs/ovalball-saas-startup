"use server"

import { revalidatePath } from "next/cache"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

export type CommercialActionResult = { ok: true } | { ok: false; error: string }

/**
 * Extending a trial changes what a club owes, so it needs
 * `site.commercial.manage` — which is Full Site Admin only and deliberately
 * not delegable. `site.commercial.view` is read-only and does not permit
 * this; the RPC enforces the same rule regardless of what reaches here.
 */
export async function extendTrial(input: {
  clubId: string
  extraDays: number
  reason: string
}): Promise<CommercialActionResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) {
    return { ok: false, error: "Site Admin access is required, in an active Site Admin context." }
  }

  if (!(await hasCapability(supabase, "site.commercial.manage", "site"))) {
    return { ok: false, error: "Only a Full Site Admin can extend a trial." }
  }

  if (!Number.isInteger(input.extraDays) || input.extraDays <= 0 || input.extraDays > 365) {
    return { ok: false, error: "Enter a whole number of days between 1 and 365." }
  }

  const reason = input.reason.trim()
  if (reason.length < 5) {
    return { ok: false, error: "Give a short reason. It is recorded against the club." }
  }

  const { error } = await supabase.rpc("extend_club_trial", {
    p_club_id: input.clubId,
    p_extra_days: input.extraDays,
    p_reason: reason,
  })

  if (error) {
    console.error("extend_club_trial failed:", error)
    return { ok: false, error: "The trial could not be extended." }
  }

  revalidatePath("/admin/commercial")
  return { ok: true }
}
