import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { clubLogoUrlFromPath, resolveClubLogoPathFrom } from "../club-logo"
import type { ClubMapMarker } from "./map-read-model"

type Client = SupabaseClient<Database>

/**
 * THE CLUB BOTTOM SHEET'S READ MODEL (Section 26-28, 63-64). Fetched only once a marker is selected --
 * never bundled into the marker payload. Every field is either the marker's own already-server-derived
 * state or a fresh query; nothing is inferred or fabricated for an unclaimed directory club, which is
 * why `compatibleTeams`/`fixturesTogether`/`actions.canFindFixture` etc. are simply absent (not
 * false-but-shown) when the underlying concept does not apply to that club yet.
 */

export interface ClubDetail {
  directoryId: string
  clubId: string | null
  name: string
  rugbyCode: string
  town: string | null
  county: string | null
  networkState: ClubMapMarker["networkState"]
  partnershipStatus: ClubMapMarker["partnershipStatus"]
  partnershipId: string | null
  logoUrl: string | null
  slug: string | null
  /** Only ever populated for an ON-OVALBALL club, with a viewer team context. Never fabricated. */
  compatibleTeamCount: number | null
  /** Fixtures already played/scheduled between the viewer's club and this one this season. Only for an on-Ovalball club. */
  fixturesTogetherThisSeason: number | null
  actions: ClubNetworkActions
}

/**
 * Section 64: every action the sheet may offer, decided server-side from canonical authority and the
 * club's own real state -- never inferred from partnership alone (Section 55: partnership grants
 * calendar/messaging, nothing else) and never offered to a club whose underlying concept does not
 * exist yet (Section 28: no Compare Calendars/availability button for a directory-only club).
 */
export interface ClubNetworkActions {
  canPartner: boolean
  canCancelOutgoingPartnerRequest: boolean
  canRespondPartnerRequest: boolean
  canRevokePartnership: boolean
  canFindFixture: boolean
  canCompareCalendar: boolean
  canInviteToOvalball: boolean
}

/**
 * `my_capabilities` is the canonical, already-shipped capability read (the same call
 * `readAdminCentreAccess` already makes) -- no new RPC, no client-side role inference.
 */
async function readCapabilities(supabase: Client, clubId: string, keys: string[]): Promise<Set<string>> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "club", p_club_id: clubId })
  if (error) throw error
  const allowed = new Set((data ?? []).filter((row) => row.allowed === true && keys.includes(row.capability_key)).map((row) => row.capability_key))
  return allowed
}

export async function readClubDetail(
  supabase: Client,
  marker: Pick<ClubMapMarker, "directoryId" | "clubId" | "name" | "rugbyCode" | "town" | "county" | "networkState" | "partnershipStatus" | "partnershipId" | "logoUrl" | "slug">,
  viewerClubId: string | null,
  viewerTeamId: string | null
): Promise<ClubDetail> {
  const [compatibleTeamCount, fixturesTogetherThisSeason, capabilities] = await Promise.all([
    marker.clubId && viewerTeamId ? countCompatibleTeams(supabase, viewerTeamId, marker.clubId) : Promise.resolve(null),
    marker.clubId && viewerClubId ? countFixturesTogetherThisSeason(supabase, viewerClubId, marker.clubId) : Promise.resolve(null),
    viewerClubId
      ? readCapabilities(supabase, viewerClubId, ["club.partners.manage", "fixture.request.create", "fixture.request.respond"])
      : Promise.resolve(new Set<string>()),
  ])

  return {
    directoryId: marker.directoryId,
    clubId: marker.clubId,
    name: marker.name,
    rugbyCode: marker.rugbyCode,
    town: marker.town,
    county: marker.county,
    networkState: marker.networkState,
    partnershipStatus: marker.partnershipStatus,
    partnershipId: marker.partnershipId,
    logoUrl: marker.logoUrl,
    slug: marker.slug,
    compatibleTeamCount,
    fixturesTogetherThisSeason,
    actions: deriveClubNetworkActions(marker, viewerClubId, capabilities),
  }
}

/**
 * THE PURE DECISION (Section 64), separated from the I/O above so it can be pinned directly --
 * `supabase/tests/js/clubhouse.test.mts` asserts every safeguarding-relevant case here: a parent/
 * player account (which holds neither capability, ever -- see the architecture audit's own Section 11
 * finding) gets every action false; an unclaimed directory club never gets Find a Fixture, Compare
 * Calendars or a partner action, because `isOtherClub` requires a real `clubId`; partnership never
 * grants Find a Fixture on its own (that is fixture authority's job) and Compare Calendars specifically
 * requires an ACTIVE partnership, matching `get_partner_team_availability`'s own server-side refusal.
 */
export function deriveClubNetworkActions(
  marker: Pick<ClubMapMarker, "clubId" | "networkState" | "partnershipStatus">,
  viewerClubId: string | null,
  capabilities: ReadonlySet<string>
): ClubNetworkActions {
  const holdsPartnerAuthority = capabilities.has("club.partners.manage")
  const holdsFixtureAuthority = capabilities.has("fixture.request.create") || capabilities.has("fixture.request.respond")
  const isOtherClub = marker.clubId !== null && marker.clubId !== viewerClubId

  return {
    canPartner: isOtherClub && holdsPartnerAuthority && marker.partnershipStatus === "none",
    canCancelOutgoingPartnerRequest: isOtherClub && holdsPartnerAuthority && marker.partnershipStatus === "pending_outgoing",
    canRespondPartnerRequest: isOtherClub && holdsPartnerAuthority && marker.partnershipStatus === "pending_incoming",
    canRevokePartnership: isOtherClub && holdsPartnerAuthority && marker.partnershipStatus === "active",
    // Find a Fixture is offered against any on-Ovalball club the viewer holds fixture authority for --
    // never gated on partnership, which the audit confirmed grants nothing beyond calendar/messaging.
    canFindFixture: isOtherClub && holdsFixtureAuthority,
    // Compare Calendars specifically needs an ACTIVE partnership -- get_partner_team_availability
    // itself refuses without one ("No active calendar-sharing agreement with this club").
    canCompareCalendar: isOtherClub && holdsFixtureAuthority && marker.partnershipStatus === "active",
    canInviteToOvalball: marker.networkState === "not_on_ovalball" && holdsPartnerAuthority,
  }
}

async function countCompatibleTeams(supabase: Client, viewerTeamId: string, opponentClubId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc("compatible_opponent_teams", { p_team_id: viewerTeamId, p_opponent_club_id: opponentClubId })
  if (error) return null
  return (data ?? []).length
}

async function countFixturesTogetherThisSeason(supabase: Client, viewerClubId: string, opponentClubId: string): Promise<number | null> {
  // Canonical fixtures only -- never fabricated, never counting a Competition Match that has no
  // fixture-level record for this club. Scoped to teams owned by each club, current season only.
  const { data: viewerTeams } = await supabase.from("teams").select("id").eq("club_id", viewerClubId)
  const { data: opponentTeams } = await supabase.from("teams").select("id").eq("club_id", opponentClubId)
  const viewerIds = (viewerTeams ?? []).map((t) => t.id)
  const opponentIds = (opponentTeams ?? []).map((t) => t.id)
  if (viewerIds.length === 0 || opponentIds.length === 0) return 0

  const { data: currentSeason } = await supabase.from("seasons").select("starts_on, ends_on").lte("starts_on", new Date().toISOString()).gte("ends_on", new Date().toISOString()).maybeSingle()
  if (!currentSeason) return null

  const { count, error } = await supabase
    .from("fixtures")
    .select("id", { count: "exact", head: true })
    .in("owning_team_id", viewerIds)
    .in("opponent_team_id", opponentIds)
    .gte("kickoff_date", currentSeason.starts_on)
    .lte("kickoff_date", currentSeason.ends_on)
    .neq("status", "Cancelled")
  if (error) return null
  return count ?? 0
}

/** Logo resolution for a raw directory/club row pair, for read paths that have not gone through the marker model. */
export function clubLogoFromDirectoryAndClub(
  supabase: Client,
  directory: { logo_storage_path: string | null },
  club: { logo_storage_path: string | null } | null
): string | null {
  return clubLogoUrlFromPath(supabase, resolveClubLogoPathFrom(club?.logo_storage_path, directory.logo_storage_path))
}
