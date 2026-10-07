import type { SupabaseClient } from "@supabase/supabase-js"
import {
  homeClubIdFor,
  matchCentreStatus,
  narrowCapabilitiesToContext,
  resolveClubLogoUrl,
  resolveFixtureVenue,
  type ActiveContextKind,
  type Database,
  type KitConfig,
  type MatchCentreStatus,
} from "@ovalball/contracts"
import type { AvailabilityStatus } from "@ovalball/contracts/availability"
import { matchTypeLabel } from "@ovalball/contracts/fixtures/game-type"
import { loadStaffPlayers } from "@ovalball/contracts/team/players"

import type { RegisterEntry } from "../components/availability-register"

/**
 * MATCH CENTRE, READ FOR THE VIEWER.
 *
 * ONE SHARED SURFACE, TWO CLIENTS. The website's Match Centre resolves this
 * through `lib/app-context/match-centre-data.ts`, which carries `import
 * "server-only"` and a great deal of web-specific work -- signed avatar URLs,
 * the weather adapter, the match community layer, the kit renderer's config.
 * That file is not reachable from React Native and should not be: what mobile
 * needs is the same ANSWERS, not the same bundle.
 *
 * So every question below is asked of the SAME canonical database object the web
 * resolver asks, and nothing is re-derived:
 *
 *   public.get_match_centre_capabilities   which sections this viewer gets
 *   public.get_my_players_for_fixture      whom they may answer for, their
 *                                          current answer, and whether an
 *                                          answer can be recorded at all
 *   public.fixture_availability_summary    the squad's counts, or NO ROW when
 *                                          the caller is not entitled to know
 *   internal-gated table reads              the fixture, the teams, the venue
 *
 * WHAT IS DELIBERATELY NOT HERE. Any authority decision. Every flag below is a
 * value the server returned; this module has no branch that could grant
 * something the database refused, and the mutations re-check regardless.
 *
 * ONE MATCH CENTRE (owner brief, 2026-10-03). The logistics -- date, meet,
 * kick-off, venue, pitch, changing rooms, catering -- are now the Match Centre's
 * too: there is no separate fixture console to send anybody to.
 */

type Client = SupabaseClient<Database>

export interface MatchCentreSide {
  /** The canonical team, where the side is an Ovalball team. Opens the public team page. */
  teamId: string | null
  /** The canonical club, where the side's club is on Ovalball. */
  clubId: string | null
  /** The Club Directory identity -- every club, on Ovalball or not. Opens the public club page. */
  directoryId: string | null
  clubName: string
  teamName: string | null
  crestUrl: string | null
  /**
   * The club's own playing shirt, from the canonical `club_kits` row. Null for a
   * club that has not configured one, which is a real and common state -- an
   * opposition that is only a Directory entry almost always is -- and gets a
   * finished placeholder rather than an empty box.
   */
  kit: KitConfig | null
  /** A club with an Ovalball account, as opposed to a Club Directory entry with nobody behind it. */
  onOvalball: boolean
}

/** One player this viewer may answer for, and whether they may actually answer. */
export interface MyAvailability {
  playerId: string
  firstName: string
  displayName: string
  /** True when the player IS the signed-in person. Changes the wording only. */
  isSelf: boolean
  response: AvailabilityStatus | null
  canRespond: boolean
  /** The reason, in the database's own words, when they may not. */
  cannotRespondReason: string | null
}

export interface MatchCentreRoom {
  id: string
  name: string
  coverImagePath: string | null
  coverStockKey: string | null
}

export interface MatchCentreView {
  fixtureId: string
  /** HOME on the left, AWAY on the right, from the fixture's own orientation -- whoever is looking. */
  home: MatchCentreSide
  away: MatchCentreSide
  /** Which side this viewer belongs to (staff, family or player), from the server. Null for an unrelated viewer. */
  viewerSide: "home" | "away" | null
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable" | null
  date: string
  kickoffTime: string | null
  meetTime: string | null
  /** True once kick-off has passed (the server's own rule, the one results and awards follow). */
  kickedOff: boolean
  status: MatchCentreStatus
  cancelled: boolean
  cancellationReason: string | null
  /** A recorded result, or null. Two nulls are not a nil-nil draw. */
  result: { homeScore: number; awayScore: number } | null
  resultStatus: string | null
  venue: {
    id: string | null
    name: string | null
    postcode: string | null
    addressLines: string[]
    directions: string | null
    coverImagePath: string | null
    coverStockKey: string | null
    cateringAvailable: boolean | null
    changingRoomsAvailable: boolean | null
  }
  pitch: { id: string | null; name: string | null; description: string | null; coverImagePath: string | null; coverStockKey: string | null }
  homeRoom: MatchCentreRoom | null
  awayRoom: MatchCentreRoom | null
  /** The match officials' room, when the host has allocated one (in Arena or here). */
  officialsRoom: MatchCentreRoom | null
  /**
   * WHERE THE HOST IS NOT ON OVALBALL there are no room records, so the rooms are numbered for this match
   * (1-20), and "no changing rooms at the ground" is its own answer -- not the same as "not set yet".
   */
  homeRoomNumber: number | null
  awayRoomNumber: number | null
  noChangingRooms: boolean
  /** CANONICAL: the host club is on Ovalball and its records are referenced. PROVISIONAL: written for this match. */
  facilityMode: "CANONICAL" | "PROVISIONAL" | "UNDECIDED"
  changingRoomNotes: string | null
  cateringRequired: boolean
  notes: string | null
  competitionName: string | null
  matchType: string | null
  mine: MyAvailability[]
  canMessage: boolean
  canManageFixture: boolean
}

const FIXTURE_FIELDS =
  "id, owning_team_id, opponent_team_id, opponent_directory_id, home_away, status, kickoff_date, kickoff_time, meet_time, cancelled_at, cancellation_reason, kickoff_amendment_proposed_at, venue_id, venue_address, pitch_id, competition_edition_id, raw_opposition_text, home_score, away_score, result_status, game_type, notes, changing_room, home_changing_room_id, away_changing_room_id, officials_changing_room_id, catering_required, pitch_allocation, home_changing_room_number, away_changing_room_number, no_changing_rooms"

export async function loadMatchCentre(
  supabase: Client,
  fixtureId: string,
  /**
   * WHICH HAT THIS PERSON IS WEARING.
   *
   * The server answers about the USER; the context says which of their roles they
   * are operating as. A club admin reading their daughter's match as a parent must
   * not be offered their coach's controls. It can only ever REMOVE a capability --
   * the database is still the authority, and refuses a genuine parent regardless.
   */
  contextKind: ActiveContextKind | null = null
): Promise<MatchCentreView | null> {
  const { data: f, error } = await supabase.from("fixtures").select(FIXTURE_FIELDS).eq("id", fixtureId).maybeSingle()
  // A fixture that does not exist and one this viewer may not see are the same
  // answer, so the platform's fixtures cannot be mapped by probing ids.
  if (error || !f) return null

  const roomIds = [f.home_changing_room_id, f.away_changing_room_id, f.officials_changing_room_id].filter((r): r is string => Boolean(r))
  const [{ data: caps }, { data: viewer }, { data: mineRows }, { data: pitch }, { data: competition }, { data: rooms }] = await Promise.all([
    supabase.rpc("get_match_centre_capabilities", { p_fixture_id: fixtureId }).maybeSingle(),
    supabase.rpc("get_match_centre_viewer", { p_fixture_id: fixtureId }),
    supabase.rpc("get_my_players_for_fixture", { p_fixture_id: fixtureId }),
    f.pitch_id
      ? supabase.from("club_pitches").select("id, display_name, description, cover_image_path, cover_stock_key").eq("id", f.pitch_id).maybeSingle()
      : Promise.resolve({ data: null }),
    f.competition_edition_id
      ? supabase.from("competition_editions").select("competitions(name)").eq("id", f.competition_edition_id).maybeSingle()
      : Promise.resolve({ data: null }),
    roomIds.length
      ? supabase.from("venue_changing_rooms").select("id, display_name, cover_image_path, cover_stock_key").in("id", roomIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string; cover_image_path: string | null; cover_stock_key: string | null }[] }),
  ])

  const [owning, opponent] = await Promise.all([
    resolveSide(supabase, f.owning_team_id, null),
    resolveSide(supabase, f.opponent_team_id, f.opponent_directory_id, f.raw_opposition_text),
  ])
  // THE FIXTURE'S OWN ORIENTATION decides who is home. "TBD" and "Not Applicable" keep the row's order.
  const owningIsHome = f.home_away !== "Away"
  const home = owningIsHome ? owning : opponent
  const away = owningIsHome ? opponent : owning

  /*
    THE VENUE, THROUGH THE ONE CANONICAL RESOLVER: the chosen venue, then the
    fixture's own address, then the HOME side's default ground -- which for an away
    fixture is the OPPOSITION's, not ours.
  */
  const venue = await resolveFixtureVenue(supabase, {
    venueId: f.venue_id,
    venueAddress: f.venue_address,
    homeClubId: homeClubIdFor({
      homeAway: f.home_away,
      owningClubId: await clubIdOfTeam(supabase, f.owning_team_id),
      opponentClubId: await clubIdOfTeam(supabase, f.opponent_team_id),
    }),
    homeDirectoryId: f.home_away === "Away" ? f.opponent_directory_id : null,
  })
  const { data: venueRow } = f.venue_id
    ? await supabase
        .from("venues")
        .select("id, directions, cover_image_path, cover_stock_key, catering_available, changing_rooms_available")
        .eq("id", f.venue_id)
        .maybeSingle()
    : { data: null }

  const capabilities = narrowCapabilitiesToContext(
    {
      canViewParticipants: Boolean(caps?.can_view_participants),
      canMessage: Boolean(caps?.can_message),
      canManageFixture: Boolean(caps?.can_manage_fixture),
    },
    contextKind
  )
  const v = (viewer ?? {}) as {
    side?: "home" | "away" | null
    kickedOff?: boolean
    ground?: {
      name: string | null
      address: string | null
      postcode: string | null
      coverImagePath?: string | null
      coverStockKey?: string | null
      directions?: string | null
      cateringAvailable?: boolean | null
      changingRoomsAvailable?: boolean | null
    } | null
  }
  const roomOf = (id: string | null): MatchCentreRoom | null => {
    const r = (rooms ?? []).find((x) => x.id === id)
    return r ? { id: r.id, name: r.display_name, coverImagePath: r.cover_image_path, coverStockKey: r.cover_stock_key } : null
  }

  return {
    fixtureId: f.id,
    home,
    away,
    viewerSide: v.side ?? null,
    homeAway: (f.home_away as MatchCentreView["homeAway"]) ?? null,
    date: f.kickoff_date,
    kickoffTime: f.kickoff_time,
    meetTime: f.meet_time ? String(f.meet_time).slice(0, 5) : null,
    kickedOff: Boolean(v.kickedOff),
    status: matchCentreStatus(f),
    cancelled: f.cancelled_at !== null || f.status === "Cancelled",
    cancellationReason: f.cancellation_reason,
    /*
      A RESULT IS A RESULT ONLY WHEN THE WORKFLOW SAYS SO. `none` means nobody has
      recorded one, and two nulls are not a nil-nil draw.
    */
    result:
      f.result_status && f.result_status !== "none" && f.home_score !== null && f.away_score !== null
        ? { homeScore: f.home_score, awayScore: f.away_score }
        : null,
    resultStatus: f.result_status ?? null,
    venue: {
      id: f.venue_id,
      // The away side cannot read the home club's venue rows; the server's own answer
      // (`get_match_centre_viewer.ground`) fills in what the direct read could not.
      name: venue?.name ?? v.ground?.name ?? null,
      postcode: venue?.postcode ?? v.ground?.postcode ?? null,
      // Built from the structured columns, blanks dropped -- never "Holden Road, , , BB11".
      addressLines: (venue?.address ?? v.ground?.address ?? "").split(",").map((l) => l.trim()).filter(Boolean),
      directions: venueRow?.directions ?? v.ground?.directions ?? null,
      coverImagePath: venueRow?.cover_image_path ?? v.ground?.coverImagePath ?? null,
      coverStockKey: venueRow?.cover_stock_key ?? v.ground?.coverStockKey ?? null,
      cateringAvailable: venueRow?.catering_available ?? v.ground?.cateringAvailable ?? null,
      changingRoomsAvailable: venueRow?.changing_rooms_available ?? v.ground?.changingRoomsAvailable ?? null,
    },
    pitch: {
      id: f.pitch_id,
      // The away side may not read the host's pitch row; the match carries the pitch's name itself.
      name: pitch?.display_name ?? (f.pitch_allocation?.trim() || null),
      description: pitch?.description ?? null,
      coverImagePath: pitch?.cover_image_path ?? null,
      coverStockKey: pitch?.cover_stock_key ?? null,
    },
    homeRoom: roomOf(f.home_changing_room_id),
    awayRoom: roomOf(f.away_changing_room_id),
    officialsRoom: roomOf(f.officials_changing_room_id),
    homeRoomNumber: f.home_changing_room_number ?? null,
    awayRoomNumber: f.away_changing_room_number ?? null,
    noChangingRooms: Boolean(f.no_changing_rooms),
    // The host is the HOME side, whoever is looking.
    facilityMode: f.home_away === "Home" || f.home_away === "Away" ? (home.onOvalball ? "CANONICAL" : "PROVISIONAL") : "UNDECIDED",
    changingRoomNotes: f.changing_room ?? null,
    cateringRequired: Boolean(f.catering_required),
    notes: f.notes ?? null,
    competitionName: (competition?.competitions as { name: string } | null)?.name ?? null,
    matchType: matchTypeLabel((f as { game_type?: string | null }).game_type ?? null),
    mine: (mineRows ?? []).map((r) => ({
      playerId: r.player_id,
      firstName: r.first_name ?? "",
      displayName: `${r.first_name ?? ""} ${r.surname ?? ""}`.trim() || "Player",
      // From players.user_id, resolved by the RPC -- never inferred from a name or a role label.
      isSelf: r.relationship === "self",
      response: (r.current_status as AvailabilityStatus | null) ?? null,
      canRespond: r.can_respond,
      cannotRespondReason: r.denial_reason,
    })),
    canMessage: capabilities.canMessage,
    canManageFixture: capabilities.canManageFixture,
  }
}

/**
 * THE SQUAD, AND WHAT EACH PERSON SAID.
 *
 * Read through the tables' OWN RLS rather than through a definer wrapper, which
 * is what makes this safe to call for either side of a fixture:
 * `player_team_memberships_select` requires `team.roster.view` on that specific
 * team, so the opposition's roster simply does not come back for somebody who
 * holds nothing on it. The capability flag above decides whether the SECTION
 * appears; the policies decide who is in it.
 *
 * INITIALS ONLY, so no avatar is fetched at all. A register is not a gallery of
 * other people's children, and the web's registers made the same choice.
 */
export async function loadRegister(supabase: Client, fixtureId: string): Promise<RegisterEntry[]> {
  const { data: teamRows } = await supabase.rpc("fixture_availability_summary", { p_fixture_ids: [fixtureId] })
  // The summary is asked for first as the authority probe: NO ROW means "you are
  // not entitled to know", and in that case the register is not attempted either.
  if (!teamRows || teamRows.length === 0) return []

  const { data: f } = await supabase
    .from("fixtures")
    .select("owning_team_id, opponent_team_id, owning_scheduling_group_id, opponent_scheduling_group_id")
    .eq("id", fixtureId)
    .maybeSingle()
  if (!f) return []

  const groupIds = [f.owning_scheduling_group_id, f.opponent_scheduling_group_id].filter((g): g is string => Boolean(g))
  const { data: groupMembers } = groupIds.length
    ? await supabase.from("scheduling_group_members").select("team_id").in("group_id", groupIds)
    : { data: [] as { team_id: string }[] }

  const teamIds = Array.from(
    new Set(
      [f.owning_team_id, f.opponent_team_id, ...(groupMembers ?? []).map((m) => m.team_id)].filter((t): t is string => Boolean(t))
    )
  )
  if (teamIds.length === 0) return []

  const { data: roster } = await supabase
    .from("player_team_memberships")
    .select("player_id")
    .in("team_id", teamIds)
    .eq("status", "active")

  const playerIds = Array.from(new Set((roster ?? []).map((r) => r.player_id)))
  /*
    NAMES THROUGH THE STAFF PROJECTION, NOT THE PLAYERS TABLE (CA-M7).

    `players` answers only the player, their active guardians and Ovalball; a coach or team manager
    reading it through a join gets NULL, and the first version of this loader silently dropped every
    row whose join came back empty -- so a Team Manager holding `team.attendance.view` opened Who's In
    and was told "Nobody to ask yet" about a squad of three. `player_staff_view` is the canonical
    projection for exactly this reader: the players this person may see at their club or team, names
    and an age grade, no date of birth. A Club Admin was never affected, which is how it went unseen.
  */
  const [names, { data: answers }] = await Promise.all([
    loadStaffPlayers(supabase, playerIds),
    playerIds.length
      ? supabase.from("player_fixture_attendance").select("player_id, status").eq("fixture_id", fixtureId).in("player_id", playerIds)
      : Promise.resolve({ data: [] as { player_id: string; status: string }[] }),
  ])
  const byPlayer = new Map((answers ?? []).map((a) => [a.player_id, a.status as AvailabilityStatus]))

  const entries: RegisterEntry[] = []
  for (const id of playerIds) {
    const p = names.get(id)
    // A player the staff projection does not return is one this viewer may not see; the row is not drawn.
    if (!p) continue
    entries.push({ playerId: id, firstName: p.firstName, surname: p.surname, status: byPlayer.get(id) ?? null })
  }
  // Surname then forename, exactly as public.get_training_register orders its own
  // register, so the two read the same way.
  return entries.sort((a, b) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName))
}

async function resolveSide(
  supabase: Client,
  teamId: string | null,
  directoryId: string | null,
  rawText?: string | null
): Promise<MatchCentreSide> {
  if (teamId) {
    const { data: team } = await supabase
      .from("teams")
      .select("id, display_name, clubs(id, logo_storage_path, club_directory(id, name, logo_storage_path))")
      .eq("id", teamId)
      .maybeSingle()
    const club = team?.clubs as
      | { id: string; logo_storage_path: string | null; club_directory: { id: string; name: string; logo_storage_path: string | null } | null }
      | null
    // The club's PRIMARY kit, from the canonical row. A child recognises the
    // shirt before the badge, which is why the hero gives it equal billing.
    const { data: kitRow } = club
      ? await supabase
          .from("club_kits")
          .select("pattern, primary_colour, secondary_colour, accent_colour")
          .eq("club_id", club.id)
          .eq("variant", "primary")
          .maybeSingle()
      : { data: null }
    return {
      teamId: team?.id ?? teamId,
      clubId: club?.id ?? null,
      directoryId: club?.club_directory?.id ?? null,
      clubName: club?.club_directory?.name ?? team?.display_name ?? "Club",
      teamName: team?.display_name ?? null,
      crestUrl: club
        ? resolveClubLogoUrl(supabase, {
            logo_storage_path: club.logo_storage_path,
            club_directory: club.club_directory ? { logo_storage_path: club.club_directory.logo_storage_path } : null,
          })
        : null,
      kit: kitRow
        ? {
            pattern: kitRow.pattern as KitConfig["pattern"],
            primaryColour: kitRow.primary_colour,
            secondaryColour: kitRow.secondary_colour,
            accentColour: kitRow.accent_colour,
          }
        : null,
      // A `clubs` row existing IS the answer. Never a name match, never a crest,
      // never an email domain.
      onOvalball: Boolean(club),
    }
  }
  if (directoryId) {
    const { data: dir } = await supabase.from("club_directory").select("id, name, logo_storage_path").eq("id", directoryId).maybeSingle()
    return {
      teamId: null,
      clubId: null,
      directoryId: dir?.id ?? directoryId,
      clubName: dir?.name ?? "Opposition",
      teamName: null,
      crestUrl: dir?.logo_storage_path
        ? resolveClubLogoUrl(supabase, { logo_storage_path: null, club_directory: { logo_storage_path: dir.logo_storage_path } })
        : null,
      kit: null,
      onOvalball: false,
    }
  }
  // An opponent recorded as free text, or none recorded yet. Both are real
  // states and neither is given a fake identity.
  return { teamId: null, clubId: null, directoryId: null, clubName: rawText?.trim() || "Opposition to be confirmed", teamName: null, crestUrl: null, kit: null, onOvalball: false }
}

/** Which club a team belongs to, for resolving whose ground a fixture is played at. */
async function clubIdOfTeam(supabase: Client, teamId: string | null): Promise<string | null> {
  if (!teamId) return null
  const { data } = await supabase.from("teams").select("club_id").eq("id", teamId).maybeSingle()
  return data?.club_id ?? null
}
