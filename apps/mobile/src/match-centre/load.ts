import type { SupabaseClient } from "@supabase/supabase-js"
import { matchCentreStatus, resolveClubLogoUrl, type Database, type KitConfig, type MatchCentreStatus } from "@ovalball/contracts"
import type { AvailabilityStatus } from "@ovalball/contracts/availability"

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
 * WHAT IS DELIBERATELY NOT SHOWN. Fixture logistics. The date, the venue, the
 * pitch, the meet time and the kick-off are the Fixture Console's, and Match
 * Centre owns PEOPLE -- availability, the squad, match-day preparation. The
 * header states enough to know which match this is and offers the route back to
 * the console rather than reproducing it.
 */

type Client = SupabaseClient<Database>

export interface MatchCentreSide {
  clubName: string
  teamName: string | null
  crestUrl: string | null
  /**
   * The club's own playing shirt, from the canonical `club_kits` row. Null for a
   * club that has not configured one, which is a real and common state -- an
   * opposition that is only a Directory entry almost always is -- and gets a
   * finished dashed placeholder rather than an empty box.
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

export interface MatchCentreView {
  fixtureId: string
  /** The viewer's own side, flipped by the canonical orientation -- never inferred from which team is printed first. */
  us: MatchCentreSide
  them: MatchCentreSide
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable" | null
  date: string
  kickoffTime: string | null
  meetTime: string | null
  /**
   * The DERIVED Match Centre state, not the raw `fixtures.status` column. It is
   * built by the shared `matchCentreStatus`, which also folds in `cancelled_at`
   * and a pending kick-off amendment -- so the app says "Confirmed" exactly
   * where the website does rather than showing the database's operational
   * "Booked".
   */
  status: MatchCentreStatus
  cancelled: boolean
  cancellationReason: string | null
  /** A recorded result, or null. Two nulls are not a nil-nil draw. */
  result: { homeScore: number; awayScore: number } | null
  venueName: string | null
  venuePostcode: string | null
  venueAddressLines: string[]
  pitchName: string | null
  competitionName: string | null
  mine: MyAvailability[]
  /** Empty for a viewer without staff attendance authority. The section is then not rendered at all. */
  register: RegisterEntry[]
  canViewRegister: boolean
  canMessage: boolean
  canManageFixture: boolean
}

const FIXTURE_FIELDS =
  "id, owning_team_id, opponent_team_id, opponent_directory_id, home_away, status, kickoff_date, kickoff_time, meet_time, cancelled_at, cancellation_reason, kickoff_amendment_proposed_at, venue_id, pitch_id, competition_edition_id, raw_opposition_text, home_score, away_score, result_status"

export async function loadMatchCentre(supabase: Client, fixtureId: string): Promise<MatchCentreView | null> {
  const { data: f, error } = await supabase.from("fixtures").select(FIXTURE_FIELDS).eq("id", fixtureId).maybeSingle()
  // A fixture that does not exist and one this viewer may not see are the same
  // answer. Telling them apart would let somebody map the platform's fixtures by
  // watching which ids behave differently -- the same reasoning the web page's
  // 404 records.
  if (error || !f) return null

  const [{ data: caps }, { data: mineRows }, { data: venue }, { data: pitch }, { data: competition }] = await Promise.all([
    supabase.rpc("get_match_centre_capabilities", { p_fixture_id: fixtureId }).maybeSingle(),
    supabase.rpc("get_my_players_for_fixture", { p_fixture_id: fixtureId }),
    f.venue_id
      ? supabase
          .from("venues")
          .select("id, name, address_line_1, address_line_2, town, county, postcode")
          .eq("id", f.venue_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    f.pitch_id ? supabase.from("club_pitches").select("id, display_name").eq("id", f.pitch_id).maybeSingle() : Promise.resolve({ data: null }),
    f.competition_edition_id
      ? supabase.from("competition_editions").select("competitions(name)").eq("id", f.competition_edition_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const [us, them] = await Promise.all([
    resolveSide(supabase, f.owning_team_id, null),
    resolveSide(supabase, f.opponent_team_id, f.opponent_directory_id, f.raw_opposition_text),
  ])

  const canViewRegister = Boolean(caps?.can_view_participants)
  const register = canViewRegister ? await loadRegister(supabase, fixtureId) : []

  return {
    fixtureId: f.id,
    us,
    them,
    homeAway: (f.home_away as MatchCentreView["homeAway"]) ?? null,
    date: f.kickoff_date,
    kickoffTime: f.kickoff_time,
    meetTime: f.meet_time ? String(f.meet_time).slice(0, 5) : null,
    status: matchCentreStatus(f),
    cancelled: f.cancelled_at !== null || f.status === "Cancelled",
    cancellationReason: f.cancellation_reason,
    /*
      A RESULT IS A RESULT ONLY WHEN THE WORKFLOW SAYS SO. `none` means nobody
      has recorded one, and two nulls are not a nil-nil draw -- so the hero says
      "V" rather than inventing a scoreline out of absent data, exactly as the
      web's does.
    */
    result:
      f.result_status && f.result_status !== "none" && f.home_score !== null && f.away_score !== null
        ? { homeScore: f.home_score, awayScore: f.away_score }
        : null,
    venueName: venue?.name ?? null,
    venuePostcode: venue?.postcode ?? null,
    // Built from the structured columns, blanks dropped -- never a string
    // concatenation that yields "Holden Road, , , BB11".
    venueAddressLines: venue
      ? [venue.address_line_1, venue.address_line_2, venue.town, venue.county].filter((l): l is string => Boolean(l && l.trim()))
      : [],
    pitchName: pitch?.display_name ?? null,
    competitionName: (competition?.competitions as { name: string } | null)?.name ?? null,
    mine: (mineRows ?? []).map((r) => ({
      playerId: r.player_id,
      firstName: r.first_name ?? "",
      displayName: `${r.first_name ?? ""} ${r.surname ?? ""}`.trim() || "Player",
      // From players.user_id, resolved by the RPC. Never inferred here from a
      // name, an email or a role label.
      isSelf: r.relationship === "self",
      response: (r.current_status as AvailabilityStatus | null) ?? null,
      canRespond: r.can_respond,
      cannotRespondReason: r.denial_reason,
    })),
    register,
    canViewRegister,
    canMessage: Boolean(caps?.can_message),
    canManageFixture: Boolean(caps?.can_manage_fixture),
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
async function loadRegister(supabase: Client, fixtureId: string): Promise<RegisterEntry[]> {
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
    .select("player_id, players(id, first_name, surname)")
    .in("team_id", teamIds)
    .eq("status", "active")

  const playerIds = (roster ?? []).map((r) => r.player_id)
  const { data: answers } = playerIds.length
    ? await supabase.from("player_fixture_attendance").select("player_id, status").eq("fixture_id", fixtureId).in("player_id", playerIds)
    : { data: [] as { player_id: string; status: string }[] }
  const byPlayer = new Map((answers ?? []).map((a) => [a.player_id, a.status as AvailabilityStatus]))

  const seen = new Set<string>()
  const entries: RegisterEntry[] = []
  for (const r of roster ?? []) {
    const p = r.players as { id: string; first_name: string; surname: string } | null
    if (!p || seen.has(p.id)) continue
    seen.add(p.id)
    entries.push({ playerId: p.id, firstName: p.first_name ?? "", surname: p.surname ?? "", status: byPlayer.get(p.id) ?? null })
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
  return { clubName: rawText?.trim() || "Opposition to be confirmed", teamName: null, crestUrl: null, kit: null, onOvalball: false }
}
