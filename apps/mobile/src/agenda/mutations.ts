import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"

/**
 * CHANGING A FIXTURE, THROUGH THE PLATFORM'S OWN MUTATIONS.
 *
 * Every function here is a thin pass to a canonical RPC. There is no mobile insert, no mobile update
 * and no service role: `create_fixture`, `update_fixture_details`, `update_fixture_schedule` and
 * `cancel_fixture` each re-check authority themselves, and a fixture request is two RLS-protected
 * inserts -- `fixture_request_groups_insert_scoped` and `fixture_requests_insert_scoped` -- exactly as
 * the website makes them.
 *
 * THE ERRORS ARE THE DATABASE'S, mostly on purpose. "Only the owning club can change the opposition"
 * and "A reason is required to cancel a fixture" are sentences a person can act on, and rewriting them
 * here would produce a second, vaguer vocabulary for the same refusals. Only the two cases a person
 * cannot act on -- a network failure, and a bare authority refusal -- are translated, because
 * "permission denied for table fixtures" helps nobody.
 *
 * CANCELLING IS NOT DELETING, and that is the DATABASE'S distinction rather than a choice made here:
 * `update_fixture_details` refuses a status of 'Cancelled' outright and says "Cancel a fixture with
 * Cancel Fixture, so the other side and the players are told why." There is no delete in this module,
 * because `fixture.fixture.delete` is club-scoped in the capability catalogue and team staff never hold
 * it. Mobile does not need to guard that; it needs to never offer it.
 */

type Client = SupabaseClient<Database>
export type MutationResult = { ok: true; id?: string } | { ok: false; message: string }

function failed(error: { message?: string; code?: string } | null, fallback: string): MutationResult {
  const message = error?.message?.trim()
  // A BARE RLS REFUSAL IS NOT A SENTENCE. Everything else the RPCs raise is written for a person and is
  // passed through unchanged.
  if (!message || error?.code === "42501" || /row-level security|permission denied/i.test(message)) {
    return { ok: false, message: fallback }
  }
  return { ok: false, message }
}

export interface NewFixture {
  owningTeamId: string
  homeAway: "Home" | "Away" | "TBD" | "Not Applicable"
  kickoffDate: string
  kickoffTime: string | null
  /** An Ovalball team, a Club Directory club, or free text -- in that order of preference. */
  opponentTeamId: string | null
  opponentDirectoryId: string | null
  rawOppositionText: string
  status: string
  gameType: string | null
  venueId: string | null
  notes: string | null
}

export async function createFixture(supabase: Client, fixture: NewFixture): Promise<MutationResult> {
  const { data, error } = await supabase.rpc("create_fixture", {
    p_owning_team_id: fixture.owningTeamId,
    p_home_away: fixture.homeAway,
    p_raw_opposition_text: fixture.rawOppositionText,
    p_kickoff_date: fixture.kickoffDate,
    p_status: fixture.status,
    p_opponent_team_id: (fixture.opponentTeamId ?? undefined) as string | undefined,
    p_opponent_directory_id: (fixture.opponentDirectoryId ?? undefined) as string | undefined,
    p_kickoff_time: (fixture.kickoffTime ?? undefined) as string | undefined,
    p_game_type: (fixture.gameType ?? undefined) as string | undefined,
    p_venue_id: (fixture.venueId ?? undefined) as string | undefined,
    p_notes: (fixture.notes ?? undefined) as string | undefined,
  })
  if (error) return failed(error, "You can't add a fixture for this team.")
  return { ok: true, id: (data as string | null) ?? undefined }
}

/**
 * The date, the kick-off and the ground, changed together.
 *
 * `update_fixture_schedule` exists because those three move as one: a fixture that shifts to a
 * different day usually shifts ground too, and writing them through three separate calls means three
 * chances for the fixture to be briefly half-moved -- and, for a two-sided fixture, three mirror
 * writes the opposing club sees arrive one at a time.
 */
export async function updateSchedule(
  supabase: Client,
  fixtureId: string,
  schedule: { kickoffDate: string; kickoffTime: string | null; venueId: string | null }
): Promise<MutationResult> {
  const { error } = await supabase.rpc("update_fixture_schedule", {
    p_fixture_id: fixtureId,
    p_kickoff_date: schedule.kickoffDate,
    p_kickoff_time: (schedule.kickoffTime ?? undefined) as string | undefined,
    p_venue_id: (schedule.venueId ?? undefined) as string | undefined,
    p_pitch_id: undefined as unknown as string,
    p_pitch_text: undefined as unknown as string,
    p_source: "mobile",
  })
  return error ? failed(error, "You can't change this fixture's schedule.") : { ok: true }
}

/** Everything that is not the schedule: status, home/away, type, notes, meet time. */
export async function updateDetails(
  supabase: Client,
  fixtureId: string,
  patch: Record<string, string | null>
): Promise<MutationResult> {
  const { error } = await supabase.rpc("update_fixture_details", { p_fixture_id: fixtureId, p_patch: patch })
  return error ? failed(error, "You can't change this fixture.") : { ok: true }
}

export async function updateMeetTime(supabase: Client, fixtureId: string, meetTime: string | null): Promise<MutationResult> {
  const { error } = await supabase.rpc("update_fixture_meet_time", {
    p_fixture_id: fixtureId,
    p_meet_time: (meetTime ?? null) as unknown as string,
  })
  return error ? failed(error, "You can't change the meet time for this fixture.") : { ok: true }
}

/**
 * CANCELLING, WHICH REQUIRES A REASON.
 *
 * Not a nicety: `cancel_fixture` refuses an empty one. A cancellation reaches the other club and the
 * players, and "Cancelled" with no explanation is the message nobody can act on -- so the database asks
 * for the sentence and the screen asks for it before it calls.
 */
export async function cancelFixture(supabase: Client, fixtureId: string, reason: string): Promise<MutationResult> {
  const trimmed = reason.trim()
  if (!trimmed) return { ok: false, message: "Say why it is cancelled, so the other side and the players are told." }
  const { error } = await supabase.rpc("cancel_fixture", { p_fixture_id: fixtureId, p_reason: trimmed })
  return error ? failed(error, "You can't cancel this fixture.") : { ok: true }
}

export interface NewFixtureRequest {
  requestingClubId: string
  requestingTeamId: string
  /** The team being asked, where the opponent is on Ovalball. */
  targetTeamId: string | null
  opponentClubId: string | null
  opponentDirectoryId: string | null
  rawOpponentText: string
  proposedDate: string
  preferredKickoffTime: string | null
  venuePreference: "home" | "away" | "either"
  note: string | null
}

/**
 * ASKING ANOTHER CLUB FOR A FIXTURE.
 *
 * A group plus one request per team, which is the canonical shape: each team stays independently
 * trackable and answerable rather than one record standing in for a batch. Mobile asks for one team,
 * because a phone is not where somebody arranges six sides at once -- that is the Planner, and the
 * Planner is club-scoped and stays on the web.
 *
 * COMPATIBILITY IS NOT CHECKED HERE and must not be. `compatible_opponent_teams` decides which sides
 * may be offered, and the fixture-request trigger refuses an incompatible pair at insert time. Anything
 * this module added would be a third opinion about which children may play each other, on a handset.
 */
export async function createFixtureRequest(supabase: Client, request: NewFixtureRequest): Promise<MutationResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "Still signing you in. Try again in a moment." }

  const { data: group, error: groupError } = await supabase
    .from("fixture_request_groups")
    .insert({
      requesting_club_id: request.requestingClubId,
      opponent_directory_id: request.opponentDirectoryId,
      opponent_club_id: request.opponentClubId,
      raw_opponent_text: request.rawOpponentText,
      proposed_date: request.proposedDate,
      notes: request.note,
      created_by: user.id,
    })
    .select("id")
    .single()
  if (groupError || !group) return failed(groupError, "You can't request a fixture for this team.")

  const { error } = await supabase.from("fixture_requests").insert({
    group_id: group.id,
    requesting_team_id: request.requestingTeamId,
    target_team_id: request.targetTeamId,
    venue_preference: request.venuePreference,
    preferred_kickoff_time: request.preferredKickoffTime,
    note: request.note,
    status: "sent",
    created_by: user.id,
  })
  // THE GROUP IS LEFT BEHIND ON FAILURE, deliberately and visibly. It is an empty request group with no
  // teams, which no surface lists and which the owning club can see in the Planner; deleting it here
  // would mean a second authority decision made by a client that has just been refused one.
  if (error) return failed(error, "That fixture request couldn't be sent.")
  return { ok: true, id: group.id }
}

/**
 * WHICH SIDES THIS TEAM MAY LEGALLY PLAY.
 *
 * `compatible_opponent_teams` is the canonical answer and applies the platform's own age-grade, rugby
 * code and category rules. It is emphatically NOT a name match: "Under 12 Boys" and "U12 Boys" are the
 * same side to a person and different strings to a computer, and an age grade is a school-year rule
 * rather than a substring. Asking the database is the only way to be right.
 */
export interface CompatibleOpponent {
  teamId: string
  displayName: string
  ageGroup: string | null
  gender: string | null
}

export async function compatibleOpponents(
  supabase: Client,
  teamId: string,
  opponentClubId: string
): Promise<CompatibleOpponent[]> {
  const { data } = await supabase.rpc("compatible_opponent_teams", { p_team_id: teamId, p_opponent_club_id: opponentClubId })
  return (data ?? []).map((row) => ({
    teamId: row.team_id,
    displayName: row.display_name,
    ageGroup: row.age_group,
    gender: row.gender,
  }))
}
