import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * Ovalball's own plans — what a rugby club pays Pipaxon to use Ovalball.
 *
 * Not to be confused with `club_subscription_*`, which is what a club
 * charges its own members. See
 * docs/COMMERCIAL_PLATFORM_ARCHITECTURE.md.
 */
export type PlanCode = "standard" | "pro"
export type PlanStatus = "available" | "coming_soon" | "retired"

export interface PlatformPlan {
  code: PlanCode
  name: string
  description: string | null
  pricePence: number
  currency: string
  billingInterval: "month" | "year"
  /** Bumped whenever the price changes, so a snapshot can name the version. */
  priceVersion: number
  status: PlanStatus
  /** False for a plan that is Coming Soon or retired. Enforced in the database. */
  purchasable: boolean
}

export async function getPlatformPlans(
  supabase: SupabaseClient<Database>
): Promise<PlatformPlan[]> {
  const { data, error } = await supabase
    .from("platform_plans")
    .select("code, name, description, price_pence, currency, billing_interval, price_version, status, purchasable")
    .neq("status", "retired")
    .order("sort_order", { ascending: true })

  if (error || !data) return []

  return data.map((row) => ({
    code: row.code as PlanCode,
    name: row.name,
    description: row.description,
    pricePence: row.price_pence,
    currency: row.currency,
    billingInterval: row.billing_interval as "month" | "year",
    priceVersion: row.price_version,
    status: row.status as PlanStatus,
    purchasable: row.purchasable,
  }))
}

const PRICE_FORMATTERS = new Map<string, Intl.NumberFormat>()

/**
 * "£15 a month". Whole pounds drop the pence, because £15.00 a month reads
 * like a rounding artefact rather than a price.
 */
export function formatPlanPrice(plan: PlatformPlan): string {
  // Keyed on the digit count as well as the currency: a cache keyed on
  // currency alone would format £15.50 as £16 once a whole-pound plan had
  // been formatted first.
  const digits = plan.pricePence % 100 === 0 ? 0 : 2
  const cacheKey = `${plan.currency}:${digits}`

  let formatter = PRICE_FORMATTERS.get(cacheKey)
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: plan.currency,
      minimumFractionDigits: digits,
    })
    PRICE_FORMATTERS.set(cacheKey, formatter)
  }

  const amount = formatter.format(plan.pricePence / 100)
  return plan.billingInterval === "year" ? `${amount} a year` : `${amount} a month`
}
