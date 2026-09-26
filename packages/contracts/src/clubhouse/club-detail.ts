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

/** Section 4: one compatible opposition team, from the canonical `compatible_opponent_teams` RPC -- never a second compatibility calculation, never name-matched. */
export interface CompatibleTeam {
  teamId: string
  displayName: string
  ageGroup: string | null
  gender: string | null
}

export interface ClubDetail {
  directoryId: string
  clubId: string | null
  name: string
  rugbyCode: string
  town: string | null
  county: string | null
  postcode: string | null
  /** Section 3's location-precision model, carried through unchanged -- never re-derived here. */
  latitude: number | null
  longitude: number | null
  hasLocation: boolean
  locationPrecision: ClubMapMarker["locationPrecision"]
  networkState: ClubMapMarker["networkState"]
  partnershipStatus: ClubMapMarker["partnershipStatus"]
  partnershipId: string | null
  logoUrl: string | null
  slug: string | null
  /** The club's own canonical public website -- the activated club's own value wins over the directory's, the same precedence resolveClubLogoPathFrom already establishes for crests. Null when neither has one; never inferred from the club's name. */
  website: string | null
  /** Only ever populated for an ON-OVALBALL club, with a viewer team context. Never fabricated, never name-matched -- the same canonical compatible_opponent_teams RPC Find a Fixture already uses. */
  compatibleTeams: CompatibleTeam[] | null
  /** Fixtures already played/scheduled between the viewer's club and this one this season. Only for an on-Ovalball club. */
  fixturesTogetherThisSeason: number | null
  /**
   * SECTION 17 (NETWORK MEMORY): the same canonical count, generalised across every season rather than
   * restarted as a second read -- `countFixturesTogetherThisSeason`'s own viewer/opponent team id
   * resolution is reused, only the date-range filter differs. Never a second compatibility calculation.
   */
  fixturesTogetherAllTime: number | null
  /** The earliest recorded kickoff date between the two clubs' teams -- "how long we've known this club," never fabricated when there is no shared history. */
  firstMetDate: string | null
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
  /**
   * SECTION 10 (CLUBHOUSE): start_or_get_club_conversation checks `can_manage_club_fixtures`, a
   * genuine CLUB-scope authority (site admin, club admin, or an active club membership) -- unlike
   * canFindFixture, this is deliberately never widened by a team-scope merge, because a team-scoped
   * Coach or Team Manager has no club-to-club messaging authority to widen. The RPC re-checks this
   * independently regardless of what this flag says.
   */
  canMessage: boolean
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

/**
 * Section 5: the TEAM-scope equivalent, asked only when the viewer's active context is a team.
 * `club.partners.manage`'s own `valid_scopes` is `{club}` -- it cannot be granted or even asked about at
 * team scope, so this can only ever surface `fixture.request.create`/`.respond`, never partnership
 * management. That is what makes merging its result into `canFindFixture` below safe: it can never
 * contribute a partner-management action.
 */
async function readTeamCapabilities(supabase: Client, teamId: string, keys: string[]): Promise<Set<string>> {
  const { data, error } = await supabase.rpc("my_capabilities", { p_scope_type: "team", p_team_id: teamId })
  if (error) return new Set()
  return new Set((data ?? []).filter((row) => row.allowed === true && keys.includes(row.capability_key)).map((row) => row.capability_key))
}

export async function readClubDetail(
  supabase: Client,
  marker: Pick<
    ClubMapMarker,
    | "directoryId"
    | "clubId"
    | "name"
    | "rugbyCode"
    | "town"
    | "county"
    | "postcode"
    | "latitude"
    | "longitude"
    | "hasLocation"
    | "locationPrecision"
    | "networkState"
    | "partnershipStatus"
    | "partnershipId"
    | "logoUrl"
    | "slug"
  >,
  viewerClubId: string | null,
  viewerTeamId: string | null
): Promise<ClubDetail> {
  const [compatibleTeams, networkHistory, capabilities, teamCapabilities, website] = await Promise.all([
    marker.clubId && viewerTeamId ? readCompatibleTeams(supabase, viewerTeamId, marker.clubId) : Promise.resolve(null),
    marker.clubId && viewerClubId ? readClubNetworkHistory(supabase, viewerClubId, marker.clubId) : Promise.resolve({ thisSeason: null, allTime: null, firstMetDate: null }),
    viewerClubId
      ? readCapabilities(supabase, viewerClubId, ["club.partners.manage", "fixture.request.create", "fixture.request.respond"])
      : Promise.resolve(new Set<string>()),
    viewerTeamId ? readTeamCapabilities(supabase, viewerTeamId, ["fixture.request.create", "fixture.request.respond"]) : Promise.resolve(new Set<string>()),
    readClubWebsite(supabase, marker.directoryId),
  ])

  const clubActions = deriveClubNetworkActions(marker, viewerClubId, capabilities)
  const isOtherClub = marker.clubId !== null && marker.clubId !== viewerClubId
  const holdsTeamFixtureAuthority = teamCapabilities.has("fixture.request.create") || teamCapabilities.has("fixture.request.respond")
  // Section 5: a team-context viewer's OWN fixture authority unlocks Find a Fixture even with no
  // club-scope grant at all -- deriveClubNetworkActions itself stays untouched and club-scope-only
  // (every one of its existing tests is unaffected), because Compare Calendars must NOT widen the same
  // way: get_partner_team_availability checks fixture.fixture.view at CLUB scope specifically, which a
  // team-scoped grant never satisfies, so blindly merging team capabilities into the whole action set
  // would show a button whose server call then fails with a confusing "no active calendar-sharing
  // agreement" error for what is really an authority gap. Only canFindFixture is widened here.
  const actions = { ...clubActions, canFindFixture: clubActions.canFindFixture || (isOtherClub && holdsTeamFixtureAuthority) }

  return {
    directoryId: marker.directoryId,
    clubId: marker.clubId,
    name: marker.name,
    rugbyCode: marker.rugbyCode,
    town: marker.town,
    county: marker.county,
    postcode: marker.postcode,
    latitude: marker.latitude,
    longitude: marker.longitude,
    hasLocation: marker.hasLocation,
    locationPrecision: marker.locationPrecision,
    networkState: marker.networkState,
    partnershipStatus: marker.partnershipStatus,
    partnershipId: marker.partnershipId,
    logoUrl: marker.logoUrl,
    slug: marker.slug,
    website,
    compatibleTeams,
    fixturesTogetherThisSeason: networkHistory.thisSeason,
    fixturesTogetherAllTime: networkHistory.allTime,
    firstMetDate: networkHistory.firstMetDate,
    actions,
  }
}

/**
 * THE PURE DECISION: the same precedence crests use (`resolveClubLogoPathFrom`) -- an activated club's
 * own entered website wins over the directory's, because it is the club's own current, self-reported
 * value. Never inferred from the club's name or scraped -- both columns are canonical, already-existing
 * fields. Empty string is treated the same as null: a blank column is not a website.
 */
export function resolveClubWebsite(directory: { website: string | null }, club: { website: string | null } | null): string | null {
  return club?.website || directory.website || null
}

async function readClubWebsite(supabase: Client, directoryId: string): Promise<string | null> {
  const { data, error } = await supabase.from("club_directory").select("website, clubs(website)").eq("id", directoryId).maybeSingle()
  if (error || !data) return null
  const row = data as unknown as { website: string | null; clubs: { website: string | null } | null }
  return resolveClubWebsite({ website: row.website }, row.clubs)
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
    // club.partners.manage and fixture.request.create/.respond are all held by CLUB_ADMIN/FIXTURE_
    // SECRETARY -- the same practical population can_manage_club_fixtures admits -- so either signal
    // is a reasonable client-side proxy; the RPC's own check remains the real gate.
    canMessage: isOtherClub && (holdsPartnerAuthority || holdsFixtureAuthority),
  }
}

/**
 * THE PURE PROJECTION: exactly the four fields `compatible_opponent_teams` returns, renamed to the
 * contract's own casing -- nothing more. Pinned directly so "no player roster leakage" is a real,
 * checkable assertion (`supabase/tests/js/clubhouse.test.mts`), the same way
 * `buildClubMarkerFeatureCollection`'s four-field shape is pinned for the map layer.
 */
export function mapCompatibleTeams(rows: readonly { team_id: string; display_name: string; age_group: string | null; gender: string | null }[]): CompatibleTeam[] {
  return rows.map((row) => ({
    teamId: row.team_id,
    displayName: row.display_name,
    ageGroup: row.age_group,
    gender: row.gender,
  }))
}

/**
 * Section 4: the canonical compatibility list itself, not just its count -- the same
 * `compatible_opponent_teams` RPC Find a Fixture already calls, so the sheet's team cards and Find a
 * Fixture's own list can never disagree. The RPC's `display_name` is used as-is: its return shape lacks
 * `category`/`squadDesignation`/`rugbyCode`, so it cannot be re-run through `fullTeamLabel` here, and
 * redesigning the RPC's shape is explicitly out of scope for this section.
 */
async function readCompatibleTeams(supabase: Client, viewerTeamId: string, opponentClubId: string): Promise<CompatibleTeam[] | null> {
  const { data, error } = await supabase.rpc("compatible_opponent_teams", { p_team_id: viewerTeamId, p_opponent_club_id: opponentClubId })
  if (error) return null
  return mapCompatibleTeams(data ?? [])
}

interface ClubNetworkHistory {
  thisSeason: number | null
  allTime: number | null
  firstMetDate: string | null
}

/**
 * SECTION 17 (NETWORK MEMORY): generalises the original season-only count into the fuller "how do we
 * know this club" read the section asked for -- one query for the team-id resolution, reused for both
 * the season-scoped and the all-time reads, rather than a second, separately-built history source.
 */
async function readClubNetworkHistory(supabase: Client, viewerClubId: string, opponentClubId: string): Promise<ClubNetworkHistory> {
  // Canonical fixtures only -- never fabricated, never counting a Competition Match that has no
  // fixture-level record for this club. Scoped to teams owned by each club.
  const { data: viewerTeams } = await supabase.from("teams").select("id").eq("club_id", viewerClubId)
  const { data: opponentTeams } = await supabase.from("teams").select("id").eq("club_id", opponentClubId)
  const viewerIds = (viewerTeams ?? []).map((t) => t.id)
  const opponentIds = (opponentTeams ?? []).map((t) => t.id)
  if (viewerIds.length === 0 || opponentIds.length === 0) return { thisSeason: 0, allTime: 0, firstMetDate: null }

  const { data: currentSeason } = await supabase.from("seasons").select("starts_on, ends_on").lte("starts_on", new Date().toISOString()).gte("ends_on", new Date().toISOString()).maybeSingle()

  const [seasonResult, allTimeResult, firstMetResult] = await Promise.all([
    currentSeason
      ? supabase
          .from("fixtures")
          .select("id", { count: "exact", head: true })
          .in("owning_team_id", viewerIds)
          .in("opponent_team_id", opponentIds)
          .gte("kickoff_date", currentSeason.starts_on)
          .lte("kickoff_date", currentSeason.ends_on)
          .neq("status", "Cancelled")
      : Promise.resolve({ count: null, error: null }),
    supabase.from("fixtures").select("id", { count: "exact", head: true }).in("owning_team_id", viewerIds).in("opponent_team_id", opponentIds).neq("status", "Cancelled"),
    supabase
      .from("fixtures")
      .select("kickoff_date")
      .in("owning_team_id", viewerIds)
      .in("opponent_team_id", opponentIds)
      .neq("status", "Cancelled")
      .order("kickoff_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  return {
    thisSeason: seasonResult.error ? null : seasonResult.count,
    allTime: allTimeResult.error ? null : (allTimeResult.count ?? 0),
    firstMetDate: firstMetResult.error || !firstMetResult.data ? null : firstMetResult.data.kickoff_date,
  }
}

/** Logo resolution for a raw directory/club row pair, for read paths that have not gone through the marker model. */
export function clubLogoFromDirectoryAndClub(
  supabase: Client,
  directory: { logo_storage_path: string | null },
  club: { logo_storage_path: string | null } | null
): string | null {
  return clubLogoUrlFromPath(supabase, resolveClubLogoPathFrom(club?.logo_storage_path, directory.logo_storage_path))
}
