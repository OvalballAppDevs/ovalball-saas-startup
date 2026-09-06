import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import { createClient } from "@/lib/supabase/server"

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

export interface BetaBadgeState {
  mode: PlatformMode
  /** The currently published release, e.g. "0.0.1". Null when none is published. */
  releaseVersion: string | null
}

/**
 * The one source every Beta badge reads — public homepage, authenticated
 * shell, admin console alike. There is deliberately no client-owned Beta
 * flag anywhere in the product: a badge that could disagree with the
 * database about whether clubs are being charged would be worse than no
 * badge.
 *
 * Fails to `beta` when the mode cannot be read, for the same reason
 * getPlatformMode does: Beta is the mode that does not bill, so an
 * unreadable answer must not silently present the product as Live.
 */
export async function getBetaBadgeState(
  /** Optional: public pages have no client of their own to pass. */
  client?: SupabaseClient<Database>
): Promise<BetaBadgeState> {
  const supabase = client ?? (await createClient())
  const { data, error } = await supabase.rpc("platform_public_state")

  if (error || !data || data.length === 0) return { mode: "beta", releaseVersion: null }

  const row = data[0]
  return {
    mode: row.mode === "live" ? "live" : "beta",
    releaseVersion: row.release_version,
  }
}
