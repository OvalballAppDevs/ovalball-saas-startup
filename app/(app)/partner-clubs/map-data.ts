"use server"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"
import { resolveClubLogoPath } from "@/lib/app-context/club-logo"
import { createClient } from "@/lib/supabase/server"

type DirectoryRow = {
  id: string
  name: string
  rugby_code: string
  town: string | null
  county: string | null
  postcode: string | null
  latitude: number | null
  longitude: number | null
  geocode_status: string
  logo_storage_path: string | null
  clubs: { logo_storage_path: string | null } | null
}

/**
 * club_directory has 1,390+ active rows -- past PostgREST's default
 * 1000-row response cap -- so the map's full dataset needs paging, the
 * same fix applied to the geocoding backfill for the same reason.
 */
async function fetchAllDirectoryRows(supabase: SupabaseClient<Database>): Promise<DirectoryRow[]> {
  const rows: DirectoryRow[] = []
  const PAGE_SIZE = 1000
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("club_directory")
      .select("id, name, rugby_code, town, county, postcode, latitude, longitude, geocode_status, logo_storage_path, clubs(logo_storage_path)")
      .eq("active", true)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (error || !data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return rows
}

export type MapClubPartnershipStatus = "none" | "pending_outgoing" | "pending_incoming" | "active"

export interface MapClub {
  directoryId: string
  clubId: string | null
  name: string
  rugbyCode: string
  town: string | null
  county: string | null
  postcode: string | null
  latitude: number | null
  longitude: number | null
  hasLocation: boolean
  logoUrl: string | null
  slug: string | null
  isOwnClub: boolean
  partnershipStatus: MapClubPartnershipStatus
  partnershipId: string | null
}

/**
 * The map's single data source -- every active club_directory row (not
 * just activated ones), with three things layered on top of the canonical
 * record: whether it's actually "On Ovalball" (a clubs row exists, the
 * real activation signal -- club_directory.active means something
 * different, "still a current entry in the registry"), whether it's a
 * partner of the caller's own club (reusing club_partnerships exactly as
 * partner-clubs/page.tsx already reads it -- no second partnership
 * model), and its cached map location if geocoding succeeded. Rows
 * without a resolved location are still included (hasLocation: false) so
 * the list/search panel can surface them as "Location unavailable"
 * instead of silently dropping them.
 */
export async function getPartnerClubsMapData(callerClubId: string): Promise<MapClub[]> {
  const supabase = await createClient()

  const [directoryRows, { data: activatedClubs }, { data: partnerships }] = await Promise.all([
    fetchAllDirectoryRows(supabase),
    supabase.from("clubs").select("id, directory_id, slug").eq("status", "active"),
    supabase
      .from("club_partnerships")
      .select("id, requesting_club_id, partner_club_id, status")
      .or(`requesting_club_id.eq.${callerClubId},partner_club_id.eq.${callerClubId}`)
      .neq("status", "revoked"),
  ])

  const clubIdByDirectoryId = new Map((activatedClubs ?? []).map((c) => [c.directory_id, c.id]))
  const slugByDirectoryId = new Map((activatedClubs ?? []).map((c) => [c.directory_id, c.slug]))

  const partnershipByClubId = new Map<
    string,
    { status: MapClubPartnershipStatus; partnershipId: string }
  >()
  for (const p of partnerships ?? []) {
    const otherClubId = p.requesting_club_id === callerClubId ? p.partner_club_id : p.requesting_club_id
    const status: MapClubPartnershipStatus =
      p.status === "active" ? "active" : p.requesting_club_id === callerClubId ? "pending_outgoing" : "pending_incoming"
    partnershipByClubId.set(otherClubId, { status, partnershipId: p.id })
  }

  return directoryRows.map((row): MapClub => {
    const clubId = clubIdByDirectoryId.get(row.id) ?? null
    const partnership = clubId ? partnershipByClubId.get(clubId) : undefined
    return {
      directoryId: row.id,
      clubId,
      name: row.name,
      rugbyCode: row.rugby_code,
      town: row.town,
      county: row.county,
      postcode: row.postcode,
      latitude: row.geocode_status === "success" ? row.latitude : null,
      longitude: row.geocode_status === "success" ? row.longitude : null,
      hasLocation: row.geocode_status === "success",
      // The operational club's own uploaded logo takes priority over the
      // directory seed (resolveClubLogoPath's canonical rule) -- this
      // query starts FROM club_directory (every club, claimed or not,
      // 1,390+ rows), so the precedence is expressed by constructing the
      // same shape resolveClubLogoPath expects from the reverse-joined
      // `clubs` embed, rather than duplicating the ?? logic inline.
      logoUrl: (() => {
        const path = resolveClubLogoPath({ logo_storage_path: row.clubs?.logo_storage_path ?? null, club_directory: { logo_storage_path: row.logo_storage_path } })
        return path ? supabase.storage.from("club-logos").getPublicUrl(path).data.publicUrl : null
      })(),
      slug: slugByDirectoryId.get(row.id) ?? null,
      isOwnClub: clubId === callerClubId,
      partnershipStatus: partnership?.status ?? "none",
      partnershipId: partnership?.partnershipId ?? null,
    }
  })
}
