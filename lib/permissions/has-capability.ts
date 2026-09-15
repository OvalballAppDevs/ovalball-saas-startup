import type { SupabaseClient } from "@supabase/supabase-js"
import { cache } from "react"

import type { Database } from "@/types/database.types"

export type CapabilityScopeType = "site" | "club" | "team"

type Client = SupabaseClient<Database>

/**
 * Every answer the signed-in person holds at one scope, from the ONE canonical
 * resolver (internal.capability_decision) through public.my_capabilities.
 * Canonical keys and the legacy keys the app still names are both present, so a
 * caller asking "club.edit_profile" and one asking "club.profile.edit" get the
 * same decision.
 *
 * Cached per request (React cache keys on the client and the scope), so a page
 * that asks twenty questions about one club makes one round trip.
 */
const myCapabilitiesAt = cache(
  async (supabase: Client, scopeType: CapabilityScopeType, clubId: string | null, teamId: string | null): Promise<Map<string, boolean>> => {
    const { data, error } = await supabase.rpc("my_capabilities", {
      p_scope_type: scopeType,
      p_club_id: clubId ?? undefined,
      p_team_id: teamId ?? undefined,
    })
    if (error) {
      console.error("my_capabilities RPC failed:", error)
      return new Map()
    }
    return new Map((data ?? []).map((row) => [row.capability_key, row.allowed === true]))
  },
)

/**
 * The one server-side question "may this person do this, here?" for the
 * interface. It decides what to SHOW. The database decides what HAPPENS: every
 * policy and RPC re-checks through the same resolver, so a stale or tampered
 * call here can hide a control but never grant the action behind it.
 */
export async function hasCapability(
  supabase: Client,
  capabilityKey: string,
  scopeType: CapabilityScopeType,
  scope: { clubId?: string | null; teamId?: string | null } = {},
): Promise<boolean> {
  if (scopeType === "club" && !scope.clubId) return false
  if (scopeType === "team" && (!scope.clubId || !scope.teamId)) return false
  const answers = await myCapabilitiesAt(
    supabase,
    scopeType,
    scopeType === "site" ? null : (scope.clubId ?? null),
    scopeType === "team" ? (scope.teamId ?? null) : null,
  )
  return answers.get(capabilityKey) === true
}
