import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { clubLogoUrlFromPath, resolveClubLogoPathFrom } from "../club-logo"

type Client = SupabaseClient<Database>

/**
 * CLUBHOUSE'S ONE SHARED MAP/LIST READ MODEL (owner product decision: Clubhouse is the canonical
 * network surface, consolidating the former web-only `/partner-clubs` map -- see
 * `docs/product/OVALBALL_CLUBHOUSE_ARCHITECTURE_AUDIT.md` section 6-7).
 *
 * This is the SAME query shape `app/(app)/partner-clubs/map-data.ts` (`getPartnerClubsMapData`) already
 * proved correct, generalised out of a Next.js Server Action so both clients call one function instead
 * of the web keeping its own copy while mobile invents a second. Nothing about the query changed:
 * `club_directory` (every recognised club, claimed or not -- ~1,400 rows) is still the one dataset, a
 * club's "On Ovalball" state still comes from whether a `clubs` row exists (never from
 * `club_directory.active`, which means something else entirely -- "still current in the registry"),
 * and partnership state still comes from `club_partnerships`, exactly as the existing feature already
 * reads it.
 *
 * MINIMAL MARKER PAYLOAD, DETAIL ON SELECTION. `ClubMapMarker` carries only what a map/list ROW needs
 * to render and be filtered/searched -- never fixture history, never team compatibility, never
 * anything that would make a marker payload grow with the network. Compatible-team counts, fixture
 * history and negotiation state belong to `club-detail.ts`, fetched only once a marker is selected.
 *
 * NOT YET A BOUNDING-BOX QUERY. At today's real scale (~1,400 rows, confirmed via the architecture
 * audit) fetching the whole directory once client-side is the same trade-off the existing web feature
 * already made successfully, and this function preserves it rather than introducing a new migration to
 * solve a scale problem that does not exist yet -- consistent with "do not create a migration merely to
 * make UI easier." A server-side viewport/bounding-box query is the documented next step once the
 * directory is meaningfully larger (see the audit's own performance-budget section).
 */

export type ClubNetworkState = "on_ovalball" | "not_on_ovalball"
export type ClubPartnershipStatus = "none" | "pending_outgoing" | "pending_incoming" | "active"

export interface ClubMapMarker {
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
  networkState: ClubNetworkState
  partnershipStatus: ClubPartnershipStatus
  partnershipId: string | null
}

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

/** club_directory has 1,390+ active rows -- past PostgREST's default 1000-row response cap. */
async function fetchAllDirectoryRows(supabase: Client): Promise<DirectoryRow[]> {
  const rows: DirectoryRow[] = []
  const PAGE_SIZE = 1000
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("club_directory")
      .select("id, name, rugby_code, town, county, postcode, latitude, longitude, geocode_status, logo_storage_path, clubs(logo_storage_path)")
      .eq("active", true)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...(data as unknown as DirectoryRow[]))
    if (data.length < PAGE_SIZE) break
  }
  return rows
}

/**
 * Every recognised club, with network/partnership state layered on top for the caller's own club.
 * `viewerClubId` is null for a caller with no club context (e.g. browsing Clubhouse before a context
 * is selected) -- markers still render, just with partnershipStatus always "none" and isOwnClub always
 * false, since there is no "own club" to compare against.
 */
export async function readClubhouseMarkers(supabase: Client, viewerClubId: string | null): Promise<ClubMapMarker[]> {
  const [directoryRows, { data: activatedClubs }, partnershipsResult] = await Promise.all([
    fetchAllDirectoryRows(supabase),
    supabase.from("clubs").select("id, directory_id, slug").eq("status", "active"),
    viewerClubId
      ? supabase
          .from("club_partnerships")
          .select("id, requesting_club_id, partner_club_id, status")
          .or(`requesting_club_id.eq.${viewerClubId},partner_club_id.eq.${viewerClubId}`)
          .neq("status", "revoked")
      : Promise.resolve({ data: [] as { id: string; requesting_club_id: string; partner_club_id: string; status: string }[] }),
  ])

  const clubIdByDirectoryId = new Map((activatedClubs ?? []).map((c) => [c.directory_id, c.id]))
  const slugByDirectoryId = new Map((activatedClubs ?? []).map((c) => [c.directory_id, c.slug]))

  const partnershipByClubId = new Map<string, { status: ClubPartnershipStatus; partnershipId: string }>()
  for (const p of partnershipsResult.data ?? []) {
    if (!viewerClubId) continue
    const otherClubId = p.requesting_club_id === viewerClubId ? p.partner_club_id : p.requesting_club_id
    const status: ClubPartnershipStatus =
      p.status === "active" ? "active" : p.requesting_club_id === viewerClubId ? "pending_outgoing" : "pending_incoming"
    partnershipByClubId.set(otherClubId, { status, partnershipId: p.id })
  }

  return directoryRows.map((row): ClubMapMarker => {
    const clubId = clubIdByDirectoryId.get(row.id) ?? null
    const partnership = clubId ? partnershipByClubId.get(clubId) : undefined
    const logoPath = resolveClubLogoPathFrom(row.clubs?.logo_storage_path, row.logo_storage_path)
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
      logoUrl: clubLogoUrlFromPath(supabase, logoPath),
      slug: slugByDirectoryId.get(row.id) ?? null,
      isOwnClub: viewerClubId !== null && clubId === viewerClubId,
      networkState: clubId ? "on_ovalball" : "not_on_ovalball",
      partnershipStatus: partnership?.status ?? "none",
      partnershipId: partnership?.partnershipId ?? null,
    }
  })
}

/** Text search over name/town/postcode -- the same three fields the existing web explorer already searches. */
export function matchesClubhouseQuery(marker: ClubMapMarker, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return true
  const normalisedPostcode = (marker.postcode ?? "").toLowerCase().replace(/\s+/g, "")
  return (
    marker.name.toLowerCase().includes(q) ||
    (marker.town ?? "").toLowerCase().includes(q) ||
    normalisedPostcode.includes(q.replace(/\s+/g, ""))
  )
}

export type ClubhouseFilter = "all" | "on_ovalball" | "partners" | "compatible"

/**
 * "COMPATIBLE" needs a specific team to be meaningful (Section 23: never name-matching -- rugby code,
 * category, age grade, gender, the same `internal.teams_can_play_fixture` rule everywhere else in the
 * product). `compatibleTeamIds` is supplied by the caller from a server-derived answer (e.g.
 * `compatible_opponent_teams`/`compatible_opponent_identities` results already keyed by club), never
 * computed client-side from a name.
 */
export function applyClubhouseFilter(markers: ClubMapMarker[], filter: ClubhouseFilter, compatibleClubIds: Set<string> | null): ClubMapMarker[] {
  if (filter === "all") return markers
  if (filter === "on_ovalball") return markers.filter((m) => m.networkState === "on_ovalball")
  if (filter === "partners") return markers.filter((m) => m.partnershipStatus === "active")
  // "compatible" without a known team context has nothing truthful to filter by -- never falls back to
  // "all" silently, which would look like every club is compatible.
  if (!compatibleClubIds) return []
  return markers.filter((m) => m.clubId !== null && compatibleClubIds.has(m.clubId))
}
