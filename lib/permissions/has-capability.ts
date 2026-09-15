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
  async (
    supabase: Client,
    scopeType: CapabilityScopeType | "self" | "child",
    clubId: string | null,
    teamId: string | null,
    playerId: string | null = null,
  ): Promise<Map<string, boolean>> => {
    const { data, error } = await supabase.rpc("my_capabilities", {
      p_scope_type: scopeType,
      p_club_id: clubId ?? undefined,
      p_team_id: teamId ?? undefined,
      p_player_id: playerId ?? undefined,
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

/**
 * The same question about one player (Identity/Auth Slice 4a, Phase 2 J.6 SE / LC): true when the signed-in person
 * holds the key for that player as the player themselves or as one of their ACTIVE guardians. Club and team staff
 * authority over a player is asked at the player's club or team through hasCapability instead.
 */
export async function hasPlayerCapability(supabase: Client, capabilityKey: string, playerId: string | null | undefined): Promise<boolean> {
  if (!playerId) return false
  const [asGuardian, asSelf] = await Promise.all([
    myCapabilitiesAt(supabase, "child", null, null, playerId),
    myCapabilitiesAt(supabase, "self", null, null, playerId),
  ])
  return asGuardian.get(capabilityKey) === true || asSelf.get(capabilityKey) === true
}

/** A self-scope key that is not about a particular player (for example family.child.add). */
export async function hasSelfCapability(supabase: Client, capabilityKey: string): Promise<boolean> {
  return (await myCapabilitiesAt(supabase, "self", null, null, null)).get(capabilityKey) === true
}
