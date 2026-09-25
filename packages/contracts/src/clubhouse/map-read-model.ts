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

/**
 * "unknown" (Clubhouse Programme Section 2, closing a Section 1 finding; Section 5 closed the team-
 * context half of it): `club_partnerships_select_scoped` RLS only returns rows to a caller holding
 * `club.partners.manage` at CLUB scope. A club-scoped viewer whose permissions were narrowed below the
 * default (or any caller with no club context at all) never holds that capability, so the direct-table
 * partnership query below returns an EMPTY result for them even where a real partnership exists.
 * Reading that emptiness as "none" would be reporting RLS's silence as a fact this codebase does not
 * actually know -- "unknown" is a distinct state from "none" for exactly this reason. A team-scoped
 * Coach/Team Manager is NO LONGER included in this gap: `get_team_club_partnerships` (Section 5) is a
 * narrow, SECURITY DEFINER read that authorises on real team-scoped fixture authority
 * (`fixture.request.create`/`.respond`) rather than `club.partners.manage`, and returns the exact same
 * row shape the direct table read does -- so a legitimate team-context viewer now gets a real, trusted
 * answer, never "unknown", while still holding zero partnership MANAGEMENT authority. Every
 * partner-specific action (`deriveClubNetworkActions` in `club-detail.ts`) is written so that only an
 * exact `=== "active"`/`"pending_outgoing"`/`"pending_incoming"`/`"none"` match unlocks anything --
 * "unknown" matches none of them, so it can never render "Partner with Club" or any other partner
 * action.
 */
export type ClubPartnershipStatus = "none" | "pending_outgoing" | "pending_incoming" | "active" | "unknown"

/**
 * CLUBHOUSE PROGRAMME SECTION 3: a coordinate's precision, computed at READ TIME from which table it
 * came from -- deliberately not a new stored column. `geocode_status = 'success'` on `club_directory`
 * is a postcode CENTROID (every successful directory geocode today comes from `postcodes.io`, which
 * resolves a postcode string to its centroid, never a ground survey) -- real, useful, but not the same
 * claim as "this pin is the actual ground." A concrete instance was found auditing this section: Preston
 * Grasshoppers RFC's directory postcode-centroid and its own `venues` row (`is_default_home`, entered by
 * the club itself during setup) sit roughly 8km apart. `"venue"` is preferred whenever an activated
 * club has a successfully-geocoded default-home venue; it is never available for an unclaimed directory
 * club, because unclaimed clubs have no `venues` row at all. `"postcode"` is the directory's own
 * geocode. `"unknown"` is genuinely no location -- never guessed, never a town centroid presented as
 * the ground.
 */
export type ClubLocationPrecision = "venue" | "postcode" | "unknown"

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
  locationPrecision: ClubLocationPrecision
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
  source: string
  verification_status: string
  clubs: { logo_storage_path: string | null } | null
}

/**
 * A real, live finding: `supabase/tests/partnership_automation.sql` is a deliberate SPECIAL_PURPOSE
 * manual-verification suite (not part of the automated CANONICAL_GATE) that, by design, COMMITS its
 * fixture rows rather than rolling them back -- "Auto Partner Test Home/Away/Deactivated RUFC," fixed
 * `99900000-...` sentinel ids -- so a developer can re-run it and inspect results afterward. That is
 * correct behaviour for that suite. It is not correct for Clubhouse to then present those rows to a
 * real reviewing user as if they were real clubs, which is exactly what happened on a live device.
 * `source = 'site_admin_manual' AND verification_status = 'unverified'` matches precisely these 4 rows
 * today (confirmed by direct query) and nothing else -- narrow and safe, not a blunt exclusion of every
 * manually-added club (a verified one would never match both conditions). This filters the READ MODEL
 * only; no database row is touched, so the suite that created them remains exactly as repeatable as it
 * was designed to be.
 */
export function isKnownTestFixture(row: { source: string; verification_status: string }): boolean {
  return row.source === "site_admin_manual" && row.verification_status === "unverified"
}

/**
 * Section 2: `geocode_status = 'success'` is not, on its own, proof the coordinate is trustworthy --
 * the architecture audit found a real prior incident (20270202000000, a venue) where a "successful"
 * geocode still held a wrong pin. This is the map's own last line of defence: a coordinate must be a
 * finite number, a real UK/Ireland-plausible latitude (49-61, covering the Channel Islands to
 * Shetland) and longitude (-11.5 to 2, covering the west coast of Ireland -- Dunmore Head is close to
 * -10.7 -- to East Anglia; club_directory carries `irish_rugby`-sourced rows too, so the bound must
 * clear all of Ireland, not just Great Britain), or it is treated exactly as `hasLocation: false` --
 * never rendered as a pin, never used for distance. This never corrects or re-geocodes anything; it
 * only refuses to trust a number that cannot possibly be right.
 */
export function isValidClubCoordinate(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return false
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  return lat >= 49 && lat <= 61 && lng >= -11.5 && lng <= 2
}

/**
 * THE PRECEDENCE RULE (Section 3): a club's own verified default-home venue beats the directory's
 * postcode centroid, whenever both exist and the venue's own coordinate is itself plausible. Pure and
 * directly tested -- never called with an unvalidated venue coordinate, since `isValidClubCoordinate`
 * is applied to it here too (a venue's `geocode_status='success'` carries exactly the same "success is
 * not proof" caveat as the directory's own).
 */
export function resolveClubLocation(
  directory: { latitude: number | null; longitude: number | null; geocodeSuccess: boolean },
  venue: { latitude: number | null; longitude: number | null; geocodeSuccess: boolean } | null
): { latitude: number | null; longitude: number | null; precision: ClubLocationPrecision } {
  if (venue && venue.geocodeSuccess && isValidClubCoordinate(venue.latitude, venue.longitude)) {
    return { latitude: venue.latitude, longitude: venue.longitude, precision: "venue" }
  }
  if (directory.geocodeSuccess && isValidClubCoordinate(directory.latitude, directory.longitude)) {
    return { latitude: directory.latitude, longitude: directory.longitude, precision: "postcode" }
  }
  return { latitude: null, longitude: null, precision: "unknown" }
}

/** club_directory has 1,390+ active rows -- past PostgREST's default 1000-row response cap. */
async function fetchAllDirectoryRows(supabase: Client): Promise<DirectoryRow[]> {
  const rows: DirectoryRow[] = []
  const PAGE_SIZE = 1000
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("club_directory")
      .select("id, name, rugby_code, town, county, postcode, latitude, longitude, geocode_status, logo_storage_path, source, verification_status, clubs(logo_storage_path)")
      .eq("active", true)
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...((data as unknown as DirectoryRow[]).filter((row) => !isKnownTestFixture(row))))
    if (data.length < PAGE_SIZE) break
  }
  return rows
}

/**
 * Every recognised club, with network/partnership state layered on top for the caller's own club.
 * `viewerClubId` is null for a caller with no club context (e.g. browsing Clubhouse before a context
 * is selected) -- markers still render, just with partnershipStatus always "unknown" and isOwnClub
 * always false, since there is no "own club" to compare against. `viewerTeamId` is the caller's active
 * team, if their current context is a team rather than a club -- Section 5's own real read path.
 *
 * PARTNERSHIP STATE IS ONLY EVER TRUSTED FROM TWO SOURCES, EACH AUTHORITY-CHECKED FIRST. A club-scope
 * viewer holding `club.partners.manage` reads the table directly (`club_partnerships_select_scoped`
 * RLS already enforces this). A team-scope viewer with no such club-level grant instead calls
 * `get_team_club_partnerships` (Section 5), which independently authorises on real team-scoped fixture
 * authority and returns the identical row shape -- never inferred from whichever query happens to come
 * back empty, which is exactly what direct-table RLS silently does for a caller with neither. Without
 * either authority, no partnership query runs at all: every marker's `partnershipStatus` is `"unknown"`,
 * and `deriveClubNetworkActions` (club-detail.ts) is written so "unknown" unlocks no partner action.
 */
export async function readClubhouseMarkers(supabase: Client, viewerClubId: string | null, viewerTeamId: string | null = null): Promise<ClubMapMarker[]> {
  const holdsClubPartnerAuthority = viewerClubId ? await readsClubPartnerships(supabase, viewerClubId) : false
  const teamPartnershipRows = !holdsClubPartnerAuthority && viewerTeamId ? await readTeamClubPartnerships(supabase, viewerTeamId) : null
  const holdsPartnerAuthority = holdsClubPartnerAuthority || teamPartnershipRows !== null

  const [directoryRows, { data: activatedClubs }, partnershipsResult, { data: defaultVenues }] = await Promise.all([
    fetchAllDirectoryRows(supabase),
    supabase.from("clubs").select("id, directory_id, slug").eq("status", "active"),
    holdsClubPartnerAuthority && viewerClubId
      ? supabase
          .from("club_partnerships")
          .select("id, requesting_club_id, partner_club_id, status")
          .or(`requesting_club_id.eq.${viewerClubId},partner_club_id.eq.${viewerClubId}`)
          .neq("status", "revoked")
      : Promise.resolve({ data: (teamPartnershipRows ?? []) as { id: string; requesting_club_id: string; partner_club_id: string; status: string }[] }),
    // Section 3: a club's own default-home venue, entered by the club itself during setup, is
    // preferred over the directory's postcode-centroid geocode whenever it is itself trustworthy --
    // see resolveClubLocation. Scoped to is_default_home so a club with several venues never produces
    // ambiguity about which one is "the" map location.
    //
    // HONEST SCOPE: `venues_select` RLS gates on `venue.venue.view` at the venue's OWNING club, which
    // only that club's own members ever hold (closing a real prior leak -- see
    // 20270364000000_calendar_venue_training_authority_canonical.sql). So this query only ever returns
    // rows for the VIEWER'S OWN club; every other club on the map still shows its directory
    // postcode-centroid, whether or not that club has a more accurate venue on file. This fixes "does
    // my own club appear in the right place," not "does every club on the network." Widening it would
    // be a real, separate authority decision (a public venue-coordinate projection), not something to
    // reach for here.
    supabase.from("venues").select("club_id, latitude, longitude, geocode_status").eq("is_default_home", true).eq("active", true),
  ])

  const clubIdByDirectoryId = new Map((activatedClubs ?? []).map((c) => [c.directory_id, c.id]))
  const slugByDirectoryId = new Map((activatedClubs ?? []).map((c) => [c.directory_id, c.slug]))
  const partnershipByClubId = buildPartnershipIndex(partnershipsResult.data ?? [], viewerClubId, holdsPartnerAuthority)
  const defaultVenueByClubId = new Map((defaultVenues ?? []).map((v) => [v.club_id as string, v]))

  return directoryRows.map((row): ClubMapMarker => {
    const clubId = clubIdByDirectoryId.get(row.id) ?? null
    const partnership = clubId ? partnershipByClubId.get(clubId) : undefined
    const partnershipStatus = resolvePartnershipStatus(partnership?.status ?? null, viewerClubId, holdsPartnerAuthority)
    const logoPath = resolveClubLogoPathFrom(row.clubs?.logo_storage_path, row.logo_storage_path)
    const venue = clubId ? defaultVenueByClubId.get(clubId) : undefined
    const location = resolveClubLocation(
      { latitude: row.latitude, longitude: row.longitude, geocodeSuccess: row.geocode_status === "success" },
      venue ? { latitude: venue.latitude, longitude: venue.longitude, geocodeSuccess: venue.geocode_status === "success" } : null
    )
    return {
      directoryId: row.id,
      clubId,
      name: row.name,
      rugbyCode: row.rugby_code,
      town: row.town,
      county: row.county,
      postcode: row.postcode,
      latitude: location.latitude,
      longitude: location.longitude,
      hasLocation: location.precision !== "unknown",
      locationPrecision: location.precision,
      logoUrl: clubLogoUrlFromPath(supabase, logoPath),
      slug: slugByDirectoryId.get(row.id) ?? null,
      isOwnClub: viewerClubId !== null && clubId === viewerClubId,
      networkState: clubId ? "on_ovalball" : "not_on_ovalball",
      partnershipStatus,
      partnershipId: partnership?.partnershipId ?? null,
    }
  })
}

/**
 * Whether the viewer holds `club.partners.manage` for their own club -- the exact capability
 * `club_partnerships_select_scoped` RLS requires. Asked once per read via the canonical
 * `my_capabilities` RPC, the same resolver every other authority decision in this codebase goes
 * through; never inferred from a query's own result shape.
 */
async function readsClubPartnerships(supabase: Client, viewerClubId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: viewerClubId })
  if (error) return false
  return (data ?? []).some((row) => row.capability_key === "club.partners.manage" && row.allowed === true)
}

type PartnershipRow = { id: string; requesting_club_id: string; partner_club_id: string; status: string }

/**
 * Section 5: the team-scoped equivalent of the direct-table read above -- `get_team_club_partnerships`
 * is a SECURITY DEFINER RPC that derives the caller's club from `p_team_id` itself (never trusting a
 * client-supplied club id as proof of anything) and independently checks real team-scoped fixture
 * authority (`fixture.request.create`/`.respond`) before returning a row. Returns `null`, not `[]`, on
 * any error -- including the RPC's own authority refusal -- so the caller can tell "genuinely no
 * partnerships" (`[]`) apart from "could not be asked" (`null`), exactly the same distinction
 * `holdsPartnerAuthority` already makes for the club-scope path.
 */
async function readTeamClubPartnerships(supabase: Client, viewerTeamId: string): Promise<PartnershipRow[] | null> {
  const { data, error } = await supabase.rpc("get_team_club_partnerships", { p_team_id: viewerTeamId })
  if (error) return null
  return data ?? []
}

/**
 * The I/O-free half of the partnership computation, pinned directly by `clubhouse.test.mts` without
 * needing a live database: given the raw rows RLS actually returned (which is `[]` whenever
 * `holdsPartnerAuthority` is false, by construction above) and who is asking, decide each OTHER club's
 * status. Never called at all unless `holdsPartnerAuthority` is true -- `readClubhouseMarkers` passes
 * `[]` otherwise, so this never has real rows to misinterpret.
 */
export function buildPartnershipIndex(
  rows: PartnershipRow[],
  viewerClubId: string | null,
  holdsPartnerAuthority: boolean
): Map<string, { status: "active" | "pending_outgoing" | "pending_incoming"; partnershipId: string }> {
  const index = new Map<string, { status: "active" | "pending_outgoing" | "pending_incoming"; partnershipId: string }>()
  if (!viewerClubId || !holdsPartnerAuthority) return index
  for (const p of rows) {
    const otherClubId = p.requesting_club_id === viewerClubId ? p.partner_club_id : p.requesting_club_id
    const status = p.status === "active" ? "active" : p.requesting_club_id === viewerClubId ? "pending_outgoing" : "pending_incoming"
    index.set(otherClubId, { status, partnershipId: p.id })
  }
  return index
}

/**
 * THE ONE RULE (Clubhouse Programme Section 2): "none" is a TRUSTED absence -- the caller held
 * `club.partners.manage` and the answer came back empty. Without that authority, or without a club to
 * ask on behalf of, the honest answer is "unknown", never a claimed negative. Pinned directly: this is
 * the exact function the directive's "UNKNOWN partnership state must never become NOT_PARTNERED" test
 * asserts against.
 */
export function resolvePartnershipStatus(
  knownStatus: "active" | "pending_outgoing" | "pending_incoming" | null,
  viewerClubId: string | null,
  holdsPartnerAuthority: boolean
): ClubPartnershipStatus {
  if (!viewerClubId || !holdsPartnerAuthority) return "unknown"
  return knownStatus ?? "none"
}

export interface ClubMarkerFeature {
  type: "Feature"
  id: string
  properties: { directoryId: string; networkState: ClubNetworkState; partnershipStatus: ClubPartnershipStatus; isOwnClub: boolean }
  geometry: { type: "Point"; coordinates: [number, number] }
}

/**
 * THE ONE MARKER PAYLOAD (Section 2: "minimal map payload... never send complete team/fixture/calendar
 * data into every map marker"). Deliberately four fields, no more -- never a name-adjacent private
 * field, never anything from `club-detail.ts`'s fuller read. Platform-neutral so native's MapLibre
 * `GeoJSONSource` and a future web MapLibre GL JS migration build the identical cluster source from the
 * identical function, and so this shape is pinned directly rather than only inspected inside a
 * component. Only markers with real, validated coordinates are included -- a marker with no location
 * has nothing to plot and belongs to List, never to a cluster source with a fabricated point.
 */
export function buildClubMarkerFeatureCollection(markers: ClubMapMarker[]): { type: "FeatureCollection"; features: ClubMarkerFeature[] } {
  return {
    type: "FeatureCollection",
    features: markers
      .filter((m) => m.hasLocation && m.latitude !== null && m.longitude !== null)
      .map((m) => ({
        type: "Feature" as const,
        id: m.directoryId,
        properties: { directoryId: m.directoryId, networkState: m.networkState, partnershipStatus: m.partnershipStatus, isOwnClub: m.isOwnClub },
        geometry: { type: "Point" as const, coordinates: [m.longitude as number, m.latitude as number] },
      })),
  }
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

/**
 * DISTANCE (Section 2): "only expose distance filtering where coordinates exist and the reference
 * origin is factual... do not calculate distance from a fabricated coordinate." The one factual origin
 * V1 has to offer is the viewer's OWN club's real, geocoded location (found among the markers
 * themselves, where `isOwnClub && hasLocation`) -- never a device-location permission (Section 56: not
 * required to use Clubhouse) and never a guessed/default coordinate. Returns null, not a wrong number,
 * whenever either point is unknown.
 */
export function distanceMiles(origin: { latitude: number | null; longitude: number | null }, target: { latitude: number | null; longitude: number | null }): number | null {
  if (origin.latitude === null || origin.longitude === null || target.latitude === null || target.longitude === null) return null
  const R = 3958.8 // Earth's mean radius in miles.
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(target.latitude - origin.latitude)
  const dLng = toRad(target.longitude - origin.longitude)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(origin.latitude)) * Math.cos(toRad(target.latitude)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** The origin marker for distance calculations, or null if the viewer has no club, or their club has no valid location. */
export function findDistanceOrigin(markers: ClubMapMarker[]): ClubMapMarker | null {
  return markers.find((m) => m.isOwnClub && m.hasLocation) ?? null
}

export type ClubhouseFilter = "all" | "on_ovalball" | "partners" | "compatible"
export type ClubhouseDistanceFilter = "any" | 10 | 25 | 50 | 100

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

/**
 * A club with no known location is NEVER dropped by a distance filter -- "unknown-location clubs
 * should not disappear from ordinary search merely because they cannot be distance-ranked" (Section 2).
 * `origin` is null whenever the viewer has no factual reference point, in which case every distance
 * band except "any" would otherwise be lying, so the filter becomes a no-op rather than hiding clubs
 * behind a control that cannot truthfully answer.
 */
export function applyClubhouseDistanceFilter(markers: ClubMapMarker[], radius: ClubhouseDistanceFilter, origin: ClubMapMarker | null): ClubMapMarker[] {
  if (radius === "any" || !origin) return markers
  return markers.filter((m) => {
    if (!m.hasLocation) return true
    const distance = distanceMiles(origin, m)
    return distance === null || distance <= radius
  })
}
