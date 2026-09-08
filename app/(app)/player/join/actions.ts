"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/**
 * An adult joining Ovalball for themselves.
 *
 * Every one of these forwards to a canonical function and returns what it
 * decided. Nothing here works out an age, a category, a code or a season: the
 * adult journey and the guardian journey ask the same server the same
 * questions, which is the only reason they can be trusted to agree.
 */

export type PlayerJoinResult = { ok: true } | { ok: false; error: string }

/**
 * Creates the signed-in person's OWN player record.
 *
 * Idempotent by construction -- players.user_id is unique -- so a refresh, a
 * second tab, or coming back through a different sign-in method resumes the
 * same profile instead of making another one.
 */
export async function createOwnPlayerProfile(
  firstName: string,
  surname: string,
  dateOfBirth: string,
  playingPathway: string
): Promise<PlayerJoinResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("create_own_player_profile", {
    p_first_name: firstName,
    p_surname: surname,
    p_date_of_birth: dateOfBirth,
    p_playing_pathway: playingPathway,
  })
  if (error) {
    console.error("create_own_player_profile failed:", error)
    return { ok: false, error: error.message }
  }
  revalidatePath("/player/join")
  revalidatePath("/dashboard")
  return { ok: true }
}

export interface AdultCategory {
  /** ADULT_TEAM | ADULT_CATEGORY | CLASSIFICATION_REQUIRED | NOT_OFFERED, or a youth allocation status. */
  status: string
  /** "Men's Open Age", or "Adult Men's Rugby" where the club chooses the squad. */
  displayLabel: string | null
  reason: string | null
  /** Whether the club runs any side in this category. */
  clubRunsTeam: boolean
  /** How many sides the club runs in it -- more than one is the club's choice to make, not the player's. */
  operationalTeamCount: number
  seasonName: string | null
  rugbyCode: string | null
}

export type PreviewResult = { ok: true; category: AdultCategory } | { ok: false; error: string }

/**
 * What rugby this person is registering for at this club.
 *
 * Reads preview_player_allocation, the same function the guardian journey
 * reads. For an adult it hands off to resolve_adult_category, which returns a
 * TEAM where the code offers one adult identity and a CATEGORY where it offers
 * several -- so a Union club's 1st, 2nd and 3rd XVs are never guessed between.
 */
export async function previewMyCategory(clubId: string, dateOfBirth: string, playingPathway: string): Promise<PreviewResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc("preview_player_allocation", {
      p_club_id: clubId,
      p_date_of_birth: dateOfBirth,
      p_playing_pathway: playingPathway,
    })
    .single()
  if (error || !data) {
    if (error) console.error("preview_player_allocation failed:", error)
    return { ok: false, error: "We couldn't work out your rugby category just now. Please try again." }
  }
  return {
    ok: true,
    category: {
      status: data.allocation_status ?? "NEEDS_ATTENTION",
      displayLabel: data.display_label,
      reason: data.reason,
      clubRunsTeam: data.club_runs_team ?? false,
      operationalTeamCount: data.operational_team_count ?? 0,
      seasonName: data.season_name,
      rugbyCode: data.rugby_code,
    },
  }
}

/**
 * Asks the club to accept this player.
 *
 * ONE request. request_to_join_club returns the open one if it already exists,
 * so a double click or a back button never produces a second thing for a club
 * manager to work through.
 */
export async function requestToJoinClub(playerId: string, clubId: string): Promise<PlayerJoinResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("request_to_join_club", { p_player_id: playerId, p_club_id: clubId })
  if (error) {
    console.error("request_to_join_club failed:", error)
    return { ok: false, error: error.message }
  }
  revalidatePath("/player/join")
  revalidatePath("/dashboard")
  return { ok: true }
}

export async function withdrawJoinRequest(requestId: string): Promise<PlayerJoinResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("withdraw_player_club_join_request", { p_request_id: requestId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/player/join")
  revalidatePath("/dashboard")
  return { ok: true }
}

export type ClubSearchResult = { id: string; name: string; rugbyCode: string }

/**
 * Searching finds a club. It grants nothing -- the club still decides.
 */
export async function searchClubsForPlayer(query: string): Promise<ClubSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  const supabase = await createClient()
  const { data } = await supabase
    .from("clubs")
    .select("id, club_directory!inner(name, rugby_code)")
    .eq("status", "active")
    .ilike("club_directory.name", `%${trimmed}%`)
    .limit(10)
  return (data ?? []).map((c) => {
    const dir = c.club_directory as unknown as { name: string; rugby_code: string }
    return { id: c.id, name: dir.name, rugbyCode: dir.rugby_code }
  })
}
