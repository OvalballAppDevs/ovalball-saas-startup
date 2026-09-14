import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { resolveClubLogoUrl } from "@/lib/app-context/club-logo"
import { hasCapability } from "@/lib/permissions/has-capability"
import type { Database } from "@/types/database.types"

import { listLiveAnnouncements, type ClubAnnouncement } from "./announcements"
import { getLeadArticle, listPublishedArticles, type ArticleCard } from "./articles"
import { loadPublicClub, type PublicClub } from "./club"
import { deskManageHref } from "./desk"

/**
 * THE CLUB DESK: the club home, inside the signed-in dashboard.
 *
 * Built from the same canonical sources as the public page -- the home-kit
 * theme, the live-announcements query, the public news layer -- so a club
 * that changes its kit or publishes a story changes both at once. Everything
 * is read as the signed-in person, so RLS adds the club's members-only notices
 * and stories for people who belong there and nobody else.
 */

export interface ClubDesk {
  club: PublicClub
  notices: ClubAnnouncement[]
  news: ArticleCard[]
  manageHref: string | null
}

export async function loadClubDesk(supabase: SupabaseClient<Database>, clubId: string, teamId: string | null): Promise<ClubDesk | null> {
  const { data } = await supabase.from("clubs").select("slug").eq("id", clubId).maybeSingle()
  if (!data?.slug) return null
  const club = await loadPublicClub(data.slug)
  if (!club) return null

  const [notices, lead, latest, clubAuthority, teamAuthority] = await Promise.all([
    listLiveAnnouncements(supabase, club.id, 6),
    getLeadArticle(supabase, club),
    listPublishedArticles(supabase, club, { limit: 5 }),
    hasCapability(supabase, "club.news.manage", "club", { clubId: club.id }),
    teamId ? hasCapability(supabase, "team.news.manage", "team", { clubId: club.id, teamId }) : Promise.resolve(false),
  ])

  const news = (lead ? [lead, ...latest.articles.filter((a) => a.id !== lead.id)] : latest.articles).slice(0, 4)

  return { club, notices, news, manageHref: deskManageHref({ club: clubAuthority, team: teamAuthority }, teamId) }
}

export interface FamilyClub {
  id: string
  slug: string
  name: string
  crestUrl: string | null
}

/** Every club a family view spans, for the "Your Clubs" card. */
export async function loadFamilyClubs(supabase: SupabaseClient<Database>, clubIds: string[]): Promise<FamilyClub[]> {
  if (clubIds.length === 0) return []
  const { data } = await supabase
    .from("clubs")
    .select("id, slug, logo_storage_path, club_directory(name, logo_storage_path)")
    .in("id", clubIds)
    .eq("status", "active")
  const byId = new Map((data ?? []).filter((c) => c.slug).map((c) => [c.id, c]))
  return clubIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({ id: c.id, slug: c.slug as string, name: c.club_directory?.name ?? "Club", crestUrl: resolveClubLogoUrl(supabase, c) }))
}
