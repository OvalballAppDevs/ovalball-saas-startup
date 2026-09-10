"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/**
 * Thin wrappers over the canonical tournament RPCs.
 *
 * NOTHING HERE DECIDES AUTHORITY. Every one of these calls a SECURITY DEFINER
 * function that re-checks internal.can_manage_tournament (the whole occasion)
 * or internal.can_manage_tournament_entry (one team's own day) in the
 * database. A crafted request reaches the same check, because the check is
 * behind the door rather than in front of it.
 */

export type TournamentResult<T = void> = ({ ok: true } & (T extends void ? object : { value: T })) | { ok: false; error: string }

/**
 * The database's own refusals are written for people and are safe to show.
 * Anything else is logged and replaced, so a Postgres error never becomes a
 * description of the schema in somebody's browser.
 */
const SAFE_PREFIXES = [
  "You do not have permission",
  "A tournament needs a name",
  "A tournament cannot finish before it starts",
  "A tournament must be Rugby Union or Rugby League",
  "This tournament has been cancelled",
  "That team does not exist",
  "That club does not exist",
  "That club is not in the Club Directory",
  "That tournament entry does not exist",
  "That game does not exist",
  "That is not a valid game status",
  "A game must",
  "A pitch reservation must",
  "An opponent must",
  "A tournament can only reserve",
  "A tournament entry must",
  "That pitch is neither",
  "This club plays",
]

/**
 * The two code-isolation refusals interpolate the codes, so they are matched
 * by shape rather than by prefix. Deliberately not a bare "A " prefix: that
 * would pass through any Postgres error that happened to start with an
 * article, which is exactly how schema detail leaks into a browser.
 */
const SAFE_PATTERNS = [
  /^A (union|league) team cannot be entered into a (union|league) tournament\.$/,
  /^A (union|league) club cannot be an opponent in a (union|league) tournament\.$/,
]

function present(error: { message: string }): string {
  if (SAFE_PREFIXES.some((p) => error.message.startsWith(p)) || SAFE_PATTERNS.some((r) => r.test(error.message))) return error.message
  console.error("tournament rpc failed:", error.message)
  return "Something went wrong. Please try again."
}

function refresh(tournamentId?: string) {
  if (tournamentId) revalidatePath(`/tournaments/${tournamentId}`)
  revalidatePath("/calendar")
  revalidatePath("/calendar/agenda")
  revalidatePath("/calendar/pitch-allocation")
}

export async function saveTournamentAction(input: {
  tournamentId: string | null
  clubId: string
  name: string
  startsOn: string
  endsOn: string
  rugbyCode: string
  venueId: string | null
  hostDirectoryId: string | null
  notes: string | null
}): Promise<TournamentResult<string>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("save_tournament", {
    p_club_id: input.clubId,
    p_tournament_id: input.tournamentId ?? undefined,
    p_name: input.name,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_rugby_code: input.rugbyCode,
    p_host_directory_id: input.hostDirectoryId ?? undefined,
    p_venue_id: input.venueId ?? undefined,
    p_notes: input.notes ?? undefined,
  })
  if (error || !data) return { ok: false, error: error ? present(error) : "Something went wrong. Please try again." }
  refresh(data as string)
  return { ok: true, value: data as string }
}

export async function addTournamentTeamEntryAction(tournamentId: string, teamId: string): Promise<TournamentResult<string>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("add_tournament_team_entry", { p_tournament_id: tournamentId, p_team_id: teamId })
  if (error || !data) return { ok: false, error: error ? present(error) : "Something went wrong. Please try again." }
  refresh(tournamentId)
  return { ok: true, value: data as string }
}

export async function removeTournamentTeamEntryAction(tournamentId: string, entryId: string): Promise<TournamentResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("remove_tournament_team_entry", { p_entry_id: entryId })
  if (error) return { ok: false, error: present(error) }
  refresh(tournamentId)
  return { ok: true }
}

export async function recordTournamentOpponentAction(
  tournamentId: string,
  entryId: string,
  clubDirectoryId: string,
  canonicalTeamTypeId: string
): Promise<TournamentResult<string>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("record_tournament_opponent", {
    p_entry_id: entryId,
    p_club_directory_id: clubDirectoryId,
    p_canonical_team_type_id: canonicalTeamTypeId,
  })
  if (error || !data) return { ok: false, error: error ? present(error) : "Something went wrong. Please try again." }
  refresh(tournamentId)
  return { ok: true, value: data as string }
}

export async function removeTournamentOpponentAction(tournamentId: string, opponentId: string): Promise<TournamentResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("remove_tournament_opponent", { p_opponent_id: opponentId })
  if (error) return { ok: false, error: present(error) }
  refresh(tournamentId)
  return { ok: true }
}

export async function saveTournamentGameAction(
  tournamentId: string,
  input: {
    gameId: string | null
    entryId: string
    opponentId: string
    gameDate: string
    startTime: string | null
    durationMinutes: number | null
    pitchId: string | null
    status?: string
    ourScore?: number | null
    opponentScore?: number | null
  }
): Promise<TournamentResult<string>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("save_tournament_game", {
    p_entry_id: input.entryId,
    p_game_id: input.gameId ?? undefined,
    p_opponent_id: input.opponentId,
    p_game_date: input.gameDate,
    p_start_time: input.startTime ?? undefined,
    p_duration_minutes: input.durationMinutes ?? undefined,
    p_pitch_id: input.pitchId ?? undefined,
    p_status: input.status ?? "SCHEDULED",
    p_our_score: input.ourScore ?? undefined,
    p_opponent_score: input.opponentScore ?? undefined,
  })
  if (error || !data) return { ok: false, error: error ? present(error) : "Something went wrong. Please try again." }
  refresh(tournamentId)
  return { ok: true, value: data as string }
}

export async function deleteTournamentGameAction(tournamentId: string, gameId: string): Promise<TournamentResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_tournament_game", { p_game_id: gameId })
  if (error) return { ok: false, error: present(error) }
  refresh(tournamentId)
  return { ok: true }
}

export async function reserveTournamentPitchAction(
  tournamentId: string,
  input: { pitchId: string; reservedOn: string; startTime: string; endTime: string }
): Promise<TournamentResult<string>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("reserve_tournament_pitch", {
    p_tournament_id: tournamentId,
    p_pitch_id: input.pitchId,
    p_reserved_on: input.reservedOn,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
  })
  if (error || !data) return { ok: false, error: error ? present(error) : "Something went wrong. Please try again." }
  refresh(tournamentId)
  return { ok: true, value: data as string }
}

export async function releaseTournamentPitchAction(tournamentId: string, reservationId: string): Promise<TournamentResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("release_tournament_pitch", { p_reservation_id: reservationId })
  if (error) return { ok: false, error: present(error) }
  refresh(tournamentId)
  return { ok: true }
}

export async function cancelTournamentAction(tournamentId: string, reason: string | null): Promise<TournamentResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_tournament", { p_tournament_id: tournamentId, p_reason: reason ?? undefined })
  if (error) return { ok: false, error: present(error) }
  refresh(tournamentId)
  return { ok: true }
}

/**
 * Canonical opposition search -- the SAME Club Directory every fixture
 * opponent comes from. Scoped to the tournament's own rugby code, in the
 * QUERY rather than in the browser, so a Union club is never offered a League
 * club as an opponent and never sees one greyed out either.
 */
export async function searchTournamentOpponents(rugbyCode: string, query: string) {
  const supabase = await createClient()
  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  const { data } = await supabase
    .from("club_directory")
    .select("id, name, town, county")
    .eq("rugby_code", rugbyCode)
    .eq("active", true)
    .ilike("name", `%${trimmed}%`)
    .order("name")
    .limit(12)
  return (data ?? []).map((c) => ({ id: c.id, name: c.name, town: c.town, county: c.county }))
}

/**
 * Answering an invitation to somebody else's tournament.
 *
 * The existing canonical RPC, unchanged -- this slice moved WHERE the question
 * is asked (into Tournament Centre, where the tournament lives) without adding
 * a second way to answer it.
 */
export async function respondTournamentInvitation(
  tournamentId: string,
  participantId: string,
  accept: boolean
): Promise<TournamentResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("respond_tournament_invitation", { p_participant_id: participantId, p_accept: accept })
  if (error) return { ok: false, error: present(error) }
  refresh(tournamentId)
  return { ok: true }
}
