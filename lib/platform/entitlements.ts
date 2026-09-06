import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * What a club is entitled to use.
 *
 * Features ask `clubHasEntitlement(...)`. Nothing anywhere writes
 * `if (plan === "pro")` — the plan a club is on is resolved once, in the
 * database, by `internal.club_effective_plan`, and every check reads
 * through it. When Pro gains a real premium feature, one function changes
 * and no page does.
 *
 * These checks are the gate. Hiding a button or disabling a control is
 * presentation; a server-side check is what actually protects a feature.
 */

/** Granted to every club, always. Never behind a plan. */
export const ESSENTIAL_ENTITLEMENTS = [
  "safety.safeguarding",
  "safety.permissions",
  "safety.audit",
  "safety.data_rights",
] as const

/** Included in the Standard product. */
export const CORE_ENTITLEMENTS = [
  "core.club_administration",
  "core.teams_and_roster",
  "core.fixtures",
  "core.calendar",
  "core.game_management",
  "core.availability_attendance",
  "core.messaging",
  "core.pitch_allocation",
  "core.member_payments",
] as const

export type EssentialEntitlement = (typeof ESSENTIAL_ENTITLEMENTS)[number]
export type CoreEntitlement = (typeof CORE_ENTITLEMENTS)[number]
export type EntitlementKey = EssentialEntitlement | CoreEntitlement

export type EntitlementSource = "essential" | "plan"

export interface GrantedEntitlement {
  key: EntitlementKey
  source: EntitlementSource
}

/**
 * Every entitlement this club currently has. An empty result means the club
 * has none — which for a reader without access is indistinguishable from a
 * club with none, and deliberately so.
 */
export async function getClubEntitlements(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<GrantedEntitlement[]> {
  const { data, error } = await supabase.rpc("club_entitlements", { p_club_id: clubId })

  if (error || !data) return []

  return data.map((row) => ({
    key: row.entitlement_key as EntitlementKey,
    source: row.source as EntitlementSource,
  }))
}

export async function clubHasEntitlement(
  supabase: SupabaseClient<Database>,
  clubId: string,
  key: EntitlementKey
): Promise<boolean> {
  const { data, error } = await supabase.rpc("club_has_entitlement", {
    p_club_id: clubId,
    p_entitlement_key: key,
  })

  // Fail closed. An unreadable answer is not a grant.
  if (error) return false
  return data === true
}

export class EntitlementRequiredError extends Error {
  readonly entitlement: EntitlementKey

  constructor(entitlement: EntitlementKey) {
    super(`This club's Ovalball plan does not include ${entitlement}.`)
    this.name = "EntitlementRequiredError"
    this.entitlement = entitlement
  }
}

/**
 * Use at the top of a server action or route handler that performs a gated
 * operation, so the gate sits next to the work rather than next to the
 * button that starts it.
 */
export async function requireEntitlement(
  supabase: SupabaseClient<Database>,
  clubId: string,
  key: EntitlementKey
): Promise<void> {
  if (!(await clubHasEntitlement(supabase, clubId, key))) {
    throw new EntitlementRequiredError(key)
  }
}
