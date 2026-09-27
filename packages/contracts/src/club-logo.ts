import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./database"

/**
 * The one canonical rule for "which stored path is this club's logo":
 * the operational club's own upload (`clubs.logo_storage_path`, set via
 * Club Settings) if the club has claimed one, otherwise the Club
 * Directory's seed/branding logo (`club_directory.logo_storage_path`) for
 * a club that hasn't uploaded its own yet. Found duplicated ad hoc across
 * ~14 call sites (some applying the fallback, some silently only reading
 * `clubs.logo_storage_path` and showing no logo at all for a directory-only
 * club) -- this function and resolveClubLogoUrl are the two call sites
 * every consumer should route through instead of re-deriving it.
 */
export function resolveClubLogoPath(club: {
  logo_storage_path: string | null
  club_directory?: { logo_storage_path: string | null } | null
}): string | null {
  return resolveClubLogoPathFrom(club.logo_storage_path, club.club_directory?.logo_storage_path)
}

/**
 * The same rule, for callers that do not have the nested shape.
 *
 * Convergence Step 6 found the `??` chain written out by hand in four more
 * places. Three of them were not reachable through resolveClubLogoPath at all,
 * for honest reasons rather than laziness:
 *
 *   - `admin_club_overview` flattens the join, so the directory path arrives as
 *     `directory_logo_storage_path` rather than a nested object;
 *   - a fixture's OPPONENT may be an unclaimed club with no `clubs` row, in
 *     which case the fallback is the directory row the fixture itself points at
 *     (`fixtures.opponent_directory_id`) rather than the nested directory of a
 *     club record that does not exist.
 *
 * Those are two call SHAPES of one rule, not two rules, so the rule lives here
 * once and the shapes are named. What is not acceptable is a fifth copy of
 * `a ?? b` somewhere else: that is how a resolver acquires a third source, or a
 * deactivated-club rule, in four places and misses one.
 */
export function resolveClubLogoPathFrom(
  clubPath: string | null | undefined,
  directoryPath: string | null | undefined
): string | null {
  return clubPath ?? directoryPath ?? null
}

/** resolveClubLogoPath() plus the public-URL lookup, for the common case of a single club record on hand. */
export function resolveClubLogoUrl(
  supabase: SupabaseClient<Database>,
  club: { logo_storage_path: string | null; club_directory?: { logo_storage_path: string | null } | null } | null | undefined
): string | null {
  if (!club) return null
  const path = resolveClubLogoPath(club)
  return clubLogoUrlFromPath(supabase, path)
}

/** The storage lookup on its own, for callers that resolved the path with resolveClubLogoPathFrom. */
export function clubLogoUrlFromPath(supabase: SupabaseClient<Database>, path: string | null): string | null {
  return path ? supabase.storage.from("club-logos").getPublicUrl(path).data.publicUrl : null
}

/**
 * THE PUBLIC PROFILE COVER PHOTO -- a separate, optional, presentation-only field
 * (`clubs.cover_storage_path`), never the crest and never club identity. There is no directory-level
 * fallback the way a logo has one: a directory-only (never-activated) club has no `clubs` row at all,
 * and never had a cover concept to fall back to.
 */
export function clubCoverUrlFromPath(supabase: SupabaseClient<Database>, path: string | null): string | null {
  return path ? supabase.storage.from("club-covers").getPublicUrl(path).data.publicUrl : null
}
