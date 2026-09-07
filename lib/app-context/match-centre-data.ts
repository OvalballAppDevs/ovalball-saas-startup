import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { KitConfig } from "@/components/club/rugby-kit"
import { effectiveTeamIdsForFixtureSide } from "@/lib/mini-rugby/effective-teams"
import { loadTeamIdentitiesForSeason, teamIdentityKey } from "@/lib/mini-rugby/team-identity.server"
import type { Database } from "@/types/database.types"

import { resolveClubLogoUrl } from "./club-logo"
import { resolvePersonalAvatarUrl } from "./personal-avatar"

/**
 * Match Centre real data resolver (Phase 1 of the Side Project 3 -> Main
 * integration plan). This is the production implementation of the typed
 * contract Side Project 3 Stage 8 designed in isolation
 * (ovalball-rugby-knowledge/lib/match-centre/fixture-context.ts, audited
 * for field names, never imported). One canonical fixture_id drives
 * everything on this page -- no per-side fixture object, no duplicate
 * fixture abstraction.
 *
 * Every read below is either already covered by the table's own RLS
 * (fixtures, player_fixture_attendance, fixture_player_call_up,
 * fixture_messages all have real policies) or resolved through the two new
 * capability wrappers in 20261028000000_match_centre_capabilities.sql,
 * which add zero new authorization logic of their own -- they call Main's
 * existing canonical functions (internal.resolve_attendance_response_
 * source, internal.can_access_fixture_conversation, internal.can_manage_
 * fixture_side) and shape the result for a page to render.
 */

export type AttendanceStatus = "ATTENDING" | "CANNOT_ATTEND" | "UNSURE"
/**
 * Only two real states today: Main has profiles.avatar_storage_path and no
 * player-photo column, so PHOTO_ALLOWED is only ever true for a roster
 * player who is also a signed-in adult with their own profile avatar.
 * Side Project 3's isolated design also modelled a third HIDDEN_IDENTITY
 * state for a future, not-yet-decided visibility policy -- deliberately
 * not carried over here: there is no real policy in Main that produces it
 * yet, and fabricating a third UI state with nothing behind it would be
 * worse than the two honest ones below.
 */
export type AvatarState = "PHOTO_ALLOWED" | "INITIALS_ONLY"
export type FixtureStatus = "PLANNED" | "AWAITING_OPPOSITION" | "ACCEPTED" | "AMENDMENT_PENDING" | "CANCELLED" | "COMPLETED"

export interface MatchCentreFixture {
  fixtureId: string
  status: FixtureStatus
  kickoffDate: string
  kickoffTime: string | null
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable"
  competitionIdentity: string | null
  cancellationReason: string | null
}

export interface MatchCentreSide {
  claimed: boolean
  clubId: string | null
  clubDirectoryId: string | null
  clubDisplayName: string
  clubLogoUrl: string | null
  fixtureSeasonTeamIdentity: string
  teamId: string | null
  schedulingGroupId: string | null
  effectiveTeamIds: string[]
  kit: KitConfig | null
}

export interface MatchCentreVenue {
  venueId: string | null
  name: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
}

export interface MatchCentrePitch {
  pitchId: string | null
  label: string | null
}

export interface CallUpMarker {
  sourceTeamId: string
  targetTeamId: string
  status: "requested" | "approved" | "rejected" | "revoked"
}

export interface MatchCentreParticipant {
  playerId: string
  displayName: string
  teamId: string
  avatarState: AvatarState
  avatarUrl: string | null
  initials: string
  response: AttendanceStatus | null
  callUp: CallUpMarker | null
}

/** One player the current viewer is authorized to respond for on this fixture -- real Main data allows more than one (e.g. a guardian of twins), unlike Side Project 3's single-player simplification. */
export interface MyAttendanceEntry {
  playerId: string
  displayName: string
  response: AttendanceStatus | null
  canRespond: boolean
  cannotRespondReason: string | null
}

export interface MatchCentreAttendance {
  counts: { attending: number; cannotAttend: number; unsure: number; awaitingResponse: number }
  mine: MyAttendanceEntry[]
}

export interface FixtureConversationRef {
  fixtureId: string
  canView: boolean
  canPost: boolean
  unavailableReason: "NOT_PERMITTED" | null
}

export interface MatchCentreActions {
  canViewParticipants: boolean
  canMessage: boolean
  canManageFixture: boolean
}

export interface MatchCentreContext {
  fixture: MatchCentreFixture
  homeSide: MatchCentreSide
  awaySide: MatchCentreSide
  venue: MatchCentreVenue
  pitch: MatchCentrePitch
  attendance: MatchCentreAttendance
  participants: MatchCentreParticipant[]
  messaging: FixtureConversationRef
  actions: MatchCentreActions
}

export type MatchCentreResolution = { status: "available"; context: MatchCentreContext } | { status: "not_found" }

function mapFixtureStatus(f: {
  status: string
  cancelled_at: string | null
  kickoff_amendment_proposed_at: string | null
  opponent_team_id: string | null
  opponent_directory_id: string | null
}): FixtureStatus {
  if (f.cancelled_at) return "CANCELLED"
  if (f.kickoff_amendment_proposed_at) return "AMENDMENT_PENDING"
  if (f.status === "Completed") return "COMPLETED"
  if (f.status === "To Be Determined" || (!f.opponent_team_id && !f.opponent_directory_id)) return "AWAITING_OPPOSITION"
  if (f.status === "Booked") return "ACCEPTED"
  return "PLANNED"
}

function initialsFromName(first: string, surname: string): string {
  return `${first[0] ?? ""}${surname[0] ?? ""}`.toUpperCase() || "?"
}

export async function getMatchCentreContext(supabase: SupabaseClient<Database>, userId: string, fixtureId: string): Promise<MatchCentreResolution> {
  const { data: f } = await supabase
    .from("fixtures")
    .select(
      "id, owning_team_id, opponent_team_id, opponent_directory_id, home_away, status, kickoff_date, kickoff_time, cancelled_at, cancellation_reason, kickoff_amendment_proposed_at, venue_id, pitch_id, owning_scheduling_group_id, opponent_scheduling_group_id, competition_edition_id"
    )
    .eq("id", fixtureId)
    .maybeSingle()

  if (!f) return { status: "not_found" }

  const [{ data: caps }, { data: groupMembersRows }] = await Promise.all([
    supabase.rpc("get_match_centre_capabilities", { p_fixture_id: fixtureId }).maybeSingle(),
    f.owning_scheduling_group_id || f.opponent_scheduling_group_id
      ? supabase
          .from("scheduling_group_members")
          .select("group_id, team_id")
          .in("group_id", [f.owning_scheduling_group_id, f.opponent_scheduling_group_id].filter((x): x is string => !!x))
      : Promise.resolve({ data: [] as { group_id: string; team_id: string }[] }),
  ])

  const groupMembers = new Map<string, string[]>()
  for (const row of groupMembersRows ?? []) {
    const list = groupMembers.get(row.group_id) ?? []
    list.push(row.team_id)
    groupMembers.set(row.group_id, list)
  }

  const homeEffectiveIds = effectiveTeamIdsForFixtureSide(f.owning_team_id, f.owning_scheduling_group_id, groupMembers)
  const awayEffectiveIds = f.opponent_team_id ? effectiveTeamIdsForFixtureSide(f.opponent_team_id, f.opponent_scheduling_group_id, groupMembers) : []
  const isHomeOwning = f.home_away === "Home" || f.home_away === "TBD" || f.home_away === "Not Applicable"
  const homeTeamId = isHomeOwning ? f.owning_team_id : f.opponent_team_id
  const awayTeamId = isHomeOwning ? f.opponent_team_id : f.owning_team_id
  const homeEffective = isHomeOwning ? homeEffectiveIds : awayEffectiveIds
  const awayEffective = isHomeOwning ? awayEffectiveIds : homeEffectiveIds
  const homeGroupId = isHomeOwning ? f.owning_scheduling_group_id : f.opponent_scheduling_group_id
  const awayGroupId = isHomeOwning ? f.opponent_scheduling_group_id : f.owning_scheduling_group_id

  const { data: season } = await supabase.from("seasons").select("id").lte("starts_on", f.kickoff_date).gte("ends_on", f.kickoff_date).maybeSingle()

  // owning_team_id is never null, so at most one of homeTeamId/awayTeamId is
  // null -- whichever one is null is the unresolved opponent side, and
  // f.opponent_directory_id (the unclaimed-opposition reference) belongs to
  // that side regardless of which of home/away it turned out to be.
  const [homeSide, awaySide] = await Promise.all([
    homeTeamId ? resolveSide(supabase, homeTeamId, homeGroupId, homeEffective, season?.id ?? null) : resolveUnclaimedSide(supabase, f.opponent_directory_id),
    awayTeamId ? resolveSide(supabase, awayTeamId, awayGroupId, awayEffective, season?.id ?? null) : resolveUnclaimedSide(supabase, f.opponent_directory_id),
  ])

  const [{ data: venue }, { data: pitch }, { data: competition }] = await Promise.all([
    f.venue_id ? supabase.from("venues").select("id, name, address, latitude, longitude").eq("id", f.venue_id).maybeSingle() : Promise.resolve({ data: null }),
    f.pitch_id ? supabase.from("club_pitches").select("id, display_name").eq("id", f.pitch_id).maybeSingle() : Promise.resolve({ data: null }),
    f.competition_edition_id
      ? supabase.from("competition_editions").select("competitions(name)").eq("id", f.competition_edition_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const allTeamIds = Array.from(new Set([...homeEffective, ...awayEffective]))
  // STAFF-LEVEL only (site admin or team.attendance.view) -- deliberately
  // narrower than "can I see my own linked player". A guardian/self
  // relationship never widens this: Main's own RLS on player_fixture_
  // attendance and player_team_memberships already scopes those tables to
  // a guardian's own linked player row only, so a "full roster" section
  // gated on anything broader would silently render a partial roster as if
  // it were complete -- caught live in UAT (a guardian's aggregate counts
  // showed only her own two children rather than the whole fixture) before
  // this comment/split existed.
  const canViewParticipants = caps?.can_view_participants ?? false

  const participants: MatchCentreParticipant[] = []
  const counts = { attending: 0, cannotAttend: 0, unsure: 0, awaitingResponse: 0 }
  const mine: MyAttendanceEntry[] = []

  // "Mine" is resolved independently of canViewParticipants and ALWAYS
  // attempted -- a guardian or self-player must see and respond to their
  // own linked player's attendance regardless of whether they can see the
  // rest of the roster. Scoped narrowly (only this viewer's own candidate
  // player ids), so it stays correct under player_team_memberships' /
  // player_fixture_attendance's own row-level RLS rather than assuming the
  // caller can read the full roster.
  const [{ data: myGuardianRows }, { data: myOwnPlayer }] = await Promise.all([
    supabase.from("guardians").select("player_id, players(id, first_name, surname)").eq("guardian_user_id", userId).eq("status", "active"),
    supabase.from("players").select("id, first_name, surname").eq("user_id", userId).maybeSingle(),
  ])
  const myCandidates = new Map<string, { id: string; first_name: string; surname: string }>()
  for (const g of myGuardianRows ?? []) if (g.players) myCandidates.set(g.player_id, g.players)
  if (myOwnPlayer) myCandidates.set(myOwnPlayer.id, myOwnPlayer)

  if (myCandidates.size > 0 && allTeamIds.length > 0) {
    const candidateIds = Array.from(myCandidates.keys())
    const [{ data: myMemberships }, { data: myAttendance }] = await Promise.all([
      supabase.from("player_team_memberships").select("player_id, team_id").in("player_id", candidateIds).eq("status", "active"),
      supabase.from("player_fixture_attendance").select("player_id, status").eq("fixture_id", fixtureId).in("player_id", candidateIds),
    ])
    const myAttendanceByPlayer = new Map((myAttendance ?? []).map((a) => [a.player_id, a.status as AttendanceStatus]))
    const myRelevantPlayerIds = new Set((myMemberships ?? []).filter((m) => allTeamIds.includes(m.team_id)).map((m) => m.player_id))

    for (const playerId of myRelevantPlayerIds) {
      const player = myCandidates.get(playerId)
      if (!player) continue
      const { data: authority } = await supabase.rpc("get_my_attendance_authority", { p_player_id: playerId }).maybeSingle()
      mine.push({
        playerId,
        displayName: `${player.first_name} ${player.surname}`,
        response: myAttendanceByPlayer.get(playerId) ?? null,
        canRespond: (authority?.can_respond ?? false) && !f.cancelled_at,
        cannotRespondReason: f.cancelled_at ? "This fixture has been cancelled." : (authority?.denial_reason ?? null),
      })
    }
  }

  if (canViewParticipants && allTeamIds.length > 0) {
    const { data: roster } = await supabase
      .from("player_team_memberships")
      .select("player_id, team_id, players(id, first_name, surname, user_id)")
      .in("team_id", allTeamIds)
      .eq("status", "active")

    const rosterPlayerIds = (roster ?? []).map((r) => r.player_id)

    const [{ data: attendanceRows }, { data: callUpRows }] = await Promise.all([
      rosterPlayerIds.length > 0
        ? supabase.from("player_fixture_attendance").select("player_id, status").eq("fixture_id", fixtureId).in("player_id", rosterPlayerIds)
        : Promise.resolve({ data: [] }),
      supabase.from("fixture_player_call_up").select("player_id, source_team_id, target_team_id, status").eq("fixture_id", fixtureId),
    ])

    const attendanceByPlayer = new Map((attendanceRows ?? []).map((a) => [a.player_id, a.status as AttendanceStatus]))
    const callUpByPlayer = new Map((callUpRows ?? []).map((c) => [c.player_id, c]))

    // Profile avatars are resolved only for the small set of roster players
    // that ARE also a signed-in adult with their own profile -- never
    // fetched speculatively for every player, and never a substitute for a
    // player's own photo (Main has no such column).
    const adultUserIds = (roster ?? []).map((r) => r.players?.user_id).filter((x): x is string => !!x)
    const { data: profiles } =
      adultUserIds.length > 0 ? await supabase.from("profiles").select("id, avatar_storage_path").in("id", adultUserIds) : { data: [] }
    const profileByUserId = new Map((profiles ?? []).map((p) => [p.id, p.avatar_storage_path]))

    for (const r of roster ?? []) {
      const p = r.players
      if (!p) continue
      const response = attendanceByPlayer.get(p.id) ?? null
      const callUpRow = callUpByPlayer.get(p.id)
      const avatarPath = p.user_id ? profileByUserId.get(p.user_id) : null
      const avatarUrl = avatarPath ? resolvePersonalAvatarUrl(supabase, avatarPath) : null

      participants.push({
        playerId: p.id,
        displayName: `${p.first_name} ${p.surname}`,
        teamId: r.team_id,
        avatarState: avatarUrl ? "PHOTO_ALLOWED" : "INITIALS_ONLY",
        avatarUrl,
        initials: initialsFromName(p.first_name, p.surname),
        response,
        callUp: callUpRow ? { sourceTeamId: callUpRow.source_team_id, targetTeamId: callUpRow.target_team_id, status: callUpRow.status as CallUpMarker["status"] } : null,
      })

      if (response === "ATTENDING") counts.attending++
      else if (response === "CANNOT_ATTEND") counts.cannotAttend++
      else if (response === "UNSURE") counts.unsure++
      else counts.awaitingResponse++
    }
  }

  return {
    status: "available",
    context: {
      fixture: {
        fixtureId: f.id,
        status: mapFixtureStatus(f),
        kickoffDate: f.kickoff_date,
        kickoffTime: f.kickoff_time,
        homeAway: f.home_away as MatchCentreFixture["homeAway"],
        competitionIdentity: (competition?.competitions as { name: string } | null)?.name ?? null,
        cancellationReason: f.cancellation_reason,
      },
      homeSide,
      awaySide,
      venue: venue
        ? { venueId: venue.id, name: venue.name, address: venue.address, latitude: venue.latitude != null ? Number(venue.latitude) : null, longitude: venue.longitude != null ? Number(venue.longitude) : null }
        : { venueId: null, name: null, address: null, latitude: null, longitude: null },
      pitch: pitch ? { pitchId: pitch.id, label: pitch.display_name } : { pitchId: null, label: null },
      attendance: { counts, mine },
      participants,
      messaging: {
        fixtureId: f.id,
        canView: caps?.can_message ?? false,
        canPost: caps?.can_message ?? false,
        unavailableReason: caps?.can_message ? null : "NOT_PERMITTED",
      },
      actions: {
        canViewParticipants,
        canMessage: caps?.can_message ?? false,
        canManageFixture: caps?.can_manage_fixture ?? false,
      },
    },
  }
}

async function resolveSide(supabase: SupabaseClient<Database>, teamId: string, groupId: string | null, effectiveIds: string[], seasonId: string | null): Promise<MatchCentreSide> {
  const { data: team } = await supabase
    .from("teams")
    .select("id, display_name, age_group, club_id, clubs(id, directory_id, logo_storage_path, club_directory(id, name, logo_storage_path))")
    .eq("id", teamId)
    .maybeSingle()

  const club = team?.clubs
  const directory = club?.club_directory
  const [{ data: kitRow }, identities] = await Promise.all([
    club ? supabase.from("club_kits").select("variant, pattern, primary_colour, secondary_colour, accent_colour").eq("club_id", club.id).eq("variant", "primary").maybeSingle() : Promise.resolve({ data: null }),
    seasonId ? loadTeamIdentitiesForSeason(supabase, [{ teamId, seasonId }]) : Promise.resolve(new Map()),
  ])
  // Real fixture-season identity when a season covering this kickoff date
  // resolves (never derived from the team's current mutable age_group when
  // this succeeds); falls back to the team's live age_group only when no
  // season row covers this date -- an honestly labelled gap, not a silent
  // wrong answer.
  const seasonIdentity = seasonId ? identities.get(teamIdentityKey(teamId, seasonId)) : null

  return {
    claimed: !!club,
    clubId: club?.id ?? null,
    clubDirectoryId: club?.directory_id ?? directory?.id ?? null,
    clubDisplayName: directory?.name ?? team?.display_name ?? "Club",
    clubLogoUrl: club ? resolveClubLogoUrl(supabase, { logo_storage_path: club.logo_storage_path, club_directory: directory ? { logo_storage_path: directory.logo_storage_path } : null }) : null,
    fixtureSeasonTeamIdentity: seasonIdentity?.displayName ?? (team?.age_group ? `Under ${team.age_group.replace(/^U/i, "")}` : (team?.display_name ?? "Team")),
    teamId,
    schedulingGroupId: groupId,
    effectiveTeamIds: effectiveIds,
    // variant is not part of Main's real KitConfig (a fetched club_kits row
    // is already known to be primary/alternate by which query produced it,
    // always 'primary' here) -- passed separately to <RugbyKit variant=.../>
    // at render time instead.
    kit: kitRow
      ? { pattern: kitRow.pattern as KitConfig["pattern"], primaryColour: kitRow.primary_colour, secondaryColour: kitRow.secondary_colour, accentColour: kitRow.accent_colour }
      : null,
  }
}

async function resolveUnclaimedSide(supabase: SupabaseClient<Database>, directoryId: string | null): Promise<MatchCentreSide> {
  if (!directoryId) {
    return { claimed: false, clubId: null, clubDirectoryId: null, clubDisplayName: "Opposition to be confirmed", clubLogoUrl: null, fixtureSeasonTeamIdentity: "", teamId: null, schedulingGroupId: null, effectiveTeamIds: [], kit: null }
  }
  const { data: directory } = await supabase.from("club_directory").select("id, name, logo_storage_path").eq("id", directoryId).maybeSingle()
  return {
    claimed: false,
    clubId: null,
    clubDirectoryId: directoryId,
    clubDisplayName: directory?.name ?? "Unclaimed club",
    clubLogoUrl: directory?.logo_storage_path ? resolveClubLogoUrl(supabase, { logo_storage_path: null, club_directory: { logo_storage_path: directory.logo_storage_path } }) : null,
    fixtureSeasonTeamIdentity: "",
    teamId: null,
    schedulingGroupId: null,
    effectiveTeamIds: [],
    kit: null,
  }
}
