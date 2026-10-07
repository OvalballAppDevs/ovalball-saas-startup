"use server"

import { revalidatePath } from "next/cache"
import {
  acceptMembershipTerms,
  activateMemberships,
  archiveMembership,
  createMembership,
  loadFirstPaymentExample,
  membershipSetupErrorMessage,
  pauseMemberships,
  renameMembership,
  saveMembershipSettings,
  setMembershipPrice,
  setMembershipTeams,
  type ActivationOutcome,
  type FeeBearer,
  type FirstPaymentExample,
  type SetupFirstPaymentPolicy,
} from "@ovalball/contracts/membership/setup"

import { drainGoCardlessTokenRevocations } from "@/lib/payments/gocardless/token-revocation"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

export type ActionResult = { ok: true } | { ok: false; error: string }

async function requireSubscriptionConfigAccess(clubId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "You must be signed in." }

  const authorized = await hasCapability(supabase, "finance.subscription.configure", "club", { clubId })
  if (!authorized) return { ok: false as const, error: "You are not authorised to configure subscriptions for this club." }

  return { ok: true as const, supabase, user }
}

// Programme & Pricing's old doors (configure_subscription_programme, set_subscription_price and the illustrative
// preview) left this file with the page that used them: Club Memberships sets a club up through the doors below, which
// re-derive readiness on the server, and nothing on the website may switch memberships on any other way.

export async function disconnectGoCardless(clubId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  const authorized = await hasCapability(supabase, "finance.gocardless.connect", "club", { clubId })
  if (!authorized) return { ok: false, error: "You are not authorised to disconnect GoCardless for this club." }

  const { error } = await supabase.rpc("disconnect_gocardless", { p_club_id: clubId, p_reason: reason })
  // The server's own sentence when it wrote one for a person; never a raw database message.
  if (error) return { ok: false, error: membershipSetupErrorMessage(error, "Could not disconnect GoCardless. Please try again.") }

  // The token left the connection in the same transaction and waits to be revoked at GoCardless; revoke it now.
  // A failure leaves it queued for the replay job, and never undoes the disconnect.
  await drainGoCardlessTokenRevocations().catch(() => undefined)

  revalidatePath("/club/settings/subscriptions")
  return { ok: true }
}

export async function getActiveSubscriptionImpact(clubId: string): Promise<{ activeGoCardlessSubscriptions: number; activePayers: number; pendingObligations: number } | null> {
  const auth = await requireSubscriptionConfigAccess(clubId)
  if (!auth.ok) return null

  const { data, error } = await auth.supabase.rpc("get_active_subscription_impact", { p_club_id: clubId }).maybeSingle()
  if (error || !data) return null
  return {
    activeGoCardlessSubscriptions: data.active_gocardless_subscriptions ?? 0,
    activePayers: data.active_payers ?? 0,
    pendingObligations: data.pending_obligations ?? 0,
  }
}

export async function saveSiblingDiscountRule(programmeId: string, clubId: string, ordinal: number, discountType: "NONE" | "PERCENTAGE" | "FIXED", discountValue: number): Promise<ActionResult> {
  const auth = await requireSubscriptionConfigAccess(clubId)
  if (!auth.ok) return auth

  const { error } = await auth.supabase.rpc("configure_sibling_discount_rule", {
    p_programme_id: programmeId,
    p_ordinal: ordinal,
    p_discount_type: discountType,
    p_discount_value: discountValue,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/club/settings/subscriptions")
  return { ok: true }
}

export async function getSiblingDiscountRules(programmeId: string): Promise<Array<{ ordinal: number; discountType: "NONE" | "PERCENTAGE" | "FIXED"; discountValue: number }>> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("get_sibling_discount_rules", { p_programme_id: programmeId })
  return (data ?? []).map((r) => ({ ordinal: r.ordinal, discountType: r.discount_type as "NONE" | "PERCENTAGE" | "FIXED", discountValue: r.discount_value }))
}

// =====================================================================================================================
// CLUB MEMBERSHIPS -- PART 1 (20270748000000). The same doors the phone uses, through the same contract
// (`@ovalball/contracts/membership/setup`), called with this person's own session: every one re-checks authority and
// validity on the server, so these wrappers add no permission of their own -- they only turn a refusal into the
// server's own sentence (never a raw database message) and refresh the page.
// =====================================================================================================================

async function asCaller<T>(work: (supabase: Awaited<ReturnType<typeof createClient>>) => Promise<T>, fallback: string): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }
  try {
    const value = await work(supabase)
    revalidatePath("/club/settings/subscriptions")
    return { ok: true, value }
  } catch (cause) {
    return { ok: false, error: membershipSetupErrorMessage(cause, fallback) }
  }
}

export async function acceptMembershipTermsAction(clubId: string, version: string): Promise<ActionResult> {
  const result = await asCaller((s) => acceptMembershipTerms(s, clubId, version), "Could not record the agreement. Please try again.")
  return result.ok ? { ok: true } : result
}

export async function saveMembershipSettingsAction(clubId: string, input: { collectionDay: number; firstPaymentPolicy: SetupFirstPaymentPolicy; feeBearer: FeeBearer | null }): Promise<ActionResult> {
  const result = await asCaller((s) => saveMembershipSettings(s, clubId, input), "Could not save the collection settings. Please try again.")
  return result.ok ? { ok: true } : result
}

/**
 * One membership's changes, in the order most likely to be refused first (a name already used), so a refusal
 * leaves the rest unchanged; the page re-reads whatever happens, so it never shows a guess.
 */
export async function saveMembershipAction(
  clubId: string,
  input: { productId: string | null; name: string; monthlyAmountMinor: number; teamIds: string[]; priceFrom: string | null; before: { name: string; teamIds: string[] } | null }
): Promise<ActionResult> {
  const result = await asCaller(async (s) => {
    if (!input.productId) {
      await createMembership(s, clubId, { name: input.name, monthlyAmountMinor: input.monthlyAmountMinor, teamIds: input.teamIds })
      return
    }
    if (input.before && input.name !== input.before.name) await renameMembership(s, input.productId, input.name)
    if (input.priceFrom) await setMembershipPrice(s, input.productId, input.monthlyAmountMinor, input.priceFrom)
    const was = [...(input.before?.teamIds ?? [])].sort().join()
    const now = [...input.teamIds].sort().join()
    if (was !== now) await setMembershipTeams(s, input.productId, input.teamIds)
  }, "Could not save this membership. Please try again.")
  return result.ok ? { ok: true } : result
}

export async function archiveMembershipAction(productId: string): Promise<ActionResult> {
  const result = await asCaller((s) => archiveMembership(s, productId), "Could not remove this membership. Please try again.")
  return result.ok ? { ok: true } : result
}

export async function activateMembershipsAction(clubId: string): Promise<{ ok: true; outcome: ActivationOutcome } | { ok: false; error: string }> {
  const result = await asCaller((s) => activateMemberships(s, clubId), "Could not switch Club Memberships on. Please try again.")
  return result.ok ? { ok: true, outcome: result.value } : result
}

export async function pauseMembershipsAction(clubId: string, reason: string): Promise<ActionResult> {
  const result = await asCaller((s) => pauseMemberships(s, clubId, reason), "Could not pause new memberships. Please try again.")
  return result.ok ? { ok: true } : result
}

/** The worked example and the money receipt, from the server's own rules (membership_first_payment_example). */
export async function firstPaymentExampleAction(input: {
  clubId: string
  monthlyAmountMinor: number
  joinDate: string
  collectionDay: number
  firstPaymentPolicy: SetupFirstPaymentPolicy
  feeBearer: FeeBearer | null
}): Promise<FirstPaymentExample | null> {
  const supabase = await createClient()
  try {
    return await loadFirstPaymentExample(supabase, input)
  } catch {
    return null
  }
}
