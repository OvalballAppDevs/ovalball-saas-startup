"use server"

import { revalidatePath } from "next/cache"

import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

export type ActionResult = { ok: true } | { ok: false; error: string }

async function requireSubscriptionConfigAccess(clubId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "You must be signed in." }

  const authorized = await hasCapability(supabase, "club.subscription.configure", "club", { clubId })
  if (!authorized) return { ok: false as const, error: "You are not authorized to configure subscriptions for this club." }

  return { ok: true as const, supabase, user }
}

export type FirstPaymentPolicy = "PRORATE_CURRENT_MONTH" | "NEXT_COLLECTION_DAY"

export interface SubscriptionProgrammeSettings {
  enabled: boolean
  collectionDay: number
  platformFeeMode: "NONE" | "PARTNER_REVENUE_SHARE"
  firstPaymentPolicy: FirstPaymentPolicy
}

export async function saveSubscriptionProgramme(clubId: string, settings: SubscriptionProgrammeSettings): Promise<ActionResult> {
  const auth = await requireSubscriptionConfigAccess(clubId)
  if (!auth.ok) return auth

  const { error } = await auth.supabase.rpc("configure_subscription_programme", {
    p_club_id: clubId,
    p_enabled: settings.enabled,
    p_collection_day: settings.collectionDay,
    p_platform_fee_mode: settings.platformFeeMode,
    p_first_payment_policy: settings.firstPaymentPolicy,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/club/settings/subscriptions")
  return { ok: true }
}

export interface FirstPaymentPreview {
  policy: FirstPaymentPolicy
  monthlyAmountMinor: number
  firstChargeAmountMinor: number
  firstChargeBillingPeriod: string
  coversFrom: string
  coversTo: string
  isProrated: boolean
}

/** A live example driven by the club's actual configured amount -- server-computed, never re-derived client-side, so the preview can never drift from what create_membership_obligations_for_period will actually do. */
export async function previewFirstPayment(programmeId: string, membershipStartDate: string): Promise<FirstPaymentPreview | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("preview_first_payment_illustrative", { p_programme_id: programmeId, p_membership_start_date: membershipStartDate }).maybeSingle()
  if (error || !data) return null
  return {
    policy: data.policy as FirstPaymentPolicy,
    monthlyAmountMinor: data.monthly_amount_minor,
    firstChargeAmountMinor: data.first_charge_amount_minor,
    firstChargeBillingPeriod: data.first_charge_billing_period,
    coversFrom: data.covers_from,
    coversTo: data.covers_to,
    isProrated: data.is_prorated,
  }
}

export async function setSubscriptionPrice(programmeId: string, clubId: string, amountMinor: number, effectiveFrom: string): Promise<ActionResult> {
  const auth = await requireSubscriptionConfigAccess(clubId)
  if (!auth.ok) return auth

  const { error } = await auth.supabase.rpc("set_subscription_price", {
    p_programme_id: programmeId,
    p_amount_minor: amountMinor,
    p_effective_from: effectiveFrom,
  })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/club/settings/subscriptions")
  return { ok: true }
}

export async function disconnectGoCardless(clubId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  const authorized = await hasCapability(supabase, "club.gocardless.connect", "club", { clubId })
  if (!authorized) return { ok: false, error: "You are not authorized to disconnect GoCardless for this club." }

  const { error } = await supabase.rpc("disconnect_gocardless", { p_club_id: clubId, p_reason: reason })
  if (error) return { ok: false, error: error.message }

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
