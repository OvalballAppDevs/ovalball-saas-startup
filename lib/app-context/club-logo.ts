import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

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
  return club.logo_storage_path ?? club.club_directory?.logo_storage_path ?? null
}

/** resolveClubLogoPath() plus the public-URL lookup, for the common case of a single club record on hand. */
export function resolveClubLogoUrl(
  supabase: SupabaseClient<Database>,
  club: { logo_storage_path: string | null; club_directory?: { logo_storage_path: string | null } | null } | null | undefined
): string | null {
  if (!club) return null
  const path = resolveClubLogoPath(club)
  return path ? supabase.storage.from("club-logos").getPublicUrl(path).data.publicUrl : null
}
