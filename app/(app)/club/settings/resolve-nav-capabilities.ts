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
  /** May decide who at this club holds the operational capabilities. */
  canPermissions: boolean
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
  /** May publish the club's news and announcements (club.news.manage). */
  canNews: boolean
}

const EMPTY: ClubSettingsNavCapabilities = {
  canPermissions: false,
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
  canNews: false,
}

export async function resolveClubSettingsNavCapabilities(
  supabase: SupabaseClient<Database>,
  clubId: string | null
): Promise<ClubSettingsNavCapabilities> {
  if (!clubId) return EMPTY

  // Each answer is named beside its own check. A positional destructure of this list once drifted by one entry
  // when a check was inserted, which silently handed every later tab the previous tab's answer (the Guardians &
  // Players gate read the player-dispensations answer). Named pairs cannot drift.
  const checks = {
    canProfile: "club.edit_profile",
    canPitchesManage: "venue.pitch.manage",
    canVenues: "venue.venue.manage",
    canRollover: "club.season_rollover.manage",
    canPermissions: "club.capabilities.manage",
    canFixtureEdit: "fixture.edit",
    canFixtureCallups: "manage_fixture_callups",
    canPlayerDispensations: "manage_player_dispensations",
    // Identity/Auth Slice 4a: guardian administration at club level is family.relationship.approve (Phase 2 J.6)
    canGuardians: "family.relationship.approve",
    // Identity/Auth Slice 4G: the transitional club.safeguarding.view key is retired (AA.3 row 4g).
    // The club-settings tab is where the OFFICER is managed, so its gate is the nomination capability
    // — not safeguarding.contact.view, which J.12 gives to most of a club including parents and would
    // put a club administration tab in front of all of them.
    canSafeguarding: "safeguarding.officer.nominate",
    canSubscriptionConfigure: "club.subscription.configure",
    canSubscriptionViewFinance: "club.subscription.view_finance",
    canPlatformBillingView: "club.platform_billing.view",
    canNews: "club.news.manage",
  } as const
  const entries = Object.entries(checks) as [keyof typeof checks, string][]
  const answers = await Promise.all(entries.map(([, key]) => hasCapability(supabase, key, "club", { clubId })))
  const answer = Object.fromEntries(entries.map(([name], i) => [name, answers[i]])) as Record<keyof typeof checks, boolean>
  const {
    canProfile,
    canPitchesManage,
    canVenues,
    canRollover,
    canPermissions,
    canFixtureEdit,
    canFixtureCallups,
    canPlayerDispensations,
    canGuardians,
    canSafeguarding,
    canSubscriptionConfigure,
    canSubscriptionViewFinance,
    canPlatformBillingView,
    canNews,
  } = answer

  return {
    canPermissions,
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
    canNews,
  }
}
