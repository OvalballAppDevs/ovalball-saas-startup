import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

export type TeamSeasonIdentity = {
  category: string
  ageGroup: string | null
  squadDesignation: string | null
  gender: string | null
  displayName: string
  isProjected: boolean
}

/**
 * Server-side batch loader for get_team_identity_for_season(): given a
 * set of (teamId, seasonId) pairs -- typically one per fixture/training
 * session a page is rendering -- resolves every team's real age-grade
 * identity DURING that season in one round trip, keyed by
 * "<teamId>:<seasonId>". Callers should read a team's display label
 * through this instead of a live teams.display_name/age_group join,
 * whenever the surface has a specific fixture or season in hand -- a
 * team's age can change at Season Handover, and this is what keeps a
 * past or future fixture showing the age it actually was/will be
 * rather than whatever the team's row currently says.
 */
export async function loadTeamIdentitiesForSeason(
  supabase: SupabaseClient<Database>,
  pairs: { teamId: string; seasonId: string }[],
): Promise<Map<string, TeamSeasonIdentity>> {
  const result = new Map<string, TeamSeasonIdentity>()
  if (pairs.length === 0) return result

  const seen = new Set<string>()
  const uniquePairs = pairs.filter((p) => {
    const key = `${p.teamId}:${p.seasonId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const { data } = await supabase.rpc("get_team_identities_for_season_batch", {
    p_pairs: uniquePairs.map((p) => ({ team_id: p.teamId, season_id: p.seasonId })),
  })

  for (const row of data ?? []) {
    result.set(`${row.team_id}:${row.season_id}`, {
      category: row.category,
      ageGroup: row.age_group,
      squadDesignation: row.squad_designation,
      gender: row.gender,
      displayName: row.display_name,
      isProjected: row.is_projected,
    })
  }
  return result
}

/**
 * The public counterpart for signed-out pages: a team's display name in each
 * fixture's season, keyed by "<teamId>:<seasonId>". It goes through
 * get_public_team_season_names, which answers only for (team, season) pairs
 * that appear in public_club_fixtures and returns nothing but the name, so
 * an anonymous visitor never needs to read teams or the broad resolver.
 * Signed-in pages use loadTeamIdentitiesForSeason.
 */
export async function loadPublicTeamSeasonNames(
  supabase: SupabaseClient<Database>,
  pairs: { teamId: string; seasonId: string }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const unique = [...new Map(pairs.map((p) => [`${p.teamId}:${p.seasonId}`, p])).values()]
  if (unique.length === 0) return result

  const { data } = await supabase.rpc("get_public_team_season_names", {
    p_pairs: unique.map((p) => ({ team_id: p.teamId, season_id: p.seasonId })),
  })

  for (const row of data ?? []) {
    result.set(`${row.team_id}:${row.season_id}`, row.display_name)
  }
  return result
}

export function teamIdentityKey(teamId: string, seasonId: string): string {
  return `${teamId}:${seasonId}`
}
