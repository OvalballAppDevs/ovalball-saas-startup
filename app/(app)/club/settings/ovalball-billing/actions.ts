"use server"

import { revalidatePath } from "next/cache"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"

export type BillingActionResult = { ok: true } | { ok: false; error: string }

/**
 * Every action here resolves the club from the session's ACTIVE context and
 * never from a client-supplied id. A Club Admin of two clubs must not be
 * able to change the other club's plan by editing a form value.
 */
async function resolveActiveClub(): Promise<
  { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; clubId: string } | { ok: false; error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeClubId(ctx, activeContext)
  if (!clubId) return { ok: false, error: "Switch to a club before changing its Ovalball plan." }

  if (!(await hasCapability(supabase, "club.platform_billing.manage", "club", { clubId }))) {
    return { ok: false, error: "You do not have permission to manage this club's Ovalball plan." }
  }

  return { ok: true, supabase, clubId }
}

export async function choosePlan(planCode: string): Promise<BillingActionResult> {
  const resolved = await resolveActiveClub()
  if (!resolved.ok) return resolved

  const { error } = await resolved.supabase.rpc("select_club_plan", {
    p_club_id: resolved.clubId,
    p_plan_code: planCode,
  })

  if (error) {
    console.error("select_club_plan failed:", error)
    // The one message worth passing through: a plan that is not for sale.
    if (error.message?.includes("not available to buy")) {
      return { ok: false, error: "That plan is not available to buy yet." }
    }
    return { ok: false, error: "The plan could not be changed." }
  }

  revalidatePath("/club/settings/ovalball-billing")
  return { ok: true }
}

export async function startTrial(): Promise<BillingActionResult> {
  const resolved = await resolveActiveClub()
  if (!resolved.ok) return resolved

  const { error } = await resolved.supabase.rpc("start_club_trial", { p_club_id: resolved.clubId })

  if (error) {
    console.error("start_club_trial failed:", error)
    return { ok: false, error: "The trial could not be started." }
  }

  revalidatePath("/club/settings/ovalball-billing")
  return { ok: true }
}

export async function cancelSubscription(reason: string): Promise<BillingActionResult> {
  const resolved = await resolveActiveClub()
  if (!resolved.ok) return resolved

  const { error } = await resolved.supabase.rpc("cancel_club_platform_subscription", {
    p_club_id: resolved.clubId,
    p_reason: reason.trim() || undefined,
  })

  if (error) {
    console.error("cancel_club_platform_subscription failed:", error)
    return { ok: false, error: "The subscription could not be cancelled." }
  }

  revalidatePath("/club/settings/ovalball-billing")
  return { ok: true }
}

/**
 * Records that an invitation this club already sent is also a referral
 * claim. Idempotent, so a double-submitted form is harmless.
 */
export async function claimReferralForInvitation(invitationId: string): Promise<BillingActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const { error } = await supabase.rpc("claim_club_referral", { p_invitation_id: invitationId })

  if (error) {
    console.error("claim_club_referral failed:", error)
    return { ok: false, error: "The referral could not be recorded." }
  }

  revalidatePath("/club/settings/ovalball-billing")
  return { ok: true }
}
