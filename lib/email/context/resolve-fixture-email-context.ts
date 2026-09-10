import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { resolveDirectoryCrestEmailUrl, resolveClubCrestEmailUrl } from "@/lib/email/club-crest"
import { compactTeamLabel } from "@/lib/teams/compact-label"
import type { Database } from "@/types/database.types"

/**
 * THE CANONICAL FIXTURE EMAIL CONTEXT.
 *
 * This is the email-safe twin of lib/app-context/match-centre-data.ts's
 * getMatchCentreContext -- same tables, same field names, same club/venue/
 * pitch resolution shape, so a fixture's email data and its Match Centre
 * page can never quietly disagree about what a fixture IS. It is deliberately
 * NOT that function reused wholesale, for one structural reason stated
 * plainly rather than worked around: getMatchCentreContext is written to
 * answer "what can THIS SIGNED-IN BROWSER SESSION see", built on Postgres
 * functions (get_match_centre_capabilities, get_my_attendance_authority)
 * that read auth.uid() from the ACTIVE connection's own JWT. An email is
 * composed for a named recipient who is not the person triggering the send
 * and is usually not signed in at all, so "resolve this fixture as if you
 * were user X" is not a question those functions can answer without either
 * duplicating their authorization rules (the exact mistake
 * internal.has_club_role_capability's own migration comment warns has
 * happened ten times) or impersonating X's session token for the query --
 * a real, available Postgres/Supabase technique (already used once in this
 * codebase, in a migration-time verification guard) but a genuinely new,
 * security-sensitive piece of infrastructure that deserves its own review
 * rather than arriving as a side effect of an email context resolver.
 *
 * So this resolver answers the part of "what is this fixture" that is true
 * for EVERY recipient alike -- teams, identity, venue, pitch, competition,
 * timing, and aggregate (not per-person) attendance counts. Anything that
 * must legitimately differ per recipient (a specific player's own response,
 * "Harry's response" wording) is OUT OF SCOPE here by design -- see
 * docs/EMAIL_DATA_AND_AUDIENCE_ARCHITECTURE.md ("Recipient-relative
 * resolution") for the open decision that unblocks it.
 */

export type FixtureEmailStatus = "PLANNED" | "AWAITING_OPPOSITION" | "ACCEPTED" | "AMENDMENT_PENDING" | "CANCELLED" | "COMPLETED"

export interface FixtureEmailSide {
  /** The club's own name -- what a recipient wants to know first: which club. */
  displayName: string
  /**
   * The specific team's own canonical short label (e.g. "U12 Boys"), derived
   * from its structured identity via lib/teams/compact-label.ts -- the same
   * function Calendar and every other dense surface uses, never a second
   * re-derivation. Null when this side has no specific team on record (an
   * unclaimed directory-only opposition has a club, not yet a team).
   */
  teamLabel: string | null
  /** Email-safe crest URL (lib/email/club-crest.ts) -- never a raw storage URL, null when no crest exists. */
  crestUrl: string | null
}

export interface FixtureEmailVenue {
  name: string | null
  addressLines: string[]
  postcode: string | null
}

export interface FixtureEmailContext {
  fixtureId: string
  status: FixtureEmailStatus
  /** UK long form, e.g. "Sunday 20 September". Derived once, here -- never re-formatted per template. */
  fixtureDateDisplay: string
  /** ISO date, for a template author who genuinely needs the raw value. */
  fixtureDateIso: string
  /** UK 24-hour "HH:mm", or null when not yet set. */
  kickoffTimeDisplay: string | null
  meetTimeDisplay: string | null
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable"
  home: FixtureEmailSide
  away: FixtureEmailSide
  /**
   * The owning club's own side, and the other side -- regardless of which of
   * them is playing at home. Template authors and Dynamic Data both need
   * "Our Team" / "Opposition" far more often than "Home" / "Away", and
   * deriving that correctly (rather than assuming home == us) is exactly the
   * kind of reasoning a resolver should do once rather than every renderer
   * repeating it. Identical objects to `home`/`away` above, never a second
   * resolution.
   */
  ourTeam: FixtureEmailSide
  opposition: FixtureEmailSide
  venue: FixtureEmailVenue | null
  pitchName: string | null
  competitionName: string | null
  /** Aggregate only -- never a named participant. See this file's own header for why. */
  attendanceCounts: { attending: number; cannotAttend: number; unsure: number; awaitingResponse: number }
}

export type FixtureEmailContextResolution = { status: "available"; context: FixtureEmailContext } | { status: "not_found" }

function mapStatus(f: {
  status: string
  cancelled_at: string | null
  kickoff_amendment_proposed_at: string | null
  opponent_team_id: string | null
  opponent_directory_id: string | null
}): FixtureEmailStatus {
  if (f.cancelled_at) return "CANCELLED"
  if (f.kickoff_amendment_proposed_at) return "AMENDMENT_PENDING"
  if (f.status === "Completed") return "COMPLETED"
  if (f.status === "To Be Determined" || (!f.opponent_team_id && !f.opponent_directory_id)) return "AWAITING_OPPOSITION"
  if (f.status === "Booked") return "ACCEPTED"
  return "PLANNED"
}

/** UK long form. Deliberately hand-rolled rather than a locale library dependency, matching this codebase's existing date-display conventions. */
function formatFixtureDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`)
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
}

/** Postgres `time` columns arrive as "HH:mm:ss" -- trimmed to "HH:mm" for display, never re-derived per template. */
function formatTime(value: string | null): string | null {
  if (!value) return null
  return value.slice(0, 5)
}

async function resolveSide(
  supabase: SupabaseClient<Database>,
  teamId: string | null,
  directoryId: string | null
): Promise<FixtureEmailSide> {
  if (teamId) {
    const { data: team } = await supabase
      .from("teams")
      .select(
        "display_name, category, age_group, gender, squad_designation, rugby_code, clubs(id, directory_id, club_directory(name))"
      )
      .eq("id", teamId)
      .maybeSingle()
    const club = team?.clubs
    const directory = club?.club_directory
    return {
      displayName: directory?.name ?? team?.display_name ?? "Club",
      teamLabel: team
        ? compactTeamLabel({
            category: team.category,
            ageGroup: team.age_group,
            gender: team.gender,
            squadDesignation: team.squad_designation,
            rugbyCode: team.rugby_code,
          })
        : null,
      crestUrl: club ? await resolveClubCrestEmailUrl(supabase, club.id) : null,
    }
  }
  if (directoryId) {
    const { data: directory } = await supabase.from("club_directory").select("name").eq("id", directoryId).maybeSingle()
    return {
      displayName: directory?.name ?? "Opposition to be confirmed",
      teamLabel: null,
      crestUrl: await resolveDirectoryCrestEmailUrl(supabase, directoryId),
    }
  }
  return { displayName: "Opposition to be confirmed", teamLabel: null, crestUrl: null }
}

export async function resolveFixtureEmailContext(
  supabase: SupabaseClient<Database>,
  fixtureId: string
): Promise<FixtureEmailContextResolution> {
  const { data: f } = await supabase
    .from("fixtures")
    .select(
      "id, owning_team_id, opponent_team_id, opponent_directory_id, home_away, status, kickoff_date, kickoff_time, meet_time, cancelled_at, kickoff_amendment_proposed_at, venue_id, pitch_id, competition_edition_id"
    )
    .eq("id", fixtureId)
    .maybeSingle()

  if (!f) return { status: "not_found" }

  const isHomeOwning = f.home_away === "Home" || f.home_away === "TBD" || f.home_away === "Not Applicable"
  const homeTeamId = isHomeOwning ? f.owning_team_id : f.opponent_team_id
  const awayTeamId = isHomeOwning ? f.opponent_team_id : f.owning_team_id

  const [home, away, venueRow, pitchRow, competitionRow, attendanceRows] = await Promise.all([
    resolveSide(supabase, homeTeamId, homeTeamId ? null : f.opponent_directory_id),
    resolveSide(supabase, awayTeamId, awayTeamId ? null : f.opponent_directory_id),
    f.venue_id
      ? supabase.from("venues").select("name, address_line_1, address_line_2, town, county, postcode").eq("id", f.venue_id).maybeSingle()
      : Promise.resolve({ data: null }),
    f.pitch_id ? supabase.from("club_pitches").select("display_name").eq("id", f.pitch_id).maybeSingle() : Promise.resolve({ data: null }),
    f.competition_edition_id
      ? supabase.from("competition_editions").select("competitions(name)").eq("id", f.competition_edition_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("player_fixture_attendance").select("status").eq("fixture_id", fixtureId),
  ])

  const venue = venueRow.data
  const counts = { attending: 0, cannotAttend: 0, unsure: 0, awaitingResponse: 0 }
  for (const row of attendanceRows.data ?? []) {
    if (row.status === "ATTENDING") counts.attending += 1
    else if (row.status === "CANNOT_ATTEND") counts.cannotAttend += 1
    else if (row.status === "UNSURE") counts.unsure += 1
  }

  const competition = competitionRow.data?.competitions as unknown as { name: string } | null

  return {
    status: "available",
    context: {
      fixtureId: f.id,
      status: mapStatus(f),
      fixtureDateDisplay: formatFixtureDate(f.kickoff_date),
      fixtureDateIso: f.kickoff_date,
      kickoffTimeDisplay: formatTime(f.kickoff_time),
      meetTimeDisplay: formatTime(f.meet_time),
      homeAway: f.home_away as FixtureEmailContext["homeAway"],
      home,
      away,
      ourTeam: isHomeOwning ? home : away,
      opposition: isHomeOwning ? away : home,
      venue: venue
        ? {
            name: venue.name,
            addressLines: [venue.address_line_1, venue.address_line_2, venue.town, venue.county].filter(
              (l): l is string => Boolean(l && l.trim())
            ),
            postcode: venue.postcode,
          }
        : null,
      pitchName: pitchRow.data?.display_name ?? null,
      competitionName: competition?.name ?? null,
      attendanceCounts: counts,
    },
  }
}
