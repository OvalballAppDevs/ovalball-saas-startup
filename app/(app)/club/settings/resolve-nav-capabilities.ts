import type { SupabaseClient } from "@supabase/supabase-js"

import { hasCapability } from "@/lib/permissions/has-capability"
import type { Database } from "@/types/database.types"

/**
 * Single canonical computation of Club Settings section visibility.
 *
 * Before this, every page that renders <ClubSettingsNav> independently
 * re-derived the same ~10 capability booleans in its own Promise.all. When
 * the Safeguarding Officer tab was added, only club-settings-nav.tsx and
 * the safeguarding page itself were updated -- the other ten call sites
 * kept their own frozen copy of the list and never grew a
 * club.safeguarding.view check, so the tab silently failed to appear
 * anywhere else. That failure mode repeats for every future tab unless the
 * computation lives in exactly one place. This function is that place --
 * every ClubSettingsNav consumer calls it instead of re-declaring its own
 * Promise.all, so a new tab is added once and appears everywhere at once.
 *
 * Each field maps to one real capability check via the canonical Scoped
 * Capability Engine (internal.has_capability) -- never a combined
 * "isClubAdmin" flag -- so a Site Admin deny/grant override on any single
 * capability continues to affect exactly the one tab it names. Presentation
 * only: authorization is still enforced independently by each destination
 * page's own server-side guard (and by RLS underneath it), regardless of
 * which tabs a tampered or stale client render shows.
 */
export interface ClubSettingsNavCapabilities {
  canProfile: boolean
  canPitchesManage: boolean
  canTeams: boolean
  canVenues: boolean
  canRollover: boolean
  canFixtureEdit: boolean
  canPitchAllocation: boolean
  canFixtureCallups: boolean
  canPlayerDispensations: boolean
  canPlayerMoves: boolean
  canGuardians: boolean
  canSafeguarding: boolean
  canSubscriptionConfigure: boolean
  canSubscriptionViewFinance: boolean
  canSubscriptions: boolean
  canPlatformBillingView: boolean
  canOvalballBilling: boolean
}

const EMPTY: ClubSettingsNavCapabilities = {
  canProfile: false,
  canPitchesManage: false,
  canTeams: false,
  canVenues: false,
  canRollover: false,
  canFixtureEdit: false,
  canPitchAllocation: false,
  canFixtureCallups: false,
  canPlayerDispensations: false,
  canPlayerMoves: false,
  canGuardians: false,
  canSafeguarding: false,
  canSubscriptionConfigure: false,
  canSubscriptionViewFinance: false,
  canSubscriptions: false,
  canPlatformBillingView: false,
  canOvalballBilling: false,
}

export async function resolveClubSettingsNavCapabilities(
  supabase: SupabaseClient<Database>,
  clubId: string | null
): Promise<ClubSettingsNavCapabilities> {
  if (!clubId) return EMPTY

  const [
    canProfile,
    canPitchesManage,
    canVenues,
    canRollover,
    canFixtureEdit,
    canFixtureCallups,
    canPlayerDispensations,
    canGuardians,
    canSafeguarding,
    canSubscriptionConfigure,
    canSubscriptionViewFinance,
    canPlatformBillingView,
  ] = await Promise.all([
    hasCapability(supabase, "club.edit_profile", "club", { clubId }),
    hasCapability(supabase, "club.pitches.manage", "club", { clubId }),
    hasCapability(supabase, "club.venues.manage", "club", { clubId }),
    hasCapability(supabase, "club.season_rollover.manage", "club", { clubId }),
    hasCapability(supabase, "fixture.edit", "club", { clubId }),
    hasCapability(supabase, "manage_fixture_callups", "club", { clubId }),
    hasCapability(supabase, "manage_player_dispensations", "club", { clubId }),
    hasCapability(supabase, "club.guardians.manage", "club", { clubId }),
    hasCapability(supabase, "club.safeguarding.view", "club", { clubId }),
    hasCapability(supabase, "club.subscription.configure", "club", { clubId }),
    hasCapability(supabase, "club.subscription.view_finance", "club", { clubId }),
    hasCapability(supabase, "club.platform_billing.view", "club", { clubId }),
  ])

  return {
    canProfile,
    canPitchesManage,
    canTeams: canProfile || canPitchesManage,
    canVenues,
    canRollover,
    canFixtureEdit,
    canPitchAllocation: canFixtureEdit,
    canFixtureCallups,
    canPlayerDispensations,
    // Previously inconsistent across pages: most nav call sites treated
    // "Player Moves" visibility as manage_fixture_callups alone, while the
    // /club/player-moves page's own content gate always used
    // manage_fixture_callups OR manage_player_dispensations. A user
    // holding only the dispensations capability could reach the page
    // directly but never see its tab elsewhere. Unified on the OR here.
    canPlayerMoves: canFixtureCallups || canPlayerDispensations,
    canGuardians,
    canSafeguarding,
    canSubscriptionConfigure,
    canSubscriptionViewFinance,
    canSubscriptions: canSubscriptionConfigure || canSubscriptionViewFinance,
    canPlatformBillingView,
    canOvalballBilling: canPlatformBillingView,
  }
}
