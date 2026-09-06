import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * Ovalball's own operating mode.
 *
 * `beta` means Ovalball is not charging clubs: no platform subscription is
 * billed and trial time does not accrue. `live` means it is.
 *
 * This has NOTHING to do with a club charging its own members. That domain
 * (`club_subscription_*`, `gocardless_*`) never reads this value, and never
 * should — see docs/COMMERCIAL_PLATFORM_ARCHITECTURE.md.
 */
export type PlatformMode = "beta" | "live"

export interface PlatformModeState {
  mode: PlatformMode
  /** When the current mode began. Null only if the history is unreadable. */
  since: string | null
}

/**
 * Beta is the safe answer when the mode cannot be read: it means Ovalball
 * does not bill. A database blip must never be the reason a club gets
 * charged.
 */
const SAFE_DEFAULT: PlatformModeState = { mode: "beta", since: null }

export async function getPlatformMode(
  supabase: SupabaseClient<Database>
): Promise<PlatformModeState> {
  const { data, error } = await supabase.rpc("current_platform_mode")

  if (error || !data || data.length === 0) return SAFE_DEFAULT

  const row = data[0]
  return {
    mode: row.mode === "live" ? "live" : "beta",
    since: row.since ?? null,
  }
}

export function isBeta(state: PlatformModeState): boolean {
  return state.mode === "beta"
}
