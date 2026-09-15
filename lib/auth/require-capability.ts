import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { cache } from "react"

import { hasCapability, hasPlayerCapability, hasSelfCapability, type CapabilityScopeType } from "@/lib/permissions/has-capability"
import type { Database } from "@/types/database.types"

type Client = SupabaseClient<Database>

export type CapabilityCheck = { ok: true } | { ok: false; error: string }

const NOT_AUTHORISED = "You are not authorised to do that."

/**
 * Early refusal for a server action (Phase 2 AA.5). It asks the same database
 * resolver the RPC behind the action asks again, so it can refuse sooner and
 * more clearly, but it is never the only check.
 */
export async function requireCapability(
  supabase: Client,
  capabilityKey: string,
  scopeType: Exclude<CapabilityScopeType, "site">,
  scope: { clubId: string; teamId?: string | null },
): Promise<CapabilityCheck> {
  return (await hasCapability(supabase, capabilityKey, scopeType, scope)) ? { ok: true } : { ok: false, error: NOT_AUTHORISED }
}

/** Early refusal for an action about one player, as the player themselves or an ACTIVE guardian (J.6 SE / LC). */
export async function requirePlayerCapability(supabase: Client, capabilityKey: string, playerId: string): Promise<CapabilityCheck> {
  return (await hasPlayerCapability(supabase, capabilityKey, playerId)) ? { ok: true } : { ok: false, error: NOT_AUTHORISED }
}

/** Early refusal for a self-scope action that names no player (for example family.child.add). */
export async function requireSelfCapability(supabase: Client, capabilityKey: string): Promise<CapabilityCheck> {
  return (await hasSelfCapability(supabase, capabilityKey)) ? { ok: true } : { ok: false, error: NOT_AUTHORISED }
}

/**
 * The site capabilities the signed-in person holds right now: their Site Admin
 * profile's bundle plus any add-on grants (Phase 2 R, SA-4). Site Admin
 * navigation and controls render from this; the database re-checks every action.
 */
export const mySiteCapabilities = cache(async (supabase: Client): Promise<Set<string>> => {
  const { data, error } = await supabase.rpc("my_site_capabilities")
  if (error) {
    console.error("my_site_capabilities RPC failed:", error)
    return new Set()
  }
  return new Set((data ?? []) as string[])
})

export async function requireSiteCapability(supabase: Client, capabilityKey: string): Promise<CapabilityCheck> {
  return (await mySiteCapabilities(supabase)).has(capabilityKey) ? { ok: true } : { ok: false, error: NOT_AUTHORISED }
}

/**
 * Recording a player's missing gender (Phase 2 J.6 player.profile.edit_protected, set-once rule): the player
 * themselves or an ACTIVE guardian of this child, or Ovalball through site.users.identity.correct. The Player Details
 * page decides whether to OFFER the form with this, and setPlayerGender refuses early with the same answer;
 * set_player_playing_pathway decides. No team place is involved: family authority derives from the child.
 */
export async function mayRecordPlayerGender(supabase: Client, playerId: string): Promise<boolean> {
  if (await hasPlayerCapability(supabase, "player.profile.edit_protected", playerId)) return true
  return (await mySiteCapabilities(supabase)).has("site.users.identity.correct")
}

export async function requireMayRecordPlayerGender(supabase: Client, playerId: string): Promise<CapabilityCheck> {
  return (await mayRecordPlayerGender(supabase, playerId)) ? { ok: true } : { ok: false, error: NOT_AUTHORISED }
}

export interface AccessExplanation {
  allowed: boolean
  decisiveRule: string
  reasonCode: string
  source: Record<string, unknown> | null
  trail: Record<string, unknown>[]
}

/**
 * Why a person can or cannot do something (Phase 2 AC), from the one decision
 * function. The database decides who may see an explanation: the person
 * themselves, whoever may explain access where that person belongs, or a Site
 * Admin with site.users.view.
 */
export async function explainAccess(
  supabase: Client,
  subjectUserId: string,
  capabilityKey: string,
  scopeType: CapabilityScopeType | "self" | "child",
  scope: { clubId?: string | null; teamId?: string | null; playerId?: string | null } = {},
): Promise<AccessExplanation | null> {
  const { data, error } = await supabase.rpc("explain_access", {
    p_subject: subjectUserId,
    p_capability_key: capabilityKey,
    p_scope_type: scopeType,
    p_club_id: scope.clubId ?? undefined,
    p_team_id: scope.teamId ?? undefined,
    p_player_id: scope.playerId ?? undefined,
  })
  const row = data?.[0]
  if (error || !row) return null
  return {
    allowed: row.allowed === true,
    decisiveRule: row.decisive_rule ?? "",
    reasonCode: row.reason_code ?? "",
    source: (row.decisive_source as Record<string, unknown> | null) ?? null,
    trail: (row.trail as Record<string, unknown>[] | null) ?? [],
  }
}
