import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * WHAT A CHILD MAY DO FOR THEMSELVES (CA-M9): the guardian permission grid, as a contract.
 *
 * `get_player_permission_summary` is the one read -- it lists the canonical keys with their labels,
 * the age band each applies to, whether the permission is in effect, and this guardian's own decision.
 * `set_guardian_player_permission` is the one write: append-only, unanimous-grant / deny-by-default
 * across the child's guardians, gated on `family.permission.manage` and an active guardian row. The
 * phone offers exactly what the website offers and decides nothing.
 */
export interface ChildPermission {
  key: string
  label: string
  description: string
  minAge: number | null
  maxAge: number | null
  /** In effect for the child right now (every guardian has granted it). */
  effective: boolean
  /** This guardian's own decision, where they have made one. */
  myDecision: boolean | null
  /** Another guardian has not yet answered. */
  coGuardiansPending: boolean
}

export async function readChildPermissions(supabase: Client, playerId: string): Promise<ChildPermission[]> {
  const { data, error } = await supabase.rpc("get_player_permission_summary", { p_player_id: playerId })
  if (error) throw error
  return (data ?? []).map((row) => ({
    key: row.permission_key,
    label: row.label,
    description: row.description ?? "",
    minAge: row.min_age ?? null,
    maxAge: row.max_age ?? null,
    effective: row.effective === true,
    myDecision: row.my_decision ?? null,
    coGuardiansPending: row.co_guardians_pending === true,
  }))
}

export async function setChildPermission(supabase: Client, playerId: string, key: string, granted: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_guardian_player_permission", { p_player_id: playerId, p_permission_key: key, p_granted: granted })
  if (error) throw error
}

/** "Ages 16 to 17" / "Under 18" / null -- the band in words, never a date. */
export function permissionAgeBand(p: Pick<ChildPermission, "minAge" | "maxAge">): string | null {
  if (p.minAge !== null && p.maxAge !== null) return `Ages ${p.minAge} to ${p.maxAge}`
  if (p.minAge !== null) return `From age ${p.minAge}`
  if (p.maxAge !== null) return `Up to age ${p.maxAge}`
  return null
}

/**
 * INVITE A CHILD TO THEIR OWN LOGIN -- the canonical invitation (`issue_invitation`, kind
 * PLAYER_ACCOUNT), never a family-specific one. The server decides whether this guardian may, whether
 * the child is old enough, and sends the email; the phone never sees or shows the token.
 */
export async function invitePlayerAccount(supabase: Client, playerId: string, email: string): Promise<{ alreadyExisted: boolean }> {
  const { data, error } = await supabase.rpc("issue_invitation", { p_kind: "PLAYER_ACCOUNT", p_player_id: playerId, p_email: email.trim() })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { alreadyExisted: row?.already_existed === true }
}
