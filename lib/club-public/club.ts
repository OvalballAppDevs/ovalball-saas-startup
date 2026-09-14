import "server-only"

import { cache } from "react"

import type { KitConfig, KitPattern } from "@/components/club/rugby-kit"
import { resolveClubLogoUrl } from "@/lib/app-context/club-logo"
import { resolveClubPublicProfile } from "@/lib/app-context/club-public-profile"
import { resolveClubTheme, type ClubTheme } from "@/lib/club-theme/theme"
import { createClient } from "@/lib/supabase/server"

/**
 * A club's public identity: the one loader every public club surface starts
 * from (the homepage, the news index, each article).
 *
 * Cached per request, so generateMetadata and the page share one read.
 * Everything selected here is already publicly readable under existing RLS
 * (clubs_select for active clubs, club_directory, club_kits) -- this runs as
 * the visitor, never as a service role.
 */

export interface PublicClub {
  id: string
  slug: string
  name: string
  rugbyCode: "union" | "league" | null
  place: string | null
  crestUrl: string | null
  bio: string | null
  website: string | null
  facebookUrl: string | null
  homeGround: string | null
  address: string | null
  postcode: string | null
  homeKit: KitConfig | null
  theme: ClubTheme
}

export const loadPublicClub = cache(async (slug: string): Promise<PublicClub | null> => {
  const supabase = await createClient()
  const { data: club } = await supabase
    .from("clubs")
    .select(
      "id, slug, bio, website, facebook_url, address_display, logo_storage_path, show_website, show_home_ground, show_address, show_postcode, club_directory(name, town, county, nation, home_ground, rugby_code, postcode, logo_storage_path, bio, website, facebook_url)"
    )
    .eq("slug", slug)
    .eq("status", "active")
    .maybeSingle()
  if (!club || !club.slug) return null

  // The HOME kit is the canonical source of the club's digital branding.
  const { data: kit } = await supabase
    .from("club_kits")
    .select("pattern, primary_colour, secondary_colour, accent_colour")
    .eq("club_id", club.id)
    .eq("variant", "primary")
    .maybeSingle()

  const directory = club.club_directory
  const profile = resolveClubPublicProfile(club)
  const code = directory?.rugby_code === "union" || directory?.rugby_code === "league" ? directory.rugby_code : null

  const homeKit: KitConfig | null = kit
    ? {
        pattern: kit.pattern as KitPattern,
        primaryColour: kit.primary_colour,
        secondaryColour: kit.secondary_colour,
        accentColour: kit.accent_colour,
      }
    : null

  return {
    id: club.id,
    slug: club.slug,
    name: directory?.name ?? "Rugby club",
    rugbyCode: code,
    place: [directory?.town, directory?.county].filter(Boolean).join(", ") || null,
    crestUrl: resolveClubLogoUrl(supabase, club),
    bio: profile.bio,
    // The club's own visibility choices decide what a stranger sees.
    website: club.show_website ? profile.website : null,
    facebookUrl: profile.facebookUrl,
    homeGround: club.show_home_ground ? (directory?.home_ground ?? null) : null,
    address: club.show_address ? club.address_display : null,
    postcode: club.show_postcode ? (directory?.postcode ?? null) : null,
    homeKit,
    theme: resolveClubTheme(
      homeKit && {
        pattern: homeKit.pattern,
        primaryColour: homeKit.primaryColour,
        secondaryColour: homeKit.secondaryColour,
        accentColour: homeKit.accentColour,
      }
    ),
  }
})

export const RUGBY_CODE_LABEL: Record<string, string> = { union: "Rugby Union", league: "Rugby League" }
