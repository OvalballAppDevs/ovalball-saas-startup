import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * Whether a person has completed their own details.
 *
 * Every authentication identity has a profile from the moment it is created
 * (internal.create_profile_for_identity). A profile that exists therefore no
 * longer means "this person finished signing up": the profile holds a place
 * with setup_state PENDING_DETAILS until they supply their details, and the
 * first profile insert completes it.
 *
 * Reads `*` rather than naming setup_state so the same code works against a
 * database that predates the column, where an existing profile was always a
 * completed one. That is what lets this release ship before the migration.
 */
export async function hasCompletedProfile(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle()
  if (!data) return false
  const setupState = (data as { setup_state?: string | null }).setup_state
  return setupState === undefined || setupState === null || setupState === "COMPLETE"
}
