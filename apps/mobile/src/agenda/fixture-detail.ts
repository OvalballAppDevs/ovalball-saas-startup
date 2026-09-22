import type { SupabaseClient } from "@supabase/supabase-js"
import {
  clubLogoUrlFromPath,
  resolveClubLogoPathFrom,
  type Database,
} from "@ovalball/contracts"

/**
 * ONE FIXTURE, IN FULL.
 *
 * The agenda carries what a LIST needs. This carries what a fixture's own screen needs and no more:
 * both sides, when, where, what state it is in, who has answered, and the doors out of it -- the
 * conversation, the documents, the Match Centre. Every field is one somebody would look for; none is
 * here because the column existed.
 *
 * AUTHORITY IS THE SERVER'S, ENTIRELY. The fixture row comes back through RLS, so a fixture this
 * person may not see simply is not returned and the screen says so. The availability summary comes
 * from `fixture_availability_summary`, which returns NOTHING to somebody who may not see a squad's
 * responses -- a guardian sees their own child's answer, not the team's. A null summary is therefore a
 * legitimate answer and is rendered as its absence, never as zeroes, which would read as "nobody is
 * available".
 *
 * WHICH FIELDS MAY BE CHANGED IS ALSO THE SERVER'S. `fixture_editable_fields` answers it per fixture --
 * an away side does not own the pitch, a cancelled fixture is not rescheduled by editing it -- and the
 * edit screen draws what that returns rather than deciding for itself.
 */

type Client = SupabaseClient<Database>

type TeamRow = {
  id: string
  display_name: string
  club_id: string
  clubs: { logo_storage_path: string | null; club_directory: { name: string; logo_storage_path: string | null } | null } | null
} | null

interface FixtureRow {
  id: string
  kickoff_date: string
  kickoff_time: string | null
  meet_time: string | null
  home_away: string | null
  status: string | null
  game_type: string | null
  raw_opposition_text: string | null
  venue_address: string | null
  notes: string | null
  home_score: number | null
  away_score: number | null
  conversation_id: string | null
  cancellation_reason: string | null
  owning: TeamRow
  opponent: TeamRow
  opponent_directory: { name: string; logo_storage_path: string | null } | null
  venues: { name: string; address_line_1: string | null; address_line_2: string | null; town: string | null; postcode: string | null; directions: string | null } | null
  club_pitches: { display_name: string } | null
  competition_editions: { id: string; competitions: { name: string } | null } | null
}

export interface FixtureSide {
  teamId: string | null
  clubName: string
  teamName: string | null
  crestUrl: string | null
}

export interface FixtureAvailability {
  squad: number
  available: number
  unavailable: number
  awaiting: number
}

export interface FixtureDetail {
  id: string
  date: string
  kickoff: string | null
  meetTime: string | null
  /** Already flipped to the viewer's own side by the same rule the agenda uses. */
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable" | null
  status: string | null
  gameType: string | null
  us: FixtureSide
  them: FixtureSide
  venue: string | null
  /** A postal address where one exists, which is what a maps application can actually route to. */
  venueAddress: string | null
  /** The club's own written directions, where it has bothered to record them. Often the useful part. */
  venueDirections: string | null
  pitch: string | null
  notes: string | null
  competitionName: string | null
  cancellationReason: string | null
  result: { ourScore: number; theirScore: number } | null
  /** Null where the viewer may not see the squad's responses. Absence, never zeroes. */
  availability: FixtureAvailability | null
  /** The canonical conversation for this fixture, for the M4 native Messages screen. */
  conversationId: string | null
  /**
   * WHICH FIELDS THIS PERSON MAY CHANGE, AND WHY NOT -- the server's own answer, per fixture.
   *
   * `fixture_editable_fields` returns a reason alongside every refusal, and the reasons are the useful
   * part: "Only the owning club can change the opposition", "Choose Home or Away first -- the venue
   * belongs to the home club". An interface that merely greys a field out makes somebody guess; this
   * lets it say what the database would have said.
   */
  editable: EditableFields
  teamId: string
  clubId: string | null
}

const SELECT = `
  id, owning_team_id, opponent_team_id, opponent_directory_id, kickoff_date, kickoff_time, meet_time,
  home_away, status, game_type, raw_opposition_text, venue_address, notes, home_score, away_score,
  conversation_id, cancellation_reason, season_id,
  owning:teams!fixtures_owning_team_id_fkey(id, display_name, club_id, clubs(logo_storage_path, club_directory(name, logo_storage_path))),
  opponent:teams!fixtures_opponent_team_id_fkey(id, display_name, club_id, clubs(logo_storage_path, club_directory(name, logo_storage_path))),
  opponent_directory:club_directory!fixtures_opponent_directory_id_fkey(name, logo_storage_path),
  venues(name, address_line_1, address_line_2, town, postcode, directions),
  club_pitches(display_name),
  competition_editions(id, competitions(name))
`

export async function loadFixtureDetail(
  supabase: Client,
  fixtureId: string,
  myTeamIds: Set<string>
): Promise<FixtureDetail | null> {
  // TYPED THROUGH THE GENERATED SCHEMA, then narrowed once. PostgREST's inferred type for a select
  // this deeply nested exceeds TypeScript's instantiation budget, and the useful answer is to name the
  // shape rather than to simplify a query that is asking for exactly the right columns.
  const { data: raw } = await (supabase.from("fixtures") as unknown as {
    select: (columns: string) => {
      eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: FixtureRow | null }> }
    }
  })
    .select(SELECT)
    .eq("id", fixtureId)
    .maybeSingle()
  if (!raw) return null
  const data = raw

  // WHICH SIDE IS OURS. The viewer's own team if they have one in this fixture, otherwise the owning
  // side -- which is the fixture's own author and the right default for a site admin looking in.
  const iOwn = !data.opponent?.id || myTeamIds.has(data.owning?.id ?? "") || !myTeamIds.has(data.opponent.id)
  const ourRow = iOwn ? data.owning : data.opponent
  const theirRow = iOwn ? data.opponent : data.owning

  const us: FixtureSide = sideFrom(supabase, ourRow) ?? { teamId: null, clubName: "Your club", teamName: null, crestUrl: null }
  const them: FixtureSide =
    sideFrom(supabase, theirRow) ??
    (data.opponent_directory
      ? {
          teamId: null,
          clubName: data.opponent_directory.name,
          // A DIRECTORY CLUB HAS A CREST AND IS ENTITLED TO IT. Only a genuinely unknown opponent --
          // free text somebody typed -- has none, and that one gets initials rather than a borrowed
          // image. Never a kit.
          crestUrl: clubLogoUrlFromPath(supabase, data.opponent_directory.logo_storage_path),
          teamName: null,
        }
      : { teamId: null, clubName: data.raw_opposition_text ?? "Opposition to be confirmed", teamName: null, crestUrl: null })

  // HOME AND AWAY FROM THE FIXTURE'S OWN ORIENTATION, flipped when we are the opponent. Never inferred
  // from venue text, which is what makes an away fixture read as home the moment a club hosts at a
  // neutral ground.
  const homeAway = (iOwn
    ? data.home_away
    : data.home_away === "Home"
      ? "Away"
      : data.home_away === "Away"
        ? "Home"
        : data.home_away) as FixtureDetail["homeAway"]

  // A RESULT NEEDS BOTH SCORES. Half a scoreline is not a result, and completing it would be inventing
  // one. Whether a score exists at all is the server's decision, not this reader's.
  const hasResult = typeof data.home_score === "number" && typeof data.away_score === "number"
  const ourIsHome = homeAway === "Home"
  const result = hasResult
    ? { ourScore: ourIsHome ? data.home_score! : data.away_score!, theirScore: ourIsHome ? data.away_score! : data.home_score! }
    : null

  const [availability, editable] = await Promise.all([
    loadAvailability(supabase, fixtureId),
    loadEditableFields(supabase, fixtureId),
  ])

  const venue = data.venues
  return {
    id: data.id,
    date: data.kickoff_date,
    kickoff: data.kickoff_time ? String(data.kickoff_time).slice(0, 5) : null,
    meetTime: data.meet_time ? String(data.meet_time).slice(0, 5) : null,
    homeAway,
    status: data.status,
    gameType: data.game_type,
    us,
    them,
    venue: venue?.name ?? data.venue_address ?? null,
    venueAddress: postalAddress(venue) ?? data.venue_address ?? null,
    venueDirections: venue?.directions ?? null,
    pitch: data.club_pitches?.display_name ?? null,
    notes: data.notes,
    competitionName: data.competition_editions?.competitions?.name ?? null,
    cancellationReason: data.cancellation_reason,
    result,
    availability,
    conversationId: data.conversation_id ?? null,
    editable,
    teamId: ourRow?.id ?? data.owning?.id ?? "",
    clubId: ourRow?.club_id ?? data.owning?.club_id ?? null,
  }
}

function sideFrom(supabase: Client, row: TeamRow): FixtureSide | null {
  if (!row) return null
  return {
    teamId: row.id,
    clubName: row.clubs?.club_directory?.name ?? "Club",
    teamName: row.display_name,
    // THE CANONICAL RULE: the club's own upload, else the Directory's branding logo, else nothing.
    // Nothing means initials. Never a kit as a crest.
    crestUrl: clubLogoUrlFromPath(
      supabase,
      resolveClubLogoPathFrom(row.clubs?.logo_storage_path, row.clubs?.club_directory?.logo_storage_path)
    ),
  }
}

/**
 * WHO HAS ANSWERED -- from the canonical summary, never counted here.
 *
 * The RPC returns nothing at all to a viewer who may not see a squad's responses. That is an answer,
 * and it is rendered as the section simply not being there.
 */
async function loadAvailability(supabase: Client, fixtureId: string): Promise<FixtureAvailability | null> {
  const { data } = await supabase.rpc("fixture_availability_summary", { p_fixture_ids: [fixtureId] })
  const counts = data?.[0]
  if (!counts) return null
  return {
    squad: counts.squad_count ?? 0,
    available: counts.attending_count ?? 0,
    unavailable: counts.unavailable_count ?? 0,
    awaiting: counts.awaiting_count ?? 0,
  }
}

export interface EditableField {
  editable: boolean
  /** Present when it is not editable, in the database's own words. */
  reason: string | null
}

/** The field names `fixture_editable_fields` actually returns. Not a guess -- read from the function. */
export type EditableFields = Partial<
  Record<"schedule" | "meetTime" | "venue" | "competition" | "opposition" | "ourTeam" | "homeAway" | "result" | "details", EditableField>
>

async function loadEditableFields(supabase: Client, fixtureId: string): Promise<EditableFields> {
  const { data } = await supabase.rpc("fixture_editable_fields", { p_fixture_id: fixtureId })
  return (data as EditableFields | null) ?? {}
}

/**
 * An address a maps application can route to, assembled only from parts that exist.
 *
 * A venue with a name and no address gets none rather than a string of commas: "Directions" that open
 * a search for ", , " is worse than no Directions button.
 */
function postalAddress(venue: { name: string; address_line_1: string | null; address_line_2: string | null; town: string | null; postcode: string | null } | null | undefined): string | null {
  if (!venue) return null
  const parts = [venue.name, venue.address_line_1, venue.address_line_2, venue.town, venue.postcode].filter(
    (part): part is string => Boolean(part && part.trim())
  )
  // A NAME ALONE IS NOT AN ADDRESS. "Preston Grasshoppers" would send somebody to whatever a maps
  // search decided that meant; a postcode or a street is what makes it a route.
  return parts.length > 1 ? parts.join(", ") : null
}
