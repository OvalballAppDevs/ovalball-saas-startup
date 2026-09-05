import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

export type CapabilityScopeType = "site" | "club" | "team"

/**
 * The one server-side entry point to the canonical scoped capability
 * engine (Master Architecture Pass, "Canonical Scoped Capability Engine").
 * Calls the SAME `internal.has_capability()` primitive every rewired RLS
 * policy uses -- via the thin `public.has_capability` RPC wrapper, since
 * the `internal` schema is never exposed to PostgREST. Never re-derive
 * capability logic in a page or component; call this instead.
 *
 * This is a UI/UX and defense-in-depth convenience, not the authorization
 * boundary itself -- RLS enforces the real boundary independently on
 * every write this engine covers, so a stale or tampered client call
 * here can hide a control but never grant the mutation behind it.
 */
export async function hasCapability(
  supabase: SupabaseClient<Database>,
  capabilityKey: string,
  scopeType: CapabilityScopeType,
  scope: { clubId?: string | null; teamId?: string | null } = {}
): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_capability", {
    p_capability_key: capabilityKey,
    p_scope_type: scopeType,
    p_club_id: scope.clubId ?? undefined,
    p_team_id: scope.teamId ?? undefined,
  })
  if (error) {
    console.error("hasCapability RPC failed:", error)
    return false
  }
  return data === true
}
